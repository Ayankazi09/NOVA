export default async function run(page) {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.reload()
  await page.waitForSelector('.welcome-card, [data-testid=workspace]', { timeout: 20000 })
  if (await page.locator('.welcome-card').count()) { await page.fill('#tester-name', 'QA Tester'); await page.press('#tester-name', 'Enter') }
  await page.waitForSelector('.dock')
  await page.locator('[aria-label="More tools"]').dispatchEvent('click')
  await page.waitForTimeout(400)
  return await page.evaluate(() => {
    const el = document.querySelector('.dock-pop')
    const cs = getComputedStyle(el)
    const chain = []
    for (let n = el; n && n !== document.body; n = n.parentElement) { const c = getComputedStyle(n); if (c.overflow !== 'visible' || c.position !== 'static' || c.zIndex !== 'auto') chain.push(`${n.className.toString().slice(0, 30)} pos=${c.position} ov=${c.overflow} z=${c.zIndex}`) }
    return { rect: el.getBoundingClientRect().toJSON(), display: cs.display, vis: cs.visibility, op: cs.opacity, pos: cs.position, chain }
  })
}
