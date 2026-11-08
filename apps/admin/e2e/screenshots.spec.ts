// Not a test: captures every page in light and dark, desktop and phone, for a
// design review. Runs only with SCREENSHOTS=<dir>:
//   SCREENSHOTS=/tmp/shots ./scripts/admin-e2e.sh e2e/screenshots.spec.ts
import { test } from '@playwright/test'

const dir = process.env.SCREENSHOTS
test.skip(!dir, 'set SCREENSHOTS=<dir> to capture')

const pages = ['/login', '/', '/topics', '/topics/2', '/logs', '/logs/E-1000']
for (const scheme of ['light', 'dark'] as const) {
  for (const [device, viewport] of [
    ['desktop', { width: 1280, height: 900 }],
    ['phone', { width: 390, height: 844 }],
  ] as const) {
    test(`${scheme} ${device}`, async ({ browser }) => {
      const context = await browser.newContext({ viewport, colorScheme: scheme, hasTouch: device === 'phone' })
      const page = await context.newPage()
      for (const path of pages) {
        if (path === '/') {
          await page.getByLabel('Password').fill(process.env.E2E_PASSWORD ?? '')
          await page.getByRole('button', { name: 'Sign in' }).click()
          await page.getByRole('heading', { name: 'Overview' }).waitFor()
        } else {
          await page.goto(path)
          await page.locator('h1').first().waitFor()
        }
        const name = path === '/' ? 'overview' : path.slice(1).replaceAll('/', '-')
        await page.screenshot({ path: `${dir}/${scheme}-${device}-${name}.png`, fullPage: true })
      }
      await context.close()
    })
  }
}
