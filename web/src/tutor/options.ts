// Multiple-choice answers on a question paper: a student circles (or ticks next to) a printed option.
// The PDF's text layer says exactly where "(a)", "(b)", ... are printed, so no model is needed to read that.

import { inflate } from '../notebook/geometry'
import type { Page, Region } from '../notebook/types'

const OPTION = /^\s*\(?\s*([a-dA-D])\s*[).]/

export function chosenOption(page: Page, region: Region): string | null {
  const lines = (page.docText ?? []).filter((l) => OPTION.test(l.text))
  if (!lines.length) return null
  const label = (l: { x: number; y: number; h: number }) => ({ x: l.x + Math.min(l.h, 14), y: l.y + l.h / 2 })
  const b = inflate(region.bounds, 4)
  const cx = region.bounds.x + region.bounds.w / 2, cy = region.bounds.y + region.bounds.h / 2
  const inside = lines.filter((l) => {
    const p = label(l)
    return p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h
  })
  const pick = (cands: typeof lines) => cands.sort((p, q) => Math.hypot(label(p).x - cx, label(p).y - cy) - Math.hypot(label(q).x - cx, label(q).y - cy))[0]
  let hit = inside.length ? pick(inside) : undefined
  if (!hit) {
    // a tick or mark just beside an option, on the same printed line
    const near = lines.filter((l) => {
      const p = label(l)
      const vOverlap = Math.min(b.y + b.h, l.y + l.h) - Math.max(b.y, l.y)
      return vOverlap > Math.min(b.h, l.h) * 0.4 && Math.abs(cx - p.x) < Math.max(80, l.h * 4)
    })
    hit = near.length ? pick(near) : undefined
  }
  const m = hit ? OPTION.exec(hit.text) : null
  return m ? `(${m[1].toLowerCase()})` : null
}
