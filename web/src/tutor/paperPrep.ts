// Background preparation of imported PDF pages: one page at a time, the page the student is looking at first.
// Each page already exists in the notebook (stable id, size, asset id) before its image is drawn, so preparing it
// only stores the image under the asset id it already has and reports back: strokes, zoom and the active page are
// never touched. No AI is involved here.

import type { DocLine } from '../notebook/types'
import { getAsset, putAsset } from '../storage/db'
import { checksumBytes } from '../storage/backup'
import { openPdf, renderPdfPage, type PdfDoc } from '../storage/pdf'

export interface PrepTask {
  pageId: string
  assetId: string // where the page's image goes (already set on the page)
  pdfAssetId: string // the stored original PDF
  index: number // page index in the PDF, from 0
}

export type PrepResult = { ok: true; lines: DocLine[]; ms: number } | { ok: false; error: string }
type Listener = (pageId: string, result: PrepResult) => void

let queue: PrepTask[] = []
let focus: string | null = null
let running = false
let generation = 0
let listener: Listener | null = null
const docs = new Map<string, Promise<PdfDoc>>()

/** Who hears about finished pages (the open notebook). Results from before the last cancel are dropped. */
export function setPrepListener(fn: Listener | null) {
  listener = fn
}

/** An already-opened PDF, so the first page does not wait for it to be stored and reopened. */
export function rememberPdf(pdfAssetId: string, doc: PdfDoc) {
  docs.set(pdfAssetId, Promise.resolve(doc))
}

export function enqueue(tasks: PrepTask[]) {
  for (const t of tasks) if (!queue.some((q) => q.pageId === t.pageId)) queue.push(t)
  void pump()
}

/** The student opened this page: prepare it next. */
export function prioritise(pageId: string) {
  focus = pageId
}

export function queuedPageIds(): string[] {
  return queue.map((t) => t.pageId)
}

/** Stop preparing (the notebook closed). Pages left 'preparing' are picked up again when it reopens. */
export function cancelAll() {
  generation++
  queue = []
  focus = null
}

function docFor(pdfAssetId: string): Promise<PdfDoc> {
  let d = docs.get(pdfAssetId)
  if (!d) {
    d = getAsset(pdfAssetId).then((a) => {
      if (!a) throw new Error('The original PDF is no longer stored on this device. Import it again.')
      return openPdf(new Uint8Array(a.bytes))
    })
    docs.set(pdfAssetId, d)
    d.catch(() => docs.delete(pdfAssetId))
  }
  return d
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function pump() {
  if (running) return
  running = true
  try {
    while (queue.length) {
      const gen = generation
      const at = queue.findIndex((t) => t.pageId === focus)
      const task = queue.splice(at >= 0 ? at : 0, 1)[0]
      let result: PrepResult
      const started = performance.now()
      try {
        const doc = await docFor(task.pdfAssetId)
        const r = await renderPdfPage(doc, task.index)
        const bytes = await r.image.arrayBuffer()
        await putAsset({ id: task.assetId, mime: 'image/png', bytes, width: r.imageW, height: r.imageH, checksum: checksumBytes(bytes) })
        result = { ok: true, lines: r.lines, ms: Math.round(performance.now() - started) }
      } catch (e) {
        result = { ok: false, error: (e as Error).message || 'This page could not be prepared.' }
      }
      performance.mark(result.ok ? 'nova-page-ready' : 'nova-page-failed', { detail: { index: task.index, ms: result.ok ? result.ms : 0 } }) // for import timing
      if (gen === generation) listener?.(task.pageId, result)
      await pause(30) // let the pen and the page redraw between pages
    }
  } finally {
    running = false
  }
  // nothing left to prepare from these files: release pdf.js's memory
  for (const [id, d] of docs) {
    if (queue.some((t) => t.pdfAssetId === id)) continue
    docs.delete(id)
    void d.then((doc) => doc.loadingTask.destroy()).catch(() => undefined)
  }
}
