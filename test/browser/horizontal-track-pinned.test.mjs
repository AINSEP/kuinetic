import { fileURLToPath } from 'node:url'
import { createChecker, createFrameRecorder } from '../../scripts/browser-harness.mjs'

/**
 * The pinned-track `horizontal-scroll` variant must actually translate the track, not just
 * publish `--dsg-progress`.
 *
 * Root cause (docs/live-testing-backlog.md D4): `trackTravel`'s "auto" measurement computed
 * `node.scrollWidth - node.clientWidth` on the track itself. That is only non-zero when the track
 * has its own fixed width narrower than its content — the nested-scroller pattern already covered
 * by `scroll-nested.test.mjs`. `demo/showcase/scroll.html`'s pinned-track pattern instead gives the
 * track `width: max-content` and lets a separate `overflow: hidden` `.track-viewport` do the
 * clipping, so the track's own box always exactly fits its content and that subtraction was
 * permanently zero — `--dsg-progress` ticked up correctly while `translate` sat frozen at `0px`.
 * This fixture mirrors that exact structure; `scroll-nested.test.mjs` covers the other one and is
 * untouched by this fix.
 */
export const name = 'horizontal-track-pinned'

const FIXTURE_URL = `file://${fileURLToPath(new URL('./fixtures/horizontal-track-pinned.html', import.meta.url))}`

/** Five 380px panels, four 24px gaps, 64px padding on each side of `.track`. */
const TRACK_CONTENT_WIDTH = 5 * 380 + 4 * 24 + 2 * 64
const VIEWPORT_WIDTH = 900
/** How far the track must translate to bring its far edge to the viewport's far edge. */
const EXPECTED_TRAVEL_PX = TRACK_CONTENT_WIDTH - VIEWPORT_WIDTH
/** `.track-stage`'s authored height (300vh at the fixture's 700px-tall viewport). */
const STAGE_HEIGHT_PX = 2100

function translateX(computedTranslate) {
  return Number.parseFloat(computedTranslate.split(' ')[0] ?? 'NaN')
}

async function scrollAndRead(page, y) {
  await page.evaluate((sy) => window.scrollTo(0, sy), y)
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)))
  await page.waitForTimeout(30)
  return page.$eval('.track', (el) => ({
    translate: getComputedStyle(el).translate,
    progress: Number.parseFloat(el.style.getPropertyValue('--dsg-progress')),
  }))
}

export async function run({ browser, ARTIFACT_DIR }) {
  const { check, results } = createChecker()
  const snap = createFrameRecorder(`${ARTIFACT_DIR}/frames/${name}`)

  const context = await browser.newContext({ viewport: { width: VIEWPORT_WIDTH, height: 700 } })
  const page = await context.newPage()
  await page.goto(FIXTURE_URL)
  await page.waitForFunction(() => window.__dsg !== undefined)
  await snap(page, 'initial-load')

  const start = await scrollAndRead(page, 0)
  const midway = await scrollAndRead(page, STAGE_HEIGHT_PX / 2)
  await snap(page, 'midway-scroll')
  const end = await scrollAndRead(page, STAGE_HEIGHT_PX)
  await snap(page, 'end-scroll')

  check(
    'progress tracks scroll continuously (the measurement side already worked)',
    midway.progress > 0.3 && midway.progress < 0.65 && end.progress > 0.95,
    `start.progress=${start.progress}, midway.progress=${midway.progress}, end.progress=${end.progress}`,
  )
  check(
    'translate moves in step with progress instead of staying frozen at 0px',
    translateX(start.translate) === 0 && translateX(midway.translate) < -50 && translateX(end.translate) < -500,
    `start=${start.translate}, midway=${midway.translate}, end=${end.translate}`,
  )
  check(
    'translate at full progress matches the track content width minus the clipping viewport width',
    Math.abs(translateX(end.translate) - -EXPECTED_TRAVEL_PX) < 5,
    `translate=${end.translate}, expected≈${-EXPECTED_TRAVEL_PX}px`,
  )
  check(
    'translate at each sampled point is proportional to its own progress reading',
    Math.abs(translateX(midway.translate) - -midway.progress * EXPECTED_TRAVEL_PX) < 5,
    `translate=${midway.translate}, progress=${midway.progress}, expected≈${-midway.progress * EXPECTED_TRAVEL_PX}px`,
  )

  await context.close()
  return results
}
