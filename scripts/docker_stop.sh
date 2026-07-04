#!/bin/bash
IMAGE=yolov8-seg
docker stop "$IMAGE" 2>/dev/null || true
docker rm   "$IMAGE" 2>/dev/null || true
echo "Stopped: $IMAGE"
