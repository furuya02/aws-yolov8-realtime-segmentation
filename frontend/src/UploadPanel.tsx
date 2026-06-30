import { useRef, useState } from 'react'

type Status = { msg: string; ok: boolean } | null

export default function UploadPanel({ apiUrl }: { apiUrl: string }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [progress, setProgress] = useState(0)
  const [status,   setStatus]   = useState<Status>(null)
  const [busy,     setBusy]     = useState(false)

  const upload = async () => {
    const file = inputRef.current?.files?.[0]
    if (!file) return
    setBusy(true)
    setStatus(null)
    setProgress(0)

    try {
      const res  = await fetch(`${apiUrl}/presign?filename=${encodeURIComponent(file.name)}`)
      const { url } = await res.json() as { url: string }

      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.upload.onprogress = e => setProgress(Math.round(e.loaded / e.total * 100))
        xhr.onload  = () => resolve()
        xhr.onerror = () => reject(new Error('upload failed'))
        xhr.open('PUT', url)
        xhr.setRequestHeader('Content-Type', 'video/mp4')
        xhr.send(file)
      })

      setStatus({ msg: 'アップロード完了。EC2 で処理を開始しています...', ok: true })
    } catch (e) {
      setStatus({ msg: `エラー: ${String(e)}`, ok: false })
    } finally {
      setBusy(false)
      setProgress(0)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div>
      <h3 style={{ marginBottom: 8 }}>MP4 アップロード（オフライン処理）</h3>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input ref={inputRef} type="file" accept="video/mp4" disabled={busy} />
        <button
          onClick={upload}
          disabled={busy}
          style={{
            padding: '6px 16px',
            background: busy ? '#9ca3af' : '#8b5cf6',
            color: '#fff',
            border: 'none',
            borderRadius: 4,
            cursor: busy ? 'not-allowed' : 'pointer',
          }}
        >
          {busy ? 'アップロード中...' : 'アップロード'}
        </button>
      </div>

      {progress > 0 && (
        <div style={{ marginTop: 8 }}>
          <progress value={progress} max={100} style={{ width: 300 }} />
          <span style={{ marginLeft: 8, fontSize: 14 }}>{progress}%</span>
        </div>
      )}

      {status && (
        <p style={{ marginTop: 8, color: status.ok ? '#10b981' : '#ef4444' }}>
          {status.msg}
        </p>
      )}
    </div>
  )
}
