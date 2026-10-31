export default async function run(page) {
  const log = []
  const t0 = Date.now()
  const step = (s) => log.push(`${((Date.now() - t0) / 1000).toFixed(1)}s ${s}`)
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.reload()
  await page.waitForSelector('.welcome-card, [data-testid=workspace]', { timeout: 20000 })
  step('loaded')
  if (await page.locator('.welcome-card').count()) { await page.fill('#tester-name', 'QA Tester'); await page.press('#tester-name', 'Enter') }
  await page.waitForSelector('[data-testid=workspace]', { timeout: 15000 })
  step('notebook open')
  // finger strokes via CDP touch events: "3" "+" "3" roughly, enough to make a line
  const ws = await page.locator('[data-testid=workspace]').boundingBox()
  const stroke = async (pts) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pts[0][0], y: pts[0][1] }] })
    for (const [x, y] of pts.slice(1)) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] })
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  }
  const line = (x0, y0, x1, y1) => Array.from({ length: 10 }, (_, i) => [ws.x + x0 + ((x1 - x0) * i) / 9, ws.y + y0 + ((y1 - y0) * i) / 9])
  await stroke(line(30, 120, 60, 160)); await stroke(line(30, 160, 60, 200))
  await stroke(line(90, 160, 130, 160)); await stroke(line(110, 140, 110, 180))
  step('drew')
  const strokes = await Promise.race([page.evaluate(() => document.querySelectorAll('.readback').length), new Promise((r) => setTimeout(() => r('PAGE FROZEN'), 8000))])
  step('page responds: ' + strokes)
  await page.waitForTimeout(8000)
  step('readbacks: ' + (await Promise.race([page.evaluate(() => [...document.querySelectorAll('.readback')].map((e) => e.textContent).join(' | ')), new Promise((r) => setTimeout(() => r('PAGE FROZEN'), 8000))])))
  const more = await page.$('[aria-label="More tools"]')
  if (more) {
    const b = await more.boundingBox()
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: b.x + b.width / 2, y: b.y + b.height / 2 }] })
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await page.waitForTimeout(600)
    step('menu open: ' + (await page.evaluate(() => !!document.querySelector('.dock-pop'))))
  } else step('no More button')
  await page.screenshot({ path: './e2e-touch.png' })
  return log
}
