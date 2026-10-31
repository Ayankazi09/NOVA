export default async function run(page) {
  const logs = []
  page.on('console', (m) => logs.push(`${m.type()}: ${m.text()}`.slice(0, 300)))
  page.on('pageerror', (e) => logs.push('pageerror: ' + e.message.slice(0, 300)))
  await page.setViewportSize({ width: 1500, height: 1000 })
  await page.waitForSelector('[data-testid=workspace]', { timeout: 20000 })
  await page.locator('input[accept="application/pdf,.pdf"]').setInputFiles('C:/Users/smand/OneDrive/Desktop/Nova/tests/fixtures/practice_test.pdf')
  await page.waitForTimeout(25000)
  return {
    logs,
    toasts: await page.evaluate(() => [...document.querySelectorAll('.toast')].map((t) => t.textContent)),
    panel: await page.evaluate(() => document.querySelector('.test-panel')?.textContent?.slice(0, 400) ?? null),
    pages: await page.evaluate(() => document.querySelector('.page-count')?.textContent),
  }
}
