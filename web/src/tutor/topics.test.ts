import { describe, expect, it } from 'vitest'
import { newNotebook } from '../notebook/doc'
import type { NotebookDoc, Reading, Region, TutorObject } from '../notebook/types'
import { layoutSheet } from './practiceSheet'
import { classify, isWeak, notebookTopics, progress } from './topics'

describe('classify', () => {
  it.each([
    ['3 + 2 =', 'Arithmetic'],
    ['1/2 + 1/3 =', 'Fractions & decimals'],
    ['2x + 3 = 11', 'Linear equations'],
    ['Solve 3x + 5 = 20', 'Linear equations'],
    ['x^2 - 5x + 6 = 0', 'Quadratics'],
    ['x² = 9', 'Quadratics'],
    ['sin 30° + cos 60° =', 'Trigonometry'],
    ['d/dx (x^3)', 'Calculus'],
    ['∫ 2x dx', 'Calculus'],
    ['log_2 8 =', 'Logarithms'],
    ['3 + 4 + ... + 100', 'Sequences & series'],
    ['A ∪ B', 'Sets'],
    ['Find the area of a circle of radius 7 cm', 'Geometry'],
    ['det[1 2; 3 4]', 'Matrices & vectors'],
    ['(a + b)(a - b)', 'Algebra'],
  ])('%s → %s', (text, topic) => {
    expect(classify(text)).toBe(topic)
  })

  it('ignores lines with no maths', () => {
    expect(classify('')).toBeNull()
    expect(classify('...')).toBeNull()
  })
})

function region(id: string, at: number): Region {
  return { id, bounds: { x: 0, y: 0, w: 100, h: 40 }, sourceStrokeIds: [], sourceHash: id, origin: 'auto', createdAt: at }
}
function reading(text: string): Reading {
  return { rawText: text, alternatives: [], needsClarification: false, status: 'expression', state: 'accepted', acceptedText: text, sourceHash: 'h', interpretationRevision: 1 }
}
function mark(id: string, regionId: string, tone: 'correct' | 'wrong', at: number): TutorObject {
  return {
    id, requestId: id, batchId: id, anchorRegionId: regionId, sourceHash: 'h', createdAt: at, author: 'tutor', status: 'active',
    action: { id, type: 'write_ink', anchorRegionId: regionId, text: tone === 'correct' ? '✓' : '✗', strokes: [], width: 3, purpose: 'mark', verified: true, tone },
    layout: { x: 0, y: 0, w: 10, h: 10, leader: false },
  }
}

function docWith(lines: { text: string; tone?: 'correct' | 'wrong'; at: number }[]): NotebookDoc {
  const doc = newNotebook('t')
  const page = doc.pages[doc.notebook.orderedPageIds[0]]
  lines.forEach((l, i) => {
    const id = `r${i}`
    page.regions.push(region(id, l.at))
    page.readings[id] = reading(l.text)
    page.strokes.push({ id: `s${i}`, points: [{ x: 0, y: 0 }], colour: '#000', width: 3, createdAt: l.at, author: 'student' })
    if (l.tone) page.tutorObjects.push(mark(`m${i}`, id, l.tone, l.at))
  })
  return doc
}

describe('progress', () => {
  const now = new Date(2026, 10, 10, 15, 0).getTime()
  const day = 86_400_000

  it('scores topics from ✓ / ✗ marks, weakest first', () => {
    const doc = docWith([
      { text: '2x + 3 = 11', tone: 'wrong', at: now },
      { text: 'x + 4 = 9', tone: 'wrong', at: now },
      { text: '3x = 12', tone: 'correct', at: now },
      { text: '3 + 2 = 5', tone: 'correct', at: now },
    ])
    const p = progress([doc], now)
    expect(p.topics[0]).toMatchObject({ topic: 'Linear equations', right: 1, wrong: 2 })
    expect(isWeak(p.topics[0])).toBe(true)
    expect(p.topics.find((t) => t.topic === 'Arithmetic')).toMatchObject({ right: 1, wrong: 0 })
    expect(p.today).toEqual({ right: 2, wrong: 2, lines: 4, minutes: 1 })
    expect(p.lastTopic).toBe('Arithmetic') // the most recently written line wins ties by order
  })

  it('counts a streak of consecutive writing days, alive until the end of today', () => {
    const doc = docWith([{ text: '1 + 1 =', at: now - day }, { text: '2 + 2 =', at: now - 2 * day }, { text: '3 + 3 =', at: now - 4 * day }])
    expect(progress([doc], now).streak).toBe(2)
    expect(progress([docWith([{ text: '1 + 1 =', at: now - 3 * day }])], now).streak).toBe(0)
  })

  it('counts marked test questions once, by the practice topic', () => {
    const doc = docWith([])
    const pageId = doc.notebook.orderedPageIds[0]
    doc.tests = {
      t1: {
        id: 't1', title: 'Practice', kind: 'practice', topic: 'Quadratics', status: 'finished', pageIds: [pageId], progress: { done: 1, total: 1 }, createdAt: now, finishedAt: now,
        questions: [
          { id: 'q1', number: '1', pageId, text: 'Solve x² = 4', bounds: { x: 0, y: 0, w: 1, h: 1 }, kind: 'equation', options: [], answer: 'x = 2 or x = -2', answerVerified: true, corrected: false, helpCount: 0, verdict: 'correct' },
          { id: 'q2', number: '2', pageId, text: 'Solve x² = 9', bounds: { x: 0, y: 0, w: 1, h: 1 }, kind: 'equation', options: [], answer: 'x = 3 or x = -3', answerVerified: true, corrected: false, helpCount: 0, verdict: 'incorrect' },
        ],
      },
    }
    const p = progress([doc], now)
    expect(p.topics.find((t) => t.topic === 'Quadratics')).toMatchObject({ right: 1, wrong: 1 })
    expect(p.today).toMatchObject({ right: 1, wrong: 1 })
    expect(notebookTopics(doc)).toEqual(['Quadratics'])
  })
})

describe('practice sheet layout', () => {
  it('gives every question its own box, top to bottom, with room to write', () => {
    const measure = (s: string) => s.length * 15
    const qs = [
      { number: '1', text: 'Solve 3x + 5 = 20' },
      { number: '2', text: 'A long question '.repeat(12).trim() },
      { number: '3', text: 'Solve x - 4 = 1' },
    ]
    const { bounds, height, items } = layoutSheet('Practice', 'sub', qs, measure)
    expect(bounds).toHaveLength(3)
    for (let i = 1; i < bounds.length; i++) expect(bounds[i].y).toBeGreaterThan(bounds[i - 1].y + bounds[i - 1].h + 200)
    expect(bounds[1].h).toBeGreaterThan(bounds[0].h) // the long one wrapped onto more lines
    expect(height).toBeGreaterThan(bounds[2].y + bounds[2].h)
    expect(items.every((it) => it.x + measure(it.text) <= 1200)).toBe(true)
  })
})
