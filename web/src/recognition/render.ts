// Render ONLY student ink (+ imported background) for a region. Grid and tutor layers are never included.
// The crop is normalised for the vision model: generous white margin, readable glyph size,
// a bounded aspect ratio and a minimum stroke thickness in output pixels.

import { inflate } from '../notebook/geometry'
import type { Page, Rect, Stroke } from '../notebook/types'
import { drawStroke } from '../notebook/ink'

export const CROP_PADDING = 24
const MAX_EDGE = 1600
const MAX_BYTES = 950_000
const TARGET_LINE_PX = 150 // a single handwritten line ends up roughly this tall
const MIN_STROKE_PX = 4
const MAX_ASPECT = 5

export interface RegionImage {
  png: string // base64, no data: prefix
  width: number
  height: number
  crop: Rect
}

export function cropFor(bounds: Rect, page: Page): Rect {
  const pad = Math.max(CROP_PADDING, 0.12 * Math.max(bounds.w, bounds.h))
  const r = inflate(bounds, pad)
  const x = Math.max(0, r.x), y = Math.max(0, r.y)
  return { x, y, w: Math.min(page.width, r.x + r.w) - x, h: Math.min(page.height, r.y + r.h) - y }
}

export async function renderRegion(page: Page, strokeIds: string[], bounds: Rect, background?: ImageBitmap | HTMLImageElement | null): Promise<RegionImage> {
  const crop = cropFor(bounds, page)
  const ids = new Set(strokeIds)
  const strokes: Stroke[] = page.strokes.filter((s) => ids.has(s.id))
  // scale so the writing is a comfortable size for the model, never above the edge cap
  let scale = Math.min(3, Math.max(0.6, TARGET_LINE_PX / Math.max(60, Math.min(bounds.h, 260))))
  scale = Math.min(scale, MAX_EDGE / Math.max(crop.w, crop.h))
  for (let attempt = 0; attempt < 4; attempt++) {
    const inkW = Math.max(1, Math.round(crop.w * scale))
    const inkH = Math.max(1, Math.round(crop.h * scale))
    // very wide strips are padded top/bottom so the model's resize keeps glyphs legible
    const w = inkW
    const h = Math.min(MAX_EDGE, Math.max(inkH, Math.ceil(inkW / MAX_ASPECT), 96))
    const offY = Math.round((h - inkH) / 2)
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, w, h)
    ctx.setTransform(scale, 0, 0, scale, -crop.x * scale, -crop.y * scale + offY)
    if (background) ctx.drawImage(background, 0, 0, page.bg?.w ?? page.width, page.bg?.h ?? page.height)
    const minUnits = MIN_STROKE_PX / scale
    for (const s of strokes) drawStroke(ctx, { ...s, colour: '#111111' }, Math.max(s.width * 1.15, minUnits))
    const dataUrl = canvas.toDataURL('image/png')
    const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
    if (b64.length * 0.75 <= MAX_BYTES) return { png: b64, width: w, height: h, crop }
    scale *= 0.7
  }
  throw new Error('Region image is too large to send.')
}
