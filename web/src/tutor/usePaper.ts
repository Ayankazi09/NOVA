// Question-paper test mode: import a PDF, let NOVA read every question and build a verified answer key,
// help like a friend while the student works (hints only, never the answer), then mark everything on the page.

import { useCallback, useState, type Dispatch, type RefObject } from 'react'
import { isTinyRegion, newPage, readingText, type DocAction, type DocState } from '../notebook/doc'
import { inflate, union } from '../notebook/geometry'
import { shortId, uuid } from '../notebook/ids'
import type { Page, PaperQuestion, PaperTest, Rect, Region, TutorObject } from '../notebook/types'
import { renderRegion } from '../recognition/render'
import { putAsset } from '../storage/db'
import { checksumBytes } from '../storage/backup'
import { pageForModel, readPdf } from '../storage/pdf'
import { compose } from '../handwriting/compose'
import { getLibrary } from '../handwriting/library'
import { placeInk } from '../handwriting/place'
import { api } from './api'
import { chosenOption } from './options'
import { getAsset } from '../storage/db'
import type { useNova } from './useNova'

interface Options {
  stateRef: RefObject<DocState>
  dispatch: Dispatch<DocAction>
  currentPageId: string
  openPage: (pageId: string) => void
  nova: ReturnType<typeof useNova>
  toast: (msg: string) => void
  openAsk: () => void
}

const doc = (o: Options) => o.stateRef.current!.doc

export function activeTestFor(state: DocState, pageId: string): PaperTest | undefined {
  return Object.values(state.doc.tests ?? {}).find((t) => t.pageIds.includes(pageId))
}

/** Lines the student wrote for a question: everything below its start and above the next question on that page. */
export function answerRegions(page: Page, test: PaperTest, q: PaperQuestion): Region[] {
  const same = test.questions.filter((x) => x.pageId === q.pageId).sort((a, b) => a.bounds.y - b.bounds.y)
  const next = same[same.indexOf(q) + 1]
  const top = q.bounds.y - 16
  const bottom = next ? next.bounds.y - 4 : page.height
  return page.regions
    .filter((r) => !isTinyRegion(page, r) || !!chosenOption(page, r))
    .filter((r) => {
      const cy = r.bounds.y + r.bounds.h / 2
      return cy >= top && cy < bottom
    })
    .sort((a, b) => a.bounds.y - b.bounds.y || a.bounds.x - b.bounds.x)
}

function questionBounds(page: Page, lineIds: string[], bbox: number[], number: string, text: string): Rect | null {
  const lines = (page.docText ?? []).filter((l) => lineIds.includes(l.id))
  if (lines.length) return inflate(union(lines), 8)
  // the model gave no usable line ids: find the printed line by its number ("6.", "Q6", "6)") or its opening words
  const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, '')
  const head = norm(text).slice(0, 18)
  const byNumber = (page.docText ?? []).find((l) => new RegExp(`^\\s*(q\\.?\\s*)?${number.replace(/[^\w]/g, '')}\\s*[.)\\]:]`, 'i').test(l.text))
  const byText = head ? (page.docText ?? []).find((l) => norm(l.text).includes(head)) : undefined
  const hit = byNumber ?? byText
  if (hit) return inflate(hit, 8)
  if (bbox.length === 4) {
    const [x0, y0, x1, y1] = bbox
    return { x: (x0 / 1000) * page.width, y: (y0 / 1000) * page.height, w: ((x1 - x0) / 1000) * page.width, h: ((y1 - y0) / 1000) * page.height }
  }
  return null
}

export function usePaper(o: Options) {
  const [busy, setBusy] = useState<string | null>(null)

  const saveTest = (t: PaperTest) => o.dispatch({ type: 'setTest', test: t })
  const latest = (id: string) => doc(o).tests?.[id]

  /** Read the given pages of a paper (2 at a time, one retry each). Pages that still fail can be retried later. */
  const analyze = useCallback(async (testId: string, pageIds: string[]) => {
    // the test was just dispatched: wait for it (and its pages) to reach state before reading
    for (let w = 0; w < 100 && !(latest(testId) && pageIds.every((id) => doc(o).pages[id])); w++) await new Promise((r) => setTimeout(r, 20))
    const base = latest(testId)
    if (!base) return
    const byPage = new Map<string, PaperQuestion[]>()
    for (const q of base.questions) if (!pageIds.includes(q.pageId)) byPage.set(q.pageId, [...(byPage.get(q.pageId) ?? []), q])
    const failed: number[] = []
    let done = 0
    const total = pageIds.length
    const publish = (status: PaperTest['status']) => {
      const ordered = base.pageIds.flatMap((id) => byPage.get(id) ?? [])
      const failedPages = failed.slice().sort((x, y) => x - y)
      saveTest({ ...base, questions: ordered, status, progress: { done, total }, failedPages, error: failedPages.length ? `Could not read page ${failedPages.map((i) => i + 1).join(', ')} (the model was too slow or busy).` : undefined })
    }
    publish('reading')
    const readOne = async (pageId: string) => {
      const index = base.pageIds.indexOf(pageId)
      const page = doc(o).pages[pageId]
      const asset = page?.backgroundAssetId ? await getAsset(page.backgroundAssetId) : undefined
      if (!page || !asset) return failed.push(index)
      let png: string
      try {
        png = await pageForModel(new Blob([asset.bytes], { type: asset.mime }))
      } catch {
        return failed.push(index)
      }
      const lines = (page.docText ?? []).slice(0, 250).map((l) => ({ id: l.id, text: l.text }))
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const res = await api.paperAnalyze({ requestId: uuid(), pageIndex: index, png, lines })
          const qs = res.questions
            .map((q) => {
              const bounds = questionBounds(page, q.lineIds, q.bbox, q.number, q.text)
              return bounds
                ? { id: shortId('q'), number: q.number, pageId, text: q.text, bounds, kind: q.kind, options: q.options, answer: q.answer, answerVerified: q.answerVerified, corrected: q.corrected, helpCount: 0 }
                : null
            })
            .filter((q): q is PaperQuestion => q !== null)
            .sort((x, y) => x.bounds.y - y.bounds.y)
          byPage.set(pageId, qs)
          return
        } catch {
          if (attempt === 1) failed.push(index)
        }
      }
    }
    const queue = [...pageIds]
    const worker = async () => {
      while (queue.length) {
        const id = queue.shift()!
        setBusy(`NOVA is reading page ${base.pageIds.indexOf(id) + 1} of ${base.pageIds.length}…`)
        await readOne(id)
        done++
        publish('reading')
      }
    }
    await Promise.all([worker(), worker()])
    const n = base.pageIds.reduce((k, id) => k + (byPage.get(id)?.length ?? 0), 0)
    publish(n ? 'ready' : 'failed')
    setBusy(null)
    o.toast(n ? `NOVA found ${n} questions${failed.length ? ` (${failed.length} page${failed.length > 1 ? 's' : ''} still to retry)` : ''}. Answer on the page — circle the option or write the answer.` : 'NOVA could not find questions in this PDF.')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const retryFailed = useCallback((testId: string) => {
    const t = latest(testId)
    if (!t?.failedPages?.length) return
    void analyze(testId, t.failedPages.map((i) => t.pageIds[i]).filter(Boolean))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analyze])

  const importPaper = useCallback(async (file: File) => {
    try {
      setBusy('Opening the PDF…')
      const pages = await readPdf(file, (i, n) => setBusy(`Opening page ${i} of ${n}…`))
      if (!pages.length) throw new Error('This PDF has no pages.')
      const nb = doc(o).notebook
      const title = file.name.replace(/\.pdf$/i, '').slice(0, 60) || 'Question paper'
      let after = o.currentPageId
      const created: { pageId: string; image: Blob; lines: { id: string; text: string }[] }[] = []
      for (const pg of pages) {
        const bytes = await pg.image.arrayBuffer()
        const assetId = shortId('as')
        await putAsset({ id: assetId, mime: 'image/png', bytes, width: pg.imageW, height: pg.imageH, checksum: checksumBytes(bytes) })
        const page = newPage(nb.id, `${title} · ${pg.index + 1}`, { width: pg.width + 1200, height: pg.height, backgroundAssetId: assetId, paper: 'squared', docText: pg.lines, bg: { w: pg.width, h: pg.height } })
        o.dispatch({ type: 'addPage', page, after })
        after = page.id
        created.push({ pageId: page.id, image: pg.image, lines: pg.lines.map((l) => ({ id: l.id, text: l.text })) })
      }
      const test: PaperTest = { id: shortId('test'), title, status: 'reading', pageIds: created.map((c) => c.pageId), questions: [], progress: { done: 0, total: created.length }, createdAt: Date.now() }
      saveTest(test)
      o.openPage(created[0].pageId)
      void analyze(test.id, created.map((c) => c.pageId))
      return test.id
    } catch (e) {
      setBusy(null)
      o.toast((e as Error).message || 'Could not open that PDF.')
      return null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [o.currentPageId])

  const circle = (q: PaperQuestion, reason: string) => {
    const id = `circle:${q.id}:${Date.now()}`
    const obj: TutorObject = {
      id, requestId: id, batchId: id, anchorRegionId: 'page', sourceHash: 'page', createdAt: Date.now(), author: 'tutor', status: 'active',
      action: { id, type: 'highlight_region', anchorRegionId: 'page', reason, subtle: true },
      layout: { ...inflate(q.bounds, 6), leader: false },
    }
    const page = doc(o).pages[q.pageId]
    o.dispatch({ type: 'applyTutorBatch', pageId: q.pageId, contentRevision: page.contentRevision, batchId: id, objects: [obj], turns: [], regionScoped: true })
  }

  /** Run fn once the notebook is showing the question's page (NOVA's controller follows the current page). */
  const onPage = (pageId: string, fn: () => void) => {
    if (o.currentPageId === pageId) return fn()
    o.openPage(pageId)
    setTimeout(fn, 180)
  }

  const help = useCallback((testId: string, q: PaperQuestion) => {
    const t = latest(testId)
    if (!t) return
    o.dispatch({ type: 'patchQuestion', testId, questionId: q.id, patch: { helpCount: q.helpCount + 1 } })
    onPage(q.pageId, () => {
      circle(q, `Question ${q.number}`)
      o.openAsk()
      void o.nova.ask('hint', `Help me with question ${q.number}. Don't tell me the answer.`, null, { exam: { number: q.number, text: q.text, answer: q.answer, reveal: false }, anchorRect: q.bounds })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [o.currentPageId, o.nova])

  const review = useCallback((testId: string, q: PaperQuestion) => {
    if (!latest(testId)) return
    onPage(q.pageId, () => {
      circle(q, `Question ${q.number}`)
      o.openAsk()
      void o.nova.ask('explain', `Explain question ${q.number}. My answer was: ${q.studentText || '(nothing)'}`, null, { exam: { number: q.number, text: q.text, answer: q.answer, reveal: true }, anchorRect: q.bounds })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [o.currentPageId, o.nova])

  const readOn = async (pageId: string, region: Region) => {
    const page = doc(o).pages[pageId]
    const opt = chosenOption(page, region)
    if (opt) {
      o.dispatch({ type: 'setReading', pageId, regionId: region.id, reading: { rawText: opt, alternatives: [], needsClarification: false, status: 'expression', state: 'accepted', acceptedText: opt, sourceHash: region.sourceHash, interpretationRevision: 1, model: 'option-circle' } })
      return opt
    }
    const img = await renderRegion(page, region.sourceStrokeIds, region.bounds, null) // ink only, never the printed paper
    const res = await api.recognize({
      context: { requestId: uuid(), pageId, contentRevision: page.contentRevision, regionId: region.id, sourceHash: region.sourceHash, selectionRevision: page.selectionRevision, interpretationRevision: 0 },
      regionPng: img.png, regionWidth: Math.round(img.crop.w), regionHeight: Math.round(img.crop.h),
    })
    const clear = !res.needsClarification && res.status !== 'none' && !!res.rawText
    o.dispatch({
      type: 'setReading', pageId, regionId: region.id,
      reading: { rawText: res.rawText, alternatives: res.alternatives, needsClarification: res.needsClarification, status: res.status, state: res.needsClarification ? 'needs_clarification' : clear ? 'accepted' : 'readback_ready', acceptedText: clear ? res.rawText : undefined, sourceHash: region.sourceHash, interpretationRevision: clear ? 1 : 0, model: res.model, latencyMs: res.latencyMs },
    })
    return res.rawText
  }

  const finish = useCallback(async (testId: string) => {
    const t0 = latest(testId)
    if (!t0 || !t0.questions.length) return
    saveTest({ ...t0, status: 'grading' })
    setBusy('NOVA is marking your answers…')
    try {
      const items: { id: string; kind: string; answer: string; student: string }[] = []
      const lastRegion = new Map<string, Region | undefined>()
      for (const q of t0.questions) {
        const page = doc(o).pages[q.pageId]
        const regions = answerRegions(page, t0, q)
        const texts: string[] = []
        for (const r of regions) {
          const cur = doc(o).pages[q.pageId]
          const existing = cur.readings[r.id]
          texts.push(existing && existing.sourceHash === r.sourceHash ? readingText(existing) ?? '' : await readOn(q.pageId, r))
        }
        lastRegion.set(q.id, regions[regions.length - 1])
        items.push({ id: q.id, kind: q.kind, answer: q.answer, student: texts.filter(Boolean).join('\n').slice(0, 400) })
      }
      const results = await api.paperGrade(items)
      let correct = 0
      const marked = t0.questions.map((q) => {
        const r = results.find((x) => x.id === q.id)
        return { ...q, verdict: r?.verdict ?? 'unanswered', studentText: items.find((i) => i.id === q.id)?.student }
      })
      for (const r of results) {
        const q = t0.questions.find((x) => x.id === r.id)!
        if (r.verdict === 'correct') correct++
        // a teacher's mark beside the answer (or beside the question if it was left blank)
        const page = doc(o).pages[q.pageId]
        const region = lastRegion.get(q.id)
        const mark = r.verdict === 'correct' ? '✓' : '✗'
        const id = `mark:${q.id}`
        let strokes: [number, number][][], bounds: Rect, width: number, anchor: string, sourceHash: string
        if (region) {
          const ink = placeInk(page, region, mark, 'after', getLibrary())
          ;({ strokes, bounds, width } = ink)
          anchor = region.id
          sourceHash = region.sourceHash
        } else {
          const c = compose(mark, { height: 48, slant: 0.1, width: 4, seed: 3 })
          const x = Math.min(page.width - 80, q.bounds.x + q.bounds.w + 16), y = q.bounds.y
          strokes = c.strokes.map((s) => s.map(([a, b]) => [a + x, b + y] as [number, number]))
          bounds = { x, y: y + c.top, w: c.width, h: c.bottom - c.top }
          width = 4
          anchor = 'page'
          sourceHash = 'page'
        }
        const obj: TutorObject = {
          id, requestId: id, batchId: id, anchorRegionId: anchor, sourceHash, createdAt: Date.now(), author: 'tutor', status: 'active',
          action: { id, type: 'write_ink', anchorRegionId: anchor, text: mark, strokes, width: width * 1.2, purpose: 'mark', verified: true, tone: r.verdict === 'correct' ? 'correct' : 'wrong' },
          layout: { ...bounds, leader: false },
        }
        o.dispatch({ type: 'applyTutorBatch', pageId: page.id, contentRevision: page.contentRevision, batchId: id, objects: [obj], turns: [], regionScoped: true })
      }
      // the score, in red, at the top of the first page — like a teacher would
      const first = doc(o).pages[t0.pageIds[0]]
      const sc = compose(`${correct}/${t0.questions.length}`, { height: 64, slant: 0.12, width: 4.5, seed: 9 })
      const sx = first.width - sc.width - 48, sy = 28
      const sid = `score:${testId}`
      o.dispatch({
        type: 'applyTutorBatch', pageId: first.id, contentRevision: first.contentRevision, batchId: sid, turns: [], regionScoped: true,
        objects: [{ id: sid, requestId: sid, batchId: sid, anchorRegionId: 'page', sourceHash: 'page', createdAt: Date.now(), author: 'tutor', status: 'active',
          action: { id: sid, type: 'write_ink', anchorRegionId: 'page', text: `${correct}/${t0.questions.length}`, strokes: sc.strokes.map((s) => s.map(([a, b]) => [a + sx, b + sy] as [number, number])), width: 4.5, purpose: 'mark', verified: true, tone: 'wrong' },
          layout: { x: sx, y: sy + sc.top, w: sc.width, h: sc.bottom - sc.top, leader: false } }],
      })
      saveTest({ ...t0, questions: marked, status: 'finished', finishedAt: Date.now(), score: { correct, total: t0.questions.length } })
      o.toast(`Marked: ${correct} of ${t0.questions.length} correct. Tap Explain on any question to see where it went wrong.`)
    } catch (e) {
      saveTest({ ...t0, status: 'ready', error: `Marking failed: ${(e as Error).message}` })
      o.toast(`Marking failed: ${(e as Error).message}`)
    } finally {
      setBusy(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { busy, importPaper, help, review, finish, retryFailed }
}
