// Handwritten content blocks NOVA adds to the page: a titled list of lines, or a ruled table.
// Everything is composed in page units and placed in free space, never over the student's ink.

import { inflate, intersects, strokeBounds } from '../notebook/geometry'
import type { Page, Rect } from '../notebook/types'
import type { Pt } from './glyphs'
import { compose, type GlyphLibrary, type HandStyle } from './compose'

export interface Block {
  strokes: Pt[][]
  w: number
  h: number
  colors?: string[] // per stroke
}

export const INK = { blue: '#2b59c3', red: '#c8432c', black: '#1d2230' } as const

function shift(strokes: Pt[][], dx: number, dy: number): Pt[][] {
  return strokes.map((s) => s.map(([x, y]) => [x + dx, y + dy] as Pt))
}

/** A slightly wavering ruled line, like one drawn by hand with a ruler. */
function rule(x0: number, y0: number, x1: number, y1: number, seed: number): Pt[] {
  const n = 5
  const out: Pt[] = []
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const wob = Math.sin((seed + i) * 2.3) * 0.6
    out.push([x0 + (x1 - x0) * t + (y0 === y1 ? 0 : wob), y0 + (y1 - y0) * t + (y0 === y1 ? wob : 0)])
  }
  return out
}

function title(text: string, style: HandStyle, lib?: GlyphLibrary): Block | null {
  if (!text.trim()) return null
  const c = compose(text, { ...style, height: style.height * 1.1, seed: style.seed + 99 }, lib)
  const strokes = shift(c.strokes, 0, -c.top)
  const h = c.bottom - c.top
  strokes.push(rule(0, h + style.height * 0.18, c.width, h + style.height * 0.18, style.seed))
  return { strokes, w: c.width, h: h + style.height * 0.3 }
}

export function composeLines(head: string, lines: string[], style: HandStyle, lib?: GlyphLibrary, inks?: (keyof typeof INK)[]): Block {
  const strokes: Pt[][] = []
  const colors: string[] = []
  let y = 0
  let w = 0
  const t = title(head, style, lib)
  if (t) {
    strokes.push(...t.strokes)
    colors.push(...t.strokes.map(() => INK.black))
    y = t.h + style.height * 0.5
    w = t.w
  }
  lines.forEach((line, i) => {
    const c = compose(line, { ...style, seed: style.seed + i * 7 }, lib)
    const moved = shift(c.strokes, 0, y - c.top)
    strokes.push(...moved)
    colors.push(...moved.map(() => INK[inks?.[i] ?? 'blue']))
    y += c.bottom - c.top + style.height * 0.55
    w = Math.max(w, c.width)
  })
  return { strokes, w, h: y, colors }
}

export function composeTable(head: string, header: string[], rows: string[][], style: HandStyle, lib?: GlyphLibrary): Block {
  const cols = Math.max(header.length, ...rows.map((r) => r.length))
  const all = [header, ...rows]
  const cells = all.map((r, i) => Array.from({ length: cols }, (_, j) => compose(r[j] ?? '', { ...style, seed: style.seed + i * 31 + j }, lib)))
  const padX = style.height * 0.45, padY = style.height * 0.35
  const colW = Array.from({ length: cols }, (_, j) => Math.max(style.height * 1.2, ...cells.map((r) => r[j].width)) + 2 * padX)
  const rowH = cells.map((r) => Math.max(style.height, ...r.map((c) => c.bottom - c.top)) + 2 * padY)
  const strokes: Pt[][] = []
  let y0 = 0
  const t = title(head, style, lib)
  if (t) {
    strokes.push(...t.strokes)
    y0 = t.h + style.height * 0.45
  }
  const W = colW.reduce((a, b) => a + b, 0)
  const H = rowH.reduce((a, b) => a + b, 0)
  // grid: outer box, a heavier rule under the header, column separators
  let y = y0
  strokes.push(rule(0, y, W, y, 1))
  rowH.forEach((h, i) => {
    y += h
    strokes.push(rule(0, y, W, y, i + 2))
    if (i === 0) strokes.push(rule(0, y + 1.6, W, y + 1.6, 40)) // double rule under the header
  })
  let x = 0
  strokes.push(rule(0, y0, 0, y0 + H, 50))
  colW.forEach((w, j) => {
    x += w
    strokes.push(rule(x, y0, x, y0 + H, 60 + j))
  })
  // cell text, centred
  let cy = y0
  cells.forEach((r, i) => {
    let cx = 0
    r.forEach((c, j) => {
      const tx = cx + (colW[j] - c.width) / 2
      const ty = cy + (rowH[i] - (c.bottom - c.top)) / 2 - c.top
      strokes.push(...shift(c.strokes, tx, ty))
      cx += colW[j]
    })
    cy += rowH[i]
  })
  return { strokes, w: Math.max(W, t?.w ?? 0), h: y0 + H }
}

/** First free spot for a w×h block: beside the selected/last line if possible, else the first free band of the page. */
export function placeBlock(page: Page, w: number, h: number, near?: Rect, prefer: 'right' | 'below' = 'right'): { x: number; y: number } {
  const obstacles: Rect[] = [
    ...(page.bg ? [{ x: 0, y: 0, w: page.bg.w + 24, h: page.bg.h }] : []), // the printed sheet: write in the grid beside it
    ...page.strokes.map((s) => inflate(strokeBounds(s), 10)),
    ...page.regions.map((r) => ({ x: r.bounds.x - 4, y: r.bounds.y + r.bounds.h, w: Math.max(r.bounds.w, 340), h: 46 })),
    ...page.tutorObjects.filter((t) => t.status !== 'dismissed' && t.action.type !== 'highlight_region').map((t) => inflate(t.layout, 12)),
  ]
  // the grid is endless: only the left/top edges are hard limits (the page grows to fit what NOVA writes)
  const fits = (x: number, y: number) => {
    const r = { x, y, w, h }
    return x >= 24 && y >= 24 && !obstacles.some((o) => intersects(o, r))
  }
  if (page.bg) {
    // an imported sheet: write in the grid just right of it, level with the question
    const y0 = near ? near.y : 48
    for (let dy = 0; dy < 1600; dy += 24) {
      if (fits(page.bg.w + 60, y0 + dy)) return { x: page.bg.w + 60, y: y0 + dy }
      if (dy && y0 - dy >= 24 && fits(page.bg.w + 60, y0 - dy)) return { x: page.bg.w + 60, y: y0 - dy }
    }
  }
  if (near) {
    const right = [near.x + near.w + 60, near.y] as const
    const below = [near.x, near.y + near.h + 52] as const // under the line and its reading label
    for (const [x, y] of prefer === 'below' ? [below, right] : [right, below]) if (fits(x, y)) return { x, y }
    for (let dy = 76; dy < 600; dy += 24) if (fits(near.x, near.y + near.h + dy)) return { x: near.x, y: near.y + near.h + dy }
  }
  for (let y = 48; y + h <= page.height - 24; y += 24) for (let x = 48; x + w <= Math.max(page.width, 1200) - 24; x += 48) if (fits(x, y)) return { x, y }
  const lowest = Math.max(0, ...obstacles.map((o) => o.y + o.h))
  return { x: 48, y: lowest + 40 }
}

export function moveBlock(b: Block, x: number, y: number): [number, number][][] {
  return b.strokes.map((s) => s.map(([a, c]) => [a + x, c + y] as [number, number]))
}

export function blockBounds(b: Block): Rect {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const s of b.strokes) for (const [x, y] of s) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y) }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}
