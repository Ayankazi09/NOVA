import { describe, expect, it } from 'vitest'
import { docReducer, initialState, isEquationInX, isTinyRegion, newNotebook, type DocState } from './doc'
import type { Point, Stroke } from './types'

let n = 0
function stroke(points: Point[], at: number): Stroke {
  return { id: `s${++n}`, points, colour: '#000', width: 3.6, createdAt: at, author: 'student' }
}
const line = (x0: number, y0: number, x1: number, y1: number): Point[] =>
  Array.from({ length: 12 }, (_, i) => ({ x: x0 + ((x1 - x0) * i) / 11, y: y0 + ((y1 - y0) * i) / 11 }))

function setup() {
  const doc = newNotebook('t')
  const pageId = doc.notebook.orderedPageIds[0]
  return { state: initialState(doc), pageId }
}
function add(state: DocState, pageId: string, s: Stroke) {
  return docReducer(state, { type: 'addStroke', pageId, stroke: s, newRegionId: `r${n}` })
}

describe('line grouping', () => {
  it('keeps a written line together, including a raised "=" sign', () => {
    let { state, pageId } = setup()
    let t = 0
    state = add(state, pageId, stroke(line(100, 200, 140, 280), (t += 400))) // "3"-ish
    state = add(state, pageId, stroke(line(190, 220, 190, 270), (t += 400))) // "+" vertical
    state = add(state, pageId, stroke(line(170, 245, 210, 245), (t += 400))) // "+" horizontal
    state = add(state, pageId, stroke(line(250, 200, 290, 280), (t += 400))) // "2"
    state = add(state, pageId, stroke(line(330, 175, 370, 175), (t += 400))) // raised "="
    state = add(state, pageId, stroke(line(330, 192, 370, 192), (t += 400)))
    expect(state.doc.pages[pageId].regions).toHaveLength(1)
  })

  it('separates two lines written one below the other', () => {
    let { state, pageId } = setup()
    state = add(state, pageId, stroke(line(100, 200, 300, 260), 1000))
    state = add(state, pageId, stroke(line(100, 420, 300, 480), 9000))
    expect(state.doc.pages[pageId].regions).toHaveLength(2)
  })

  it('merges a late stroke written later on the same line', () => {
    let { state, pageId } = setup()
    state = add(state, pageId, stroke(line(100, 200, 200, 260), 1000))
    state = add(state, pageId, stroke(line(260, 205, 330, 255), 20000)) // later, same line
    expect(state.doc.pages[pageId].regions).toHaveLength(1)
  })

  it('keeps a huge scribble out of the writing', () => {
    let { state, pageId } = setup()
    state = add(state, pageId, stroke(line(100, 200, 200, 260), 1000))
    state = add(state, pageId, stroke(line(80, 100, 1100, 700), 1500))
    const regions = state.doc.pages[pageId].regions
    expect(regions).toHaveLength(2)
  })

  it('flags dots as tiny', () => {
    let { state, pageId } = setup()
    state = add(state, pageId, stroke([{ x: 50, y: 50 }, { x: 51, y: 51 }], 1000))
    const page = state.doc.pages[pageId]
    expect(isTinyRegion(page, page.regions[0])).toBe(true)
  })
})

describe('problem detection', () => {
  it.each([
    ['2(x + 3) = 14', true],
    ['3 + 2 =', false],
    ['y = 2x + 1', false],
    ['2x3=6', false],
    ['x = 4', true],
  ])('%s -> %s', (text, expected) => {
    expect(isEquationInX(text)).toBe(expected)
  })
})

describe('erasing removes what NOVA attached', () => {
  it('drops answers, bubbles and circles of an erased line, and page notes when the page is wiped', () => {
    let { state, pageId } = setup()
    const s1 = stroke(line(100, 200, 160, 260), 1000)
    state = add(state, pageId, s1)
    const rid = state.doc.pages[pageId].regions[0].id
    const base = { requestId: 'q', batchId: 'b', sourceHash: state.doc.pages[pageId].regions[0].sourceHash, createdAt: 1, author: 'tutor' as const, status: 'active' as const, layout: { x: 0, y: 0, w: 10, h: 10, leader: false } }
    const page = state.doc.pages[pageId]
    state = { ...state, doc: { ...state.doc, pages: { ...state.doc.pages, [pageId]: { ...page, tutorObjects: [
      { ...base, id: 'ans', anchorRegionId: rid, action: { id: 'ans', type: 'write_ink', anchorRegionId: rid, text: '5', strokes: [], width: 3, purpose: 'answer', verified: true, tone: 'nova' } },
      { ...base, id: 'bubble', anchorRegionId: 'page', action: { id: 'bubble', type: 'write_ink', anchorRegionId: 'page', text: "can't solve", strokes: [], width: 3, purpose: 'completion', verified: false, tone: 'nova' } },
      { ...base, id: 'table', anchorRegionId: 'page', action: { id: 'table', type: 'write_ink', anchorRegionId: 'page', text: 'sin | cos', strokes: [], width: 3, purpose: 'content', verified: true, tone: 'nova' } },
    ] } } } } as DocState
    state = docReducer(state, { type: 'eraseStrokes', pageId, ids: [s1.id] })
    const st = Object.fromEntries(state.doc.pages[pageId].tutorObjects.map((t) => [t.id, t.status]))
    expect(st).toEqual({ ans: 'dismissed', bubble: 'dismissed', table: 'active' })
  })
})
