#!/bin/bash
# EC2 (Deep Learning AMI Ubuntu 22.04) 初期セットアップスクリプト
# SSH ログイン後に一度だけ実行する

set -e

# nginx-rtmp インストール
sudo apt-get update -y
sudo apt-get install -y nginx libnginx-mod-rtmp

# nginx 設定コピー & 起動
sudo cp ~/app/nginx/nginx.conf /etc/nginx/nginx.conf
sudo nginx -t
sudo systemctl enable nginx
sudo systemctl restart nginx

# Python 依存パッケージ（DLAMI の pytorch conda 環境を使用）
source /opt/conda/bin/activate pytorch
pip install --quiet ultralytics websockets boto3 "fastapi[standard]" uvicorn

# YOLOv8 モデルをダウンロード（初回のみ）
python -c "from ultralytics import YOLO; YOLO('yolov8n-seg.pt')"

echo ""
echo "=== セットアップ完了 ==="
echo "サーバー起動コマンド:"
echo "  source /opt/conda/bin/activate pytorch"
echo "  export SQS_QUEUE_URL=<CDK output の QueueUrl>"
echo "  export S3_BUCKET_NAME=<CDK output の BucketName>"
echo "  python ~/app/server/main.py"
