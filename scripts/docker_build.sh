#!/bin/bash
set -e

cd "$(dirname "$0")/.."
docker build -f docker/Dockerfile -t yolov8-seg .
echo "Build complete: yolov8-seg"
