export default async function run(page) {
  const { drawText } = await import('./glyphs.mjs')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.reload()
  await page.waitForSelector('.welcome-card', { timeout: 20000 })
  await page.screenshot({ path: './e2e-welcome.png' })
  await page.fill('#tester-name', 'QA Tester')
  await page.getByRole('button', { name: 'Start writing' }).click()
  await page.waitForSelector('[data-testid=workspace]', { timeout: 20000 })
  const ws = await page.locator('[data-testid=workspace]').boundingBox()
  await drawText(page, '3x + 2 = 10', ws.x + 30, ws.y + 110, 44, 3)
  await page.waitForFunction(() => document.querySelectorAll('.nova-ink').length > 0, null, { timeout: 90000 }).catch(() => {})
  await page.waitForTimeout(3000)
  await page.screenshot({ path: './e2e-tester.png' })
  return { inks: await page.evaluate(() => document.querySelectorAll('.nova-ink').length) }
}
