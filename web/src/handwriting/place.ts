// Where NOVA writes its handwritten answer: right after the student's last symbol (usually the "="),
// level with it, even when the line is written on a slant. Otherwise directly under that symbol,
// and only then on the next free line. Never over ink.

import { inflate, intersects, strokeBounds, union } from '../notebook/geometry'
import type { Page, Rect, Region } from '../notebook/types'
import { compose, type Composed, type GlyphLibrary } from './compose'
import { styleFromRegion } from './style'

export interface InkPlacement {
  strokes: [number, number][][]
  width: number
  bounds: Rect
}

function translate(c: Composed, x: number, yTop: number): InkPlacement {
  const strokes = c.strokes.map((s) => s.map(([a, b]) => [a + x, b + yTop] as [number, number]))
  return { strokes, width: 0, bounds: { x, y: yTop + c.top, w: c.width, h: c.bottom - c.top } }
}

/**
 * The student's last symbol on the line: the right-most real strokes (stray dots ignored), e.g. both bars of "=".
 * For a slanted line this is far from the bounding box's bottom-right corner, which is why we look at strokes.
 */
export function endSymbol(page: Page, region: Region, glyphH: number): Rect {
  const ids = new Set(region.sourceStrokeIds)
  const marks = page.strokes.filter((s) => ids.has(s.id)).map(strokeBounds).filter((b) => Math.max(b.w, b.h) >= Math.max(8, glyphH * 0.15))
  if (!marks.length) return region.bounds
  const right = Math.max(...marks.map((b) => b.x + b.w))
  const last = marks.filter((b) => b.x + b.w >= right - glyphH * 0.5)
  return union(last)
}

export function placeInk(page: Page, region: Region, text: string, mode: 'after' | 'below', lib?: GlyphLibrary): InkPlacement {
  const style = styleFromRegion(page, region)
  const c = compose(text, style, lib)
  const b = region.bounds
  const h = style.height
  const obstacles: Rect[] = [
    ...page.strokes.filter((s) => !region.sourceStrokeIds.includes(s.id)).map((s) => inflate(strokeBounds(s), 4)),
    // NOVA's own earlier answers for this same line are replaced, so they are not obstacles
    ...page.tutorObjects.filter((t) => t.status !== 'dismissed' && t.action.type !== 'highlight_region' && t.anchorRegionId !== region.id).map((t) => inflate(t.layout, 6)),
  ]
  const free = (r: Rect) => r.x >= 4 && r.x + r.w <= page.width - 4 && r.y >= 4 && r.y + r.h <= page.height - 4 && !obstacles.some((o) => intersects(o, r))
  if (mode === 'after') {
    const end = endSymbol(page, region, h)
    // level with the last symbol: an "=" (and a fraction bar) sits at ~0.6 of a digit's height
    const yTop = end.y + end.h / 2 - 0.6 * h
    const x0 = end.x + end.w + h * 0.28
    for (const [dx, dy] of [[0, 0], [0, -0.15], [0, 0.15], [0.25, 0], [0.5, 0], [0.25, -0.25], [0.25, 0.25]]) {
      const p = translate(c, x0 + h * dx, yTop + h * dy)
      if (free(p.bounds)) return { ...p, width: style.width }
    }
    // no room beside it: directly under the last symbol
    for (let dy = 0.35; dy < 3; dy += 0.25) {
      const p = translate(c, end.x, end.y + end.h + h * dy - c.top)
      if (free(p.bounds)) return { ...p, width: style.width }
    }
  }
  // next line: below the line and its readback label, left-aligned with it
  for (let dy = b.h + 52; dy < b.h + 52 + 600; dy += 24) {
    const p = translate(c, b.x, b.y + dy)
    if (free(p.bounds)) return { ...p, width: style.width }
  }
  return { ...translate(c, b.x, b.y + b.h + 52), width: style.width }
}
