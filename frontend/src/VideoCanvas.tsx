import { useRef, useEffect, useState, useCallback } from 'react'
import useWebSocket, { ReadyState } from 'react-use-websocket'

const STATE_LABEL: Record<ReadyState, string> = {
  [ReadyState.CONNECTING]:    '接続中...',
  [ReadyState.OPEN]:          '接続済み ✓',
  [ReadyState.CLOSING]:       '切断中',
  [ReadyState.CLOSED]:        '未接続',
  [ReadyState.UNINSTANTIATED]:'未初期化',
}

const STATE_COLOR: Record<ReadyState, string> = {
  [ReadyState.CONNECTING]:    '#f59e0b',
  [ReadyState.OPEN]:          '#10b981',
  [ReadyState.CLOSING]:       '#f59e0b',
  [ReadyState.CLOSED]:        '#6b7280',
  [ReadyState.UNINSTANTIATED]:'#6b7280',
}

type Source = 'none' | 'camera' | 'mp4'
type Props  = { wsUrl: string; token: string; isStreamer: boolean }

export default function VideoCanvas({ wsUrl, token, isStreamer }: Props) {
  const canvasRef     = useRef<HTMLCanvasElement>(null)
  const captureRef    = useRef<HTMLCanvasElement>(null)
  const cameraRef     = useRef<HTMLVideoElement>(null)
  const mp4Ref        = useRef<HTMLVideoElement>(null)
  const streamRef     = useRef<MediaStream | null>(null)
  const intervalRef   = useRef<number | null>(null)
  const readyStateRef = useRef<ReadyState>(ReadyState.UNINSTANTIATED)
  const fpsRef        = useRef({ count: 0, ts: Date.now() })

  const [active,   setActive]   = useState(false)
  const [source,   setSource]   = useState<Source>('none')
  const [devices,  setDevices]  = useState<MediaDeviceInfo[]>([])
  const [deviceId, setDeviceId] = useState<string>('')
  const [mp4File,  setMp4File]  = useState<File | null>(null)
  const [fps,      setFps]      = useState(0)

  const wsUrlWithToken = token ? `${wsUrl}?token=${token}` : null

  const { lastMessage, sendMessage, readyState } = useWebSocket(
    active && wsUrlWithToken ? wsUrlWithToken : null,
    { shouldReconnect: () => true },
  )

  useEffect(() => { readyStateRef.current = readyState }, [readyState])
  const sendRef = useRef(sendMessage)
  useEffect(() => { sendRef.current = sendMessage }, [sendMessage])

  // 受信フレームを Canvas に描画
  useEffect(() => {
    if (!lastMessage?.data) return
    const { type, data } = JSON.parse(lastMessage.data as string)
    if (type !== 'frame') return
    const img = new Image()
    img.onload = () => {
      const c = canvasRef.current
      if (!c) return
      if (c.width !== img.width || c.height !== img.height) {
        c.width = img.width; c.height = img.height
      }
      c.getContext('2d')?.drawImage(img, 0, 0)
      fpsRef.current.count++
      const now = Date.now()
      if (now - fpsRef.current.ts >= 1000) {
        setFps(fpsRef.current.count)
        fpsRef.current = { count: 0, ts: now }
      }
    }
    img.src = `data:image/jpeg;base64,${data}`
  }, [lastMessage])

  // ── 共通: video 要素からフレームを 100ms 毎に送信 ──────────────────────────
  const startInterval = useCallback((videoEl: HTMLVideoElement) => {
    if (intervalRef.current) clearInterval(intervalRef.current)
    const cap = captureRef.current!
    intervalRef.current = window.setInterval(() => {
      if (!videoEl.videoWidth) return
      cap.width  = videoEl.videoWidth
      cap.height = videoEl.videoHeight
      cap.getContext('2d')!.drawImage(videoEl, 0, 0)
      if (isStreamer && readyStateRef.current === ReadyState.OPEN) {
        const b64 = cap.toDataURL('image/jpeg', 0.7).split(',')[1]
        sendRef.current(JSON.stringify({ type: 'frame_in', data: b64 }))
      }
    }, 100)
  }, [isStreamer])

  const stopInterval = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current)
    intervalRef.current = null
  }, [])

  // ── カメラ ────────────────────────────────────────────────────────────────
  const refreshDevices = useCallback(async () => {
    const all = await navigator.mediaDevices.enumerateDevices()
    const cams = all.filter(d => d.kind === 'videoinput')
    setDevices(cams)
    if (cams.length > 0) setDeviceId(prev => prev || cams[0].deviceId)
  }, [])

  useEffect(() => {
    if (!isStreamer) return
    refreshDevices()
  }, [isStreamer, refreshDevices])

  const stopCamera = useCallback(() => {
    stopInterval()
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    if (cameraRef.current) cameraRef.current.srcObject = null
    setSource('none')
  }, [stopInterval])

  const startCamera = useCallback(async () => {
    // MP4 を停止
    stopInterval()
    if (mp4Ref.current) { mp4Ref.current.pause(); mp4Ref.current.src = '' }
    // 既存カメラ停止
    streamRef.current?.getTracks().forEach(t => t.stop())

    const constraints: MediaStreamConstraints = {
      video: deviceId ? { deviceId: { exact: deviceId } } : true,
    }
    const stream = await navigator.mediaDevices.getUserMedia(constraints)
    streamRef.current = stream
    const vid = cameraRef.current!
    vid.srcObject = stream
    await vid.play()
    setSource('camera')

    const all = await navigator.mediaDevices.enumerateDevices()
    setDevices(all.filter(d => d.kind === 'videoinput'))

    startInterval(vid)
  }, [deviceId, startInterval, stopInterval])

  // ── ローカル MP4 ──────────────────────────────────────────────────────────
  const stopMp4 = useCallback(() => {
    stopInterval()
    if (mp4Ref.current) { mp4Ref.current.pause(); mp4Ref.current.src = '' }
    setSource('none')
  }, [stopInterval])

  const startMp4 = useCallback((file: File) => {
    // カメラを停止
    stopInterval()
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    if (cameraRef.current) cameraRef.current.srcObject = null

    const vid = mp4Ref.current!
    vid.src = URL.createObjectURL(file)
    vid.loop = false
    vid.play()
    setSource('mp4')
    // canplay 後に実際の videoWidth が確定するが、startInterval 内で videoWidth チェックしているので問題なし
    startInterval(vid)
  }, [startInterval, stopInterval])

  useEffect(() => () => {
    stopInterval()
    streamRef.current?.getTracks().forEach(t => t.stop())
  }, [stopInterval])

  const cameraActive = source === 'camera'
  const mp4Active    = source === 'mp4'

  return (
    <div>
      {/* ── 接続ボタン & ステータス ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
        <button
          onClick={() => setActive(v => !v)}
          disabled={!token}
          style={{
            padding: '6px 16px',
            background: active ? '#ef4444' : '#3b82f6',
            color: '#fff', border: 'none', borderRadius: 4,
            cursor: token ? 'pointer' : 'not-allowed',
            opacity: token ? 1 : 0.5,
          }}
        >
          {active ? '切断' : '接続'}
        </button>
        <span style={{ color: STATE_COLOR[readyState], fontWeight: 600 }}>
          {STATE_LABEL[readyState]}
        </span>
      </div>

      {/* ── 配信者コントロール ── */}
      {isStreamer && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>

          {/* カメラ入力 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '8px 12px', background: '#f9fafb', borderRadius: 6, border: '1px solid #e5e7eb' }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#374151', minWidth: 90 }}>カメラ入力</span>
            <select
              value={deviceId}
              onChange={e => setDeviceId(e.target.value)}
              disabled={cameraActive}
              style={{ padding: '4px 8px', borderRadius: 4, minWidth: 200, fontSize: 13 }}
            >
              {devices.length === 0 && <option value="">カメラなし</option>}
              {devices.map((d, i) => (
                <option key={d.deviceId} value={d.deviceId}>{d.label || `カメラ ${i + 1}`}</option>
              ))}
            </select>
            <button onClick={refreshDevices} disabled={cameraActive} title="カメラ一覧を更新"
              style={{ padding: '4px 10px', borderRadius: 4, cursor: cameraActive ? 'not-allowed' : 'pointer', opacity: cameraActive ? 0.4 : 1 }}>
              ↻
            </button>
            <button
              onClick={() => cameraActive ? stopCamera() : startCamera()}
              disabled={devices.length === 0 && !cameraActive}
              style={{
                padding: '6px 16px',
                background: cameraActive ? '#f97316' : '#10b981',
                color: '#fff', border: 'none', borderRadius: 4,
                cursor: (devices.length > 0 || cameraActive) ? 'pointer' : 'not-allowed',
                opacity: (devices.length > 0 || cameraActive) ? 1 : 0.4,
              }}
            >
              {cameraActive ? 'カメラ停止' : 'カメラ開始'}
            </button>
          </div>

          {/* MP4 入力 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '8px 12px', background: '#f9fafb', borderRadius: 6, border: '1px solid #e5e7eb' }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#374151', minWidth: 90 }}>MP4 入力</span>
            <label style={{
              padding: '5px 14px', background: '#6366f1', color: '#fff', borderRadius: 4,
              cursor: mp4Active ? 'not-allowed' : 'pointer', fontSize: 13, opacity: mp4Active ? 0.5 : 1,
            }}>
              ファイル選択
              <input
                type="file" accept="video/mp4,video/*"
                style={{ display: 'none' }}
                disabled={mp4Active}
                onChange={e => {
                  const f = e.target.files?.[0]
                  if (f) { setMp4File(f); e.target.value = '' }
                }}
              />
            </label>
            {mp4File && (
              <span style={{ fontSize: 12, color: '#6b7280', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {mp4File.name}
              </span>
            )}
            <button
              onClick={() => mp4Active ? stopMp4() : (mp4File && startMp4(mp4File))}
              disabled={!mp4File}
              style={{
                padding: '6px 16px',
                background: mp4Active ? '#f97316' : '#7c3aed',
                color: '#fff', border: 'none', borderRadius: 4,
                cursor: mp4File ? 'pointer' : 'not-allowed',
                opacity: mp4File ? 1 : 0.4,
              }}
            >
              {mp4Active ? '送信停止' : '再生・送信'}
            </button>
          </div>
        </div>
      )}

      {/* ── 映像エリア ── */}
      <div style={{ display: 'flex', gap: 12 }}>
        {isStreamer && (
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>
              ローカル入力（{source === 'camera' ? 'カメラ' : source === 'mp4' ? 'MP4' : '未接続'}）
            </div>
            {/* カメラ映像: 常にDOMに存在（srcObject操作のため） */}
            <video
              ref={cameraRef}
              muted playsInline
              style={{
                width: '100%', aspectRatio: '16/9',
                background: '#111', border: '1px solid #d1d5db',
                display: source === 'camera' ? 'block' : 'none',
              }}
            />
            {/* MP4 映像: controls で再生位置確認可能 */}
            <video
              ref={mp4Ref}
              controls
              style={{
                width: '100%', aspectRatio: '16/9',
                background: '#111', border: '1px solid #d1d5db',
                display: source === 'mp4' ? 'block' : 'none',
              }}
            />
            {source === 'none' && (
              <div style={{ width: '100%', aspectRatio: '16/9', background: '#111', border: '1px solid #d1d5db', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ color: '#4b5563', fontSize: 13 }}>カメラまたは MP4 を選択</span>
              </div>
            )}
          </div>
        )}

        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>
            推論結果（YOLOv8）{active && readyState === ReadyState.OPEN && ` — ${fps} fps`}
          </div>
          <canvas
            ref={canvasRef}
            width={640} height={480}
            style={{ width: '100%', aspectRatio: '16/9', background: '#111', border: '1px solid #d1d5db', display: 'block' }}
          />
        </div>
      </div>

      <canvas ref={captureRef} style={{ display: 'none' }} />
    </div>
  )
}
