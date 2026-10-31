// Home is a page: write on it (NOVA answers), pinned notebooks on the same grid.
export default async function run(page) {
  const { drawText } = await import('./glyphs.mjs')
  const out = {}
  await page.setViewportSize({ width: 1440, height: 920 })
  await page.waitForSelector('.home-bar', { timeout: 20000 })
  await page.waitForTimeout(600)
  await page.screenshot({ path: './e2e-homepage-first.png' })
  const hintBtn = page.getByRole('button', { name: /Turn on Assist/ })
  if (await hintBtn.count()) {
    await hintBtn.click()
    const consent = page.getByRole('button', { name: 'Turn on Assist', exact: true })
    if (await consent.count()) await consent.click()
  }
  const ws = await page.locator('[data-testid=workspace]').boundingBox()
  await drawText(page, '3 + 2 =', ws.x + 110, ws.y + 330, 52, 7)
  await page.waitForFunction(() => document.querySelectorAll('.nova-ink').length > 0, null, { timeout: 45000 }).catch(() => {})
  out.homeAnswered = await page.evaluate(() => document.querySelectorAll('.nova-ink').length)
  // a notebook from the pinned "+" card
  await page.locator('.pin.new').click()
  await page.waitForSelector('.topbar:not(.home-bar)')
  await page.waitForTimeout(300)
  await drawText(page, '4 + 2 = 7', ws.x + 160, ws.y + 200, 50, 2)
  await page.waitForFunction(() => document.querySelectorAll('.nova-ink').length > 0, null, { timeout: 45000 }).catch(() => {})
  await drawText(page, 'y = 2x + 1', ws.x + 160, ws.y + 330, 50, 3)
  await page.waitForTimeout(800)
  await page.getByRole('button', { name: 'Notebooks' }).click()
  await page.waitForSelector('.home-bar')
  await page.waitForTimeout(1500)
  out.pins = await page.evaluate(() => document.querySelectorAll('.pin').length)
  await page.screenshot({ path: './e2e-homepage.png' })
  return out
}
