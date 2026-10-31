// General question in the Ask thread: NOVA writes a verified trig table onto the page, then the student replies.
export default async function run(page) {
  const { drawText } = await import('./glyphs.mjs')
  await page.setViewportSize({ width: 1500, height: 1000 })
  await page.waitForSelector('[data-testid=workspace]', { timeout: 20000 })
  await page.getByRole('button', { name: 'Notebooks' }).click()
  await page.getByRole('button', { name: /New notebook/ }).click()
  await page.waitForSelector('[data-testid=workspace]')
  await page.waitForTimeout(500)
  const ws = await page.locator('[data-testid=workspace]').boundingBox()
  await drawText(page, '4 + 2 =', ws.x + 150, ws.y + 90, 54, 3) // a line exists, but the question is general
  await page.getByRole('button', { name: 'Ask NOVA' }).first().click()
  const box = page.locator('.ask-panel textarea')
  await box.fill('Add a trigonometry table to my notebook')
  await box.press('Enter')
  const t0 = Date.now()
  await page.waitForFunction(() => !document.querySelector('.bubble.thinking') && document.querySelectorAll('.bubble.tutor').length > 0, null, { timeout: 120000 }).catch(() => {})
  const first = {
    ms: Date.now() - t0,
    bubbles: await page.evaluate(() => [...document.querySelectorAll('.bubble')].map((b) => `${b.className.replace('bubble ', '')}: ${b.textContent}`)),
    contentInk: await page.evaluate(() => document.querySelectorAll('.nova-ink').length),
    about: await page.evaluate(() => document.querySelector('.about-chip')?.textContent),
  }
  await page.waitForTimeout(2500)
  await page.screenshot({ path: './e2e-table.png' })
  // reply in the same thread
  await box.fill('Now add tan values too, and explain where √3/2 comes from')
  await box.press('Enter')
  await page.waitForFunction((n) => document.querySelectorAll('.bubble.tutor').length > n && !document.querySelector('.bubble.thinking'), first.bubbles.filter((b) => b.startsWith('tutor')).length, { timeout: 120000 }).catch(() => {})
  const second = {
    bubbles: await page.evaluate(() => [...document.querySelectorAll('.bubble')].map((b) => `${b.className.replace('bubble ', '')}: ${b.textContent.slice(0, 220)}`)),
    contentInk: await page.evaluate(() => document.querySelectorAll('.nova-ink').length),
  }
  await page.waitForTimeout(2500)
  await page.screenshot({ path: './e2e-table2.png' })
  return { first, second }
}
