#!/bin/bash
set -e

IMAGE=yolov8-seg

docker run -d \
  --name "$IMAGE" \
  --restart unless-stopped \
  -p 1935:1935 \
  -p 8765:8765 \
  -p 8080:8080 \
  -e SQS_QUEUE_URL="$SQS_QUEUE_URL" \
  -e S3_BUCKET_NAME="$S3_BUCKET_NAME" \
  -e COGNITO_USER_POOL_ID="$COGNITO_USER_POOL_ID" \
  -e COGNITO_APP_CLIENT_ID="$COGNITO_APP_CLIENT_ID" \
  "$IMAGE"

echo "Started: $IMAGE (CPU)"
echo "Logs: docker logs -f $IMAGE"
echo "Server log: docker exec $IMAGE tail -f /var/log/supervisor/server.log"
