// Real touch on a phone-size screen: write by finger, then open the ⋯ menu.
export default async function run(page) {
  const { glyphStrokes } = await import('./glyphs.mjs').catch(() => ({}))
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
  await cdp.send('Emulation.setEmitTouchEventsForMouse', { enabled: true, configuration: 'mobile' })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.reload()
  await page.waitForSelector('.welcome-card, [data-testid=workspace]', { timeout: 20000 })
  if (await page.locator('.welcome-card').count()) { await page.fill('#tester-name', 'QA Tester'); await page.press('#tester-name', 'Enter') }
  await page.waitForSelector('[data-testid=workspace]')
  const { drawText } = await import('./glyphs.mjs')
  const ws = await page.locator('[data-testid=workspace]').boundingBox()
  await drawText(page, '3x + 3 = 8', ws.x + 20, ws.y + 100, 40, 3)
  const strokes = await page.evaluate(() => document.querySelectorAll('[data-testid=workspace] canvas').length)
  await page.waitForFunction(() => document.querySelectorAll('.nova-ink').length > 0 || document.querySelector('.readback'), null, { timeout: 60000 }).catch(() => {})
  await page.waitForTimeout(1500)
  const read = await page.evaluate(() => [...document.querySelectorAll('.readback')].map((e) => e.textContent))
  const inks = await page.evaluate(() => document.querySelectorAll('.nova-ink').length)
  await page.screenshot({ path: './e2e-touch.png' })
  await page.getByRole('button', { name: 'More tools' }).dispatchEvent('click')
  await page.waitForTimeout(500)
  const menuOpen = await page.evaluate(() => !!document.querySelector('.dock-pop'))
  await page.screenshot({ path: './e2e-touch-menu.png' })
  let selectWorked = null
  if (menuOpen) {
    await page.locator('.dock-pop').getByRole('button', { name: 'Select' }).dispatchEvent('click').catch((e) => (selectWorked = String(e).slice(0, 80)))
    await page.waitForTimeout(300)
    if (selectWorked === null) selectWorked = await page.evaluate(() => document.querySelector('.dock [aria-pressed=true], .dock .active')?.getAttribute('aria-label') ?? 'no active')
  }
  return { strokes, read, inks, menuOpen, selectWorked }
}
