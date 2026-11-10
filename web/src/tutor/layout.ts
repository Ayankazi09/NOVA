// Client-side placement of tutor objects. Model coordinates are never trusted.
// Candidates: right of the anchor, below it, then further right/below; otherwise a gutter card with a leader line.

import { inflate, intersects, strokeBounds } from '../notebook/geometry'
import type { Page, Rect, TutorAction, TutorObject } from '../notebook/types'

export function estimateSize(a: TutorAction): { w: number; h: number } {
  switch (a.type) {
    case 'add_note':
    case 'speak': {
      // 20px text, line-height 1.4, ~27 characters per line in a 340-unit card
      const lines = Math.ceil(a.text.length / 27) || 1
      return { w: 340, h: 58 + lines * 28 }
    }
    case 'write_equation':
      return { w: Math.max(320, Math.min(560, a.expression.length * 18 + 80)), h: 150 }
    case 'draw_groups':
      return { w: Math.max(260, a.groups.length * 120 + 24), h: 120 + (a.caption ? 20 : 0) }
    case 'plot_function':
      return { w: 380, h: 380 + 44 + (a.plot.series?.length ?? 1) * 22 + (a.plot.note ? 22 : 0) }
    case 'highlight_region':
      return { w: 0, h: 0 }
    case 'write_ink':
    case 'write_lines':
    case 'write_table':
    case 'draw_figure':
      return { w: 0, h: 0 }
  }
}

export function placeBatch(page: Page, actions: TutorAction[], anchorBounds: (id: string) => Rect | undefined): Map<string, Rect & { leader: boolean }> {
  const placed = new Map<string, Rect & { leader: boolean }>()
  const obstacles: Rect[] = [
    ...(page.bg ? [{ x: 0, y: 0, w: page.bg.w + 24, h: page.bg.h }] : []), // the printed sheet: write in the grid beside it
    ...page.strokes.map((s) => inflate(strokeBounds(s), 6)),
    ...page.tutorObjects.filter((t) => t.status !== 'dismissed' && t.action.type !== 'highlight_region').map((t) => inflate(t.layout, 8)),
    // keep the readback label under each line ("I read: ...") uncovered
    ...page.regions.map((r) => ({ x: r.bounds.x - 4, y: r.bounds.y + r.bounds.h, w: Math.max(r.bounds.w, 340), h: 46 })),
  ]
  const fits = (r: Rect) => r.x >= 8 && r.y >= 8 && r.x + r.w <= page.width - 8 && r.y + r.h <= page.height - 8 && !obstacles.some((o) => intersects(o, r))
  for (const a of actions) {
    const anchor = anchorBounds(a.anchorRegionId) ?? { x: 40, y: 40, w: 0, h: 0 }
    if (a.type === 'highlight_region') {
      placed.set(a.id, { ...inflate(anchor, 8), leader: false })
      continue
    }
    const { w, h } = estimateSize(a)
    const candidates: Rect[] = []
    for (let dy = 0; dy <= 240; dy += 24) candidates.push({ x: anchor.x + anchor.w + 32, y: anchor.y - 8 + dy, w, h })
    for (let dy = 16; dy <= 480; dy += 24) candidates.push({ x: anchor.x, y: anchor.y + anchor.h + dy, w, h })
    for (let dy = -120; dy <= 480; dy += 24) for (let x = anchor.x + anchor.w + 32; x + w <= page.width; x += 48) candidates.push({ x, y: anchor.y + dy, w, h })
    let spot = candidates.find(fits)
    let leader = false
    if (!spot) {
      // gutter: scan the free page area top-to-bottom, nearest to the anchor first
      const all: Rect[] = []
      for (let y = 8; y + h <= page.height; y += 24) for (let x = 8; x + w <= page.width; x += 48) all.push({ x, y, w, h })
      all.sort((p, q) => Math.hypot(p.x - anchor.x, p.y - anchor.y) - Math.hypot(q.x - anchor.x, q.y - anchor.y))
      spot = all.find(fits)
      leader = true
    }
    if (!spot) {
      // no room: right edge card over the page margin, with a leader line (UI offers to open as a sheet)
      spot = { x: Math.max(8, page.width - w - 8), y: Math.min(Math.max(8, anchor.y), page.height - h - 8), w, h }
      leader = true
    }
    if (leader && Math.hypot(spot.x - (anchor.x + anchor.w), spot.y - anchor.y) < 80) leader = false
    placed.set(a.id, { ...spot, leader })
    obstacles.push(inflate(spot, 8))
  }
  return placed
}

export function activeTutorObjects(page: Page): TutorObject[] {
  return page.tutorObjects.filter((t) => t.status !== 'dismissed')
}
