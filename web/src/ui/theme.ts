// Light / dark appearance. The choice is a per-device convenience (localStorage); "system" follows the OS.
// The effective theme is written to <html data-theme>, which the CSS tokens key off.

export type ThemePref = 'system' | 'light' | 'dark'

const KEY = 'nova.theme'
const listeners = new Set<() => void>()

export function getThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch {
    return 'system'
  }
}

function systemDark(): boolean {
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches
}

export function effectiveTheme(pref = getThemePref()): 'light' | 'dark' {
  return pref === 'system' ? (systemDark() ? 'dark' : 'light') : pref
}

export function applyTheme() {
  const t = effectiveTheme()
  document.documentElement.dataset.theme = t
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t === 'dark' ? '#15181d' : '#ffffff')
  listeners.forEach((fn) => fn())
}

export function setThemePref(pref: ThemePref) {
  try {
    if (pref === 'system') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, pref)
  } catch {
    /* private mode: the choice lasts for this visit */
  }
  applyTheme()
}

/** Apply now and follow OS changes while the preference is "system". */
export function initTheme() {
  applyTheme()
  try {
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => getThemePref() === 'system' && applyTheme())
  } catch {
    /* old browsers: no live updates */
  }
}

export function onThemeChange(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
