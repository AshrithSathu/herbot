// A read-only walk through the REAL panel and live data. It never saves,
// toggles or wipes anything. Runs only when asked:
//   E2E_LIVE=1 E2E_BASE_URL=http://127.0.0.1:3300 E2E_PASSWORD=… pnpm exec playwright test e2e/live.spec.ts
import { expect, test, type Page } from '@playwright/test'

test.skip(!process.env.E2E_LIVE, 'set E2E_LIVE=1 to walk the live panel')

async function overflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
}

for (const scheme of ['light', 'dark'] as const) {
  test(`live panel, read-only, ${scheme}`, async ({ browser }) => {
    test.setTimeout(120_000)
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: scheme })
    const page = await context.newPage()
    const problems: string[] = []
    page.on('console', (m) => m.type() === 'error' && problems.push(m.text()))
    page.on('pageerror', (e) => problems.push(e.message))
    // Watch every request: a read-only walk must never send a write.
    const writes: string[] = []
    page.on('request', (r) => {
      if (r.method() !== 'GET' && !r.url().includes('/_serverFn/')) writes.push(`${r.method()} ${r.url()}`)
    })

    await page.goto('/login')
    await page.getByLabel('Password').fill(process.env.E2E_PASSWORD ?? '')
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible()
    await expect(page.getByTestId('stat')).toHaveCount(4)
    expect(await overflow(page)).toBeLessThanOrEqual(0)

    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Topics', exact: true }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Topics' })).toBeVisible()
    const topicCount = await page.locator('tbody tr').count()
    expect(topicCount).toBeGreaterThan(0)

    // Every agent, from the sidebar.
    const agents = page.locator('[data-sidebar=content] a[href^="/topics/"]')
    const hrefs = await agents.evaluateAll((links) => links.map((a) => a.getAttribute('href')!))
    expect(hrefs.length).toBe(topicCount)
    for (const href of hrefs) {
      await page.locator(`[data-sidebar=content] a[href="${href}"]`).click()
      await expect(page).toHaveURL(new RegExp(`${href}$`))
      await expect(page.getByRole('heading', { name: 'Purpose' })).toBeVisible()
      const log = page.getByRole('region', { name: 'Message history' })
      if ((await log.count()) > 0) {
        await expect(page.locator('[data-message-id]').last()).toBeVisible()
        await expect.poll(() => log.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThan(2)
        // Older history loads in place, if there is any.
        const before = Number(await log.getAttribute('data-loaded'))
        await log.evaluate((el) => (el.scrollTop = 0))
        await page.waitForTimeout(400)
        expect(Number(await log.getAttribute('data-loaded'))).toBeGreaterThanOrEqual(before)
      }
      expect(await overflow(page), href).toBeLessThanOrEqual(0)
    }

    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Logs', exact: true }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Logs' })).toBeVisible()
    const firstError = page.locator('tbody tr a').first()
    if ((await firstError.count()) > 0) {
      await firstError.click()
      await expect(page.getByLabel('Error context as JSON')).toBeVisible()
    }
    expect(await overflow(page)).toBeLessThanOrEqual(0)

    await page.getByRole('button', { name: 'Sign out' }).click()
    await expect(page).toHaveURL(/\/login$/)
    expect(problems).toEqual([])
    expect(writes).toEqual([])
    console.log(`live ${scheme}: ${hrefs.length} agents walked`)
    await context.close()
  })
}
