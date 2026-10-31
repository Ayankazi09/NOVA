// PDF question papers -> notebook pages. Each page is rendered to an image (the page background)
// and its text layer is kept as positioned lines, so questions can be located exactly.

import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { DocLine } from '../notebook/types'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

export const MAX_PDF_PAGES = 20
export const MAX_PDF_BYTES = 40 * 1024 * 1024
const PAGE_W = 1200 // page units; height follows the PDF's aspect ratio
const RENDER_W = 1600 // pixels for the background image (sharp at normal zoom)

export interface PdfPage {
  index: number
  width: number
  height: number
  image: Blob
  imageW: number
  imageH: number
  lines: DocLine[]
}

interface TextItem {
  str: string
  transform: number[]
  width: number
  height: number
}

function groupLines(items: TextItem[], vpH: number, s: number): DocLine[] {
  const pieces = items
    .filter((it) => it.str.trim())
    .map((it) => {
      const x = it.transform[4] * s
      const h = Math.max(4, Math.abs(it.transform[3] || it.height) * s)
      const yBase = (vpH - it.transform[5]) * s
      return { text: it.str, x, y: yBase - h, w: Math.max(it.width * s, 2), h }
    })
    .sort((a, b) => a.y - b.y || a.x - b.x)
  const lines: { parts: typeof pieces; y: number; h: number }[] = []
  for (const p of pieces) {
    const line = lines.find((l) => Math.abs(l.y + l.h / 2 - (p.y + p.h / 2)) < Math.max(l.h, p.h) * 0.5)
    if (line) {
      line.parts.push(p)
      line.h = Math.max(line.h, p.h)
    } else lines.push({ parts: [p], y: p.y, h: p.h })
  }
  return lines.map((l, i) => {
    l.parts.sort((a, b) => a.x - b.x)
    let text = ''
    let lastEnd = -Infinity
    for (const p of l.parts) {
      if (text && p.x - lastEnd > p.h * 0.25) text += ' '
      text += p.text
      lastEnd = p.x + p.w
    }
    const x0 = Math.min(...l.parts.map((p) => p.x))
    const x1 = Math.max(...l.parts.map((p) => p.x + p.w))
    const y0 = Math.min(...l.parts.map((p) => p.y))
    const y1 = Math.max(...l.parts.map((p) => p.y + p.h))
    return { id: `l${i + 1}`, text: text.replace(/\s+/g, ' ').trim().slice(0, 400), x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
  })
}

export async function readPdf(file: File, onPage?: (i: number, n: number) => void): Promise<PdfPage[]> {
  if (file.size > MAX_PDF_BYTES) throw new Error('That PDF is larger than 40 MB.')
  const data = new Uint8Array(await file.arrayBuffer())
  const task = pdfjs.getDocument({ data })
  const doc = await task.promise
  const n = Math.min(doc.numPages, MAX_PDF_PAGES)
  const out: PdfPage[] = []
  for (let i = 1; i <= n; i++) {
    onPage?.(i, n)
    const page = await doc.getPage(i)
    const base = page.getViewport({ scale: 1 })
    const scale = RENDER_W / base.width
    const vp = page.getViewport({ scale })
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(vp.width)
    canvas.height = Math.round(vp.height)
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({ canvasContext: ctx, viewport: vp, canvas }).promise
    const image = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Could not render the page.'))), 'image/png'))
    const content = await page.getTextContent()
    const unit = PAGE_W / base.width // PDF points -> page units
    const lines = groupLines(content.items as TextItem[], base.height, unit)
    out.push({ index: i - 1, width: PAGE_W, height: Math.round(base.height * unit), image, imageW: canvas.width, imageH: canvas.height, lines })
    page.cleanup()
  }
  await task.destroy()
  return out
}

/** A PNG of the page for the model: longest edge ≤ 1600 px and ≤ ~1 MB. */
export async function pageForModel(image: Blob): Promise<string> {
  const bmp = await createImageBitmap(image)
  let scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height))
  for (let attempt = 0; attempt < 4; attempt++) {
    const c = document.createElement('canvas')
    c.width = Math.round(bmp.width * scale)
    c.height = Math.round(bmp.height * scale)
    const ctx = c.getContext('2d')!
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, c.width, c.height)
    ctx.drawImage(bmp, 0, 0, c.width, c.height)
    const url = c.toDataURL('image/png')
    const b64 = url.slice(url.indexOf(',') + 1)
    if (b64.length * 0.75 < 950_000) return b64
    scale *= 0.75
  }
  throw new Error('This page is too detailed to send.')
}
