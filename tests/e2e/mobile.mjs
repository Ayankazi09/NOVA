export default async function run(page) {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.reload()
  await page.waitForSelector('[data-testid=workspace]', { timeout: 20000 })
  await page.waitForTimeout(600)
  await page.screenshot({ path: './e2e-m-notebook.png' })
  const info = await page.evaluate(() => ({ docW: document.documentElement.scrollWidth, tb: document.querySelector('.toolbar')?.getBoundingClientRect().toJSON(), top: document.querySelector('.topbar')?.getBoundingClientRect().toJSON(), ws: document.querySelector('[data-testid=workspace]')?.getBoundingClientRect().toJSON() }))
  await page.getByRole('button', { name: 'Ask NOVA' }).first().click().catch(() => {})
  await page.waitForTimeout(500)
  await page.screenshot({ path: './e2e-m-ask.png' })
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Notebooks' }).click()
  await page.waitForTimeout(800)
  await page.screenshot({ path: './e2e-m-lib.png', fullPage: false })
  return info
}
