import { useState, useEffect } from 'react'
import { Authenticator } from '@aws-amplify/ui-react'
import '@aws-amplify/ui-react/styles.css'
import { fetchAuthSession, signOut } from 'aws-amplify/auth'
import VideoCanvas from './VideoCanvas'
import UploadPanel from './UploadPanel'

const EC2_IP = import.meta.env.VITE_EC2_IP ?? 'localhost'

function Inner() {
  const [token,  setToken]  = useState('')
  const [wsUrl,  setWsUrl]  = useState(`ws://${EC2_IP}:8765`)
  const [apiUrl, setApiUrl] = useState(`http://${EC2_IP}:8080`)

  useEffect(() => {
    fetchAuthSession().then(s => {
      setToken(s.tokens?.idToken?.toString() ?? '')
    })
  }, [])

  return (
    <div style={{ fontFamily: 'sans-serif', padding: 16, maxWidth: 1400 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>YOLOv8 Real-time Instance Segmentation</h2>
        <button
          onClick={() => signOut()}
          style={{ padding: '6px 14px', cursor: 'pointer', borderRadius: 4 }}
        >
          サインアウト
        </button>
      </div>

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

      <VideoCanvas wsUrl={wsUrl} token={token} />

      <hr style={{ margin: '24px 0' }} />

      <UploadPanel apiUrl={apiUrl} token={token} />
    </div>
  )
}

export default function App() {
  return (
    <Authenticator hideSignUp>
      <Inner />
    </Authenticator>
  )
}
