// A geometry figure drawn by hand: named points joined by ruled lines (solid or dashed), circles, corner
// letters, side lengths, angle marks and right-angle squares. The figure comes in maths coordinates (y up) and is
// drawn to scale in page units, so a 3-4-5 triangle looks like one. Labels are placed away from the shape so they
// never sit on a line.

import type { TutorAction } from '../notebook/types'
import { INK, composeLines, type Block } from './blocks'
import { compose, type GlyphLibrary, type HandStyle } from './compose'
import type { Pt } from './glyphs'

export type Figure = Extract<TutorAction, { type: 'draw_figure' }>

const SIZE = 300 // the longer side of the drawing, in page units
const MIN_SIDE = 90 // a very flat shape still gets some height
const PAD = 64 // room around the drawing for letters and lengths

type V = { x: number; y: number }
const sub = (a: V, b: V): V => ({ x: a.x - b.x, y: a.y - b.y })
const add = (a: V, b: V): V => ({ x: a.x + b.x, y: a.y + b.y })
const mul = (a: V, k: number): V => ({ x: a.x * k, y: a.y * k })
const len = (a: V) => Math.hypot(a.x, a.y)
const unit = (a: V): V => {
  const l = len(a)
  return l < 1e-9 ? { x: 0, y: -1 } : { x: a.x / l, y: a.y / l }
}

/** A line drawn along a ruler: straight, with the faintest waver. */
function ruled(a: V, b: V, seed: number): Pt[] {
  const d = sub(b, a)
  const n = Math.max(2, Math.round(len(d) / 40))
  const nrm = unit({ x: -d.y, y: d.x })
  const out: Pt[] = []
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const wob = i === 0 || i === n ? 0 : Math.sin((seed + i) * 2.3) * 0.7
    out.push([a.x + d.x * t + nrm.x * wob, a.y + d.y * t + nrm.y * wob])
  }
  return out
}

function dashes(a: V, b: V): Pt[][] {
  const d = sub(b, a)
  const L = len(d)
  const u = unit(d)
  const out: Pt[][] = []
  for (let s = 0; s < L; s += 16) {
    const e = Math.min(L, s + 9)
    out.push([[a.x + u.x * s, a.y + u.y * s], [a.x + u.x * e, a.y + u.y * e]])
  }
  return out
}

function arcStroke(c: V, r: number, from: number, sweep: number, seed = 0): Pt[] {
  const n = Math.max(6, Math.round((Math.abs(sweep) * r) / 9))
  const out: Pt[] = []
  for (let i = 0; i <= n; i++) {
    const a = from + (sweep * i) / n
    // round, with one slow breath of unevenness (a fast wobble makes the outline look lumpy)
    const rr = r + Math.sin(seed + (i / n) * Math.PI * 2) * Math.min(1.2, r * 0.008)
    out.push([c.x + rr * Math.cos(a), c.y + rr * Math.sin(a)])
  }
  return out
}

export function composeFigure(fig: Figure, style: HandStyle, lib?: GlyphLibrary): Block & { colors: string[] } {
  const strokes: Pt[][] = []
  const colors: string[] = []
  const push = (s: Pt[][], colour: string) => {
    for (const st of s) {
      strokes.push(st)
      colors.push(colour)
    }
  }

  // ---- maths coordinates -> page units (y flipped), to scale
  const names = Object.keys(fig.points)
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  const grow = (x: number, y: number) => {
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y)
  }
  for (const n of names) grow(fig.points[n][0], fig.points[n][1])
  for (const c of fig.circles ?? []) {
    const p = fig.points[c.center]
    if (!p) continue
    grow(p[0] - c.radius, p[1] - c.radius)
    grow(p[0] + c.radius, p[1] + c.radius)
  }
  const spanX = Math.max(x1 - x0, 1e-9), spanY = Math.max(y1 - y0, 1e-9)
  const k = SIZE / Math.max(spanX, spanY)
  const w = Math.max(spanX * k, MIN_SIDE), h = Math.max(spanY * k, MIN_SIDE)
  const ox = PAD + (w - spanX * k) / 2, oy = PAD + (h - spanY * k) / 2
  const P = (n: string): V | undefined => {
    const p = fig.points[n]
    return p ? { x: ox + (p[0] - x0) * k, y: oy + (y1 - p[1]) * k } : undefined
  }
  const centre: V = (() => {
    const ps = names.map((n) => P(n)!)
    return mul(ps.reduce(add, { x: 0, y: 0 }), 1 / ps.length)
  })()

  // ---- title above
  let top = 0
  if (fig.title?.trim()) {
    const t = composeLines(fig.title, [], style, lib)
    push(t.strokes, INK.black)
    top = t.h + style.height * 0.2
  }
  const place = (s: Pt[][]): Pt[][] => s.map((st) => st.map(([x, y]) => [x, y + top] as Pt))

  // ---- lines and circles
  const neighbours = new Map<string, V[]>() // for angle marks: the directions leaving each corner
  const link = (a: string, b: string) => {
    const pa = P(a), pb = P(b)
    if (!pa || !pb) return
    neighbours.set(a, [...(neighbours.get(a) ?? []), unit(sub(pb, pa))])
    neighbours.set(b, [...(neighbours.get(b) ?? []), unit(sub(pa, pb))])
  }
  ;(fig.segments ?? []).forEach(([a, b], i) => {
    const pa = P(a), pb = P(b)
    if (!pa || !pb) return
    push(place([ruled(pa, pb, style.seed + i * 3)]), INK.black)
    link(a, b)
  })
  for (const [a, b] of fig.dashed ?? []) {
    const pa = P(a), pb = P(b)
    if (pa && pb) push(place(dashes(pa, pb)), INK.blue)
  }
  for (const c of fig.circles ?? []) {
    const pc = P(c.center)
    if (!pc) continue
    push(place([arcStroke(pc, c.radius * k, -Math.PI / 2, Math.PI * 2 + 0.12, style.seed)]), INK.black)
    push(place([arcStroke(pc, 1.6, 0, Math.PI * 2)]), INK.black) // the centre dot
  }

  // ---- text helper: a label centred on a point
  const label = (text: string, at: V, colour: string, size = 0.82) => {
    const c = compose(text, { ...style, height: style.height * size, seed: style.seed + text.length * 13 }, lib)
    const lh = c.bottom - c.top
    push(place(c.strokes.map((st) => st.map(([x, y]) => [x + at.x - c.width / 2, y - c.top + at.y - lh / 2] as Pt))), colour)
  }
  const gap = style.height * 0.72

  // ---- corner letters: pushed outwards, away from the shape
  for (const n of names) {
    const p = P(n)!
    const dirs = neighbours.get(n) ?? []
    // away from the lines that meet here; a lone point (a circle's centre) gets its letter below-left
    const away = dirs.length ? unit(mul(dirs.reduce(add, { x: 0, y: 0 }), -1)) : len(sub(p, centre)) > 1 ? unit(sub(p, centre)) : unit({ x: -1, y: 1 })
    const out = dirs.length >= 2 && len(dirs.reduce(add, { x: 0, y: 0 })) < 0.2 ? unit(sub(p, centre)) : away // a point on a straight line
    label(n, add(p, mul(len(out) ? out : { x: -0.7, y: 0.7 }, gap)), INK.black, 0.9)
  }

  // ---- side lengths: beside the middle of the side, on the outside
  for (const l of fig.sideLabels ?? []) {
    const pa = P(l.between[0]), pb = P(l.between[1])
    if (!pa || !pb) continue
    const mid = mul(add(pa, pb), 0.5)
    const d = unit(sub(pb, pa))
    let nrm: V = { x: -d.y, y: d.x }
    if (nrm.x * (mid.x - centre.x) + nrm.y * (mid.y - centre.y) < 0) nrm = mul(nrm, -1)
    // a wide label beside a steep side needs more room than one above a flat side
    const c = compose(l.text, { ...style, height: style.height * 0.78, seed: style.seed }, lib)
    const reach = gap * 0.75 + Math.abs(nrm.x) * c.width * 0.5 + Math.abs(nrm.y) * style.height * 0.3
    label(l.text, add(mid, mul(nrm, reach)), INK.blue, 0.78)
  }
  for (const c of fig.circles ?? []) {
    const pc = P(c.center)
    if (pc && c.label) label(c.label, add(pc, { x: 0, y: c.radius * k + gap }), INK.blue, 0.78)
  }

  // ---- right angles and angle sizes, inside the corner
  const corner = (n: string): [V, V] | null => {
    const d = neighbours.get(n) ?? []
    return d.length >= 2 ? [d[0], d[1]] : null
  }
  for (const n of fig.rightAngles ?? []) {
    const p = P(n), c = corner(n)
    if (!p || !c) continue
    const s = 15
    const a = add(p, mul(c[0], s)), b = add(p, mul(c[1], s)), m = add(a, mul(c[1], s))
    push(place([[[a.x, a.y], [m.x, m.y]], [[m.x, m.y], [b.x, b.y]]]), INK.red)
  }
  for (const l of fig.angleLabels ?? []) {
    const p = P(l.at), c = corner(l.at)
    if (!p) continue
    const right = (fig.rightAngles ?? []).includes(l.at)
    let bis = c ? add(c[0], c[1]) : sub(centre, p)
    if (len(bis) < 0.05) bis = sub(centre, p)
    bis = unit(bis)
    if (c && !right) {
      const a0 = Math.atan2(c[0].y, c[0].x)
      let sweep = Math.atan2(c[1].y, c[1].x) - a0
      while (sweep > Math.PI) sweep -= Math.PI * 2
      while (sweep < -Math.PI) sweep += Math.PI * 2
      push(place([arcStroke(p, 24, a0, sweep)]), INK.red)
    }
    if (l.text) label(l.text, add(p, mul(bis, 24 + style.height * 0.85)), INK.red, 0.7)
  }

  // ---- notes underneath
  let bottom = top + h + PAD * 2
  if (fig.notes?.length) {
    const notes = composeLines('', fig.notes, { ...style, seed: style.seed + 41 }, lib, fig.notes.map((_, i) => (i === fig.notes!.length - 1 && fig.notes!.length > 1 ? 'red' : 'blue')))
    push(notes.strokes.map((st) => st.map(([x, y]) => [x, y + bottom] as Pt)), '')
    // composeLines carries its own colours
    notes.colors?.forEach((col, i) => (colors[colors.length - notes.strokes.length + i] = col))
    bottom += notes.h
  }

  // ---- normalise: nothing left of x = 0 or above y = 0
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const st of strokes) for (const [x, y] of st) {
    minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y)
  }
  const dx = minX < 0 ? -minX : 0, dy = minY < 0 ? -minY : 0
  const moved = dx || dy ? strokes.map((st) => st.map(([x, y]) => [x + dx, y + dy] as Pt)) : strokes
  return { strokes: moved, colors, w: Math.max(maxX + dx, w + PAD * 2), h: Math.max(maxY + dy, bottom) }
}

/** What the figure says, in words: kept as the object's text so NOVA can read its own page later. */
export function figureText(fig: Figure): string {
  const parts = [fig.title || 'Figure']
  parts.push(`points ${Object.keys(fig.points).join(', ')}`)
  for (const l of fig.sideLabels ?? []) parts.push(`${l.between.join('')} = ${l.text}`)
  for (const l of fig.angleLabels ?? []) parts.push(`∠${l.at} = ${l.text}`)
  for (const c of fig.circles ?? []) parts.push(`circle centre ${c.center}${c.label ? ` (${c.label})` : ''}`)
  return [parts.join('; '), ...(fig.notes ?? [])].join('\n')
}
