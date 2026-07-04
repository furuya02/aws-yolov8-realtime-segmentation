#!/bin/bash
# EC2 の IP 変更後（GPU/CPU 切り替え後）に CloudFront の Origin を新しい IP に更新する。
# 前提: python3、jq または python3 が使えること
set -e

REGION=ap-northeast-1
STACK_NAME=YoloSegStack

DIST_ID=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --query "Stacks[0].Outputs[?OutputKey=='DistributionId'].OutputValue" \
  --output text --region "$REGION")

if [ -z "$DIST_ID" ] || [ "$DIST_ID" = "None" ]; then
  echo "ERROR: DistributionId が取得できません。" >&2
  exit 1
fi

# 現在の EC2 IP → EC2 パブリック DNS 名に変換
EC2_IP=$(bash "$(dirname "$0")/get_ip.sh")
EC2_DNS="ec2-${EC2_IP//./-}.${REGION}.compute.amazonaws.com"
echo "新しい EC2 DNS: $EC2_DNS"

# 現在の CloudFront 設定を取得
RESULT=$(aws cloudfront get-distribution-config --id "$DIST_ID")
ETAG=$(echo "$RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin)['ETag'])")
CONFIG=$(echo "$RESULT" | python3 -c "import sys,json; print(json.dumps(json.load(sys.stdin)['DistributionConfig']))")

# EC2 origin (ec2-*.compute.amazonaws.com) の DomainName を一括更新
UPDATED=$(echo "$CONFIG" | python3 -c "
import sys, json, re
cfg = json.load(sys.stdin)
new_dns = '$EC2_DNS'
for o in cfg['Origins']['Items']:
    if re.match(r'ec2-.*\.compute\.amazonaws\.com', o.get('DomainName', '')):
        o['DomainName'] = new_dns
print(json.dumps(cfg))
")

aws cloudfront update-distribution \
  --id "$DIST_ID" \
  --if-match "$ETAG" \
  --distribution-config "$UPDATED" \
  --region "$REGION" > /dev/null

echo "✅ CloudFront Origin を更新しました: $EC2_DNS"
echo "反映まで数分かかります（CloudFront のデプロイ時間）"
