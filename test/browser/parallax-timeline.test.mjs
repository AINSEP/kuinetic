import { fileURLToPath } from 'node:url'
import { createChecker, createFrameRecorder } from '../../scripts/browser-harness.mjs'

/**
 * `animation-timeline: view()` must track the real scroll position continuously, not settle once
 * and freeze.
 *
 * Root cause (docs/live-testing-backlog.md D3): `view()` resolves against the element's *nearest
 * scroll-container ancestor* — any wrapper with `overflow: hidden`/`auto`/`scroll` qualifies, even
 * one that never itself scrolls. `demo/showcase/scroll.html`'s `.parallax-frame` used
 * `overflow: hidden` to clip an oversized image, which made that motionless frame the timeline's
 * source instead of the document — progress computed once, on load, and stayed there for the rest
 * of the page's scroll. `kui-parallax-y`/`kui-parallax-x` (`src/css/scroll.css`) themselves were
 * never broken; `depth-layer` reuses `kui-parallax-y` (`src/effects/presets.ts`) and shares this
 * fixture's proof by construction, so it does not need a separate one.
 *
 * A naive `translate !== '0px'` assertion would pass on the broken code too — the frozen value was
 * never zero. This suite instead samples three widely-separated scroll positions spanning the
 * element's entry into view and asserts `translate` genuinely differs between all of them, then
 * confirms it correctly holds at its terminal value once scrolled well past — proving both "not
 * frozen" and "still behaves like a real animation range" in one pass.
 */
export const name = 'parallax-timeline'

const FIXTURE_URL = `file://${fileURLToPath(new URL('./fixtures/parallax-view-timeline.html', import.meta.url))}`

async function translateY(page) {
  return page.$eval('#parallax', (el) => {
    const t = getComputedStyle(el).translate
    return Number.parseFloat(t.split(' ')[1] ?? t.split(' ')[0])
  })
}

async function scrollAndRead(page, y) {
  await page.evaluate((sy) => window.scrollTo(0, sy), y)
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)))
  await page.waitForTimeout(30)
  return translateY(page)
}

export async function run({ browser, ARTIFACT_DIR }) {
  const { check, results } = createChecker()
  const snap = createFrameRecorder(`${ARTIFACT_DIR}/frames/${name}`)

  const context = await browser.newContext({ viewport: { width: 900, height: 700 } })
  const page = await context.newPage()
  await page.goto(FIXTURE_URL)
  await page.waitForFunction(() => window.__kui !== undefined)
  await snap(page, 'initial-load')

  // Before entry: still at the keyframe's `from` value.
  const preEntry = await scrollAndRead(page, 300)
  await snap(page, 'pre-entry')
  // Mid-crossing: partway through the entry range.
  const midCrossing = await scrollAndRead(page, 500)
  await snap(page, 'mid-crossing')
  // Near the end of the entry range, close to the `to` value.
  const nearEnd = await scrollAndRead(page, 800)
  await snap(page, 'near-end')
  // Scrolled far past: the entry range has ended and fill-mode should hold the `to` value.
  const wellPast = await scrollAndRead(page, 1400)
  await snap(page, 'well-past')

  check(
    'translate genuinely differs across three widely-separated scroll positions, not frozen at one value',
    preEntry !== midCrossing && midCrossing !== nearEnd && preEntry !== nearEnd,
    `pre-entry=${preEntry}, mid-crossing=${midCrossing}, near-end=${nearEnd}`,
  )
  check(
    'the swing between samples is large, ruling out a barely-different reading of a stuck value',
    Math.abs(nearEnd - preEntry) > 80,
    `pre-entry=${preEntry}, near-end=${nearEnd}, delta=${Math.abs(nearEnd - preEntry)}`,
  )
  check(
    'motion is monotonic through the crossing — real scroll-linked progress, not noise',
    preEntry <= midCrossing && midCrossing <= nearEnd,
    `pre-entry=${preEntry}, mid-crossing=${midCrossing}, near-end=${nearEnd}`,
  )
  check(
    'once scrolled well past its entry range, translate correctly holds at the terminal value',
    Math.abs(wellPast - 100) < 1,
    `well-past=${wellPast}`,
  )

  await context.close()
  return results
}
