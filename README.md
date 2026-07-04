# aws-yolov8-realtime-segmentation

Real-time YOLOv8 instance segmentation pipeline on AWS.

**Architecture**

![Architecture](docs/architecture.png)

**Cognito groups**

| Group | Permissions |
|-------|-------------|
| `streamers` | Camera streaming, MP4 upload, WebSocket send |
| `viewers` | View inference result only |

## Prerequisites

- AWS CLI configured
- Node.js ≥ 20, pnpm
- Docker (local Mac/Linux — for building and pushing to ECR)
- AWS CDK v2 (`pnpm add -g aws-cdk`)

## Setup

### 1. Deploy infrastructure

```bash
git clone https://github.com/furuya02/aws-yolov8-realtime-segmentation.git
cd aws-yolov8-realtime-segmentation/cdk

pnpm install
pnpm cdk bootstrap
pnpm cdk deploy -c bucket_suffix=<YOUR_SUFFIX>
```

`cdk deploy` provisions all infrastructure (EC2, S3, CloudFront, Cognito, ECR, SQS).  
At this point the ECR repository is empty, so the EC2 container start is skipped automatically.

Note the outputs:
- `CloudFrontUrl` — access URL (e.g. `https://xxx.cloudfront.net`)
- `InstanceId` — EC2 instance ID
- `EcrRepoUri` — ECR repository URI
- `FrontendBucketName` — S3 bucket for the frontend
- `UserPoolId` — Cognito User Pool ID
- `UserPoolClientId` — Cognito App Client ID

### 2. Build Docker image and push to ECR

```bash
bash scripts/ecr_build_push.sh
```

This script: builds the image locally → pushes to ECR → reboots the EC2 instance.  
On reboot, `yolov8-seg.service` (systemd) automatically pulls the image from ECR and starts the container.  
Wait ~3 minutes for the container to be ready.

### 3. Deploy the frontend

```bash
bash scripts/deploy_frontend.sh
```

This script: builds the React app → uploads to S3 → invalidates the CloudFront cache.

### 4. Create Cognito users

Create a **streamer** (can stream / upload):

```bash
POOL_ID=<UserPoolId>

aws cognito-idp admin-create-user \
  --user-pool-id $POOL_ID \
  --username streamer@example.com \
  --user-attributes Name=email,Value=streamer@example.com Name=email_verified,Value=true \
  --message-action SUPPRESS \
  --region ap-northeast-1

aws cognito-idp admin-set-user-password \
  --user-pool-id $POOL_ID \
  --username streamer@example.com \
  --password "YourPassword1!" \
  --permanent \
  --region ap-northeast-1

aws cognito-idp admin-add-user-to-group \
  --user-pool-id $POOL_ID \
  --username streamer@example.com \
  --group-name streamers \
  --region ap-northeast-1
```

Create a **viewer** (view only) — same steps with `--group-name viewers`.

### 5. Open the app

Open the `CloudFrontUrl` in your browser and sign in.

## Usage

### Browser camera (streamer only)

Sign in as a streamer → the camera panel appears → frames are sent over WebSocket to EC2 → YOLOv8 inference result is broadcast back in real time.

### MP4 upload (streamer only)

Use the **MP4 アップロード** section to upload a file directly to S3 via presigned URL.  
EC2 picks it up from SQS, processes it frame-by-frame, and streams the result back.

## CPU / GPU switch

Default instance type is `t3.large` (CPU). Switch to GPU for faster inference:

```bash
bash scripts/switch_to_gpu.sh   # change to g5.2xlarge
bash scripts/switch_to_cpu.sh   # revert to t3.large
```

After the instance type changes, `yolov8-seg.service` detects the GPU automatically and restarts the container in the appropriate mode.

## After EC2 restart (IP address change)

EC2 gets a new public IP on every restart. Run:

```bash
bash scripts/update_cloudfront_origin.sh
```

This updates the CloudFront origin to the new IP. The frontend URL (`CloudFrontUrl`) does not change.

## Teardown

**Stop resources when not in use to avoid charges (t3.large: ~$0.11/h, g5.2xlarge: ~$1.21/h).**

```bash
cd cdk
pnpm cdk destroy -c bucket_suffix=<YOUR_SUFFIX>
```
