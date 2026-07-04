# aws-yolov8-realtime-segmentation

Real-time YOLOv8 instance segmentation pipeline on AWS.

**Architecture**

```
Browser (camera / MP4 upload)
  │
  ├─ WebSocket (camera frames) ──────────────────────────────────┐
  └─ MP4 upload → S3 → SQS ──────────────────────────────────┐  │
                                                              ▼  ▼
                                          EC2 (Docker container)
                                          ├── nginx-rtmp  (port 1935)
                                          ├── YOLOv8-seg inference
                                          ├── WebSocket server (port 8765)
                                          └── FastAPI / presign URL (port 8080)
                                                              │
                                               WebSocket (JPEG frames)
                                                              │
                                          React (Canvas) in browser
```

## Prerequisites

- AWS CLI configured
- Node.js ≥ 20, pnpm
- Docker installed on EC2 (handled by `setup_ec2.sh`)

## Setup

### 1. Deploy infrastructure

```bash
git clone https://github.com/<your-org>/aws-yolov8-realtime-segmentation.git
cd aws-yolov8-realtime-segmentation/cdk

pnpm install
pnpm cdk bootstrap
pnpm cdk deploy -c bucket_suffix=<YOUR_SUFFIX>
```

In addition to the infrastructure, `cdk deploy` runs the EC2 **UserData to install Docker, fetch the code, build the image, and start the service automatically**. The deploy waits until the build finishes (15-30 min on first run), so **the system is ready as soon as deploy completes**.

Note the outputs:
- `InstanceId` — EC2 instance ID (get the IP with `bash scripts/get_ip.sh`)
- `BucketName` — S3 bucket for MP4 uploads
- `QueueUrl` — SQS queue URL
- `KeyPairId` — EC2 key pair ID (for SSH debugging)
- `UserPoolId` — Cognito User Pool ID
- `UserPoolClientId` — Cognito App Client ID

> **What the UserData does** (`cdk/lib/stack.ts`): install Docker → fetch the app from an S3 asset → write connection info to `/etc/yolov8-seg.env` → `docker build` → start `yolov8-seg.service` (auto CPU/GPU). Progress is in `/var/log/user-data.log` on the instance.

### 2. Create a Cognito user (required for login)

```bash
aws cognito-idp admin-create-user \
  --user-pool-id <UserPoolId> \
  --username user@example.com \
  --temporary-password Temp1234! \
  --region ap-northeast-1
```

(Optional) Retrieve the private key for SSH debugging:
```bash
aws ssm get-parameter \
  --name /ec2/keypair/<KeyPairId> \
  --with-decryption \
  --query Parameter.Value \
  --output text > yolov8-seg.pem
chmod 400 yolov8-seg.pem
```

### 3. Configure and start the frontend (local PC)

```bash
cd frontend
cat > .env << EOF
VITE_EC2_IP=$(bash ../scripts/get_ip.sh)
VITE_COGNITO_USER_POOL_ID=<UserPoolId>
VITE_COGNITO_CLIENT_ID=<UserPoolClientId>
EOF
pnpm install
pnpm dev
# Open http://localhost:5173
```

> **CPU/GPU switch**: default is t3.large (CPU). For GPU inference run `bash scripts/switch_to_gpu.sh`, and `bash scripts/switch_to_cpu.sh` to switch back. After the instance-type change, `yolov8-seg.service` auto-detects the GPU and recreates the container in CPU/GPU mode (no manual step).
>
> **Server logs** (SSH): `docker exec yolov8-seg tail -f /var/log/supervisor/server.log`

## Usage

### Browser camera (primary)

1. Open the browser UI and sign in with your Cognito user
2. The camera starts automatically — select the device from the dropdown if needed
3. Click **接続** to connect WebSocket and start real-time segmentation
4. Left panel: local camera feed; Right panel: YOLOv8 inference result

### MP4 upload

Click **アップロード** in the MP4 section. The file is uploaded directly to S3 via presigned URL, then processed by EC2 and streamed back through WebSocket. Live camera is paused during MP4 processing.

### RTMP live stream (alternative)

```bash
# Mac
bash scripts/send_live.sh <PublicIp>
```

## After EC2 restart (IP address change)

EC2 gets a new public IP on every restart. Run the following steps when the IP changes:

**1. Get the new IP**
```bash
bash scripts/get_ip.sh
# or: aws ec2 describe-instances --filters "Name=tag:Name,Values=*yolov8*" \
#   --query "Reservations[0].Instances[0].PublicIpAddress" --output text --region ap-northeast-1
```

**2. Update the security group** (if your client IP has also changed)
```bash
# Check current security group rules
aws ec2 describe-security-groups --group-names yolov8-seg-sg --region ap-northeast-1

# Add your new client IP
aws ec2 authorize-security-group-ingress \
  --group-name yolov8-seg-sg \
  --protocol tcp --port 0-65535 \
  --cidr <YOUR_IP>/32 \
  --region ap-northeast-1
```

**3. Update frontend/.env**
```
VITE_EC2_IP=<NEW_IP>
```

**4. Restart the frontend dev server**
```bash
cd frontend && pnpm dev
```

The Docker container restarts automatically with the server — no manual start needed on EC2.

## Teardown

**Stop the EC2 instance when not in use to avoid charges ($0.11/h for t3.large, $0.71/h for g4dn.xlarge).**

```bash
cd cdk
pnpm cdk destroy -c bucket_suffix=<YOUR_SUFFIX>
```
