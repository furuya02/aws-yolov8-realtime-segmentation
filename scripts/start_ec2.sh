#!/bin/bash
# Usage: ./start_ec2.sh [INSTANCE_ID]
# INSTANCE_ID を省略すると CloudFormation スタックから自動取得
REGION=${AWS_DEFAULT_REGION:-ap-northeast-1}
STACK_NAME=${STACK_NAME:-YoloSegStack}

INSTANCE_ID=${1:-$(aws cloudformation describe-stack-resources \
  --stack-name "${STACK_NAME}" \
  --logical-resource-id Gpu \
  --region "${REGION}" \
  --query 'StackResources[0].PhysicalResourceId' \
  --output text)}

echo "Starting EC2: ${INSTANCE_ID}"
aws ec2 start-instances --instance-ids "${INSTANCE_ID}" --region "${REGION}"

echo "Waiting for running state..."
aws ec2 wait instance-running --instance-ids "${INSTANCE_ID}" --region "${REGION}"

PUBLIC_IP=$(aws ec2 describe-instances \
  --instance-ids "${INSTANCE_ID}" \
  --region "${REGION}" \
  --query 'Reservations[0].Instances[0].PublicIpAddress' \
  --output text)

echo ""
echo "=== 起動完了 ==="
echo "Public IP : ${PUBLIC_IP}"
echo ""
echo "EC2 でサーバーを起動してください:"
echo "  ssh -i yolov8-seg.pem ubuntu@${PUBLIC_IP}"
echo "  source /opt/conda/bin/activate pytorch && python ~/app/server/main.py"
