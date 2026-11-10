// Ask NOVA for a practice set: like a line on the page ("5 more like this") or on a topic.

import { useState } from 'react'
import { Icon } from './icons'
import { PRACTICE_TOPICS } from '../tutor/topics'

interface Props {
  example?: string | null // the selected line, if practice starts from one
  suggested?: string[] // weak topics first
  onStart: (p: { topic?: string; example?: string; count: number }) => void
  onClose: () => void
}

export function PracticeDialog({ example, suggested = [], onStart, onClose }: Props) {
  const [useExample, setUseExample] = useState(!!example)
  const [topic, setTopic] = useState('')
  const [count, setCount] = useState(5)
  const chips = [...new Set([...suggested, ...PRACTICE_TOPICS])].slice(0, 8)
  const ready = (useExample && !!example) || !!topic.trim()
  const start = () => {
    if (!ready) return
    onStart(useExample && example ? { example, topic: topic.trim() || undefined, count } : { topic: topic.trim(), count })
  }
  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <form className="dialog narrow practice-dialog" role="dialog" aria-label="Practice" onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); start() }}>
        <div className="dialog-head">
          <h2><Icon.target /> Practice</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}><Icon.close /></button>
        </div>
        <p className="muted">NOVA writes a worksheet on a new page and checks every answer key with its exact maths engine. Write your working under each question, then tap Finish to get it marked.</p>

        {example && (
          <div className="practice-src">
            <label className="row">
              <input type="radio" name="src" checked={useExample} onChange={() => setUseExample(true)} />
              <span>More like <b className="mono">{example}</b></span>
            </label>
            <label className="row">
              <input type="radio" name="src" checked={!useExample} onChange={() => setUseExample(false)} />
              <span>Choose a topic instead</span>
            </label>
          </div>
        )}

        {(!example || !useExample) && (
          <>
            <input className="practice-topic" autoFocus aria-label="Topic" placeholder="Topic, e.g. Linear equations" maxLength={80} value={topic} onChange={(e) => setTopic(e.target.value)} />
            <div className="row gap">
              {chips.map((t) => (
                <button type="button" key={t} className={`chip ${topic === t ? 'on' : ''} ${suggested.includes(t) ? 'weak' : ''}`} onClick={() => setTopic(t)}>{t}</button>
              ))}
            </div>
          </>
        )}

        <div className="row gap practice-count">
          <span className="muted">Questions</span>
          {[3, 5, 8].map((n) => (
            <button type="button" key={n} className={`chip ${count === n ? 'on' : ''}`} aria-pressed={count === n} onClick={() => setCount(n)}>{n}</button>
          ))}
        </div>

        <div className="row gap end">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary" disabled={!ready}>Make practice sheet</button>
        </div>
      </form>
    </div>
  )
}
