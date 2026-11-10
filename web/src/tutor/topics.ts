// Topics and progress, worked out from what is already on the student's pages (nothing extra is stored):
// - classify a line of maths into a school topic (algebra, trigonometry, calculus, ...)
// - per-topic accuracy from NOVA's ✓ / ✗ marks and marked tests, so weak topics can be practised
// - a daily streak and today's accuracy

import { readingText } from '../notebook/doc'
import type { NotebookDoc, Page } from '../notebook/types'

export type Topic =
  | 'Calculus'
  | 'Matrices & vectors'
  | 'Trigonometry'
  | 'Logarithms'
  | 'Sequences & series'
  | 'Probability & statistics'
  | 'Sets'
  | 'Geometry'
  | 'Quadratics'
  | 'Linear equations'
  | 'Algebra'
  | 'Fractions & decimals'
  | 'Arithmetic'

// first match wins: the more specific topics come first
const RULES: [Topic, RegExp][] = [
  ['Calculus', /d\/dx|dy\/dx|∫|\blim\b|f[′']\(|\bderivative|\bdifferentiat|\bintegra/i],
  ['Matrices & vectors', /\[[^\]]*;[^\]]*\]|\bdet\b|\bmatri|\bvector|\b\d*\s*[ij]\s*[+-]\s*\d*\s*[jk]\b|\|[a-z]\|/i],
  ['Trigonometry', /\b(sin|cos|tan|sec|cosec|csc|cot)\b|θ|\btrig/i],
  ['Logarithms', /\blog|\bln\b/i],
  ['Sequences & series', /\.\.\.|…|\bAP\b|\bGP\b|\bnth term|\bS_?\d+\b|\bS[₀-₉]+|\bseries\b|\bsequence\b|\bprogression/i],
  ['Probability & statistics', /\bP\(|\bprobab|\bmean\b|\bmedian\b|\bmode\b|\bvariance|\bstandard deviation|\bdice\b|\bcoin\b|\bnCr\b|\bC\(\d/i],
  ['Sets', /[∪∩∈∉⊂⊆∅]|\bunion\b|\bintersection\b|\bsubset/i],
  ['Geometry', /°(?!\s*[CF]\b)|∠|△|\btriangle|\bcircle|\bradius|\bdiameter|\barea\b|\bperimeter|\bvolume|\bpythag|\bhypotenuse|\bcm\b|\bangle\b|π/i],
  ['Quadratics', /[a-z]\s*(\^\s*2|²)|\bquadratic|\broots?\b/i],
  ['Linear equations', /[a-z].*=|=.*[a-z]/i],
  ['Algebra', /[a-z]/i],
  ['Fractions & decimals', /\d\s*\/\s*\d|\d\.\d|%/],
  ['Arithmetic', /\d\s*[-+*×÷/]\s*\d|\d\s*=/],
]

export function classify(text: string | undefined | null): Topic | null {
  const t = (text ?? '').trim()
  if (!t || !/[0-9a-zθπ∫]/i.test(t)) return null
  // "find", "solve" and other words would otherwise look like algebra
  const maths = t.replace(/\b(find|solve|simplify|evaluate|calculate|work out|show that|prove|hence|the|value|of|what|is|and|for|if|then|given|write)\b/gi, ' ')
  for (const [topic, re] of RULES) {
    if (re.test(maths) || (topic !== 'Algebra' && topic !== 'Linear equations' && re.test(t))) return topic
  }
  return null
}

export interface TopicScore {
  topic: Topic
  right: number
  wrong: number
  seen: number // lines / questions about this topic
}

export interface Progress {
  topics: TopicScore[] // weakest first (only topics with marks), then most practised
  streak: number // consecutive days with writing, ending today (or yesterday, if today has nothing yet)
  today: { right: number; wrong: number; lines: number; minutes: number } // minutes: distinct minutes with writing
  lastTopic: Topic | null // the topic most recently written or practised
}

const dayKey = (t: number) => {
  const d = new Date(t)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

function regionTopic(page: Page, regionId: string): Topic | null {
  return classify(readingText(page.readings[regionId]))
}

/** Topics a notebook is about, most written first. */
export function notebookTopics(doc: NotebookDoc | undefined, n = 2): Topic[] {
  if (!doc) return []
  const count = new Map<Topic, number>()
  const add = (t: Topic | null) => t && count.set(t, (count.get(t) ?? 0) + 1)
  for (const p of Object.values(doc.pages)) for (const r of p.regions) add(regionTopic(p, r.id))
  for (const test of Object.values(doc.tests ?? {})) for (const q of test.questions) add(test.topic ? asTopic(test.topic) ?? classify(q.text) : classify(q.text))
  return [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([t]) => t)
}

/** A topic name from the practice API ("Linear equations") mapped onto ours, if it is one of them. */
export function asTopic(name: string | undefined): Topic | null {
  if (!name) return null
  const exact = RULES.find(([t]) => t.toLowerCase() === name.toLowerCase())
  return exact ? exact[0] : classify(name)
}

export function progress(docs: NotebookDoc[], now = Date.now()): Progress {
  const scores = new Map<Topic, TopicScore>()
  const score = (t: Topic) => {
    let s = scores.get(t)
    if (!s) scores.set(t, (s = { topic: t, right: 0, wrong: 0, seen: 0 }))
    return s
  }
  const today = dayKey(now)
  const days = new Set<string>()
  const todayStats = { right: 0, wrong: 0, lines: 0, minutes: 0 }
  const activeMinutes = new Set<number>()
  let last: { topic: Topic; at: number } | null = null
  const seenAt = (topic: Topic | null, at: number) => {
    if (topic && (!last || at >= last.at)) last = { topic, at }
  }

  for (const doc of docs) {
    for (const p of Object.values(doc.pages)) {
      for (const st of p.strokes) {
        days.add(dayKey(st.createdAt))
        if (dayKey(st.createdAt) === today) activeMinutes.add(Math.floor(st.createdAt / 60_000))
      }
      for (const r of p.regions) {
        const t = regionTopic(p, r.id)
        if (t) score(t).seen++
        seenAt(t, r.createdAt)
        if (dayKey(r.createdAt) === today) todayStats.lines++
      }
      for (const o of p.tutorObjects) {
        const a = o.action
        // NOVA's ✓ / ✗ beside a line. Test marks ("mark:...") are counted from the test's questions below.
        if (o.status === 'dismissed' || a.type !== 'write_ink' || a.purpose !== 'mark' || o.id.startsWith('mark:') || o.id.startsWith('score:')) continue
        if (a.tone !== 'correct' && a.tone !== 'wrong') continue
        const t = regionTopic(p, o.anchorRegionId)
        if (t) score(t)[a.tone === 'correct' ? 'right' : 'wrong']++
        if (dayKey(o.createdAt) === today) todayStats[a.tone === 'correct' ? 'right' : 'wrong']++
      }
    }
    for (const test of Object.values(doc.tests ?? {})) {
      if (test.kind === 'practice') seenAt(asTopic(test.topic), test.finishedAt ?? test.createdAt)
      if (test.status !== 'finished') continue
      const marked = test.finishedAt && dayKey(test.finishedAt) === today
      for (const q of test.questions) {
        if (q.verdict !== 'correct' && q.verdict !== 'incorrect') continue
        const t = asTopic(test.topic) ?? classify(q.text)
        const key = q.verdict === 'correct' ? 'right' : 'wrong'
        if (t) {
          score(t)[key]++
          score(t).seen++
        }
        if (marked) todayStats[key]++
      }
    }
  }

  let streak = 0
  const d = new Date(now)
  if (!days.has(dayKey(d.getTime()))) d.setDate(d.getDate() - 1) // today not started yet: the streak is still alive
  while (days.has(dayKey(d.getTime()))) {
    streak++
    d.setDate(d.getDate() - 1)
  }

  const acc = (s: TopicScore) => (s.right + s.wrong ? s.right / (s.right + s.wrong) : 2)
  const topics = [...scores.values()].filter((s) => s.seen > 0 || s.right + s.wrong > 0).sort((a, b) => acc(a) - acc(b) || b.seen - a.seen)
  todayStats.minutes = activeMinutes.size
  return { topics, streak, today: todayStats, lastTopic: (last as { topic: Topic } | null)?.topic ?? null }
}

/** Below 60% with at least two marks: worth practising. */
export function isWeak(s: TopicScore): boolean {
  const n = s.right + s.wrong
  return n >= 2 && s.right / n < 0.6
}

/** Topics offered for practice when the student has no weak ones yet. */
export const PRACTICE_TOPICS: Topic[] = ['Linear equations', 'Quadratics', 'Fractions & decimals', 'Trigonometry', 'Geometry', 'Algebra', 'Calculus', 'Probability & statistics']
