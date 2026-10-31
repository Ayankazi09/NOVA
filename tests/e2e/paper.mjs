// Test mode: import a PDF paper, answer on the page, ask for help, finish and get marked.
export default async function run(page) {
  const { drawText } = await import('./glyphs.mjs')
  const out = {}
  await page.setViewportSize({ width: 1500, height: 1000 })
  await page.waitForSelector('[data-testid=workspace]', { timeout: 20000 })
  await page.getByRole('button', { name: 'Notebooks' }).click()
  await page.getByRole('button', { name: /New notebook/ }).click()
  await page.waitForSelector('[data-testid=workspace]')
  await page.waitForTimeout(500)
  await page.locator('input[accept="application/pdf,.pdf"]').setInputFiles('C:/Users/smand/OneDrive/Desktop/Nova/tests/fixtures/practice_test.pdf')
  const t0 = Date.now()
  await page.waitForFunction(() => {
    const b = document.querySelector('.test-foot .btn.primary')
    return document.querySelectorAll('.q-row').length > 0 && b && !b.disabled
  }, null, { timeout: 240000 })
  out.readMs = Date.now() - t0
  out.questions = await page.evaluate(() => [...document.querySelectorAll('.q-row .q-main')].map((e) => e.textContent))
  const ws = await page.locator('[data-testid=workspace]').boundingBox()
  const answers = { 0: 'x = 4', 1: '1/2', 3: 'x = 2', 4: '6' }
  for (const [idx, text] of Object.entries(answers)) {
    await page.locator('.q-row .q-main').nth(Number(idx)).click()
    await page.waitForTimeout(500)
    await page.getByRole('button', { name: 'Pen', exact: true }).first().click()
    // write just under the question, using its real position on the page
    const pos = await page.evaluate((i) => {
      const [bx, by, , bh] = document.querySelectorAll('.q-row')[i].getAttribute('data-bounds').split(',').map(Number)
      const m = /translate\(([-\d.e]+)px, ([-\d.e]+)px\) scale\(([\d.e]+)\)/.exec(document.querySelector('.page-transform.overlay').style.transform)
      const [tx, ty, sc] = [Number(m[1]), Number(m[2]), Number(m[3])]
      return { x: tx + (bx + 30) * sc, y: ty + (by + bh + 24) * sc }
    }, Number(idx))
    await drawText(page, text, ws.x + pos.x, ws.y + pos.y, 44, 5 + Number(idx))
    await page.waitForTimeout(300)
  }
  // ask for help on question 4 (the one answered wrongly)
  const before = await page.evaluate(() => document.querySelectorAll('.bubble.tutor').length)
  await page.locator('.q-row').nth(3).getByRole('button', { name: /Help/ }).click()
  await page.waitForFunction((n) => document.querySelectorAll('.bubble.tutor').length > n && !document.querySelector('.bubble.thinking'), before, { timeout: 120000 }).catch(() => {})
  out.help = await page.evaluate(() => [...document.querySelectorAll('.bubble.tutor')].map((b) => b.textContent).pop())
  out.circles = await page.evaluate(() => document.querySelectorAll('path.hl').length)
  await page.screenshot({ path: './e2e-paper-help.png' })
  const close = page.locator('.ask-panel').getByRole('button', { name: 'Close' })
  if (await close.count()) await close.click()
  // finish and mark
  await page.getByRole('button', { name: 'Finish test' }).click()
  await page.waitForSelector('.score', { timeout: 240000 }).catch(() => {})
  out.score = await page.evaluate(() => document.querySelector('.score')?.textContent)
  out.verdicts = await page.evaluate(() => [...document.querySelectorAll('.q-row')].map((r) => `${r.querySelector('.q-num')?.textContent}: ${r.querySelector('.q-verdict')?.textContent} | ${r.querySelector('.q-key')?.textContent ?? ''}`))
  await page.locator('.q-row .q-main').first().click()
  await page.waitForTimeout(2200)
  await page.screenshot({ path: './e2e-paper-marked.png' })
  return out
}
