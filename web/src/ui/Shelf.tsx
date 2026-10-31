// Notebooks pinned onto the Home grid: real page previews, laid out in page units so they sit on the
// same sheet the student is writing on (and scroll / zoom with it).

import { useEffect, useState } from 'react'
import type { NotebookDoc, NotebookSummary } from '../notebook/types'
import { deleteNotebook, listNotebooks, loadNotebook } from '../storage/db'
import { Icon } from './icons'
import { PageThumb } from './PageThumb'

export const SCRATCH_ID = 'nb_scratch' // the Home page itself

export const SHELF_X = 96
export const SHELF_Y = 640
export const CARD_W = 190
const GAP = 34
const PER_ROW = 5

function when(t: number): string {
  const d = new Date(t)
  const today = new Date()
  if (d.toDateString() === today.toDateString()) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  return d.toLocaleDateString([], { day: 'numeric', month: 'short' })
}

export function shelfHeight(n: number) {
  return 70 + Math.ceil((n + 1) / PER_ROW) * (CARD_W * (4 / 3) + 90)
}

export function Shelf({ onOpen, onCreate, onCount }: { onOpen: (id: string) => void; onCreate: () => void; onCount?: (n: number) => void }) {
  const [items, setItems] = useState<NotebookSummary[]>([])
  const [docs, setDocs] = useState<Record<string, NotebookDoc>>({})

  const refresh = async () => {
    const list = (await listNotebooks()).filter((n) => n.id !== SCRATCH_ID)
    setItems(list)
    onCount?.(list.length)
    const loaded: Record<string, NotebookDoc> = {}
    for (const n of list.slice(0, 40)) {
      const d = await loadNotebook(n.id).catch(() => undefined)
      if (d) loaded[n.id] = d
    }
    setDocs(loaded)
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => void refresh(), [])

  const stop = (e: React.PointerEvent) => e.stopPropagation()
  const cards = [...items.map((n) => ({ kind: 'nb' as const, n })), { kind: 'new' as const }]
  return (
    <div className="shelf-layer" style={{ left: SHELF_X, top: SHELF_Y }}>
      <div className="shelf-label">Your notebooks</div>
      <div className="shelf-cards" style={{ gridTemplateColumns: `repeat(${PER_ROW}, ${CARD_W}px)`, columnGap: GAP }}>
        {cards.map((c) => {
          if (c.kind === 'new') {
            return (
              <button key="new" className="pin new" onPointerDown={stop} onClick={onCreate}>
                <span className="pin-page"><Icon.plus /><span>New notebook</span></span>
              </button>
            )
          }
          const d = docs[c.n.id]
          const pg = d ? d.pages[d.notebook.lastPageId ?? d.notebook.orderedPageIds[0]] : undefined
          const test = d ? Object.values(d.tests ?? {})[0] : undefined
          return (
            <div key={c.n.id} className="pin" onPointerDown={stop}>
              <button className="pin-open" onClick={() => onOpen(c.n.id)}>
                <span className="pin-sheet">
                  <PageThumb page={pg} />
                  {test && <span className={`pin-badge ${test.score ? 'scored' : ''}`}>{test.score ? `${test.score.correct}/${test.score.total}` : 'Test'}</span>}
                </span>
                <span className="pin-title">{c.n.title}</span>
                <span className="pin-meta">{when(c.n.updatedAt)}{c.n.pageCount > 1 ? ` · ${c.n.pageCount} pages` : ''}</span>
              </button>
              <button
                className="pin-del"
                aria-label={`Delete ${c.n.title}`}
                onClick={async () => {
                  if (!confirm(`Delete “${c.n.title}”? This cannot be undone.`)) return
                  await deleteNotebook(c.n.id)
                  void refresh()
                }}
              >
                <Icon.trash />
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
