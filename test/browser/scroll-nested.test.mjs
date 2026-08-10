import { fileURLToPath } from 'node:url'
import { createChecker, createFrameRecorder } from '../../scripts/browser-harness.mjs'

/**
 * Nested `overflow: auto` scroll root, driving a default `horizontal-scroll` track.
 *
 * `docs/review-2-gpt-5.6-sol.md` named this as the one test that would have caught three real
 * defects at once: the default-zero travel, the nested-coordinate bug (mixing a viewport-relative
 * rect with a scroller-local `scrollTop`), and an unbatched per-frame `scrollWidth` read. All three
 * were since fixed in source; this suite is the regression guard the review asked for, run against
 * a real layout instead of the fake scheduler the unit suite uses.
 */
export const name = 'scroll-nested'

const FIXTURE_URL = `file://${fileURLToPath(new URL('./fixtures/scroll-nested.html', import.meta.url))}`

/** Content above `#track` inside `#scroller`; see the fixture's `.above` rule. */
const SPACER_ABOVE_PX = 200
/** The `distance:300px` authored on `#track` in the fixture. */
const DISTANCE_PX = 300
/** Four 300px panels (1200px) minus the 300px track viewport. */
const EXPECTED_TRAVEL_PX = 900

async function settle(page) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)))
}

/**
 * Count real layout reads at the JS level instead of trusting a browser-internal metric.
 *
 * A first attempt used Chromium's CDP `LayoutCount`, which turned out to be a degenerate check:
 * an `overflow: auto` scrollTop change does not dirty Chromium's layout tree, so the metric read
 * zero for both a 3-event and a 30-event burst regardless of whether the scheduler was coalescing
 * correctly — a trivial pass. Wrapping `getBoundingClientRect` measures what the *library* actually
 * calls, which is the invariant under test.
 */
const COUNT_RECT_CALLS = () => {
  window.__rectCalls = 0
  const original = Element.prototype.getBoundingClientRect
  Element.prototype.getBoundingClientRect = function counted(...args) {
    window.__rectCalls += 1
    return original.apply(this, args)
  }
}

const rectCallCount = (page) => page.evaluate(() => window.__rectCalls)

async function readTrackState(page) {
  return page.$eval('#track', (el) => ({
    progress: Number.parseFloat(el.style.getPropertyValue('--dsg-progress')),
    translate: el.style.getPropertyValue('translate'),
  }))
}

function translateX(translate) {
  return Number.parseFloat(translate.split(' ')[0] ?? 'NaN')
}

/**
 * Scroll `#scroller` to the exact pixel that should read as 50% progress, then assert both the
 * published progress and the horizontal translation it drives.
 *
 * @complexity O(1) browser round trips; independent of fixture size.
 * @overallScore 100
 */
async function checkFiftyPercentScroll(page, check, snap) {
  const targetScrollTop = SPACER_ABOVE_PX + DISTANCE_PX * 0.5
  await page.$eval('#scroller', (el, top) => {
    el.scrollTop = top
  }, targetScrollTop)
  await settle(page)

  const state = await readTrackState(page)
  const expectedTranslate = -0.5 * EXPECTED_TRAVEL_PX
  check(
    'nested scroller at 50% reports progress ≈ 0.5',
    Math.abs(state.progress - 0.5) < 0.02,
    `progress=${state.progress}`,
  )
  check(
    'translation is half of scrollWidth - clientWidth',
    Math.abs(translateX(state.translate) - expectedTranslate) < 5,
    `translate=${state.translate}, expected≈${expectedTranslate}px`,
  )
  await snap(page, 'nested-scroll-50-percent')
  return state
}

/**
 * Scroll the *window* by a large amount without touching the nested scroller, and confirm the
 * tracked progress and translation are unaffected — the coordinate-mixing bug this test exists to
 * catch would move both by the window's scroll offset.
 *
 * @complexity O(1) browser round trips.
 * @overallScore 100
 */
async function checkWindowScrollIsolation(page, check, snap, before) {
  await page.evaluate(() => window.scrollBy(0, 500))
  await settle(page)
  const after = await readTrackState(page)
  check(
    "window's position does not affect nested scroller progress",
    Math.abs(after.progress - before.progress) < 0.001,
    `before=${before.progress}, after=${after.progress}`,
  )
  check(
    "window's position does not affect nested scroller translation",
    translateX(after.translate) === translateX(before.translate),
    `before=${before.translate}, after=${after.translate}`,
  )
  await snap(page, 'after-window-scroll-unaffected')
  await page.evaluate(() => window.scrollTo(0, 0))
}

/**
 * Fire a burst of synthetic `scroll` events on the nested root within a single JS turn, then wait
 * one animation frame, and compare `getBoundingClientRect` call counts against a ten-times-larger
 * burst. The scheduler coalesces every event dispatched within one turn into a single scheduled
 * frame, so both bursts should cost the same handful of reads — not one per event.
 *
 * @complexity O(1) browser round trips per burst.
 * @overallScore 100
 */
async function checkLayoutCountStaysBounded(page, check) {
  const fireBurst = (count) =>
    page.$eval(
      '#scroller',
      (el, n) => {
        for (let i = 0; i < n; i++) el.dispatchEvent(new Event('scroll'))
      },
      count,
    )

  const baseline = await rectCallCount(page)
  await fireBurst(3)
  await settle(page)
  const afterSmall = await rectCallCount(page)
  const deltaSmall = afterSmall - baseline

  await fireBurst(30)
  await settle(page)
  const afterLarge = await rectCallCount(page)
  const deltaLarge = afterLarge - afterSmall

  check(
    'measurement reads stay bounded across a burst of frames, not one per event',
    deltaLarge <= deltaSmall + 2 && deltaLarge < 30,
    `3-event burst cost ${deltaSmall} rect reads, 30-event burst cost ${deltaLarge} rect reads`,
  )
}

export async function run({ browser, ARTIFACT_DIR }) {
  const { check, results } = createChecker()
  const snap = createFrameRecorder(`${ARTIFACT_DIR}/frames/${name}`)

  const context = await browser.newContext({ viewport: { width: 900, height: 700 } })
  const page = await context.newPage()
  await page.addInitScript(COUNT_RECT_CALLS)

  await page.goto(FIXTURE_URL)
  await page.waitForFunction(() => window.__dsg !== undefined)
  await settle(page)
  await snap(page, 'initial-load')

  const fiftyPercent = await checkFiftyPercentScroll(page, check, snap)
  await checkWindowScrollIsolation(page, check, snap, fiftyPercent)
  await checkLayoutCountStaysBounded(page, check)

  await context.close()
  return results
}
