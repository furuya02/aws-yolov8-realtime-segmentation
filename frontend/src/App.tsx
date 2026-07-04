import { useState, useEffect } from 'react'
import { Authenticator } from '@aws-amplify/ui-react'
import '@aws-amplify/ui-react/styles.css'
import { fetchAuthSession, signOut } from 'aws-amplify/auth'
import VideoCanvas from './VideoCanvas'
import UploadPanel from './UploadPanel'

const WS_URL  = `wss://${location.host}/ws`
const API_URL = '/api'

function decodeGroups(idToken: string): string[] {
  try {
    const payload = JSON.parse(atob(idToken.split('.')[1]))
    return (payload['cognito:groups'] as string[]) ?? []
  } catch {
    return []
  }
}

function Inner() {
  const [token,      setToken]      = useState('')
  const [isStreamer, setIsStreamer] = useState(false)

  useEffect(() => {
    fetchAuthSession().then(s => {
      const idToken = s.tokens?.idToken?.toString() ?? ''
      setToken(idToken)
      setIsStreamer(decodeGroups(idToken).includes('streamers'))
    })
  }, [])

  return (
    <div style={{ fontFamily: 'sans-serif', padding: 16, maxWidth: 1400 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>YOLOv8 Real-time Instance Segmentation</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 13, color: '#6b7280', padding: '2px 8px', background: '#f3f4f6', borderRadius: 4 }}>
            {isStreamer ? '配信者' : '視聴者'}
          </span>
          <button
            onClick={() => signOut()}
            style={{ padding: '6px 14px', cursor: 'pointer', borderRadius: 4 }}
          >
            サインアウト
          </button>
        </div>
      </div>

      <VideoCanvas wsUrl={WS_URL} token={token} isStreamer={isStreamer} />

      {isStreamer && (
        <>
          <hr style={{ margin: '24px 0' }} />
          <UploadPanel apiUrl={API_URL} token={token} />
        </>
      )}
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
