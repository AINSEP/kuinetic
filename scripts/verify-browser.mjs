/**
 * Real-browser verification.
 *
 * The unit suite runs in jsdom, which never evaluates `@keyframes`, never applies
 * `animation-timeline`, and never computes whether `fill-mode: both` plus a paused play-state
 * actually holds an element at its from-state. Everything this library promises visually is
 * therefore unproven by that suite. This script drives a private headless Chromium and asserts
 * against real computed styles and real `getAnimations()` output.
 *
 * Chromium is launched privately from the repo's own playwright-core; no browser of the
 * user's is touched.
 */
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

/**
 * Resolve Playwright without hardcoding a path outside the repository.
 *
 * Preference order: an installed `playwright-core`, then `playwright`, then an explicit
 * `PLAYWRIGHT_MODULE` override. Hardcoding an absolute path made this harness unrunnable on any
 * machine but one, which is not a usable quality gate for a public library.
 */
async function loadChromium() {
  const require = createRequire(import.meta.url)
  const candidates = [process.env.PLAYWRIGHT_MODULE, 'playwright-core', 'playwright'].filter(Boolean)

  for (const candidate of candidates) {
    try {
      const resolved = candidate.startsWith('/') ? candidate : require.resolve(candidate)
      const mod = await import(candidate.startsWith('/') ? `file://${resolved}` : candidate)
      if (mod.chromium) return mod.chromium
    } catch {
      // try the next candidate
    }
  }
  throw new Error(
    'Playwright not found. Install `playwright-core` and its Chromium, or set PLAYWRIGHT_MODULE ' +
      'to an absolute path to a Playwright entry point.',
  )
}

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
  const chromium = await loadChromium()
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
  // The state machine must become truthful, not merely change once. Asserting "running" after
  // the animation had already ended previously codified the broken state as correct.
  check(
    'reveal reports finished once its animation ends',
    (await page.$eval('#reveal', (el) => el.getAttribute('data-dsg-state'))) === 'finished',
  )

  // --- composition actually produces two parallel animations ---------------------------
  const composed = await animationsOf(page, '#composed')
  check(
    'disjoint channels compose into two live animations',
    composed.includes('dsg-in-up') && composed.includes('dsg-blur-in'),
    composed.join(', '),
  )
  check('composed element is fully visible', (await opacityOf(page, '#composed')) === 1)

  // --- both effects survive; neither is silently replaced by a combo -------------------
  const combo = await animationsOf(page, '#combo')
  check(
    'a composable pair keeps both animations instead of being substituted',
    combo.includes('dsg-in-up') && combo.includes('dsg-blur-in'),
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
  check(
    'hover effect is held at its from-state before interaction',
    (await page.$eval('#hoverable', (el) => getComputedStyle(el).animationPlayState)) === 'paused' &&
      (await page.$eval('#hoverable', (el) => el.getAttribute('data-dsg-state'))) === 'ready',
  )
  await page.hover('#hoverable')
  await page.waitForTimeout(300)
  const hoverState = await page.$eval('#hoverable', (el) => el.getAttribute('data-dsg-state'))
  check(
    'hover leaves the gate and the animation completes',
    hoverState === 'running' || hoverState === 'finished',
    `state=${hoverState}`,
  )

  // --- v2: pinning ------------------------------------------------------------------------
  check(
    'pin applies sticky positioning',
    (await page.$eval('#pinned', (el) => getComputedStyle(el).position)) === 'sticky',
  )
  check(
    'pin inserts a spacer that is hidden from assistive tech',
    (await page.$eval('#pin-host [data-dsg-spacer]', (el) => el.getAttribute('aria-hidden'))) ===
      'true',
  )

  // scrollIntoView lands the container exactly at the top, which is progress 0 by definition —
  // the pin has to be scrolled *past* before it reports anything.
  await page.$eval('#pin-host', (el) => el.scrollIntoView())
  await page.evaluate(() => window.scrollBy(0, 200))
  await page.waitForTimeout(300)
  const pinProgress = await page.$eval('#pinned', (el) =>
    Number.parseFloat(el.style.getPropertyValue('--dsg-progress')),
  )
  check('pin publishes real scroll progress', pinProgress > 0, `progress=${pinProgress}`)

  // --- v2: scrollytelling -------------------------------------------------------------------
  await page.$eval('#story-host', (el) => el.scrollIntoView())
  await page.waitForTimeout(300)
  await page.evaluate(() => window.scrollBy(0, 300))
  await page.waitForTimeout(300)
  const step = await page.$eval('#story', (el) => el.getAttribute('data-dsg-step'))
  check('scrollytelling advances its step index', Number(step) > 0, `step=${step}`)

  // --- v2: FLIP ------------------------------------------------------------------------------
  // Reorder the list, then confirm a moved child is actually running an animation.
  const flipAnimations = await page.evaluate(async () => {
    const list = document.querySelector('#flip-list')
    list.prepend(document.querySelector('#card-c'))
    await new Promise((resolve) => requestAnimationFrame(resolve))
    return document.querySelector('#card-a').getAnimations().length
  })
  check('FLIP animates a child displaced by a reorder', flipAnimations > 0, `${flipAnimations}`)

  // --- v2: SVG morph --------------------------------------------------------------------------
  const morphed = await page.evaluate(async () => {
    const path = document.querySelector('#morph')
    const before = path.getAttribute('d')
    path.dispatchEvent(new PointerEvent('pointerenter'))
    await new Promise((resolve) => setTimeout(resolve, 250))
    return { before, after: path.getAttribute('d') }
  })
  check(
    'SVG path morph rewrites the d attribute on hover',
    morphed.after !== morphed.before && morphed.after.startsWith('M'),
    `${morphed.before} -> ${morphed.after}`,
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

  check('no page errors after scroll, FLIP, and SVG interaction', consoleErrors.length === 0,
    consoleErrors.join(' | '))

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
