// Tester accounts: a name and an ID, registered in Supabase (insert-only table), kept on this device.

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://tklixqklzhhpgsatpimd.supabase.co'
// the publishable key is meant for browsers; the table only allows inserting a new tester
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_KEY || 'sb_publishable_mmjomaLWlkV_tu8PLzXoUg_-TCfckRR'
const KEY = 'nova.tester'

export interface Tester {
  id: string
  name: string
}

export function currentTester(): Tester | null {
  try {
    const t = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Tester | null
    return t && t.id && t.name ? t : null
  } catch {
    return null
  }
}

export function signOutTester() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}

export async function registerTester(name: string): Promise<Tester> {
  const t: Tester = { id: crypto.randomUUID(), name: name.trim().slice(0, 60) }
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/testers`, {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ id: t.id, name: t.name, user_agent: navigator.userAgent.slice(0, 300) }),
    })
    if (!res.ok) console.warn('tester registration failed', res.status)
  } catch (e) {
    console.warn('tester registration failed', e) // never block testing on the sign-up record
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(t))
  } catch {
    /* private mode: works for this visit */
  }
  return t
}
