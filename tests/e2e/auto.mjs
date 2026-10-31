// Auto-answer journey: Assist on, write lines, NOVA reacts by itself in handwriting (no clicks).
export default async function run(page) {
  const { drawText } = await import('./glyphs.mjs')
  await page.setViewportSize({ width: 1500, height: 1000 })
  await page.waitForSelector('[data-testid=workspace]', { timeout: 20000 })
  await page.getByRole('button', { name: 'Notebooks' }).click()
  await page.getByRole('button', { name: /New notebook/ }).click()
  await page.waitForSelector('[data-testid=workspace]')
  await page.waitForTimeout(500)
  const ws = await page.locator('[data-testid=workspace]').boundingBox()
  await page.getByRole('button', { name: /Assist off/ }).click()
  await page.getByRole('button', { name: 'Turn on Assist' }).click()
  const out = []
  const LINES = ['4 + 2 =', '4 + 2 = 7', 'x + 3 = 4', 'y = 4x']
  let y = ws.y + 90
  for (const [i, text] of LINES.entries()) {
    await drawText(page, text, ws.x + 150, y, 54, 21 + i)
    const t0 = Date.now()
    const before = await page.evaluate(() => document.querySelectorAll('.nova-ink').length)
    await page.waitForFunction((n) => document.querySelectorAll('.nova-ink').length > n, before, { timeout: 45000 }).catch(() => {})
    const inks = await page.evaluate(() => [...document.querySelectorAll('.nova-ink')].map((g) => g.getAttribute('class')))
    const labels = await page.evaluate(() => [...document.querySelectorAll('.readback')].map((e) => e.textContent))
    out.push({ wrote: text, reactedMs: Date.now() - t0, lastInk: inks[inks.length - 1] ?? null, inkCount: inks.length, lastLabel: labels[labels.length - 1] ?? null })
    y += i === 2 ? 300 : 160
  }
  await page.waitForTimeout(800)
  await page.screenshot({ path: './e2e-auto.png' })
  return out
}
