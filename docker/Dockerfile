FROM nvidia/cuda:12.1.0-cudnn8-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive

# nginx-rtmp + supervisord + Python 依存
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3.10 \
    python3-pip \
    nginx \
    libnginx-mod-rtmp \
    supervisor \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# PyTorch (CUDA 12.1 対応)
RUN pip3 install --no-cache-dir \
    torch torchvision --index-url https://download.pytorch.org/whl/cu121

# アプリ依存パッケージ
RUN pip3 install --no-cache-dir \
    ultralytics \
    websockets \
    boto3 \
    "fastapi[standard]" \
    uvicorn \
    "python-jose[cryptography]" \
    requests \
    opencv-python-headless

WORKDIR /app

COPY nginx/nginx.conf /etc/nginx/nginx.conf
COPY server/main.py   /app/main.py
COPY docker/supervisord.conf /etc/supervisor/conf.d/app.conf
COPY models/best.pt   /app/best.pt

EXPOSE 1935 8765 8080

CMD ["/usr/bin/supervisord", "-n", "-c", "/etc/supervisor/supervisord.conf"]
