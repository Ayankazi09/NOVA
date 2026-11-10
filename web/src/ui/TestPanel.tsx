// The test sheet beside the paper: questions, progress, help, and — after marking — the score and review.

import type { Page, PaperQuestion, PaperTest } from '../notebook/types'
import { answerRegions } from '../tutor/usePaper'
import { Icon } from './icons'

interface Props {
  test: PaperTest
  pages: Record<string, Page>
  busy: string | null
  onGoto: (q: PaperQuestion) => void
  onHelp: (q: PaperQuestion) => void
  onReview: (q: PaperQuestion) => void
  onFinish: () => void
  onRetry: () => void
  onClose: () => void
  onPracticeMore?: () => void
}

export function TestPanel({ test, pages, busy, onGoto, onHelp, onReview, onFinish, onRetry, onClose, onPracticeMore }: Props) {
  const practice = test.kind === 'practice'
  const finished = test.status === 'finished'
  const answered = (q: PaperQuestion) => {
    const page = pages[q.pageId]
    return page ? answerRegions(page, test, q).length > 0 : false
  }
  const nAnswered = test.questions.filter(answered).length
  return (
    <aside className="test-panel" aria-label="Test" onPointerDown={(e) => e.stopPropagation()}>
      <header className="test-head">
        <div>
          <div className="test-kicker">{finished ? 'Marked' : test.status === 'reading' ? 'Reading the paper' : practice ? 'Practice' : 'Test'}</div>
          <div className="test-title">{test.title}</div>
        </div>
        <span className="spacer" />
        <button className="icon-btn sm" aria-label="Close test panel" onClick={onClose}><Icon.close /></button>
      </header>

      {finished && test.score && (
        <div className="score">
          <span className="score-num">{test.score.correct}</span>
          <span className="score-den">/ {test.score.total}</span>
          <span className="score-note">{test.score.correct === test.score.total ? 'Every answer is right.' : 'Tap Explain on a question to see what went wrong.'}</span>
        </div>
      )}

      {(test.status === 'reading' || busy) && (
        <div className="test-progress">
          <div className="bar"><i style={{ width: `${Math.round((test.progress.done / Math.max(1, test.progress.total)) * 100)}%` }} /></div>
          <span>{busy ?? `Reading page ${test.progress.done + 1} of ${test.progress.total}…`}</span>
        </div>
      )}
      {test.error && (
        <div className="test-error">
          {test.error}
          {!!test.failedPages?.length && test.status !== 'reading' && <button className="link strong" onClick={onRetry}>Retry</button>}
        </div>
      )}

      <ol className="q-list">
        {test.questions.map((q) => {
          const has = answered(q)
          return (
            <li key={q.id} className={`q-row ${q.verdict ?? ''}`} data-page={q.pageId} data-bounds={`${q.bounds.x},${q.bounds.y},${q.bounds.w},${q.bounds.h}`}>
              <button className="q-main" onClick={() => onGoto(q)} title="Show on the page">
                <span className="q-num">{q.number}</span>
                <span className="q-text">{q.text}</span>
              </button>
              <div className="q-foot">
                {finished ? (
                  <>
                    <span className={`q-verdict ${q.verdict}`}>{q.verdict === 'correct' ? '✓ Correct' : q.verdict === 'incorrect' ? '✗ Not right' : '— Not answered'}</span>
                    {q.verdict !== 'correct' && <span className="q-key">Answer: <b>{q.answer}</b></span>}
                    <span className="spacer" />
                    <button className="rb-action" onClick={() => onReview(q)}>Explain</button>
                  </>
                ) : (
                  <>
                    <span className={`q-state ${has ? 'done' : ''}`}>{has ? 'Answered on the page' : 'Write your answer below the question'}</span>
                    {q.helpCount > 0 && <span className="q-help">help ×{q.helpCount}</span>}
                    <span className="spacer" />
                    <button className="rb-action" disabled={test.status !== 'ready'} onClick={() => onHelp(q)}><Icon.ask /> Help</button>
                  </>
                )}
              </div>
            </li>
          )
        })}
      </ol>

      {!finished && (
        <footer className="test-foot">
          <span className="muted">{nAnswered} of {test.questions.length} answered</span>
          <span className="spacer" />
          <button className="btn primary" disabled={test.status !== 'ready' || !test.questions.length} onClick={onFinish}>{practice ? 'Finish & mark' : 'Finish test'}</button>
        </footer>
      )}
      {finished && practice && onPracticeMore && (
        <footer className="test-foot">
          <span className="muted">{test.score && test.score.correct === test.score.total ? 'All right! Try a few more?' : 'Practice makes it stick.'}</span>
          <span className="spacer" />
          <button className="btn primary" disabled={!!busy} onClick={onPracticeMore}><Icon.target /> 5 more like this</button>
        </footer>
      )}
    </aside>
  )
}
