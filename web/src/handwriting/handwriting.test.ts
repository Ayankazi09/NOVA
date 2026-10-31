import { describe, expect, it } from 'vitest'
import { newNotebook } from '../notebook/doc'
import { parseBackup, BACKUP_FORMAT } from '../storage/backup'
import { SCHEMA_VERSION } from '../notebook/types'
import { toGlyph } from '../ui/HandwritingSetup'
import { compose } from './compose'

describe('personal glyphs', () => {
  it('normalises a box drawing to the digit-top/baseline unit box', () => {
    // a vertical stroke spanning the two guide lines
    const g = toGlyph([[[30, 0.2 * 92], [30, 45], [30, 0.78 * 92]]])! // top guide to baseline guide of a 92px box
    const ys = g.strokes[0].map((p) => p[1])
    expect(Math.min(...ys)).toBeCloseTo(0, 1)
    expect(Math.max(...ys)).toBeCloseTo(1, 1)
    expect(g.w).toBeGreaterThan(0.05)
  })

  it('compose prefers the student\'s own samples', () => {
    const mine = toGlyph([[[10, 30], [70, 30], [10, 90], [70, 90]]])! // a distinctive "Z"-ish 5
    const builtin = compose('5', { height: 40, slant: 0, width: 3, seed: 1 })
    const personal = compose('5', { height: 40, slant: 0, width: 3, seed: 1 }, { '5': [mine] })
    expect(JSON.stringify(personal.strokes)).not.toEqual(JSON.stringify(builtin.strokes))
    expect(personal.strokes.length).toBe(1)
  })
})

describe('backup restore', () => {
  it('remaps test page ids to the restored pages', () => {
    const doc = newNotebook('t')
    const pageId = doc.notebook.orderedPageIds[0]
    doc.tests = {
      t1: {
        id: 't1', title: 'paper', status: 'ready', pageIds: [pageId], progress: { done: 1, total: 1 }, createdAt: 1,
        questions: [{ id: 'q1', number: '1', pageId, text: 'Solve', bounds: { x: 0, y: 0, w: 10, h: 10 }, kind: 'numeric', options: [], answer: '4', answerVerified: true, corrected: false, helpCount: 0 }],
      },
    }
    const text = JSON.stringify({ format: BACKUP_FORMAT, schemaVersion: SCHEMA_VERSION, exportedAt: '', doc, assets: [] })
    const restored = parseBackup(text, text.length).doc
    const newPageId = restored.notebook.orderedPageIds[0]
    expect(newPageId).not.toBe(pageId)
    expect(restored.tests!.t1.pageIds).toEqual([newPageId])
    expect(restored.tests!.t1.questions[0].pageId).toBe(newPageId)
  })
})

describe('answer placement', () => {
  it('writes beside the "=" of a slanted line, level with it (not under the line)', async () => {
    const { placeInk } = await import('./place')
    const { docReducer, initialState } = await import('../notebook/doc')
    const doc = newNotebook('t')
    const pageId = doc.notebook.orderedPageIds[0]
    let state = initialState(doc)
    const seg = (x0: number, y0: number, x1: number, y1: number) => Array.from({ length: 8 }, (_, i) => ({ x: x0 + ((x1 - x0) * i) / 7, y: y0 + ((y1 - y0) * i) / 7 }))
    // "sin 30 =" climbing up to the right: each glyph 60 units tall, rising 45 units per glyph, then a stray dot
    const strokes = [
      seg(100, 400, 130, 460), seg(160, 355, 160, 415), seg(220, 310, 250, 370), seg(280, 265, 310, 325), seg(340, 220, 370, 280),
      seg(400, 195, 440, 190), seg(400, 212, 440, 207), // "=" high up on the right
      [{ x: 470, y: 205 }, { x: 471, y: 206 }], // stray dot
    ]
    strokes.forEach((points, i) => {
      state = docReducer(state, { type: 'addStroke', pageId, stroke: { id: `s${i}`, points, colour: '#000', width: 3.6, createdAt: 1000 + i * 300, author: 'student' }, newRegionId: `r${i}` })
    })
    const page = state.doc.pages[pageId]
    const region = page.regions.find((r) => r.sourceStrokeIds.includes('s5'))!
    const ink = placeInk(page, region, '1/2', 'after')
    const eqMid = 201
    expect(ink.bounds.x).toBeGreaterThan(440) // to the right of the "="
    expect(ink.bounds.x).toBeLessThan(520)
    expect(ink.bounds.y).toBeLessThan(eqMid) // straddles the "=" height...
    expect(ink.bounds.y + ink.bounds.h).toBeGreaterThan(eqMid) // ...instead of sitting under the whole line
  })
})
