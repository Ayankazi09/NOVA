export default async function run(page) {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.waitForSelector('[data-testid=workspace]', { timeout: 20000 })
  await page.waitForTimeout(500)
  await page.screenshot({ path: './e2e-logo-notebook.png', clip: { x: 0, y: 0, width: 1440, height: 130 } })
  await page.getByRole('button', { name: 'Ask NOVA' }).first().click()
  await page.waitForTimeout(500)
  await page.screenshot({ path: './e2e-logo-ask.png' })
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Notebooks' }).click()
  await page.waitForSelector('.lib-grid')
  await page.waitForTimeout(600)
  await page.screenshot({ path: './e2e-logo-lib.png', clip: { x: 0, y: 0, width: 1440, height: 130 } })
  return { imgs: await page.evaluate(() => [...document.querySelectorAll('img.brand-logo')].map((i) => i.naturalWidth)) }
}
