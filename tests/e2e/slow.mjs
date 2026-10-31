// Write "7/2 + 3/2 =" in chunks with thinking pauses, like a student; count "Which did you write?" prompts.
export default async function run(page) {
  const { drawText } = await import('./glyphs.mjs')
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.waitForSelector('.welcome-card, [data-testid=workspace]', { timeout: 20000 })
  if (await page.locator('.welcome-card').count()) { await page.fill('#tester-name', 'QA Tester'); await page.press('#tester-name', 'Enter') }
  await page.waitForSelector('[data-testid=workspace]')
  const ws = await page.locator('[data-testid=workspace]').boundingBox()
  let prompts = 0
  const watch = setInterval(async () => { try { if (await page.evaluate(() => !!document.querySelector('.readback.unclear'))) prompts++ } catch {} }, 400)
  await drawText(page, '7/2', ws.x + 120, ws.y + 120, 50, 3)
  await page.waitForTimeout(1600) // a short thinking pause
  await drawText(page, '+', ws.x + 230, ws.y + 120, 50, 3)
  await page.waitForTimeout(1600)
  await drawText(page, '3/2 =', ws.x + 290, ws.y + 120, 50, 3)
  await page.waitForFunction(() => document.querySelectorAll('.nova-ink').length > 0, null, { timeout: 60000 }).catch(() => {})
  await page.waitForTimeout(1500)
  clearInterval(watch)
  await page.mouse.move(ws.x + 200, ws.y + 140)
  await page.waitForTimeout(300)
  return { unclearPromptsSeen: prompts, reading: await page.evaluate(() => [...document.querySelectorAll('.readback')].map((e) => e.textContent).join(' | ')), novaWrote: await page.evaluate(() => document.querySelectorAll('.nova-ink').length) }
}
