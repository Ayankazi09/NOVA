// Recognition + tutor controller. Every response is applied only if its echoed context still matches:
// same page, same content (region hash for readings; global contentRevision for tutor actions),
// no active pen stroke, and the latest request generation.

import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type RefObject } from 'react'
import { isEquationInX, isTinyRegion, readingText, type DocAction, type DocState } from '../notebook/doc'
import { uuid } from '../notebook/ids'
import type { Page, Reading, Rect, Region, TutorAction, TutorObject, Turn } from '../notebook/types'
import { renderRegion } from '../recognition/render'
import { RecognitionScheduler, type ReadPhase } from '../recognition/scheduler'
import { speak, stopSpeaking } from '../voice/speech'
import { ApiFailure, api, type RequestContext, type TutorPayload, type TutorResult } from './api'
import { placeBatch } from './layout'
import { getLibrary } from '../handwriting/library'
import { placeInk } from '../handwriting/place'
import { chosenOption } from './options'
import { composeExplained } from '../handwriting/explain'
import { blockBounds, composeLines, composeTable, moveBlock, placeBlock } from '../handwriting/blocks'
import { styleFromRegion } from '../handwriting/style'

export type Intent = TutorPayload['intent']

export interface TutorStatus {
  state: 'idle' | 'working' | 'error' | 'notice'
  message?: string
  anchorRegionId?: string
  retry?: () => void
  retryable?: boolean
}

interface Options {
  stateRef: RefObject<DocState>
  dispatch: Dispatch<DocAction>
  pageId: string
  assist: boolean
  autoAnswer: boolean
  speechEnabled: boolean
  background: RefObject<HTMLImageElement | null>
  penActive: RefObject<boolean>
  onCapReached: () => void
  onBatchApplied: (count: number, batchId: string) => void
}

function makeContext(page: Page, region: Region, reading?: Reading): RequestContext {
  return {
    requestId: uuid(),
    pageId: page.id,
    contentRevision: page.contentRevision,
    regionId: region.id,
    sourceHash: region.sourceHash,
    selectionRevision: page.selectionRevision,
    interpretationRevision: reading?.interpretationRevision ?? 0,
  }
}

async function waitFor(cond: () => boolean, ms = 1500) {
  const start = Date.now()
  while (!cond() && Date.now() - start < ms) await new Promise((r) => setTimeout(r, 16))
}

function sameContext(a: RequestContext, b: RequestContext) {
  return (Object.keys(a) as (keyof RequestContext)[]).every((k) => a[k] === b[k])
}

/** Is this line a working step under the problem (just below it, things moved across "="), or a new question? */
function isWorkingStep(page: Page, problemId: string, line: { bounds: Rect }, text: string): boolean {
  const pr = page.regions.find((r) => r.id === problemId)
  const ptext = readingText(page.readings[problemId])
  if (!pr || !ptext) return false
  const h = Math.max(40, pr.bounds.h)
  const below = line.bounds.y > pr.bounds.y + h * 0.5 && line.bounds.y - (pr.bounds.y + pr.bounds.h) < h * 14
  const alongside = line.bounds.x < pr.bounds.x + pr.bounds.w + 200 && line.bounds.x + line.bounds.w > pr.bounds.x - 200
  if (!below || !alongside) return false
  // "ax + b = c" written again under "ax + b = c" is a new question, not a step
  const start = /^s*-?d*.?d*s*[a-zθ]s*[+-]s*d+.?d*s*=s*-?d+.?d*s*$/i
  if (start.test(ptext) && start.test(text)) return false
  return true
}

export function useNova(o: Options) {
  const [phases, setPhases] = useState<Record<string, { phase: ReadPhase; error?: string }>>({})
  const [status, setStatus] = useState<TutorStatus>({ state: 'idle' })
  const opts = useRef(o)
  opts.current = o
  const tutorGen = useRef(0)
  const tutorAbort = useRef<AbortController | null>(null)
  const readAbort = useRef(new Set<AbortController>())
  const lastEdited = useRef<string | null>(null)
  const anchorRects = useRef(new Map<string, Rect>()) // page-level requests: where on the page the answer belongs
  const speakReplies = useRef(new Set<string>()) // requests asked by voice: answer out loud

  const page = () => opts.current.stateRef.current!.doc.pages[opts.current.pageId]

  const waitPenUp = async () => {
    while (opts.current.penActive.current) await new Promise((r) => setTimeout(r, 60))
  }

  const readRegion = useCallback(async (regionId: string) => {
    const p = page()
    const region = p?.regions.find((r) => r.id === regionId)
    if (!p || !region) return
    // a circled / ticked printed option on a question paper is the student's answer: no model needed
    const opt = chosenOption(p, region)
    if (opt) {
      opts.current.dispatch({ type: 'setReading', pageId: p.id, regionId, reading: { rawText: opt, alternatives: [], needsClarification: false, status: 'expression', state: 'accepted', acceptedText: opt, sourceHash: region.sourceHash, interpretationRevision: 1, model: 'option-circle' } })
      return
    }
    if (isTinyRegion(p, region)) {
      opts.current.dispatch({ type: 'setReading', pageId: p.id, regionId, reading: { rawText: '', alternatives: [], needsClarification: false, status: 'none', state: 'readback_ready', sourceHash: region.sourceHash, interpretationRevision: 0 } })
      return
    }
    const img = await renderRegion(p, region.sourceStrokeIds, region.bounds, p.docText ? null : opts.current.background.current) // printed paper text is not the student's writing
    const ctx = makeContext(p, region, p.readings[regionId])
    const ctl = new AbortController()
    readAbort.current.add(ctl)
    try {
      const res = await api.recognize({ context: ctx, regionPng: img.png, regionWidth: Math.round(img.crop.w), regionHeight: Math.round(img.crop.h) }, ctl.signal)
      await waitPenUp()
      if (!sameContext(res.context, ctx)) throw new ApiFailure('INVALID_MODEL_OUTPUT', 'Mismatched response.', true)
      const now = page()
      const cur = now?.regions.find((r) => r.id === regionId)
      if (!now || now.id !== ctx.pageId || !cur || cur.sourceHash !== ctx.sourceHash) return // stale: ink changed, it will be re-read
      // two independent reads agreed: accept it (the student can still Edit); disagreement asks the student
      const clear = !res.needsClarification && res.status !== 'none' && !!res.rawText
      const reading: Reading = {
        rawText: res.rawText,
        alternatives: res.alternatives,
        needsClarification: res.needsClarification,
        status: res.status,
        state: res.needsClarification ? 'needs_clarification' : clear ? 'accepted' : 'readback_ready',
        acceptedText: clear ? res.rawText : undefined,
        sourceHash: ctx.sourceHash,
        interpretationRevision: ctx.interpretationRevision + (clear ? 1 : 0),
        model: res.model,
        latencyMs: res.latencyMs,
      }
      opts.current.dispatch({ type: 'setReading', pageId: ctx.pageId, regionId, reading })
      if (clear) void react(regionId, ctx.sourceHash)
    } finally {
      readAbort.current.delete(ctl)
    }
  }, [])

  /** NOVA's own reaction to a line it just read: write the answer, or mark it ✓ / ✗ (exact maths, no model). */
  const react = useCallback(async (regionId: string, sourceHash: string, force = false): Promise<boolean> => {
    await waitFor(() => page()?.readings[regionId]?.sourceHash === sourceHash)
    const p = page()
    const region = p?.regions.find((r) => r.id === regionId)
    const text = readingText(p?.readings[regionId])
    if (!p || !region || region.sourceHash !== sourceHash || !text) return false
    if (Object.values(opts.current.stateRef.current!.doc.tests ?? {}).some((t) => t.status !== 'finished' && t.pageIds.includes(p.id))) return false // it's a test
    let problemId = p.problemRegionId && p.problemRegionId !== regionId ? p.problemRegionId : undefined
    if (problemId && !force && !isWorkingStep(p, problemId, region, text)) {
      // a fresh question (somewhere else, or in the same starting form): it is the new problem, solve it
      opts.current.dispatch({ type: 'setProblem', pageId: p.id, regionId })
      problemId = undefined
    }
    const problemText = problemId ? p.readings[problemId]?.acceptedText : undefined
    let res
    try {
      res = await api.auto({ context: makeContext(p, region, p.readings[regionId]), text, problem: force ? null : (problemText ?? null), autoAnswer: force || opts.current.autoAnswer })
    } catch {
      return false // the reading is still shown; reacting is a bonus
    }
    await waitPenUp()
    const now = page()
    const cur = now?.regions.find((r) => r.id === regionId)
    if (!now || !cur || cur.sourceHash !== sourceHash || res.kind === 'none') return false
    // (the Solve button takes any answer, mark or worked solution NOVA can give)
    const id = `auto:${regionId}:${sourceHash}`
    if (res.kind === 'solution' && res.steps?.length) {
      // the whole worked solution, one step per line, under the student's line in their style
      const style = styleFromRegion(now, cur)
      // older answers for this line are cleared below; everything else NOVA wrote is an obstacle (no overlaps)
      const others = { ...now, tutorObjects: now.tutorObjects.filter((t) => !(t.anchorRegionId === regionId && t.status !== 'active')), regions: now.regions.filter((r) => r.id !== regionId) }
      for (const t of now.tutorObjects) if (t.anchorRegionId === regionId && t.status === 'active' && t.action.type === 'write_ink' && !t.id.startsWith(id)) opts.current.dispatch({ type: 'dismissTutor', pageId: now.id, id: t.id })
      let strokes: [number, number][][]
      let colors: string[] | undefined
      let notesObj: TutorObject | undefined
      if (res.moves?.some(Boolean) || res.notes?.some((n) => n && n !== 'answer')) {
        // beginner view: what crossed "=" is red, with an arrow from where it was to where it went, and why
        const st = { ...style, height: style.height * 0.85 }
        const moves = res.steps.map((_, i) => res.moves?.[i] ?? null)
        const notes = res.steps.map((_, i) => res.notes?.[i] ?? '')
        const src = { text, bounds: cur.bounds }
        const gap = style.height * 0.6 // room for the first arrow under the student's line
        const narrow = window.innerWidth < 700 ? window.innerWidth - 90 : undefined // phone: keep the notes on screen
        const probe = composeExplained(res.steps, notes, moves, { text: '', bounds: src.bounds }, { x: 0, y: 0 }, st, getLibrary(), narrow) // size only: no arrow back to the line
        const pos = placeBlock(others, probe.bounds.w, probe.bounds.h + gap, cur.bounds, 'below')
        const out = composeExplained(res.steps, notes, moves, src, { x: pos.x, y: pos.y + gap }, st, getLibrary(), narrow)
        strokes = out.strokes
        colors = out.colors
        if (out.notes.strokes.length) {
          const nid = id + ':why'
          notesObj = {
            id: nid, requestId: id, batchId: id, anchorRegionId: regionId, sourceHash, createdAt: Date.now(), author: 'tutor', status: 'active',
            action: { id: nid, type: 'write_ink', anchorRegionId: regionId, text: notes.filter(Boolean).join(' · '), strokes: out.notes.strokes, width: Math.max(1.3, style.width * 0.5), purpose: 'completion', verified: true, tone: 'nova', colors: out.notes.colors },
            layout: { ...blockBounds({ strokes: out.notes.strokes, w: 0, h: 0 }), leader: false },
          }
        }
      } else {
        const block = composeLines('', res.steps, { ...style, height: style.height * 0.85 }, getLibrary())
        const pos = placeBlock(others, block.w, block.h, cur.bounds, 'below')
        strokes = moveBlock(block, pos.x, pos.y)
      }
      const obj: TutorObject = {
        id, requestId: id, batchId: id, anchorRegionId: regionId, sourceHash, createdAt: Date.now(), author: 'tutor', status: 'active',
        action: { id, type: 'write_ink', anchorRegionId: regionId, text: res.steps.join('\n'), strokes, width: style.width, purpose: 'completion', verified: true, tone: 'nova', colors },
        layout: { ...blockBounds({ strokes, w: 0, h: 0 }), leader: false },
        caption: res.message ?? undefined,
      }
      opts.current.dispatch({ type: 'applyTutorBatch', pageId: now.id, contentRevision: now.contentRevision, batchId: id, objects: notesObj ? [obj, notesObj] : [obj], turns: [], regionScoped: true })
      return true
    }
    const mark = res.kind === 'mark'
    const good = res.verdict === 'correct' || res.verdict === 'equivalent' || res.verdict === 'solved'
    const inkText = mark ? (good ? '✓' : '✗') : (res.answer ?? '')
    if (!inkText) return false
    const ink = placeInk(now, cur, inkText, 'after', getLibrary())
    const obj: TutorObject = {
      id, requestId: id, batchId: id, anchorRegionId: regionId, sourceHash, createdAt: Date.now(), author: 'tutor', status: 'active',
      action: { id, type: 'write_ink', anchorRegionId: regionId, text: inkText, strokes: ink.strokes, width: ink.width * (mark ? 1.15 : 1), purpose: mark ? 'mark' : 'answer', verified: true, tone: mark ? (good ? 'correct' : 'wrong') : 'nova' },
      layout: { ...ink.bounds, leader: false },
      caption: res.message ?? undefined,
    }
    opts.current.dispatch({ type: 'applyTutorBatch', pageId: now.id, contentRevision: now.contentRevision, batchId: id, objects: [obj], turns: [], regionScoped: true })
    if (mark) {
      const status = (res.verdict === 'none' ? 'unsupported' : res.verdict) as NonNullable<Reading['check']>['status']
      opts.current.dispatch({ type: 'setCheck', pageId: now.id, regionId, sourceHash, check: { status, message: res.message ?? '', againstProblemId: problemId ?? regionId, problemText: problemText ?? text } })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return true
  }, [])

  const scheduler = useMemo(
    () =>
      new RecognitionScheduler({
        run: (id) => readRegion(id),
        onPhase: (id, phase, error) =>
          setPhases((prev) => {
            const next = { ...prev }
            if (phase) next[id] = { phase, error }
            else delete next[id]
            return next
          }),
        onCapReached: () => opts.current.onCapReached(),
      }),
    [readRegion],
  )

  useEffect(() => {
    scheduler.assist = o.assist
  }, [o.assist, scheduler])

  // page switch / unmount: cancel everything; nothing older may apply or speak
  useEffect(() => {
    const aborts = readAbort.current
    return () => {
      scheduler.dispose()
      tutorGen.current++
      tutorAbort.current?.abort()
      aborts.forEach((c) => c.abort())
      stopSpeaking()
      setPhases({})
      setStatus({ state: 'idle' })
    }
  }, [o.pageId, scheduler])

  const contentChanged = useCallback(
    (regionId: string | null) => {
      if (regionId) lastEdited.current = regionId
      // any student edit invalidates in-flight tutor work for this page and stops speech
      if (tutorGen.current && status.state === 'working') setStatus({ state: 'notice', message: 'Your page changed, so NOVA stopped that answer. Ask again when ready.' })
      tutorGen.current++
      tutorAbort.current?.abort()
      stopSpeaking()
      if (regionId) scheduler.contentChanged(regionId)
    },
    [scheduler, status.state],
  )

  const readNow = useCallback(
    async (regionId: string) => {
      try {
        await scheduler.readNow(regionId)
      } catch (e) {
        if (!(e instanceof ApiFailure && e.code === 'CANCELLED')) throw e
      }
    },
    [scheduler],
  )

  /** Ensure a fresh reading exists for a region (explicit flush). */
  const ensureReading = async (regionId: string) => {
    const p = page()
    const region = p.regions.find((r) => r.id === regionId)
    if (!region) return undefined
    const r = p.readings[regionId]
    if (r && r.sourceHash === region.sourceHash) return r
    await readNow(regionId)
    // let the dispatched reading reach state before anyone decides based on it
    await waitFor(() => {
      const cur = page().regions.find((x) => x.id === regionId)
      return !cur || page().readings[regionId]?.sourceHash === cur.sourceHash
    })
    return page().readings[regionId]
  }

  const pickCurrent = (p: Page, selected: string | null): string | undefined => {
    if (selected && selected !== p.problemRegionId && p.regions.some((r) => r.id === selected)) return selected
    const work = p.regions.filter((r) => r.id !== p.problemRegionId)
    if (lastEdited.current && work.some((r) => r.id === lastEdited.current)) return lastEdited.current
    const problem = p.regions.find((r) => r.id === p.problemRegionId)
    const below = work.filter((r) => !problem || r.bounds.y > problem.bounds.y).sort((a, b) => a.bounds.y - b.bounds.y)
    return below[below.length - 1]?.id
  }

  const ask = useCallback(
    async (intent: Intent, question: string, selectedRegionId: string | null, extra?: { exam?: NonNullable<TutorPayload['exam']>; anchorRect?: Rect; speak?: boolean }) => {
      const gen = ++tutorGen.current
      tutorAbort.current?.abort()
      stopSpeaking()
      const p0 = page()
      const sel = selectedRegionId && p0.regions.some((r) => r.id === selectedRegionId) ? selectedRegionId : null
      setStatus({ state: 'working', anchorRegionId: sel ?? p0.problemRegionId, message: 'Reading your work…' })
      const fail = (e: unknown, anchorRegionId?: string) => {
        if (gen !== tutorGen.current) return
        const f = e instanceof ApiFailure ? e : new ApiFailure('READ_FAILED', 'Could not read the page.', true)
        setStatus({ state: 'error', message: f.message, retryable: f.retryable, retry: () => void ask(intent, question, selectedRegionId), anchorRegionId })
      }
      try {
        if (sel) await ensureReading(sel)
      } catch (e) {
        return fail(e, sel ?? undefined)
      }
      if (gen !== tutorGen.current) return
      // decide which lines the request is about
      const p1 = page()
      const selText = sel ? readingText(p1.readings[sel]) : undefined
      let problemId: string | undefined
      let currentId: string | undefined
      if ((intent === 'ask' && !sel) || extra?.exam) {
        // a typed/spoken question with nothing selected is about the page or maths in general
      } else if (intent === 'plot' || intent === 'solve') {
        currentId = sel ?? pickCurrent(p1, null)
      } else if (sel && (sel === p1.problemRegionId || (selText && !isEquationInX(selText)))) {
        problemId = sel // the problem itself, or a stand-alone line (arithmetic, graph equation)
      } else {
        problemId = p1.problemRegionId ?? sel ?? undefined
        currentId = pickCurrent(p1, sel)
        if (currentId === problemId) currentId = undefined
        if (!sel && currentId && !problemId) {
          problemId = currentId
          currentId = undefined
        }
      }
      const anchorId = currentId ?? problemId
      if (!anchorId && !question.trim()) {
        setStatus({ state: 'notice', message: 'Write something first, or select a line, then ask.' })
        return
      }
      setStatus({ state: 'working', anchorRegionId: anchorId, message: 'Reading your work…' })
      try {
        if (problemId) await ensureReading(problemId)
        if (currentId) await ensureReading(currentId)
      } catch (e) {
        return fail(e, anchorId)
      }
      if (gen !== tutorGen.current) return
      const needsAccept = intent === 'check' || intent === 'complete' || intent === 'plot' || intent === 'solve'
      for (const id of [problemId, currentId]) {
        if (!id) continue
        const r = page().readings[id]
        if (!r || r.status === 'none') {
          setStatus({ state: 'notice', message: 'NOVA could not find maths in that line. Rewrite it, or tap Edit under it to type it.', anchorRegionId: id })
          return
        }
        if (r.state === 'needs_clarification') {
          setStatus({ state: 'notice', message: 'Pick what you wrote from the choices under the line first.', anchorRegionId: id })
          return
        }
        if (needsAccept && r.state !== 'accepted') {
          // an explicit Check / Next step / Graph confirms the displayed (clear) reading
          opts.current.dispatch({ type: 'acceptReading', pageId: opts.current.pageId, regionId: id, text: r.rawText })
          await waitFor(() => page().readings[id]?.state === 'accepted')
        }
      }
      if (gen !== tutorGen.current) return
      const p = page()
      const pr = problemId ? p.readings[problemId] : undefined
      const cr = currentId ? p.readings[currentId] : undefined
      const anchor = anchorId ? p.regions.find((r) => r.id === anchorId) : undefined
      const ctx: RequestContext = anchor
        ? makeContext(p, anchor, cr ?? pr)
        : { requestId: uuid(), pageId: p.id, contentRevision: p.contentRevision, regionId: 'page', sourceHash: `rev${p.contentRevision}`, selectionRevision: p.selectionRevision, interpretationRevision: 0 }
      const history = p.history
        .filter((t) => t.problemId === problemId)
        .slice(-6)
        .map((t) => ({ role: t.role, text: t.text.slice(0, 600) }))
      const payload: TutorPayload = {
        context: ctx,
        intent,
        question: question.slice(0, 1200),
        problem: problemId && pr ? { regionId: problemId, text: readingText(pr)!.slice(0, 160), accepted: pr.state === 'accepted' } : null,
        current: currentId && cr ? { regionId: currentId, text: readingText(cr)!.slice(0, 160), accepted: cr.state === 'accepted' } : null,
        history,
        plotExpression: intent === 'plot' && cr ? readingText(cr)!.slice(0, 200) : null,
        exam: extra?.exam ?? null,
        regionIds: p.regions.map((r) => r.id).slice(0, 20),
        pageLines: [...p.regions]
          .sort((a, b) => a.bounds.y - b.bounds.y || a.bounds.x - b.bounds.x)
          .map((r) => ({ regionId: r.id, text: (readingText(p.readings[r.id]) ?? '').slice(0, 160), accepted: p.readings[r.id]?.state === 'accepted' }))
          .filter((l) => l.text)
          .slice(0, 30),
      }
      const interp = { p: pr?.interpretationRevision, c: cr?.interpretationRevision }
      if (extra?.anchorRect) anchorRects.current.set(ctx.requestId, extra.anchorRect)
      if (extra?.speak) speakReplies.current.add(ctx.requestId)
      await send(payload, gen, interp, problemId)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  const send = async (payload: TutorPayload, gen: number, interp: { p?: number; c?: number }, problemId?: string) => {
    const ctl = new AbortController()
    tutorAbort.current = ctl
    setStatus({ state: 'working', anchorRegionId: payload.context.regionId, message: 'NOVA is thinking…' })
    let res: TutorResult
    try {
      res = await api.tutor(payload, ctl.signal)
    } catch (e) {
      if (gen !== tutorGen.current) return
      const f = e instanceof ApiFailure ? e : new ApiFailure('UNKNOWN', 'Something went wrong.', true)
      if (f.code === 'CANCELLED') return
      // retry re-sends the SAME requestId + payload: the server joins/reuses and the client dedupes action ids
      setStatus({ state: f.retryable ? 'error' : 'notice', message: f.message, retryable: f.retryable, retry: f.retryable ? () => void send(payload, (tutorGen.current = tutorGen.current + 1), interp, problemId) : undefined, anchorRegionId: payload.context.regionId })
      return
    }
    await waitPenUp()
    const p = page()
    const ctx = payload.context
    const stale =
      gen !== tutorGen.current ||
      !p ||
      p.id !== ctx.pageId ||
      !sameContext(res.context, ctx) ||
      p.contentRevision !== ctx.contentRevision ||
      (payload.problem && p.readings[payload.problem.regionId]?.interpretationRevision !== interp.p) ||
      (payload.current && p.readings[payload.current.regionId]?.interpretationRevision !== interp.c)
    if (stale) {
      if (gen === tutorGen.current) setStatus({ state: 'notice', message: 'Your page changed while NOVA was answering, so that answer was discarded. Ask again.' })
      return
    }
    apply(p, payload, res, problemId)
    setStatus({ state: 'idle' })
  }

  const apply = (p: Page, payload: TutorPayload, res: TutorResult, problemId?: string) => {
    const ctx = payload.context
    // in exam mode NOVA circles the question itself; the model's own highlights would point at the wrong lines
    const actions: TutorAction[] = payload.exam ? res.actions.filter((a) => a.type !== 'highlight_region') : [...res.actions]
    const hasNote = actions.some((a) => a.type === 'add_note' || a.type === 'speak')
    // the explanation rides on the main visual (graph / equation) as its caption; otherwise it becomes a note
    const visual = actions.find((a) => a.type === 'write_equation' || a.type === 'plot_function')
    const pageLevel = ctx.regionId === 'page'
    if (res.explanation && !hasNote && !visual && !pageLevel && !actions.some((a) => a.type === 'write_lines' || a.type === 'write_table')) actions.unshift({ id: `${ctx.requestId}:x`, type: 'add_note', anchorRegionId: ctx.regionId, text: res.explanation })
    const existing = new Set(p.tutorObjects.map((t) => t.id))
    const fresh = actions.filter((a, i) => !existing.has(a.id) && actions.findIndex((b) => b.id === a.id) === i)
    const regionById = new Map(p.regions.map((r) => [r.id, r]))
    // verified completions (Next step / Solve) are written in handwriting instead of a typed card
    const inked = new Map<string, ReturnType<typeof placeInk>>()
    for (let k = 0; k < fresh.length; k++) {
      const a = fresh[k]
      if (a.type !== 'write_equation' || a.purpose !== 'completion' || !a.verified) continue
      const region = regionById.get(a.anchorRegionId) ?? regionById.get(ctx.regionId)
      if (!region) continue
      const lineText = readingText(p.readings[region.id])?.trim() ?? ''
      const finishing = lineText.endsWith('=') && a.expression.replace(/\s+/g, '').startsWith(lineText.replace(/\s+/g, ''))
      const text = finishing ? a.expression.slice(a.expression.lastIndexOf('=') + 1).trim() : a.expression
      const ink = placeInk(p, region, text, finishing ? 'after' : 'below', getLibrary())
      fresh[k] = { id: a.id, type: 'write_ink', anchorRegionId: region.id, text, strokes: ink.strokes, width: ink.width, purpose: 'completion', verified: true, tone: 'nova' }
      inked.set(a.id, ink)
    }
    const lastRegion = [...p.regions].sort((a, b) => b.createdAt - a.createdAt)[0]
    const baseStyle = lastRegion ? styleFromRegion(p, lastRegion) : { height: 40, slant: 0.08, width: 3.2, seed: 5 }
    const contentStyle = { ...baseStyle, height: Math.max(24, Math.min(36, baseStyle.height * 0.58)), width: Math.max(2.2, baseStyle.width * 0.8) }
    const pending = { ...p, tutorObjects: [...p.tutorObjects] }
    const replaced: string[] = []
    for (let k = 0; k < fresh.length; k++) {
      const a = fresh[k]
      if (a.type !== 'write_lines' && a.type !== 'write_table') continue
      const block = a.type === 'write_table'
        ? composeTable(a.title, a.header, a.rows, { ...contentStyle, seed: contentStyle.seed + k }, getLibrary())
        : composeLines(a.title, a.lines, { ...contentStyle, seed: contentStyle.seed + k }, getLibrary(), a.inks)
      const near = a.anchorRegionId !== 'page' ? regionById.get(a.anchorRegionId)?.bounds : anchorRects.current.get(ctx.requestId)
      let at = placeBlock(pending, block.w, block.h, near)
      if (a.type === 'write_table') {
        const old = [...pending.tutorObjects].reverse().find((t) => t.status === 'active' && t.action.type === 'write_ink' && t.action.purpose === 'content' && t.action.text.includes(' | '))
        if (old) {
          replaced.push(old.id)
          pending.tutorObjects = pending.tutorObjects.filter((t) => t.id !== old.id)
          // same spot as the table it replaces (its "right of" candidate is exactly the old top-left corner)
          at = placeBlock(pending, block.w, block.h, { x: old.layout.x - 60, y: old.layout.y, w: 0, h: 0 })
        }
      }
      const strokes = moveBlock(block, at.x, at.y)
      const bounds = blockBounds({ strokes, w: block.w, h: block.h })
      const text = a.type === 'write_table' ? [a.header.join(' | '), ...a.rows.map((r) => r.join(' | '))].join('\n') : a.lines.join('\n')
      fresh[k] = { id: a.id, type: 'write_ink', anchorRegionId: 'page', text, strokes, width: contentStyle.width, purpose: 'content', verified: a.type === 'write_table' ? a.unverifiedCells === 0 : a.verified.every(Boolean), tone: 'nova', colors: block.colors }
      inked.set(a.id, { strokes, width: contentStyle.width, bounds })
      pending.tutorObjects.push({ id: a.id, layout: { ...bounds, leader: false }, status: 'active', action: fresh[k] } as TutorObject)
    }
    const pageAnchor = anchorRects.current.get(ctx.requestId)
    const layout = placeBatch(pending, fresh.filter((a) => !inked.has(a.id)), (id) => regionById.get(id)?.bounds ?? (id === 'page' ? pageAnchor : undefined))
    for (const [id, ink] of inked) layout.set(id, { ...ink.bounds, leader: false })
    const objects: TutorObject[] = fresh.map((a) => {
      const anchorId = regionById.has(a.anchorRegionId) || a.anchorRegionId === 'page' ? a.anchorRegionId : ctx.regionId
      return {
        id: a.id,
        requestId: ctx.requestId,
        batchId: ctx.requestId,
        anchorRegionId: anchorId,
        sourceHash: regionById.get(anchorId)?.sourceHash ?? ctx.sourceHash,
        createdAt: Date.now(),
        author: 'tutor',
        status: 'active',
        action: { ...a, anchorRegionId: anchorId } as TutorAction,
        caption: a === visual && !hasNote && a.type !== 'plot_function' ? res.explanation.slice(0, 400) : undefined,
        layout: layout.get(a.id) ?? { x: 40, y: 40, w: 300, h: 80, leader: false },
      }
    })
    const turns: Turn[] = []
    const now = Date.now()
    turns.push({ role: 'student', text: payload.question || intentLabel(payload.intent), at: now, problemId })
    turns.push({ role: 'tutor', text: res.explanation, at: now, problemId })
    const assisted = payload.intent !== 'check' && payload.intent !== 'plot'
    for (const id of replaced) opts.current.dispatch({ type: 'dismissTutor', pageId: p.id, id })
    // make sure the endless sheet covers whatever NOVA just wrote, so it can be scrolled to
    const farX = Math.max(0, ...objects.map((o) => o.layout.x + o.layout.w)), farY = Math.max(0, ...objects.map((o) => o.layout.y + o.layout.h))
    if (farX > p.width - 200 || farY > p.height - 200) opts.current.dispatch({ type: 'ensureSize', pageId: p.id, width: Math.ceil((farX + 400) / 400) * 400, height: Math.ceil((farY + 400) / 400) * 400 })
    opts.current.dispatch({ type: 'applyTutorBatch', pageId: p.id, contentRevision: ctx.contentRevision, batchId: ctx.requestId, objects, turns, assistanceFor: assisted && problemId ? problemId : undefined })
    // remember the deterministic verdict on the line it is about (a step, or a stand-alone line checked against itself)
    const checked = payload.current ?? payload.problem
    const against = payload.current ? payload.problem : payload.problem
    if (res.check && checked && against && checked.accepted && against.accepted && res.check.status !== 'needs_clarification') {
      const cur = p.regions.find((r) => r.id === checked.regionId)
      if (cur) {
        opts.current.dispatch({
          type: 'setCheck',
          pageId: p.id,
          regionId: cur.id,
          sourceHash: cur.sourceHash,
          check: { status: res.check.status, message: res.check.message, problemSolution: res.check.problemSolution, currentSolution: res.check.currentSolution, againstProblemId: against.regionId, problemText: against.text },
        })
        if (problemId && payload.current) opts.current.dispatch({ type: 'recordStep', pageId: p.id, problemId, regionId: cur.id, text: checked.text, status: res.check.status })
      }
    }
    if (objects.length) opts.current.onBatchApplied(objects.length, ctx.requestId)
    if (opts.current.speechEnabled || speakReplies.current.delete(ctx.requestId)) {
      const sp = actions.find((a) => a.type === 'speak') as Extract<TutorAction, { type: 'speak' }> | undefined
      speak(sp?.text ?? res.explanation, ctx.requestId)
    }
  }

  const cancel = useCallback(() => {
    tutorGen.current++
    tutorAbort.current?.abort()
    stopSpeaking()
    setStatus({ state: 'idle' })
  }, [])

  /** The Solve button: a linear equation gets the explained solution (arrows, red moves, notes); anything else goes to the tutor. */
  /** One tap on Solve does everything: read the line if needed, graph a graph, otherwise write the worked answer. */
  const solveHere = useCallback(async (regionId: string) => {
    setStatus({ state: 'working', anchorRegionId: regionId, message: 'Solving…' })
    try {
      let p = page()
      if (!readingText(p?.readings[regionId])) {
        await ensureReading(regionId) // not read yet: read it now instead of making the student tap twice
        p = page()
      }
      const region = p?.regions.find((r) => r.id === regionId)
      const text = readingText(p?.readings[regionId]) ?? ''
      if (/[yY]/.test(text) && /[xXθ]/.test(text) && /=/.test(text) && !/[∪∩∈]/.test(text)) {
        setStatus({ state: 'idle' })
        return void ask('plot', '', regionId)
      }
      if (region && text && (await react(regionId, region.sourceHash, true))) {
        setStatus({ state: 'idle' })
        return
      }
    } catch {
      /* fall through to the tutor */
    }
    setStatus({ state: 'idle' })
    await ask('solve', '', regionId)
  }, [react, ask])

  return { phases, status, setStatus, ask, readNow, contentChanged, cancel, scheduler, solveHere }
}

export function intentLabel(intent: Intent): string {
  return { ask: 'Question', hint: 'Give me a hint', explain: 'Explain this', check: 'Check my step', complete: 'Show the next step', plot: 'Graph this line', solve: 'Solve this' }[intent]
}
