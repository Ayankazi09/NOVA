// "Teach NOVA your handwriting": draw a few characters, check the preview uses them, save.
export default async function run(page) {
  await page.setViewportSize({ width: 1300, height: 1000 })
  await page.waitForSelector('[data-testid=workspace]', { timeout: 20000 })
  await page.getByRole('button', { name: 'More' }).first().click()
  await page.getByRole('button', { name: 'Settings & connection' }).click()
  await page.getByRole('button', { name: /Teach NOVA your handwriting/ }).click()
  await page.waitForSelector('.hw-dialog')
  const before = await page.evaluate(() => document.querySelector('.hw-preview')?.innerHTML.length)
  // a boxy, very personal "5" and a slanted "=" — easy to spot in the preview
  const draw = async (label, strokes) => {
    const box = await page.getByLabel(label, { exact: true }).first().boundingBox()
    for (const s of strokes) {
      await page.mouse.move(box.x + s[0][0], box.y + s[0][1])
      await page.mouse.down()
      for (const [x, y] of s.slice(1)) await page.mouse.move(box.x + x, box.y + y, { steps: 4 })
      await page.mouse.up()
    }
  }
  await draw('Write 5', [[[54, 19], [20, 19], [18, 45], [52, 45], [54, 72], [16, 72]]])
  await draw('Write =', [[[14, 42], [58, 37]], [[14, 58], [58, 53]]])
  await page.waitForTimeout(300)
  const after = await page.evaluate(() => document.querySelector('.hw-preview')?.innerHTML.length)
  const taught = await page.evaluate(() => document.querySelector('.hw-dialog .row .muted')?.textContent)
  await page.screenshot({ path: './e2e-handwriting.png' })
  await page.getByRole('button', { name: 'Save' }).click()
  await page.waitForTimeout(400)
  const toast = await page.evaluate(() => [...document.querySelectorAll('.toast')].map((t) => t.textContent).join(' | '))
  return { previewChanged: before !== after, taught, toast }
}
