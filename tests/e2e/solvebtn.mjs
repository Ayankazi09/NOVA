// Assist on but auto-answer OFF, so NOVA only offers "Solve"; tapping it must write the explained solution.
export default async function run(page) {
  const { drawText } = await import('./glyphs.mjs')
  await page.setViewportSize({ width: 1400, height: 900 })
  await page.waitForSelector('[data-testid=workspace]', { timeout: 20000 })
  await page.evaluate(() => { try { const k = Object.keys(localStorage).find((x) => /settings/i.test(x)); if (k) { const v = JSON.parse(localStorage.getItem(k)); v.autoAnswer = false; localStorage.setItem(k, JSON.stringify(v)) } } catch {} })
  await page.locator('.assist-toggle').click()
  const c = page.getByRole('button', { name: 'Turn on Assist', exact: true })
  if (await c.count()) await c.click()
  const ws = await page.locator('[data-testid=workspace]').boundingBox()
  await drawText(page, '3x + 10 = 1001', ws.x + 120, ws.y + 110, 50, 3)
  const solve = page.locator('.rb-action', { hasText: 'Solve' })
  await solve.first().waitFor({ timeout: 60000 }).catch(() => {})
  const auto = await page.evaluate(() => document.querySelectorAll('.nova-ink').length)
  if (await solve.count()) await solve.first().click()
  await page.waitForFunction(() => document.querySelectorAll('.nova-ink').length > 0, null, { timeout: 60000 }).catch(() => {})
  await page.waitForTimeout(2500)
  await page.screenshot({ path: './e2e-solvebtn.png' })
  return { inkBeforeSolve: auto, hadSolve: await solve.count() }
}
