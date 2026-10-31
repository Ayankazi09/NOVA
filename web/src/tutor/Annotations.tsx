// Tutor layer: labelled, dismissible, page-coordinate objects. Source text is rendered as data (no HTML).

import katex from 'katex'
import { useId, useMemo } from 'react'
import type { Page, PlotData, PlotPoint, Rect, TutorObject } from '../notebook/types'
import { Icon } from '../ui/icons'

/** A teacher's quick circle around a line: an ellipse that overshoots its start, slightly uneven. */
function looseCircle(r: Rect, seed: string): string {
  let h = 0
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2
  const rx = r.w / 2 + 10, ry = r.h / 2 + 8
  const start = -2.4 + (h % 100) / 200
  const pts: string[] = []
  for (let i = 0; i <= 40; i++) {
    const t = start + (i / 40) * Math.PI * 2.12
    const wob = 1 + Math.sin(t * 3 + (h % 7)) * 0.025
    pts.push(`${(cx + rx * wob * Math.cos(t)).toFixed(1)} ${(cy + ry * wob * Math.sin(t) + (i / 40) * 4).toFixed(1)}`)
  }
  return 'M' + pts.join(' L')
}

export function plainToTex(expr: string): string {
  const safe = expr.replace(/[\\{}$&#^_%~]/g, (c) => (c === '^' ? '^' : '')).replace(/\*/g, ' \\times ').replace(/\//g, ' \\div ')
  return safe
}

function Equation({ expr }: { expr: string }) {
  const html = useMemo(() => katex.renderToString(plainToTex(expr), { throwOnError: false, trust: false, strict: 'ignore', output: 'html' }), [expr])
  return <span className="katex-wrap" dangerouslySetInnerHTML={{ __html: html }} />
}

const SERIES_CLASS = ['plot-line', 'plot-line second', 'plot-line third']

export function PlotView({ plot, w, h }: { plot: PlotData; w: number; h: number }) {
  const clipId = useId().replace(/:/g, '')
  const pad = 30
  const yLo = plot.yMin, yHi = plot.yMax
  const ySpan = yHi - yLo || 1
  const xSpan = plot.xMax - plot.xMin || 1
  const X = (x: number) => pad + ((x - plot.xMin) / xSpan) * (w - 2 * pad)
  const Y = (y: number) => h - pad - ((y - yLo) / ySpan) * (h - 2 * pad)
  const ticks = (lo: number, hi: number) => {
    const span = hi - lo
    const step = Math.pow(10, Math.floor(Math.log10(span / 4 || 1)))
    const nice = [1, 2, 5, 10].map((m) => m * step).find((s) => span / s <= 6) ?? step * 10
    const out: number[] = []
    for (let v = Math.ceil(lo / nice) * nice; v <= hi + 1e-9; v += nice) out.push(Math.round(v * 1e6) / 1e6)
    return out
  }
  const x0 = plot.xMin <= 0 && plot.xMax >= 0 ? X(0) : X(plot.xMin)
  const y0 = yLo <= 0 && yHi >= 0 ? Y(0) : Y(yLo)
  const series = plot.series?.length ? plot.series : [{ label: plot.normalized, segments: plot.segments ?? [] }]
  const points: PlotPoint[] = (plot.points ?? (plot.checkPoints ?? []).map((p): PlotPoint => ({ ...p, kind: 'check' }))).filter(
    (p) => p.x >= plot.xMin && p.x <= plot.xMax && p.y >= yLo && p.y <= yHi,
  )
  return (
    <svg width={w} height={h} className="plot" role="img" aria-label={`Graph of ${plot.normalized} for x from ${plot.xMin} to ${plot.xMax}`}>
      <defs>
        <clipPath id={clipId}>
          <rect x={pad} y={pad} width={w - 2 * pad} height={h - 2 * pad} />
        </clipPath>
      </defs>
      {ticks(plot.xMin, plot.xMax).map((t) => (
        <g key={`x${t}`}>
          <line x1={X(t)} x2={X(t)} y1={pad} y2={h - pad} className="plot-grid" />
          {t !== 0 && <text x={X(t)} y={Math.min(h - pad + 14, y0 + 14)} className="plot-tick" textAnchor="middle">{t}</text>}
        </g>
      ))}
      {ticks(yLo, yHi).map((t) => (
        <g key={`y${t}`}>
          <line x1={pad} x2={w - pad} y1={Y(t)} y2={Y(t)} className="plot-grid" />
          {t !== 0 && <text x={Math.max(pad + 18, x0 - 4)} y={Y(t) + 4} className="plot-tick" textAnchor="end">{t}</text>}
        </g>
      ))}
      <line x1={pad} x2={w - pad} y1={y0} y2={y0} className="plot-axis" />
      <line x1={x0} x2={x0} y1={pad} y2={h - pad} className="plot-axis" />
      <text x={w - pad + 4} y={y0 + 4} className="plot-label">x</text>
      <text x={x0 + 4} y={pad - 6} className="plot-label">y</text>
      <g clipPath={`url(#${clipId})`}>
        {series.map((sr, k) =>
          sr.segments.map((seg, i) =>
            seg.length === 2 && plot.kind === 'implicit' ? (
              <line key={`${k}-${i}`} x1={X(seg[0].x)} y1={Y(seg[0].y)} x2={X(seg[1].x)} y2={Y(seg[1].y)} className={SERIES_CLASS[k % 3]} />
            ) : (
              <polyline key={`${k}-${i}`} points={seg.map((p) => `${X(p.x)},${Y(p.y)}`).join(' ')} className={SERIES_CLASS[k % 3]} />
            ),
          ),
        )}
      </g>
      {points.map((p, i) => (
        <g key={i}>
          <circle cx={X(p.x)} cy={Y(p.y)} r={p.kind === 'check' ? 3 : 5} className={`plot-point ${p.kind ?? ''}`} />
          {p.label && p.kind !== 'check' && (
            <text
              x={X(p.x) + (p.kind === 'intercept' ? 8 : 0)}
              y={p.kind === 'intercept' ? Y(p.y) - 8 : p.kind === 'root' ? Y(p.y) + (i % 2 ? -10 : 18) : Y(p.y) - 10}
              textAnchor={p.kind === 'intercept' ? 'start' : 'middle'}
              className={`plot-pt-label ${p.kind ?? ''}`}
            >
              {p.label}
            </text>
          )}
        </g>
      ))}
    </svg>
  )
}

export function PlotLegend({ plot }: { plot: PlotData }) {
  const series = plot.series?.length ? plot.series : [{ label: plot.normalized, segments: [] }]
  return (
    <div className="plot-caption">
      {series.map((s, k) => (
        <div key={k} className="legend-row"><span className={`legend-swatch s${k % 3}`} />{s.label}</div>
      ))}
      {plot.note && <div className="plot-note">{plot.note}</div>}
    </div>
  )
}

interface Props {
  page: Page
  regionBounds: (id: string) => Rect | undefined
  speechEnabled: boolean
  onDismiss: (id: string) => void
  onPlay: (obj: TutorObject) => void
  onOpen: (obj: TutorObject) => void
}

export function TutorLayer({ page, regionBounds, speechEnabled, onDismiss, onPlay, onOpen }: Props) {
  const visible = page.tutorObjects.filter((t) => t.status !== 'dismissed')
  const stop = (e: React.PointerEvent) => e.stopPropagation()
  return (
    <>
      <svg className="leaders" width={page.width} height={page.height}>
        {visible.map((t) => {
          if (t.action.type === 'highlight_region') {
            const r = t.layout
            return <path key={t.id} d={looseCircle(r, t.id)} className={`hl ${t.status} ${t.action.subtle ? 'subtle' : ''}`} />
          }
          if (t.action.type === 'write_ink') {
            const a = t.action
            const fresh = Date.now() - t.createdAt < 4000 // animate only when it has just been written
            return (
              <g key={t.id} className={`nova-ink tone-${a.tone} ${t.status}`}>
                {a.strokes.map((s, i) => (
                  <path
                    key={i}
                    d={'M' + s.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(' L')}
                    pathLength={1}
                    strokeWidth={a.width}
                    className={fresh ? 'draw' : undefined}
                    style={{ stroke: a.colors?.[i], ...(fresh ? { animationDelay: `${Math.round((i / a.strokes.length) * Math.min(1500, a.strokes.length * 90))}ms` } : {}) }}
                  />
                ))}
              </g>
            )
          }
          if (!t.layout.leader) return null
          const a = regionBounds(t.anchorRegionId)
          if (!a) return null
          return <line key={t.id} x1={a.x + a.w + 4} y1={a.y + a.h / 2} x2={t.layout.x} y2={t.layout.y + 20} className={`leader ${t.status}`} />
        })}
      </svg>
      {visible.map((t) => {
        const a = t.action
        if (a.type === 'write_ink') {
          if (t.id.endsWith(':why')) return null // the step notes belong to the solution; it carries the tag
          return (
            <button key={t.id} className={`ink-tag tone-${a.tone} ${t.status}`} style={a.purpose === 'completion' && a.text.includes('\n')
              ? { left: t.layout.x - 6, top: t.layout.y - 22 } // a worked solution: tag its top-left corner, clear of the notes beside it
              : { left: t.layout.x + t.layout.w + 6, top: t.layout.y + Math.max(0, t.layout.h / 2 - 11) }}
              onPointerDown={stop} onClick={() => onDismiss(t.id)} title={t.status === 'stale' ? 'Outdated: your line changed. Tap to remove.' : 'Written by NOVA. Tap to remove.'}>
              NOVA
            </button>
          )
        }
        if (a.type === 'highlight_region') {
          return a.reason && !a.subtle ? (
            <div key={t.id} className={`hl-tag ${t.status}`} style={{ left: t.layout.x, top: t.layout.y - 26 }}>{a.reason}</div>
          ) : null
        }
        const stale = t.status === 'stale'
        const label = a.type === 'write_equation' ? (a.purpose === 'completion' ? 'NOVA · next step' : 'NOVA · hint') : a.type === 'plot_function' ? 'NOVA · graph' : a.type === 'draw_groups' ? 'NOVA · groups' : 'NOVA'
        return (
          <div
            key={t.id}
            className={`tutor-card ${a.type} ${stale ? 'stale' : ''}`}
            style={{ left: t.layout.x, top: t.layout.y, width: t.layout.w }}
            onPointerDown={stop}
            data-testid="tutor-card"
          >
            <div className="tutor-head">
              <span className="tutor-label">{label}</span>
              {stale && <span className="tag-outdated" title="Your work changed after this was written">Outdated</span>}
              {a.type === 'write_equation' && a.verified && <span className="tag-verified" title="Checked: same solution as the problem">checked</span>}
              <span className="spacer" />
              {speechEnabled && (a.type === 'add_note' || a.type === 'speak') && (
                <button className="icon-btn sm" aria-label="Play" onClick={() => onPlay(t)}><Icon.play /></button>
              )}
              <button className="icon-btn sm" aria-label="Open" onClick={() => onOpen(t)}><Icon.read /></button>
              <button className="icon-btn sm" aria-label="Dismiss" onClick={() => onDismiss(t.id)}><Icon.close /></button>
            </div>
            {(a.type === 'add_note' || a.type === 'speak') && <p className="tutor-text">{a.text}</p>}
            {a.type === 'write_equation' && (
              <div className="tutor-eq"><Equation expr={a.expression} /></div>
            )}
            {t.caption && a.type === 'write_equation' && <p className="tutor-caption">{t.caption}</p>}
            {a.type === 'draw_groups' && (
              <div className="groups">
                <div className="group-row">
                  {a.groups.map((g, i) => (
                    <div key={i} className="group-box">{g}</div>
                  ))}
                </div>
                {a.caption && <div className="group-caption">{a.caption}</div>}
              </div>
            )}
            {a.type === 'plot_function' && (
              <div>
                <PlotView plot={a.plot} w={t.layout.w - 22} h={t.layout.w - 22} />
                <PlotLegend plot={a.plot} />
              </div>
            )}
          </div>
        )
      })}
    </>
  )
}
