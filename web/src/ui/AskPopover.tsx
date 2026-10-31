// Ask NOVA: a docked conversation beside the page. Stays open while you write, keeps the thread,
// and lets you reply to NOVA. Push-to-talk fills the reply box with an editable transcript.

import { useEffect, useRef, useState } from 'react'
import { uuid } from '../notebook/ids'
import type { Turn } from '../notebook/types'
import { ApiFailure, api } from '../tutor/api'
import type { Intent, TutorStatus } from '../tutor/useNova'
import { RecorderError, startRecording, type Recording } from '../voice/recorder'
import { stopSpeaking } from '../voice/speech'
import { browserSpeechAvailable, listen, type BrowserListen } from '../voice/browserSpeech'

// does the server have a speech engine? (the hosted site does not: the browser listens instead)
let serverVoice: Promise<boolean> | null = null
const hasServerVoice = () => (serverVoice ??= api.capabilities().then((c) => !!c.features?.transcribe).catch(() => false))
import { Icon } from './icons'

interface Props {
  docked: boolean // false = phone bottom sheet
  startWithMic: boolean
  turns: Turn[]
  status: TutorStatus
  about: string | null // text of the selected line, or null for the whole page
  onClearAbout: () => void
  onSend: (intent: Intent, question: string, opts?: { voice?: boolean }) => void
  onClose: () => void
}

const QUICK_LINE: { label: string; intent: Intent; q: string }[] = [
  { label: 'Hint', intent: 'hint', q: '' },
  { label: 'Why is it wrong?', intent: 'explain', q: 'Why is it wrong?' },
  { label: 'Check', intent: 'check', q: '' },
  { label: 'Next step', intent: 'complete', q: 'Show me the next step.' },
  { label: 'Solve', intent: 'solve', q: '' },
  { label: 'Graph', intent: 'plot', q: '' },
]
const QUICK_PAGE: string[] = ['Add a trigonometry table', 'Write the algebraic identities', 'Explain what I did on this page', 'Give me a similar question to practise']

export function AskPanel({ docked, startWithMic, turns, status, about, onClearAbout, onSend, onClose }: Props) {
  const [text, setText] = useState('')
  const [mic, setMic] = useState<'idle' | 'recording' | 'transcribing'>('idle')
  const [elapsed, setElapsed] = useState(0)
  const [micError, setMicError] = useState<string | null>(null)
  const [spoken, setSpoken] = useState(false) // the current question came from the microphone
  const rec = useRef<Recording | null>(null)
  const live = useRef<BrowserListen | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const threadRef = useRef<HTMLDivElement>(null)
  const abort = useRef<AbortController | null>(null)

  useEffect(() => {
    if (startWithMic) void toggleMic()
    else inputRef.current?.focus()
    return () => {
      rec.current?.cancel()
      live.current?.cancel()
      abort.current?.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: 'smooth' })
  }, [turns.length, status.state])

  useEffect(() => {
    if (mic !== 'recording') return
    const t = setInterval(() => setElapsed(Date.now() - (rec.current?.startedAt ?? Date.now())), 200)
    return () => clearInterval(t)
  }, [mic])

  const finishRecording = async () => {
    const r = rec.current
    if (!r) return
    rec.current = null
    setMic('transcribing')
    try {
      const blob = await r.stop()
      const ctl = new AbortController()
      abort.current = ctl
      const res = await api.transcribe(uuid(), blob, ctl.signal)
      setText((t) => (t ? t + ' ' : '') + res.transcript)
      if (res.transcript) setSpoken(true)
      if (!res.transcript) setMicError('No speech was heard. Try again or type.')
      inputRef.current?.focus()
    } catch (e) {
      if (e instanceof ApiFailure && e.code === 'CANCELLED') return
      setMicError(e instanceof ApiFailure ? (e.code === 'FEATURE_UNAVAILABLE' ? 'Voice is not set up on this computer yet. Type instead.' : e.message) : 'Recording failed. Type instead.')
    } finally {
      setMic('idle')
    }
  }

  async function toggleMic() {
    setMicError(null)
    if (mic === 'recording' && live.current) {
      live.current.stop() // the browser delivers the words in onDone
      return
    }
    if (mic === 'recording') return finishRecording()
    if (mic === 'transcribing') return
    stopSpeaking() // never record our own speech output
    if (!(await hasServerVoice()) && browserSpeechAvailable()) {
      setElapsed(0)
      setMic('recording')
      const startedAt = Date.now()
      rec.current = null
      live.current = listen((heard, err) => {
        live.current = null
        setMic('idle')
        if (err) return setMicError(err)
        if (!heard) return setMicError('No speech was heard. Try again or type.')
        setText((t) => (t ? t + ' ' : '') + heard)
        setSpoken(true)
        inputRef.current?.focus()
      })
      void startedAt
      return
    }
    try {
      rec.current = await startRecording(() => void finishRecording())
      setElapsed(0)
      setMic('recording')
    } catch (e) {
      setMicError(e instanceof RecorderError ? e.message : 'Microphone unavailable. Type instead.')
    }
  }

  const cancelMic = () => {
    live.current?.cancel()
    live.current = null
    rec.current?.cancel()
    rec.current = null
    abort.current?.abort()
    setMic('idle')
  }

  const send = (intent: Intent, q: string) => {
    onSend(intent, q, { voice: spoken })
    setText('')
    setSpoken(false)
  }

  const busy = status.state === 'working'
  const shown = turns.slice(-24)
  return (
    <aside className={docked ? 'ask-panel' : 'ask-panel sheet-mode'} onPointerDown={(e) => e.stopPropagation()} role="dialog" aria-label="Ask NOVA">
      <header className="ask-head">
        <span className="nova-mark" aria-hidden="true" />
        <span className="ask-title"><img className="ask-mark" src="/nova-icon.png" alt="" />Ask NOVA</span>
        <span className="spacer" />
        <button className="icon-btn sm" aria-label="Close" onClick={onClose}><Icon.close /></button>
      </header>
      <div className="ask-about">
        {about ? (
          <span className="about-chip">About <b>{about}</b> <button className="link" aria-label="Ask about the whole page instead" onClick={onClearAbout}>×</button></span>
        ) : (
          <span className="about-chip page">About the whole page</span>
        )}
      </div>
      <div className="thread" ref={threadRef}>
        {shown.length === 0 && !busy && (
          <div className="thread-empty">
            <p>Ask anything — about a line you select, or about maths in general. NOVA can also write tables and formulas onto your page.</p>
          </div>
        )}
        {shown.map((t, i) => (
          <div key={i} className={`bubble ${t.role}`}>
            {t.text}
          </div>
        ))}
        {busy && <div className="bubble tutor thinking"><span className="dots"><i /><i /><i /></span>{status.message}</div>}
        {status.state === 'error' && (
          <div className="bubble tutor error">
            {status.message} {status.retry && <button className="link strong" onClick={status.retry}>Retry</button>}
          </div>
        )}
        {status.state === 'notice' && status.message && <div className="bubble tutor notice">{status.message}</div>}
      </div>
      <div className="chips">
        {about
          ? QUICK_LINE.map((q) => <button key={q.label} className="chip" disabled={busy} onClick={() => send(q.intent, q.q)}>{q.label}</button>)
          : QUICK_PAGE.map((q) => <button key={q} className="chip" disabled={busy} onClick={() => send('ask', q)}>{q}</button>)}
      </div>
      <div className="ask-row">
        <textarea
          ref={inputRef}
          value={text}
          maxLength={1200}
          rows={2}
          placeholder={mic === 'recording' ? 'Listening…' : turns.length ? 'Reply to NOVA…' : 'Ask NOVA anything…'}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && text.trim() && !busy) {
              e.preventDefault()
              send('ask', text.trim())
            }
            if (e.key === 'Escape') onClose()
          }}
        />
        <button className={`icon-btn ${mic === 'recording' ? 'recording' : ''}`} aria-label={mic === 'recording' ? 'Stop recording' : 'Speak your question'} onClick={() => void toggleMic()} disabled={mic === 'transcribing'}>
          {mic === 'recording' ? <Icon.stop /> : <Icon.mic />}
        </button>
        <button className="icon-btn send" aria-label="Send" disabled={!text.trim() || mic !== 'idle' || busy} onClick={() => send('ask', text.trim())}><Icon.send /></button>
      </div>
      {mic === 'recording' && <div className="mic-state"><span className="rec-dot" /> Recording {(elapsed / 1000).toFixed(1)} s / 20 s <button className="link" onClick={cancelMic}>Cancel</button></div>}
      {mic === 'transcribing' && <div className="mic-state">Transcribing on this computer… <button className="link" onClick={cancelMic}>Cancel</button></div>}
      {micError && <div className="mic-state error-text">{micError}</div>}
    </aside>
  )
}
