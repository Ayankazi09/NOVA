// The writing surface: paper/grid canvas, background, ink canvas, live-stroke canvas and overlays,
// all sharing ONE page transform (view). Network work never runs on this path.

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { normRect, simplify, strokeHit } from './geometry'
import { drawPaper, drawStroke, toPage, type View } from './ink'
import type { Page, Point, Rect, Tool } from './types'

export const MIN_SCALE = 0.2
export const MAX_SCALE = 4

interface Props {
  page: Page
  tool: Tool
  colour: string
  width: number
  stylusOnly: boolean
  lasso: boolean
  view: View
  setView: (v: View | ((v: View) => View)) => void
  backgroundUrl?: string
  onSize: (w: number, h: number) => void
  onCommitStroke: (points: Point[]) => void
  onErase: (ids: string[]) => void
  onSelect: (sel: { rect?: Rect; lasso?: Point[]; tap?: Point }) => void
  onPenDown: () => void
  onPenUp: () => void
  onPenDetected: () => void
  pageLayer: ReactNode
  screenLayer: ReactNode
}

type Gesture =
  | { kind: 'draw'; pointerId: number; points: Point[] }
  | { kind: 'erase'; pointerId: number; ids: Set<string> }
  | { kind: 'select'; pointerId: number; start: Point; path: Point[] }
  | { kind: 'pan'; pointerId: number; lastX: number; lastY: number }
  | { kind: 'pinch'; ids: [number, number]; d0: number; mid0: { x: number; y: number }; view0: View }

/** Blank pages are an endless grid (it grows right and down); imported papers/photos keep their page shape. */
export const isInfinite = (_page: Page) => true // imported sheets sit on the same endless grid

export function clampView(v: View, page: Page, w: number, h: number): View {
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale))
  const pw = page.width * scale, ph = page.height * scale
  if (isInfinite(page)) {
    // the sheet starts at the top-left corner and keeps going: always room for one more screen of space
    const tx = Math.min(0, Math.max(-(pw + w * 0.75 - w), v.tx))
    const ty = Math.min(0, Math.max(-(ph + h * 0.75 - h), v.ty))
    return { scale, tx, ty }
  }
  const margin = 48
  const tx = pw + 2 * margin <= w ? (w - pw) / 2 : Math.min(margin, Math.max(w - pw - margin, v.tx))
  const ty = Math.min(margin + 80, Math.max(h - ph - margin, v.ty)) // room for the floating toolbar
  return { scale, tx, ty }
}

export function Workspace(p: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const paperRef = useRef<HTMLCanvasElement>(null)
  const inkRef = useRef<HTMLCanvasElement>(null)
  const liveRef = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [dpr, setDpr] = useState(() => window.devicePixelRatio || 1)
  const gesture = useRef<Gesture | null>(null)
  const pointers = useRef(new Map<number, { x: number; y: number; type: string }>())
  const erasing = useRef(new Set<string>())
  const props = useRef(p)
  props.current = p

  useLayoutEffect(() => {
    const el = hostRef.current!
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect()
      setSize({ w: Math.round(r.width), h: Math.round(r.height) })
      setDpr(window.devicePixelRatio || 1)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    if (size.w) p.onSize(size.w, size.h)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.w, size.h])

  useLayoutEffect(() => {
    for (const c of [paperRef.current, inkRef.current, liveRef.current]) {
      if (!c) continue
      c.width = Math.max(1, Math.round(size.w * dpr))
      c.height = Math.max(1, Math.round(size.h * dpr))
      c.style.width = `${size.w}px`
      c.style.height = `${size.h}px`
    }
  }, [size, dpr])

  useLayoutEffect(() => {
    const ctx = paperRef.current?.getContext('2d')
    if (ctx && size.w) drawPaper(ctx, p.page.backgroundAssetId ? 'squared' : p.page.paper, p.page.width, p.page.height, p.view, dpr, size.w, size.h, isInfinite(p.page))
  }, [p.page.paper, p.page.width, p.page.height, p.page.backgroundAssetId, p.view, size, dpr])

  const redrawInk = useCallback(() => {
    const c = inkRef.current
    const ctx = c?.getContext('2d')
    if (!c || !ctx) return
    const { view, page } = props.current
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, c.width, c.height)
    ctx.setTransform(dpr * view.scale, 0, 0, dpr * view.scale, dpr * view.tx, dpr * view.ty)
    for (const s of page.strokes) {
      if (erasing.current.has(s.id)) {
        ctx.globalAlpha = 0.18
        drawStroke(ctx, s)
        ctx.globalAlpha = 1
      } else drawStroke(ctx, s)
    }
  }, [dpr])

  useLayoutEffect(() => {
    redrawInk()
    const live = liveRef.current?.getContext('2d')
    if (live && gesture.current?.kind !== 'draw') {
      live.setTransform(1, 0, 0, 1, 0, 0)
      live.clearRect(0, 0, liveRef.current!.width, liveRef.current!.height)
    }
  }, [p.page.strokes, p.view, size, redrawInk])

  // ---- live layer helpers
  const liveCtx = () => {
    const ctx = liveRef.current!.getContext('2d')!
    const { view } = props.current
    ctx.setTransform(dpr * view.scale, 0, 0, dpr * view.scale, dpr * view.tx, dpr * view.ty)
    return ctx
  }
  const clearLive = () => {
    const c = liveRef.current!
    const ctx = c.getContext('2d')!
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, c.width, c.height)
  }

  const local = (e: { clientX: number; clientY: number }) => {
    const r = hostRef.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  const startPinch = () => {
    const ids = [...pointers.current.keys()].slice(0, 2) as [number, number]
    const a = pointers.current.get(ids[0])!, b = pointers.current.get(ids[1])!
    if (gesture.current?.kind === 'draw') clearLive() // discard the uncommitted stroke
    if (gesture.current?.kind === 'erase') {
      erasing.current.clear()
      redrawInk()
    }
    gesture.current = { kind: 'pinch', ids, d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, mid0: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, view0: props.current.view }
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return
    const pt = local(e)
    pointers.current.set(e.pointerId, { ...pt, type: e.pointerType })
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    const { tool, stylusOnly, view } = props.current
    if (e.pointerType === 'pen') props.current.onPenDetected()
    const touches = [...pointers.current.values()].filter((v) => v.type === 'touch').length
    if (e.pointerType === 'touch' && touches >= 2) return startPinch()
    if (gesture.current) return
    const pagePt = toPage(view, pt.x, pt.y)
    const touchPans = e.pointerType === 'touch' && stylusOnly
    if (tool === 'pan' || touchPans) {
      gesture.current = { kind: 'pan', pointerId: e.pointerId, lastX: pt.x, lastY: pt.y }
      return
    }
    if (tool === 'pen') {
      props.current.onPenDown()
      gesture.current = { kind: 'draw', pointerId: e.pointerId, points: [{ ...pagePt, pressure: e.pointerType === 'pen' ? e.pressure : undefined }] }
      const ctx = liveCtx()
      drawStroke(ctx, { points: gesture.current.points, colour: props.current.colour, width: props.current.width })
    } else if (tool === 'eraser') {
      props.current.onPenDown()
      gesture.current = { kind: 'erase', pointerId: e.pointerId, ids: new Set() }
      eraseAt(pagePt)
    } else if (tool === 'select') {
      gesture.current = { kind: 'select', pointerId: e.pointerId, start: pagePt, path: [pagePt] }
    }
  }

  const eraseAt = (pt: Point) => {
    const g = gesture.current
    if (g?.kind !== 'erase') return
    const radius = 10 / props.current.view.scale
    let changed = false
    for (const s of props.current.page.strokes) {
      if (!g.ids.has(s.id) && strokeHit(s, pt, radius)) {
        g.ids.add(s.id)
        erasing.current.add(s.id)
        changed = true
      }
    }
    if (changed) redrawInk()
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return
    const pt = local(e)
    pointers.current.set(e.pointerId, { ...pt, type: e.pointerType })
    const g = gesture.current
    if (!g) return
    const { view } = props.current
    if (g.kind === 'pinch') {
      const a = pointers.current.get(g.ids[0]), b = pointers.current.get(g.ids[1])
      if (!a || !b) return
      const d = Math.hypot(a.x - b.x, a.y - b.y)
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
      const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, g.view0.scale * (d / g.d0)))
      const px = (g.mid0.x - g.view0.tx) / g.view0.scale, py = (g.mid0.y - g.view0.ty) / g.view0.scale
      props.current.setView({ scale, tx: mid.x - px * scale, ty: mid.y - py * scale })
      return
    }
    if ('pointerId' in g && g.pointerId !== e.pointerId) return
    if (g.kind === 'pan') {
      props.current.setView((v) => ({ ...v, tx: v.tx + pt.x - g.lastX, ty: v.ty + pt.y - g.lastY }))
      g.lastX = pt.x
      g.lastY = pt.y
      return
    }
    const events = (e.nativeEvent as PointerEvent).getCoalescedEvents?.() ?? [e.nativeEvent]
    if (g.kind === 'draw') {
      const ctx = liveCtx()
      ctx.strokeStyle = props.current.colour
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      for (const ce of events.length ? events : [e.nativeEvent]) {
        const lp = local(ce)
        const np = { ...toPage(view, lp.x, lp.y), pressure: e.pointerType === 'pen' ? ce.pressure : undefined }
        const prev = g.points[g.points.length - 1]
        g.points.push(np)
        const pr = np.pressure ?? 0.5
        ctx.lineWidth = np.pressure !== undefined ? props.current.width * (0.6 + 0.8 * pr) : props.current.width
        ctx.beginPath()
        ctx.moveTo(prev.x, prev.y)
        ctx.lineTo(np.x, np.y)
        ctx.stroke()
      }
    } else if (g.kind === 'erase') {
      for (const ce of events.length ? events : [e.nativeEvent]) {
        const lp = local(ce)
        eraseAt(toPage(view, lp.x, lp.y))
      }
    } else if (g.kind === 'select') {
      const pp = toPage(view, pt.x, pt.y)
      g.path.push(pp)
      clearLive()
      const ctx = liveCtx()
      ctx.setLineDash([6 / view.scale, 5 / view.scale])
      ctx.lineWidth = 1.5 / view.scale
      ctx.strokeStyle = '#245C9C'
      ctx.fillStyle = 'rgba(36,92,156,0.06)'
      ctx.beginPath()
      if (props.current.lasso) {
        ctx.moveTo(g.path[0].x, g.path[0].y)
        for (const q of g.path) ctx.lineTo(q.x, q.y)
        ctx.closePath()
      } else {
        const r = normRect(g.start, pp)
        ctx.rect(r.x, r.y, r.w, r.h)
      }
      ctx.fill()
      ctx.stroke()
      ctx.setLineDash([])
    }
  }

  const finish = (e: React.PointerEvent, cancelled: boolean) => {
    pointers.current.delete(e.pointerId)
    const g = gesture.current
    if (!g) return
    if (g.kind === 'pinch') {
      if (pointers.current.size === 0) gesture.current = null
      else if (!g.ids.includes(e.pointerId)) return
      else gesture.current = null
      return
    }
    if (g.pointerId !== e.pointerId) return
    gesture.current = null
    if (g.kind === 'draw') {
      if (!cancelled && g.points.length) props.current.onCommitStroke(simplify(g.points))
      else clearLive()
      props.current.onPenUp()
    } else if (g.kind === 'erase') {
      const ids = [...g.ids]
      erasing.current.clear()
      if (ids.length && !cancelled) props.current.onErase(ids)
      else redrawInk()
      props.current.onPenUp()
    } else if (g.kind === 'select') {
      clearLive()
      if (cancelled) return
      const last = g.path[g.path.length - 1]
      const moved = Math.hypot(last.x - g.start.x, last.y - g.start.y) * props.current.view.scale
      if (moved < 6) props.current.onSelect({ tap: g.start })
      else if (props.current.lasso && g.path.length > 4) props.current.onSelect({ lasso: g.path })
      else props.current.onSelect({ rect: normRect(g.start, last) })
    }
  }

  // wheel: scroll pans, ctrl/cmd+wheel (and trackpad pinch) zooms around the cursor
  useEffect(() => {
    const el = hostRef.current!
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const pt = local(e)
      props.current.setView((v) => {
        if (e.ctrlKey || e.metaKey) {
          const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * Math.exp(-e.deltaY * 0.01)))
          const px = (pt.x - v.tx) / v.scale, py = (pt.y - v.ty) / v.scale
          return { scale, tx: pt.x - px * scale, ty: pt.y - py * scale }
        }
        return { ...v, tx: v.tx - (e.shiftKey ? e.deltaY : e.deltaX), ty: v.ty - (e.shiftKey ? 0 : e.deltaY) }
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const cursor = p.tool === 'pan' ? 'grab' : p.tool === 'select' ? 'default' : 'crosshair'
  const { view, page } = p
  return (
    <div
      ref={hostRef}
      className="workspace"
      style={{ cursor }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => finish(e, false)}
      onPointerCancel={(e) => finish(e, true)}
      onContextMenu={(e) => e.preventDefault()}
      data-testid="workspace"
    >
      <canvas ref={paperRef} className="layer" />
      {p.backgroundUrl && (
        <div className="layer page-transform" style={{ transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`, width: page.bg?.w ?? page.width, height: page.bg?.h ?? page.height }}>
          <img className="sheet-img" src={p.backgroundUrl} alt="Imported page" draggable={false} style={{ width: page.bg?.w ?? page.width, height: page.bg?.h ?? page.height, display: 'block' }} />
        </div>
      )}
      <canvas ref={inkRef} className="layer" data-testid="ink-canvas" />
      <canvas ref={liveRef} className="layer" />
      <div className="layer page-transform overlay" style={{ transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`, width: page.width, height: page.height }}>
        {p.pageLayer}
      </div>
      <div className="layer overlay">{p.screenLayer}</div>
    </div>
  )
}
