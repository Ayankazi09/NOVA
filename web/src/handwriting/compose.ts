// Compose a maths answer ("5", "√3/2", "a² + 2ab + b²", "θ = 30° or θ = 150°") into pen strokes.
// Layout supports superscripts, square roots with an overbar and stacked fractions. Style (height, slant,
// stroke width) is copied from the student's line; small seeded variations keep repeats from looking stamped.

import { GLYPHS, SPACE_W, type Glyph, type Pt } from './glyphs'

export interface HandStyle {
  height: number // digit height in page units
  slant: number // shear factor (dx per unit of height); positive leans right
  width: number // pen width in page units
  seed: number
}

export type GlyphLibrary = Record<string, Glyph[]> // personal samples from calibration

export interface Composed {
  strokes: Pt[][] // page-unit polylines, origin = left of the line, y = 0 at digit top, y = height at baseline
  width: number
  top: number // min y (fractions/superscripts can rise above 0)
  bottom: number // max y (descenders, denominators)
}

// ----------------------------------------------------------------- random

function rng(seed: number) {
  let s = (seed >>> 0) || 1
  return () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return ((s >>> 0) % 100000) / 100000
  }
}

// ----------------------------------------------------------------- parse

type Node =
  | { k: 'ch'; c: string }
  | { k: 'sp' }
  | { k: 'sup'; body: Node[] }
  | { k: 'sqrt'; body: Node[] }
  | { k: 'frac'; num: Node[]; den: Node[] }

const SUP_MAP: Record<string, string> = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁻': '-' }

function readGroup(s: string, i: number): [string, number] {
  // "(...)" balanced, or a run of digits/letters/. (and a leading minus)
  if (s[i] === '(') {
    let depth = 0
    for (let j = i; j < s.length; j++) {
      if (s[j] === '(') depth++
      else if (s[j] === ')' && --depth === 0) return [s.slice(i + 1, j), j + 1]
    }
    return [s.slice(i + 1), s.length]
  }
  let j = i
  if (s[j] === '-') j++
  while (j < s.length && /[0-9a-zA-Zθπαβφ.]/.test(s[j])) j++
  return [s.slice(i, j), j]
}

function parseInline(s: string): Node[] {
  const out: Node[] = []
  let i = 0
  while (i < s.length) {
    const c = s[i]
    if (c === ' ') {
      out.push({ k: 'sp' })
      i++
    } else if (c in SUP_MAP) {
      let run = ''
      while (i < s.length && s[i] in SUP_MAP) run += SUP_MAP[s[i++]]
      out.push({ k: 'sup', body: parseInline(run) })
    } else if (c === '^') {
      const [grp, j] = readGroup(s, i + 1)
      out.push({ k: 'sup', body: parseInline(grp) })
      i = j
    } else if (c === '√') {
      const [grp, j] = readGroup(s, i + 1)
      out.push({ k: 'sqrt', body: parseInline(grp) })
      i = j
    } else if (c === '*') {
      out.push({ k: 'ch', c: '·' })
      i++
    } else {
      out.push({ k: 'ch', c })
      i++
    }
  }
  return out
}

/** Words like "1/2", "√3/2", "-3x/2" become stacked fractions; everything else is inline. */
export function parse(text: string): Node[] {
  const out: Node[] = []
  const words = text.trim().split(/\s+/)
  words.forEach((w, idx) => {
    if (idx) out.push({ k: 'sp' })
    const m = /^(-?)([^/()]+|\([^/]+\))\/([^/()]+|\([^/]+\))$/.exec(w)
    if (m && !/[=<>]/.test(w)) {
      if (m[1]) out.push({ k: 'ch', c: '-' })
      const strip = (t: string) => (t.startsWith('(') && t.endsWith(')') ? t.slice(1, -1) : t)
      out.push({ k: 'frac', num: parseInline(strip(m[2])), den: parseInline(strip(m[3])) })
    } else out.push(...parseInline(w))
  })
  return out
}

// ----------------------------------------------------------------- layout

interface Placed {
  strokes: Pt[][]
  w: number
  top: number
  bottom: number
}

function catmull(points: Pt[], steps = 6): Pt[] {
  if (points.length < 3) return points
  const p = [points[0], ...points, points[points.length - 1]]
  const out: Pt[] = []
  for (let i = 1; i < p.length - 2; i++) {
    for (let t = 0; t < steps; t++) {
      const u = t / steps, u2 = u * u, u3 = u2 * u
      const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u2 + (-a + 3 * b - 3 * c + d) * u3)
      out.push([f(p[i - 1][0], p[i][0], p[i + 1][0], p[i + 2][0]), f(p[i - 1][1], p[i][1], p[i + 1][1], p[i + 2][1])])
    }
  }
  out.push(points[points.length - 1])
  return out
}

const ALIAS: Record<string, string> = { '—': '-', '–': '-', '−': '-', '‐': '-', '×': '×', '⋅': '·', '∙': '·', '’': "'", 'ʹ': "'", ':': '·', ';': ',' }

function glyphFor(c0: string, lib: GlyphLibrary | undefined, rand: () => number): { glyph: Glyph; personal: boolean } {
  const c = ALIAS[c0] ?? c0
  const samples = lib?.[c]
  if (samples?.length) return { glyph: samples[Math.floor(rand() * samples.length) % samples.length], personal: true }
  const builtin = GLYPHS[c] ?? GLYPHS[c.toLowerCase()]
  return { glyph: builtin ?? GLYPHS['·'], personal: false }
}

function layout(nodes: Node[], size: number, style: HandStyle, lib: GlyphLibrary | undefined, rand: () => number): Placed {
  // baseline at y = size (digit top at y = 0) in local coordinates
  const strokes: Pt[][] = []
  let x = 0
  let top = 0
  let bottom = size
  const add = (p: Placed, dx: number, dy: number) => {
    for (const s of p.strokes) strokes.push(s.map(([a, b]) => [a + dx, b + dy] as Pt))
    top = Math.min(top, p.top + dy)
    bottom = Math.max(bottom, p.bottom + dy)
  }
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]
    if (n.k === 'sp') {
      x += SPACE_W * size
      continue
    }
    if (n.k === 'ch') {
      const { glyph, personal } = glyphFor(n.c, lib, rand)
      const scale = size * (1 + (rand() - 0.5) * 0.06)
      const lift = (rand() - 0.5) * 0.04 * size
      const rot = (rand() - 0.5) * 0.05
      const noise = personal ? 0 : 0.008
      const cx = glyph.w / 2, cy = 0.5
      const local = glyph.strokes.map((st) =>
        catmull(
          st.map(([px, py]) => {
            const qx = px - cx, qy = py - cy
            const rx = qx * Math.cos(rot) - qy * Math.sin(rot) + cx + (rand() - 0.5) * noise
            const ry = qx * Math.sin(rot) + qy * Math.cos(rot) + cy + (rand() - 0.5) * noise
            return [rx * scale, ry * scale + lift + (size - scale)] as Pt
          }),
        ),
      )
      let gTop = Infinity, gBot = -Infinity
      for (const s of local) for (const [, b] of s) { gTop = Math.min(gTop, b); gBot = Math.max(gBot, b) }
      add({ strokes: local, w: glyph.w * scale, top: gTop, bottom: gBot }, x, 0)
      x += glyph.w * scale * (0.96 + rand() * 0.08)
      continue
    }
    if (n.k === 'sup') {
      const inner = layout(n.body, size * 0.5, style, lib, rand)
      add(inner, x + size * 0.03, -size * 0.18)
      x += inner.w + size * 0.08
      continue
    }
    if (n.k === 'sqrt') {
      const inner = layout(n.body, size, style, lib, rand)
      const h = inner.bottom - Math.min(0, inner.top) + size * 0.16
      const topY = Math.min(0, inner.top) - size * 0.12
      const rw = size * 0.5
      const radical: Pt[] = catmull([[0, topY + h * 0.62], [rw * 0.22, topY + h * 0.55], [rw * 0.45, topY + h], [rw * 0.72, topY + h * 0.35], [rw, topY]].map(([a, b]) => [a + x, b] as Pt), 4)
      const bar: Pt[] = [[x + rw, topY], [x + rw + inner.w * 0.5, topY - size * 0.01], [x + rw + inner.w + size * 0.08, topY + size * 0.01]]
      strokes.push(radical, bar)
      top = Math.min(top, topY - size * 0.04)
      add(inner, x + rw + size * 0.04, 0)
      x += rw + inner.w + size * 0.14
      continue
    }
    // stacked fraction: bar at the height of a '-' sign
    const fs = size * 0.68
    const num = layout(n.num, fs, style, lib, rand)
    const den = layout(n.den, fs, style, lib, rand)
    const w = Math.max(num.w, den.w) + size * 0.2
    const barY = size * 0.6
    const nx = x + (w - num.w) / 2, dx = x + (w - den.w) / 2
    add(num, nx, barY - size * 0.16 - num.bottom)
    add(den, dx, barY + size * 0.14 - Math.min(0, den.top))
    strokes.push([[x + size * 0.02, barY + size * 0.01], [x + w / 2, barY], [x + w - size * 0.02, barY - size * 0.01]])
    x += w + size * 0.08
  }
  return { strokes, w: x, top, bottom }
}

export function compose(text: string, style: HandStyle, lib?: GlyphLibrary): Composed {
  const rand = rng(style.seed)
  const placed = layout(parse(text), style.height, style, lib, rand)
  // slant: shear around the baseline so handwriting leans like the student's
  const strokes = placed.strokes.map((s) => s.map(([x, y]) => [x + (style.height - y) * style.slant, y] as Pt))
  return { strokes, width: placed.w + Math.max(0, style.slant) * style.height, top: placed.top, bottom: placed.bottom }
}
