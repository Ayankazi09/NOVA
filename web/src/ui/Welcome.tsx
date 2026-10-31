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
        <p>NOVA reads your handwriting and helps with maths right on the page. Enter your name to get your own fresh notebook.</p>
        <label htmlFor="tester-name">Your name</label>
        <input id="tester-name" autoFocus autoComplete="name" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Priya Sharma" />
        <button className="btn primary big" type="submit" disabled={!name.trim() || busy}>{busy ? 'Setting up…' : 'Start writing'}</button>
        <small>Your notebooks are saved on this device. Write <b>3x + 7 = 13</b> and pause — NOVA answers.</small>
      </form>
    </div>
  )
}
