#!/bin/bash
# Usage: ./stop_ec2.sh [INSTANCE_ID]
# INSTANCE_ID を省略すると CloudFormation スタックから自動取得
REGION=${AWS_DEFAULT_REGION:-ap-northeast-1}
STACK_NAME=${STACK_NAME:-YoloSegStack}

INSTANCE_ID=${1:-$(aws cloudformation describe-stack-resources \
  --stack-name "${STACK_NAME}" \
  --logical-resource-id Gpu \
  --region "${REGION}" \
  --query 'StackResources[0].PhysicalResourceId' \
  --output text)}

echo "Stopping EC2: ${INSTANCE_ID}"
aws ec2 stop-instances --instance-ids "${INSTANCE_ID}" --region "${REGION}"

echo "Waiting for stopped state..."
aws ec2 wait instance-stopped --instance-ids "${INSTANCE_ID}" --region "${REGION}"

echo ""
echo "=== 停止完了 (課金停止) ==="
echo "次回使用時: bash scripts/start_ec2.sh"
