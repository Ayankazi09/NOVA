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

/** Start listening; onDone gets the transcript ('' if nothing was heard) or an error message. */
export function listen(onDone: (text: string, error?: string) => void): BrowserListen {
  const C = ctor()
  if (!C) {
    onDone('', 'Voice input is not supported in this browser. Type instead, or use Chrome.')
    return { stop() {}, cancel() {} }
  }
  const r = new C()
  r.lang = navigator.language || 'en-IN'
  r.interimResults = false
  r.continuous = true
  let text = ''
  let error: string | undefined
  let cancelled = false
  r.onresult = (e) => {
    text = Array.from(e.results).map((x) => x[0]?.transcript ?? '').join(' ').trim()
  }
  r.onerror = (e) => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') error = 'Microphone permission was blocked. Allow it in the browser, or type.'
    else if (e.error !== 'no-speech' && e.error !== 'aborted') error = 'Voice input failed. Type instead.'
  }
  r.onend = () => {
    if (!cancelled) onDone(text, error)
  }
  r.start()
  return {
    stop: () => r.stop(),
    cancel: () => {
      cancelled = true
      r.abort()
    },
  }
}
