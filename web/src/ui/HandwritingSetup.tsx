// "Teach NOVA your handwriting": write each character in a guided box; NOVA then writes its answers
// with your own shapes. Samples stay on this device and can be deleted at any time.

import { useEffect, useMemo, useRef, useState } from 'react'
import { compose, type GlyphLibrary } from '../handwriting/compose'
import type { Glyph, Pt } from '../handwriting/glyphs'
import { clearLibrary, getLibrary, saveLibrary } from '../handwriting/library'
import { Icon } from './icons'

// characters NOVA writes most: two samples for digits (natural variation), one for symbols
const CHARS: { c: string; n: number; hint?: string }[] = [
  ...'0123456789'.split('').map((c) => ({ c, n: 2 })),
  { c: '+', n: 1 }, { c: '-', n: 1, hint: 'minus' }, { c: '×', n: 1, hint: 'times' }, { c: '÷', n: 1 }, { c: '=', n: 1 },
  { c: '(', n: 1 }, { c: ')', n: 1 }, { c: '/', n: 1 }, { c: '.', n: 1, hint: 'point' }, { c: 'x', n: 1 }, { c: 'y', n: 1 },
  { c: 'θ', n: 1, hint: 'theta' }, { c: '√', n: 1, hint: 'root' }, { c: '✓', n: 1, hint: 'tick' }, { c: '✗', n: 1, hint: 'cross' },
]

const BOX_W = 72
const BOX_H = 92
const TOP = 0.2 * BOX_H // digit top guide
const BASE = 0.78 * BOX_H // baseline guide

type Sample = Pt[][] // box pixel coordinates

/** Box pixels -> unit glyph (y = 0 at the digit-top guide, 1 at the baseline). */
export function toGlyph(strokes: Sample): Glyph | null {
  const pts = strokes.flat()
  if (!pts.length) return null
  const h = BASE - TOP
  const minX = Math.min(...pts.map((p) => p[0]))
  const maxX = Math.max(...pts.map((p) => p[0]))
  const pad = 0.05
  const out = strokes
    .filter((s) => s.length)
    .map((s) => thin(s).map(([x, y]) => [(x - minX) / h + pad, (y - TOP) / h] as Pt))
  return { w: (maxX - minX) / h + 2 * pad + 0.04, strokes: out }
}

function thin(s: Pt[]): Pt[] {
  // keep the shape, drop jitter: at most ~24 points per stroke
  if (s.length <= 3) return s.length === 1 ? [s[0], [s[0][0] + 0.5, s[0][1] + 0.5]] : s
  const step = Math.max(1, Math.floor(s.length / 24))
  const out = s.filter((_, i) => i % step === 0)
  if (out[out.length - 1] !== s[s.length - 1]) out.push(s[s.length - 1])
  return out
}

function Box({ char, sample, onChange }: { char: string; sample: Sample; onChange: (s: Sample) => void }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const drawing = useRef<Pt[] | null>(null)
  const samples = useRef(sample)
  samples.current = sample

  const paint = () => {
    const c = ref.current
    if (!c) return
    const dpr = window.devicePixelRatio || 1
    const ctx = c.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, BOX_W, BOX_H)
    ctx.strokeStyle = '#e2ddd3'
    ctx.setLineDash([3, 4])
    for (const y of [TOP, BASE]) {
      ctx.beginPath()
      ctx.moveTo(6, y)
      ctx.lineTo(BOX_W - 6, y)
      ctx.stroke()
    }
    ctx.setLineDash([])
    if (!samples.current.length && !drawing.current) {
      ctx.fillStyle = '#d3cdc1'
      ctx.font = '32px "Instrument Serif", Georgia, serif'
      ctx.textAlign = 'center'
      ctx.fillText(char, BOX_W / 2, BASE - 6)
    }
    ctx.strokeStyle = '#1d2230'
    ctx.lineWidth = 3.2
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    for (const s of [...samples.current, ...(drawing.current ? [drawing.current] : [])]) {
      ctx.beginPath()
      s.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
      if (s.length === 1) ctx.lineTo(s[0][0] + 0.1, s[0][1] + 0.1)
      ctx.stroke()
    }
  }

  useEffect(() => {
    const c = ref.current!
    const dpr = window.devicePixelRatio || 1
    c.width = BOX_W * dpr
    c.height = BOX_H * dpr
    paint()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sample])

  const at = (e: React.PointerEvent): Pt => {
    const r = ref.current!.getBoundingClientRect()
    return [e.clientX - r.left, e.clientY - r.top]
  }
  return (
    <div className="hw-box">
      <canvas
        ref={ref}
        style={{ width: BOX_W, height: BOX_H, touchAction: 'none' }}
        aria-label={`Write ${char}`}
        onPointerDown={(e) => {
          ;(e.target as Element).setPointerCapture(e.pointerId)
          drawing.current = [at(e)]
          paint()
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return
          drawing.current.push(at(e))
          paint()
        }}
        onPointerUp={() => {
          if (drawing.current) onChange([...samples.current, drawing.current])
          drawing.current = null
        }}
        onPointerCancel={() => {
          drawing.current = null
          paint()
        }}
      />
      {sample.length > 0 && (
        <button className="hw-clear" aria-label={`Clear ${char}`} onClick={() => onChange([])}>
          <Icon.close />
        </button>
      )}
    </div>
  )
}

export function HandwritingSetup({ onClose, notify }: { onClose: () => void; notify: (m: string) => void }) {
  const [samples, setSamples] = useState<Record<string, Sample[]>>(() => Object.fromEntries(CHARS.map(({ c, n }) => [c, Array.from({ length: n }, () => [] as Sample)])))
  const existing = useMemo(() => getLibrary(), [])
  const hasExisting = Object.keys(existing).length > 0
  const filled = CHARS.filter(({ c }) => samples[c].some((s) => s.length)).length

  const library = useMemo<GlyphLibrary>(() => {
    const lib: GlyphLibrary = { ...existing }
    for (const { c } of CHARS) {
      const glyphs = samples[c].map(toGlyph).filter((g): g is Glyph => !!g)
      if (glyphs.length) lib[c] = glyphs
    }
    return lib
  }, [samples, existing])

  const preview = useMemo(() => {
    const out: string[] = []
    let y = 10
    for (const text of ['3 + 2 = 5', 'x = 4', '√2 ÷ 7 × (6 - 1) = 9', 'θ = 30 ✓']) {
      const c = compose(text, { height: 34, slant: 0.06, width: 2.6, seed: 4 }, library)
      const dy = y - c.top
      for (const s of c.strokes) out.push(s.map(([a, b]) => `${(a + 10).toFixed(1)},${(b + dy).toFixed(1)}`).join(' '))
      y += c.bottom - c.top + 16
    }
    return { lines: out, h: y }
  }, [library])

  const save = async () => {
    await saveLibrary(library)
    notify(`Saved. NOVA will now write ${filled ? 'with your handwriting' : 'in its own handwriting'} for the characters you taught it.`)
    onClose()
  }

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog hw-dialog" role="dialog" aria-label="Teach NOVA your handwriting" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-head">
          <h2>Teach NOVA your handwriting</h2>
          <button className="icon-btn" aria-label="Close" onClick={onClose}><Icon.close /></button>
        </div>
        <p className="muted">Write each character between the two guide lines, as you normally would. Skip any you like — NOVA uses its own shape for those. Your samples stay on this device.</p>
        <div className="hw-preview-wrap">
          <span className="hw-preview-label">How NOVA will write</span>
          <svg className="hw-preview" width="100%" height={preview.h * 0.7} viewBox={`0 0 520 ${preview.h}`} preserveAspectRatio="xMinYMin meet">
            {preview.lines.map((pts, i) => <polyline key={i} points={pts} />)}
          </svg>
        </div>
        <div className="hw-grid">
          {CHARS.map(({ c, hint }) => (
            <div key={c} className="hw-cell">
              <div className="hw-boxes">
                {samples[c].map((s, i) => (
                  <Box key={i} char={c} sample={s} onChange={(next) => setSamples((prev) => ({ ...prev, [c]: prev[c].map((x, j) => (j === i ? next : x)) }))} />
                ))}
              </div>
              <span className="hw-label">{c}{hint ? ` · ${hint}` : ''}</span>
            </div>
          ))}
        </div>
        <div className="row gap end">
          {hasExisting && (
            <button className="btn" onClick={async () => { await clearLibrary(); notify('Your handwriting samples were deleted. NOVA uses its own handwriting again.'); onClose() }}>
              Delete my samples
            </button>
          )}
          <span className="spacer" />
          <span className="muted">{filled} of {CHARS.length} taught</span>
          <button className="btn primary" disabled={!filled && !hasExisting} onClick={() => void save()}>Save</button>
        </div>
      </div>
    </div>
  )
}
