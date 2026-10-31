export default async function run(page) {
  const { drawText } = await import('./glyphs.mjs')
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.waitForSelector('[data-testid=workspace]', { timeout: 20000 })
  const assist = await page.locator('.assist-toggle').first().textContent()
  const ws = await page.locator('[data-testid=workspace]').boundingBox()
  await drawText(page, '3x + 7 = 13', ws.x + 120, ws.y + 110, 50, 3)
  const t0 = Date.now()
  await page.waitForFunction(() => document.querySelectorAll('.nova-ink').length > 0, null, { timeout: 90000 }).catch(() => {})
  return { assist, answeredInMs: Date.now() - t0, inks: await page.evaluate(() => document.querySelectorAll('.nova-ink').length) }
}
