import { useEffect, useMemo, useRef, useState } from 'react'
import type { NotebookDoc, NotebookSummary } from '../notebook/types'
import { BackupError, parseBackup } from '../storage/backup'
import { deleteNotebook, listNotebooks, loadNotebook, saveImported } from '../storage/db'
import { Icon } from './icons'
import { PageThumb } from './PageThumb'
import { readingText } from '../notebook/doc'
import { isWeak, notebookTopics, progress } from '../tutor/topics'
import { PracticeDialog } from './PracticeDialog'
import { effectiveTheme, onThemeChange, setThemePref } from './theme'

interface Props {
  tester?: { name: string }
  onSwitchTester?: () => void
  onOpen: (id: string) => void
  onCreate: () => void
  onImportPaper: (file: File) => void
  onPractice: (topic: string) => void
  onTry: (what: 'graph' | 'diagram' | 'ask') => void
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

export function Library({ tester, onSwitchTester, onOpen, onCreate, onImportPaper, onPractice, onTry, notify }: Props) {
  const [items, setItems] = useState<NotebookSummary[] | null>(null)
  const [docs, setDocs] = useState<Record<string, NotebookDoc>>({})
  const fileRef = useRef<HTMLInputElement>(null)
  const [practiceOpen, setPracticeOpen] = useState(false)
  const [theme, setTheme] = useState(effectiveTheme)
  useEffect(() => onThemeChange(() => setTheme(effectiveTheme())), [])
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
  const prog = useMemo(() => progress(Object.values(docs)), [docs])
  const weak = prog.topics.filter(isWeak)

  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<'recent' | 'oldest' | 'name'>('recent')
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = (items ?? []).filter((n) => {
      if (!q) return true
      const d = docs[n.id]
      return n.title.toLowerCase().includes(q) || notebookTopics(d, 4).some((t) => t.toLowerCase().includes(q)) || firstLines(d, 6).some((l) => l.toLowerCase().includes(q))
    })
    if (sort === 'name') return [...list].sort((a, b) => a.title.localeCompare(b.title))
    if (sort === 'oldest') return [...list].sort((a, b) => a.updatedAt - b.updatedAt)
    return list
  }, [items, docs, query, sort])
  const goalMin = 30
  const minutesLeft = Math.max(0, goalMin - prog.today.minutes)

  return (
    <div className="library home">
      <header className="topbar">
        <img className="brand-logo" src="/nova-logo.png" alt="NOVA" />
        <span className="title-static">Math Notebooks</span>
        <span className="spacer" />
        {tester && (
          <span className="tester-chip">
            {tester.name}
            <button className="link" onClick={() => { if (confirm('Switch to another tester? Your notebooks stay saved under your name on this device.')) onSwitchTester?.() }}>switch</button>
          </span>
        )}
        <button className="icon-btn" aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} title={theme === 'dark' ? 'Light mode' : 'Dark mode'} onClick={() => setThemePref(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Icon.sun /> : <Icon.moon />}</button>
        <button className="btn hide-phone" onClick={() => fileRef.current?.click()}>Restore backup</button>
        <button className="btn primary" onClick={onCreate}><Icon.plus /> <span className="hide-phone">New notebook</span></button>
        <input ref={fileRef} type="file" accept=".json,.nova.json,application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void importBackup(f) }} />
        <input ref={pdfRef} type="file" accept="application/pdf,.pdf" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onImportPaper(f) }} />
      </header>
      <main className="library-main">
        {items === null && <p className="muted">Loading…</p>}

        {latest && (
          <section className="hero">
            <button className="hero-sheet" onClick={() => onOpen(latest.id)} aria-label={`Continue ${latest.title}`}>
              <PageThumb page={pageOf(latestDoc)} aspect={4 / 3} />
            </button>
            <div className="hero-body">
              <div className="lc-kicker">Continue where you left off</div>
              <h1 className="hero-title">{latest.title}</h1>
              <div className="hero-meta">
                {latest.pageCount} {latest.pageCount === 1 ? 'page' : 'pages'} · edited {when(latest.updatedAt)}
              </div>
              {lines.length > 0 && (
                <ul className="hero-lines">
                  {lines.map((l, i) => <li key={i}>{l}</li>)}
                </ul>
              )}
              <div className="hero-chips">
                <span><b>{st.lines}</b> lines written</span>
                {st.right > 0 && <span className="ok"><b>{st.right}</b> ✓ right</span>}
                {st.wrong > 0 && <span className="bad"><b>{st.wrong}</b> ✗ to fix</span>}
                {latestTest?.score && <span><b>{latestTest.score.correct}/{latestTest.score.total}</b> on the test</span>}
              </div>
              <div className="hero-foot">
                <button className="btn primary big" onClick={() => onOpen(latest.id)}><Icon.pen /> Continue writing</button>
                <span className={`hero-streak ${prog.streak ? 'hot' : ''}`}><Icon.flame /> {prog.streak ? `${prog.streak}-Day Streak!` : 'Start a streak today'}</span>
                <span className="spacer" />
                <button className="hero-stat" onClick={() => (prog.lastTopic ? onPractice(prog.lastTopic) : setPracticeOpen(true))} title={prog.lastTopic ? `Practise ${prog.lastTopic}` : 'Start a practice set'}>
                  <small>Last topic</small>
                  <b>{prog.lastTopic ?? 'Nothing yet'}</b>
                </button>
                <span className="hero-stat" title={`Daily goal: ${goalMin} minutes of writing. ${prog.today.minutes} done today.`}>
                  <small>Today's goal</small>
                  <b>{minutesLeft ? `${minutesLeft} min left` : 'Done'}</b>
                </span>
              </div>
            </div>
          </section>
        )}

        <section className="lib-section">
          <div className="shelf-head">
            <h2>Notebooks</h2>
            {items && items.length > 0 && <span className="muted">{items.length}</span>}
            <button className="btn primary" onClick={onCreate}><Icon.plus /> New Notebook</button>
            <button className="btn" onClick={() => pdfRef.current?.click()}><Icon.upload /> Import (PDF)</button>
            <span className="spacer" />
            <label className="lib-search">
              <input type="search" placeholder="Search notebooks" aria-label="Search notebooks" value={query} onChange={(e) => setQuery(e.target.value)} />
              <Icon.search />
            </label>
            <label className="lib-sort" title="Sort notebooks">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 5h16l-6 7.5V19l-4-2v-4.5L4 5z" /></svg>
              <select value={sort} aria-label="Sort notebooks" onChange={(e) => setSort(e.target.value as typeof sort)}>
                <option value="recent">Recent</option>
                <option value="oldest">Oldest</option>
                <option value="name">Name</option>
              </select>
            </label>
          </div>
          {weak.length > 0 && (
            <div className="weak-row">
              <span className="muted">Needs practice:</span>
              {weak.slice(0, 4).map((t) => (
                <button key={t.topic} className="topic-chip weak" onClick={() => onPractice(t.topic)} title={`Practise ${t.topic}`}>
                  {t.topic}<em>{Math.round((t.right / (t.right + t.wrong)) * 100)}%</em>
                </button>
              ))}
            </div>
          )}
          {items && items.length > 0 && shown.length === 0 && <p className="muted">No notebooks match “{query}”.</p>}
          <div className="cover-grid">
            {shown.map((n) => {
              const d = docs[n.id]
              const badge = coverBadge(d)
              const Art = COVER_ART[coverArt(d, n.id)]
              return (
                <div key={n.id} className="cover-card" style={coverStyle(n.id)}>
                  <button className="cover-open" onClick={() => onOpen(n.id)}>
                    <span className="cover-art"><Art /></span>
                    <span className="cover-info">
                      <span className="cover-title">{n.title}</span>
                      <span className="cover-meta">{n.pageCount} {n.pageCount === 1 ? 'page' : 'pages'}</span>
                      <span className="cover-meta">
                        Edited: {when(n.updatedAt)}
                        {badge && <span className={`cover-badge ${badge.kind}`}>{badge.text}</span>}
                      </span>
                    </span>
                  </button>
                  <button className="icon-btn sm nb-del" aria-label={`Delete ${n.title}`} onClick={() => void remove(n)}><Icon.trash /></button>
                </div>
              )
            })}
          </div>
        </section>
      </main>

      <nav className="try-dock" aria-label="Try this">
        <button onClick={() => onTry('graph')}><Icon.graph /> Graph Function</button>
        <button onClick={() => onTry('diagram')}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true"><path d="M4 20L12 4l8 16H4z" /></svg> Read Diagram</button>
        <button onClick={() => onTry('ask')}><Icon.ask /> Simplify Expression</button>
        <button onClick={() => pdfRef.current?.click()}><Icon.check /> Test Mode</button>
        <button onClick={() => setPracticeOpen(true)}><Icon.target /> Practice</button>
      </nav>
      <footer className="library-foot muted">NOVA stores notebooks on this device only.</footer>
      {practiceOpen && (
        <PracticeDialog suggested={weak.map((t) => t.topic)} onStart={(p) => { setPracticeOpen(false); if (p.topic) onPractice(p.topic) }} onClose={() => setPracticeOpen(false)} />
      )}
    </div>
  )
}

// ------------------------------------------------------------------ notebook covers

/** Each notebook gets its own cover colour, stable from its id. */
const COVERS = ['#3fa66a', '#2fa39a', '#3f7fd6', '#7a63d8', '#d9a326', '#d8637f']
function hashOf(id: string): number {
  let h = 0
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return h
}
function coverStyle(id: string): React.CSSProperties {
  return { '--cover': COVERS[hashOf(id) % COVERS.length] } as React.CSSProperties
}

/** What the notebook's status is, said honestly: a test score, how much NOVA marked right, or a draft. */
function coverBadge(doc?: NotebookDoc): { text: string; kind: 'good' | 'mid' | 'draft' } | null {
  if (!doc) return null
  const test = Object.values(doc.tests ?? {}).find((t) => t.score)
  if (test?.score) return { text: `${test.score.correct}/${test.score.total}`, kind: test.score.correct / Math.max(1, test.score.total) >= 0.6 ? 'good' : 'mid' }
  const s = stats(doc)
  if (s.right + s.wrong >= 2) {
    const pct = Math.round((s.right / (s.right + s.wrong)) * 100)
    return { text: `${pct}% right`, kind: pct >= 60 ? 'good' : 'mid' }
  }
  if (s.lines < 3) return { text: 'Draft', kind: 'draft' }
  return null
}

type Art = 'spiral' | 'radar' | 'matrix' | 'board' | 'notepad' | 'triangle' | 'wave'
function coverArt(doc: NotebookDoc | undefined, id: string): Art {
  const topic = notebookTopics(doc, 1)[0]
  if (topic === 'Calculus') return 'spiral'
  if (topic === 'Matrices & vectors') return 'matrix'
  if (topic === 'Trigonometry') return 'wave'
  if (topic === 'Geometry') return 'triangle'
  if (topic === 'Algebra' || topic === 'Linear equations' || topic === 'Quadratics') return 'board'
  if (topic === 'Arithmetic' || topic === 'Fractions & decimals') return 'notepad'
  if (topic) return 'radar'
  return (['notepad', 'spiral', 'radar'] as Art[])[hashOf(id) % 3] // nothing read yet
}

function A({ children }: { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  )
}
const SPIRAL = (() => {
  const pts: string[] = []
  for (let i = 0; i <= 90; i++) {
    const a = (i / 90) * Math.PI * 5.5
    const r = 2.5 + (i / 90) * 16
    pts.push(`${(24 + r * Math.cos(a)).toFixed(1)} ${(24 + r * Math.sin(a)).toFixed(1)}`)
  }
  return 'M' + pts.join('L')
})()
const WAVE = (() => {
  const pts: string[] = []
  for (let i = 0; i <= 40; i++) pts.push(`${(6 + i * 0.9).toFixed(1)} ${(24 - 11 * Math.sin((i / 40) * Math.PI * 2)).toFixed(1)}`)
  return 'M' + pts.join('L')
})()
const COVER_ART: Record<Art, () => React.ReactNode> = {
  spiral: () => <A><path d={SPIRAL} /></A>,
  radar: () => <A><circle cx="24" cy="24" r="2" fill="currentColor" /><path d="M24 17a7 7 0 1 0 7 7" /><path d="M24 10.5a13.500 13.500 0 1 0 13.500 13.500" /><path d="M24 4.500a19.500 19.500 0 1 0 19.500 19.500" strokeDasharray="5 6" /></A>,
  matrix: () => (
    <A>
      <path d="M13 7H8v34h5M35 7h5v34h-5" />
      {[0, 1, 2].map((r) => [0, 1, 2].map((c) => ((r + c) % 3 === 2 && r !== 1
        ? <ellipse key={`${r}${c}`} cx={16.5 + c * 7.5} cy={15 + r * 9} rx="2" ry="3" strokeWidth={2} />
        : <path key={`${r}${c}`} d={`M${16.5 + c * 7.5} ${12 + r * 9}v6`} />)))}
    </A>
  ),
  board: () => <A><rect x="6" y="8" width="36" height="24" rx="2.500" /><path d="M24 32v4M16 42l8-6 8 6" /><path d="M15 16c-2.500 0-3 2-3 4v6M10.500 20.500h4" /><path d="M20 16c-2 2.500-2 6.500 0 9M24 18l4 5M28 18l-4 5M32 16c2 2.500 2 6.500 0 9" strokeWidth={2} /></A>,
  notepad: () => <A><rect x="9" y="8" width="26" height="33" rx="2.500" /><path d="M15 5v6M22 5v6M29 5v6" /><path d="M15 20h14M15 27h9" /><path d="M41 17l-13 13-1.500 5.500 5.500-1.500 13-13a2.800 2.800 0 0 0-4-4z" fill="var(--cover-bg, none)" /></A>,
  triangle: () => <A><path d="M7 39L30 9l11 30H7z" /><path d="M13 39v-6h-1.500" strokeWidth={2} /><path d="M33.500 39a6 6 0 0 0-2-5" strokeWidth={2} /></A>,
  wave: () => <A><path d="M6 24h36" strokeWidth={1.600} strokeDasharray="2 4" /><path d={WAVE} /></A>,
}
