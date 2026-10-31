import type { Paper, Point, Stroke } from './types'

export const INK_COLOURS = [
  { name: 'Charcoal', value: '#20252B' },
  { name: 'Blue', value: '#245C9C' },
  { name: 'Red', value: '#C2352E' },
]
export const INK_WIDTHS = [
  { name: 'Fine', value: 2.2 },
  { name: 'Medium', value: 3.6 },
  { name: 'Bold', value: 6 },
]

/** Smooth stroke through midpoints. Pressure mildly modulates width when the device reports it. */
export function drawStroke(ctx: CanvasRenderingContext2D, s: Pick<Stroke, 'points' | 'colour' | 'width'>, widthOverride?: number) {
  const pts = s.points
  const width = widthOverride ?? s.width
  ctx.strokeStyle = s.colour
  ctx.fillStyle = s.colour
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  if (pts.length === 1) {
    ctx.beginPath()
    ctx.arc(pts[0].x, pts[0].y, width / 2, 0, Math.PI * 2)
    ctx.fill()
    return
  }
  const hasPressure = pts.some((p) => p.pressure !== undefined && p.pressure !== 0.5 && p.pressure > 0)
  if (!hasPressure) {
    ctx.lineWidth = width
    ctx.beginPath()
    ctx.moveTo(pts[0].x, pts[0].y)
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i].x + pts[i + 1].x) / 2
      const my = (pts[i].y + pts[i + 1].y) / 2
      ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my)
    }
    const last = pts[pts.length - 1]
    ctx.lineTo(last.x, last.y)
    ctx.stroke()
    return
  }
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i]
    const pr = ((a.pressure ?? 0.5) + (b.pressure ?? 0.5)) / 2
    ctx.lineWidth = width * (0.6 + 0.8 * pr)
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.stroke()
  }
}

export interface View {
  scale: number
  tx: number
  ty: number
}

export const GRID_MINOR = 24
export const GRID_MAJOR = 120

/** Grid is a presentation layer: drawn at device pixel ratio, aligned to the same page transform as ink. */
export function drawPaper(ctx: CanvasRenderingContext2D, paper: Paper, pageW: number, pageH: number, view: View, dpr: number, cssW: number, cssH: number, infinite = false) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, cssW, cssH)
  let x0 = view.tx, y0 = view.ty, w = pageW * view.scale, h = pageH * view.scale
  if (infinite) {
    // an endless sheet: paper and grid cover the whole screen, no edges
    x0 = 0
    y0 = 0
    w = cssW
    h = cssH
  } else {
    // warm paper with a soft lift off the desk
    ctx.fillStyle = 'rgba(42, 34, 20, 0.10)'
    ctx.fillRect(x0 + 2, y0 + 3, w, h)
  }
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(x0, y0, w, h)
  if (paper === 'blank') return
  const visX0 = infinite ? (0 - view.tx) / view.scale : Math.max(0, (0 - view.tx) / view.scale)
  const visX1 = infinite ? (cssW - view.tx) / view.scale : Math.min(pageW, (cssW - view.tx) / view.scale)
  const visY0 = infinite ? (0 - view.ty) / view.scale : Math.max(0, (0 - view.ty) / view.scale)
  const visY1 = infinite ? (cssH - view.ty) / view.scale : Math.min(pageH, (cssH - view.ty) / view.scale)
  const crisp = (v: number) => Math.round(v * dpr) / dpr + 0.5 / dpr
  ctx.lineWidth = 1 / dpr
  if (paper === 'ruled') {
    ctx.strokeStyle = '#DCE2E8'
    ctx.beginPath()
    for (let y = Math.max(72, Math.ceil(visY0 / 36) * 36); y <= (infinite ? visY1 : pageH); y += 36) {
      if (y < visY0 || y > visY1) continue
      const sy = crisp(view.ty + y * view.scale)
      ctx.moveTo(x0, sy)
      ctx.lineTo(x0 + w, sy)
    }
    ctx.stroke()
    return
  }
  const minorPx = GRID_MINOR * view.scale
  for (const pass of ['minor', 'major'] as const) {
    const step = pass === 'minor' ? GRID_MINOR : GRID_MAJOR
    if (pass === 'minor' && minorPx < 6) continue // suppress dense minor lines
    ctx.strokeStyle = pass === 'minor' ? '#E8ECF0' : '#DCE2E8'
    ctx.beginPath()
    for (let x = Math.ceil(visX0 / step) * step; x <= visX1; x += step) {
      if (pass === 'minor' && x % GRID_MAJOR === 0) continue
      const sx = crisp(view.tx + x * view.scale)
      ctx.moveTo(sx, Math.max(0, y0))
      ctx.lineTo(sx, Math.min(cssH, y0 + h))
    }
    for (let y = Math.ceil(visY0 / step) * step; y <= visY1; y += step) {
      if (pass === 'minor' && y % GRID_MAJOR === 0) continue
      const sy = crisp(view.ty + y * view.scale)
      ctx.moveTo(Math.max(0, x0), sy)
      ctx.lineTo(Math.min(cssW, x0 + w), sy)
    }
    ctx.stroke()
  }
}

export function toPage(view: View, sx: number, sy: number): Point {
  return { x: (sx - view.tx) / view.scale, y: (sy - view.ty) / view.scale }
}
