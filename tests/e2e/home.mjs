// Home screen with real data: write in a notebook, go Home, look at it.
export default async function run(page) {
  const { drawText } = await import('./glyphs.mjs')
  await page.setViewportSize({ width: 1440, height: 960 })
  await page.waitForSelector('[data-testid=workspace]', { timeout: 20000 })
  const ws = await page.locator('[data-testid=workspace]').boundingBox()
  await drawText(page, '2(x + 3) = 14', ws.x + 160, ws.y + 200, 50, 3)
  await drawText(page, 'y = 2x + 1', ws.x + 160, ws.y + 340, 50, 4)
  await page.waitForTimeout(400)
  await page.screenshot({ path: './e2e-notebook-theme.png' })
  await page.getByRole('button', { name: 'Notebooks' }).click()
  await page.waitForSelector('.home')
  await page.getByRole('button', { name: /New notebook/ }).first().click()
  await page.waitForSelector('[data-testid=workspace]')
  await drawText(page, '4 + 2 =', ws.x + 200, ws.y + 220, 54, 6)
  await page.waitForTimeout(300)
  await page.getByRole('button', { name: 'Notebooks' }).click()
  await page.waitForSelector('.nb-card')
  await page.waitForTimeout(600)
  await page.screenshot({ path: './e2e-home.png' })
  return { cards: await page.evaluate(() => document.querySelectorAll('.nb-card').length) }
}
