// Share a page: draw what is written on it (sheet, grid, the student's ink, NOVA's handwriting and marks) to a PNG,
// cropped to the writing. Then hand it to the phone's share sheet (WhatsApp, etc.), download it, or print it to PDF.
// Always drawn light (paper-white), whatever the app theme.

import type { Page } from '../notebook/types'
import { getAsset } from './db'

const PAD = 48
const MAX_PX = 2400 // longest edge of the exported image
const FOOTER = 44

function contentBox(page: Page): { x: number; y: number; w: number; h: number } | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  const add = (x: number, y: number) => {
    if (x < x0) x0 = x
    if (y < y0) y0 = y
    if (x > x1) x1 = x
    if (y > y1) y1 = y
  }
  if (page.bg) {
    add(0, 0)
    add(page.bg.w, page.bg.h)
  }
  for (const s of page.strokes) for (const p of s.points) add(p.x, p.y)
  for (const t of page.tutorObjects) if (t.status !== 'dismissed' && t.action.type === 'write_ink') for (const st of t.action.strokes) for (const [x, y] of st) add(x, y)
  if (!Number.isFinite(x0)) return null
  return { x: x0 - PAD, y: y0 - PAD, w: x1 - x0 + PAD * 2, h: y1 - y0 + PAD * 2 }
}

export function pageHasContent(page: Page): boolean {
  return contentBox(page) !== null
}

export async function renderPagePng(page: Page, caption = ''): Promise<Blob> {
  const box = contentBox(page)
  if (!box) throw new Error('This page is empty. Write something first.')
  const s = Math.min(2, MAX_PX / Math.max(box.w, box.h))
  const W = Math.round(box.w * s)
  const H = Math.round(box.h * s) + FOOTER
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, W, H)

  ctx.save()
  ctx.beginPath()
  ctx.rect(0, 0, W, H - FOOTER)
  ctx.clip()
  ctx.setTransform(s, 0, 0, s, -box.x * s, -box.y * s)
  // paper
  if (page.paper !== 'blank' || page.bg) {
    const step = page.paper === 'ruled' && !page.bg ? 36 : 24
    ctx.strokeStyle = '#e8ecf0'
    ctx.lineWidth = 1 / s
    ctx.beginPath()
    for (let y = Math.floor(box.y / step) * step; y < box.y + box.h; y += step) {
      ctx.moveTo(box.x, y)
      ctx.lineTo(box.x + box.w, y)
    }
    if (page.paper !== 'ruled' || page.bg) {
      for (let x = Math.floor(box.x / step) * step; x < box.x + box.w; x += step) {
        ctx.moveTo(x, box.y)
        ctx.lineTo(x, box.y + box.h)
      }
    }
    ctx.stroke()
  }
  // the imported sheet / practice worksheet
  if (page.backgroundAssetId && page.bg) {
    const a = await getAsset(page.backgroundAssetId)
    if (a) {
      const bmp = await createImageBitmap(new Blob([a.bytes], { type: a.mime }))
      ctx.drawImage(bmp, 0, 0, page.bg.w, page.bg.h)
      bmp.close?.()
    }
  }
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (const st of page.strokes) {
    ctx.strokeStyle = st.colour
    ctx.lineWidth = st.width
    ctx.beginPath()
    st.points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)))
    ctx.stroke()
  }
  for (const t of page.tutorObjects) {
    if (t.status === 'dismissed' || t.action.type !== 'write_ink') continue
    const a = t.action
    a.strokes.forEach((st, i) => {
      ctx.strokeStyle = a.colors?.[i] ?? (a.tone === 'correct' ? '#2e7d4f' : a.tone === 'wrong' ? '#c2352e' : '#245c9c')
      ctx.lineWidth = a.width
      ctx.beginPath()
      st.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
      ctx.stroke()
    })
  }
  ctx.restore()

  // footer: a quiet credit line
  ctx.fillStyle = '#f3f4f6'
  ctx.fillRect(0, H - FOOTER, W, FOOTER)
  ctx.fillStyle = '#626b75'
  ctx.font = "15px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
  ctx.textBaseline = 'middle'
  ctx.fillText(caption ? `${caption} · written with NOVA` : 'Written with NOVA', 16, H - FOOTER / 2)

  return new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Could not draw the page.'))), 'image/png'))
}

export function safeName(title: string): string {
  return title.replace(/[^\w-]+/g, '_').replace(/^_+|_+$/g, '') || 'page'
}

/** Phone share sheet when the browser can share files; otherwise download. Returns what happened. */
export async function sharePng(blob: Blob, title: string): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const file = new File([blob], `${safeName(title)}.png`, { type: 'image/png' })
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean }
  if (nav.share && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title, text: `${title} — solved in NOVA` })
      return 'shared'
    } catch (e) {
      if ((e as DOMException)?.name === 'AbortError') return 'cancelled'
      // sharing failed (e.g. no permission): fall back to a download
    }
  }
  downloadBlob(blob, file.name)
  return 'downloaded'
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

/** Print the page image on its own; the browser's print dialog offers "Save as PDF". */
export function printPng(blob: Blob, title: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob)
    const frame = document.createElement('iframe')
    frame.setAttribute('aria-hidden', 'true')
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden'
    document.body.appendChild(frame)
    const cleanup = () => {
      setTimeout(() => {
        frame.remove()
        URL.revokeObjectURL(url)
      }, 1000)
    }
    const d = frame.contentDocument
    if (!d) {
      cleanup()
      return reject(new Error('Printing is not available in this browser.'))
    }
    d.open()
    d.write(`<!doctype html><html><head><title>${title.replace(/[<&>"]/g, '')}</title><style>@page{margin:12mm}html,body{margin:0;background:#fff}img{display:block;max-width:100%;max-height:100vh;margin:0 auto;object-fit:contain}</style></head><body><img alt=""></body></html>`)
    d.close()
    const img = d.querySelector('img')!
    img.onload = () => {
      try {
        frame.contentWindow!.focus()
        frame.contentWindow!.print()
        resolve()
      } catch (e) {
        reject(e as Error)
      } finally {
        cleanup()
      }
    }
    img.onerror = () => {
      cleanup()
      reject(new Error('Could not prepare the page for printing.'))
    }
    img.src = url
  })
}
