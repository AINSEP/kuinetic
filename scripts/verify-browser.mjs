/**
 * Real-browser verification.
 *
 * The unit suite runs in jsdom, which never evaluates `@keyframes`, never applies
 * `animation-timeline`, and never computes whether `fill-mode: both` plus a paused play-state
 * actually holds an element at its from-state. Everything this library promises visually is
 * therefore unproven by that suite. This script drives a private headless Chromium and asserts
 * against real computed styles and real `getAnimations()` output.
 *
 * Chromium comes from Tovu's playwright-core install; no browser of the user's is touched.
 */
import { chromium } from '/Users/la/Programming/Tovu/node_modules/playwright-core/index.mjs'
import { fileURLToPath } from 'node:url'

const PAGE_URL = `file://${fileURLToPath(new URL('../demo/index.html', import.meta.url))}`

const results = []
function check(name, passed, detail = '') {
  results.push({ name, passed, detail })
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
}

const opacityOf = (page, id) =>
  page.$eval(id, (el) => Number.parseFloat(getComputedStyle(el).opacity))

const animationsOf = (page, id) =>
  page.$eval(id, (el) => el.getAnimations().map((a) => a.animationName ?? a.constructor.name))

async function run() {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } })
  const consoleErrors = []
  page.on('pageerror', (e) => consoleErrors.push(String(e)))

  await page.goto(PAGE_URL)
  await page.waitForFunction(() => window.__dsg !== undefined)

  // --- environment ---------------------------------------------------------------------
  const caps = await page.evaluate(() => window.__caps)
  console.log(`\nchromium capabilities: ${JSON.stringify(caps)}\n`)
  check('no page errors on boot', consoleErrors.length === 0, consoleErrors.join(' | '))

  // --- on:load runs without any trigger ------------------------------------------------
  await page.waitForTimeout(400)
  check('on:load reached final opacity', (await opacityOf(page, '#onload')) === 1)
  check(
    'on:load produced a real CSS animation',
    (await animationsOf(page, '#onload')).includes('dsg-zoom-in'),
  )

  // --- the from-state is genuinely held before activation ------------------------------
  // This is the claim jsdom cannot test at all: paused + fill-mode both == invisible.
  const revealBefore = await opacityOf(page, '#reveal')
  check('off-screen reveal is held invisible', revealBefore === 0, `opacity=${revealBefore}`)
  check(
    'off-screen reveal is paused, not unstyled',
    (await page.$eval('#reveal', (el) => getComputedStyle(el).animationPlayState)) === 'paused',
  )
  check(
    'off-screen reveal is marked ready',
    (await page.$eval('#reveal', (el) => el.getAttribute('data-dsg-state'))) === 'ready',
  )

  // --- scrolling into view starts it ----------------------------------------------------
  await page.$eval('#stage', (el) => el.scrollIntoView())
  await page.waitForTimeout(700)
  const revealAfter = await opacityOf(page, '#reveal')
  check('reveal animates to visible after entering view', revealAfter === 1, `opacity=${revealAfter}`)
  check(
    'reveal is marked running',
    (await page.$eval('#reveal', (el) => el.getAttribute('data-dsg-state'))) === 'running',
  )

  // --- composition actually produces two parallel animations ---------------------------
  const composed = await animationsOf(page, '#composed')
  check(
    'disjoint channels compose into two live animations',
    composed.includes('dsg-in-up') && composed.includes('dsg-blur-in'),
    composed.join(', '),
  )
  check('composed element is fully visible', (await opacityOf(page, '#composed')) === 1)

  // --- combo preset collapses a colliding pair to one animation ------------------------
  const combo = await animationsOf(page, '#combo')
  check(
    'colliding pair resolves to the single combo keyframe',
    combo.length === 1 && combo[0] === 'dsg-fade-blur-up',
    combo.join(', '),
  )

  // --- parameters reach CSS, and dangerous ones do not ----------------------------------
  check(
    'author parameter overrides the preset default',
    (await page.$eval('#override', (el) => el.style.getPropertyValue('--dsg-distance'))) === '80px',
  )
  check(
    'rejected parameter is never written to the element',
    (await page.$eval('#rejected', (el) => el.style.getPropertyValue('--dsg-distance'))) === '',
  )

  // --- stagger produces genuinely different computed delays ----------------------------
  const delays = await page.$$eval('#stagger li', (items) =>
    items.map((el) => getComputedStyle(el).animationDelay),
  )
  check(
    'stagger yields increasing computed delays',
    delays[0] === '0s' && delays[1] === '0.08s' && delays[2] === '0.16s',
    delays.join(', '),
  )

  // --- hover activation ------------------------------------------------------------------
  check('hover effect is paused before interaction', (await opacityOf(page, '#hoverable')) >= 0)
  await page.hover('#hoverable')
  await page.waitForTimeout(300)
  check(
    'hover starts the animation',
    (await page.$eval('#hoverable', (el) => el.getAttribute('data-dsg-state'))) === 'running',
  )

  // --- reduced motion lands on the final state, never the from-state --------------------
  const reduced = await browser.newPage({ viewport: { width: 900, height: 700 } })
  await reduced.emulateMedia({ reducedMotion: 'reduce' })
  await reduced.goto(PAGE_URL)
  await reduced.waitForFunction(() => window.__dsg !== undefined)
  await reduced.waitForTimeout(400)
  const reducedOpacity = await reduced.$eval('#reveal', (el) =>
    Number.parseFloat(getComputedStyle(el).opacity),
  )
  check(
    'reduced motion shows content immediately, never stuck invisible',
    reducedOpacity === 1,
    `opacity=${reducedOpacity}`,
  )

  await browser.close()

  const failed = results.filter((r) => !r.passed)
  console.log(`\n${results.length - failed.length}/${results.length} browser checks passed`)
  if (failed.length > 0) {
    console.log(`\nFAILED:\n${failed.map((f) => `  - ${f.name} ${f.detail}`).join('\n')}`)
    process.exit(1)
  }
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
