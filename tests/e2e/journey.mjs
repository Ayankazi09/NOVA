// Full journey with drawn strokes: problem + wrong step + Check, wrong arithmetic, graph, Next step, Assist auto-read.
export default async function run(page) {
  const { drawText } = await import('./glyphs.mjs')
  const out = []
  await page.setViewportSize({ width: 1500, height: 1100 })
  await page.waitForSelector('[data-testid=workspace]', { timeout: 20000 })
  await page.getByRole('button', { name: 'Notebooks' }).click()
  await page.getByRole('button', { name: /New notebook/ }).click()
  await page.waitForSelector('[data-testid=workspace]')
  await page.waitForTimeout(600)
  const ws = await page.locator('[data-testid=workspace]').boundingBox()
  const pen = () => page.getByRole('button', { name: 'Pen', exact: true }).first().click()
  const selectTool = () => page.getByRole('button', { name: 'Select', exact: true }).first().click()
  const settle = async () => {
    await page.waitForFunction(() => !document.querySelector('.readback.pending') && !document.querySelector('.nova-status.working'), null, { timeout: 120000 }).catch(() => {})
    await page.waitForTimeout(400)
  }
  const selectLine = async (x, y) => {
    await selectTool()
    await page.mouse.move(x - 20, y - 30); await page.mouse.down()
    await page.mouse.move(x + 640, y + 85, { steps: 6 }); await page.mouse.up()
    await page.waitForTimeout(250)
  }
  const menu = (name) => page.locator('.region-menu').getByRole('button', { name, exact: true }).click()
  const state = () => page.evaluate(() => ({
    readbacks: [...document.querySelectorAll('.readback')].map((e) => e.textContent),
    status: document.querySelector('.nova-status')?.textContent ?? null,
    cards: [...document.querySelectorAll('[data-testid=tutor-card]')].map((c) => c.textContent.slice(0, 200)),
    highlights: document.querySelectorAll('rect.hl.active').length,
    problemTags: document.querySelectorAll('.problem-tag').length,
  }))
  const X = ws.x + 150
  let y = ws.y + 80

  // 1. problem, read + confirm
  await pen(); await drawText(page, '2(x + 3) = 14', X, y, 54, 3)
  await selectLine(X, y); await menu('Read'); await settle()
  await page.locator('.readback').filter({ hasText: 'I read' }).first().getByRole('button', { name: 'Confirm' }).click().catch(() => {})
  await page.waitForTimeout(300)
  out.push({ step: 'problem', ...(await state()) })

  // 2. wrong step below, Check
  y += 170
  await page.keyboard.press('Escape'); await pen(); await drawText(page, '2x + 3 = 14', X, y, 54, 5)
  await selectLine(X, y); await menu('Check'); await settle()
  out.push({ step: 'wrong step + Check', ...(await state()) })

  // 3. wrong arithmetic, Check
  y += 170
  await page.keyboard.press('Escape'); await pen(); await drawText(page, '12 - 7 = 4', X, y, 54, 9)
  await selectLine(X, y); await menu('Check'); await settle()
  out.push({ step: 'wrong arithmetic + Check', ...(await state()) })

  // 4. graph
  y += 170
  await page.keyboard.press('Escape'); await pen(); await drawText(page, 'y = 2x + 1', X, y, 54, 13)
  await selectLine(X, y); await menu('Graph'); await settle()
  out.push({ step: 'graph', ...(await state()) })

  // 5. Assist on: write and wait for automatic reading (no clicks)
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: /Assist off/ }).click()
  await page.getByRole('button', { name: 'Turn on Assist' }).click()
  y += 170
  await pen(); await drawText(page, '9 + 6 =', X, y, 54, 17)
  const t0 = Date.now()
  await page.waitForFunction(() => [...document.querySelectorAll('.readback')].some((e) => e.textContent.includes('9 + 6')), null, { timeout: 60000 }).catch(() => {})
  out.push({ step: 'assist auto-read', autoReadMs: Date.now() - t0, ...(await state()) })

  await page.screenshot({ path: './e2e-journey.png', fullPage: true })
  return out
}
