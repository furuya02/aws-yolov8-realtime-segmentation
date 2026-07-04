#!/bin/bash
# Mac 上で linux/amd64 向けにクロスビルドし、ECR へ push した後 EC2 を再起動する。
# 事前条件: docker buildx が使えること（Docker Desktop インストール済み）
set -e

REGION=ap-northeast-1
STACK_NAME=YoloSegStack

# CloudFormation Output から ECR URI と InstanceId を取得
ECR_REPO_URI=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --query "Stacks[0].Outputs[?OutputKey=='EcrRepoUri'].OutputValue" \
  --output text --region "$REGION")

INSTANCE_ID=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --query "Stacks[0].Outputs[?OutputKey=='InstanceId'].OutputValue" \
  --output text --region "$REGION")

if [ -z "$ECR_REPO_URI" ] || [ "$ECR_REPO_URI" = "None" ]; then
  echo "ERROR: ECR URI が取得できません。cdk deploy が完了しているか確認してください。" >&2
  exit 1
fi

echo "ECR URI    : $ECR_REPO_URI"
echo "Instance ID: $INSTANCE_ID"

# ECR login
ECR_HOST=$(echo "$ECR_REPO_URI" | cut -d'/' -f1)
aws ecr get-login-password --region "$REGION" \
  | docker login --username AWS --password-stdin "$ECR_HOST"

# リポジトリのルートディレクトリ（このスクリプトの親ディレクトリ）
REPO_ROOT=$(cd "$(dirname "$0")/.." && pwd)

echo "Build 開始: platform=linux/amd64"
docker buildx build \
  --platform linux/amd64 \
  -f "$REPO_ROOT/docker/Dockerfile" \
  -t "${ECR_REPO_URI}:latest" \
  --push \
  "$REPO_ROOT"

echo "✅ ECR push 完了: ${ECR_REPO_URI}:latest"

# EC2 再起動
bash "$(dirname "$0")/ec2_restart.sh"
