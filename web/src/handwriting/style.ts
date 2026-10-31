// Estimate the student's handwriting style (size, slant, pen width) from the strokes of one line.

import { hashString, strokeBounds } from '../notebook/geometry'
import type { Page, Region } from '../notebook/types'
import type { HandStyle } from './compose'

export function styleFromRegion(page: Page, region: Region): HandStyle {
  const ids = new Set(region.sourceStrokeIds)
  const strokes = page.strokes.filter((s) => ids.has(s.id))
  const heights = strokes.map((s) => strokeBounds(s).h).sort((a, b) => a - b)
  // digits are the tallest common strokes; brackets can be taller, '=' and '-' much shorter
  const p80 = heights.length ? heights[Math.min(heights.length - 1, Math.floor(heights.length * 0.8))] : 60
  const height = Math.max(24, Math.min(160, Math.min(p80, region.bounds.h)))
  let sx = 0, sy = 0
  for (const s of strokes) {
    for (let i = 1; i < s.points.length; i++) {
      const dx = s.points[i].x - s.points[i - 1].x
      const dy = s.points[i].y - s.points[i - 1].y
      if (Math.abs(dy) > 2.5 * Math.abs(dx) && Math.abs(dy) > 1.5) {
        // writing downwards: positive dy; a right lean means x decreases as y increases
        const sign = dy > 0 ? 1 : -1
        sx += -dx * sign
        sy += Math.abs(dy)
      }
    }
  }
  const slant = sy > 0 ? Math.max(-0.25, Math.min(0.35, sx / sy)) : 0.08
  const widths = strokes.map((s) => s.width).sort((a, b) => a - b)
  const width = widths.length ? widths[Math.floor(widths.length / 2)] : 3.6
  return { height, slant, width, seed: parseInt(hashString(region.id + region.sourceHash).slice(0, 7), 36) || 7 }
}
