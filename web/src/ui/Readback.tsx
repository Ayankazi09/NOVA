// Screen-space readback labels ("I read …") and the anchored region menu.

import { useState } from 'react'
import type { View } from '../notebook/ink'
import { isLargeStroke, isTinyRegion, readingText } from '../notebook/doc'
import type { Page, Region } from '../notebook/types'
import type { ReadPhase } from '../recognition/scheduler'
import { Icon } from './icons'

const CHECK_LABEL: Record<string, string> = {
  equivalent: 'Same solution as the problem',
  different: 'Different solution from the problem',
  solved: 'Solved',
  unsupported: 'Outside what NOVA can check',
  needs_clarification: 'Confirm the reading first',
  correct: 'Correct',
  incorrect: 'Not correct yet',
  incomplete: 'Unfinished',
}

interface Props {
  page: Page
  view: View
  phases: Record<string, { phase: ReadPhase; error?: string }>
  selectedRegionId: string | null
  hoveredRegionId?: string | null // labels show only for the line under the mouse (or the latest line on touch screens)
  onAccept: (regionId: string, text: string) => void
  onRetry: (regionId: string) => void
  onSelect: (regionId: string) => void
  onQuick: (regionId: string, intent: 'plot' | 'solve' | 'ask') => void
}

function screenRect(view: View, r: Region['bounds']) {
  return { x: view.tx + r.x * view.scale, y: view.ty + r.y * view.scale, w: r.w * view.scale, h: r.h * view.scale }
}

export function ReadbackLayer({ page, view, phases, selectedRegionId, hoveredRegionId, onAccept, onRetry, onSelect, onQuick }: Props) {
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null)
  const stop = (e: React.PointerEvent) => e.stopPropagation()
  const canHover = typeof window !== 'undefined' && window.matchMedia?.('(hover: hover)').matches
  const lastStroke = page.strokes[page.strokes.length - 1]
  const latestRegion = lastStroke ? page.regions.find((r) => r.sourceStrokeIds.includes(lastStroke.id))?.id : undefined
  return (
    <>
      {page.regions.map((region) => {
        const s = screenRect(view, region.bounds)
        const reading = page.readings[region.id]
        const phase = phases[region.id]
        const isProblem = page.problemRegionId === region.id
        const selected = selectedRegionId === region.id
        const top = s.y + s.h + 4
        const reveal = selected || hoveredRegionId === region.id || editing?.id === region.id || (!canHover && latestRegion === region.id)
        const needsYou = reading?.state === 'needs_clarification' || phase?.phase === 'failed'
        if (!reveal && !needsYou) return null // quiet page: details appear when you point at a line
        // dots/specks and big drawings with no maths get no label at all
        if (!selected && (isTinyRegion(page, region) || (reading?.status === 'none' && isLargeStroke(region.bounds)))) return null
        const label = (() => {
          if (editing?.id === region.id) {
            return (
              <form
                className="readback edit"
                onSubmit={(e) => {
                  e.preventDefault()
                  if (editing.text.trim()) onAccept(region.id, editing.text)
                  setEditing(null)
                }}
              >
                <input autoFocus value={editing.text} maxLength={160} onChange={(e) => setEditing({ id: region.id, text: e.target.value })} aria-label="Correct the reading" onKeyDown={(e) => e.key === 'Escape' && setEditing(null)} />
                <button className="btn sm primary" type="submit">Save</button>
                <button className="btn sm" type="button" onClick={() => setEditing(null)}>Cancel</button>
              </form>
            )
          }
          if (phase?.phase === 'recognizing') return <div className="readback pending">Reading…</div>
          if (phase?.phase === 'failed')
            return (
              <div className="readback failed">
                Couldn't read this line. <button className="link" onClick={() => onRetry(region.id)}>Retry</button>
              </div>
            )
          if (!reading) return null
          if (reading.status === 'none')
            return (
              <div className="readback muted-rb">
                No maths found. <button className="link" onClick={() => setEditing({ id: region.id, text: '' })}>Type it</button>
              </div>
            )
          if (reading.state === 'accepted') {
            const c = reading.check
            return (
              <div className="readback accepted" title={reading.rawText !== reading.acceptedText ? `NOVA first read: ${reading.rawText}` : undefined}>
                <span className="rb-text">{reading.acceptedText}</span>
                {c && <span className={`check-tag ${c.status}`}>{CHECK_LABEL[c.status]}</span>}
                {/[yY]/.test(reading.acceptedText ?? '') && /[xXθ]/.test(reading.acceptedText ?? '') && (
                  <button className="rb-action" onClick={() => onQuick(region.id, 'plot')}><Icon.graph /> Graph</button>
                )}
                {(reading.acceptedText ?? '').trim() && (
                  <button className="rb-action" onClick={() => onQuick(region.id, 'solve')}>Solve</button>
                )}
                <button className="rb-action" onClick={() => onQuick(region.id, 'ask')}><Icon.ask /> Ask</button>
                <button className="link" onClick={() => setEditing({ id: region.id, text: reading.acceptedText ?? '' })}>Edit</button>
              </div>
            )
          }
          if (reading.state === 'needs_clarification') {
            return (
              <div className="readback unclear">
                <span>Which did you write?</span>
                {[reading.rawText, ...reading.alternatives].filter(Boolean).map((alt) => (
                  <button key={alt} className="chip mono" onClick={() => onAccept(region.id, alt)}>{alt}</button>
                ))}
                <button className="link" onClick={() => setEditing({ id: region.id, text: reading.rawText })}>Other</button>
              </div>
            )
          }
          return (
            <div className="readback">
              <span className="muted">I read:</span> <span className="rb-text">{reading.rawText}</span>
              {reading.status === 'incomplete' && <span className="muted"> (unfinished)</span>}
              <button className="link strong" onClick={() => onAccept(region.id, reading.rawText)}>Confirm</button>
              <button className="link" onClick={() => setEditing({ id: region.id, text: reading.rawText })}>Edit</button>
            </div>
          )
        })()
        return (
          <div key={region.id}>
            {(selected || isProblem) && (
              <div className={`region-box ${selected ? 'selected' : ''}`} style={{ left: s.x - 6, top: s.y - 6, width: s.w + 12, height: s.h + 12 }}>
                {isProblem && <span className="problem-tag">Problem</span>}
              </div>
            )}
            {label && (
              <div className="readback-anchor" style={{ left: Math.max(s.x, view.tx + 4, 4), top }} onPointerDown={stop} onClick={() => onSelect(region.id)}>
                {label}
              </div>
            )}
          </div>
        )
      })}
    </>
  )
}

export type RegionMenuAction = 'ask' | 'read' | 'check' | 'complete' | 'solve' | 'plot' | 'problem' | 'close'

interface MenuProps {
  page: Page
  view: View
  regionId: string
  viewport: { w: number; h: number }
  onAction: (a: RegionMenuAction) => void
}

const MENU_W = 560
const MENU_H = 46

/** Place the menu where it covers no other line or readback label: beside, above, then below the label. */
function menuPosition(page: Page, view: View, regionId: string, viewport: { w: number; h: number }) {
  const region = page.regions.find((r) => r.id === regionId)!
  const s = screenRect(view, region.bounds)
  const blockers = page.regions
    .filter((r) => r.id !== regionId)
    .map((r) => {
      const b = screenRect(view, r.bounds)
      return { x: b.x - 8, y: b.y - 8, w: Math.max(b.w, 260) + 16, h: b.h + 44 } // ink + its label
    })
  const menuW = Math.min(MENU_W, Math.max(260, (viewport.w || 600) - 16))
  const hits = (x: number, y: number) =>
    x < 4 || y < 4 || x + menuW > viewport.w - 4 || y + MENU_H > viewport.h - 4 ||
    blockers.some((b) => x < b.x + b.w && b.x < x + menuW && y < b.y + b.h && b.y < y + MENU_H)
  const candidates = [
    { x: s.x + s.w + 16, y: s.y + s.h / 2 - MENU_H / 2 }, // right of the line
    { x: s.x, y: s.y - MENU_H - 10 }, // above
    { x: s.x, y: s.y + s.h + 34 }, // below its readback label
    { x: Math.max(4, s.x + s.w - menuW), y: s.y - MENU_H - 10 },
    { x: Math.max(4, s.x + s.w - menuW), y: s.y + s.h + 34 },
  ]
  const free = candidates.find((c) => !hits(c.x, c.y))
  const pick = free ?? candidates[2]
  return { left: Math.max(4, Math.min(pick.x, Math.max(4, viewport.w - menuW - 4))), top: Math.max(4, pick.y) }
}

export function RegionMenu({ page, view, regionId, viewport, onAction }: MenuProps) {
  const region = page.regions.find((r) => r.id === regionId)
  if (!region) return null
  const isProblem = page.problemRegionId === regionId
  const reading = page.readings[regionId]
  const pos = menuPosition(page, view, regionId, viewport)
  const text = readingText(reading) ?? ''
  return (
    <div className="region-menu" style={pos} onPointerDown={(e) => e.stopPropagation()} role="toolbar" aria-label="Selected work">
      <button className="menu-btn" onClick={() => onAction('ask')}><Icon.ask /> Ask</button>
      <button className="menu-btn" onClick={() => onAction('read')}><Icon.read /> Read</button>
      <button className="menu-btn" onClick={() => onAction('check')}><Icon.check /> Check</button>
      <button className="menu-btn" onClick={() => onAction('complete')}>Next step</button>
      {(!reading || /[=<>≤≥]/.test(text)) && <button className="menu-btn" onClick={() => onAction('solve')}>Solve</button>}
      {(!reading || /[xyθ]/i.test(text)) && <button className="menu-btn" onClick={() => onAction('plot')}><Icon.graph /> Graph</button>}
      {!isProblem && /x/i.test(text) && text.includes('=') && !text.trim().endsWith('=') && <button className="menu-btn" onClick={() => onAction('problem')}>Set as problem</button>}
      <button className="icon-btn sm" aria-label="Clear selection" onClick={() => onAction('close')}><Icon.close /></button>
    </div>
  )
}
