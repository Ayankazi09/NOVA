// Push-to-talk capture. Starts only after a user gesture; max 20 s / 5 MB.

export const MAX_RECORD_MS = 20_000
export const MAX_RECORD_BYTES = 5_000_000

const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']

export function recordingSupported(): boolean {
  return typeof window !== 'undefined' && typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia
}

export function pickMime(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined
  return MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported?.(m))
}

export class RecorderError extends Error {
  readonly kind: 'denied' | 'unsupported' | 'insecure' | 'failed'
  constructor(kind: RecorderError['kind'], message: string) {
    super(message)
    this.kind = kind
  }
}

export interface Recording {
  stop: () => Promise<Blob>
  cancel: () => void
  startedAt: number
}

export async function startRecording(onAutoStop: () => void): Promise<Recording> {
  if (!window.isSecureContext) throw new RecorderError('insecure', 'The microphone needs a secure connection (https or localhost). Typing still works.')
  if (!recordingSupported()) throw new RecorderError('unsupported', 'This browser cannot record audio. Typing still works.')
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } })
  } catch (e) {
    const name = (e as DOMException)?.name
    if (name === 'NotAllowedError' || name === 'SecurityError') throw new RecorderError('denied', 'Microphone permission was denied. You can type your question instead.')
    throw new RecorderError('failed', 'No microphone is available. You can type your question instead.')
  }
  const mime = pickMime()
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
  const chunks: Blob[] = []
  let bytes = 0
  let cancelled = false
  const release = () => stream.getTracks().forEach((t) => t.stop())
  const stopped = new Promise<Blob>((resolve, reject) => {
    rec.ondataavailable = (ev) => {
      if (ev.data.size) {
        chunks.push(ev.data)
        bytes += ev.data.size
        if (bytes > MAX_RECORD_BYTES && rec.state === 'recording') {
          rec.stop()
          onAutoStop()
        }
      }
    }
    rec.onstop = () => {
      release()
      if (cancelled) reject(new RecorderError('failed', 'cancelled'))
      else resolve(new Blob(chunks, { type: rec.mimeType || mime || 'audio/webm' }))
    }
    rec.onerror = () => {
      release()
      reject(new RecorderError('failed', 'Recording failed.'))
    }
  })
  rec.start(500)
  const timer = setTimeout(() => {
    if (rec.state === 'recording') {
      rec.stop()
      onAutoStop()
    }
  }, MAX_RECORD_MS)
  return {
    startedAt: Date.now(),
    stop: () => {
      clearTimeout(timer)
      if (rec.state === 'recording') rec.stop()
      return stopped
    },
    cancel: () => {
      clearTimeout(timer)
      cancelled = true
      if (rec.state === 'recording') rec.stop()
      else release()
      stopped.catch(() => undefined)
    },
  }
}
