#!/bin/bash
# GPU の有無を自動検出し、ECR からイメージを pull して yolov8-seg コンテナを起動する。
# systemd(yolov8-seg.service) から boot 毎に呼ばれることを想定。手動実行も可。
# ECR_REPO_URI / AWS_DEFAULT_REGION など は /etc/yolov8-seg.env から読み込む。
# ECR にイメージがない場合は起動をスキップして正常終了（初回 cdk deploy 時）。
set -e

IMAGE=yolov8-seg
ENV_FILE=/etc/yolov8-seg.env

# env ファイルから設定読み込み（ECR_REPO_URI / AWS_DEFAULT_REGION など）
# shellcheck disable=SC1090
source "$ENV_FILE"

# ECR login（EC2 IAM ロールを利用）
ECR_HOST=$(echo "$ECR_REPO_URI" | cut -d'/' -f1)
aws ecr get-login-password --region "$AWS_DEFAULT_REGION" \
  | docker login --username AWS --password-stdin "$ECR_HOST"

# ECR からイメージ pull（なければスキップして正常終了）
if ! docker pull "${ECR_REPO_URI}:latest" 2>&1; then
  echo "ECRにイメージなし → コンテナ起動スキップ"
  echo "ecr_build_push.sh を実行してイメージを push してください"
  exit 0
fi

docker tag "${ECR_REPO_URI}:latest" "${IMAGE}:latest"

# GPU 検出: nvidia-smi があり GPU が 1 枚以上見えるなら GPU モード
GPU_FLAG=""
if command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi -L 2>/dev/null | grep -q '^GPU'; then
  GPU_FLAG="--gpus all"
  echo "GPU 検出 → GPU モードで起動 (--gpus all)"
else
  echo "GPU なし → CPU モードで起動"
fi

# 既存コンテナは毎回作り直す（ECR の最新イメージを確実に反映）
docker rm -f "$IMAGE" 2>/dev/null || true

docker run -d \
  --name "$IMAGE" \
  ${GPU_FLAG} \
  --env-file "$ENV_FILE" \
  -p 1935:1935 -p 8765:8765 -p 8080:8080 \
  "${IMAGE}:latest"

echo "Started: $IMAGE"
