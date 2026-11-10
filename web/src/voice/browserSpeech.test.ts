import { afterEach, describe, expect, it, vi } from 'vitest'
import { listen } from './browserSpeech'

type Result = { 0: { transcript: string }; length: 1; isFinal: boolean }
class FakeRecognition {
  static last: FakeRecognition
  lang = ''
  interimResults = false
  continuous = false
  onresult: ((e: { results: Result[] }) => void) | null = null
  onerror: ((e: { error: string }) => void) | null = null
  onend: (() => void) | null = null
  constructor() {
    FakeRecognition.last = this
  }
  start() {}
  stop() {
    this.onend?.()
  }
  abort() {
    this.onend?.()
  }
  hear(...parts: string[]) {
    this.onresult?.({ results: parts.map((p, i) => ({ 0: { transcript: p }, length: 1, isFinal: i < parts.length - 1 })) })
  }
}

describe('listen', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('reports the words live while they are heard, then the final sentence', () => {
    vi.stubGlobal('webkitSpeechRecognition', FakeRecognition)
    const partials: string[] = []
    const done = vi.fn()
    const l = listen(done, { onPartial: (t) => partials.push(t) })
    const r = FakeRecognition.last
    expect(r.interimResults).toBe(true)
    r.hear('what')
    r.hear('what is the')
    r.hear('what is the', ' value of x')
    expect(partials).toEqual(['what', 'what is the', 'what is the value of x'])
    expect(done).not.toHaveBeenCalled()
    l.stop()
    expect(done).toHaveBeenCalledWith('what is the value of x', undefined)
  })

  it('stops reporting after cancel and never delivers', () => {
    vi.stubGlobal('webkitSpeechRecognition', FakeRecognition)
    const partial = vi.fn()
    const done = vi.fn()
    const l = listen(done, { onPartial: partial })
    l.cancel()
    FakeRecognition.last.hear('late words')
    expect(partial).not.toHaveBeenCalled()
    expect(done).not.toHaveBeenCalled()
  })
})

describe('speechLang', () => {
  afterEach(() => vi.restoreAllMocks())
  const tz = (zone: string) => vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({ timeZone: zone } as Intl.ResolvedDateTimeFormatOptions)

  it('listens for Indian English in India, whatever the browser language', async () => {
    const { speechLang } = await import('./browserSpeech')
    tz('Asia/Calcutta')
    expect(speechLang()).toBe('en-IN')
    tz('Asia/Kolkata')
    expect(speechLang()).toBe('en-IN')
  })

  it('uses the browser language elsewhere', async () => {
    const { speechLang } = await import('./browserSpeech')
    tz('Europe/London')
    expect(speechLang()).toBe(navigator.language)
  })
})
