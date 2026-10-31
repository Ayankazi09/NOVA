export default async function run(page) {
  const { drawText } = await import('./glyphs.mjs')
  await page.setViewportSize({ width: 1400, height: 900 })
  await page.waitForSelector('[data-testid=workspace]', { timeout: 20000 })
  const ws = await page.locator('[data-testid=workspace]').boundingBox()
  await drawText(page, '2(x + 3) = 14', ws.x + 140, ws.y + 140, 50, 3)
  await page.waitForTimeout(500)
  await page.screenshot({ path: './e2e-classic-notebook.png' })
  await page.getByRole('button', { name: 'Notebooks' }).click()
  await page.waitForSelector('.library-grid')
  await page.waitForTimeout(400)
  await page.screenshot({ path: './e2e-classic-library.png' })
  return { tiles: await page.evaluate(() => document.querySelectorAll('.nb-tile').length) }
}
