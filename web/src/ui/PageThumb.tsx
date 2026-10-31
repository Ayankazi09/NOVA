// A page-shaped miniature of what is actually written on a page (student ink, NOVA ink, PDF sheet lines).

import { useEffect, useRef } from 'react'
import type { Page } from '../notebook/types'

/** A page-shaped miniature (3:4) of the top of the page: grid, the student's ink, NOVA's ink, a PDF sheet's lines. */
export function PageThumb({ page, aspect = 4 / 3 }: { page?: Page; aspect?: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current
    if (!c) return
    const dpr = window.devicePixelRatio || 1
    const W = c.clientWidth || 180
    const H = Math.round(W * aspect)
    c.width = W * dpr
    c.height = H * dpr
    const ctx = c.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, W, H)
    // frame the part of the page that has writing on it (a sheet's width for imported papers)
    let x0 = 0, y0 = 0, x1 = 1200
    if (page) {
      const xs: number[] = [], ys: number[] = []
      for (const s of page.strokes) for (const p of s.points) { xs.push(p.x); ys.push(p.y) }
      for (const t of page.tutorObjects) if (t.status !== 'dismissed' && t.action.type === 'write_ink') for (const st of t.action.strokes) for (const [x, y] of st) { xs.push(x); ys.push(y) }
      if (page.bg) { x1 = page.bg.w } else if (xs.length) {
        const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys)
        const w = Math.max(560, (maxX - minX) * 1.25, ((maxY - minY) * 1.2) / aspect)
        x0 = Math.max(0, minX - w * 0.1)
        y0 = Math.max(0, minY - w * aspect * 0.12)
        x1 = x0 + w
      }
    }
    const s = W / (x1 - x0)
    const step = 24 * s
    if (step >= 3) {
      ctx.strokeStyle = '#eef0f4'
      ctx.lineWidth = 1
      for (let x = step; x < W; x += step) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke() }
      for (let y = step; y < H; y += step) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke() }
    }
    if (!page) return
    ctx.setTransform(dpr * s, 0, 0, dpr * s, -x0 * s * dpr, -y0 * s * dpr)
    if (page.bg) {
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, page.bg.w, page.bg.h)
      ctx.fillStyle = '#c7ccd6'
      for (const l of page.docText ?? []) ctx.fillRect(l.x, l.y + l.h * 0.3, l.w, l.h * 0.4)
    }
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    for (const st of page.strokes) {
      ctx.strokeStyle = st.colour
      ctx.lineWidth = Math.max(st.width, 1.2 / s)
      ctx.beginPath()
      st.points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)))
      ctx.stroke()
    }
    for (const t of page.tutorObjects) {
      if (t.status === 'dismissed' || t.action.type !== 'write_ink') continue
      const a = t.action
      a.strokes.forEach((st, i) => {
        ctx.strokeStyle = a.colors?.[i] ?? (a.tone === 'correct' ? '#2e7d4f' : a.tone === 'wrong' ? '#c2352e' : '#245c9c')
        ctx.lineWidth = Math.max(a.width, 1.2 / s)
        ctx.beginPath()
        st.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
        ctx.stroke()
      })
    }
  }, [page])
  return <canvas ref={ref} className="doc-thumb" />
}
