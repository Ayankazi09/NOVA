import { useEffect, useState } from 'react'
import { api, type Capabilities } from '../tutor/api'
import { Icon } from './icons'

export interface AppSettings {
  autoAnswer: boolean
  assist: boolean
  assistConsent: boolean
  speechOutput: boolean
  stylusOnly: boolean
}

export const DEFAULT_SETTINGS: AppSettings = { autoAnswer: true, assist: false, assistConsent: false, speechOutput: false, stylusOnly: false }

function Status({ v }: { v: boolean | null | undefined }) {
  if (v === true) return <span className="status ok">Yes</span>
  if (v === false) return <span className="status bad">No</span>
  return <span className="status none">Not run</span>
}

interface Props {
  settings: AppSettings
  onChange: (s: AppSettings) => void
  onClose: () => void
  onRequestAssist: () => void
  onExport: () => void
  onTeachHandwriting: () => void
}

export function SettingsDialog({ settings, onChange, onClose, onRequestAssist, onExport, onTeachHandwriting }: Props) {
  const [caps, setCaps] = useState<Capabilities | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [testing, setTesting] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)

  const load = () => api.capabilities().then((c) => { setCaps(c); setErr(null) }).catch((e) => setErr((e as Error).message))
  useEffect(() => void load(), [])

  const test = async (vision: boolean) => {
    setTesting(vision ? 'vision' : 'models')
    setResult(null)
    try {
      const r = await api.testConnection(vision)
      const v = r.vision as { passed?: boolean; reading?: string; latencyMs?: number; error?: { message: string } } | undefined
      if (vision && v) setResult(v.error ? `Vision test failed: ${v.error.message}` : `Vision ${v.passed ? 'passed' : 'did not match'}: read “${v.reading}” in ${v.latencyMs} ms (synthetic typed image, not handwriting evidence).`)
      else setResult(r.ok ? 'Models reachable.' : `Failed: ${(r.error as { message?: string })?.message ?? 'unknown error'}`)
    } catch (e) {
      setResult((e as Error).message)
    } finally {
      setTesting(null)
      load()
    }
  }

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog" role="dialog" aria-label="Settings" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-head">
          <h2>Settings</h2>
          <button className="icon-btn" aria-label="Close" onClick={onClose}><Icon.close /></button>
        </div>

        <section>
          <h3>Assist</h3>
          <label className="row">
            <input type="checkbox" checked={settings.assist} onChange={(e) => (e.target.checked && !settings.assistConsent ? onRequestAssist() : onChange({ ...settings, assist: e.target.checked }))} />
            <span>Read my writing automatically after a pause <span className="muted">(sends the line's image to BharatCode)</span></span>
          </label>
          <label className="row">
            <input type="checkbox" checked={settings.autoAnswer} onChange={(e) => onChange({ ...settings, autoAnswer: e.target.checked })} />
            <span>Auto-answer: NOVA writes the answer after "=" in handwriting <span className="muted">(off: NOVA only marks ✓ / ✗)</span></span>
          </label>
          <label className="row">
            <input type="checkbox" checked={settings.speechOutput} onChange={(e) => onChange({ ...settings, speechOutput: e.target.checked })} />
            <span>Always speak NOVA's replies <span className="muted">(questions you ask by voice are always answered aloud; text is always shown)</span></span>
          </label>
          <label className="row">
            <input type="checkbox" checked={settings.stylusOnly} onChange={(e) => onChange({ ...settings, stylusOnly: e.target.checked })} />
            <span>Stylus-only drawing <span className="muted">(fingers pan and zoom; not hardware palm rejection)</span></span>
          </label>
        </section>

        <section>
          <h3>Handwriting</h3>
          <p className="muted">NOVA writes its answers in handwriting. Teach it yours and its answers will look like you wrote them (always in NOVA's blue, so you can tell them apart).</p>
          <button className="btn" onClick={onTeachHandwriting}>Teach NOVA your handwriting…</button>
        </section>

        <section>
          <h3>Connection</h3>
          {err && <p className="error-text">Server not reachable: {err}</p>}
          {caps && (
            <table className="caps">
              <tbody>
                <tr><td>Provider / model</td><td>{caps.provider.name} · {caps.provider.model}</td></tr>
                <tr><td>Key configured on server</td><td><Status v={caps.provider.keyConfigured} /></td></tr>
                <tr><td>Models reachable</td><td><Status v={caps.provider.modelsReachable} /></td></tr>
                <tr><td>Vision smoke-tested</td><td><Status v={caps.provider.visionSmokeTested} /></td></tr>
                <tr><td>Speech engine</td><td>{caps.speech.installed ? `faster-whisper (${caps.speech.model})${caps.speech.lastError ? ' · ' + caps.speech.lastError : ''}` : <span className="status none">Not installed</span>}</td></tr>
                <tr><td>Maths scopes</td><td>{caps.mathScopes.join(', ')}</td></tr>
                {caps.provider.lastError && <tr><td>Last error</td><td className="error-text">{caps.provider.lastError}</td></tr>}
              </tbody>
            </table>
          )}
          {caps && !caps.provider.keyConfigured && <p className="muted">Add <code>BHARATCODE_API_KEY=…</code> to <code>server/.env</code> and restart the server. The key never reaches the browser.</p>}
          <div className="row gap">
            <button className="btn" disabled={!!testing} onClick={() => test(false)}>{testing === 'models' ? 'Testing…' : 'Test connection'}</button>
            <button className="btn" disabled={!!testing} onClick={() => test(true)}>{testing === 'vision' ? 'Testing…' : 'Test vision'}</button>
          </div>
          {result && <p className="muted">{result}</p>}
        </section>

        <section>
          <h3>Data</h3>
          <p className="muted">Notebooks live in this browser only. Export a backup to keep a copy.</p>
          <button className="btn" onClick={onExport}>Export notebook backup (.nova.json)</button>
        </section>
      </div>
    </div>
  )
}

export function AssistConsent({ onAccept, onCancel }: { onAccept: () => void; onCancel: () => void }) {
  return (
    <div className="dialog-backdrop" onClick={onCancel}>
      <div className="dialog narrow" role="dialog" aria-label="Turn on Assist" onClick={(e) => e.stopPropagation()}>
        <h2>Turn on Assist?</h2>
        <p>With Assist on, about a second after you stop writing NOVA sends a picture of <strong>just that line of ink</strong> to the BharatCode model so it can read it. Only the line is sent, not the whole page, grid or NOVA's notes.</p>
        <p className="muted">Requests use store:false, but that does not guarantee zero retention by the provider. With Assist off, writing stays on this device and NOVA only reads when you tap Read or Ask.</p>
        <div className="row gap end">
          <button className="btn" onClick={onCancel}>Not now</button>
          <button className="btn primary" onClick={onAccept}>Turn on Assist</button>
        </div>
      </div>
    </div>
  )
}
