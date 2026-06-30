import { useRef, useEffect, useState } from 'react'
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

export default function VideoCanvas({ wsUrl, token }: { wsUrl: string; token: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [active, setActive] = useState(false)
  const [fps,    setFps]    = useState(0)
  const fpsRef = useRef({ count: 0, ts: Date.now() })

  // JWT をクエリパラメータとして付加
  const wsUrlWithToken = token ? `${wsUrl}?token=${token}` : null

  const { lastMessage, readyState } = useWebSocket(
    active && wsUrlWithToken ? wsUrlWithToken : null,
    { shouldReconnect: () => true },
  )

  useEffect(() => {
    if (!lastMessage?.data) return
    const { type, data } = JSON.parse(lastMessage.data as string)
    if (type !== 'frame') return

    const img = new Image()
    img.onload = () => {
      const canvas = canvasRef.current
      if (!canvas) return
      if (canvas.width !== img.width || canvas.height !== img.height) {
        canvas.width  = img.width
        canvas.height = img.height
      }
      canvas.getContext('2d')?.drawImage(img, 0, 0)

      fpsRef.current.count++
      const now = Date.now()
      if (now - fpsRef.current.ts >= 1000) {
        setFps(fpsRef.current.count)
        fpsRef.current = { count: 0, ts: now }
      }
    }
    img.src = `data:image/jpeg;base64,${data}`
  }, [lastMessage])

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
        <button
          onClick={() => setActive(v => !v)}
          disabled={!token}
          style={{
            padding: '6px 16px',
            background: active ? '#ef4444' : '#3b82f6',
            color: '#fff',
            border: 'none',
            borderRadius: 4,
            cursor: token ? 'pointer' : 'not-allowed',
            opacity: token ? 1 : 0.5,
          }}
        >
          {active ? '切断' : 'ライブ接続'}
        </button>
        <span style={{ color: STATE_COLOR[readyState], fontWeight: 600 }}>
          {STATE_LABEL[readyState]}
        </span>
        {active && readyState === ReadyState.OPEN && (
          <span style={{ color: '#6b7280', fontSize: 14 }}>{fps} fps</span>
        )}
      </div>

      <canvas
        ref={canvasRef}
        width={1280}
        height={720}
        style={{ border: '1px solid #d1d5db', maxWidth: '100%', background: '#111' }}
      />
    </div>
  )
}
