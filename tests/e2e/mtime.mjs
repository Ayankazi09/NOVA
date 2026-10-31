export default async function run(page) {
  const { drawText } = await import('./glyphs.mjs')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.reload()
  await page.waitForSelector('[data-testid=workspace]', { timeout: 20000 })
  // Assist lives in the More menu on phones
  await page.locator('.topbar .assist-toggle').click()
  const c = page.getByRole('button', { name: 'Turn on Assist', exact: true })
  if (await c.count()) await c.click()
  const ws = await page.locator('[data-testid=workspace]').boundingBox()
  await drawText(page, '3x + 7 = 13', ws.x + 20, ws.y + 120, 40, 3)
  const t0 = Date.now()
  await page.waitForFunction(() => document.querySelector('.readback.accepted, .readback .rb-text'), null, { timeout: 120000 }).catch(() => {})
  const tRead = Date.now() - t0
  await page.waitForFunction(() => document.querySelectorAll('.nova-ink').length > 0, null, { timeout: 120000 }).catch(() => {})
  const tInk = Date.now() - t0
  await page.waitForTimeout(1500)
  await page.screenshot({ path: './e2e-m-solve.png' })
  await page.getByRole('button', { name: 'Notebooks' }).click()
  await page.waitForTimeout(1200)
  await page.screenshot({ path: './e2e-m-lib.png' })
  await page.setViewportSize({ width: 820, height: 1180 })
  await page.reload()
  await page.waitForTimeout(800)
  await page.waitForTimeout(800)
  await page.screenshot({ path: './e2e-tablet.png', clip: { x: 0, y: 0, width: 820, height: 400 } })
  return { readMs: tRead, inkMs: tInk, regions: await page.evaluate(() => document.querySelectorAll('.readback').length), text: await page.evaluate(() => [...document.querySelectorAll('.readback')].map((e) => e.textContent)) }
}
