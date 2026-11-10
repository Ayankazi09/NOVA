import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { docReducer, initialState, newNotebook, type DocAction, type DocState } from './notebook/doc'
import { NotebookScreen, type SaveStatus } from './notebook/NotebookScreen'
import { getMeta, listNotebooks, loadNotebook, saveNotebook, setMeta } from './storage/db'
import type { StartAction } from './ui/Home'
import { Library } from './ui/Library'
import { signOutTester, type Tester } from './account/tester'
import { DEFAULT_SETTINGS, type AppSettings } from './ui/Settings'
import { loadLibrary } from './handwriting/library'

type S = DocState | null
function reducer(s: S, a: DocAction | { type: 'close' }): S {
  if (a.type === 'close') return null
  if (a.type === 'load') return initialState(a.doc)
  return s ? docReducer(s, a) : s
}

export default function App({ tester }: { tester?: Tester }) {
  const [state, dispatch] = useReducer(reducer, null)
  const [screen, setScreen] = useState<'loading' | 'library' | 'notebook' | 'error'>('loading')
  const [bootError, setBootError] = useState<string | null>(null)
  const [settings, setSettingsState] = useState<AppSettings>(DEFAULT_SETTINGS)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [startAction, setStartAction] = useState<StartAction | null>(null)
  const [showWelcome, setShowWelcome] = useState(false)
  const savedDirty = useRef(0)
  const stateRef = useRef(state)
  stateRef.current = state

  const open = useCallback(async (id: string, action?: StartAction, pageId?: string) => {
    try {
      setStartAction(action ?? null)
      const doc = await loadNotebook(id)
      if (!doc) return setScreen('library')
      if (pageId && doc.pages[pageId]) doc.notebook.lastPageId = pageId // open the exact page
      dispatch({ type: 'load', doc })
      savedDirty.current = 0
      await setMeta('lastNotebookId', id)
      setScreen('notebook')
    } catch (e) {
      setNotice((e as Error).message)
      setScreen('library')
    }
  }, [])

  const create = useCallback(async (action?: StartAction, title?: string) => {
    const doc = newNotebook(title || 'Maths practice')
    await saveNotebook(doc)
    await open(doc.notebook.id, action)
  }, [open])

  // start on Home: "Continue" is one tap away; a first-time student lands in a fresh notebook
  const booted = useRef(false)
  useEffect(() => {
    if (booted.current) return // run once (React dev mode mounts effects twice)
    booted.current = true
    void (async () => {
      try {
        void loadLibrary()
        if (!(await getMeta<boolean>('firstRunSeen'))) setShowWelcome(true)
        const s = await getMeta<AppSettings>('settings')
        // older saved settings started with Assist off: switch it on once (people can still turn it off)
        if (s) setSettingsState({ ...DEFAULT_SETTINGS, ...s, ...((s as AppSettings).settingsV !== 2 ? { assist: true, assistConsent: true, autoAnswer: true, settingsV: 2 } : {}) })
        // open the last page directly; no dashboard detour
        const last = await getMeta<string>('lastNotebookId')
        if (last && last !== 'nb_scratch' && (await loadNotebook(last))) return open(last)
        const all = (await listNotebooks()).filter((n) => n.id !== 'nb_scratch')
        if (all.length) return open(all[0].id)
        await create()
      } catch (e) {
        setBootError((e as Error).message)
        setScreen('error')
      }
    })()
  }, [open, create])

  /** Practice from the library: in the "Practice" notebook (made the first time). */
  const practice = useCallback(async (topic: string) => {
    const existing = (await listNotebooks()).find((n) => n.title === 'Practice')
    if (existing) return open(existing.id, { type: 'practice', topic })
    await create({ type: 'practice', topic }, 'Practice')
  }, [open, create])

  /** "Try this" on the library: in the notebook you were last writing in (a new one if there is none). */
  const tryIt = useCallback(async (what: 'graph' | 'diagram' | 'ask') => {
    const action: StartAction =
      what === 'graph' ? { type: 'ask', text: 'Draw the graph of y = x² − 4 on my page and mark where it crosses the axes' }
      : what === 'ask' ? { type: 'ask', text: 'Simplify (x + 3)² − 9 and write the steps on my page' }
      : { type: 'tip', text: 'Draw a triangle, label its sides and angles (like 5 cm, 40°), then write “find x” beside it. NOVA reads the diagram and solves it.' }
    const latest = (await listNotebooks()).filter((n) => n.id !== 'nb_scratch')[0]
    if (latest) return open(latest.id, action)
    await create(action)
  }, [open, create])

  const welcomeDone = () => {
    setShowWelcome(false)
    void setMeta('firstRunSeen', true).catch(() => undefined)
  }

  const setSettings = (s: AppSettings) => {
    setSettingsState(s)
    void setMeta('settings', s).catch(() => undefined)
  }

  // transactional save after committed changes (debounced)
  const save = useCallback(async () => {
    const s = stateRef.current
    if (!s) return
    const dirty = s.dirty
    setSaveStatus('saving')
    try {
      await saveNotebook(s.doc)
      savedDirty.current = dirty
      setSaveStatus(stateRef.current && stateRef.current.dirty !== dirty ? 'saving' : 'saved')
      setSaveError(null)
    } catch (e) {
      setSaveStatus('error')
      setSaveError((e as Error).message)
    }
  }, [])

  useEffect(() => {
    if (!state || state.dirty === savedDirty.current) return
    setSaveStatus('saving')
    const t = setTimeout(() => void save(), 300)
    return () => clearTimeout(t)
  }, [state?.dirty, save, state])

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (stateRef.current && stateRef.current.dirty !== savedDirty.current) e.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [])

  if (screen === 'loading') return <div className="center muted">Opening notebook…</div>
  if (screen === 'error') return <div className="center error-text">Notebook storage is unavailable: {bootError}</div>
  const toastEl = notice && <div className="toasts"><div className="toast"><span>{notice}</span><button className="link" onClick={() => setNotice(null)}>OK</button></div></div>
  if (screen === 'library' || !state)
    return (
      <>
        <Library tester={tester} onSwitchTester={() => { signOutTester(); location.reload() }} onOpen={(id) => void open(id)} onCreate={() => void create()} onImportPaper={(f) => void create({ type: 'pdf', file: f }, f.name.replace(/.pdf$/i, '').slice(0, 60))} onPractice={(t) => void practice(t)} onTry={(w) => void tryIt(w)} notify={setNotice} />
        {toastEl}
      </>
    )
  return (
    <>
      {toastEl}
      <NotebookScreen
        key={state.doc.notebook.id}
        state={state}
        dispatch={dispatch}
        settings={settings}
        setSettings={setSettings}
        saveStatus={saveStatus}
        saveError={saveError}
        onRetrySave={() => void save()}
        startAction={startAction}
        onStartConsumed={() => setStartAction(null)}
        showWelcome={showWelcome}
        onWelcomeDone={welcomeDone}
        onBack={async () => {
          await save()
          dispatch({ type: 'close' })
          setScreen('library')
        }}
      />
    </>
  )
}
