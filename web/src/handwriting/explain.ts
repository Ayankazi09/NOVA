// A worked solution a beginner can follow: each step on its own line in handwriting, the term that moved
// across "=" written in red, a red curved arrow from where it was to where it went, and a short note.

import type { Rect } from '../notebook/types'
import { compose, type GlyphLibrary, type HandStyle } from './compose'
import { SPACE_W, type Pt } from './glyphs'

export const STEP_BLUE = '#245C9C'
export const MOVE_RED = '#C2352E'
const NOTE_GREY = '#4f5761'

export interface Move {
  find: string // the term as written in the line above ("+2", "3x")
  becomes: string // how it appears in this line ("- 2", "/3")
}

export interface Explained {
  strokes: [number, number][][]
  colors: string[]
  bounds: Rect
  notes: { strokes: [number, number][][]; colors: string[] } // drawn with a thinner pen
}

/** Index range of `term` in `text`, ignoring spaces (students and NOVA space things differently). */
export function findTerm(text: string, term: string, last = false): [number, number] | null {
  const map: number[] = []
  let compact = ''
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== ' ') {
      map.push(i)
      compact += text[i]
    }
  }
  const t = term.replace(/\s+/g, '')
  if (!t) return null
  const k = last ? compact.lastIndexOf(t) : compact.indexOf(t)
  if (k < 0) return null
  return [map[k], map[k + t.length - 1] + 1]
}

/** Find a term on one side of "=" (the side it moved FROM is opposite to where it landed). */
export function findOnSide(text: string, term: string, side: 'left' | 'right'): [number, number] | null {
  const eq = text.indexOf('=')
  if (eq < 0) return findTerm(text, term)
  if (side === 'left') {
    const r = findTerm(text.slice(0, eq), term, true)
    return r
  }
  const r = findTerm(text.slice(eq + 1), term)
  return r ? [r[0] + eq + 1, r[1] + eq + 1] : null
}

const sideOf = (text: string, idx: number): 'left' | 'right' => (idx < text.indexOf('=') ? 'left' : 'right')

/** Horizontal span of text[a, b) once composed, measured by composing prefixes (same seed = same glyphs). */
function span(text: string, a: number, b: number, style: HandStyle, lib?: GlyphLibrary): [number, number] {
  const w = (n: number) => {
    if (n <= 0) return 0
    const pre = compose(text.slice(0, n), style, lib).width
    return text[n - 1] === ' ' ? pre + SPACE_W * style.height : pre
  }
  return [w(a), w(b)]
}

function strokeRange(text: string, a: number, b: number, style: HandStyle, lib?: GlyphLibrary): [number, number] {
  const n = (k: number) => (k <= 0 ? 0 : compose(text.slice(0, k).trimEnd(), style, lib).strokes.length)
  return [n(a), n(b)]
}

function arrow(sx: number, sy: number, ex: number, ey: number, h: number): Pt[][] {
  // a teacher's curved arrow: bows out to the right, then lands on the term from above
  const cx = Math.max(sx, ex) + h * 0.9, cy = (sy + ey) / 2
  const pts: Pt[] = []
  for (let i = 0; i <= 20; i++) {
    const t = i / 20
    pts.push([(1 - t) * (1 - t) * sx + 2 * (1 - t) * t * cx + t * t * ex, (1 - t) * (1 - t) * sy + 2 * (1 - t) * t * cy + t * t * ey])
  }
  const [px, py] = pts[pts.length - 3]
  const ang = Math.atan2(ey - py, ex - px)
  const L = h * 0.3
  const head = (d: number): Pt[] => [[ex, ey], [ex - L * Math.cos(ang - d), ey - L * Math.sin(ang - d)]]
  return [pts, head(0.5), head(-0.5)]
}

/**
 * Lay out the worked solution under the student's line.
 * `source` is the student's line (its reading and where its ink is) so the first arrow can start in their writing.
 */
export function composeExplained(
  steps: string[],
  notes: string[],
  moves: (Move | null)[],
  source: { text: string; bounds: Rect },
  origin: { x: number; y: number },
  style: HandStyle,
  lib?: GlyphLibrary,
): Explained {
  const h = style.height
  const stepStyle = (i: number): HandStyle => ({ ...style, seed: style.seed + i * 7 })
  const noteStyle = (i: number): HandStyle => ({ ...style, height: h * 0.4, slant: style.slant * 0.5, seed: style.seed + 300 + i })
  const strokes: [number, number][][] = []
  const colors: string[] = []
  const noteStrokes: [number, number][][] = []
  const noteColors: string[] = []
  const push = (ss: Pt[][], color: string) => {
    for (const s of ss) {
      strokes.push(s.map(([x, y]) => [x, y] as [number, number]))
      colors.push(color)
    }
  }
  // positions of each line
  const lines: { x: number; top: number; bottom: number; base: number; text: string; style: HandStyle; width: number }[] = []
  let y = origin.y
  for (let i = 0; i < steps.length; i++) {
    const st = stepStyle(i)
    const c = compose(steps[i], st, lib)
    const top = y - c.top
    const isLast = i === steps.length - 1
    const color = isLast ? MOVE_RED : STEP_BLUE
    const shifted = c.strokes.map((s) => s.map(([a, b]) => [a + origin.x, b + top] as Pt))
    // the term that just moved across "=" is written in red
    const mv = moves[i]
    const dest = mv ? findTerm(steps[i], mv.becomes, true) : null
    const isDiv = !!mv && mv.becomes.startsWith('/')
    // a moved divisor is the denominator, composed last: colour just its strokes
    const red = isDiv ? [c.strokes.length - compose(mv!.becomes.replace(/[/()]/g, ''), st, lib).strokes.length, c.strokes.length] as [number, number] : dest ? strokeRange(steps[i], dest[0], dest[1], st, lib) : null
    shifted.forEach((s, k) => push([s], red && k >= red[0] && k < red[1] ? MOVE_RED : color))
    lines.push({ x: origin.x, top: top + c.top, bottom: top + c.bottom, base: top + h, text: steps[i], style: st, width: c.width })
    // a short note in grey to the right of the line
    const note = notes[i] && notes[i] !== 'answer' ? notes[i] : ''
    if (note) {
      const nc = compose(note, noteStyle(i), lib)
      const nx = origin.x + c.width + h * 1.1
      const ny = top + h * 0.55 - (nc.bottom + nc.top) / 2
      for (const s of nc.strokes) {
        noteStrokes.push(s.map(([a, b]) => [a + nx, b + ny] as [number, number]))
        noteColors.push(mv ? MOVE_RED : NOTE_GREY)
      }
    }
    y = top + c.bottom + h * 0.75
  }
  // arrows: from the term in the line above to where it lands in this line
  for (let i = 0; i < steps.length; i++) {
    const mv = moves[i]
    if (!mv) continue
    const dest = findTerm(steps[i], mv.becomes, true)
    if (!dest) continue
    const L = lines[i]
    const [d0, d1] = span(steps[i], dest[0], dest[1], L.style, lib)
    // a divisor lands under the fraction bar: come in from the right, at the denominator
    const div = mv.becomes.startsWith('/')
    const ex = div ? L.x + L.width + h * 0.12 : L.x + (d0 + d1) / 2
    const ey = div ? L.bottom - h * 0.3 : L.top - h * 0.08
    const from = sideOf(steps[i], dest[0]) === 'left' ? 'right' : 'left'
    let sx: number, sy: number
    if (i === 0) {
      // in the student's own ink: estimate where the term sits along their line
      const src = findOnSide(source.text, mv.find, from) ?? findTerm(source.text, mv.find)
      if (!src) continue
      const compactLen = source.text.replace(/\s+/g, '').length || 1
      const before = source.text.slice(0, src[0]).replace(/\s+/g, '').length
      const len = mv.find.replace(/\s+/g, '').length
      sx = source.bounds.x + source.bounds.w * ((before + len / 2) / compactLen)
      sy = source.bounds.y + source.bounds.h + h * 0.05
    } else {
      const P = lines[i - 1]
      const src = findOnSide(P.text, mv.find, from) ?? findTerm(P.text, mv.find)
      if (!src) continue
      const [s0, s1] = span(P.text, src[0], src[1], P.style, lib)
      sx = P.x + (s0 + s1) / 2
      sy = P.base + h * 0.12
    }
    push(arrow(sx, sy, ex, ey, h), MOVE_RED)
  }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const s of [...strokes, ...noteStrokes]) for (const [a, b] of s) { x0 = Math.min(x0, a); y0 = Math.min(y0, b); x1 = Math.max(x1, a); y1 = Math.max(y1, b) }
  return { strokes, colors, bounds: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, notes: { strokes: noteStrokes, colors: noteColors } }
}
