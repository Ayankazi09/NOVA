import type { Point, Rect, Stroke } from './types'

export function strokeBounds(s: Stroke): Rect {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const p of s.points) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  const r = s.width / 2
  return { x: minX - r, y: minY - r, w: maxX - minX + 2 * r, h: maxY - minY + 2 * r }
}

export function union(rects: Rect[]): Rect {
  if (!rects.length) return { x: 0, y: 0, w: 0, h: 0 }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const r of rects) {
    minX = Math.min(minX, r.x)
    minY = Math.min(minY, r.y)
    maxX = Math.max(maxX, r.x + r.w)
    maxY = Math.max(maxY, r.y + r.h)
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

export function inflate(r: Rect, d: number): Rect {
  return { x: r.x - d, y: r.y - d, w: r.w + 2 * d, h: r.h + 2 * d }
}

export function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

export function containsPoint(r: Rect, p: Point): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h
}

export function normRect(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) }
}

function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  let t = len2 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2 : 0
  t = Math.max(0, Math.min(1, t))
  const x = a.x + t * dx, y = a.y + t * dy
  return Math.hypot(p.x - x, p.y - y)
}

export function strokeHit(s: Stroke, p: Point, radius: number): boolean {
  const r = radius + s.width / 2
  const pts = s.points
  if (pts.length === 1) return Math.hypot(pts[0].x - p.x, pts[0].y - p.y) <= r
  for (let i = 1; i < pts.length; i++) if (distToSegment(p, pts[i - 1], pts[i]) <= r) return true
  return false
}

export function pointInPolygon(p: Point, poly: Point[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j]
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

/** A stroke counts as enclosed when at least 70% of its points are inside. */
export function strokeInSelection(s: Stroke, sel: { rect?: Rect; lasso?: Point[] }): boolean {
  let inside = 0
  for (const p of s.points) {
    if (sel.rect ? containsPoint(sel.rect, p) : sel.lasso ? pointInPolygon(p, sel.lasso) : false) inside++
  }
  return inside / s.points.length >= 0.7
}

/** Drop points closer than tolerance (page units) to the previous kept point. Keeps first and last. */
export function simplify(points: Point[], tolerance = 0.75): Point[] {
  if (points.length < 3) return points.slice()
  const out = [points[0]]
  for (let i = 1; i < points.length - 1; i++) {
    const last = out[out.length - 1]
    if (Math.hypot(points[i].x - last.x, points[i].y - last.y) >= tolerance) out.push(points[i])
  }
  out.push(points[points.length - 1])
  return out
}

/** 53-bit string hash (cyrb53). Works in insecure contexts where crypto.subtle is missing. */
export function hashString(str: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}
