import { useEffect, useRef } from 'react'
import katex from 'katex'
import type { NotebookDoc, TutorObject } from '../notebook/types'
import { PlotLegend, PlotView, plainToTex } from '../tutor/Annotations'
import { Icon } from './icons'

export function PagesRail({ doc, currentId, onOpen, onNew, onClose, drawer }: { doc: NotebookDoc; currentId: string; onOpen: (id: string) => void; onNew: () => void; onClose: () => void; drawer: boolean }) {
  return (
    <aside className={drawer ? 'pages-rail drawer' : 'pages-rail'} aria-label="Pages">
      <div className="panel-head">
        <span>Pages</span>
        <span className="spacer" />
        <button className="icon-btn sm" aria-label="New page" onClick={onNew}><Icon.plus /></button>
        <button className="icon-btn sm" aria-label="Close pages" onClick={onClose}><Icon.close /></button>
      </div>
      <div className="thumbs">
        {doc.notebook.orderedPageIds.map((id, i) => {
          const p = doc.pages[id]
          return (
            <button key={id} className={`thumb ${id === currentId ? 'current' : ''}`} onClick={() => onOpen(id)}>
              <Thumb strokes={p.strokes} w={p.width} h={p.height} />
              <span>{p.title || `Page ${i + 1}`}</span>
            </button>
          )
        })}
      </div>
    </aside>
  )
}

function Thumb({ strokes, w, h }: { strokes: NotebookDoc['pages'][string]['strokes']; w: number; h: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current
    if (!c) return
    const ctx = c.getContext('2d')!
    const s = c.width / w
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, c.width, c.height)
    ctx.setTransform(s, 0, 0, s, 0, 0)
    ctx.lineCap = 'round'
    for (const st of strokes) {
      ctx.strokeStyle = st.colour
      ctx.lineWidth = Math.max(st.width, 4)
      ctx.beginPath()
      st.points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)))
      ctx.stroke()
    }
  }, [strokes, w, h])
  return <canvas ref={ref} width={150} height={Math.round((150 * h) / w)} className="thumb-canvas" />
}

export function HistoryDrawer({ turns, onClose }: { turns: { role: string; text: string; at: number }[]; onClose: () => void }) {
  return (
    <aside className="history" aria-label="NOVA history">
      <div className="panel-head">
        <span>History</span>
        <span className="spacer" />
        <button className="icon-btn sm" aria-label="Close history" onClick={onClose}><Icon.close /></button>
      </div>
      <div className="turns">
        {turns.length === 0 && <p className="muted">No questions on this page yet.</p>}
        {turns.map((t, i) => (
          <div key={i} className={`turn ${t.role}`}>
            <div className="turn-role">{t.role === 'student' ? 'You' : 'NOVA'} · {new Date(t.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
            <div>{t.text}</div>
          </div>
        ))}
      </div>
    </aside>
  )
}

export function ObjectSheet({ obj, onClose }: { obj: TutorObject; onClose: () => void }) {
  const a = obj.action
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet big" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="NOVA note">
        <div className="ask-head">
          <span className="tutor-label">NOVA{obj.status === 'stale' ? ' · outdated' : ''}</span>
          <span className="spacer" />
          <button className="icon-btn sm" aria-label="Close" onClick={onClose}><Icon.close /></button>
        </div>
        {(a.type === 'add_note' || a.type === 'speak') && <p className="sheet-text">{a.text}</p>}
        {a.type === 'write_equation' && <div className="sheet-eq" dangerouslySetInnerHTML={{ __html: katex.renderToString(plainToTex(a.expression), { throwOnError: false, trust: false }) }} />}
        {a.type === 'draw_groups' && (
          <div className="groups"><div className="group-row">{a.groups.map((g, i) => <div key={i} className="group-box">{g}</div>)}</div><div className="group-caption">{a.caption}</div></div>
        )}
        {a.type === 'plot_function' && (<><PlotView plot={a.plot} w={Math.min(window.innerWidth - 48, 520)} h={Math.min(window.innerHeight * 0.55, 460)} /><PlotLegend plot={a.plot} /></>)}
        {a.type === 'highlight_region' && <p className="sheet-text">{a.reason}</p>}
      </div>
    </div>
  )
}
