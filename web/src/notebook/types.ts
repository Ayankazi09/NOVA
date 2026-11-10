// Document model. All coordinates are page units; zoom/device pixels are presentation only.

export const SCHEMA_VERSION = 1

export interface Point {
  x: number
  y: number
  pressure?: number
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface Stroke {
  id: string
  points: Point[]
  colour: string
  width: number
  createdAt: number
  author: 'student'
}

export type ReadingState = 'readback_ready' | 'needs_clarification' | 'accepted'

export interface CheckResult {
  status: 'equivalent' | 'different' | 'solved' | 'unsupported' | 'needs_clarification'
  message: string
  problemSolution?: string | null
  currentSolution?: string | null
  againstProblemId: string
  problemText: string
}

export interface Reading {
  rawText: string
  alternatives: string[]
  needsClarification: boolean
  status: 'expression' | 'incomplete' | 'none' | 'ambiguous'
  acceptedText?: string
  state: ReadingState
  sourceHash: string
  interpretationRevision: number
  model?: string
  latencyMs?: number
  check?: CheckResult
}

export interface Region {
  id: string
  bounds: Rect
  sourceStrokeIds: string[]
  sourceHash: string
  origin: 'auto' | 'explicit'
  createdAt: number
}

export type TutorAction =
  | { id: string; type: 'highlight_region'; anchorRegionId: string; reason: string; subtle?: boolean }
  | { id: string; type: 'add_note'; anchorRegionId: string; text: string }
  | { id: string; type: 'write_equation'; anchorRegionId: string; expression: string; purpose: 'hint' | 'completion'; verified: boolean }
  | { id: string; type: 'draw_groups'; anchorRegionId: string; groups: string[]; caption: string }
  | { id: string; type: 'plot_function'; anchorRegionId: string; plot: PlotData }
  | { id: string; type: 'speak'; anchorRegionId: string; text: string }
  | { id: string; type: 'write_lines'; anchorRegionId: string; title: string; lines: string[]; inks?: ('blue' | 'red' | 'black')[]; verified: boolean[]; corrected: number }
  | { id: string; type: 'write_table'; anchorRegionId: string; title: string; header: string[]; rows: string[][]; verifiedCells: number; corrected: number; unverifiedCells: number }
  // a geometry figure, to scale: named points in maths coordinates (y up), the lines / circles between them, and labels
  | {
      id: string; type: 'draw_figure'; anchorRegionId: string; title: string
      points: Record<string, [number, number]>
      segments: [string, string][]
      dashed?: [string, string][]
      circles?: { center: string; radius: number; label?: string }[]
      sideLabels?: { between: [string, string]; text: string }[]
      angleLabels?: { at: string; text: string }[]
      rightAngles?: string[]
      notes?: string[]
    }
  // client-side: NOVA's answer drawn as handwriting (page-unit polylines), always in NOVA ink
  | { id: string; type: 'write_ink'; anchorRegionId: string; text: string; strokes: [number, number][][]; width: number; purpose: 'answer' | 'completion' | 'mark' | 'content'; verified: boolean; tone: 'nova' | 'correct' | 'wrong'; colors?: string[] }

export interface PlotPoint {
  x: number
  y: number
  label?: string
  kind?: 'root' | 'intercept' | 'solution' | 'check'
}

export interface PlotData {
  expression: string
  normalized: string
  kind?: 'function' | 'equation' | 'implicit'
  xMin: number
  xMax: number
  yMin: number
  yMax: number
  series?: { label: string; segments: { x: number; y: number }[][] }[]
  points?: PlotPoint[]
  note?: string
  // v1 (linear only) fields, still present on older notebooks
  slope?: string
  intercept?: string
  segments?: { x: number; y: number }[][]
  checkPoints?: { x: number; y: number }[]
}

export interface TutorObject {
  id: string // action id (requestId:index) - provenance, prevents duplicate insertion
  requestId: string
  batchId: string
  anchorRegionId: string
  sourceHash: string
  createdAt: number
  author: 'tutor'
  status: 'active' | 'stale' | 'dismissed'
  action: TutorAction
  layout: Rect & { leader: boolean }
  caption?: string
}

export interface Turn {
  role: 'student' | 'tutor'
  text: string
  at: number
  problemId?: string
}

export interface Attempt {
  attemptId: string
  problemId: string
  problemText: string
  assistanceUsed: boolean
  startedAt: number
  steps: { regionId: string; text: string; status: string; at: number }[]
}

export type Paper = 'squared' | 'ruled' | 'blank'

/** A text line from an imported PDF's text layer, in page units. */
export interface DocLine {
  id: string
  text: string
  x: number
  y: number
  w: number
  h: number
}

export interface PaperQuestion {
  id: string
  number: string
  pageId: string
  text: string
  bounds: Rect
  kind: string
  options: string[]
  answer: string // the key: hidden from the student until the test is finished
  answerVerified: boolean
  corrected: boolean
  helpCount: number
  verdict?: 'correct' | 'incorrect' | 'unanswered'
  studentText?: string
}

export interface PaperTest {
  id: string
  title: string
  kind?: 'paper' | 'practice' // practice: a worksheet NOVA wrote (older tests are papers)
  topic?: string // practice: the skill being practised
  source?: string // practice: the line it was made from ("5 more like this")
  status: 'reading' | 'ready' | 'grading' | 'finished' | 'failed'
  pageIds: string[]
  questions: PaperQuestion[]
  progress: { done: number; total: number }
  failedPages?: number[] // page indexes that could not be read yet
  error?: string
  createdAt: number
  finishedAt?: number
  score?: { correct: number; total: number }
}

export interface Page {
  id: string
  notebookId: string
  title: string
  width: number
  height: number
  paper: Paper
  contentRevision: number
  selectionRevision: number
  backgroundAssetId?: string
  bg?: { w: number; h: number } // size of the imported sheet; the grid continues around it
  docText?: DocLine[]
  strokes: Stroke[]
  regions: Region[]
  readings: Record<string, Reading>
  problemRegionId?: string
  tutorObjects: TutorObject[]
  attempts: Attempt[]
  history: Turn[]
}

export interface Notebook {
  id: string
  title: string
  schemaVersion: number
  createdAt: number
  updatedAt: number
  orderedPageIds: string[]
  lastPageId?: string
}

export interface NotebookDoc {
  schemaVersion: number
  notebook: Notebook
  pages: Record<string, Page>
  tests?: Record<string, PaperTest>
}

export interface Asset {
  id: string
  mime: string
  bytes: ArrayBuffer
  width: number
  height: number
  checksum: string
}

export interface NotebookSummary {
  id: string
  title: string
  updatedAt: number
  pageCount: number
}

export type Tool = 'pen' | 'eraser' | 'select' | 'pan'
