export default async function run(page) {
  const { drawText } = await import('./glyphs.mjs')
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.waitForSelector('.welcome-card, [data-testid=workspace]', { timeout: 20000 })
  if (await page.locator('.welcome-card').count()) { await page.fill('#tester-name', 'QA Tester'); await page.getByRole('button', { name: 'Start writing' }).click() }
  await page.waitForSelector('[data-testid=workspace]')
  const ws = await page.locator('[data-testid=workspace]').boundingBox()
  await drawText(page, '3x + 2 = 10', ws.x + 120, ws.y + 110, 50, 3)
  await page.waitForFunction(() => document.querySelectorAll('.nova-ink').length > 0, null, { timeout: 90000 }).catch(() => {})
  await page.mouse.move(ws.x + 1000, ws.y + 600)
  await page.waitForTimeout(500)
  const away = await page.evaluate(() => document.querySelectorAll('.readback').length)
  await page.mouse.move(ws.x + 200, ws.y + 140)
  await page.waitForTimeout(300)
  const over = await page.evaluate(() => document.querySelectorAll('.readback').length)
  await page.waitForTimeout(4500)
  return { away, over, statusLeft: await page.evaluate(() => document.querySelectorAll('.nova-status').length) }
}
