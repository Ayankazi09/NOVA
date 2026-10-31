export default async function run(page) {
  const { drawText } = await import('./glyphs.mjs')
  await page.setViewportSize({ width: 1400, height: 900 })
  await page.waitForSelector('[data-testid=workspace]', { timeout: 20000 })
  // fresh notebook so the line is its own problem
  await page.getByRole('button', { name: 'Notebooks' }).click()
  await page.getByRole('button', { name: /New notebook/ }).click()
  await page.waitForSelector('[data-testid=workspace]')
  const assist = page.locator('.assist-toggle')
  if (!(await assist.getAttribute('class')).includes('on')) {
    await assist.click()
    const c = page.getByRole('button', { name: 'Turn on Assist', exact: true })
    if (await c.count()) await c.click()
  }
  const ws = await page.locator('[data-testid=workspace]').boundingBox()
  await page.waitForTimeout(400)
  await drawText(page, '3x + 2 = x + 10', ws.x + 120, ws.y + 110, 48, 5)
  await page.waitForFunction(() => document.querySelectorAll('.nova-ink').length > 0, null, { timeout: 60000 }).catch(() => {})
  await page.waitForTimeout(3000)
  await page.screenshot({ path: './e2e-arrows2.png' })
  return { inks: await page.evaluate(() => document.querySelectorAll('.nova-ink').length) }
}
