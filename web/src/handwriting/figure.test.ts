import { describe, expect, it } from 'vitest'
import { composeFigure, figureText, type Figure } from './figure'
import { hasGlyph } from './glyphs'

const style = { height: 30, slant: 0.08, width: 2.6, seed: 5 }
const base = { id: 'f', type: 'draw_figure' as const, anchorRegionId: 'page', title: '' }

function box(strokes: [number, number][][]) {
  const xs = strokes.flat().map((p) => p[0]), ys = strokes.flat().map((p) => p[1])
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) }
}

describe('composeFigure', () => {
  it('draws a triangle to scale, with every stroke coloured and nothing off the block', () => {
    const fig: Figure = {
      ...base, points: { A: [0, 0], B: [4, 0], C: [0, 3] }, segments: [['A', 'B'], ['B', 'C'], ['C', 'A']],
      sideLabels: [{ between: ['A', 'B'], text: '4 cm' }], rightAngles: ['A'], angleLabels: [{ at: 'B', text: '37°' }], notes: ['3² + 4² = 5²'],
    }
    const b = composeFigure(fig, style)
    expect(b.colors).toHaveLength(b.strokes.length)
    expect(b.colors.every((c) => /^#[0-9a-f]{6}$/i.test(c))).toBe(true)
    const bb = box(b.strokes)
    expect(bb.x0).toBeGreaterThanOrEqual(0)
    expect(bb.y0).toBeGreaterThanOrEqual(0)
    expect(bb.x1).toBeLessThanOrEqual(b.w + 0.01)
    expect(bb.y1).toBeLessThanOrEqual(b.h + 0.01)
    // the three sides are the long straight strokes: AB : CA must be 4 : 3
    const long = b.strokes.map((s) => Math.hypot(s[s.length - 1][0] - s[0][0], s[s.length - 1][1] - s[0][1])).filter((l) => l > 150).sort((x, y) => x - y)
    expect(long).toHaveLength(3)
    expect(long[1] / long[0]).toBeCloseTo(4 / 3, 1)
    expect(long[2] / long[0]).toBeCloseTo(5 / 3, 1)
  })

  it('draws a circle round its centre', () => {
    const b = composeFigure({ ...base, points: { O: [0, 0] }, segments: [], circles: [{ center: 'O', radius: 3, label: 'r = 3 cm' }] }, style)
    const ring = b.strokes.reduce((a, s) => (s.length > a.length ? s : a))
    const bb = box([ring])
    expect((bb.x1 - bb.x0) / (bb.y1 - bb.y0)).toBeCloseTo(1, 1)
    expect(bb.x1 - bb.x0).toBeGreaterThan(280)
  })

  it('describes the figure in words', () => {
    const t = figureText({ ...base, title: 'Square ABCD', points: { A: [0, 0], B: [1, 0] }, segments: [['A', 'B']], sideLabels: [{ between: ['A', 'B'], text: '4 cm' }] })
    expect(t).toContain('Square ABCD')
    expect(t).toContain('AB = 4 cm')
  })
})

describe('capital letters', () => {
  it('has its own glyph for every capital (corner letters must not turn into small letters)', async () => {
    const { GLYPHS } = await import('./glyphs')
    for (const c of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
      expect(c in GLYPHS, c).toBe(true)
      expect(hasGlyph(c)).toBe(true)
    }
  })
})
