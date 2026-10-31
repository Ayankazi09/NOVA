// Home with real activity: write lines (NOVA marks/answers them), then look at Home.
export default async function run(page) {
  const { drawText } = await import('./glyphs.mjs')
  await page.setViewportSize({ width: 1440, height: 920 })
  await page.waitForSelector('[data-testid=workspace]', { timeout: 20000 })
  await page.screenshot({ path: './e2e-home-first-run.png' })
  const assist = page.getByRole('button', { name: /Assist off/ })
  if (await assist.count()) {
    await assist.click()
    const consent = page.getByRole('button', { name: 'Turn on Assist' })
    if (await consent.count()) await consent.click()
  }
  const ws = await page.locator('[data-testid=workspace]').boundingBox()
  const write = async (text, y, seed) => {
    const before = await page.evaluate(() => document.querySelectorAll('.nova-ink').length)
    await drawText(page, text, ws.x + 160, ws.y + y, 48, seed)
    await page.waitForFunction((n) => document.querySelectorAll('.nova-ink').length > n, before, { timeout: 40000 }).catch(() => {})
  }
  await write('4 + 2 = 7', 180, 1)
  await write('9 - 3 = 6', 300, 2)
  await write('6 + 7 =', 420, 3)
  await page.getByRole('button', { name: 'Notebooks' }).click()
  await page.waitForSelector('.home2')
  await page.getByRole('button', { name: /New notebook/ }).first().click()
  await page.waitForSelector('[data-testid=workspace]')
  await write('12 - 5 = 8', 180, 4)
  await drawText(page, 'y = 2x + 1', ws.x + 160, ws.y + 320, 48, 5)
  await page.waitForTimeout(1500)
  await page.getByRole('button', { name: 'Notebooks' }).click()
  await page.waitForSelector('.doc-thumb')
  await page.waitForTimeout(800)
  await page.screenshot({ path: './e2e-home2.png' })
  return {
    review: await page.evaluate(() => [...document.querySelectorAll('.rv-text')].map((e) => e.textContent)),
    figures: await page.evaluate(() => document.querySelector('.figures')?.textContent),
  }
}
