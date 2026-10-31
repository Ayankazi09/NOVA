// Small typed IndexedDB adapter. Each notebook save is one atomic transaction (doc + library index).

import type { Asset, NotebookDoc, NotebookSummary } from '../notebook/types'
import { SCHEMA_VERSION } from '../notebook/types'
import { migrateDoc } from './migrate'

let DB_NAME = 'nova'

/** Each tester has their own notebook store on this device (fresh pages per account). */
export function setAccountStore(accountId: string) {
  DB_NAME = `nova-${accountId}`
  dbPromise = null
}
const DB_VERSION = 1

export class StorageError extends Error {
  readonly kind: 'quota' | 'version' | 'unavailable' | 'unknown'
  constructor(kind: StorageError['kind'], message: string) {
    super(message)
    this.kind = kind
  }
}

let dbPromise: Promise<IDBDatabase> | null = null

function classify(e: unknown): StorageError {
  const name = (e as DOMException | undefined)?.name ?? ''
  if (name === 'QuotaExceededError') return new StorageError('quota', 'Device storage is full. Export a backup or delete old notebooks.')
  if (name === 'VersionError') return new StorageError('version', 'This notebook store was written by a newer NOVA version.')
  return new StorageError('unknown', (e as Error)?.message || 'Storage failed.')
}

export function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new StorageError('unavailable', 'This browser has no local storage for notebooks.'))
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      // v1 schema. Future versions add migrations here, keyed on event.oldVersion.
      if (!db.objectStoreNames.contains('notebooks')) db.createObjectStore('notebooks', { keyPath: 'notebook.id' })
      if (!db.objectStoreNames.contains('index')) db.createObjectStore('index', { keyPath: 'id' })
      if (!db.objectStoreNames.contains('assets')) db.createObjectStore('assets', { keyPath: 'id' })
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta')
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => {
      dbPromise = null
      reject(classify(req.error))
    }
  })
  return dbPromise
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(classify(tx.error))
    tx.onabort = () => reject(classify(tx.error))
  })
}

function get<T>(store: IDBObjectStore, key: IDBValidKey): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const r = store.get(key)
    r.onsuccess = () => resolve(r.result as T | undefined)
    r.onerror = () => reject(classify(r.error))
  })
}

function getAll<T>(store: IDBObjectStore): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const r = store.getAll()
    r.onsuccess = () => resolve(r.result as T[])
    r.onerror = () => reject(classify(r.error))
  })
}

export function summarize(doc: NotebookDoc): NotebookSummary {
  return { id: doc.notebook.id, title: doc.notebook.title, updatedAt: doc.notebook.updatedAt, pageCount: doc.notebook.orderedPageIds.length }
}

export async function saveNotebook(doc: NotebookDoc): Promise<void> {
  const db = await openDb()
  const tx = db.transaction(['notebooks', 'index'], 'readwrite')
  try {
    tx.objectStore('notebooks').put(doc)
    tx.objectStore('index').put(summarize(doc))
  } catch (e) {
    tx.abort()
    throw classify(e)
  }
  await done(tx)
}

export async function loadNotebook(id: string): Promise<NotebookDoc | undefined> {
  const db = await openDb()
  const tx = db.transaction('notebooks', 'readonly')
  const raw = await get<NotebookDoc>(tx.objectStore('notebooks'), id)
  if (!raw) return undefined
  if (raw.schemaVersion > SCHEMA_VERSION) throw new StorageError('version', 'This notebook was saved by a newer NOVA version. It has not been changed.')
  return migrateDoc(raw)
}

export async function listNotebooks(): Promise<NotebookSummary[]> {
  const db = await openDb()
  const tx = db.transaction('index', 'readonly')
  const all = await getAll<NotebookSummary>(tx.objectStore('index'))
  return all.sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function deleteNotebook(id: string): Promise<void> {
  const db = await openDb()
  const doc = await loadNotebook(id)
  const tx = db.transaction(['notebooks', 'index', 'assets'], 'readwrite')
  tx.objectStore('notebooks').delete(id)
  tx.objectStore('index').delete(id)
  for (const p of Object.values(doc?.pages ?? {})) if (p.backgroundAssetId) tx.objectStore('assets').delete(p.backgroundAssetId)
  await done(tx)
}

export async function putAsset(asset: Asset): Promise<void> {
  const db = await openDb()
  const tx = db.transaction('assets', 'readwrite')
  tx.objectStore('assets').put(asset)
  await done(tx)
}

export async function getAsset(id: string): Promise<Asset | undefined> {
  const db = await openDb()
  return get<Asset>(db.transaction('assets', 'readonly').objectStore('assets'), id)
}

/** Import a notebook and its assets in one transaction, so a failure leaves nothing half-written. */
export async function saveImported(doc: NotebookDoc, assets: Asset[]): Promise<void> {
  const db = await openDb()
  const tx = db.transaction(['notebooks', 'index', 'assets'], 'readwrite')
  for (const a of assets) tx.objectStore('assets').put(a)
  tx.objectStore('notebooks').put(doc)
  tx.objectStore('index').put(summarize(doc))
  await done(tx)
}

export async function getMeta<T>(key: string): Promise<T | undefined> {
  const db = await openDb()
  return get<T>(db.transaction('meta', 'readonly').objectStore('meta'), key)
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  const db = await openDb()
  const tx = db.transaction('meta', 'readwrite')
  tx.objectStore('meta').put(value, key)
  await done(tx)
}

export function _resetForTests() {
  dbPromise = null
}
