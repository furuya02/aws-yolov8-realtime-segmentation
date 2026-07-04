#!/bin/bash
# フロントエンドをビルドして S3 にアップロードし、CloudFront キャッシュを無効化する。
set -e

REGION=ap-northeast-1
STACK_NAME=YoloSegStack
REPO_ROOT=$(cd "$(dirname "$0")/.." && pwd)

# CloudFormation Outputs から値を取得
get_output() {
  aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" \
    --output text --region "$REGION"
}

BUCKET=$(get_output FrontendBucketName)
DIST_ID=$(get_output DistributionId)
USER_POOL_ID=$(get_output UserPoolId)
CLIENT_ID=$(get_output UserPoolClientId)
CF_URL=$(get_output CloudFrontUrl)

if [ -z "$BUCKET" ] || [ "$BUCKET" = "None" ]; then
  echo "ERROR: CloudFormation outputs が取得できません。cdk deploy が完了しているか確認してください。" >&2
  exit 1
fi

# .env を CloudFormation の最新値で上書き
cat > "$REPO_ROOT/frontend/.env" <<EOF
VITE_COGNITO_USER_POOL_ID=$USER_POOL_ID
VITE_COGNITO_CLIENT_ID=$CLIENT_ID
EOF

echo "ビルド中..."
cd "$REPO_ROOT/frontend" && pnpm build

echo "S3 アップロード: s3://$BUCKET"
aws s3 sync "$REPO_ROOT/frontend/dist" "s3://$BUCKET" --delete --region "$REGION"

echo "CloudFront キャッシュ無効化: $DIST_ID"
aws cloudfront create-invalidation \
  --distribution-id "$DIST_ID" \
  --paths "/*" \
  --region "$REGION" > /dev/null

echo "✅ フロントエンドのデプロイ完了"
echo "URL: $CF_URL"
