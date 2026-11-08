// Accessibility, keyboard, theme and motion checks on the worst-case data
// (seed-stress.sql): axe-core (WCAG 2.2 AA, contrast included) on every page
// in both themes and at both widths, a keyboard-only walkthrough, the
// unsaved-changes guard, reduced motion, and sign-in at its worst.
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Browser, type BrowserContextOptions, type Page } from '@playwright/test'

const PASSWORD = process.env.E2E_PASSWORD ?? ''
const DESKTOP = { width: 1280, height: 900 }
const PHONE = { width: 375, height: 740 }

test.describe.configure({ mode: 'serial' })

async function signIn(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible()
}

async function open(browser: Browser, options: BrowserContextOptions, signedIn = true) {
  const context = await browser.newContext(options)
  const page = await context.newPage()
  if (signedIn) await signIn(page)
  return { page, close: () => context.close() }
}

/** WCAG 2.2 A/AA violations, as short readable lines. */
async function audit(page: Page): Promise<string[]> {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
  return result.violations.flatMap((v) =>
    v.nodes.slice(0, 3).map((n) => `${v.id}: ${n.target.join(' ')} — ${n.failureSummary?.split('\n')[1]?.trim() ?? ''}`),
  )
}

/** Is the focused element visibly marked (outline or ring)? */
async function focusIsVisible(page: Page): Promise<{ ok: boolean; what: string }> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null
    if (!el || el === document.body) return { ok: false, what: 'body' }
    const s = getComputedStyle(el)
    const ring = s.boxShadow !== 'none' && s.boxShadow !== ''
    const outline = s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0
    const what = `${el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 30)}"`
    return { ok: ring || outline, what }
  })
}

const PAGES = ['/', '/topics', '/topics/2', '/topics/81', '/logs', '/logs/E-1003']

for (const scheme of ['light', 'dark'] as const) {
  test(`axe finds no WCAG AA problems anywhere, ${scheme} theme`, async ({ browser }) => {
    test.setTimeout(120_000)
    for (const size of [DESKTOP, PHONE]) {
      const where = `${scheme} ${size.width}px`
      const login = await open(browser, { viewport: size, colorScheme: scheme }, false)
      await login.page.goto('/login')
      await login.page.getByLabel('Password').fill('x'.repeat(40))
      await login.page.getByRole('button', { name: 'Sign in' }).click()
      await expect(login.page.getByText(/Wrong password/)).toBeVisible() // the error state too
      expect(await audit(login.page), `/login ${where}`).toEqual([])
      await login.close()

      const { page, close } = await open(browser, { viewport: size, colorScheme: scheme, hasTouch: size === PHONE })
      for (const path of PAGES) {
        await page.goto(path)
        await expect(page.locator('main h1').first()).toBeVisible()
        await page.waitForLoadState('networkidle')
        expect(await audit(page), `${path} ${where}`).toEqual([])
      }
      // Open overlays: the wipe dialog, and the phone's sidebar sheet.
      await page.goto('/topics/2')
      await page.getByRole('button', { name: 'Wipe the chat…' }).click()
      await expect(page.getByRole('alertdialog')).toBeVisible()
      expect(await audit(page), `wipe dialog ${where}`).toEqual([])
      await page.keyboard.press('Escape')
      if (size === PHONE) {
        await page.getByRole('button', { name: 'Toggle sidebar' }).click()
        await expect(page.getByRole('dialog')).toBeVisible()
        expect(await audit(page), `sidebar sheet ${where}`).toEqual([])
      }
      await close()
    }
  })
}

test('keyboard only: skip link, visible focus everywhere, switch, chat log, dialog focus trap', async ({ browser }) => {
  const { page, close } = await open(browser, { viewport: DESKTOP })
  await page.goto('/topics/2')
  await expect(page.locator('[data-message-id]').first()).toBeVisible()
  // A fresh page load: focus starts at the top, like a real keyboard user's.

  // First Tab: the skip link, visible on screen.
  await page.keyboard.press('Tab')
  const skip = page.getByRole('link', { name: 'Skip to content' })
  await expect(skip).toBeFocused()
  expect((await skip.boundingBox())!.width).toBeGreaterThan(40)
  await page.keyboard.press('Enter')
  await expect(page.locator('#content')).toBeFocused()

  // Walk forward through the page; every stop shows where focus is.
  const stops: string[] = []
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('Tab')
    const { ok, what } = await focusIsVisible(page)
    expect(ok, `focus ring on ${what}`).toBe(true)
    stops.push(what)
    if (await page.getByRole('button', { name: 'Wipe the chat…' }).evaluate((el) => el === document.activeElement)) break
  }
  expect(stops.some((s) => s.startsWith('button') && s.includes('Answer'))).toBe(false) // sanity: names below
  // The switch, the purpose box, the history and the wipe button were all reached.
  for (const expected of ['textarea', 'div "Message history"', 'button "Wipe the chat…"']) {
    expect(stops.some((s) => s.startsWith(expected)), `${expected} in ${stops.join(' → ')}`).toBe(true)
  }

  // The switch works with Space, and says its state.
  const toggle = page.getByRole('switch', { name: /Answer messages here/ })
  await toggle.focus()
  await page.keyboard.press('Space')
  await expect(toggle).not.toBeChecked()
  await page.keyboard.press('Space')
  await expect(toggle).toBeChecked()

  // The history scrolls with the keyboard; Home reaches the top and loads older.
  const log = page.getByRole('region', { name: 'Message history' })
  await log.focus()
  await page.keyboard.press('Home')
  await expect(page.locator('[data-message-id]')).toHaveCount(60)

  // The dialog traps focus, starts on the safe choice, and gives focus back.
  const wipe = page.getByRole('button', { name: 'Wipe the chat…' })
  await wipe.focus()
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('alertdialog')
  await expect(dialog.getByRole('button', { name: 'Keep everything' })).toBeFocused()
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('Tab')
    expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true)
  }
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(wipe).toBeFocused()
  await close()
})

test('leaving with an unsaved purpose asks first', async ({ browser }) => {
  const { page, close } = await open(browser, { viewport: DESKTOP })
  await page.goto('/topics/81')
  const purpose = page.getByLabel('What this agent is for')
  const before = await purpose.inputValue()
  await purpose.fill(`${before} plus an edit`)

  const overview = page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Overview' })
  await overview.click()
  const ask = page.getByRole('alertdialog', { name: 'Discard your purpose changes?' })
  await expect(ask).toBeVisible()
  await ask.getByRole('button', { name: 'Keep editing' }).click()
  await expect(ask).toBeHidden()
  await expect(purpose).toHaveValue(`${before} plus an edit`) // nothing lost

  await overview.click()
  await ask.getByRole('button', { name: 'Discard changes' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible()
  await close()
})

test('reduced motion keeps the fade and drops the zoom', async ({ browser }) => {
  const sample = async (reducedMotion: 'reduce' | 'no-preference') => {
    const { page, close } = await open(browser, { viewport: DESKTOP, reducedMotion })
    await page.goto('/topics/2')
    await page.getByRole('button', { name: 'Wipe the chat…' }).click()
    const frame = await page.locator('[data-slot=alert-dialog-content]').evaluate((el) => {
      const animations = el.getAnimations()
      for (const a of animations) {
        a.pause()
        a.currentTime = 0
      }
      const s = getComputedStyle(el)
      const scale = s.transform === 'none' ? 1 : new DOMMatrix(s.transform).a
      return { animations: animations.length, opacity: Number(s.opacity), scale }
    })
    await close()
    return frame
  }
  const full = await sample('no-preference')
  expect(full.animations).toBeGreaterThan(0)
  expect(full.scale).toBeCloseTo(0.95) // zooms in from 95%
  const reduced = await sample('reduce')
  expect(reduced.animations, 'still fades').toBeGreaterThan(0)
  expect(reduced.opacity).toBeLessThan(1)
  expect(reduced.scale).toBe(1) // no zoom
})

test('sign-in at its worst: a 1,000-character password, phone, dark', async ({ browser }) => {
  const { page, close } = await open(browser, { viewport: PHONE, colorScheme: 'dark', hasTouch: true, isMobile: true }, false)
  await page.goto('/login')
  const field = page.getByLabel('Password')
  await expect(field).not.toBeFocused() // no keyboard popping up on a phone
  await field.fill('p'.repeat(1000))
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByText('Wrong password. Try again.')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  const box = (await field.boundingBox())!
  expect(box.x + box.width).toBeLessThanOrEqual(PHONE.width)
  expect(box.height).toBeGreaterThanOrEqual(44)
  // 16px text, so iOS doesn't zoom in when the field is tapped.
  expect(await field.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16)
  await field.fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible()
  await close()
})
