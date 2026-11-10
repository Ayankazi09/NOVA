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
  initialText?: string // a question ready to send (from "Try this")
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

export function AskPanel({ docked, startWithMic, initialText, turns, status, about, onClearAbout, onSend, onClose }: Props) {
  const [text, setText] = useState(initialText ?? '')
  const [mic, setMic] = useState<'idle' | 'recording' | 'transcribing'>('idle')
  const [elapsed, setElapsed] = useState(0)
  const [micError, setMicError] = useState<string | null>(null)
  const [spoken, setSpoken] = useState(false) // the current question came from the microphone
  const [hearing, setHearing] = useState('') // the words heard so far, shown live while the mic is on
  const preview = useRef<BrowserListen | null>(null) // live words while the server engine records
  const rec = useRef<Recording | null>(null)
  const live = useRef<BrowserListen | null>(null)
  const liveStart = useRef(0)
  const textNow = useRef('')
  const gone = useRef(false) // panel closed (or remounted) while waiting to start the mic
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const threadRef = useRef<HTMLDivElement>(null)
  const abort = useRef<AbortController | null>(null)

  useEffect(() => {
    gone.current = false
    void hasServerVoice() // known before the mic is tapped, so the tap still counts as the user's gesture
    let micTimer: ReturnType<typeof setTimeout> | undefined
    if (startWithMic) micTimer = setTimeout(() => void toggleMic()) // after StrictMode's trial mount
    else inputRef.current?.focus()
    return () => {
      gone.current = true
      clearTimeout(micTimer)
      rec.current?.cancel()
      live.current?.cancel()
      preview.current?.cancel()
      abort.current?.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // keep the newest words in view while they are being written
  useEffect(() => {
    const t = inputRef.current
    if (t && hearing) t.scrollTop = t.scrollHeight
  }, [hearing])

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: 'smooth' })
  }, [turns.length, status.state])

  useEffect(() => {
    if (mic !== 'recording') return
    const t = setInterval(() => setElapsed(Date.now() - (rec.current?.startedAt ?? liveStart.current)), 200)
    return () => clearInterval(t)
  }, [mic])

  const finishRecording = async () => {
    const r = rec.current
    if (!r) return
    rec.current = null
    preview.current?.cancel()
    preview.current = null
    setMic('transcribing') // the live words stay in the box until the exact transcript replaces them
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
      setHearing('')
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
    const serverVoice = await hasServerVoice()
    if (gone.current) return
    if (!serverVoice) {
      if (!browserSpeechAvailable()) return setMicError('Voice input needs Chrome, Edge or Safari. You can type your question here.')
      setElapsed(0)
      liveStart.current = Date.now()
      setHearing('')
      if (spoken) {
        // speaking again replaces the last attempt (it was misheard), instead of piling on top of it
        setText('')
        textNow.current = ''
      }
      setMic('recording')
      rec.current = null
      live.current = listen((heard, err) => {
        live.current = null
        setMic('idle')
        setHearing('')
        if (err && !heard) return setMicError(err)
        if (!heard) return setMicError('No speech was heard. Try again or type.')
        // what was heard stays in the box, so it can be checked and corrected: it is only sent on Enter / Send
        // (and, because it was spoken, NOVA answers it out loud)
        const q = `${textNow.current} ${heard}`.trim()
        setText(q)
        setSpoken(true)
        setTimeout(() => {
          const t = inputRef.current
          if (!t) return
          t.focus()
          t.setSelectionRange(t.value.length, t.value.length) // caret at the end, ready to fix a word
        })
      }, { onPartial: setHearing })
      return
    }
    try {
      rec.current = await startRecording(() => void finishRecording())
      setElapsed(0)
      setHearing('')
      setMic('recording')
      // the server engine only transcribes after you stop: meanwhile show the browser's live words
      // (not on phones, where two listeners on one microphone interfere)
      if (browserSpeechAvailable() && !/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
        preview.current = listen(() => (preview.current = null), { onPartial: setHearing, continuous: true })
      }
    } catch (e) {
      setMicError(e instanceof RecorderError ? e.message : 'Microphone unavailable. Type instead.')
    }
  }

  const cancelMic = () => {
    live.current?.cancel()
    live.current = null
    preview.current?.cancel()
    preview.current = null
    rec.current?.cancel()
    rec.current = null
    abort.current?.abort()
    setMic('idle')
    setHearing('')
  }

  const send = (intent: Intent, q: string) => {
    onSend(intent, q, { voice: spoken })
    setText('')
    setSpoken(false)
  }

  const busy = status.state === 'working'
  textNow.current = text
  const shown = turns.slice(-24)
  const listening = mic !== 'idle'
  const boxText = listening && hearing ? `${text} ${hearing}`.trim() : text
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
          className={listening ? 'hearing' : undefined}
          value={boxText}
          readOnly={listening}
          aria-live={listening ? 'polite' : undefined}
          maxLength={1200}
          rows={listening && boxText.length > 60 ? 3 : 2}
          placeholder={mic === 'recording' ? 'Listening… start speaking, your words appear here' : turns.length ? 'Reply to NOVA…' : 'Ask NOVA anything…'}
          onChange={(e) => {
            if (listening) return
            setText(e.target.value)
            if (!e.target.value.trim()) setSpoken(false) // cleared: the next question is a typed one
          }}
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
      {mic === 'recording' && <div className="mic-state"><span className="rec-dot" /> {hearing ? 'Writing what you say' : 'Listening'} · {(elapsed / 1000).toFixed(1)} s / 20 s <button className="link" onClick={cancelMic}>Cancel</button></div>}
      {mic === 'transcribing' && <div className="mic-state">Transcribing on this computer… <button className="link" onClick={cancelMic}>Cancel</button></div>}
      {mic === 'idle' && spoken && !!text.trim() && !micError && <div className="mic-state">Check what NOVA heard and fix any word, then press <b>Enter</b> to send.</div>}
      {micError && <div className="mic-state error-text">{micError}</div>}
    </aside>
  )
}
