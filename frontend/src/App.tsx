import { useState } from 'react'
import VideoCanvas from './VideoCanvas'
import UploadPanel from './UploadPanel'

const EC2_IP = import.meta.env.VITE_EC2_IP ?? 'localhost'

export default function App() {
  const [wsUrl,  setWsUrl]  = useState(`ws://${EC2_IP}:8765`)
  const [apiUrl, setApiUrl] = useState(`http://${EC2_IP}:8080`)

  return (
    <div style={{ fontFamily: 'sans-serif', padding: 16, maxWidth: 1400 }}>
      <h2 style={{ marginBottom: 12 }}>YOLOv8 Real-time Instance Segmentation</h2>

      <div style={{ display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          WebSocket
          <input
            value={wsUrl}
            onChange={e => setWsUrl(e.target.value)}
            style={{ width: 300, padding: '4px 8px', fontFamily: 'monospace' }}
          />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          API
          <input
            value={apiUrl}
            onChange={e => setApiUrl(e.target.value)}
            style={{ width: 280, padding: '4px 8px', fontFamily: 'monospace' }}
          />
        </label>
      </div>

      <VideoCanvas wsUrl={wsUrl} />

      <hr style={{ margin: '24px 0' }} />

      <UploadPanel apiUrl={apiUrl} />
    </div>
  )
}
