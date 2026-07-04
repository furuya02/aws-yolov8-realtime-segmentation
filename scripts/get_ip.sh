#!/bin/bash
IP=$(aws ec2 describe-instances \
  --region ap-northeast-1 \
  --filters \
    "Name=tag:aws:cloudformation:stack-name,Values=YoloSegStack" \
    "Name=instance-state-name,Values=running" \
  --query "Reservations[0].Instances[0].PublicIpAddress" \
  --output text 2>/dev/null)

if [ -z "$IP" ] || [ "$IP" = "None" ]; then
  echo "EC2 is not running" >&2
  exit 1
fi

echo "$IP"
