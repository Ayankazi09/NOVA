export default async function run(page) {
  const { drawText } = await import('./glyphs.mjs')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.waitForSelector('.welcome-card, [data-testid=workspace]', { timeout: 20000 })
  if (await page.locator('.welcome-card').count()) { await page.fill('#tester-name', 'QA Tester'); await page.getByRole('button', { name: 'Start writing' }).click() }
  await page.waitForSelector('[data-testid=workspace]')
  const ws = await page.locator('[data-testid=workspace]').boundingBox()
  await drawText(page, '3x + 3 = 8', ws.x + 80, ws.y + 80, 44, 3)
  await page.waitForFunction(() => document.querySelectorAll('.nova-ink').length > 0, null, { timeout: 90000 }).catch(() => {})
  await page.waitForTimeout(2500)
  const n1 = await page.evaluate(() => document.querySelectorAll('.nova-ink').length)
  await drawText(page, 'x =', ws.x + 700, ws.y + 140, 44, 4)
  await page.waitForFunction((n) => document.querySelectorAll('.nova-ink').length > n, n1, { timeout: 90000 }).catch(() => {})
  await page.waitForTimeout(2500)
  await page.screenshot({ path: './e2e-question.png' })
  return { n1, after: await page.evaluate(() => document.querySelectorAll('.nova-ink').length), marks: await page.evaluate(() => [...document.querySelectorAll('.check-tag')].map((e) => e.textContent)) }
}
