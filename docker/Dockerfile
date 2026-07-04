FROM nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive

# supervisord + Python 依存
RUN apt-get update && apt-get upgrade -y && apt-get install -y --no-install-recommends \
    python3.10 \
    python3-pip \
    supervisor \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# PyTorch (CUDA 12.4 対応)
RUN pip3 install --no-cache-dir \
    torch==2.6.0+cu124 torchvision==0.21.0+cu124 --index-url https://download.pytorch.org/whl/cu124

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

COPY server/main.py   /app/main.py
COPY docker/supervisord.conf /etc/supervisor/conf.d/app.conf
COPY models/best.pt   /app/best.pt

EXPOSE 8765 8080

CMD ["/usr/bin/supervisord", "-n", "-c", "/etc/supervisor/supervisord.conf"]
