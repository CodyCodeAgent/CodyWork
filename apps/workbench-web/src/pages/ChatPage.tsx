import { useEffect, useRef, useState } from 'react'
import { api } from '../api'

interface Props {
  demandId: string
  demandName: string
  showToast: (msg: string) => void
}

interface Msg {
  role: string
  content: string
}

export function ChatPage({ demandId, demandName, showToast }: Props) {
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    api.getChat(demandId).then(r => setMessages(r.messages)).catch(e => showToast(e.message))
  }, [demandId])

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight })
  }, [messages])

  const send = () => {
    if (!input.trim() || sending) return
    const text = input.trim()
    setInput('')
    setSending(true)
    // 乐观更新用户消息
    setMessages(prev => [...prev, { role: 'user', content: text }])
    api.sendChat(demandId, text)
      .then(r => setMessages(r.messages))
      .catch(e => showToast(e.message))
      .finally(() => setSending(false))
  }

  return (
    <>
      <div className="topbar">
        <h1>💬 {demandName} · AI 会话</h1>
        <span className="crumb">每需求一个专属会话 · 多轮对话</span>
      </div>
      <div className="content" style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 130px)' }}>
        <div className="card" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', background: '#fffdf5', fontSize: 12, display: 'flex', gap: 8 }}>
            <span>🔒 权限边界：</span>
            <span className="tag gray">services/ 只读</span>
            <span className="tag blue">worktrees/ 可写</span>
            <span className="tag orange">docs/ 仅 compound 可写</span>
          </div>
          <div ref={bodyRef} style={{ flex: 1, overflowY: 'auto', padding: 18, display: 'flex', flexDirection: 'column', gap: 14, background: '#fafbfc' }}>
            {messages.length === 0 && (
              <div className="muted" style={{ textAlign: 'center', marginTop: 40 }}>
                开始对话：向 AI 描述需求，它会读写 CSR 工作区（specs/、worktrees/、docs/）<br />
                <span style={{ fontSize: 12 }}>需要服务端配置 DEEPSEEK_API_KEY</span>
              </div>
            )}
            {messages.map((m, i) => (
              <div
                key={i}
                className={m.role === 'user' ? 'chat-user' : 'chat-ai'}
                style={{
                  alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                  maxWidth: '78%',
                  padding: '11px 14px',
                  borderRadius: 12,
                  fontSize: 13.5,
                  lineHeight: 1.65,
                  background: m.role === 'user' ? 'var(--brand)' : 'var(--panel)',
                  color: m.role === 'user' ? '#fff' : 'var(--text)',
                  border: m.role === 'user' ? 'none' : '1px solid var(--border)',
                  whiteSpace: 'pre-wrap',
                }}
              >
                {m.content}
              </div>
            ))}
            {sending && <div className="muted" style={{ fontSize: 12 }}>AI 思考中…</div>}
          </div>
          <div style={{ padding: '12px 14px', borderTop: '1px solid var(--border)', display: 'flex', gap: 10 }}>
            <input
              className="input"
              style={{ marginBottom: 0, flex: 1 }}
              placeholder="输入消息…（Enter 发送）"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && send()}
            />
            <button className="btn primary" onClick={send} disabled={sending}>
              {sending ? '发送中…' : '发送'}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
