#!/bin/bash
# GPU推論が終わったとき: g4dn.xlarge → t3.large に戻す
# Usage: ./switch_to_cpu.sh [INSTANCE_ID]
REGION=${AWS_DEFAULT_REGION:-ap-northeast-1}
STACK_NAME=${STACK_NAME:-YoloSegStack}
TARGET_TYPE="t3.large"

INSTANCE_ID=${1:-$(aws ec2 describe-instances \
  --filters "Name=tag:Name,Values=${STACK_NAME}/Gpu" "Name=instance-state-name,Values=running,stopped" \
  --query "Reservations[0].Instances[0].InstanceId" \
  --output text \
  --region "${REGION}")}

echo "インスタンス: ${INSTANCE_ID}"
echo "変更先: ${TARGET_TYPE}  (約 \$0.10/時)"
echo ""

echo "[1/3] EC2 停止中..."
aws ec2 stop-instances --instance-ids "${INSTANCE_ID}" --region "${REGION}" > /dev/null
aws ec2 wait instance-stopped --instance-ids "${INSTANCE_ID}" --region "${REGION}"

echo "[2/3] インスタンスタイプ変更: → ${TARGET_TYPE}"
aws ec2 modify-instance-attribute \
  --instance-id "${INSTANCE_ID}" \
  --instance-type "${TARGET_TYPE}" \
  --region "${REGION}"

echo "[3/3] EC2 起動中..."
aws ec2 start-instances --instance-ids "${INSTANCE_ID}" --region "${REGION}" > /dev/null
aws ec2 wait instance-running --instance-ids "${INSTANCE_ID}" --region "${REGION}"

PUBLIC_IP=$(aws ec2 describe-instances \
  --instance-ids "${INSTANCE_ID}" \
  --region "${REGION}" \
  --query 'Reservations[0].Instances[0].PublicIpAddress' \
  --output text)

echo ""
echo "=== CPU (${TARGET_TYPE}) で起動完了 ==="
echo "Public IP : ${PUBLIC_IP}"
echo ""
echo "コンテナは systemd(yolov8-seg.service) が GPU 無しを検出して CPU モードで再作成します。"
echo "（手動操作は不要。確認: sudo systemctl status yolov8-seg.service）"
echo ""

# IP が変わるため CloudFront Origin を更新
echo "[4/4] CloudFront Origin を更新中..."
bash "$(dirname "$0")/update_cloudfront_origin.sh"

echo ""
echo "作業が終わったら停止も忘れずに:"
echo "  bash scripts/stop_ec2.sh"
