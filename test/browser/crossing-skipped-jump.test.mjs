import { fileURLToPath } from 'node:url'
import { createChecker } from '../../scripts/browser-harness.mjs'

/**
 * A reader who skipped past a four-way `actions:` element and then came back must be told they
 * came back.
 *
 * The gesture is a scroll that lands in a single frame — an `<a href="#anchor">` click,
 * `scrollIntoView()`, `scrollTo({ behavior: 'instant' })`, scroll restoration. It carries the
 * element from "not intersecting" straight past to "not intersecting" on the far side, changing
 * neither `isIntersecting` nor the threshold ratio at any frame the browser samples, so the
 * observer delivers *no entry at all* for either crossing. `binding.outside` is then left
 * describing a position the reader is nowhere near, and the next real delivery classified against
 * it comes out backwards: measured in Chrome before the fix, a reader scrolling back up through a
 * skipped element got `enter` where `enter-back` was authored.
 *
 * Only a real browser can carry this. The unit suite can *model* a skip — by simply not delivering
 * an entry, which is exactly what the browser does — but it cannot show that the browser really
 * drops both crossings on this gesture, and that fact is the whole premise. So the first check
 * below asserts the drop itself, against a wrapped `IntersectionObserver` in the fixture: if a
 * future engine starts delivering an entry there, this suite says so rather than silently becoming
 * a test of nothing.
 *
 * `End`-key paging deliberately does *not* reach this and is not tested here: Chrome animates
 * keyboard scrolling over several frames, so the observer samples the crossings normally. The
 * trigger is not "a big scroll", it is "a scroll that lands in one frame".
 */
export const name = 'crossing-skipped-jump'

const FIXTURE_URL = `file://${fileURLToPath(new URL('./fixtures/crossing-skipped-jump.html', import.meta.url))}`

/** Long enough for a scroll to settle and its intersection callbacks to be delivered. */
const SETTLE_MS = 350

async function jumpTo(page, y) {
  await page.evaluate((to) => window.__jump(to), y)
  await page.waitForTimeout(SETTLE_MS)
  return page.evaluate(() => window.__read())
}

export async function run({ browser }) {
  const { check, results } = createChecker()

  const context = await browser.newContext({ viewport: { width: 800, height: 600 } })
  const page = await context.newPage()

  await page.goto(FIXTURE_URL)
  await page.waitForFunction(() => window.__kui !== undefined)
  await page.waitForTimeout(SETTLE_MS)

  const start = await page.evaluate(() => window.__read())
  // The element's visible window, so the two jumps below are provably clear of it on both sides.
  const enters = start.docTop - start.vh
  const leaves = start.docTop + 60
  check(
    'the fixture puts the element well below the fold, with room to jump past it',
    start.docTop > start.vh && start.playState !== 'running',
    `docTop=${start.docTop}, vh=${start.vh}, playState=${start.playState}`,
  )

  const past = await jumpTo(page, leaves + 2000)
  check(
    'a single-frame jump clean past the element delivers no intersection entry at all',
    past.deliveries === start.deliveries,
    `deliveries ${start.deliveries} -> ${past.deliveries} across the element's visible window ` +
      `(${enters}..${leaves}); if these ever differ the engine has stopped dropping the crossings ` +
      `and the classification check below no longer proves anything`,
  )
  check(
    'and so nothing ran while the reader was past it',
    past.playState !== 'running',
    `playState=${past.playState}`,
  )

  // Back into the element's window, travelling backwards. `enter` is `none` and `enter-back` is
  // `play`, so "did it start" *is* "which crossing did it get".
  const back = await jumpTo(page, leaves - 200)
  check(
    'arriving again travelling backwards is enter-back, not enter',
    back.playState === 'running',
    `playState=${back.playState}, last entry=${JSON.stringify(back.last)} — ` +
      `'none' (enter) leaves it un-started, 'play' (enter-back) starts it`,
  )

  // The un-skipped path must be unchanged: from above the element, going forwards, this is a
  // first arrival and `none` must leave it alone.
  await page.goto(FIXTURE_URL)
  await page.waitForFunction(() => window.__kui !== undefined)
  await page.waitForTimeout(SETTLE_MS)
  const forwards = await jumpTo(page, enters + 200)
  check(
    'a first arrival travelling forwards is still a plain enter',
    forwards.playState !== 'running' && forwards.deliveries > 0,
    `playState=${forwards.playState}, deliveries=${forwards.deliveries}`,
  )

  await context.close()
  return results
}
