// The admin panel in a real browser, against a real herbot-core seeded with
// e2e/seed.sql. Run with scripts/admin-e2e.sh (or `make admin-e2e`).
import { expect, test, type Page } from '@playwright/test'

const PASSWORD = process.env.E2E_PASSWORD ?? ''

/** Fails the test on any console error or uncaught exception (hydration
 * mismatches included), so "it rendered" also means "it rendered cleanly". */
function watchConsole(page: Page): string[] {
  const problems: string[] = []
  page.on('console', (m) => m.type() === 'error' && problems.push(m.text()))
  page.on('pageerror', (e) => problems.push(e.message))
  return problems
}

/** A link in the sidebar (other links on a page can share its words). */
function nav(page: Page, name: string) {
  return page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name, exact: true })
}

async function signIn(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible()
}

test.describe.configure({ mode: 'serial' })

test('signing in: locked out first, wrong password explained, right one gets in', async ({ page }) => {
  const problems = watchConsole(page)
  await page.goto('/topics')
  await expect(page).toHaveURL(/\/login$/)

  const field = page.getByLabel('Password')
  await expect(field).toBeFocused() // desktop: focused for you
  await field.fill('not-the-password')
  await page.keyboard.press('Enter') // Enter submits
  await expect(page.getByText('Wrong password. Try again.')).toBeVisible()
  await expect(field).toHaveAttribute('aria-invalid', 'true')

  await field.fill(PASSWORD)
  await expect(field).not.toHaveAttribute('aria-invalid', 'true') // clears once you fix it
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible()
  expect(problems).toEqual([])
})

test('overview shows the numbers and the last error', async ({ page }) => {
  const problems = watchConsole(page)
  await signIn(page)
  const stats = page.getByTestId('stat')
  await expect(stats.first()).toContainText('Topics answering')
  await expect(stats.first().locator('dd')).toHaveText('3 of 3 topics')
  await expect(stats.nth(2).locator('dd')).toHaveText('3')
  await expect(page.getByRole('link', { name: 'E-1001' })).toBeVisible()
  await expect(page.getByText('Telegram refused the reply: message is too long')).toBeVisible()
  expect(problems).toEqual([])
})

test('a page loaded directly is rendered on the server with its data', async ({ page, request }) => {
  await signIn(page)
  const cookies = await page.context().cookies()
  const html = await (
    await request.get('/topics', { headers: { cookie: cookies.map((c) => `${c.name}=${c.value}`).join('; ') } })
  ).text()
  expect(html).toContain('Herbot HQ › Research')
  expect(html).toContain('Rust MCP research and comparisons')
})

test('topics list links to each agent', async ({ page }) => {
  const problems = watchConsole(page)
  await signIn(page)
  await nav(page, 'Topics').click()
  const rows = page.locator('tbody tr')
  await expect(rows).toHaveCount(3)
  await expect(rows.nth(0)).toContainText('Herbot HQ › General')
  await expect(rows.nth(2)).toContainText('Asking its purpose')
  await page.getByRole('link', { name: 'Herbot HQ › Research' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Herbot HQ › Research' })).toBeVisible()
  await expect(page.getByText('rmcp is the official SDK and the best maintained.')).toBeVisible()
  expect(problems).toEqual([])
})

test('purpose: checked next to the field, saved with ⌘/Ctrl+Enter, AGENTS.md rewritten', async ({ page }) => {
  const problems = watchConsole(page)
  await signIn(page)
  await page.goto('/topics/2')
  const purpose = page.getByLabel('What this agent is for')
  await expect(purpose).toHaveValue('Rust MCP research and comparisons')
  await expect(page.getByRole('button', { name: 'Save purpose' })).toBeDisabled() // nothing changed yet

  await purpose.fill('Too short')
  await page.getByRole('button', { name: 'Save purpose' }).click()
  await expect(page.getByText('Describe the purpose in at least 3 words')).toBeVisible()
  await expect(purpose).toHaveAttribute('aria-invalid', 'true')

  await purpose.fill('Research Rust crates and compare them honestly')
  await expect(page.getByText('Describe the purpose in at least 3 words')).toHaveCount(0)
  await purpose.press('ControlOrMeta+Enter')
  await expect(page.getByText('Purpose saved. AGENTS.md was rewritten.')).toBeVisible()
  await expect(page.getByLabel('AGENTS.md contents')).toContainText('Research Rust crates and compare them honestly')

  // The list picked it up without a reload.
  await nav(page, 'Topics').click()
  await expect(page.locator('tbody tr').nth(1)).toContainText('Research Rust crates and compare them honestly')
  expect(problems).toEqual([])
})

test('turning a topic off flips at once and sticks', async ({ page }) => {
  const problems = watchConsole(page)
  await signIn(page)
  await page.goto('/topics/3')
  const toggle = page.getByRole('switch', { name: /Answer messages here/ })
  await expect(toggle).toBeChecked()
  await page.getByText('Answer messages here').click() // the whole row is the hit area
  await expect(toggle).not.toBeChecked()
  await expect(page.getByText('Off. Herbot stores nothing here and stays silent.')).toBeVisible()
  await expect(page.locator('header [data-slot=badge]')).toHaveText('Off')

  await page.reload()
  await expect(page.getByRole('switch', { name: /Answer messages here/ })).not.toBeChecked()
  await page.goto('/')
  await expect(page.getByTestId('stat').first().locator('dd')).toHaveText('2 of 3 topics')
  expect(problems).toEqual([])
})

test('wiping a chat asks first, then clears its messages', async ({ page }) => {
  const problems = watchConsole(page)
  await signIn(page)
  await page.goto('/topics/2')
  await page.getByRole('button', { name: 'Wipe the chat…' }).click()
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toContainText('This can’t be undone.')
  await expect(dialog.getByRole('button', { name: 'Keep everything' })).toBeFocused() // Enter can't wipe by accident
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(page.getByText('rmcp is the official SDK and the best maintained.')).toBeVisible()

  await page.getByRole('button', { name: 'Wipe the chat…' }).click()
  await page.getByRole('button', { name: 'Yes, wipe the chat' }).click()
  await expect(page.locator('[data-sonner-toast]')).toBeVisible()
  await expect(page.getByText('Nothing stored yet.')).toBeVisible()
  // The purpose stays after /new.
  await expect(page.getByLabel('What this agent is for')).toHaveValue('Research Rust crates and compare them honestly')
  expect(problems).toEqual([])
})

test('logs: search as you type, open an error, copy its id', async ({ page, context }) => {
  const problems = watchConsole(page)
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await signIn(page)
  await nav(page, 'Logs').click()
  await expect(page.locator('tbody tr')).toHaveCount(2)

  await page.getByLabel('Search errors').fill('codex exited')
  await expect(page).toHaveURL(/q=codex/)
  await expect(page.locator('tbody tr')).toHaveCount(1)
  await expect(page.locator('tbody tr')).toContainText('E-1000')

  await page.getByLabel('Search errors').fill('nothing like this')
  await expect(page.getByText('Nothing matches “nothing like this”.')).toBeVisible()
  await page.getByRole('button', { name: 'Clear the search' }).click()
  await expect(page.locator('tbody tr')).toHaveCount(2)

  await page.getByRole('link', { name: 'E-1000' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'E-1000' })).toBeVisible()
  await expect(page.getByLabel('Error context as JSON')).toContainText('"exit": 1')
  await page.getByRole('button', { name: 'Copy id' }).click()
  await expect(page.getByRole('button', { name: 'Copied' })).toBeVisible()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('E-1000')
  expect(problems).toEqual([])
})

test('a missing topic or error says so instead of breaking', async ({ page }) => {
  await signIn(page)
  await page.goto('/topics/nope')
  await expect(page.getByRole('heading', { name: 'Nothing here' })).toBeVisible()
  await page.goto('/logs/E-999999')
  await expect(page.getByRole('heading', { name: 'This page didn’t load' })).toBeVisible()
  await expect(page.getByText('no error E-999999')).toBeVisible()
})

test('signing out, or losing the cookie, goes back to sign in', async ({ page, context }) => {
  await signIn(page)
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page).toHaveURL(/\/login$/)
  await page.goto('/')
  await expect(page).toHaveURL(/\/login$/)

  await signIn(page)
  await page.goto('/topics/2')
  await context.clearCookies()
  await page.getByLabel('What this agent is for').fill('A purpose saved after the session ended')
  await page.getByRole('button', { name: 'Save purpose' }).click()
  await expect(page).toHaveURL(/\/login$/)
})

test('phone: no sideways scroll, every control at least 44px tall', async ({ browser }) => {
  const phone = await browser.newContext({ viewport: { width: 375, height: 740 }, hasTouch: true, isMobile: true })
  const page = await phone.newPage()
  await signIn(page)
  for (const path of ['/', '/topics/2', '/logs']) {
    await page.goto(path)
    await expect(page.locator('main h1')).toBeVisible()
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow, path).toBeLessThanOrEqual(0)
    const small = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('button:not([role=switch]), nav[aria-label=Main] a, input')]
        .filter((el) => el.offsetParent !== null && el.getBoundingClientRect().height < 44)
        .map((el) => `${el.tagName} "${el.textContent?.trim()}" ${el.getBoundingClientRect().height}px`),
    )
    expect(small, path).toEqual([])
  }
  // The switch draws 24px tall but takes taps 12px around it.
  await page.goto('/topics/3')
  const box = (await page.getByRole('switch').boundingBox())!
  const hit = await page.evaluate(
    ([x, y]) => document.elementFromPoint(x, y)?.getAttribute('role'),
    [box.x + box.width / 2, box.y - 10],
  )
  expect(hit).toBe('switch')
  await phone.close()
})
