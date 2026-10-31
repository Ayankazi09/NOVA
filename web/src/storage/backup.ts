// Versioned .nova.json backup containing the notebook document and its assets.

import { hashString } from '../notebook/geometry'
import { shortId } from '../notebook/ids'
import type { Asset, NotebookDoc, Page } from '../notebook/types'
import { SCHEMA_VERSION } from '../notebook/types'
import { getAsset } from './db'
import { migrateDoc } from './migrate'

export const BACKUP_FORMAT = 'nova-backup'
export const MAX_BACKUP_BYTES = 25 * 1024 * 1024

interface BackupAsset {
  id: string
  mime: string
  width: number
  height: number
  checksum: string
  data: string // base64
}

export interface Backup {
  format: typeof BACKUP_FORMAT
  schemaVersion: number
  exportedAt: string
  doc: NotebookDoc
  assets: BackupAsset[]
}

function toB64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

function fromB64(b64: string): ArrayBuffer {
  const s = atob(b64)
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out.buffer
}

export function checksumBytes(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  // hash a strided sample + length; cheap and stable for change detection
  let s = String(bytes.length) + ':'
  const step = Math.max(1, Math.floor(bytes.length / 4096))
  for (let i = 0; i < bytes.length; i += step) s += String.fromCharCode(bytes[i])
  return hashString(s)
}

export async function buildBackup(doc: NotebookDoc): Promise<Backup> {
  const assets: BackupAsset[] = []
  for (const p of Object.values(doc.pages)) {
    if (!p.backgroundAssetId) continue
    const a = await getAsset(p.backgroundAssetId)
    if (a) assets.push({ id: a.id, mime: a.mime, width: a.width, height: a.height, checksum: a.checksum, data: toB64(a.bytes) })
  }
  return { format: BACKUP_FORMAT, schemaVersion: SCHEMA_VERSION, exportedAt: new Date().toISOString(), doc, assets }
}

export class BackupError extends Error {}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function validPage(p: unknown): p is Page {
  if (!isObj(p)) return false
  if (typeof p.id !== 'string' || typeof p.width !== 'number' || typeof p.height !== 'number') return false
  if (!Array.isArray(p.strokes)) return false
  for (const s of p.strokes as unknown[]) {
    if (!isObj(s) || typeof s.id !== 'string' || !Array.isArray(s.points)) return false
    for (const pt of s.points as unknown[]) if (!isObj(pt) || !Number.isFinite(pt.x) || !Number.isFinite(pt.y)) return false
  }
  return true
}

/** Validate fully before anything is written. Returns a copy with fresh ids so it never overwrites. */
export function parseBackup(text: string, byteLength: number): { doc: NotebookDoc; assets: Asset[] } {
  if (byteLength > MAX_BACKUP_BYTES) throw new BackupError('Backup is larger than 25 MB.')
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new BackupError('This file is not a NOVA backup (invalid JSON).')
  }
  if (!isObj(data) || data.format !== BACKUP_FORMAT) throw new BackupError('This file is not a NOVA backup.')
  if (typeof data.schemaVersion !== 'number' || data.schemaVersion > SCHEMA_VERSION) throw new BackupError('This backup was made by a newer NOVA version.')
  const doc = data.doc as NotebookDoc
  if (!isObj(doc) || !isObj(doc.notebook) || !isObj(doc.pages) || !Array.isArray(doc.notebook.orderedPageIds)) throw new BackupError('Backup structure is invalid.')
  for (const id of doc.notebook.orderedPageIds) if (!validPage(doc.pages[id])) throw new BackupError('A page in the backup is invalid.')
  const assetsIn = Array.isArray(data.assets) ? (data.assets as BackupAsset[]) : []
  const assetIdMap = new Map<string, string>()
  const assets: Asset[] = []
  for (const a of assetsIn) {
    if (!isObj(a) || typeof a.data !== 'string' || typeof a.mime !== 'string' || !/^image\/(png|jpeg|webp)$/.test(a.mime)) throw new BackupError('An image in the backup is invalid.')
    const bytes = fromB64(a.data)
    const id = shortId('as')
    assetIdMap.set(a.id, id)
    assets.push({ id, mime: a.mime, bytes, width: a.width, height: a.height, checksum: checksumBytes(bytes) })
  }
  const migrated = migrateDoc(doc)
  const nbId = shortId('nb')
  const pageIdMap = new Map<string, string>()
  const pages: Record<string, Page> = {}
  for (const oldId of migrated.notebook.orderedPageIds) {
    const p = migrated.pages[oldId]
    const id = shortId('pg')
    pageIdMap.set(oldId, id)
    pages[id] = { ...p, id, notebookId: nbId, backgroundAssetId: p.backgroundAssetId ? assetIdMap.get(p.backgroundAssetId) : undefined }
  }
  const order = migrated.notebook.orderedPageIds.map((id) => pageIdMap.get(id)!)
  const tests = Object.fromEntries(
    Object.values(migrated.tests ?? {}).map((t) => [
      t.id,
      {
        ...t,
        pageIds: t.pageIds.map((id) => pageIdMap.get(id)).filter((id): id is string => !!id),
        questions: t.questions.filter((q) => pageIdMap.has(q.pageId)).map((q) => ({ ...q, pageId: pageIdMap.get(q.pageId)! })),
      },
    ]),
  )
  return {
    doc: {
      schemaVersion: SCHEMA_VERSION,
      notebook: { ...migrated.notebook, id: nbId, title: `${migrated.notebook.title} (restored)`, orderedPageIds: order, lastPageId: order[0], updatedAt: Date.now() },
      pages,
      tests,
    },
    assets,
  }
}

export function downloadJson(name: string, value: unknown) {
  const blob = new Blob([JSON.stringify(value)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}
