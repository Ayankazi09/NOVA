export default async function run(page) {
  const { drawText } = await import('./glyphs.mjs')
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.reload()
  await page.waitForSelector('.welcome-card, [data-testid=workspace]', { timeout: 20000 })
  if (await page.locator('.welcome-card').count()) { await page.fill('#tester-name', 'QA Tester'); await page.press('#tester-name', 'Enter') }
  await page.waitForSelector('[data-testid=workspace]')
  const ws = await page.locator('[data-testid=workspace]').boundingBox()
  // finger starts a stroke, then a palm/second finger lands (becomes a pinch), then both lift
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: ws.x + 200, y: ws.y + 500, id: 1 }] })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: ws.x + 210, y: ws.y + 505, id: 1 }] })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: ws.x + 210, y: ws.y + 505, id: 1 }, { x: ws.x + 300, y: ws.y + 600, id: 2 }] })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await page.waitForTimeout(300)
  await drawText(page, '3x + 3 = 8', ws.x + 20, ws.y + 100, 40, 3)
  const t0 = Date.now()
  await page.waitForFunction(() => document.querySelectorAll('.nova-ink').length > 0, null, { timeout: 45000 }).catch(() => {})
  const answeredAfterMs = Date.now() - t0
  await page.waitForTimeout(1500)
  return { answeredAfterMs, inks: await page.evaluate(() => document.querySelectorAll('.nova-ink').length), rowsShown: await page.evaluate(() => [...document.querySelectorAll('.readback')].map((e) => e.className + ': ' + e.textContent)) }
}
