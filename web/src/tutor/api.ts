import type { CheckResult, PlotData, TutorAction } from '../notebook/types'

export const CLIENT_DEADLINE_MS = 85_000

export interface RequestContext {
  requestId: string
  pageId: string
  contentRevision: number
  regionId: string
  sourceHash: string
  selectionRevision: number
  interpretationRevision: number
}

export class ApiFailure extends Error {
  readonly code: string
  readonly retryable: boolean
  readonly status: number
  constructor(code: string, message: string, retryable: boolean, status = 0) {
    super(message)
    this.code = code
    this.retryable = retryable
    this.status = status
  }
}

// ---- hosted test site: a shared access code keeps the model credit safe (asked once, kept on this device)
const ACCESS_KEY = 'nova.accessCode'
let codePrompt: Promise<string | null> | null = null
function storedCode(): string {
  try {
    return localStorage.getItem(ACCESS_KEY) ?? ''
  } catch {
    return ''
  }
}
function askForCode(wrong: boolean): Promise<string | null> {
  codePrompt ??= new Promise<string | null>((resolve) => {
    // a microtask later, so parallel requests share one prompt
    setTimeout(() => {
      const v = window.prompt(wrong && storedCode() ? 'That access code did not work. Enter the NOVA access code:' : 'Enter the NOVA access code (ask the person who shared this link):')?.trim() || null
      if (v) {
        try {
          localStorage.setItem(ACCESS_KEY, v)
        } catch {
          /* private mode: ask again next time */
        }
      }
      codePrompt = null
      resolve(v)
    }, 0)
  })
  return codePrompt
}
function withAccess(init: RequestInit): RequestInit {
  const code = storedCode()
  if (!code) return init
  const headers = new Headers(init.headers)
  headers.set('X-Nova-Access', code)
  return { ...init, headers }
}

async function call<T>(path: string, init: RequestInit, signal?: AbortSignal): Promise<T> {
  try {
    return await callOnce<T>(path, withAccess(init), signal)
  } catch (e) {
    if (!(e instanceof ApiFailure) || e.code !== 'ACCESS_REQUIRED') throw e
    const code = await askForCode(true)
    if (!code) throw e
    return callOnce<T>(path, withAccess(init), signal)
  }
}

async function callOnce<T>(path: string, init: RequestInit, signal?: AbortSignal): Promise<T> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(new DOMException('deadline', 'TimeoutError')), CLIENT_DEADLINE_MS)
  const onAbort = () => ctl.abort(signal?.reason)
  signal?.addEventListener('abort', onAbort)
  try {
    let res: Response
    try {
      res = await fetch(path, { ...init, signal: ctl.signal })
    } catch (e) {
      if (signal?.aborted) throw new ApiFailure('CANCELLED', 'Request cancelled.', false)
      if ((e as DOMException)?.name === 'TimeoutError' || ctl.signal.reason?.name === 'TimeoutError') throw new ApiFailure('TIMEOUT', 'NOVA took too long to answer. Your ink is safe.', true)
      throw new ApiFailure('NETWORK', 'Cannot reach the NOVA server. Is it running?', true)
    }
    let body: unknown = null
    try {
      body = await res.json()
    } catch {
      /* non-JSON */
    }
    if (!res.ok) {
      const err = (body as { error?: { code: string; message: string; retryable: boolean } } | null)?.error
      if (err) throw new ApiFailure(err.code, err.message, err.retryable, res.status)
      throw new ApiFailure('HTTP_' + res.status, `Server error ${res.status}.`, res.status >= 500, res.status)
    }
    return body as T
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}

const json = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

export interface Capabilities {
  version: string
  features: Record<string, boolean>
  mathScopes: string[]
  limits: Record<string, number>
  provider: { name: string; model: string; keyConfigured: boolean; modelsReachable: boolean | null; visionSmokeTested: boolean | null; lastTestedAt: string | null; lastError: string | null; visionReading: string | null }
  speech: { installed: boolean; model: string; loaded: boolean; lastError: string | null; maxSeconds: number }
}

export interface RecognizeResult {
  context: RequestContext
  status: 'expression' | 'incomplete' | 'none' | 'ambiguous'
  rawText: string
  alternatives: string[]
  needsClarification: boolean
  note?: string | null
  model: string
  latencyMs: number
}

export interface TutorResult {
  context: RequestContext
  explanation: string
  actions: TutorAction[]
  check?: (Omit<CheckResult, 'againstProblemId' | 'problemText'> & { context: RequestContext }) | null
  verifiedBy: 'deterministic' | 'model' | 'none'
  model?: string | null
  latencyMs: number
}

export interface TutorPayload {
  context: RequestContext
  intent: 'ask' | 'hint' | 'explain' | 'check' | 'complete' | 'plot' | 'solve'
  question: string
  problem?: { regionId: string; text: string; accepted: boolean } | null
  current?: { regionId: string; text: string; accepted: boolean } | null
  history: { role: 'student' | 'tutor'; text: string }[]
  plotExpression?: string | null
  regionIds: string[]
  pageLines?: { regionId: string; text: string; accepted: boolean }[]
  exam?: { number: string; text: string; answer: string; reveal: boolean } | null
}

export const api = {
  capabilities: () => call<Capabilities>('/api/v1/capabilities', { method: 'GET' }),
  testConnection: (vision: boolean) => call<Record<string, unknown>>('/api/v1/connection/test', json({ vision })),
  recognize: (body: { context: RequestContext; regionPng: string; regionWidth: number; regionHeight: number }, signal?: AbortSignal) =>
    call<RecognizeResult>('/api/v1/recognize', json(body), signal),
  tutor: (body: TutorPayload, signal?: AbortSignal) => call<TutorResult>('/api/v1/tutor', json(body), signal),
  check: (body: { context: RequestContext; problem: string; current: string; confirmed: boolean }) =>
    call<{ status: CheckResult['status']; message: string; problemSolution?: string; currentSolution?: string; context: RequestContext }>('/api/v1/check', json(body)),
  plot: (body: { context: RequestContext; expression: string }) => call<{ plot: PlotData; context: RequestContext }>('/api/v1/plot', json(body)),
  auto: (body: { context: RequestContext; text: string; problem?: string | null; autoAnswer: boolean; diagramPng?: string }, signal?: AbortSignal) =>
    call<{ context: RequestContext; kind: 'answer' | 'mark' | 'solution' | 'none'; verdict: 'correct' | 'incorrect' | 'equivalent' | 'different' | 'solved' | 'none'; answer?: string | null; steps?: string[]; notes?: string[]; moves?: ({ find: string; becomes: string } | null)[]; suggest?: 'graph' | 'solve' | 'none'; message?: string | null }>('/api/v1/auto', json(body), signal),
  paperAnalyze: (body: { requestId: string; pageIndex: number; png: string; lines: { id: string; text: string }[] }) =>
    call<{ pageIndex: number; latencyMs: number; questions: { number: string; text: string; lineIds: string[]; bbox: number[]; kind: string; options: string[]; answer: string; answerVerified: boolean; corrected: boolean }[] }>('/api/v1/paper/analyze', json(body)),
  paperGrade: (items: { id: string; kind: string; answer: string; student: string }[]) =>
    call<{ id: string; verdict: 'correct' | 'incorrect' | 'unanswered' }[]>('/api/v1/paper/grade', json({ items })),
  transcribe: (requestId: string, audio: Blob, signal?: AbortSignal) => {
    const fd = new FormData()
    fd.append('requestId', requestId)
    const ext = audio.type.includes('ogg') ? 'ogg' : audio.type.includes('mp4') ? 'm4a' : 'webm'
    fd.append('audio', audio, `question.${ext}`)
    return call<{ transcript: string; durationS: number; latencyMs: number }>('/api/v1/transcribe', { method: 'POST', body: fd }, signal)
  },
}
