// The I3.png case: "sin 30 =" written on a rising slant with a stray dot; the answer must sit beside the "=".
export default async function run(page) {
  const { drawText } = await import('./glyphs.mjs')
  await page.setViewportSize({ width: 1300, height: 900 })
  await page.waitForSelector('[data-testid=workspace]', { timeout: 20000 })
  await page.getByRole('button', { name: 'Notebooks' }).click()
  await page.getByRole('button', { name: /New notebook/ }).click()
  await page.waitForSelector('[data-testid=workspace]')
  await page.waitForTimeout(500)
  const assist = page.getByRole('button', { name: /Assist off/ })
  if (await assist.count()) {
    await assist.click()
    const consent = page.getByRole('button', { name: 'Turn on Assist' })
    if (await consent.count()) await consent.click()
  }
  const ws = await page.locator('[data-testid=workspace]').boundingBox()
  const end = await drawText(page, 'sin 30 =', ws.x + 200, ws.y + 480, 56, 4, 0.55)
  await page.mouse.move(end + 16, ws.y + 480 - 0.55 * (end - ws.x - 200) + 20); await page.mouse.down(); await page.mouse.up() // stray dot
  await page.waitForFunction(() => document.querySelectorAll('.nova-ink').length > 0, null, { timeout: 45000 }).catch(() => {})
  await page.waitForTimeout(900)
  await page.screenshot({ path: './e2e-slant.png' })
  return { inks: await page.evaluate(() => document.querySelectorAll('.nova-ink').length), label: await page.evaluate(() => [...document.querySelectorAll('.readback')].map((e) => e.textContent)) }
}
