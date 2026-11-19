import { beforeEach, describe, expect, it, vi } from 'vitest'

// drawing a page is slow on purpose here, so the student can act while it runs
const drawn: number[] = []
let failIndex: number | null = null
vi.mock('../storage/pdf', () => ({
  openPdf: vi.fn(async () => ({ numPages: 4 })),
  renderPdfPage: vi.fn(async (_doc: unknown, index: number) => {
    await new Promise((r) => setTimeout(r, 20))
    if (index === failIndex) throw new Error('could not draw')
    drawn.push(index)
    return { image: new Blob(['x']), imageW: 10, imageH: 10, lines: [{ id: 'l1', text: `page ${index + 1}`, x: 0, y: 0, w: 1, h: 1 }] }
  }),
}))
const stored = new Map<string, unknown>()
vi.mock('../storage/db', () => ({
  putAsset: vi.fn(async (a: { id: string }) => void stored.set(a.id, a)),
  getAsset: vi.fn(async (id: string) => stored.get(id)),
}))
vi.mock('../storage/backup', () => ({ checksumBytes: () => 'c' }))

const prep = await import('./paperPrep')

const tasks = (pdf = 'pdf1') => [0, 1, 2, 3].map((i) => ({ pageId: `pg${i + 1}`, assetId: `as${i + 1}`, pdfAssetId: pdf, index: i }))
const until = async (cond: () => boolean) => {
  for (let i = 0; i < 200 && !cond(); i++) await new Promise((r) => setTimeout(r, 10))
}

describe('paper page preparation', () => {
  beforeEach(() => {
    drawn.length = 0
    failIndex = null
    stored.clear()
    stored.set('pdf1', { bytes: new ArrayBuffer(4) })
    prep.cancelAll()
  })

  it('draws the first page first, then the page the student opens next', async () => {
    const results: string[] = []
    prep.setPrepListener((id) => results.push(id))
    prep.prioritise('pg1')
    prep.enqueue(tasks())
    await new Promise((r) => setTimeout(r, 5)) // page 1 is now being drawn
    prep.prioritise('pg3') // the student opens page 3 meanwhile
    await until(() => results.length === 4)
    expect(results).toEqual(['pg1', 'pg3', 'pg2', 'pg4'])
    expect(stored.has('as3')).toBe(true)
  })

  it('a failed page reports failure and does not stop the others', async () => {
    failIndex = 1
    const results: [string, boolean][] = []
    prep.setPrepListener((id, r) => results.push([id, r.ok]))
    prep.enqueue(tasks())
    await until(() => results.length === 4)
    expect(results).toEqual([['pg1', true], ['pg2', false], ['pg3', true], ['pg4', true]])
  })

  it('after cancel (notebook closed), a page in progress does not report back', async () => {
    const results: string[] = []
    prep.setPrepListener((id) => results.push(id))
    prep.enqueue(tasks())
    await new Promise((r) => setTimeout(r, 5))
    prep.cancelAll()
    await new Promise((r) => setTimeout(r, 120))
    expect(results).toEqual([])
  })

  it('a missing original PDF fails with a clear message instead of hanging', async () => {
    stored.delete('pdf1')
    const errors: string[] = []
    prep.setPrepListener((_id, r) => { if (!r.ok) errors.push(r.error) })
    prep.enqueue(tasks().slice(0, 1))
    await until(() => errors.length === 1)
    expect(errors[0]).toMatch(/no longer stored/)
  })
})
