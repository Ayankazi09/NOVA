import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type Dispatch } from 'react'
import { newPage, type DocAction, type DocState } from './doc'
import { strokeHit, strokeInSelection, containsPoint, inflate } from './geometry'
import { shortId } from './ids'
import { INK_COLOURS, INK_WIDTHS, type View } from './ink'
import type { Paper, Point, Rect, Stroke, Tool, TutorObject } from './types'
import { clampView, isInfinite, Workspace } from './Workspace'
import { TutorLayer } from '../tutor/Annotations'
import { useNova, type Intent } from '../tutor/useNova'
import { AskPanel } from '../ui/AskPopover'
import { TestPanel } from '../ui/TestPanel'
import { HandwritingSetup } from '../ui/HandwritingSetup'
import type { StartAction } from '../ui/Home'
import { Shelf } from '../ui/Shelf'
import { usePaper } from '../tutor/usePaper'
import { readingText } from './doc'
import { Icon } from '../ui/icons'
import { HistoryDrawer, ObjectSheet, PagesRail } from '../ui/Panels'
import { ReadbackLayer, RegionMenu, type RegionMenuAction } from '../ui/Readback'
import { AssistConsent, SettingsDialog, type AppSettings } from '../ui/Settings'
import { getAsset, putAsset } from '../storage/db'
import { buildBackup, checksumBytes, downloadJson } from '../storage/backup'
import { speak, stopSpeaking } from '../voice/speech'
import { PracticeDialog } from '../ui/PracticeDialog'
import { FirstRun } from '../ui/FirstRun'
import { downloadBlob, pageHasContent, printPng, renderPagePng, safeName, sharePng } from '../storage/share'
import { isWeak, progress } from '../tutor/topics'

export type SaveStatus = 'saved' | 'saving' | 'error'

interface Props {
  state: DocState
  dispatch: Dispatch<DocAction>
  settings: AppSettings
  setSettings: (s: AppSettings) => void
  saveStatus: SaveStatus
  saveError: string | null
  onRetrySave: () => void
  onBack: () => void
  startAction?: StartAction | null
  onStartConsumed?: () => void
  /** first visit: show what NOVA can do */
  showWelcome?: boolean
  onWelcomeDone?: () => void
  /** Home: this notebook is the scratch page; notebooks are pinned onto its grid */
  home?: { onOpen: (id: string) => void; onNew: () => void; onImportPaper: (file: File) => void; onRestore: (file: File) => void }
}

interface Toast {
  id: string
  text: string
  action?: { label: string; fn: () => void }
}

function useViewport() {
  const [size, setSize] = useState(() => ({
    w: typeof window !== 'undefined' ? window.innerWidth : 1200,
    h: typeof window !== 'undefined' ? window.innerHeight : 800,
  }))
  useEffect(() => {
    const on = () => setSize({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  return size
}

export function NotebookScreen({ state, dispatch, settings, setSettings, saveStatus, saveError, onRetrySave, onBack, startAction, onStartConsumed, home, showWelcome, onWelcomeDone }: Props) {
  const homePdfRef = useRef<HTMLInputElement>(null)
  const restoreRef = useRef<HTMLInputElement>(null)
  const { doc } = state
  const nb = doc.notebook
  const pageId = nb.lastPageId && doc.pages[nb.lastPageId] ? nb.lastPageId : nb.orderedPageIds[0]
  const page = doc.pages[pageId]
  const pageIndex = nb.orderedPageIds.indexOf(pageId)
  const { w: vw, h: vh } = useViewport()
  const phone = vw < 700 || Math.min(vw, vh) < 500 || (vw < 1000 && vh < 560)
  const desktop = vw >= 1100 && vh >= 600

  const [tool, setTool] = useState<Tool>('pen')
  const [hovered, setHovered] = useState<string | null>(null)
  const [colour, setColour] = useState(INK_COLOURS[0].value)
  const [width, setWidth] = useState(INK_WIDTHS[1].value)
  const [lasso, setLasso] = useState(false)
  const [view, setViewRaw] = useState<View>({ scale: 1, tx: 16, ty: 16 })
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [selected, setSelected] = useState<string | null>(null)
  const [ask, setAsk] = useState<{ mic: boolean; key: number; text?: string } | null>(null)
  const [askAbout, setAskAbout] = useState<string | null>(null) // line the conversation is about (null = whole page)
  const [pagesOpen, setPagesOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [consentOpen, setConsentOpen] = useState(false)
  const [menu, setMenu] = useState<null | 'overflow' | 'ink' | 'page' | 'dock'>(null)
  const [sheet, setSheet] = useState<TutorObject | null>(null)
  const [focus, setFocus] = useState(false)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [bgUrl, setBgUrl] = useState<string | undefined>()
  const [titleDraft, setTitleDraft] = useState(nb.title)
  const stylusOffered = useRef(false)

  const stateRef = useRef(state)
  stateRef.current = state
  const penActive = useRef(false)
  const bgImage = useRef<HTMLImageElement | null>(null)
  const views = useRef(new Map<string, View>())
  const fileRef = useRef<HTMLInputElement>(null)
  const pdfRef = useRef<HTMLInputElement>(null)
  const [testOpen, setTestOpen] = useState(false)
  const [hwOpen, setHwOpen] = useState(false)
  const [practiceOpen, setPracticeOpen] = useState<{ example: string | null } | null>(null)
  const [tourOpen, setTourOpen] = useState(false)

  useEffect(() => setTitleDraft(nb.title), [nb.title])

  const toast = useCallback((text: string, action?: Toast['action']) => {
    const id = shortId('t')
    setToasts((t) => [...t.slice(-2), { id, text, action }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), action ? 8000 : 5000)
  }, [])

  const nova = useNova({
    stateRef,
    dispatch,
    pageId,
    assist: settings.assist,
    autoAnswer: settings.autoAnswer,
    speechEnabled: settings.speechOutput,
    background: bgImage,
    penActive,
    onCapReached: () => toast('Automatic reading paused after 60 reads this session. Use Read on a line to continue.'),
    onBatchApplied: (n, batchId) => {
      toast(`NOVA added ${n} ${n === 1 ? 'item' : 'items'}.`, { label: 'Undo', fn: () => undoBatch(batchId) })
      setTimeout(() => revealRef.current(batchId), 80) // once the new writing is on the page
    },
  })

  const undoBatch = (batchId: string) => {
    const stack = stateRef.current.tutorUndo[pageId] ?? []
    if (stack[stack.length - 1] === batchId) dispatch({ type: 'undoTutor', pageId })
    else {
      const p = stateRef.current.doc.pages[pageId]
      p.tutorObjects.filter((t) => t.batchId === batchId).forEach((t) => dispatch({ type: 'dismissTutor', pageId, id: t.id }))
    }
  }

  // ---- view
  const setView = useCallback(
    (v: View | ((v: View) => View)) => {
      setViewRaw((prev) => {
        const next = typeof v === 'function' ? v(prev) : v
        return size.w ? clampView(next, stateRef.current.doc.pages[pageId], size.w, size.h) : next
      })
    },
    [size.w, size.h, pageId],
  )
  /** Bring what NOVA just wrote into view: it must never land off-screen or behind the Ask panel. */
  const revealRef = useRef<(batchId: string) => void>(() => undefined)
  revealRef.current = (batchId: string) => {
    const pg = stateRef.current.doc.pages[pageId]
    const objs = pg?.tutorObjects.filter((t) => t.batchId === batchId && t.status === 'active' && t.action.type !== 'highlight_region' && t.action.type !== 'speak') ?? []
    if (!objs.length || !size.w) return
    const x0 = Math.min(...objs.map((t) => t.layout.x)), y0 = Math.min(...objs.map((t) => t.layout.y))
    const x1 = Math.max(...objs.map((t) => t.layout.x + t.layout.w)), y1 = Math.max(...objs.map((t) => t.layout.y + t.layout.h))
    // the part of the workspace nothing covers (the Ask panel sits on the right, or over the bottom on a phone)
    const visW = size.w - (ask && !phone ? 432 : 0)
    const visH = ask && phone ? size.h * 0.38 : size.h
    setView((v) => {
      const pad = 24
      let { tx, ty } = v
      const sx = tx + x0 * v.scale, sw = (x1 - x0) * v.scale
      const sy = ty + y0 * v.scale, sh = (y1 - y0) * v.scale
      if (sx + sw > visW - pad) tx += visW - pad - (sx + sw)
      if (tx + x0 * v.scale < pad) tx = pad - x0 * v.scale // too wide to fit: show its start
      if (sy + sh > visH - pad) ty += visH - pad - (sy + sh)
      if (ty + y0 * v.scale < pad) ty = pad - y0 * v.scale
      return tx === v.tx && ty === v.ty ? v : { ...v, tx, ty }
    })
  }

  const fitWidth = useCallback(() => {
    if (!size.w) return
    if (page.bg) {
      // an imported sheet: fit its width, leaving the grid around it
      const scale = Math.min(2, (size.w - (phone ? 16 : 120)) / page.bg.w)
      setView({ scale, tx: 0, ty: 0 })
      return
    }
    if (isInfinite(page)) {
      setView({ scale: 1, tx: 0, ty: 0 }) // phones too: zooming out makes finger writing huge in page terms
      return
    }
    const scale = Math.min(2, (size.w - (phone ? 16 : 48)) / page.width)
    setView({ scale, tx: phone ? 8 : 24, ty: phone ? 12 : 16 })
  }, [size.w, page, phone, setView])

  useLayoutEffect(() => {
    if (!size.w) return
    const saved = views.current.get(pageId)
    if (saved) setView(saved)
    else fitWidth()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageId, size.w > 0])
  useEffect(() => {
    views.current.set(pageId, view)
  }, [view, pageId])

  // the endless grid: whatever part of it is on screen is part of the page (so NOVA can place things there too)
  useEffect(() => {
    if (!size.w || !isInfinite(page)) return
    const round = (v: number) => Math.ceil(v / 400) * 400
    const needW = round((size.w - view.tx) / view.scale + 200)
    const needH = round((size.h - view.ty) / view.scale + 200)
    if (needW > page.width || needH > page.height) dispatch({ type: 'ensureSize', pageId, width: needW, height: needH })
  }, [size.w, size.h, view, page, pageId, dispatch])

  // ---- background asset for imported pages
  useEffect(() => {
    let url: string | undefined
    let cancelled = false
    bgImage.current = null
    setBgUrl(undefined)
    if (page.backgroundAssetId) {
      void getAsset(page.backgroundAssetId).then((a) => {
        if (!a || cancelled) return
        url = URL.createObjectURL(new Blob([a.bytes], { type: a.mime }))
        const img = new Image()
        img.onload = () => (bgImage.current = img)
        img.src = url
        setBgUrl(url)
      })
    }
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [page.backgroundAssetId])

  // ---- content changes -> invalidate + schedule reading (covers strokes, erase, undo, redo)
  const prevHashes = useRef<Map<string, string> | null>(null)
  const prevPage = useRef(pageId)
  useEffect(() => {
    const now = new Map(page.regions.map((r) => [r.id, r.sourceHash]))
    const prev = prevHashes.current
    prevHashes.current = now
    if (!prev || prevPage.current !== pageId) {
      prevPage.current = pageId
      return
    }
    const changed = page.regions.filter((r) => prev.get(r.id) !== r.sourceHash && !page.readings[r.id])
    const removed = [...prev.keys()].some((id) => !now.has(id))
    if (changed.length) changed.forEach((r) => nova.contentChanged(r.id))
    else if (removed) nova.contentChanged(null)
    if (selected && !now.has(selected)) setSelected(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page.contentRevision, pageId])

  // ---- input handlers
  const commitStroke = (points: Point[]) => {
    const stroke: Stroke = { id: shortId('s'), points, colour, width, createdAt: Date.now(), author: 'student' }
    dispatch({ type: 'addStroke', pageId, stroke, newRegionId: shortId('r') })
  }

  const onSelect = (sel: { rect?: Rect; lasso?: Point[]; tap?: Point }) => {
    if (sel.tap) {
      const radius = 12 / view.scale
      const hit = page.strokes.find((s) => strokeHit(s, sel.tap!, radius))
      const region = hit ? page.regions.find((r) => r.sourceStrokeIds.includes(hit.id)) : page.regions.find((r) => containsPoint(inflate(r.bounds, 8), sel.tap!))
      setSelected(region?.id ?? null)
      return
    }
    const ids = page.strokes.filter((s) => strokeInSelection(s, sel)).map((s) => s.id)
    if (!ids.length) {
      setSelected(null)
      return
    }
    const same = page.regions.find((r) => r.sourceStrokeIds.length === ids.length && ids.every((id) => r.sourceStrokeIds.includes(id)))
    if (same) {
      setSelected(same.id)
      return
    }
    const regionId = shortId('r')
    dispatch({ type: 'selectRegion', pageId, strokeIds: ids, regionId })
    setSelected(regionId)
  }

  const regionBounds = useCallback((id: string) => page.regions.find((r) => r.id === id)?.bounds, [page.regions])

  const openAsk = (mic = false) => {
    setMenu(null)
    setAskAbout(selected)
    setAsk({ mic, key: Date.now() })
  }

  /** From the region menu: act on the selected line. */
  const runIntent = (intent: Intent, question: string) => {
    void nova.ask(intent, question, selected)
  }

  /** From the Ask panel: the conversation continues; it is about askAbout (or the whole page). */
  const askFromPanel = (intent: Intent, question: string, o?: { voice?: boolean }) => {
    // asked by voice → NOVA answers out loud too (typed questions stay silent unless "always speak" is on)
    void nova.ask(intent, question, askAbout && page.regions.some((r) => r.id === askAbout) ? askAbout : null, o?.voice ? { speak: true } : undefined)
  }

  const regionAction = (a: RegionMenuAction) => {
    if (!selected) return
    if (a === 'close') return setSelected(null)
    if (a === 'ask') return openAsk()
    if (a === 'read') return void nova.readNow(selected).catch((e) => toast((e as Error).message))
    if (a === 'problem') {
      dispatch({ type: 'setProblem', pageId, regionId: selected })
      toast('This line is now the problem. Help on it is tracked separately.')
      return
    }
    if (a === 'practice') {
      setPracticeOpen({ example: readingText(page.readings[selected]) ?? null })
      setSelected(null)
      return
    }
    if (a === 'solve') void nova.solveHere(selected)
    else runIntent(a, '')
    setSelected(null) // the menu must not sit over the answer NOVA is about to place
  }

  // ---- pages
  const addPage = () => {
    const p = newPage(nb.id, `Page ${nb.orderedPageIds.length + 1}`, { paper: page.paper })
    dispatch({ type: 'addPage', page: p, after: pageId })
    setSelected(null)
  }
  const openPage = (id: string) => {
    stopSpeaking()
    setSelected(null)
    setAsk(null)
    dispatch({ type: 'setLastPage', pageId: id })
    if (phone) setPagesOpen(false)
  }

  const paper = usePaper({
    stateRef,
    dispatch,
    currentPageId: pageId,
    openPage,
    nova,
    toast,
    openAsk: () => {
      setAskAbout(null)
      setAsk((a) => a ?? { mic: false, key: Date.now() })
    },
  })
  // opened from Home with something to do straight away
  const started = useRef(false)
  useEffect(() => {
    if (!startAction || started.current) return
    started.current = true
    if (startAction.type === 'pdf') {
      setTestOpen(true)
      void paper.importPaper(startAction.file)
    } else if (startAction.type === 'practice') {
      void runPractice({ topic: startAction.topic })
    } else if (startAction.type === 'tip') {
      toast(startAction.text, { label: 'Got it', fn: () => undefined })
    } else {
      setAskAbout(null)
      setAsk({ mic: false, key: Date.now(), text: startAction.text })
    }
    onStartConsumed?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startAction])
  const runPractice = async (p: { topic?: string; example?: string; count?: number }) => {
    setPracticeOpen(null)
    setTestOpen(false)
    const id = await paper.startPractice(p)
    if (id) setTestOpen(true)
  }
  const weakTopics = useMemo(() => progress([doc]).topics.filter(isWeak).map((t) => t.topic), [doc])

  // ---- share the page (image to the share sheet / download, or print to PDF)
  const [sharing, setSharing] = useState(false)
  const sharePage = async (mode: 'share' | 'download' | 'pdf') => {
    setMenu(null)
    const pg = stateRef.current.doc.pages[pageId]
    if (!pageHasContent(pg)) return toast('This page is empty. Write something first.')
    const title = `${nb.title} · ${pg.title || `Page ${pageIndex + 1}`}`
    setSharing(true)
    try {
      const blob = await renderPagePng(pg, title)
      if (mode === 'pdf') await printPng(blob, title)
      else if (mode === 'download') downloadBlob(blob, `${safeName(title)}.png`)
      else if ((await sharePng(blob, title)) === 'downloaded') toast('Page saved as an image. Send it from your downloads.')
    } catch (e) {
      toast((e as Error).message || 'Could not share this page.')
    } finally {
      setSharing(false)
    }
  }

  const testsList = Object.values(doc.tests ?? {}).sort((a, b) => b.createdAt - a.createdAt)
  const activeTest = testsList.find((t) => t.pageIds.includes(pageId)) ?? testsList[0]
  const gotoQuestion = (q: { pageId: string; bounds: Rect }) => {
    openPage(q.pageId)
    setTimeout(() => setView((v) => ({ ...v, ty: 130 - q.bounds.y * v.scale })), 60)
  }

  const importImage = async (file: File) => {
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return toast('Choose a PNG, JPEG or WebP image.')
    if (file.size > 12_000_000) return toast('That image is larger than 12 MB.')
    try {
      const bytes = await file.arrayBuffer()
      const url = URL.createObjectURL(file)
      const img = await new Promise<HTMLImageElement>((res, rej) => {
        const i = new Image()
        i.onload = () => res(i)
        i.onerror = () => rej(new Error('Could not open that image.'))
        i.src = url
      })
      URL.revokeObjectURL(url)
      const id = shortId('as')
      await putAsset({ id, mime: file.type, bytes, width: img.naturalWidth, height: img.naturalHeight, checksum: checksumBytes(bytes) })
      const w = 1200
      const h = Math.round((w * img.naturalHeight) / img.naturalWidth) // preserve aspect ratio
      const p = newPage(nb.id, file.name.replace(/\.[^.]+$/, '').slice(0, 60) || 'Homework', { width: w, height: Math.max(200, Math.min(h, 8000)), backgroundAssetId: id, paper: 'squared', bg: { w, h: Math.max(200, Math.min(h, 8000)) } })
      dispatch({ type: 'addPage', page: p, after: pageId })
      toast('Homework imported as a new page. Write your working on it.')
    } catch (e) {
      toast((e as Error).message || 'Import failed. Your notebook is unchanged.')
    }
  }

  const exportBackup = async () => {
    try {
      const b = await buildBackup(stateRef.current.doc)
      downloadJson(`${nb.title.replace(/[^\w-]+/g, '_') || 'notebook'}.nova.json`, b)
    } catch (e) {
      toast(`Export failed: ${(e as Error).message}`)
    }
  }

  // ---- keyboard
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') return
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        dispatch({ type: e.shiftKey ? 'redo' : 'undo', pageId })
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        dispatch({ type: 'redo', pageId })
      } else if (!mod) {
        const k = e.key.toLowerCase()
        if (k === 'p') setTool('pen')
        else if (k === 'e') setTool('eraser')
        else if (k === 's') setTool('select')
        else if (k === 'h') setTool('pan')
        else if (k === 'escape') {
          setSelected(null)
          setAsk(null)
          setMenu(null)
        }
      }
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [dispatch, pageId])

  useEffect(() => {
    const stop = () => document.visibilityState === 'hidden' && stopSpeaking()
    document.addEventListener('visibilitychange', stop)
    return () => document.removeEventListener('visibilitychange', stop)
  }, [])

  const canUndo = (state.undo[pageId]?.length ?? 0) > 0
  const canRedo = (state.redo[pageId]?.length ?? 0) > 0
  const pageTurns = useMemo(() => page.history, [page.history])
  const assistantBusy = nova.status.state === 'working'

  const toggleAssist = () => {
    if (settings.assist) setSettings({ ...settings, assist: false })
    else if (!settings.assistConsent) setConsentOpen(true)
    else setSettings({ ...settings, assist: true })
  }

  useEffect(() => {
    const st = nova.status
    if (st.state === 'idle' || st.state === 'working' || st.retry) return
    const t = setTimeout(() => nova.setStatus({ state: 'idle' }), 4000) // notices don't linger on the page
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nova.status])

  const statusPos = (() => {
    const id = nova.status.anchorRegionId
    const b = id ? regionBounds(id) : undefined
    if (!b) return { left: 16, top: 12 }
    return { left: Math.min(size.w - 280, Math.max(8, view.tx + (b.x + b.w) * view.scale + 16)), top: Math.max(8, view.ty + b.y * view.scale) }
  })()

  const toolButton = (t: Tool, label: string, icon: React.ReactNode, extra?: string) => (
    <button key={t} className={`tool-btn ${tool === t ? 'active' : ''}`} aria-pressed={tool === t} aria-label={label} title={extra ? `${label} — ${extra}` : label} onClick={() => setTool(t)}>
      {icon}
      {!phone && <span className="tool-label">{label}</span>}
    </button>
  )

  const inkPopover = (
    <div className="popover menu ink-pop" onPointerDown={(e) => e.stopPropagation()}>
      <div className="pop-label">Colour</div>
      <div className="row gap">
        {INK_COLOURS.map((c) => (
          <button key={c.value} className={`swatch ${colour === c.value ? 'on' : ''}`} style={{ background: c.value }} aria-label={c.name} onClick={() => { setColour(c.value); setTool('pen') }} />
        ))}
      </div>
      <div className="pop-label">Width</div>
      <div className="row gap">
        {INK_WIDTHS.map((w) => (
          <button key={w.value} className={`width-btn ${width === w.value ? 'on' : ''}`} aria-label={w.name} onClick={() => { setWidth(w.value); setTool('pen') }}>
            <span style={{ height: Math.max(2, w.value * 0.9), background: colour }} />
          </button>
        ))}
      </div>
      <div className="pop-label">Select shape</div>
      <div className="row gap">
        <button className={`chip ${!lasso ? 'on' : ''}`} onClick={() => setLasso(false)}>Rectangle</button>
        <button className={`chip ${lasso ? 'on' : ''}`} onClick={() => setLasso(true)}>Lasso</button>
      </div>
    </div>
  )

  const pagePopover = (
    <div className="popover menu page-pop" onPointerDown={(e) => e.stopPropagation()}>
      <div className="pop-label">Paper</div>
      {(['squared', 'ruled', 'blank'] as Paper[]).map((p) => (
        <button key={p} className={`menu-item ${page.paper === p ? 'on' : ''}`} disabled={!!page.backgroundAssetId} onClick={() => { dispatch({ type: 'setPaper', pageId, paper: p }); setMenu(null) }}>
          {p[0].toUpperCase() + p.slice(1)}
        </button>
      ))}
      <hr />
      <button className="menu-item" onClick={() => { addPage(); setMenu(null) }}>New page</button>
      <button className="menu-item" onClick={() => { pdfRef.current?.click(); setMenu(null) }}>Import question paper (PDF)…</button>
      <button className="menu-item" onClick={() => { fileRef.current?.click(); setMenu(null) }}>Import homework image…</button>
      <button className="menu-item" onClick={() => { const t = prompt('Page name', page.title); if (t !== null) dispatch({ type: 'renamePage', pageId, title: t }); setMenu(null) }}>Rename page…</button>
      <button className="menu-item" disabled={nb.orderedPageIds.length <= 1} onClick={() => { if (confirm('Delete this page?')) dispatch({ type: 'deletePage', pageId }); setMenu(null) }}>Delete page</button>
    </div>
  )

  const overflowPopover = (
    <div className="popover menu overflow-pop" onPointerDown={(e) => e.stopPropagation()}>
      <button className="menu-item" onClick={() => { setPracticeOpen({ example: null }); setMenu(null) }}>Practice a topic…</button>
      <button className="menu-item" disabled={sharing} onClick={() => void sharePage('share')}>Share page as image</button>
      <button className="menu-item" disabled={sharing} onClick={() => void sharePage('download')}>Download page image (.png)</button>
      <button className="menu-item" disabled={sharing} onClick={() => void sharePage('pdf')}>Save page as PDF…</button>
      <hr />
      <button className="menu-item" onClick={() => { setSettingsOpen(true); setMenu(null) }}>Settings & connection</button>
      <button className="menu-item" onClick={() => { void exportBackup(); setMenu(null) }}>Export backup</button>
      <button className="menu-item" onClick={() => { setFocus(true); setMenu(null) }}>Focus mode</button>
      <button className="menu-item" onClick={() => { setHistoryOpen(true); setMenu(null) }}>NOVA history</button>
      <button className="menu-item" onClick={() => { setTourOpen(true); setMenu(null) }}>What NOVA can do</button>
      <hr />
      <button className="menu-item" onClick={() => { addPage(); setMenu(null) }}>New page</button>
      <button className="menu-item" onClick={() => { pdfRef.current?.click(); setMenu(null) }}>Import question paper (PDF)…</button>
      <button className="menu-item" onClick={() => { fileRef.current?.click(); setMenu(null) }}>Import homework image…</button>
    </div>
  )

  const saveLabel = saveStatus === 'saving' ? 'Saving…' : saveStatus === 'error' ? 'Not saved' : 'Saved'

  return (
    <div
      className={`notebook ${phone ? 'phone' : desktop ? 'desktop' : 'tablet'} ${focus ? 'focus' : ''}`}
      onPointerDown={() => menu && setMenu(null)}
      onPointerMove={(e) => {
        if (e.pointerType !== 'mouse') return
        // which written line is the mouse over (including the strip under it where its label sits)?
        const ws = document.querySelector('[data-testid=workspace]')?.getBoundingClientRect()
        if (!ws) return
        const x = (e.clientX - ws.left - view.tx) / view.scale
        const y = (e.clientY - ws.top - view.ty) / view.scale
        const hit = page.regions.find((r) => x >= r.bounds.x - 24 && x <= r.bounds.x + Math.max(r.bounds.w, 360 / view.scale) + 24 && y >= r.bounds.y - 24 && y <= r.bounds.y + r.bounds.h + 56 / view.scale)
        const id = hit?.id ?? null
        if (id !== hovered) setHovered(id)
      }}
      onPointerLeave={() => hovered && setHovered(null)}
    >
      {!focus && home && (
        <header className="topbar home-bar">
          <img className="brand-logo" src="/nova-logo.png" alt="NOVA" />
          <span className="spacer" />
          <button className="btn" onClick={() => homePdfRef.current?.click()}><Icon.upload /> Import paper</button>
          <button className="btn primary" onClick={home.onNew}><Icon.plus /> New notebook</button>
          <div className="anchor-rel">
            <button className="icon-btn" aria-label="More" onClick={(e) => { e.stopPropagation(); setMenu(menu === 'overflow' ? null : 'overflow') }}><Icon.more /></button>
            {menu === 'overflow' && (
              <div className="popover menu overflow-pop" onPointerDown={(e) => e.stopPropagation()}>
                <button className="menu-item" onClick={() => { setSettingsOpen(true); setMenu(null) }}>Settings</button>
                <button className="menu-item" onClick={() => { restoreRef.current?.click(); setMenu(null) }}>Restore a backup…</button>
              </div>
            )}
          </div>
          <input ref={homePdfRef} type="file" accept="application/pdf,.pdf" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) home.onImportPaper(f) }} />
          <input ref={restoreRef} type="file" accept=".json,.nova.json,application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) home.onRestore(f) }} />
        </header>
      )}
      {!focus && !home && (
        <header className="topbar">
          <button className="icon-btn" aria-label="Notebooks" onClick={onBack}><Icon.back />{!phone && <span className="tool-label">Notes</span>}</button>
          {!phone && <img className="brand-logo sm" src="/nova-logo.png" alt="NOVA" />}
          <input
            className="title-input"
            value={titleDraft}
            aria-label="Notebook title"
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={() => titleDraft.trim() !== nb.title && dispatch({ type: 'renameNotebook', title: titleDraft.trim() })}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
          <span className="spacer" />
          {saveStatus === 'error' ? (
            <button className="badge bad" onClick={onRetrySave} title={saveError ?? ''}>Not saved · Retry</button>
          ) : (
            !phone && <span className="save-status">{saveLabel}</span>
          )}
          {phone && (
            // on a phone Assist must be one tap away: without it NOVA never reads what you write
            <button className={`assist-toggle ${settings.assist ? 'on' : ''}`} onClick={toggleAssist} aria-pressed={settings.assist}>
              Assist {settings.assist ? 'on' : 'off'}
            </button>
          )}
          {!phone && <span className="sep">|</span>}
          <button className="page-count" onClick={() => setPagesOpen((v) => !v)} aria-label={`Page ${pageIndex + 1} of ${nb.orderedPageIds.length}`}>{phone ? `${pageIndex + 1}/${nb.orderedPageIds.length}` : `Page ${pageIndex + 1} of ${nb.orderedPageIds.length}`}</button>
          <div className="anchor-rel">
            <button className="icon-btn" aria-label="More" onClick={(e) => { e.stopPropagation(); setMenu(menu === 'overflow' ? null : 'overflow') }}><Icon.more /></button>
            {menu === 'overflow' && overflowPopover}
          </div>
        </header>
      )}

      {!focus && !phone && (
        <div className="toolbar" role="toolbar" aria-label="Writing tools">
          {!home && <button className={`tool-btn ${pagesOpen ? 'active' : ''}`} aria-label="Pages" onClick={() => setPagesOpen((v) => !v)}><Icon.pages /></button>}
          {!home && <span className="tb-sep" />}
          {toolButton('pen', 'Pen', <Icon.pen />)}
          {toolButton('eraser', 'Eraser', <Icon.eraser />, 'touch a stroke to delete it')}
          {toolButton('select', 'Select', <Icon.select />, 'drag around a line or tap it')}
          {toolButton('pan', 'Pan', <Icon.pan />)}
          <div className="anchor-rel">
            <button className="tool-btn" aria-label="Ink colour and width" onClick={(e) => { e.stopPropagation(); setMenu(menu === 'ink' ? null : 'ink') }}>
              <span className="ink-preview" style={{ background: colour, height: Math.max(2, width * 0.9) }} />
            </button>
            {menu === 'ink' && inkPopover}
          </div>
          <span className="tb-sep" />
          <button className="tool-btn" aria-label="Undo" disabled={!canUndo} onClick={() => dispatch({ type: 'undo', pageId })}><Icon.undo /></button>
          <button className="tool-btn" aria-label="Redo" disabled={!canRedo} onClick={() => dispatch({ type: 'redo', pageId })}><Icon.redo /></button>
          <button className="tool-btn zoom" aria-label={isInfinite(page) ? 'Reset view' : 'Fit width'} title={isInfinite(page) ? 'Back to 100% at the top' : 'Fit width'} onClick={fitWidth}>{Math.round(view.scale * 100)}%</button>
          <div className="anchor-rel">
            <button className="tool-btn" aria-label="Page options" onClick={(e) => { e.stopPropagation(); setMenu(menu === 'page' ? null : 'page') }}><Icon.notebook /></button>
            {menu === 'page' && pagePopover}
          </div>
          <span className="spacer" />
          <button className={`assist-toggle ${settings.assist ? 'on' : ''}`} onClick={toggleAssist} aria-pressed={settings.assist} title="Automatically read your writing after a pause">
            Assist {settings.assist ? 'on' : 'off'}
          </button>
          {testsList.length > 0 && (
            <button className={`tool-btn test-btn ${testOpen ? 'active' : ''}`} aria-label="Test" onClick={() => setTestOpen((v) => !v)}><Icon.check /><span className="tool-label">Test</span></button>
          )}
          <button className="tool-btn" aria-label="Share page" title="Share this page as an image" disabled={sharing} onClick={() => void sharePage('share')}><Icon.share /></button>
          <button className={`tool-btn ${historyOpen ? 'active' : ''}`} aria-label="History" onClick={() => setHistoryOpen((v) => !v)}><Icon.history /></button>
          <button className="ask-btn" onClick={() => openAsk(false)}><Icon.ask /> Ask NOVA</button>
          <button className="tool-btn" aria-label="Ask by voice" onClick={() => openAsk(true)}><Icon.mic /></button>
        </div>
      )}

      <div className="body">
        {pagesOpen && !focus && <PagesRail doc={doc} currentId={pageId} drawer={!desktop} onOpen={openPage} onNew={addPage} onClose={() => setPagesOpen(false)} />}
        <Workspace
          page={page}
          tool={tool}
          colour={colour}
          width={width}
          stylusOnly={settings.stylusOnly}
          lasso={lasso}
          view={view}
          setView={setView}
          backgroundUrl={bgUrl}
          onSize={(w, h) => setSize({ w, h })}
          onCommitStroke={commitStroke}
          onErase={(ids) => dispatch({ type: 'eraseStrokes', pageId, ids })}
          onSelect={onSelect}
          onPenDown={() => {
            penActive.current = true
            nova.scheduler.penDown()
            setMenu(null)
          }}
          onPenUp={() => {
            penActive.current = false
          }}
          onPenDetected={() => {
            if (settings.stylusOnly || stylusOffered.current) return
            stylusOffered.current = true
            toast('Stylus detected. Let fingers pan instead of draw?', { label: 'Stylus only', fn: () => setSettings({ ...settings, stylusOnly: true }) })
          }}
          pageLayer={
            <>
              {home && page.strokes.length === 0 && (
                <div className="home-hint" style={{ left: 96, top: 170 }}>
                  <span className="hint-big">Write anything here.</span>
                  <span className="hint-small">Try <b>3 + 2 =</b>, <b>x + 3 = 4</b> or <b>y = 2x + 1</b> — NOVA answers right next to it.</span>
                  {!settings.assist && <button className="btn primary hint-btn" onPointerDown={(e) => e.stopPropagation()} onClick={toggleAssist}>Turn on Assist so NOVA answers as you write</button>}
                </div>
              )}
              {home && <Shelf onOpen={home.onOpen} onCreate={home.onNew} />}
              <TutorLayer
                page={page}
                regionBounds={regionBounds}
                speechEnabled={settings.speechOutput}
                onDismiss={(id) => dispatch({ type: 'dismissTutor', pageId, id })}
                onPlay={(t) => (t.action.type === 'add_note' || t.action.type === 'speak') && speak(t.action.text, t.id)}
                onOpen={setSheet}
              />
            </>
          }
          screenLayer={
            <>
              <ReadbackLayer
                page={page}
                view={view}
                phases={nova.phases}
                selectedRegionId={selected}
                hoveredRegionId={hovered}
                onAccept={(id, text) => dispatch({ type: 'acceptReading', pageId, regionId: id, text })}
                onRetry={(id) => void nova.readNow(id).catch((e) => toast((e as Error).message))}
                onSelect={setSelected}
                onQuick={(id, intent) => {
                  if (intent === 'ask') {
                    setAskAbout(id)
                    setAsk({ mic: false, key: Date.now() })
                  } else if (intent === 'solve') void nova.solveHere(id)
                  else void nova.ask(intent, '', id)
                }}
              />
              {selected && !ask && <RegionMenu page={page} view={view} regionId={selected} viewport={size} onAction={regionAction} />}
              {nova.status.state !== 'idle' && !ask && (
                <div className={`nova-status ${nova.status.state}`} style={statusPos} onPointerDown={(e) => e.stopPropagation()} role="status">
                  {assistantBusy && <span className="spinner" />}
                  <span>{nova.status.message}</span>
                  {assistantBusy && <button className="link" onClick={nova.cancel}>Stop</button>}
                  {nova.status.retry && <button className="link strong" onClick={nova.status.retry}>Retry</button>}
                  {!assistantBusy && <button className="icon-btn sm" aria-label="Dismiss" onClick={() => nova.setStatus({ state: 'idle' })}><Icon.close /></button>}
                </div>
              )}
            </>
          }
        />
        {historyOpen && !focus && <HistoryDrawer turns={pageTurns} onClose={() => setHistoryOpen(false)} />}
        {testOpen && activeTest && !focus && (
          <TestPanel
            test={activeTest}
            pages={doc.pages}
            busy={paper.busy}
            onGoto={gotoQuestion}
            onHelp={(q) => paper.help(activeTest.id, q)}
            onReview={(q) => paper.review(activeTest.id, q)}
            onFinish={() => void paper.finish(activeTest.id)}
            onRetry={() => paper.retryFailed(activeTest.id)}
            onClose={() => setTestOpen(false)}
            onPracticeMore={activeTest.kind === 'practice' ? () => void runPractice({ topic: activeTest.topic, example: activeTest.source }) : undefined}
          />
        )}
      </div>

      {phone && !focus && (
        <nav className="dock" aria-label="Writing tools">
          {toolButton('pen', 'Pen', <Icon.pen />)}
          {toolButton('eraser', 'Eraser', <Icon.eraser />)}
          <button className="tool-btn" aria-label="Undo" disabled={!canUndo} onClick={() => dispatch({ type: 'undo', pageId })}><Icon.undo /></button>
          <button className="tool-btn ask-dock" aria-label="Ask NOVA" onClick={() => openAsk(false)}><Icon.ask /></button>
          <button className="tool-btn" aria-label="Ask by voice" onClick={() => openAsk(true)}><Icon.mic /></button>
          <div className="anchor-rel">
            <button className="tool-btn" aria-label="More tools" onClick={(e) => { e.stopPropagation(); setMenu(menu === 'dock' ? null : 'dock') }}><Icon.more /></button>
            {menu === 'dock' && (
              <div className="popover menu dock-pop" onPointerDown={(e) => e.stopPropagation()}>
                <div className="row gap">
                  {toolButton('select', 'Select', <Icon.select />)}
                  {toolButton('pan', 'Pan', <Icon.pan />)}
                  <button className="tool-btn" aria-label="Redo" disabled={!canRedo} onClick={() => dispatch({ type: 'redo', pageId })}><Icon.redo /></button>
                  <button className="tool-btn" aria-label="Fit width" onClick={() => { fitWidth(); setMenu(null) }}><Icon.fit /></button>
                </div>
                {inkPopover.props.children}
                <hr />
                <button className="menu-item" onClick={() => { toggleAssist(); setMenu(null) }}>Assist: {settings.assist ? 'on' : 'off'}</button>
                <button className="menu-item" onClick={() => { setPagesOpen(true); setMenu(null) }}>Pages</button>
                <button className="menu-item" onClick={() => { setHistoryOpen(true); setMenu(null) }}>NOVA history</button>
                <button className="menu-item" onClick={() => { setPracticeOpen({ example: null }); setMenu(null) }}>Practice a topic…</button>
                <button className="menu-item" disabled={sharing} onClick={() => void sharePage('share')}>Share page</button>
                {testsList.length > 0 && <button className="menu-item" onClick={() => { setTestOpen(true); setMenu(null) }}>Test / practice sheet</button>}
                <button className="menu-item" onClick={() => { setMenu('page') }}>Page options…</button>
              </div>
            )}
            {menu === 'page' && pagePopover}
          </div>
        </nav>
      )}

      {focus && (
        <div className="focus-dock" onPointerDown={(e) => e.stopPropagation()}>
          {toolButton('pen', 'Pen', <Icon.pen />)}
          {toolButton('eraser', 'Eraser', <Icon.eraser />)}
          <button className="tool-btn" aria-label="Undo" disabled={!canUndo} onClick={() => dispatch({ type: 'undo', pageId })}><Icon.undo /></button>
          <button className="tool-btn" aria-label="Stop NOVA" onClick={nova.cancel}><Icon.stop /></button>
          <button className="tool-btn" aria-label="Exit focus mode" onClick={() => setFocus(false)}><Icon.focus /></button>
        </div>
      )}

      {ask && (
        <AskPanel
          key={ask.key}
          docked={!phone}
          startWithMic={ask.mic}
          initialText={ask.text}
          turns={page.history}
          status={nova.status}
          about={askAbout ? readingText(page.readings[askAbout]) ?? 'the selected line' : null}
          onClearAbout={() => setAskAbout(null)}
          onSend={askFromPanel}
          onClose={() => setAsk(null)}
        />
      )}
      {sheet && <ObjectSheet obj={sheet} onClose={() => setSheet(null)} />}
      {paper.busy && !(testOpen && activeTest) && (
        <div className="busy-banner" role="status"><span className="spinner" />{paper.busy}</div>
      )}
      {practiceOpen && (
        <PracticeDialog example={practiceOpen.example} suggested={weakTopics} onStart={(p) => void runPractice(p)} onClose={() => setPracticeOpen(null)} />
      )}
      {(tourOpen || (showWelcome && !home)) && (
        <FirstRun onClose={() => { setTourOpen(false); onWelcomeDone?.() }} />
      )}
      {settingsOpen && (
        <SettingsDialog
          settings={settings}
          onChange={setSettings}
          onClose={() => setSettingsOpen(false)}
          onRequestAssist={() => setConsentOpen(true)}
          onExport={() => void exportBackup()}
          onTeachHandwriting={() => {
            setSettingsOpen(false)
            setHwOpen(true)
          }}
        />
      )}
      {hwOpen && <HandwritingSetup onClose={() => setHwOpen(false)} notify={toast} />}
      {consentOpen && (
        <AssistConsent
          onAccept={() => {
            setSettings({ ...settings, assist: true, assistConsent: true })
            setConsentOpen(false)
          }}
          onCancel={() => setConsentOpen(false)}
        />
      )}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="toast">
            <span>{t.text}</span>
            {t.action && <button className="link strong" onClick={() => { t.action!.fn(); setToasts((x) => x.filter((y) => y.id !== t.id)) }}>{t.action.label}</button>}
          </div>
        ))}
      </div>
      <input ref={pdfRef} type="file" accept="application/pdf,.pdf" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) { setTestOpen(true); void paper.importPaper(f) } }} />
      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void importImage(f) }} />
    </div>
  )
}
