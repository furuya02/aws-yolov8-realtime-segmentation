# aws-yolov8-realtime-segmentation

Real-time YOLOv8 instance segmentation pipeline on AWS.

**Architecture**

```
PC (FFmpeg / Browser upload)
  │
  ├─ RTMP ──────────────────────────────────────────────────────┐
  └─ MP4 upload → S3 → SQS ──────────────────────────────────┐ │
                                                              ▼ ▼
                                              EC2 g4dn.xlarge (GPU)
                                              ├── nginx-rtmp (port 1935)
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
- Python 3.10+
- FFmpeg (PC side)

## Setup

### 1. Deploy infrastructure

```bash
git clone https://github.com/<your-org>/aws-yolov8-realtime-segmentation.git
cd aws-yolov8-realtime-segmentation/cdk

pnpm install
pnpm cdk bootstrap
pnpm cdk deploy -c bucket_suffix=<YOUR_SUFFIX>
```

Note the outputs:
- `PublicIp` — EC2 public IP
- `BucketName` — S3 bucket for MP4 uploads
- `QueueUrl` — SQS queue URL
- `KeyPairId` — EC2 key pair ID

Retrieve the private key:
```bash
aws ssm get-parameter \
  --name /ec2/keypair/<KeyPairId> \
  --with-decryption \
  --query Parameter.Value \
  --output text > yolov8-seg.pem
chmod 400 yolov8-seg.pem
```

### 2. Setup EC2

```bash
# Copy project to EC2
scp -i yolov8-seg.pem -r . ubuntu@<PublicIp>:~/app

# SSH into EC2
ssh -i yolov8-seg.pem ubuntu@<PublicIp>

# Run setup script (once)
bash ~/app/scripts/setup_ec2.sh
```

### 3. Start the server on EC2

```bash
source /opt/conda/bin/activate pytorch
export SQS_QUEUE_URL=<QueueUrl>
export S3_BUCKET_NAME=<BucketName>
python ~/app/server/main.py
```

### 4. Start the frontend (local PC)

```bash
cd frontend
echo "VITE_EC2_IP=<PublicIp>" > .env.local
pnpm install
pnpm dev
# Open http://localhost:3000
```

## Usage

### Live stream (webcam)

```bash
# Mac
bash scripts/send_live.sh <PublicIp>

# Windows (change "0" to your camera device name)
ffmpeg -f dshow -i video="<camera>" -vcodec libx264 -preset ultrafast -tune zerolatency -f flv rtmp://<PublicIp>/live/stream
```

### MP4 file

Click **MP4 アップロード** in the browser UI. The file is uploaded directly to S3 via presigned URL, processed by EC2, and streamed back through WebSocket.

Alternatively, send MP4 as a stream via FFmpeg:
```bash
bash scripts/send_mp4.sh <PublicIp> input.mp4
```

## Teardown

**Stop the EC2 instance when not in use to avoid charges (~$0.71/hour for g4dn.xlarge).**

```bash
# Destroy all resources
cd cdk
pnpm cdk destroy -c bucket_suffix=<YOUR_SUFFIX>
```
