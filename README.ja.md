# aws-yolov8-realtime-segmentation

AWS 上でリアルタイム YOLOv8 インスタンスセグメンテーションを行うパイプライン。

**アーキテクチャ**

```
PC (FFmpeg / ブラウザアップロード)
  │
  ├─ RTMP ──────────────────────────────────────────────────────┐
  └─ MP4 アップロード → S3 → SQS ─────────────────────────────┐ │
                                                              ▼ ▼
                                              EC2 g4dn.xlarge (GPU)
                                              ├── nginx-rtmp (ポート 1935)
                                              ├── YOLOv8-seg 推論
                                              ├── WebSocket サーバー (ポート 8765)
                                              └── FastAPI / 署名URL (ポート 8080)
                                                              │
                                                   WebSocket (JPEG フレーム)
                                                              │
                                              ブラウザ React (Canvas)
```

## 前提条件

- AWS CLI 設定済み
- Node.js ≥ 20、pnpm
- Python 3.10+
- FFmpeg（PC 側）

## セットアップ手順

### 1. インフラのデプロイ

```bash
git clone https://github.com/<your-org>/aws-yolov8-realtime-segmentation.git
cd aws-yolov8-realtime-segmentation/cdk

pnpm install
pnpm cdk bootstrap
pnpm cdk deploy -c bucket_suffix=<任意のサフィックス>
```

デプロイ後、以下の出力を控えてください：
- `PublicIp` — EC2 パブリック IP
- `BucketName` — MP4 アップロード用 S3 バケット
- `QueueUrl` — SQS キュー URL
- `KeyPairId` — EC2 キーペア ID

秘密鍵の取得：
```bash
aws ssm get-parameter \
  --name /ec2/keypair/<KeyPairId> \
  --with-decryption \
  --query Parameter.Value \
  --output text > yolov8-seg.pem
chmod 400 yolov8-seg.pem
```

### 2. EC2 セットアップ

```bash
# プロジェクトを EC2 へコピー
scp -i yolov8-seg.pem -r . ubuntu@<PublicIp>:~/app

# EC2 に SSH ログイン
ssh -i yolov8-seg.pem ubuntu@<PublicIp>

# セットアップスクリプトを実行（初回のみ）
bash ~/app/scripts/setup_ec2.sh
```

### 3. EC2 でサーバー起動

```bash
source /opt/conda/bin/activate pytorch
export SQS_QUEUE_URL=<QueueUrl>
export S3_BUCKET_NAME=<BucketName>
python ~/app/server/main.py
```

### 4. フロントエンド起動（ローカル PC）

```bash
cd frontend
echo "VITE_EC2_IP=<PublicIp>" > .env.local
pnpm install
pnpm dev
# ブラウザで http://localhost:3000 を開く
```

## 使い方

### ライブ映像（Webカメラ）

```bash
# Mac
bash scripts/send_live.sh <PublicIp>

# Windows（カメラ名を変更してください）
ffmpeg -f dshow -i video="<カメラ名>" -vcodec libx264 -preset ultrafast -tune zerolatency -f flv rtmp://<PublicIp>/live/stream
```

### MP4 ファイル処理

ブラウザの **MP4 アップロード** パネルからファイルを選択してアップロードします。
S3 → SQS → EC2 の順に処理が進み、WebSocket 経由でブラウザに映像が流れます。

FFmpeg で MP4 をライブストリームとして送ることも可能：
```bash
bash scripts/send_mp4.sh <PublicIp> input.mp4
```

## 後片付け（重要）

**g4dn.xlarge は起動中ずっと課金されます（約 $0.71/時）。**
**使い終わったら必ず EC2 を停止するか、CDK で削除してください。**

```bash
cd cdk
pnpm cdk destroy -c bucket_suffix=<任意のサフィックス>
```
