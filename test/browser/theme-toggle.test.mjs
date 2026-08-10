import { fileURLToPath } from 'node:url'
import { createChecker, createFrameRecorder } from '../../scripts/browser-harness.mjs'

/**
 * The showcase light/dark toggle has two failure modes that only a real browser can prove:
 * a flash of the wrong theme before `theme.js` loads (fixed by resolving the theme synchronously
 * in a `<head>` script instead), and a first-visit default that should follow the OS preference
 * rather than always defaulting to dark. See `docs/live-testing-backlog.md` F4.
 */
export const name = 'theme-toggle'

const PAGE_URL = `file://${fileURLToPath(new URL('../../demo/showcase/reveals.html', import.meta.url))}`
const STORAGE_KEY = 'designimation-showcase-theme'

async function readTheme(page) {
  return page.evaluate(
    (key) => ({
      dataset: document.documentElement.dataset.theme,
      background: getComputedStyle(document.body).backgroundColor,
      stored: (() => {
        try {
          return localStorage.getItem(key)
        } catch {
          return null
        }
      })(),
    }),
    STORAGE_KEY,
  )
}

export async function run({ browser, ARTIFACT_DIR }) {
  const { check, results } = createChecker()
  const snap = createFrameRecorder(`${ARTIFACT_DIR}/frames/${name}`)

  // --- resolution must not depend on theme.js: block it and confirm dataset.theme is still
  // correct, proving the <head> script (not the body-end script) is what resolves the theme. ---
  const blockedContext = await browser.newContext({ viewport: { width: 900, height: 700 } })
  await blockedContext.route('**/theme.js', (route) => route.abort())
  await blockedContext.addInitScript(
    (key) => localStorage.setItem(key, 'light'),
    STORAGE_KEY,
  )
  const blockedPage = await blockedContext.newPage()
  await blockedPage.goto(PAGE_URL)
  const withThemeJsBlocked = await readTheme(blockedPage)
  check(
    'a stored preference resolves to the right theme even if theme.js never loads',
    withThemeJsBlocked.dataset === 'light',
    `dataset.theme=${withThemeJsBlocked.dataset}`,
  )
  check(
    'the resolved light theme actually painted a light background, not just the attribute',
    withThemeJsBlocked.background === 'rgb(255, 255, 255)',
    `background=${withThemeJsBlocked.background}`,
  )
  await snap(blockedPage, 'resolved-light-without-theme-js')
  await blockedContext.close()

  // --- first visit with no stored preference follows the OS color-scheme preference ---
  const lightOsContext = await browser.newContext({
    viewport: { width: 900, height: 700 },
    colorScheme: 'light',
  })
  const lightOsPage = await lightOsContext.newPage()
  await lightOsPage.goto(PAGE_URL)
  const lightOsTheme = await readTheme(lightOsPage)
  check(
    'first visit with OS preference set to light defaults to the light theme',
    lightOsTheme.dataset === 'light',
    `dataset.theme=${lightOsTheme.dataset}`,
  )
  await snap(lightOsPage, 'first-visit-os-light')
  await lightOsContext.close()

  const darkOsContext = await browser.newContext({
    viewport: { width: 900, height: 700 },
    colorScheme: 'dark',
  })
  const darkOsPage = await darkOsContext.newPage()
  await darkOsPage.goto(PAGE_URL)
  const darkOsTheme = await readTheme(darkOsPage)
  check(
    'first visit with OS preference set to dark defaults to the dark theme',
    darkOsTheme.dataset === 'dark',
    `dataset.theme=${darkOsTheme.dataset}`,
  )
  await snap(darkOsPage, 'first-visit-os-dark')
  await darkOsContext.close()

  // --- clicking the toggle flips the theme, updates the button, and persists the explicit choice ---
  const context = await browser.newContext({ viewport: { width: 900, height: 700 }, colorScheme: 'dark' })
  const page = await context.newPage()
  await page.goto(PAGE_URL)
  const before = await readTheme(page)
  check('page with no stored preference and dark OS scheme starts dark', before.dataset === 'dark')
  await snap(page, 'before-click')

  await page.click('.dsg-theme-toggle')
  const after = await readTheme(page)
  check(
    'clicking the toggle flips dataset.theme to light',
    after.dataset === 'light',
    `dataset.theme=${after.dataset}`,
  )
  check(
    'clicking the toggle persists the explicit choice to localStorage',
    after.stored === 'light',
    `stored=${after.stored}`,
  )
  const buttonState = await page.$eval('.dsg-theme-toggle', (el) => ({
    ariaLabel: el.getAttribute('aria-label'),
    ariaPressed: el.getAttribute('aria-pressed'),
  }))
  check(
    'the toggle button announces the mode a click would switch to next, not the current one',
    buttonState.ariaLabel === 'Switch to dark mode' && buttonState.ariaPressed === 'true',
    JSON.stringify(buttonState),
  )
  await snap(page, 'after-click-light')

  await page.reload()
  const afterReload = await readTheme(page)
  check(
    'an explicit choice survives a reload',
    afterReload.dataset === 'light',
    `dataset.theme=${afterReload.dataset}`,
  )
  await snap(page, 'after-reload-still-light')

  await context.close()
  return results
}
