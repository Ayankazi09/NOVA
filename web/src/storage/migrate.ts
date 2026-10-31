import type { NotebookDoc, Page } from '../notebook/types'
import { SCHEMA_VERSION } from '../notebook/types'

/** Upgrade older document shapes in memory. v1 is the first schema; fill defaults defensively. */
export function migrateDoc(raw: NotebookDoc): NotebookDoc {
  if (raw.schemaVersion > SCHEMA_VERSION) throw new Error(`Unsupported schema version ${raw.schemaVersion}`)
  const pages: Record<string, Page> = {}
  for (const [id, p] of Object.entries(raw.pages)) {
    pages[id] = {
      ...p,
      paper: p.paper ?? 'squared',
      // imported sheets keep their original size even as the grid around them grows
      bg: p.bg ?? (p.backgroundAssetId ? { w: p.width, h: p.height } : undefined),
      selectionRevision: p.selectionRevision ?? 0,
      readings: p.readings ?? {},
      tutorObjects: p.tutorObjects ?? [],
      attempts: p.attempts ?? [],
      history: p.history ?? [],
      regions: p.regions ?? [],
      strokes: p.strokes ?? [],
    }
  }
  return { ...raw, schemaVersion: SCHEMA_VERSION, notebook: { ...raw.notebook, schemaVersion: SCHEMA_VERSION }, pages }
}
