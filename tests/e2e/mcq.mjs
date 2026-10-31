// Multi-page MCQ paper: all pages read, circled options are marked, Explain writes a coloured solution beside the sheet.
export default async function run(page) {
  const out = {}
  await page.setViewportSize({ width: 1500, height: 1000 })
  await page.waitForSelector('[data-testid=workspace]', { timeout: 20000 })
  await page.getByRole('button', { name: 'Notebooks' }).click()
  await page.getByRole('button', { name: /New notebook/ }).click()
  await page.waitForSelector('[data-testid=workspace]')
  await page.waitForTimeout(500)
  await page.locator('input[accept="application/pdf,.pdf"]').setInputFiles('C:/Users/smand/OneDrive/Desktop/Nova/tests/fixtures/mcq_3pages.pdf')
  const t0 = Date.now()
  await page.waitForFunction(() => {
    const b = document.querySelector('.test-foot .btn.primary')
    return b && !b.disabled && document.querySelectorAll('.q-row').length > 0
  }, null, { timeout: 300000 })
  out.readSec = Math.round((Date.now() - t0) / 1000)
  out.questions = await page.evaluate(() => document.querySelectorAll('.q-row').length)
  out.error = await page.evaluate(() => document.querySelector('.test-error')?.textContent ?? null)
  const ws = await page.locator('[data-testid=workspace]').boundingBox()
  const UNIT = 1200 / 595
  // circle option k (0 = a) of question i: options are printed 30pt + 24pt*k below the question line, at x = 90pt
  const circle = async (qi, k) => {
    await page.locator('.q-row .q-main').nth(qi).click()
    await page.waitForTimeout(500)
    await page.getByRole('button', { name: 'Pen', exact: true }).first().click()
    const p = await page.evaluate(([qi, k, UNIT]) => {
      const [, by] = document.querySelectorAll('.q-row')[qi].getAttribute('data-bounds').split(',').map(Number)
      const m = /translate\(([-\d.e]+)px, ([-\d.e]+)px\) scale\(([\d.e]+)\)/.exec(document.querySelector('.page-transform.overlay').style.transform)
      const [tx, ty, s] = [Number(m[1]), Number(m[2]), Number(m[3])]
      const lineTop = by + 8
      const cy = lineTop + (30 + 24 * k) * UNIT + 4
      const cx = 90 * UNIT + 22
      return { x: tx + cx * s, y: ty + cy * s, rx: 40 * s, ry: 17 * s }
    }, [qi, k, UNIT])
    const pts = Array.from({ length: 26 }, (_, i) => { const t = (i / 25) * Math.PI * 2.1; return [p.x + p.rx * Math.cos(t), p.y + p.ry * Math.sin(t)] })
    await page.mouse.move(ws.x + pts[0][0], ws.y + pts[0][1]); await page.mouse.down()
    for (const [x, y] of pts.slice(1)) await page.mouse.move(ws.x + x, ws.y + y, { steps: 2 })
    await page.mouse.up()
    await page.waitForTimeout(400)
  }
  await circle(0, 1) // Q1: (b) 1/2  -> correct
  await circle(1, 0) // Q2: (a) 3    -> wrong (x = 4)
  out.labels = await page.evaluate(() => [...document.querySelectorAll('.readback')].map((e) => e.textContent).slice(0, 4))
  await page.getByRole('button', { name: 'Finish test' }).click()
  await page.waitForSelector('.score', { timeout: 300000 }).catch(() => {})
  out.score = await page.evaluate(() => document.querySelector('.score-num')?.textContent + '/' + document.querySelector('.score-den')?.textContent)
  out.verdicts = await page.evaluate(() => [...document.querySelectorAll('.q-row')].slice(0, 3).map((r) => `${r.querySelector('.q-num')?.textContent}: ${r.querySelector('.q-verdict')?.textContent}`))
  // explain the wrong one
  const inkBefore = await page.evaluate(() => document.querySelectorAll('.nova-ink').length)
  await page.locator('.q-row').nth(1).getByRole('button', { name: 'Explain' }).click()
  await page.waitForFunction((n) => document.querySelectorAll('.nova-ink').length > n, inkBefore, { timeout: 150000 }).catch(() => {})
  await page.waitForTimeout(2500)
  out.explain = await page.evaluate(() => {
    const bubbles = [...document.querySelectorAll('.bubble.tutor')].map((b) => b.textContent)
    const inks = [...document.querySelectorAll('.nova-ink')]
    const last = inks[inks.length - 1]
    const colors = last ? [...new Set([...last.querySelectorAll('path')].map((p) => p.style.stroke).filter(Boolean))] : []
    let minX = Infinity
    if (last) for (const p of last.querySelectorAll('path')) { const m = /M([\d.]+)/.exec(p.getAttribute('d')); if (m) minX = Math.min(minX, Number(m[1])) }
    return { chat: bubbles[bubbles.length - 1], colors, minX: Math.round(minX) }
  })
  const close = page.locator('.ask-panel').getByRole('button', { name: 'Close' })
  if (await close.count()) await close.click()
  await page.getByRole('button', { name: 'Close test panel' }).click() // hide the panel to see the page
  await page.mouse.move(ws.x + 600, ws.y + 500)
  for (let i = 0; i < 3; i++) await page.mouse.wheel(300, 0)
  await page.waitForTimeout(600)
  await page.screenshot({ path: './e2e-mcq.png' })
  return out
}
