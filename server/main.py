"""
Real-time YOLOv8 instance segmentation server.

入力:
  - WebSocket (frame_in): ブラウザからのカメラ / MP4 フレーム
  - MP4:   SQS → S3 からダウンロードして処理

出力:
  - WebSocket (port 8765): JWT 認証済みクライアントへ JPEG フレームをブロードキャスト
  - FastAPI   (port 8080): /presign エンドポイント（JWT 認証必須）でブラウザ→S3 直接 PUT 用署名URL発行
"""

import asyncio
import base64
import json
import os
import queue
import threading
from urllib.parse import urlparse, parse_qs

import boto3
from botocore.config import Config
import cv2
import numpy as np
import requests
import uvicorn
import websockets
from fastapi import Depends, FastAPI, Header, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from ultralytics import YOLO

# ── 設定 ──────────────────────────────────────────────────────────────────────
SQS_URL       = os.environ["SQS_QUEUE_URL"]
BUCKET        = os.environ["S3_BUCKET_NAME"]
USER_POOL_ID  = os.environ["COGNITO_USER_POOL_ID"]
APP_CLIENT_ID = os.environ["COGNITO_APP_CLIENT_ID"]
WS_PORT       = int(os.getenv("WS_PORT",  "8765"))
API_PORT      = int(os.getenv("API_PORT", "8080"))
REGION               = os.getenv("AWS_DEFAULT_REGION", "ap-northeast-1")
MODEL_PATH           = os.getenv("MODEL_PATH", "yolov8n-seg.pt")
ORIGIN_VERIFY_SECRET = os.getenv("ORIGIN_VERIFY_SECRET", "")

JWKS_URL = f"https://cognito-idp.{REGION}.amazonaws.com/{USER_POOL_ID}/.well-known/jwks.json"

# ── グローバル ─────────────────────────────────────────────────────────────────
model      = YOLO(MODEL_PATH)
clients: set = set()
frame_q    = queue.Queue(maxsize=30)
_jwks: dict | None = None
mp4_active = threading.Event()  # MP4処理中はライブを一時停止

# クラス名ごとの色（BGR）。未登録クラスはデフォルトパレットを使用
CLASS_COLORS: dict[str, tuple] = {
    'KINOKO':  (0,   0,   255),  # 赤
    'TAKENOKO':(255, 0,   0  ),  # 青
}

# デフォルトパレット（未登録クラス用）
COLORS = [
    (255, 56, 56),  (255, 157, 151), (255, 112, 31), (255, 178, 29),
    (207, 210, 49), (72,  249, 10),  (146, 204, 23), (61,  219, 134),
    (26,  147, 52), (0,   212, 187), (44,  153, 168),(0,   194, 255),
    (52,  69,  147),(100, 115, 255), (0,   24,  236), (132, 56,  255),
    (82,  0,   133),(203, 56,  255), (255, 149, 200), (255, 55,  199),
]

# ── JWT 検証 ──────────────────────────────────────────────────────────────────
def get_jwks() -> dict:
    global _jwks
    if _jwks is None:
        _jwks = requests.get(JWKS_URL, timeout=10).json()
    return _jwks

def verify_token(token: str) -> dict:
    jwks = get_jwks()
    header = jwt.get_unverified_header(token)
    key = next((k for k in jwks["keys"] if k["kid"] == header["kid"]), None)
    if key is None:
        raise JWTError("Unknown kid")
    return jwt.decode(token, key, algorithms=["RS256"], audience=APP_CLIENT_ID)

# ── YOLOv8 推論 & マスク描画 ──────────────────────────────────────────────────
def process_frame(frame: np.ndarray) -> np.ndarray:
    results = model(frame, verbose=False)[0]
    if results.masks is None:
        return frame

    overlay = frame.copy()
    for i, mask_xy in enumerate(results.masks.xy):
        cls   = int(results.boxes.cls[i])
        name  = results.names[cls]
        color = CLASS_COLORS.get(name, COLORS[cls % len(COLORS)])
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
        _, buf  = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 95])
        payload = json.dumps({"type": "frame", "data": base64.b64encode(buf).decode()})
        dead    = set()
        for ws in clients.copy():
            try:
                await ws.send(payload)
            except Exception:
                dead.add(ws)
        clients.difference_update(dead)

async def ws_handler(websocket):
    # Confused Deputy 対策: X-Origin-Verify ヘッダーを検証（secret 設定時のみ）
    if ORIGIN_VERIFY_SECRET:
        try:
            incoming = websocket.request.headers["x-origin-verify"]
        except (KeyError, AttributeError):
            incoming = ""
        if incoming != ORIGIN_VERIFY_SECRET:
            await websocket.close(1008, "Forbidden")
            return

    # JWT をクエリパラメータから取得して検証（websockets 14+ は request.path）
    raw_path = websocket.request.path if hasattr(websocket, "request") else websocket.path
    qs = parse_qs(urlparse(raw_path).query)
    token_list = qs.get("token", [])
    if not token_list:
        await websocket.close(1008, "Token required")
        return
    try:
        claims = verify_token(token_list[0])
    except Exception:
        await websocket.close(1008, "Invalid token")
        return

    # streamers グループのみフレーム送信可、viewers は受信専用
    is_streamer = "streamers" in claims.get("cognito:groups", [])

    clients.add(websocket)
    loop = asyncio.get_event_loop()
    try:
        async for message in websocket:
            if not is_streamer:
                continue  # viewers はフレーム送信不可
            try:
                data = json.loads(message)
                if data.get("type") == "frame_in":
                    # ブラウザカメラからのフレームを受信して推論
                    img_bytes = base64.b64decode(data["data"])
                    arr   = np.frombuffer(img_bytes, dtype=np.uint8)
                    frame = cv2.imdecode(arr, cv2.IMREAD_COLOR)
                    if frame is not None and not frame_q.full():
                        processed = await loop.run_in_executor(None, process_frame, frame)
                        frame_q.put_nowait(processed)
            except Exception:
                pass
    finally:
        clients.discard(websocket)

# ── MP4 ワーカー (SQS → S3 → frame_q) ────────────────────────────────────────
def mp4_worker():
    sqs = boto3.client("sqs", region_name=REGION)
    s3  = boto3.client("s3",  region_name=REGION)
    while True:
        resp = sqs.receive_message(QueueUrl=SQS_URL, WaitTimeSeconds=10, MaxNumberOfMessages=1)
        for msg in resp.get("Messages", []):
            body  = json.loads(msg["Body"])
            if "Records" not in body:
                sqs.delete_message(QueueUrl=SQS_URL, ReceiptHandle=msg["ReceiptHandle"])
                continue
            key   = body["Records"][0]["s3"]["object"]["key"]
            local = f"/tmp/{key.split('/')[-1]}"
            s3.download_file(BUCKET, key, local)

            mp4_active.set()
            try:
                cap = cv2.VideoCapture(local)
                while cap.isOpened():
                    ret, frame = cap.read()
                    if not ret:
                        break
                    frame_q.put(process_frame(frame))
                cap.release()
            finally:
                mp4_active.clear()

            sqs.delete_message(QueueUrl=SQS_URL, ReceiptHandle=msg["ReceiptHandle"])

# ── FastAPI: S3 署名URL発行（JWT 認証必須） ───────────────────────────────────
def _verify_origin_header(x_origin_verify: str | None = Header(None)):
    """Confused Deputy 対策。ORIGIN_VERIFY_SECRET が設定されている場合のみ検証。"""
    if ORIGIN_VERIFY_SECRET and x_origin_verify != ORIGIN_VERIFY_SECRET:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")

api = FastAPI(dependencies=[Depends(_verify_origin_header)])
api.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"]
)

_bearer = HTTPBearer()

def require_auth(credentials: HTTPAuthorizationCredentials = Depends(_bearer)) -> dict:
    try:
        return verify_token(credentials.credentials)
    except Exception:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

def require_streamer(credentials: HTTPAuthorizationCredentials = Depends(_bearer)) -> dict:
    claims = require_auth(credentials)
    if "streamers" not in claims.get("cognito:groups", []):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Streamers only")
    return claims

@api.get("/presign")
def presign(filename: str, _: dict = Depends(require_streamer)):
    # グローバルエンドポイントだと 307 Redirect が発生し CORS エラーになるため
    # リージョン固有エンドポイントを明示して SigV4 で署名する
    s3  = boto3.client(
        "s3", region_name=REGION,
        endpoint_url=f"https://s3.{REGION}.amazonaws.com",
        config=Config(signature_version="s3v4"),
    )
    url = s3.generate_presigned_url(
        "put_object",
        Params={"Bucket": BUCKET, "Key": f"uploads/{filename}", "ContentType": "video/mp4"},
        ExpiresIn=300,
    )
    return {"url": url}

# ── エントリポイント ───────────────────────────────────────────────────────────
async def main():
    threading.Thread(target=mp4_worker, daemon=True).start()

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
