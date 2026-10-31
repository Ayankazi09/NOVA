import { useEffect, useRef, useState } from 'react'
import type { NotebookDoc, NotebookSummary } from '../notebook/types'
import { BackupError, parseBackup } from '../storage/backup'
import { deleteNotebook, listNotebooks, loadNotebook, saveImported } from '../storage/db'
import { Icon } from './icons'
import { PageThumb } from './PageThumb'
import { readingText } from '../notebook/doc'

interface Props {
  onOpen: (id: string) => void
  onCreate: () => void
  onImportPaper: (file: File) => void
  notify: (msg: string) => void
}

function when(t: number): string {
  const d = new Date(t)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) return `today, ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
  const y = new Date(now)
  y.setDate(now.getDate() - 1)
  if (d.toDateString() === y.toDateString()) return 'yesterday'
  return d.toLocaleDateString([], { day: 'numeric', month: 'short' })
}

/** What the notebook is about, from what NOVA read on its pages. */
function firstLines(doc?: NotebookDoc, n = 3): string[] {
  if (!doc) return []
  const out: string[] = []
  for (const pid of doc.notebook.orderedPageIds) {
    const p = doc.pages[pid]
    if (!p) continue
    const regions = [...p.regions].sort((a, b) => a.bounds.y - b.bounds.y)
    for (const r of regions) {
      const rd = p.readings[r.id]
      const t = readingText(rd)
      if (t) out.push(t)
      if (out.length >= n) return out
    }
  }
  return out
}

function stats(doc?: NotebookDoc) {
  if (!doc) return { lines: 0, right: 0, wrong: 0 }
  let lines = 0, right = 0, wrong = 0
  for (const p of Object.values(doc.pages)) {
    lines += p.regions.length
    for (const t of p.tutorObjects) {
      if (t.status === 'dismissed' || t.action.type !== 'write_ink' || t.action.purpose !== 'mark') continue
      if (t.action.tone === 'correct') right++
      else if (t.action.tone === 'wrong') wrong++
    }
  }
  return { lines, right, wrong }
}

export function Library({ onOpen, onCreate, onImportPaper, notify }: Props) {
  const [items, setItems] = useState<NotebookSummary[] | null>(null)
  const [docs, setDocs] = useState<Record<string, NotebookDoc>>({})
  const fileRef = useRef<HTMLInputElement>(null)
  const pdfRef = useRef<HTMLInputElement>(null)

  const refresh = async () => {
    try {
      const list = (await listNotebooks()).filter((n) => n.id !== 'nb_scratch').sort((a, b) => b.updatedAt - a.updatedAt)
      setItems(list)
      const loaded: Record<string, NotebookDoc> = {}
      for (const n of list.slice(0, 60)) {
        const d = await loadNotebook(n.id).catch(() => undefined)
        if (d) loaded[n.id] = d
      }
      setDocs(loaded)
    } catch (e) {
      notify((e as Error).message)
    }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => void refresh(), [])

  const importBackup = async (file: File) => {
    try {
      const { doc, assets } = parseBackup(await file.text(), file.size)
      await saveImported(doc, assets)
      notify(`Restored “${doc.notebook.title}”.`)
      void refresh()
    } catch (e) {
      notify(e instanceof BackupError ? e.message : `Import failed: ${(e as Error).message}`)
    }
  }

  const remove = async (n: NotebookSummary) => {
    if (!confirm(`Delete “${n.title}”? This cannot be undone. Export a backup first if you need it.`)) return
    await deleteNotebook(n.id)
    void refresh()
  }

  const pageOf = (d?: NotebookDoc) => (d ? d.pages[d.notebook.lastPageId ?? d.notebook.orderedPageIds[0]] : undefined)
  const latest = items?.[0]
  const latestDoc = latest ? docs[latest.id] : undefined
  const latestTest = latestDoc ? Object.values(latestDoc.tests ?? {})[0] : undefined
  const st = stats(latestDoc)
  const lines = firstLines(latestDoc)

  return (
    <div className="library">
      <header className="topbar">
        <img className="brand-logo" src="/nova-logo.png" alt="NOVA" />
        <span className="title-static">Notebooks</span>
        <span className="spacer" />
        <button className="btn" onClick={() => fileRef.current?.click()}>Restore backup</button>
        <button className="btn primary" onClick={onCreate}><Icon.plus /> New notebook</button>
        <input ref={fileRef} type="file" accept=".json,.nova.json,application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void importBackup(f) }} />
        <input ref={pdfRef} type="file" accept="application/pdf,.pdf" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onImportPaper(f) }} />
      </header>
      <main className="library-main">
        {items === null && <p className="muted">Loading…</p>}

        {latest && (
          <section className="lib-continue">
            <button className="lc-sheet" onClick={() => onOpen(latest.id)} aria-label={`Continue ${latest.title}`}>
              <PageThumb page={pageOf(latestDoc)} aspect={3 / 4} />
            </button>
            <div className="lc-body">
              <div className="lc-kicker">Continue where you left off</div>
              <h1 className="lc-title">{latest.title}</h1>
              <div className="lc-meta">
                {latest.pageCount} {latest.pageCount === 1 ? 'page' : 'pages'} · edited {when(latest.updatedAt)}
              </div>
              {lines.length > 0 && (
                <ul className="lc-lines">
                  {lines.map((l, i) => <li key={i}>{l}</li>)}
                </ul>
              )}
              <div className="lc-stats">
                <span><b>{st.lines}</b> lines written</span>
                {st.right > 0 && <span className="ok"><b>{st.right}</b> ✓ right</span>}
                {st.wrong > 0 && <span className="bad"><b>{st.wrong}</b> ✗ to fix</span>}
                {latestTest?.score && <span className="bad"><b>{latestTest.score.correct}/{latestTest.score.total}</b> on the test</span>}
              </div>
              <div className="lc-actions">
                <button className="btn primary big" onClick={() => onOpen(latest.id)}><Icon.pen /> Continue writing</button>
              </div>
            </div>
          </section>
        )}

        <section className="lib-section">
          <div className="lib-head">
            <h2>All notebooks</h2>
            {items && items.length > 0 && <span className="muted">{items.length}</span>}
          </div>
          <div className="lib-grid">
            <button className="nb-card add" onClick={onCreate}>
              <span className="nb-paper add-paper"><Icon.plus /><b>New notebook</b><small>A fresh grid page</small></span>
            </button>
            <button className="nb-card add" onClick={() => pdfRef.current?.click()}>
              <span className="nb-paper add-paper"><Icon.upload /><b>Import a question paper</b><small>PDF · NOVA tests you on it</small></span>
            </button>
            {items?.map((n) => {
              const d = docs[n.id]
              const test = d ? Object.values(d.tests ?? {})[0] : undefined
              return (
                <div key={n.id} className="nb-card">
                  <button className="nb-open" onClick={() => onOpen(n.id)}>
                    <span className="nb-paper">
                      <PageThumb page={pageOf(d)} aspect={3 / 4} />
                      {test && <span className={`nb-badge ${test.score ? 'scored' : ''}`}>{test.score ? `${test.score.correct}/${test.score.total}` : 'Test'}</span>}
                      {n.pageCount > 1 && <span className="nb-stack" aria-hidden="true" />}
                    </span>
                    <span className="nb-title">{n.title}</span>
                    <span className="nb-meta">{n.pageCount} {n.pageCount === 1 ? 'page' : 'pages'} · {when(n.updatedAt)}</span>
                  </button>
                  <button className="icon-btn sm nb-del" aria-label={`Delete ${n.title}`} onClick={() => void remove(n)}><Icon.trash /></button>
                </div>
              )
            })}
          </div>
        </section>
      </main>
      <footer className="library-foot muted">NOVA stores notebooks on this device only.</footer>
    </div>
  )
}
