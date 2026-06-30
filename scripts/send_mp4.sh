#!/bin/bash
# Usage: ./send_mp4.sh <EC2_IP> <MP4_FILE>
# MP4 ファイルをライブストリームとして EC2 へ送信
EC2_IP=${1:?"Usage: $0 <EC2_IP> <MP4_FILE>"}
MP4=${2:?"Usage: $0 <EC2_IP> <MP4_FILE>"}

ffmpeg -re -i "${MP4}" \
  -vcodec libx264 -preset ultrafast -tune zerolatency \
  -f flv "rtmp://${EC2_IP}/live/stream"
