// The student's own glyph samples ("Teach NOVA your handwriting"), stored on this device only.

import { getMeta, setMeta } from '../storage/db'
import type { GlyphLibrary } from './compose'

const KEY = 'handwriting-v1'
let cache: GlyphLibrary = {}

export async function loadLibrary(): Promise<GlyphLibrary> {
  try {
    cache = (await getMeta<GlyphLibrary>(KEY)) ?? {}
  } catch {
    cache = {}
  }
  return cache
}

export function getLibrary(): GlyphLibrary {
  return cache
}

export async function saveLibrary(lib: GlyphLibrary): Promise<void> {
  cache = lib
  await setMeta(KEY, lib)
}

export async function clearLibrary(): Promise<void> {
  await saveLibrary({})
}
