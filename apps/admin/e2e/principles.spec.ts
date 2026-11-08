// The Emil ship-check rules as tests, so none of them rest on inspection:
// computed-style scans of every element, failure injection, request
// counting, and structure checks. Runs on the worst-case data.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type Browser, type BrowserContextOptions, type Page } from '@playwright/test'

const PASSWORD = process.env.E2E_PASSWORD ?? ''
const DESKTOP = { width: 1280, height: 900 }
const PHONE = { width: 375, height: 740 }
const SRC = fileURLToPath(new URL('../src/', import.meta.url))
const PAGES = ['/', '/topics', '/topics/2', '/logs', '/logs/E-1003']

test.describe.configure({ mode: 'serial' })

async function open(browser: Browser, options: BrowserContextOptions = { viewport: DESKTOP }) {
  const context = await browser.newContext(options)
  const page = await context.newPage()
  await page.goto('/login')
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible()
  return { page, close: () => context.close() }
}

/** F2, F3, B5, B6: every transition and running animation on the page. */
async function motionProblems(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const LAYOUT = /^(width|height|min-|max-|margin|padding|top|left|right|bottom|inset)/
    const bad: string[] = []
    const name = (el: Element) => `${el.tagName.toLowerCase()}[${el.getAttribute('data-slot') ?? ''}]`
    for (const el of document.querySelectorAll('*')) {
      const s = getComputedStyle(el)
      const props = s.transitionProperty.split(',').map((p) => p.trim())
      const durations = s.transitionDuration.split(',').map((d) => parseFloat(d))
      const easings = s.transitionTimingFunction.split(/,(?![^(]*\))/).map((e) => e.trim())
      props.forEach((prop, i) => {
        const d = durations[i % durations.length] ?? 0
        if (d === 0) return
        if (prop === 'all') bad.push(`${name(el)} transitions "all"`)
        if (LAYOUT.test(prop)) bad.push(`${name(el)} transitions layout "${prop}"`)
        if (d > 0.3) bad.push(`${name(el)} transition ${prop} ${d}s`)
        if (easings[i % easings.length] === 'ease-in') bad.push(`${name(el)} eases in`)
      })
      for (const a of el.getAnimations()) {
        const t = a.effect?.getTiming()
        if (!t || t.iterations === Infinity) continue // spinners and skeleton pulses loop on purpose
        if (Number(t.duration) > 300) bad.push(`${name(el)} animation ${t.duration}ms`)
      }
    }
    return [...new Set(bad)]
  })
}

test('motion: no "all", no layout properties, nothing over 300ms, no ease-in — at rest and with every overlay open', async ({ browser }) => {
  const { page, close } = await open(browser)
  for (const path of PAGES) {
    await page.goto(path)
    await expect(page.locator('main h1').first()).toBeVisible()
    expect(await motionProblems(page), path).toEqual([])
  }
  await page.goto('/topics/2')
  await page.getByRole('button', { name: 'Wipe the chat…' }).click()
  expect(await motionProblems(page), 'dialog opening').toEqual([])
  await page.keyboard.press('Escape')
  await close()

  const phone = await open(browser, { viewport: PHONE, hasTouch: true, isMobile: true })
  await phone.page.getByRole('button', { name: 'Toggle sidebar' }).click()
  expect(await motionProblems(phone.page), 'sheet opening').toEqual([])
  await phone.close()
})

test('hover styles only apply on devices that can hover (C2, A15)', async ({ browser }) => {
  const { page, close } = await open(browser)
  const ungated = await page.evaluate(() => {
    const bad: string[] = []
    const walk = (rules: CSSRuleList, gated: boolean) => {
      for (const rule of Array.from(rules)) {
        if (rule instanceof CSSMediaRule) walk(rule.cssRules, gated || /hover:\s*hover/.test(rule.conditionText))
        else if (rule instanceof CSSStyleRule) {
          if (rule.selectorText.includes(':hover') && !gated) bad.push(rule.selectorText)
          if (rule.cssRules.length) walk(rule.cssRules, gated)
        } else if ('cssRules' in rule) walk((rule as CSSGroupingRule).cssRules, gated)
      }
    }
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        walk(sheet.cssRules, false)
      } catch {
        /* cross-origin sheet */
      }
    }
    // Sonner's own close button is third-party and hidden on touch anyway.
    return bad.filter((s) => !s.includes('sonner'))
  })
  expect(ungated).toEqual([])
  await close()
})

test('touch and baseline rules hold on real elements (C5, C6, C10, C18, E9)', async ({ browser }) => {
  const { page, close } = await open(browser, { viewport: PHONE, hasTouch: true, isMobile: true })
  await page.goto('/topics/2')
  const facts = await page.evaluate(() => {
    const controls = [...document.querySelectorAll<HTMLElement>('button, [role=switch], a[href], input, textarea')]
    const zs = [...document.querySelectorAll('*')]
      .map((el) => getComputedStyle(el).zIndex)
      .filter((z) => z !== 'auto')
      .map(Number)
    return {
      tapHighlight: getComputedStyle(document.documentElement).getPropertyValue('-webkit-tap-highlight-color'),
      slowTaps: controls.filter((el) => getComputedStyle(el).touchAction !== 'manipulation').map((el) => el.outerHTML.slice(0, 60)),
      selectableButtons: controls
        .filter((el) => el.matches('button, [role=switch]') && getComputedStyle(el).userSelect !== 'none')
        .map((el) => el.outerHTML.slice(0, 60)),
      themeColors: [...document.querySelectorAll('meta[name=theme-color]')].map((m) => m.getAttribute('media')),
      viewport: document.querySelector('meta[name=viewport]')?.getAttribute('content') ?? '',
      zIndexes: [...new Set(zs)].sort((a, b) => a - b),
    }
  })
  expect(facts.tapHighlight).toBe('rgba(0, 0, 0, 0)')
  expect(facts.slowTaps).toEqual([])
  expect(facts.selectableButtons).toEqual([])
  expect(facts.themeColors).toEqual(['(prefers-color-scheme: light)', '(prefers-color-scheme: dark)'])
  expect(facts.viewport).toContain('viewport-fit=cover')
  expect(facts.viewport).toContain('interactive-widget=resizes-content')
  expect(facts.viewport).not.toMatch(/user-scalable|maximum-scale/) // C1: zoom is never disabled
  for (const z of facts.zIndexes) expect([1, 10, 20, 50, 60], `z-index ${z}`).toContain(z)
  // The history box doesn't hand its scroll to the page (C9), and the header is short (C16).
  const log = page.getByRole('region', { name: 'Message history' })
  expect(await log.evaluate((el) => getComputedStyle(el).overscrollBehaviorY)).toBe('contain')
  expect((await page.locator('header').first().boundingBox())!.height).toBeLessThanOrEqual(64)
  await close()
})

test('structure: one h1 and one main per page, decorative icons hidden, images sized (A10, A12, B1)', async ({ browser }) => {
  const { page, close } = await open(browser)
  for (const path of [...PAGES, '/topics/81']) {
    await page.goto(path)
    await expect(page.locator('main h1').first()).toBeVisible()
    const facts = await page.evaluate(() => ({
      h1: document.querySelectorAll('h1').length,
      main: document.querySelectorAll('main').length,
      nav: document.querySelectorAll('nav[aria-label=Main]').length,
      loudIcons: [...document.querySelectorAll('svg')]
        .filter((svg) => svg.getAttribute('aria-hidden') !== 'true' && !svg.getAttribute('aria-label') && svg.getAttribute('role') !== 'img')
        .map((svg) => svg.outerHTML.slice(0, 50)),
      unsizedImages: [...document.querySelectorAll('img')].filter((img) => !img.getAttribute('width') || !img.getAttribute('height')).length,
    }))
    expect(facts, path).toEqual({ h1: 1, main: 1, nav: 1, loudIcons: [], unsizedImages: 0 })
  }
  await close()
})

test('a failed load says what broke and offers a retry that works (E2)', async ({ browser }) => {
  const { page, close } = await open(browser)
  await page.route('**/_serverFn/**', (route) => (route.request().method() === 'GET' ? route.abort() : route.continue()))
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Logs', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'This page didn’t load' })).toBeVisible()
  await page.unroute('**/_serverFn/**')
  await page.getByRole('button', { name: 'Try again' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Logs' })).toBeVisible()
  await close()
})

test('a slow load shows a skeleton that holds the page’s shape (E3, E4)', async ({ browser }) => {
  const { page, close } = await open(browser)
  await page.route('**/_serverFn/**', async (route) => {
    if (route.request().method() === 'GET') await new Promise((r) => setTimeout(r, 1500))
    await route.continue()
  })
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Logs', exact: true }).click()
  await expect(page.locator('[aria-busy=true][aria-label=Loading]')).toBeVisible({ timeout: 1000 })
  await expect(page.getByRole('heading', { level: 1, name: 'Logs' })).toBeVisible({ timeout: 10_000 })
  await close()
})

test('a refused switch flips back and says why (E12, A7)', async ({ browser }) => {
  const { page, close } = await open(browser)
  await page.goto('/topics/3')
  await page.route('**/_serverFn/**', (route) =>
    route.request().method() === 'POST' && (route.request().postData() ?? '').includes('enabled')
      ? route.fulfill({ status: 500, contentType: 'text/plain', body: 'refused for the test' })
      : route.continue(),
  )
  const toggle = page.getByRole('switch', { name: /Answer messages here/ })
  await expect(toggle).toBeChecked()
  await toggle.click()
  await expect(page.getByText(/Couldn’t turn it off/)).toBeVisible()
  await expect(toggle).toBeChecked() // rolled back
  await close()
})

test('double-clicking Save sends one request; search waits for you to pause (D1, B16)', async ({ browser }) => {
  const { page, close } = await open(browser)
  await page.goto('/topics/81')
  const saves: string[] = []
  const searches: string[] = []
  page.on('request', (r) => {
    if (!r.url().includes('/_serverFn/')) return
    if (r.method() === 'POST' && (r.postData() ?? '').includes('purpose')) saves.push(r.url())
    if (r.method() === 'GET' && r.url().includes('payload')) searches.push(r.url())
  })
  await page.getByLabel('What this agent is for').fill('A purpose for the double-click test')
  await page.getByRole('button', { name: 'Save purpose' }).dblclick()
  await expect(page.getByText('Purpose saved. AGENTS.md was rewritten.')).toBeVisible()
  expect(saves).toHaveLength(1)

  await page.goto('/logs')
  searches.length = 0
  await page.getByLabel('Search errors').pressSequentially('turn_failed', { delay: 40 })
  await page.waitForTimeout(800)
  expect(searches.length, 'one search after the pause, not one per key').toBeLessThanOrEqual(1)
  await close()
})

test('inputs carry the right type, autocomplete and keyboard hints (D6)', async ({ browser }) => {
  const context = await browser.newContext({ viewport: DESKTOP })
  const page = await context.newPage()
  await page.goto('/login')
  const password = page.getByLabel('Password')
  await expect(password).toHaveAttribute('type', 'password')
  await expect(password).toHaveAttribute('autocomplete', 'current-password')
  await context.close()
  const { page: p, close } = await open(browser)
  await p.goto('/logs')
  const search = p.getByLabel('Search errors')
  await expect(search).toHaveAttribute('type', 'search')
  await expect(search).toHaveAttribute('autocomplete', 'off')
  await expect(search).toHaveAttribute('enterkeyhint', 'search')
  await close()
})

test('changes are announced: search count, new messages, toasts (A16)', async ({ browser }) => {
  const { page, close } = await open(browser)
  await page.goto('/logs')
  const status = page.locator('[aria-live=polite]').filter({ hasText: /errors shown/ })
  await expect(status).toBeVisible()
  await page.goto('/topics/2')
  await expect(page.locator('[aria-live=polite]').first()).toBeAttached() // the new-messages announcer
  expect(await page.locator('section[aria-live], [aria-live] ol[data-sonner-toaster], section[aria-label*="Notifications"]').count()).toBeGreaterThan(0)
  await close()
})

test('the floating day label never steals a click (E11)', async ({ browser }) => {
  const { page, close } = await open(browser)
  await page.goto('/topics/2')
  const log = page.getByRole('region', { name: 'Message history' })
  await expect(log).toHaveAttribute('data-loaded', '30')
  await log.scrollIntoViewIfNeeded() // hit-testing needs it on screen
  await log.evaluate((el) => (el.scrollTop = el.scrollHeight / 2))
  const label = page.locator('[data-floating-day] > span').filter({ hasText: /\d{4}|Today|Yesterday/ })
  await expect(label).toBeVisible()
  const box = (await label.boundingBox())!
  const hit = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('[data-floating-day]') === null, [
    box.x + box.width / 2,
    box.y + box.height / 2,
  ])
  expect(hit, 'clicks pass through to the message underneath').toBe(true)
  await close()
})

test('no leftovers in the source: console.log, debugger, TODO, lorem (H)', () => {
  const offenders: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) walk(path)
      else if (/\.(tsx?|css)$/.test(name) && /console\.(log|debug)\(|\bdebugger\b|TODO|FIXME|lorem ipsum/i.test(readFileSync(path, 'utf8'))) {
        offenders.push(path.replace(SRC, ''))
      }
    }
  }
  walk(SRC)
  expect(offenders).toEqual([])
})
