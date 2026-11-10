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
  const todayMarked = prog.today.right + prog.today.wrong

  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<'recent' | 'oldest' | 'name'>('recent')
  const [userMenu, setUserMenu] = useState(false)
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
  useEffect(() => {
    if (!userMenu) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setUserMenu(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [userMenu])
  const goalMin = 30
  const initials = (tester?.name ?? '').trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '?'

  return (
    <div className="library" onPointerDown={() => userMenu && setUserMenu(false)}>
      <header className="topbar">
        <img className="brand-logo" src="/nova-logo.png" alt="NOVA" />
        <span className="title-static">Notebooks</span>
        <span className="spacer" />
        {tester && (
          <div className="anchor-rel" onPointerDown={(e) => e.stopPropagation()}>
            <button className="user-btn" aria-haspopup="menu" aria-expanded={userMenu} onClick={() => setUserMenu((v) => !v)}>
              <span className="avatar" aria-hidden="true">{initials}</span>
              <span className="user-name hide-phone">{tester.name}</span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
            </button>
            {userMenu && (
              <div className="popover menu user-pop" role="menu">
                <div className="user-pop-head">
                  <span className="avatar lg" aria-hidden="true">{initials}</span>
                  <span><b>{tester.name}</b><small>Notebooks on this device</small></span>
                </div>
                <hr />
                <div className="menu-row" role="group" aria-label="Theme">
                  <span>Theme</span>
                  <span className="spacer" />
                  <span className="seg">
                    <button className={theme === 'light' ? 'on' : ''} aria-pressed={theme === 'light'} aria-label="Light mode" onClick={() => setThemePref('light')}><Icon.sun /></button>
                    <button className={theme === 'dark' ? 'on' : ''} aria-pressed={theme === 'dark'} aria-label="Dark mode" onClick={() => setThemePref('dark')}><Icon.moon /></button>
                  </span>
                </div>
                <button className="menu-item" role="menuitem" onClick={() => { setUserMenu(false); fileRef.current?.click() }}>Restore a backup…</button>
                <hr />
                <button className="menu-item" role="menuitem" onClick={() => { if (confirm('Log out? Your notebooks stay saved under your name on this device.')) onSwitchTester?.() }}>Log out / switch tester</button>
              </div>
            )}
          </div>
        )}
        <button className="btn hide-phone" onClick={() => fileRef.current?.click()}>Restore backup</button>
        <button className="btn primary" onClick={onCreate}><Icon.plus /> <span className="hide-phone">New notebook</span></button>
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
            <aside className="lc-side" aria-label="Your progress">
              <button className="side-box topic" onClick={() => (prog.lastTopic ? onPractice(prog.lastTopic) : setPracticeOpen(true))} title={prog.lastTopic ? `Practise ${prog.lastTopic}` : 'Start a practice set'}>
                <small>Last topic practised</small>
                <b>{prog.lastTopic ?? 'Nothing yet'}</b>
                <span className="side-link"><Icon.target /> {prog.lastTopic ? 'Practise it' : 'Start practice'}</span>
              </button>
              <div className="side-box">
                <small>Today's practice: <b>{prog.today.minutes} min</b></small>
                <span className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={goalMin} aria-valuenow={Math.min(goalMin, prog.today.minutes)} aria-label={`Daily goal ${goalMin} minutes`}>
                  <i style={{ width: `${Math.min(100, (prog.today.minutes / goalMin) * 100)}%` }} />
                </span>
                <small className="muted">{todayMarked ? `${Math.round((prog.today.right / todayMarked) * 100)}% right · ${prog.today.right} of ${todayMarked} marked` : `Goal: ${goalMin} min a day`}</small>
              </div>
              <div className={`side-box streak ${prog.streak ? 'hot' : ''}`}>
                <Icon.flame />
                <b>{prog.streak}-day streak</b>
              </div>
              {weak.length > 0 && (
                <div className="side-weak">
                  <small>Needs practice</small>
                  <div className="topic-chips">
                    {weak.slice(0, 3).map((t) => (
                      <button key={t.topic} className="topic-chip weak" onClick={() => onPractice(t.topic)} title={`Practise ${t.topic}`}>
                        {t.topic}<em>{Math.round((t.right / (t.right + t.wrong)) * 100)}%</em>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </aside>
          </section>
        )}

        <section className="lib-section">
          <div className="lib-head">
            <h2>All notebooks</h2>
            {items && items.length > 0 && <span className="muted">{items.length}</span>}
            <span className="spacer" />
            <label className="lib-search">
              <Icon.search />
              <input type="search" placeholder="Search notebooks…" aria-label="Search notebooks" value={query} onChange={(e) => setQuery(e.target.value)} />
            </label>
            <label className="lib-sort">
              <span className="hide-phone">Sort:</span>
              <select value={sort} aria-label="Sort notebooks" onChange={(e) => setSort(e.target.value as typeof sort)}>
                <option value="recent">Recent</option>
                <option value="oldest">Oldest</option>
                <option value="name">Name</option>
              </select>
            </label>
          </div>
          <div className="lib-adds">
            <button className="btn" onClick={onCreate}><Icon.plus /> New grid notebook</button>
            <button className="btn" onClick={() => pdfRef.current?.click()}><Icon.upload /> Import question paper</button>
          </div>
          {items && items.length > 0 && shown.length === 0 && <p className="muted">No notebooks match “{query}”.</p>}
          <div className="lib-grid">
            {shown.map((n) => {
              const d = docs[n.id]
              const test = d ? Object.values(d.tests ?? {})[0] : undefined
              const tags = notebookTopics(d)
              return (
                <div key={n.id} className="nb-card">
                  <button className="nb-open" onClick={() => onOpen(n.id)}>
                    <span className="nb-cover" style={coverStyle(n.id)}>
                      <span className="nb-paper">
                        <PageThumb page={pageOf(d)} aspect={1} />
                        {test && <span className={`nb-badge ${test.score ? 'scored' : ''}`}>{test.score ? `${test.score.correct}/${test.score.total}` : 'Test'}</span>}
                      </span>
                    </span>
                    <span className="nb-title">{n.title}</span>
                    {tags.length > 0 && <span className="nb-topics">{tags.map((t) => <span key={t} className="nb-topic">{t}</span>)}</span>}
                    <span className="nb-meta">{n.pageCount} {n.pageCount === 1 ? 'page' : 'pages'} · edited {when(n.updatedAt)}</span>
                  </button>
                  <button className="icon-btn sm nb-del" aria-label={`Delete ${n.title}`} onClick={() => void remove(n)}><Icon.trash /></button>
                </div>
              )
            })}
          </div>
        </section>

        <section className="lib-section">
          <div className="lib-head"><h2>Try this</h2></div>
          <div className="try-grid">
            <button className="try-card" onClick={() => onTry('graph')}>
              <span className="try-icon"><Icon.graph /></span>
              <span><b>Graph</b><small>Graph a function</small></span>
            </button>
            <button className="try-card" onClick={() => onTry('diagram')}>
              <span className="try-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true"><path d="M4 20L12 4l8 16H4z" /><path d="M8.5 20a3.5 3.5 0 0 0-1.6-2.9" /></svg></span>
              <span><b>Diagram</b><small>Read a geometry diagram</small></span>
            </button>
            <button className="try-card" onClick={() => onTry('ask')}>
              <span className="try-icon"><Icon.ask /></span>
              <span><b>Ask NOVA</b><small>Simplify an expression</small></span>
            </button>
            <button className="try-card" onClick={() => pdfRef.current?.click()}>
              <span className="try-icon"><Icon.check /></span>
              <span><b>Test</b><small>Start test mode from a PDF</small></span>
            </button>
            <button className="try-card" onClick={() => setPracticeOpen(true)}>
              <span className="try-icon"><Icon.target /></span>
              <span><b>Practice</b><small>A worksheet NOVA marks</small></span>
            </button>
          </div>
        </section>
      </main>
      <footer className="library-foot muted">NOVA stores notebooks on this device only.</footer>
      {practiceOpen && (
        <PracticeDialog suggested={weak.map((t) => t.topic)} onStart={(p) => { setPracticeOpen(false); if (p.topic) onPractice(p.topic) }} onClose={() => setPracticeOpen(false)} />
      )}
    </div>
  )
}

/** Each notebook gets its own cover colour, stable from its id. */
const COVERS: [string, string][] = [
  ['#cfe6fb', '#7fb6e8'], // sky
  ['#eef0f3', '#b9c1cc'], // paper grey
  ['#fde1c8', '#f0a868'], // peach
  ['#5b3fa0', '#3b2577'], // violet
  ['#d3f0dc', '#78c494'], // mint
  ['#fbecb4', '#e2c04f'], // sun
  ['#f8d4dc', '#e48aa0'], // rose
]
function coverStyle(id: string): React.CSSProperties {
  let h = 0
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0
  const [cover, spine] = COVERS[h % COVERS.length]
  return { '--cover': cover, '--spine': spine } as React.CSSProperties
}
