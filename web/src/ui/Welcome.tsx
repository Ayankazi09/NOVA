import { useState } from 'react'
import { registerTester, type Tester } from '../account/tester'

export function Welcome({ onDone }: { onDone: (t: Tester) => void }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || busy) return
    setBusy(true)
    onDone(await registerTester(name))
  }
  return (
    <div className="welcome">
      <form className="welcome-card" onSubmit={submit}>
        <img className="welcome-logo" src="/nova-logo.png" alt="NOVA" />
        <h1>Thank you for being a tester!</h1>
        <input id="tester-name" aria-label="Your name" autoFocus autoComplete="name" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} placeholder="Enter your name" />
        <button className="btn primary big" type="submit" disabled={!name.trim() || busy}>{busy ? 'Setting up…' : 'Start writing'}</button>
      </form>
    </div>
  )
}
