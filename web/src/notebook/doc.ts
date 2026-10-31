// Pure document reducer. Student and tutor commands have separate undo histories.
// Every student-content change increments contentRevision (monotonic, also on undo/redo)
// and invalidates readings, checks and tutor objects derived from the changed region.

import { hashString, strokeBounds, union } from './geometry'
import { shortId } from './ids'
import type { CheckResult, Notebook, NotebookDoc, Page, Paper, PaperQuestion, PaperTest, Reading, Rect, Region, Stroke, TutorObject, Turn } from './types'
import { SCHEMA_VERSION } from './types'

export const PAGE_W = 1200
export const PAGE_H = 1600
const UNDO_LIMIT = 100
const HISTORY_LIMIT = 40

interface Snapshot {
  strokes: Stroke[]
  regions: Region[]
}

export interface DocState {
  doc: NotebookDoc
  undo: Record<string, Snapshot[]>
  redo: Record<string, Snapshot[]>
  tutorUndo: Record<string, string[]> // batch ids
  tutorRedo: Record<string, string[]>
  dirty: number // bumps on every persisted change
}

export type DocAction =
  | { type: 'load'; doc: NotebookDoc }
  | { type: 'addStroke'; pageId: string; stroke: Stroke; newRegionId: string }
  | { type: 'eraseStrokes'; pageId: string; ids: string[] }
  | { type: 'undo'; pageId: string }
  | { type: 'redo'; pageId: string }
  | { type: 'selectRegion'; pageId: string; strokeIds: string[]; regionId: string }
  | { type: 'setReading'; pageId: string; regionId: string; reading: Reading }
  | { type: 'acceptReading'; pageId: string; regionId: string; text: string }
  | { type: 'setCheck'; pageId: string; regionId: string; sourceHash: string; check: CheckResult }
  | { type: 'setProblem'; pageId: string; regionId: string | undefined }
  | { type: 'applyTutorBatch'; pageId: string; contentRevision: number; batchId: string; objects: TutorObject[]; turns: Turn[]; assistanceFor?: string; regionScoped?: boolean }
  | { type: 'addTurns'; pageId: string; turns: Turn[] }
  | { type: 'undoTutor'; pageId: string }
  | { type: 'redoTutor'; pageId: string }
  | { type: 'dismissTutor'; pageId: string; id: string }
  | { type: 'addPage'; page: Page; after?: string }
  | { type: 'deletePage'; pageId: string }
  | { type: 'renamePage'; pageId: string; title: string }
  | { type: 'setPaper'; pageId: string; paper: Paper }
  | { type: 'setLastPage'; pageId: string }
  | { type: 'renameNotebook'; title: string }
  | { type: 'recordStep'; pageId: string; problemId: string; regionId: string; text: string; status: string }
  | { type: 'setTest'; test: PaperTest }
  | { type: 'ensureSize'; pageId: string; width: number; height: number }
  | { type: 'patchQuestion'; testId: string; questionId: string; patch: Partial<PaperQuestion> }

export function newPage(notebookId: string, title: string, opts: Partial<Page> = {}): Page {
  return {
    id: shortId('pg'),
    notebookId,
    title,
    width: PAGE_W,
    height: PAGE_H,
    paper: 'squared',
    contentRevision: 0,
    selectionRevision: 0,
    strokes: [],
    regions: [],
    readings: {},
    tutorObjects: [],
    attempts: [],
    history: [],
    ...opts,
  }
}

export function newNotebook(title: string): NotebookDoc {
  const now = Date.now()
  const nb: Notebook = { id: shortId('nb'), title, schemaVersion: SCHEMA_VERSION, createdAt: now, updatedAt: now, orderedPageIds: [] }
  const page = newPage(nb.id, 'Page 1')
  nb.orderedPageIds.push(page.id)
  nb.lastPageId = page.id
  return { schemaVersion: SCHEMA_VERSION, notebook: nb, pages: { [page.id]: page } }
}

export function initialState(doc: NotebookDoc): DocState {
  return { doc, undo: {}, redo: {}, tutorUndo: {}, tutorRedo: {}, dirty: 0 }
}

// ------------------------------------------------------------- regions

export function regionHash(page: Page, region: Pick<Region, 'sourceStrokeIds' | 'bounds'>): string {
  const ids = new Set(region.sourceStrokeIds)
  const strokes = page.strokes
    .filter((s) => ids.has(s.id))
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map((s) => [s.id, s.width, s.points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(';')])
  const b = region.bounds
  const crop = [b.x, b.y, b.w, b.h].map((v) => Math.round(v))
  return hashString(JSON.stringify({ strokes, crop, bg: page.backgroundAssetId ?? null }))
}

function regionFromStrokes(page: Page, id: string, strokeIds: string[], origin: Region['origin'], createdAt = Date.now()): Region {
  const set = new Set(strokeIds)
  const bounds = union(page.strokes.filter((s) => set.has(s.id)).map(strokeBounds))
  const r: Region = { id, bounds, sourceStrokeIds: strokeIds, sourceHash: '', origin, createdAt }
  r.sourceHash = regionHash(page, r)
  return r
}

/** Very large single strokes (scribbles, arrows, drawings) are never merged into a line of writing. */
export function isLargeStroke(b: Rect): boolean {
  return b.h > 320 || b.w > 720
}

const lineHeight = (r: Region) => Math.max(40, Math.min(r.bounds.h, 220))

function hGapBetween(a: Rect, b: Rect) {
  return Math.max(0, Math.max(a.x - (b.x + b.w), b.x - (a.x + a.w)))
}

function vOverlapBetween(a: Rect, b: Rect) {
  return Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
}

/**
 * Choose the line-region a new stroke belongs to.
 * 1. Continuity: a stroke written within 2.5 s of the previous one, close to it, continues that line.
 * 2. Otherwise: horizontally near and vertically overlapping a band scaled to the line's height
 *    (so raised '=' signs, powers and descenders join their line).
 */
export function findRegionFor(page: Page, stroke: Stroke): Region | undefined {
  const b = strokeBounds(stroke)
  if (isLargeStroke(b)) return undefined
  const last = page.strokes[page.strokes.length - 1]
  if (last && stroke.createdAt - last.createdAt < 2500) {
    const lastRegion = page.regions.find((r) => r.sourceStrokeIds.includes(last.id))
    if (lastRegion && !isLargeStroke(lastRegion.bounds)) {
      const h = lineHeight(lastRegion)
      const zone = { x: lastRegion.bounds.x - 1.2 * h, y: lastRegion.bounds.y - 0.6 * h, w: lastRegion.bounds.w + 2.4 * h, h: lastRegion.bounds.h + 1.2 * h }
      const cx = b.x + b.w / 2, cy = b.y + b.h / 2
      if (cx >= zone.x && cx <= zone.x + zone.w && cy >= zone.y && cy <= zone.y + zone.h) return lastRegion
    }
  }
  let best: Region | undefined
  let bestScore = 0
  for (const r of page.regions) {
    if (isLargeStroke(r.bounds)) continue
    const h = lineHeight(r)
    const pad = Math.max(14, Math.min(60, 0.4 * h))
    const band = { x: r.bounds.x, y: r.bounds.y - pad, w: r.bounds.w, h: r.bounds.h + 2 * pad }
    const vOverlap = vOverlapBetween(b, band)
    if (vOverlap <= 0) continue
    const hGap = hGapBetween(r.bounds, b)
    if (hGap > Math.max(160, 1.6 * h)) continue
    const score = vOverlap / Math.max(1, Math.min(b.h, band.h)) - hGap / 1000
    if (score > bestScore) {
      bestScore = score
      best = r
    }
  }
  return bestScore >= 0.2 ? best : undefined
}

/** After a line grows, absorb other automatic fragments that now sit on the same line. */
function mergeFragments(page: Page, hostId: string): Region[] {
  let regions = page.regions
  for (let pass = 0; pass < 3; pass++) {
    const host = regions.find((r) => r.id === hostId)
    if (!host) return regions
    const hb = union(page.strokes.filter((s) => host.sourceStrokeIds.includes(s.id)).map(strokeBounds))
    if (isLargeStroke(hb)) return regions
    const h = Math.max(40, Math.min(hb.h, 220))
    const victim = regions.find((r) => {
      if (r.id === hostId || r.origin !== 'auto' || isLargeStroke(r.bounds)) return false
      const ov = vOverlapBetween(hb, r.bounds)
      return ov > 0.5 * Math.min(hb.h, Math.max(1, r.bounds.h)) && hGapBetween(hb, r.bounds) < Math.max(120, 1.2 * h)
    })
    if (!victim) return regions
    regions = regions.filter((r) => r.id !== victim.id).map((r) => (r.id === hostId ? { ...r, sourceStrokeIds: [...r.sourceStrokeIds, ...victim.sourceStrokeIds] } : r))
  }
  return regions
}

/** Dots, specks and tiny ticks: not worth sending for reading. */
export function isTinyRegion(page: Page, r: Region): boolean {
  if (Math.max(r.bounds.w, r.bounds.h) < 18) return true
  const ids = new Set(r.sourceStrokeIds)
  let length = 0
  for (const s of page.strokes) {
    if (!ids.has(s.id)) continue
    for (let i = 1; i < s.points.length; i++) length += Math.hypot(s.points[i].x - s.points[i - 1].x, s.points[i].y - s.points[i - 1].y)
  }
  return length < 24
}

/** Recompute region geometry and drop everything derived from content that changed. */
function reconcile(page: Page): Page {
  const strokeIds = new Set(page.strokes.map((s) => s.id))
  const regions: Region[] = []
  for (const r of page.regions) {
    const ids = r.sourceStrokeIds.filter((id) => strokeIds.has(id))
    if (!ids.length) continue
    regions.push(regionFromStrokes(page, r.id, ids, r.origin, r.createdAt))
  }
  const byId = new Map(regions.map((r) => [r.id, r]))
  const readings: Record<string, Reading> = {}
  for (const [rid, reading] of Object.entries(page.readings)) {
    const r = byId.get(rid)
    if (r && r.sourceHash === reading.sourceHash) readings[rid] = reading
  }
  // a check is only valid while the problem reading it was made against is unchanged
  for (const [rid, reading] of Object.entries(readings)) {
    if (!reading.check) continue
    const pr = readings[reading.check.againstProblemId]
    const ptext = pr?.acceptedText
    if (!ptext || ptext !== reading.check.problemText) readings[rid] = { ...reading, check: undefined }
  }
  const tutorObjects = page.tutorObjects.map((t) => {
    if (t.status !== 'active' || t.anchorRegionId === 'page') return t // page-level content is not tied to one line
    const r = byId.get(t.anchorRegionId)
    return !r || r.sourceHash !== t.sourceHash ? { ...t, status: 'stale' as const } : t
  })
  const problemRegionId = page.problemRegionId && byId.has(page.problemRegionId) ? page.problemRegionId : undefined
  return { ...page, regions, readings, tutorObjects, problemRegionId }
}

// ------------------------------------------------------------- reducer

function touch(state: DocState, pageId: string, page: Page, extra: Partial<DocState> = {}): DocState {
  const nb = { ...state.doc.notebook, updatedAt: Date.now() }
  return { ...state, ...extra, doc: { ...state.doc, notebook: nb, pages: { ...state.doc.pages, [pageId]: page } }, dirty: state.dirty + 1 }
}

function pushUndo(state: DocState, pageId: string, page: Page) {
  const stack = [...(state.undo[pageId] ?? []), { strokes: page.strokes, regions: page.regions }].slice(-UNDO_LIMIT)
  return { undo: { ...state.undo, [pageId]: stack }, redo: { ...state.redo, [pageId]: [] } }
}

function contentChange(state: DocState, pageId: string, mutate: (p: Page) => Page, recordUndo = true): DocState {
  const page = state.doc.pages[pageId]
  if (!page) return state
  const next = reconcile({ ...mutate(page), contentRevision: page.contentRevision + 1 })
  return touch(state, pageId, next, recordUndo ? pushUndo(state, pageId, page) : {})
}

export function docReducer(state: DocState, action: DocAction): DocState {
  switch (action.type) {
    case 'load':
      return initialState(action.doc)

    case 'addStroke': {
      const page = state.doc.pages[action.pageId]
      if (!page) return state
      return contentChange(state, action.pageId, (p) => {
        const strokes = [...p.strokes, action.stroke]
        const host = findRegionFor(p, action.stroke)
        let regions = host
          ? p.regions.map((r) => (r.id === host.id ? { ...r, sourceStrokeIds: [...r.sourceStrokeIds, action.stroke.id] } : r))
          : [...p.regions, { id: action.newRegionId, bounds: strokeBounds(action.stroke), sourceStrokeIds: [action.stroke.id], sourceHash: '', origin: 'auto' as const, createdAt: Date.now() }]
        regions = mergeFragments({ ...p, strokes, regions }, host?.id ?? action.newRegionId)
        // paper expands to fit the document
        const b = strokeBounds(action.stroke)
        const grow = (edge: number, size: number, step: number) => (edge > size - 400 ? Math.ceil((edge + 800) / step) * step : size)
        const height = grow(b.y + b.h, p.height, 400)
        const width = grow(b.x + b.w, p.width, 400)
        return { ...p, strokes, regions, height, width }
      })
    }

    case 'eraseStrokes': {
      const ids = new Set(action.ids)
      const page = state.doc.pages[action.pageId]
      if (!page || !page.strokes.some((s) => ids.has(s.id))) return state
      return contentChange(state, action.pageId, (p) => ({ ...p, strokes: p.strokes.filter((s) => !ids.has(s.id)) }))
    }

    case 'undo':
    case 'redo': {
      const page = state.doc.pages[action.pageId]
      const from = action.type === 'undo' ? state.undo : state.redo
      const to = action.type === 'undo' ? state.redo : state.undo
      const stack = from[action.pageId] ?? []
      if (!page || !stack.length) return state
      const snap = stack[stack.length - 1]
      const next = reconcile({ ...page, strokes: snap.strokes, regions: snap.regions, contentRevision: page.contentRevision + 1 })
      const fromNext = { ...from, [action.pageId]: stack.slice(0, -1) }
      const toNext = { ...to, [action.pageId]: [...(to[action.pageId] ?? []), { strokes: page.strokes, regions: page.regions }] }
      return touch(state, action.pageId, next, action.type === 'undo' ? { undo: fromNext, redo: toNext } : { redo: fromNext, undo: toNext })
    }

    case 'selectRegion': {
      const page = state.doc.pages[action.pageId]
      if (!page || !action.strokeIds.length) return state
      const chosen = new Set(action.strokeIds)
      // exact match with an existing region: just select it, nothing changes
      const same = page.regions.find((r) => r.sourceStrokeIds.length === chosen.size && r.sourceStrokeIds.every((id) => chosen.has(id)))
      if (same) return state
      const regions = page.regions
        .map((r) => ({ ...r, sourceStrokeIds: r.sourceStrokeIds.filter((id) => !chosen.has(id)) }))
        .filter((r) => r.sourceStrokeIds.length)
      regions.push({ id: action.regionId, bounds: { x: 0, y: 0, w: 0, h: 0 }, sourceStrokeIds: action.strokeIds, sourceHash: '', origin: 'explicit', createdAt: Date.now() })
      const next = reconcile({ ...page, regions, selectionRevision: page.selectionRevision + 1 })
      return touch(state, action.pageId, next, pushUndo(state, action.pageId, page))
    }

    case 'setReading': {
      const page = state.doc.pages[action.pageId]
      const region = page?.regions.find((r) => r.id === action.regionId)
      if (!page || !region || region.sourceHash !== action.reading.sourceHash) return state // stale response
      const readings = { ...page.readings, [action.regionId]: action.reading }
      let problemRegionId = page.problemRegionId
      if (!problemRegionId && action.reading.status !== 'none' && !page.docText) problemRegionId = topmostReadRegion(page, readings) // question papers already define the problems
      return touch(state, action.pageId, { ...page, readings, problemRegionId })
    }

    case 'acceptReading': {
      const page = state.doc.pages[action.pageId]
      const prev = page?.readings[action.regionId]
      const region = page?.regions.find((r) => r.id === action.regionId)
      if (!page || !region) return state
      const text = action.text.trim().slice(0, 160)
      if (!text) return state
      const base: Reading = prev ?? { rawText: '', alternatives: [], needsClarification: false, status: 'expression', state: 'accepted', sourceHash: region.sourceHash, interpretationRevision: 0 }
      const reading: Reading = { ...base, acceptedText: text, state: 'accepted', needsClarification: false, interpretationRevision: base.interpretationRevision + 1, check: undefined }
      const next = reconcile({ ...page, readings: { ...page.readings, [action.regionId]: reading } })
      // a changed problem reading invalidates checks against it (reconcile handles); also tutor objects anchored to it
      const tutorObjects = next.tutorObjects.map((t) => (t.status === 'active' && t.anchorRegionId === action.regionId && prev?.acceptedText !== text ? { ...t, status: 'stale' as const } : t))
      const problemRegionId = next.problemRegionId ?? (isEquationInX(text) ? action.regionId : undefined)
      return touch(state, action.pageId, { ...next, tutorObjects, problemRegionId })
    }

    case 'setCheck': {
      const page = state.doc.pages[action.pageId]
      const reading = page?.readings[action.regionId]
      if (!page || !reading || reading.sourceHash !== action.sourceHash || reading.state !== 'accepted') return state
      return touch(state, action.pageId, { ...page, readings: { ...page.readings, [action.regionId]: { ...reading, check: action.check } } })
    }

    case 'setProblem': {
      const page = state.doc.pages[action.pageId]
      if (!page) return state
      const readings = Object.fromEntries(Object.entries(page.readings).map(([k, r]) => [k, r.check ? { ...r, check: undefined } : r]))
      return touch(state, action.pageId, { ...page, problemRegionId: action.regionId, readings, selectionRevision: page.selectionRevision + 1 })
    }

    case 'applyTutorBatch': {
      const page = state.doc.pages[action.pageId]
      if (!page) return state
      if (action.regionScoped) {
        // auto-answers depend only on their own line: apply while that line is unchanged
        const ok = action.objects.every((o) => o.anchorRegionId === 'page' || page.regions.find((r) => r.id === o.anchorRegionId)?.sourceHash === o.sourceHash)
        if (!ok) return state
      } else if (page.contentRevision !== action.contentRevision) return state // conservative: never apply to changed content
      const existing = new Set(page.tutorObjects.map((t) => t.id))
      const fresh = action.objects.filter((o) => !existing.has(o.id))
      // outdated notes about the same lines are superseded by the new answer
      const anchors = new Set(fresh.map((o) => o.anchorRegionId))
      const retired = page.tutorObjects.map((t) => (t.status === 'stale' && anchors.has(t.anchorRegionId) ? { ...t, status: 'dismissed' as const } : t))
      let attempts = page.attempts
      if (action.assistanceFor) attempts = markAssistance(page, action.assistanceFor)
      const history = [...page.history, ...action.turns].slice(-HISTORY_LIMIT)
      const next = { ...page, tutorObjects: [...retired, ...fresh], history, attempts }
      const extra = fresh.length
        ? { tutorUndo: { ...state.tutorUndo, [action.pageId]: [...(state.tutorUndo[action.pageId] ?? []), action.batchId] }, tutorRedo: { ...state.tutorRedo, [action.pageId]: [] } }
        : {}
      return touch(state, action.pageId, next, extra)
    }

    case 'addTurns': {
      const page = state.doc.pages[action.pageId]
      if (!page) return state
      return touch(state, action.pageId, { ...page, history: [...page.history, ...action.turns].slice(-HISTORY_LIMIT) })
    }

    case 'undoTutor':
    case 'redoTutor': {
      const page = state.doc.pages[action.pageId]
      const fromKey = action.type === 'undoTutor' ? 'tutorUndo' : 'tutorRedo'
      const toKey = action.type === 'undoTutor' ? 'tutorRedo' : 'tutorUndo'
      const stack = state[fromKey][action.pageId] ?? []
      if (!page || !stack.length) return state
      const batch = stack[stack.length - 1]
      const byRegion = new Map(page.regions.map((r) => [r.id, r]))
      const tutorObjects = page.tutorObjects.map((t) => {
        if (t.batchId !== batch) return t
        if (action.type === 'undoTutor') return { ...t, status: 'dismissed' as const }
        const r = byRegion.get(t.anchorRegionId)
        return { ...t, status: r && r.sourceHash === t.sourceHash ? ('active' as const) : ('stale' as const) }
      })
      return touch(state, action.pageId, { ...page, tutorObjects }, {
        [fromKey]: { ...state[fromKey], [action.pageId]: stack.slice(0, -1) },
        [toKey]: { ...state[toKey], [action.pageId]: [...(state[toKey][action.pageId] ?? []), batch] },
      } as Partial<DocState>)
    }

    case 'dismissTutor': {
      const page = state.doc.pages[action.pageId]
      if (!page) return state
      return touch(state, action.pageId, { ...page, tutorObjects: page.tutorObjects.map((t) => (t.id === action.id ? { ...t, status: 'dismissed' as const } : t)) })
    }

    case 'addPage': {
      const nb = state.doc.notebook
      const order = [...nb.orderedPageIds]
      const idx = action.after ? order.indexOf(action.after) + 1 : order.length
      order.splice(idx || order.length, 0, action.page.id)
      return {
        ...state,
        doc: { ...state.doc, notebook: { ...nb, orderedPageIds: order, lastPageId: action.page.id, updatedAt: Date.now() }, pages: { ...state.doc.pages, [action.page.id]: action.page } },
        dirty: state.dirty + 1,
      }
    }

    case 'deletePage': {
      const nb = state.doc.notebook
      if (nb.orderedPageIds.length <= 1) return state
      const order = nb.orderedPageIds.filter((id) => id !== action.pageId)
      const pages = { ...state.doc.pages }
      delete pages[action.pageId]
      const lastPageId = nb.lastPageId === action.pageId ? order[0] : nb.lastPageId
      return { ...state, doc: { ...state.doc, notebook: { ...nb, orderedPageIds: order, lastPageId, updatedAt: Date.now() }, pages }, dirty: state.dirty + 1 }
    }

    case 'renamePage': {
      const page = state.doc.pages[action.pageId]
      return page ? touch(state, action.pageId, { ...page, title: action.title.slice(0, 80) }) : state
    }

    case 'setPaper': {
      const page = state.doc.pages[action.pageId]
      return page ? touch(state, action.pageId, { ...page, paper: action.paper }) : state
    }

    case 'setLastPage': {
      if (state.doc.notebook.lastPageId === action.pageId) return state
      return { ...state, doc: { ...state.doc, notebook: { ...state.doc.notebook, lastPageId: action.pageId } }, dirty: state.dirty + 1 }
    }

    case 'renameNotebook':
      return { ...state, doc: { ...state.doc, notebook: { ...state.doc.notebook, title: action.title.slice(0, 80) || 'Untitled', updatedAt: Date.now() } }, dirty: state.dirty + 1 }

    case 'ensureSize': {
      // an endless sheet only ever grows; not a content edit (no revision bump, no undo step)
      const page = state.doc.pages[action.pageId]
      if (!page || (action.width <= page.width && action.height <= page.height)) return state
      return touch(state, action.pageId, { ...page, width: Math.max(page.width, action.width), height: Math.max(page.height, action.height) })
    }

    case 'setTest':
      return { ...state, doc: { ...state.doc, tests: { ...(state.doc.tests ?? {}), [action.test.id]: action.test } }, dirty: state.dirty + 1 }

    case 'patchQuestion': {
      const test = state.doc.tests?.[action.testId]
      if (!test) return state
      const questions = test.questions.map((q) => (q.id === action.questionId ? { ...q, ...action.patch } : q))
      return { ...state, doc: { ...state.doc, tests: { ...state.doc.tests, [test.id]: { ...test, questions } } }, dirty: state.dirty + 1 }
    }

    case 'recordStep': {
      const page = state.doc.pages[action.pageId]
      if (!page) return state
      const attempts = ensureAttempt(page, action.problemId)
      const last = [...attempts].reverse().find((a) => a.problemId === action.problemId)
      const step = { regionId: action.regionId, text: action.text, status: action.status, at: Date.now() }
      return touch(state, action.pageId, { ...page, attempts: attempts.map((a) => (a === last ? { ...a, steps: [...a.steps, step].slice(-30) } : a)) })
    }
  }
}

/** A linear-style equation in x: the kind of line that is a "problem" with later working steps. */
export function isEquationInX(text: string | undefined): boolean {
  if (!text) return false
  const t = text.replace(/\s+/g, '')
  const sides = t.split('=')
  return sides.length === 2 && !!sides[0] && !!sides[1] && /x/i.test(t) && !/y/i.test(t) && !/^[\d.]+[x×][\d.]+=/.test(t)
}

function topmostReadRegion(page: Page, readings: Record<string, Reading>): string | undefined {
  const read = page.regions.filter((r) => readings[r.id] && readings[r.id].status !== 'none' && isEquationInX(readingText(readings[r.id])))
  read.sort((a, b) => a.bounds.y - b.bounds.y)
  return read[0]?.id
}

function lastAttempt(page: Page, problemId: string) {
  return [...page.attempts].reverse().find((a) => a.problemId === problemId)
}

function ensureAttempt(page: Page, problemId: string) {
  if (lastAttempt(page, problemId)) return page.attempts
  const text = page.readings[problemId]?.acceptedText ?? page.readings[problemId]?.rawText ?? ''
  return [...page.attempts, { attemptId: shortId('at'), problemId, problemText: text, assistanceUsed: false, startedAt: Date.now(), steps: [] }]
}

function markAssistance(page: Page, problemId: string) {
  const attempts = ensureAttempt(page, problemId)
  const last = [...attempts].reverse().find((a) => a.problemId === problemId)
  // assistance stays true once used, even after erasure
  return attempts.map((a) => (a === last ? { ...a, assistanceUsed: true } : a))
}

// --------------------------------------------------------------- queries

export function readingText(r: Reading | undefined): string | undefined {
  if (!r) return undefined
  return r.acceptedText ?? (r.rawText || undefined)
}

export function currentAttempt(page: Page): { assistanceUsed: boolean } | undefined {
  if (!page.problemRegionId) return undefined
  return [...page.attempts].reverse().find((a) => a.problemId === page.problemRegionId)
}
