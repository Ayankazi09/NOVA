// Device speech synthesis for tutor replies. Visible text always accompanies speech.

let currentKey: string | null = null

export function speechOutputSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

export function speak(text: string, key: string, onEnd?: () => void) {
  if (!speechOutputSupported()) return
  stopSpeaking()
  const u = new SpeechSynthesisUtterance(text)
  u.lang = 'en-IN'
  u.rate = 1
  const voices = window.speechSynthesis.getVoices()
  const v = voices.find((x) => x.lang === 'en-IN') ?? voices.find((x) => x.lang.startsWith('en'))
  if (v) u.voice = v
  currentKey = key
  u.onend = () => {
    if (currentKey === key) currentKey = null
    onEnd?.()
  }
  window.speechSynthesis.speak(u)
}

export function stopSpeaking() {
  currentKey = null
  if (speechOutputSupported()) window.speechSynthesis.cancel()
}

export function speakingKey() {
  return currentKey
}
