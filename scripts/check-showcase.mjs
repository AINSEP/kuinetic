/**
 * Smoke-check the showcase pages.
 *
 * Cheaper and blunter than the assertion harness: it only proves every authored `data-kui` value
 * resolved to a registered effect and installed without error. That catches the most common
 * authoring mistake — a typo'd effect name, which leaves the element in `pending` forever — before
 * anyone opens a browser.
 *
 * Remote image failures are ignored on purpose: the pages reference pictures by URL rather than
 * bundling them, so a sandbox with no network must not fail the check.
 */
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const PAGES = ['reveals', 'scroll', 'interactive', 'text', 'data-hover', 'ambient-feedback', 'nav-forms']
const dir = fileURLToPath(new URL('../demo/', import.meta.url))

const browser = await chromium.launch({ headless: true })
let failures = 0

for (const name of PAGES) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(String(error)))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })

  await page.goto(`file://${dir}${name}.html`)
  await page.waitForTimeout(600)

  const stats = await page.evaluate(() => ({
    authored: document.querySelectorAll('[data-kui]').length,
    installed: document.querySelectorAll('[data-kui-fx]').length,
    pending: document.querySelectorAll('[data-kui-state="pending"]').length,
    failed: document.querySelectorAll('[data-kui-state="failed"]').length,
  }))

  const scriptErrors = errors.filter((e) => !/net::|Failed to load resource/.test(e))
  const ok =
    stats.installed === stats.authored &&
    stats.pending === 0 &&
    stats.failed === 0 &&
    scriptErrors.length === 0
  if (!ok) failures++

  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${name}.html — authored=${stats.authored} ` +
      `installed=${stats.installed} pending=${stats.pending} failed=${stats.failed}` +
      (scriptErrors.length ? ` errors: ${scriptErrors.join(' | ')}` : ''),
  )
  await page.close()
}

await browser.close()
process.exit(failures > 0 ? 1 : 0)
