// A practice set as a printed worksheet: the questions are typeset onto an image (like an imported PDF page),
// with room to write under each one. Its text lines and question boxes are kept in page units, so the existing
// test flow (help, marking the handwritten answers, explaining) works on it unchanged.

import type { DocLine, Rect } from '../notebook/types'

export const SHEET_W = 1200 // page units, the same as an imported PDF page
const SCALE = 4 / 3 // image pixels per page unit (1600 px wide, sharp at normal zoom)
const MARGIN = 72
const FONT = 30
const LINE_H = 42
const ANSWER_SPACE = 300 // room under each question for working

export interface SheetQuestion {
  number: string
  text: string
  options?: string[]
}

export interface PracticeSheet {
  image: Blob
  imageW: number
  imageH: number
  width: number
  height: number
  lines: DocLine[]
  bounds: Rect[] // one per question, in page units
}

const FAMILY = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const out: string[] = []
  for (const para of text.split('\n')) {
    let line = ''
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word
      if (ctx.measureText(next).width > maxW && line) {
        out.push(line)
        line = word
      } else line = next
    }
    if (line) out.push(line)
  }
  return out.length ? out : ['']
}

/** Lay the sheet out in page units (pure, so it can be measured without drawing). */
export function layoutSheet(
  title: string,
  subtitle: string,
  questions: SheetQuestion[],
  measure: (text: string, font: string) => number,
) {
  type Item = { text: string; x: number; y: number; font: string; colour: string; q?: number }
  const items: Item[] = []
  const bounds: Rect[] = []
  const textW = SHEET_W - MARGIN * 2
  const fake = { measureText: (s: string) => ({ width: measure(s, `${FONT}px ${FAMILY}`) }) } as CanvasRenderingContext2D
  let y = MARGIN
  items.push({ text: title, x: MARGIN, y, font: `700 44px ${FAMILY}`, colour: '#20252b' })
  y += 58
  items.push({ text: subtitle, x: MARGIN, y, font: `400 24px ${FAMILY}`, colour: '#626b75' })
  y += 70
  questions.forEach((q, i) => {
    const top = y
    const numW = 56
    const body = wrap(fake, q.text, textW - numW)
    items.push({ text: `${q.number}.`, x: MARGIN, y, font: `700 ${FONT}px ${FAMILY}`, colour: '#245c9c', q: i })
    body.forEach((l, k) => items.push({ text: l, x: MARGIN + numW, y: y + k * LINE_H, font: `400 ${FONT}px ${FAMILY}`, colour: '#20252b', q: i }))
    y += body.length * LINE_H
    for (const o of q.options ?? []) {
      items.push({ text: o, x: MARGIN + numW + 24, y, font: `400 ${FONT - 2}px ${FAMILY}`, colour: '#20252b', q: i })
      y += LINE_H
    }
    bounds.push({ x: MARGIN - 8, y: top - 8, w: textW + 16, h: y - top + 8 })
    y += i === questions.length - 1 ? ANSWER_SPACE + 40 : ANSWER_SPACE
  })
  return { items, bounds, height: Math.ceil(y) }
}

export async function buildPracticeSheet(title: string, subtitle: string, questions: SheetQuestion[]): Promise<PracticeSheet> {
  const probe = document.createElement('canvas').getContext('2d')!
  const measure = (s: string, font: string) => {
    probe.font = font
    return probe.measureText(s).width
  }
  const { items, bounds, height } = layoutSheet(title, subtitle, questions, measure)
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(SHEET_W * SCALE)
  canvas.height = Math.round(height * SCALE)
  const ctx = canvas.getContext('2d')!
  ctx.scale(SCALE, SCALE)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, SHEET_W, height)
  ctx.textBaseline = 'top'
  // a faint rule under each question's answer space, like a worksheet
  ctx.strokeStyle = '#e3e7ec'
  ctx.lineWidth = 1.5
  bounds.forEach((_, i) => {
    const next = bounds[i + 1]
    const y = (next ? next.y : height) - 24
    ctx.beginPath()
    ctx.moveTo(MARGIN, y)
    ctx.lineTo(SHEET_W - MARGIN, y)
    ctx.stroke()
  })
  const lines: DocLine[] = []
  items.forEach((it, i) => {
    ctx.font = it.font
    ctx.fillStyle = it.colour
    ctx.fillText(it.text, it.x, it.y)
    const size = Number(/(\d+)px/.exec(it.font)?.[1] ?? FONT)
    lines.push({ id: `l${i + 1}`, text: it.text, x: it.x, y: it.y, w: ctx.measureText(it.text).width, h: size * 1.15 })
  })
  const image = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Could not draw the practice sheet.'))), 'image/png'))
  return { image, imageW: canvas.width, imageH: canvas.height, width: SHEET_W, height, lines, bounds }
}
