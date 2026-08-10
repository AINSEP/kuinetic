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
import { rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { burstSample, createChecker, createFrameRecorder, loadChromium } from './browser-harness.mjs'

const PAGE_URL = `file://${fileURLToPath(new URL('../demo/index.html', import.meta.url))}`
const SHOWCASE_URL = `file://${fileURLToPath(
  new URL('../demo/showcase/reveals.html', import.meta.url),
)}`
const ARTIFACT_DIR = fileURLToPath(new URL('../.artifacts', import.meta.url))
/**
 * `--record` captures two forms of evidence: a continuous `.webm` video of the whole run (via
 * Playwright's `recordVideo`) and a named PNG filmstrip, one frame per check, in
 * `.artifacts/frames/verify-browser/`. The video is for a human to watch; the frames are for an
 * agent to `Read` directly — a video file cannot be opened as an image, so without the frames the
 * "watched, not inferred" claim only held for humans.
 */
const RECORD = process.argv.includes('--record')

const { check, results } = createChecker()

/** No-op recorder for a normal (non-`--record`) run, so call sites never branch on `RECORD`. */
const noopSnap = async () => undefined

const opacityOf = (page, id) =>
  page.$eval(id, (el) => Number.parseFloat(getComputedStyle(el).opacity))

const animationsOf = (page, id) =>
  page.$eval(id, (el) => el.getAnimations().map((a) => a.animationName ?? a.constructor.name))

async function run() {
  const chromium = await loadChromium()
  const browser = await chromium.launch({ headless: true })

  if (RECORD) {
    rmSync(ARTIFACT_DIR, { recursive: true, force: true })
  }

  const context = await browser.newContext({
    viewport: { width: 900, height: 700 },
    ...(RECORD ? { recordVideo: { dir: `${ARTIFACT_DIR}/video`, size: { width: 900, height: 700 } } } : {}),
  })
  const page = await context.newPage()
  const consoleErrors = []
  page.on('pageerror', (e) => consoleErrors.push(String(e)))
  const snap = RECORD ? createFrameRecorder(`${ARTIFACT_DIR}/frames/verify-browser`) : noopSnap

  await page.goto(PAGE_URL)
  await page.waitForFunction(() => window.__dsg !== undefined)

  // --- environment ---------------------------------------------------------------------
  const caps = await page.evaluate(() => window.__caps)
  console.log(`\nchromium capabilities: ${JSON.stringify(caps)}\n`)
  check('no page errors on boot', consoleErrors.length === 0, consoleErrors.join(' | '))
  await snap(page, 'boot')

  // --- on:load runs without any trigger ------------------------------------------------
  await page.waitForTimeout(400)
  check('on:load reached final opacity', (await opacityOf(page, '#onload')) === 1)
  check(
    'on:load produced a real CSS animation',
    (await animationsOf(page, '#onload')).includes('dsg-zoom-in'),
  )
  await snap(page, 'onload-final-state')

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
  await snap(page, 'reveal-held-before-activation')

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
  await snap(page, 'reveal-after-scroll-into-view')

  // --- composition actually produces two parallel animations ---------------------------
  const composed = await animationsOf(page, '#composed')
  check(
    'disjoint channels compose into two live animations',
    composed.includes('dsg-in-up') && composed.includes('dsg-blur-in'),
    composed.join(', '),
  )
  check('composed element is fully visible', (await opacityOf(page, '#composed')) === 1)
  await snap(page, 'composed-channels')

  // --- both effects survive; neither is silently replaced by a combo -------------------
  const combo = await animationsOf(page, '#combo')
  check(
    'a composable pair keeps both animations instead of being substituted',
    combo.includes('dsg-in-up') && combo.includes('dsg-blur-in'),
    combo.join(', '),
  )
  await snap(page, 'combo-not-substituted')

  // --- parameters reach CSS, and dangerous ones do not ----------------------------------
  check(
    'author parameter overrides the preset default',
    (await page.$eval('#override', (el) => el.style.getPropertyValue('--dsg-distance'))) === '80px',
  )
  check(
    'rejected parameter is never written to the element',
    (await page.$eval('#rejected', (el) => el.style.getPropertyValue('--dsg-distance'))) === '',
  )
  await snap(page, 'parameter-override-and-rejection')

  // --- stagger produces genuinely different computed delays ----------------------------
  const delays = await page.$$eval('#stagger li', (items) =>
    items.map((el) => getComputedStyle(el).animationDelay),
  )
  check(
    'stagger yields increasing computed delays',
    delays[0] === '0s' && delays[1] === '0.08s' && delays[2] === '0.16s',
    delays.join(', '),
  )
  await snap(page, 'stagger-delays')

  // --- hover activation ------------------------------------------------------------------
  check(
    'hover effect is held at its from-state before interaction',
    (await page.$eval('#hoverable', (el) => getComputedStyle(el).animationPlayState)) === 'paused' &&
      (await page.$eval('#hoverable', (el) => el.getAttribute('data-dsg-state'))) === 'ready',
  )
  await snap(page, 'hover-before-interaction')
  await page.hover('#hoverable')
  await page.waitForTimeout(300)
  const hoverState = await page.$eval('#hoverable', (el) => el.getAttribute('data-dsg-state'))
  check(
    'hover leaves the gate and the animation completes',
    hoverState === 'running' || hoverState === 'finished',
    `state=${hoverState}`,
  )
  await snap(page, 'hover-after-interaction')

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
  await snap(page, 'pin-sticky-and-spacer')

  // scrollIntoView lands the container exactly at the top, which is progress 0 by definition —
  // the pin has to be scrolled *past* before it reports anything.
  await page.$eval('#pin-host', (el) => el.scrollIntoView())
  await page.evaluate(() => window.scrollBy(0, 200))
  await page.waitForTimeout(300)
  const pinProgress = await page.$eval('#pinned', (el) =>
    Number.parseFloat(el.style.getPropertyValue('--dsg-progress')),
  )
  check('pin publishes real scroll progress', pinProgress > 0, `progress=${pinProgress}`)
  await snap(page, 'pin-progress-after-scroll')

  // --- v2: scrollytelling -------------------------------------------------------------------
  await page.$eval('#story-host', (el) => el.scrollIntoView())
  await page.waitForTimeout(300)
  await page.evaluate(() => window.scrollBy(0, 300))
  await page.waitForTimeout(300)
  const step = await page.$eval('#story', (el) => el.getAttribute('data-dsg-step'))
  check('scrollytelling advances its step index', Number(step) > 0, `step=${step}`)
  await snap(page, 'scrollytelling-step')

  // --- v2: FLIP ------------------------------------------------------------------------------
  // Reorder the list, then confirm a moved child is actually running an animation.
  await snap(page, 'flip-before-reorder')
  const flipAnimations = await page.evaluate(async () => {
    const list = document.querySelector('#flip-list')
    list.prepend(document.querySelector('#card-c'))
    await new Promise((resolve) => requestAnimationFrame(resolve))
    return document.querySelector('#card-a').getAnimations().length
  })
  check('FLIP animates a child displaced by a reorder', flipAnimations > 0, `${flipAnimations}`)
  await snap(page, 'flip-after-reorder')

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
  await snap(page, 'svg-morph-after-hover')

  // --- showcase replay FAB ---------------------------------------------------------------
  // The replay page itself matters here: calling `play()` in isolation would not prove the
  // shared FAB is wired through the public reset/replay path. Selected by id rather than by
  // trigger, because `play()` stamps `data-dsg-on="manual"` on any element that lacks the
  // longhand attribute — which is every element on the page now that triggers are authored
  // inline as `on:load`. A selector keyed on the trigger would be unstable across the very
  // click being tested; an id is not.
  const showcase = await context.newPage()
  await showcase.goto(SHOWCASE_URL)
  await showcase.waitForFunction(() => window.__dsg !== undefined)
  await showcase.waitForTimeout(800)
  const loadEffect = await showcase.$('#load-fade')
  const readEffect = () =>
    loadEffect.evaluate((el) => {
      const a = el.getAnimations()[0]
      return {
        opacity: Number.parseFloat(getComputedStyle(el).opacity),
        playState: a?.playState ?? null,
        currentTime: a?.currentTime ?? null,
      }
    })
  check('showcase load effect has already reached its visible final state', (await readEffect()).opacity === 1)

  await showcase.click('.dsg-replay-fab')
  // A single before/after pair cannot tell a genuine restart from a frozen mid-range opacity
  // reading — burst-sample `currentTime`/`playState` across the whole 600ms duration instead,
  // the same way flip-geometry proves motion is real rather than just starting and ending right.
  const { samples: replaySamples } = await burstSample({
    page: showcase,
    snap,
    label: 'showcase-replay',
    durationMs: 600,
    fractions: [0, 0.05, 0.15, 0.3, 0.5, 0.75, 1],
    read: readEffect,
  })
  const first = replaySamples[0]
  check(
    'replay FAB genuinely restarts the animation from the beginning',
    first.playState === 'running' && first.currentTime !== null && first.currentTime < 60,
    `first sample: playState=${first.playState}, currentTime=${first.currentTime}`,
  )
  const times = replaySamples.map((sample) => sample.currentTime ?? 0)
  check(
    'replayed animation progresses forward monotonically, not stuck at one frozen value',
    times.every((time, i) => i === 0 || time >= times[i - 1] - 1),
    `currentTime samples: ${times.map((time) => time.toFixed(1)).join(', ')}`,
  )
  const last = replaySamples[replaySamples.length - 1]
  check(
    'replayed showcase effect reaches its visible final state again',
    last.opacity === 1 && last.playState === 'finished',
    `opacity=${last.opacity}, playState=${last.playState}`,
  )
  await showcase.close()

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
  await snap(reduced, 'reduced-motion-final-state')

  check('no page errors after scroll, FLIP, and SVG interaction', consoleErrors.length === 0,
    consoleErrors.join(' | '))

  await context.close()
  await browser.close()
  if (RECORD) {
    console.log(`\nvideo: ${ARTIFACT_DIR}/video/*.webm`)
    console.log(`frames: ${ARTIFACT_DIR}/frames/verify-browser/*.png`)
  }

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
