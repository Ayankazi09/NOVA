import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import 'katex/dist/katex.min.css'
import './index.css'
import './theme-classic.css'
import './features.css'
import './theme-dark.css'
import App from './App.tsx'
import { currentTester, type Tester } from './account/tester'
import { setAccountStore } from './storage/db'
import { Welcome } from './ui/Welcome'
import { initTheme } from './ui/theme'

initTheme()

function Root() {
  const [tester, setTester] = useState<Tester | null>(() => {
    const t = currentTester()
    if (t) setAccountStore(t.id)
    return t
  })
  if (!tester)
    return (
      <Welcome
        onDone={(t) => {
          setAccountStore(t.id)
          setTester(t)
        }}
      />
    )
  return <App key={tester.id} tester={tester} />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
