// The admin panel at its worst: 128-character names with unbroken words,
// 8,000-character purposes, 600 messages of every awkward shape, 250,000
// messages in one topic, 82 topics, 130 errors with 20 KB contexts.
// Seeded from e2e/seed-stress.sql by scripts/admin-e2e.sh.
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { expect, test, type Browser, type Locator, type Page } from '@playwright/test'

const PASSWORD = process.env.E2E_PASSWORD ?? ''
const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const DESKTOP = { width: 1280, height: 900 }
const PHONE = { width: 375, height: 740 }

test.describe.configure({ mode: 'serial' })

/** Runs SQL against the e2e database, to make things happen "in Telegram". */
function sql(statement: string) {
  execFileSync('docker', [
    'compose', '-f', `${ROOT}docker-compose.yml`, 'exec', '-T', 'postgres',
    'psql', '-q', '-v', 'ON_ERROR_STOP=1', '-U', 'herbot', '-d', process.env.E2E_DB ?? 'herbot_e2e', '-c', statement,
  ])
}

async function signIn(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible()
}

async function open(browser: Browser, size: { width: number; height: number }, touch = false) {
  const context = await browser.newContext({ viewport: size, hasTouch: touch, isMobile: touch })
  const page = await context.newPage()
  const problems: string[] = []
  page.on('console', (m) => m.type() === 'error' && problems.push(m.text()))
  page.on('pageerror', (e) => problems.push(e.message))
  await signIn(page)
  return { page, problems, close: () => context.close() }
}

/** Anything that sticks out past the page's right edge, unless a scrolling
 * or clipping box inside the page contains it. */
async function overflowing(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = []
    if (document.documentElement.scrollWidth > window.innerWidth) {
      out.push(`page scrolls sideways by ${document.documentElement.scrollWidth - window.innerWidth}px`)
    }
    const main = document.querySelector<HTMLElement>('[data-slot=sidebar-inset]') ?? document.body
    const limit = main.getBoundingClientRect().right + 1
    for (const el of main.querySelectorAll<HTMLElement>('*')) {
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.right <= limit) continue
      let clipped = false
      for (let p = el.parentElement; p && p !== main; p = p.parentElement) {
        if (/(auto|scroll|hidden|clip)/.test(getComputedStyle(p).overflowX) && p.getBoundingClientRect().right <= limit) {
          clipped = true
          break
        }
      }
      if (!clipped) out.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 50)} +${Math.round(r.right - limit)}px`)
    }
    return out.slice(0, 8)
  })
}

const messages = (log: Locator) => log.locator('[data-message-id]')
const atBottom = (log: Locator) =>
  log.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight < 2)

test('every page fits on desktop and phone with worst-case data', async ({ browser }) => {
  for (const [size, touch] of [[DESKTOP, false], [PHONE, true]] as const) {
    const { page, problems, close } = await open(browser, size, touch)
    for (const path of ['/', '/topics', '/topics/2', '/topics/3', '/topics/81', '/logs', '/logs/E-1000', '/logs/E-1003']) {
      await page.goto(path)
      await expect(page.locator('main h1').first()).toBeVisible()
      await page.waitForLoadState('networkidle')
      expect(await overflowing(page), `${path} at ${size.width}px`).toEqual([])
    }
    expect(problems).toEqual([])
    await close()
  }
})

test('six-figure counts stay inside their cards, with the exact number on hover', async ({ browser }) => {
  for (const size of [DESKTOP, PHONE]) {
    const { page, close } = await open(browser, size)
    const messagesStat = page.getByTestId('stat').filter({ hasText: 'Messages stored' }).locator('[data-slot=card-title]')
    await expect(messagesStat).toHaveText('250.6K')
    await expect(messagesStat).toHaveAttribute('title', '250,600')
    await expect(page.getByTestId('stat').first().locator('[data-slot=card-title]')).toHaveText('67 of 82 topics')
    for (const title of await page.locator('[data-testid=stat] [data-slot=card-title]').all()) {
      expect(await title.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
    }
    await page.goto('/topics')
    await expect(page.getByRole('row', { name: /Firehose/ }).getByTitle('250,000')).toHaveText('250K')
    await close()
  }
})

test('the chat log stays in its box and opens at the newest message', async ({ browser }) => {
  for (const size of [DESKTOP, PHONE]) {
    const { page, problems, close } = await open(browser, size, size === PHONE)
    await page.goto('/topics/2')
    const log = page.getByRole('region', { name: 'Message history' })
    await expect(messages(log)).toHaveCount(30)
    await expect(messages(log).last()).toHaveAttribute('data-message-id', '600')
    expect(await atBottom(log)).toBe(true)
    const box = (await log.boundingBox())!
    expect(box.height).toBeLessThanOrEqual(Math.min(576, size.height * 0.65) + 2)
    // 600 messages, yet the page is no taller than with 6.
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThan(size === PHONE ? 3600 : 2600)
    expect(problems).toEqual([])
    await close()
  }
})

test('scrolling up loads older pages, keeps your place, and reaches the start', async ({ browser }) => {
  const { page, close } = await open(browser, DESKTOP)
  await page.goto('/topics/2')
  const log = page.getByRole('region', { name: 'Message history' })
  await expect(messages(log)).toHaveCount(30)

  await log.evaluate((el) => (el.scrollTop = 0))
  await expect(messages(log)).toHaveCount(60)
  // What was at the top is still in view: the older page went in above it.
  const kept = (await log.locator('[data-message-id="571"]').boundingBox())!
  const frame = (await log.boundingBox())!
  expect(kept.y).toBeGreaterThanOrEqual(frame.y - 1)
  expect(kept.y).toBeLessThan(frame.y + frame.height)

  for (let i = 0; i < 25 && (await log.getByText('Start of this conversation').count()) === 0; i++) {
    const before = await messages(log).count()
    await log.evaluate((el) => (el.scrollTop = 0))
    await expect.poll(() => messages(log).count()).toBeGreaterThan(before)
  }
  await expect(log.getByText('Start of this conversation')).toBeVisible()
  await expect(messages(log)).toHaveCount(600)
  await expect(messages(log).first()).toHaveAttribute('data-message-id', '1')
  // A week of history is split by day, and the labels say which day.
  expect(await log.getByRole('separator').count()).toBeGreaterThanOrEqual(6)
  await expect(log.getByRole('separator').last()).toHaveAccessibleName(/Today|Yesterday/)
  await close()
})

test('long and awkward messages are clamped, wrapped, and always readable', async ({ browser }) => {
  for (const size of [DESKTOP, PHONE]) {
    const { page, close } = await open(browser, size, size === PHONE)
    await page.goto('/topics/2')
    const log = page.getByRole('region', { name: 'Message history' })
    await expect(messages(log)).toHaveCount(30)
    await log.evaluate((el) => (el.scrollTop = 0))
    await expect(messages(log)).toHaveCount(60)
    const width = (await log.boundingBox())!.width

    // 4,000 characters: clamped to 12 lines, with Show more / Show less.
    const long = log.locator('[data-message-id="600"]')
    const text = long.locator('div[id]')
    const collapsed = (await text.boundingBox())!.height
    expect(collapsed).toBeLessThan(12 * 27)
    await long.getByRole('button', { name: 'Show more' }).click()
    await expect(long.getByRole('button', { name: 'Show less' })).toHaveAttribute('aria-expanded', 'true')
    expect((await text.boundingBox())!.height).toBeGreaterThan(collapsed * 1.5)
    await long.getByRole('button', { name: 'Show less' }).click()
    await expect.poll(async () => (await text.boundingBox())!.height).toBeLessThan(12 * 27)

    // 3,000 characters with no spaces, and a 1,000-character URL: wrapped inside.
    for (const id of ['557', '563']) {
      const bubble = log.locator(`[data-message-id="${id}"]`)
      expect((await bubble.boundingBox())!.width, id).toBeLessThanOrEqual(width)
    }
    // 200 blank lines are clamped too, and an empty message says so.
    await expect(log.locator('[data-message-id="559"]').getByRole('button', { name: 'Show more' })).toBeVisible()
    await expect(log.locator('[data-message-id="561"]')).toContainText('(no text)')
    await close()
  }
})

test('new messages arrive live: followed at the bottom, counted when you scrolled up', async ({ browser }) => {
  test.setTimeout(90_000)
  const { page, close } = await open(browser, DESKTOP)
  await page.goto('/topics/2')
  const log = page.getByRole('region', { name: 'Message history' })
  await expect(messages(log)).toHaveCount(30)

  sql("INSERT INTO messages (conversation_id, tg_message_id, from_tg_user_id, from_bot, body, sent_at) VALUES (2, 10001, 111, false, 'live one', now())")
  await expect(log.getByText('live one')).toBeVisible({ timeout: 25_000 })
  await expect.poll(() => atBottom(log)).toBe(true)

  await log.evaluate((el) => (el.scrollTop = el.scrollHeight / 2))
  const parked = await log.evaluate((el) => el.scrollTop)
  sql("INSERT INTO messages (conversation_id, tg_message_id, from_tg_user_id, from_bot, body, sent_at) VALUES (2, 10002, 999, true, 'live two', now())")
  const pill = page.getByRole('button', { name: '1 new message' })
  await expect(pill).toBeVisible({ timeout: 25_000 })
  expect(Math.abs((await log.evaluate((el) => el.scrollTop)) - parked)).toBeLessThan(2) // you weren't moved
  await pill.click()
  await expect(log.getByText('live two')).toBeInViewport()
  await expect(pill).toBeHidden()
  await close()
})

test('a purpose at the limit: 8,001 characters is refused by the field, 8,000 saves', async ({ browser }) => {
  const { page, close } = await open(browser, DESKTOP)
  await page.goto('/topics/2')
  const purpose = page.getByLabel('What this agent is for')
  const words = (n: number) => 'word '.repeat(Math.ceil(n / 5)).slice(0, n - 1) + 'z'

  await purpose.fill(words(8001))
  await expect(page.getByText('8,001 / 8,000')).toBeVisible()
  await page.getByRole('button', { name: 'Save purpose' }).click()
  await expect(page.getByText('Keep it under 8,000 characters. It’s 8,001 now.')).toBeVisible()
  await expect(purpose).toHaveAttribute('aria-invalid', 'true')
  expect((await purpose.boundingBox())!.height).toBeLessThanOrEqual(DESKTOP.height * 0.6 + 2)

  await purpose.fill(words(8000))
  await page.getByRole('button', { name: 'Save purpose' }).click()
  await expect(page.getByText('Purpose saved. AGENTS.md was rewritten.')).toBeVisible()
  const agentsMd = page.getByLabel('AGENTS.md contents')
  await expect(agentsMd).toContainText('word word')
  expect((await agentsMd.boundingBox())!.height).toBeLessThanOrEqual(448 + 2)
  expect(await agentsMd.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true) // it scrolls inside
  await close()
})

test('long names wrap or truncate, and the full name is always reachable', async ({ browser }) => {
  const { page, close } = await open(browser, DESKTOP)
  await page.goto('/topics/2')
  const place = await page.locator('main h1').first().innerText()
  expect(place).toContain('Supercalifragilisticexpialidocious')

  const crumb = page.getByRole('navigation', { name: 'breadcrumb' }).locator('[data-slot=breadcrumb-page]')
  expect(await crumb.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true) // truncated…
  expect((await crumb.getAttribute('title'))!.length).toBeGreaterThan(60) // …with the full name on hover

  const item = page.locator('[data-sidebar=menu-button][data-active=true]')
  await expect(item).toHaveAttribute('title', place)
  expect(await item.locator('span').evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)

  await page.getByRole('button', { name: 'Wipe the chat…' }).click()
  const dialog = page.getByRole('alertdialog')
  await expect(dialog.getByRole('heading')).toContainText('Supercalifragilisticexpialidocious')
  const box = (await dialog.boundingBox())!
  expect(box.x + box.width).toBeLessThanOrEqual(DESKTOP.width)
  expect(box.y + box.height).toBeLessThanOrEqual(DESKTOP.height)
  await page.keyboard.press('Escape')
  await close()
})

test('82 agents scroll inside the sidebar, and Sign out stays in view', async ({ browser }) => {
  const { page, close } = await open(browser, DESKTOP)
  await expect(page.locator('[data-sidebar=group-label]', { hasText: 'Agents' })).toBeVisible()
  const agents = page.locator('[data-sidebar=content] a[href^="/topics/"]')
  await expect(agents).toHaveCount(82)
  const content = page.locator('[data-sidebar=content]')
  expect(await content.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true)
  const signOut = (await page.getByRole('button', { name: 'Sign out' }).boundingBox())!
  expect(signOut.y + signOut.height).toBeLessThanOrEqual(DESKTOP.height)
  await close()
})

test('errors page 50 at a time, and huge errors stay readable', async ({ browser }) => {
  const { page, problems, close } = await open(browser, DESKTOP)
  await page.goto('/logs')
  const rows = page.locator('tbody tr')
  await expect(rows).toHaveCount(50)
  await expect(page.getByText('50 errors shown, newest first')).toBeVisible()
  await page.getByRole('button', { name: 'Load older errors' }).click()
  await expect(rows).toHaveCount(100)
  await page.getByRole('button', { name: 'Load older errors' }).click()
  await expect(rows).toHaveCount(130)
  await expect(page.getByRole('button', { name: 'Load older errors' })).toBeHidden()

  // A 150-character kind is cut to fit, with the whole kind on hover.
  const longRow = rows.filter({ has: page.locator('[data-slot=badge][title^="t3.turn_failed.deeply"]') }).first()
  const kind = longRow.locator('[data-slot=badge]')
  expect((await kind.getAttribute('title'))!.length).toBeGreaterThan(100)
  const cell = (await longRow.locator('td').first().boundingBox())!
  const badge = (await kind.boundingBox())!
  expect(badge.x + badge.width).toBeLessThanOrEqual(cell.x + cell.width + 1)
  // Messages are two lines at most in the list.
  for (const row of [rows.nth(0), rows.nth(1), rows.nth(2)]) {
    expect((await row.locator('td').nth(1).locator('span').boundingBox())!.height).toBeLessThanOrEqual(2 * 22)
  }

  // The detail shows everything, in a box that scrolls instead of the page.
  await page.goto('/logs/E-1002')
  const context = page.getByLabel('Error context as JSON')
  expect((await context.boundingBox())!.height).toBeLessThanOrEqual(448 + 2)
  // A 5,000-character message is cut to 10 lines, with the rest one tap away.
  const message = page.locator('main').getByText(/^error 3: the agent run failed/)
  await expect(message).toBeVisible()
  expect((await message.boundingBox())!.height).toBeLessThanOrEqual(10 * 28)
  await page.getByRole('button', { name: 'Show more' }).click()
  expect((await message.boundingBox())!.height).toBeGreaterThan(10 * 28)

  // A 250-character search is cut at 200, and the empty state stays short.
  await page.goto('/logs')
  const search = page.getByLabel('Search errors')
  await search.fill('q'.repeat(250))
  expect((await search.inputValue()).length).toBe(200)
  const empty = page.getByText(/^Nothing matches/)
  await expect(empty).toBeVisible()
  expect((await empty.innerText()).length).toBeLessThan(80)
  expect(problems).toEqual([])
  await close()
})
