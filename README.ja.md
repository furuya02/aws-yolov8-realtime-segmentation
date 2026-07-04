# aws-yolov8-realtime-segmentation

AWS 上でリアルタイム YOLOv8 インスタンスセグメンテーションを行うパイプライン。

**アーキテクチャ**

```
ブラウザ（カメラ / MP4 アップロード）
  │
  ├─ WebSocket（カメラフレーム）──────────────────────────────────┐
  └─ MP4 アップロード → S3 → SQS ──────────────────────────────┐ │
                                                              ▼ ▼
                                          EC2（Docker コンテナ）
                                          ├── nginx-rtmp（ポート 1935）
                                          ├── YOLOv8-seg 推論
                                          ├── WebSocket サーバー（ポート 8765）
                                          └── FastAPI / 署名URL（ポート 8080）
                                                              │
                                               WebSocket（JPEG フレーム）
                                                              │
                                          ブラウザ React（Canvas）
```

## 前提条件

- AWS CLI 設定済み
- Node.js ≥ 20、pnpm
- EC2 側の Docker（`setup_ec2.sh` でインストール）

## セットアップ手順

### 1. インフラのデプロイ

```bash
git clone https://github.com/<your-org>/aws-yolov8-realtime-segmentation.git
cd aws-yolov8-realtime-segmentation/cdk

pnpm install
pnpm cdk bootstrap
pnpm cdk deploy -c bucket_suffix=<任意のサフィックス>
```

`cdk deploy` はインフラ作成に加え、EC2 の **UserData で Docker 導入・コード取得・イメージビルド・サービス起動まで自動実行**します。ビルド完了（初回 15〜30 分）を待って deploy が完了するため、**deploy が終わればそのまま利用可能**です。

デプロイ後、以下の出力を控えてください：
- `InstanceId` — EC2 インスタンス ID（IP は `bash scripts/get_ip.sh` で取得）
- `BucketName` — MP4 アップロード用 S3 バケット
- `QueueUrl` — SQS キュー URL
- `KeyPairId` — EC2 キーペア ID（SSH デバッグ用）
- `UserPoolId` — Cognito ユーザープール ID
- `UserPoolClientId` — Cognito アプリクライアント ID

> **自動セットアップの内訳**（UserData / `cdk/lib/stack.ts`）：Docker 導入 → アプリ一式を S3 アセットから取得 → `/etc/yolov8-seg.env` に接続情報を書き込み → `docker build` → `yolov8-seg.service`（CPU/GPU 自動判定）を起動。進捗は EC2 の `/var/log/user-data.log` で確認できます。

### 2. Cognito ユーザーを作成（ログインに必須）

```bash
aws cognito-idp admin-create-user \
  --user-pool-id <UserPoolId> \
  --username user@example.com \
  --temporary-password Temp1234! \
  --region ap-northeast-1
```

（任意）SSH デバッグ用の秘密鍵取得：
```bash
aws ssm get-parameter \
  --name /ec2/keypair/<KeyPairId> \
  --with-decryption \
  --query Parameter.Value \
  --output text > yolov8-seg.pem
chmod 400 yolov8-seg.pem
```

### 3. フロントエンド起動（ローカル PC）

```bash
cd frontend
cat > .env << EOF
VITE_EC2_IP=$(bash ../scripts/get_ip.sh)
VITE_COGNITO_USER_POOL_ID=<UserPoolId>
VITE_COGNITO_CLIENT_ID=<UserPoolClientId>
EOF
pnpm install
pnpm dev
# ブラウザで http://localhost:5173 を開く
```

> **CPU/GPU 切り替え**：既定は t3.large（CPU）。GPU 推論時は `bash scripts/switch_to_gpu.sh`、戻すときは `bash scripts/switch_to_cpu.sh`。インスタンスタイプ変更後、コンテナは `yolov8-seg.service` が GPU の有無を自動判定して CPU/GPU モードで再作成します（手動操作不要）。
>
> **サーバーログ確認**（SSH）：`docker exec yolov8-seg tail -f /var/log/supervisor/server.log`

## 使い方

### ブラウザカメラ（メイン入力）

1. ブラウザで UI を開き、Cognito ユーザーでサインイン
2. カメラが自動起動します。必要に応じてドロップダウンでデバイスを切り替え
3. **接続** ボタンを押して WebSocket を接続 → リアルタイムセグメンテーション開始
4. 左パネル：ローカルカメラ映像 / 右パネル：YOLOv8 推論結果

### MP4 アップロード

**MP4 アップロード** セクションからファイルを選択してアップロードします。
S3 → SQS → EC2 の順に処理され、WebSocket 経由でブラウザに映像が流れます。
MP4 処理中はライブカメラが自動的に一時停止します。

### RTMP ライブ配信（代替手段）

```bash
# Mac
bash scripts/send_live.sh <PublicIp>
```

## EC2 再起動後の IP アドレス変更対応

EC2 を再起動するたびにパブリック IP が変わります。変更後は以下を実施してください。

**1. 新しい IP を確認**
```bash
bash scripts/get_ip.sh
# または:
# aws ec2 describe-instances --filters "Name=tag:Name,Values=*yolov8*" \
#   --query "Reservations[0].Instances[0].PublicIpAddress" --output text --region ap-northeast-1
```

**2. セキュリティグループを更新**（クライアント IP も変わった場合）
```bash
# 現在のルールを確認
aws ec2 describe-security-groups --group-names yolov8-seg-sg --region ap-northeast-1

# 新しいクライアント IP を追加
aws ec2 authorize-security-group-ingress \
  --group-name yolov8-seg-sg \
  --protocol tcp --port 0-65535 \
  --cidr <自分のIP>/32 \
  --region ap-northeast-1
```

**3. frontend/.env を更新**
```
VITE_EC2_IP=<新しいIP>
```

**4. フロントエンドの dev サーバーを再起動**
```bash
cd frontend && pnpm dev
```

Docker コンテナは EC2 起動と同時に自動起動するため、EC2 側の作業は不要です。

## 後片付け（重要）

**使い終わったら必ず EC2 を停止してください（t3.large: 約 $0.11/時、g4dn.xlarge: 約 $0.71/時）。**

```bash
cd cdk
pnpm cdk destroy -c bucket_suffix=<任意のサフィックス>
```
