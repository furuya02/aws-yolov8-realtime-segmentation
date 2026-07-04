#!/bin/bash
# EC2 インスタンスを再起動する。
# 再起動後、systemd が yolov8-seg.service を自動起動（ECR から最新イメージを pull）。
set -e

REGION=ap-northeast-1
STACK_NAME=YoloSegStack

INSTANCE_ID=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --query "Stacks[0].Outputs[?OutputKey=='InstanceId'].OutputValue" \
  --output text --region "$REGION")

if [ -z "$INSTANCE_ID" ] || [ "$INSTANCE_ID" = "None" ]; then
  echo "ERROR: InstanceId が取得できません。cdk deploy が完了しているか確認してください。" >&2
  exit 1
fi

echo "再起動: $INSTANCE_ID"
aws ec2 reboot-instances --instance-ids "$INSTANCE_ID" --region "$REGION"
echo "✅ 再起動指示完了。約 1〜2 分後に利用可能になります。"
echo "IP 確認: bash scripts/get_ip.sh"
