export default async function run(page) {
  const { drawText } = await import('./glyphs.mjs')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.waitForSelector('.welcome-card, [data-testid=workspace]', { timeout: 20000 })
  if (await page.locator('.welcome-card').count()) { await page.fill('#tester-name', 'QA Tester'); await page.press('#tester-name', 'Enter') }
  await page.waitForSelector('[data-testid=workspace]')
  const ws = await page.locator('[data-testid=workspace]').boundingBox()
  const line = async (x0, y0, x1, y1) => {
    await page.mouse.move(ws.x + x0, ws.y + y0); await page.mouse.down()
    for (let i = 1; i <= 20; i++) await page.mouse.move(ws.x + x0 + ((x1 - x0) * i) / 20, ws.y + y0 + ((y1 - y0) * i) / 20)
    await page.mouse.up()
  }
  // a right triangle: legs 6 (vertical) and 8 (horizontal), hypotenuse x, right-angle square
  await line(150, 150, 150, 450); await line(150, 450, 550, 450); await line(550, 450, 150, 150)
  await line(150, 420, 180, 420); await line(180, 420, 180, 450)
  await drawText(page, '6', ws.x + 95, ws.y + 290, 40, 2)
  await drawText(page, '8', ws.x + 340, ws.y + 495, 40, 2)
  await drawText(page, 'x', ws.x + 370, ws.y + 270, 40, 2)
  await page.waitForTimeout(2500)
  const before = await page.evaluate(() => document.querySelectorAll('.nova-ink').length)
  await drawText(page, 'x =', ws.x + 700, ws.y + 250, 46, 3)
  await page.waitForFunction((n) => document.querySelectorAll('.nova-ink').length > n, before, { timeout: 120000 }).catch(() => {})
  await page.waitForTimeout(3000)
  await page.screenshot({ path: './e2e-diagram.png' })
  return { before, after: await page.evaluate(() => document.querySelectorAll('.nova-ink').length) }
}
