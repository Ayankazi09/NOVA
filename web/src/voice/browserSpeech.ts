// Speech-to-text in the browser itself (Chrome / Edge / Safari), for hosts without a server speech engine.

interface SR {
  lang: string
  interimResults: boolean
  continuous: boolean
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}

function ctor(): (new () => SR) | null {
  const w = window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export const browserSpeechAvailable = () => ctor() !== null

export interface BrowserListen {
  stop(): void // finish and deliver what was heard
  cancel(): void
}

function explain(code: string): string | undefined {
  if (code === 'no-speech' || code === 'aborted') return undefined
  if (code === 'not-allowed' || code === 'service-not-allowed') return 'Microphone is blocked. Allow it from the icon in the address bar, then try again.'
  if (code === 'audio-capture') return 'No microphone was found. Plug one in, or type your question.'
  if (code === 'network') return "This browser can't reach its speech service (Brave and some others block it). Try Chrome, or type."
  return 'Voice input failed. Type instead.'
}

const MAX_LISTEN_MS = 20_000

/** Start listening for one spoken question; onDone gets the transcript ('' if nothing was heard) or an error message. */
export function listen(onDone: (text: string, error?: string) => void): BrowserListen {
  const C = ctor()
  if (!C) {
    onDone('', 'Voice input is not supported in this browser. Type instead, or use Chrome.')
    return { stop() {}, cancel() {} }
  }
  const r = new C()
  r.lang = navigator.language || 'en-IN'
  r.interimResults = true // keep partial words, so stopping early still delivers them
  r.continuous = false // one question, ends at the pause; continuous mode repeats words on Android
  let text = ''
  let error: string | undefined
  let cancelled = false
  let finished = false
  const cap = setTimeout(() => r.stop(), MAX_LISTEN_MS)
  const finish = () => {
    clearTimeout(cap)
    if (finished || cancelled) return
    finished = true
    onDone(text, error)
  }
  r.onresult = (e) => {
    text = Array.from(e.results).map((x) => x[0]?.transcript ?? '').join(' ').trim()
  }
  r.onerror = (e) => {
    error = explain(e.error) ?? error
  }
  r.onend = finish
  try {
    r.start()
  } catch {
    error = 'Voice input could not start. Try again, or type.'
    finish()
  }
  return {
    stop: () => r.stop(),
    cancel: () => {
      cancelled = true
      clearTimeout(cap)
      r.abort()
    },
  }
}
