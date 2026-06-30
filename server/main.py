"""
Real-time YOLOv8 instance segmentation server.

入力:
  - ライブ: nginx-rtmp で受信した RTMP ストリームをフレーム取得
  - MP4:   SQS → S3 からダウンロードして処理

出力:
  - WebSocket (port 8765): 処理済みフレームを JPEG で全クライアントにブロードキャスト
  - FastAPI   (port 8080): /presign エンドポイントでブラウザからの S3 直接 PUT 用署名URL発行
"""

import asyncio
import base64
import json
import os
import queue
import threading

import boto3
import cv2
import numpy as np
import uvicorn
import websockets
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from ultralytics import YOLO

# ── 設定 ──────────────────────────────────────────────────────────────────────
RTMP_URL   = os.getenv("RTMP_URL",   "rtmp://localhost/live/stream")
SQS_URL    = os.environ["SQS_QUEUE_URL"]
BUCKET     = os.environ["S3_BUCKET_NAME"]
WS_PORT    = int(os.getenv("WS_PORT",  "8765"))
API_PORT   = int(os.getenv("API_PORT", "8080"))
REGION     = os.getenv("AWS_DEFAULT_REGION", "ap-northeast-1")
MODEL_PATH = os.getenv("MODEL_PATH", "yolov8n-seg.pt")

# ── グローバル ─────────────────────────────────────────────────────────────────
model    = YOLO(MODEL_PATH)
clients: set = set()
frame_q  = queue.Queue(maxsize=30)

# YOLOv8 クラスカラーパレット（20色）
COLORS = [
    (255, 56, 56),  (255, 157, 151), (255, 112, 31), (255, 178, 29),
    (207, 210, 49), (72,  249, 10),  (146, 204, 23), (61,  219, 134),
    (26,  147, 52), (0,   212, 187), (44,  153, 168),(0,   194, 255),
    (52,  69,  147),(100, 115, 255), (0,   24,  236), (132, 56,  255),
    (82,  0,   133),(203, 56,  255), (255, 149, 200), (255, 55,  199),
]

# ── YOLOv8 推論 & マスク描画 ──────────────────────────────────────────────────
def process_frame(frame: np.ndarray) -> np.ndarray:
    results = model(frame, verbose=False)[0]
    if results.masks is None:
        return frame

    overlay = frame.copy()
    for i, mask_xy in enumerate(results.masks.xy):
        cls   = int(results.boxes.cls[i])
        color = COLORS[cls % len(COLORS)]
        pts   = np.array(mask_xy, dtype=np.int32)
        cv2.fillPoly(overlay, [pts], color)
        x1, y1 = int(results.boxes.xyxy[i][0]), int(results.boxes.xyxy[i][1])
        label  = f"{results.names[cls]} {float(results.boxes.conf[i]):.2f}"
        cv2.putText(overlay, label, (x1, max(y1 - 5, 10)),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.55, color, 2)

    return cv2.addWeighted(frame, 0.5, overlay, 0.5, 0)

# ── WebSocket ─────────────────────────────────────────────────────────────────
async def broadcast_loop():
    loop = asyncio.get_event_loop()
    while True:
        frame   = await loop.run_in_executor(None, frame_q.get)
        if not clients:
            continue
        _, buf  = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
        payload = json.dumps({"type": "frame", "data": base64.b64encode(buf).decode()})
        dead    = set()
        for ws in clients.copy():
            try:
                await ws.send(payload)
            except Exception:
                dead.add(ws)
        clients -= dead

async def ws_handler(websocket):
    clients.add(websocket)
    try:
        async for _ in websocket:
            pass
    finally:
        clients.discard(websocket)

# ── ライブストリーム読み取り (RTMP → frame_q) ──────────────────────────────────
def live_reader():
    while True:
        cap = cv2.VideoCapture(RTMP_URL)
        while cap.isOpened():
            ret, frame = cap.read()
            if not ret:
                break
            processed = process_frame(frame)
            if not frame_q.full():
                frame_q.put_nowait(processed)
        cap.release()

# ── MP4 ワーカー (SQS → S3 → frame_q) ────────────────────────────────────────
def mp4_worker():
    sqs = boto3.client("sqs", region_name=REGION)
    s3  = boto3.client("s3",  region_name=REGION)
    while True:
        resp = sqs.receive_message(QueueUrl=SQS_URL, WaitTimeSeconds=10, MaxNumberOfMessages=1)
        for msg in resp.get("Messages", []):
            body  = json.loads(msg["Body"])
            key   = body["Records"][0]["s3"]["object"]["key"]
            local = f"/tmp/{key.split('/')[-1]}"
            s3.download_file(BUCKET, key, local)

            cap = cv2.VideoCapture(local)
            while cap.isOpened():
                ret, frame = cap.read()
                if not ret:
                    break
                frame_q.put(process_frame(frame))
            cap.release()

            sqs.delete_message(QueueUrl=SQS_URL, ReceiptHandle=msg["ReceiptHandle"])

# ── FastAPI: S3 署名URL発行 ───────────────────────────────────────────────────
api = FastAPI()
api.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"]
)

@api.get("/presign")
def presign(filename: str):
    s3  = boto3.client("s3", region_name=REGION)
    url = s3.generate_presigned_url(
        "put_object",
        Params={"Bucket": BUCKET, "Key": f"uploads/{filename}", "ContentType": "video/mp4"},
        ExpiresIn=300,
    )
    return {"url": url}

# ── エントリポイント ───────────────────────────────────────────────────────────
async def main():
    threading.Thread(target=live_reader, daemon=True).start()
    threading.Thread(target=mp4_worker,  daemon=True).start()

    asyncio.create_task(broadcast_loop())

    uvicorn_cfg    = uvicorn.Config(api, host="0.0.0.0", port=API_PORT, log_level="warning")
    uvicorn_server = uvicorn.Server(uvicorn_cfg)
    asyncio.create_task(uvicorn_server.serve())

    async with websockets.serve(ws_handler, "0.0.0.0", WS_PORT):
        print(f"WebSocket  : ws://0.0.0.0:{WS_PORT}")
        print(f"API        : http://0.0.0.0:{API_PORT}/presign")
        await asyncio.Future()

if __name__ == "__main__":
    asyncio.run(main())
