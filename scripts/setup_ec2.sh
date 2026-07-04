#!/bin/bash
# EC2 (Ubuntu 22.04) 初期セットアップ: Docker のインストールのみ
set -e

sudo apt-get update -y
sudo apt-get install -y ca-certificates curl

sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
https://download.docker.com/linux/ubuntu \
$(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt-get update -y
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin

sudo usermod -aG docker ubuntu

# CPU/GPU 自動切替サービスの登録（boot 毎に GPU 有無を検出してコンテナを再作成）
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
sudo install -m 700 "${SCRIPT_DIR}/docker_start_auto.sh" /usr/local/bin/docker_start_auto.sh
sudo install -m 644 "${SCRIPT_DIR}/yolov8-seg.service"   /etc/systemd/system/yolov8-seg.service
sudo systemctl daemon-reload
sudo systemctl enable yolov8-seg.service

echo ""
echo "=== Docker インストール & 自動切替サービス登録 完了 ==="
echo "再ログイン後に以下の手順でサーバーを起動:"
echo ""
echo "  cd ~/app"
echo "  ./scripts/docker_build.sh          # イメージビルド（初回 15〜30 分）"
echo ""
echo "  # env 値を /etc/yolov8-seg.env に保存（サービスが読み込む）"
echo "  sudo tee /etc/yolov8-seg.env > /dev/null <<EOF"
echo "  SQS_QUEUE_URL=<QueueUrl>"
echo "  S3_BUCKET_NAME=<BucketName>"
echo "  COGNITO_USER_POOL_ID=<UserPoolId>"
echo "  COGNITO_APP_CLIENT_ID=<UserPoolClientId>"
echo "  EOF"
echo ""
echo "  sudo systemctl start yolov8-seg.service   # CPU/GPU を自動判定して起動"
echo ""
echo "  # 以降、EC2 再起動やインスタンスタイプ変更（t3⇔g4dn）に自動追従"
echo "  # 手動で起動したい場合のみ ↓"
echo "  ./scripts/docker_start.sh          # CPU で起動（手動）"
echo "  ./scripts/docker_start_gpu.sh      # GPU で起動（手動 / g4dn 切替後）"
echo "  ./scripts/docker_stop.sh           # 停止"
