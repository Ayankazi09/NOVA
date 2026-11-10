// Shown once, the first time a student opens a notebook: what NOVA can do, in six cards.

import { Icon } from './icons'

const CARDS: { icon: () => React.ReactNode; title: string; body: string; example?: string }[] = [
  { icon: Icon.pen, title: 'Write maths by hand', body: 'Pause after a line and NOVA reads it.', example: '3x + 2 = 11' },
  { icon: Icon.check, title: 'Answers and ✓ / ✗ marks', body: 'End a line with “=” and NOVA writes the answer. Write your own answer and it marks it.' },
  { icon: Icon.ask, title: 'Ask NOVA', body: 'Type or speak a question about a line or the whole page. You get hints, steps and graphs.' },
  { icon: Icon.target, title: 'Practice', body: 'Select a line and tap Practice to get 5 more like it, all marked by NOVA.' },
  { icon: Icon.upload, title: 'Question papers', body: 'Import a PDF paper. NOVA tests you on it and marks every answer.' },
  { icon: Icon.share, title: 'Share a page', body: 'Send a solved page as an image or a PDF.' },
]

export function FirstRun({ onClose }: { onClose: () => void }) {
  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog first-run" role="dialog" aria-label="Welcome to NOVA" onClick={(e) => e.stopPropagation()}>
        <div className="fr-head">
          <img className="brand-logo" src="/nova-logo.png" alt="NOVA" />
          <h2>Your maths notebook that writes back</h2>
          <p className="muted">Everything stays on this device. Here is what you can do:</p>
        </div>
        <ul className="fr-grid">
          {CARDS.map((c) => (
            <li key={c.title} className="fr-card">
              <span className="fr-icon"><c.icon /></span>
              <b>{c.title}</b>
              <span className="muted">{c.body}</span>
              {c.example && <code className="fr-example">{c.example}</code>}
            </li>
          ))}
        </ul>
        <div className="row end">
          <button className="btn primary big" autoFocus onClick={onClose}><Icon.pen /> Start writing</button>
        </div>
      </div>
    </div>
  )
}
