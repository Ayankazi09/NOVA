import { compose } from '../src/handwriting/compose'
const lines = [
  '0123456789', '+ - × ÷ = < > ( ) / . % ! °', 'abcdefghijklm', 'nopqrstuvwxyz', 'θ π α β ∞ √ ∫',
  '5', '1/2', '√3/2', 'sin 2θ', 'a² + 2ab + b²', '(x - 2)(x - 3)', 'θ = 30° or θ = 150°', 'x² + C', '-3x/2 + 3', '√2/2', 'x > 2', 'sin²θ + cos²θ = 1',
]
const W = 1300
let y = 30
let svg = ''
lines.forEach((t, i) => {
  const c = compose(t, { height: 56, slant: i % 2 ? 0.14 : 0.04, width: 3.6, seed: 11 + i }, undefined)
  const dy = y - c.top
  for (const s of c.strokes) svg += `<polyline fill="none" stroke="#2b59c3" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round" points="${s.map(([a, b]) => `${(a + 40).toFixed(1)},${(b + dy).toFixed(1)}`).join(' ')}"/>`
  svg += `<text x="${W - 20}" y="${dy + 40}" text-anchor="end" font-size="14" fill="#999">${t}</text>`
  y += c.bottom - c.top + 34
})
document.getElementById('root')!.innerHTML = `<svg width="${W}" height="${y}" xmlns="http://www.w3.org/2000/svg">${svg}</svg>`
