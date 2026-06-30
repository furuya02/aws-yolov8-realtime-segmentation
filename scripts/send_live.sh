#!/bin/bash
# Usage: ./send_live.sh <EC2_IP>
# Mac のデフォルトカメラ (device 0) を EC2 へ RTMP 送信
EC2_IP=${1:?"Usage: $0 <EC2_IP>"}

ffmpeg \
  -f avfoundation -framerate 30 -i "0" \
  -vcodec libx264 -preset ultrafast -tune zerolatency \
  -b:v 2000k -maxrate 2000k -bufsize 4000k \
  -f flv "rtmp://${EC2_IP}/live/stream"
