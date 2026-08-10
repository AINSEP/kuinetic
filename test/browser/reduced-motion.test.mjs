import { fileURLToPath } from 'node:url'
import { createChecker, createFrameRecorder } from '../../scripts/browser-harness.mjs'

/**
 * Reduced motion genuinely prevents JS-driven effects, not just CSS ones.
 *
 * `scripts/verify-browser.mjs` only proves a CSS-tier `on:enter` reveal shows content immediately
 * under `prefers-reduced-motion: reduce` — a `fill-mode: both` animation that is simply never
 * un-paused. It says nothing about `reducedMotion: 'disable'` primitives, which are JS-rendered and
 * gate through a completely different path (`deferredInstance` never running its `setup`). This
 * suite proves the *listener never attaches at all*: a pinned section never gets
 * `position: sticky`, and a real mouse drag on a `draggable` element produces no
 * `data-dsg-dragging` attribute and no `translate` write whatsoever — not merely a calmer version
 * of the effect, but no JS execution at all, which is the only way `'disable'` can bind a
 * JS-rendered primitive per `src/core/animator.ts`'s `openGate`.
 */
export const name = 'reduced-motion'

const FIXTURE_URL = `file://${fileURLToPath(new URL('./fixtures/reduced-motion.html', import.meta.url))}`

async function loadPage(browser, { reduce }) {
  const context = await browser.newContext({ viewport: { width: 900, height: 700 } })
  const page = await context.newPage()
  if (reduce) await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto(FIXTURE_URL)
  await page.waitForFunction(() => window.__dsg !== undefined)
  await page.waitForTimeout(200)
  return { context, page }
}

async function attemptDrag(page) {
  const box = await page.$eval('#drag', (el) => {
    const rect = el.getBoundingClientRect()
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
  })
  await page.mouse.move(box.x, box.y)
  await page.mouse.down()
  await page.mouse.move(box.x + 80, box.y + 40, { steps: 10 })
  await page.mouse.up()
}

/**
 * Confirm the pin primitive's `prepare` body never ran under reduced motion: no `position:
 * sticky`, and the reverse under normal motion as a control proving the fixture itself works.
 *
 * @complexity O(1) browser round trips per call.
 * @overallScore 100
 */
async function checkPinNeverActivates(browser, check, snap) {
  const normal = await loadPage(browser, { reduce: false })
  const normalPosition = await normal.page.$eval('#pinned', (el) => getComputedStyle(el).position)
  check(
    'control: pin-section applies sticky positioning under normal motion',
    normalPosition === 'sticky',
    `position=${normalPosition}`,
  )
  await snap(normal.page, 'pin-normal-motion-sticky')
  await normal.context.close()

  const reduced = await loadPage(browser, { reduce: true })
  const reducedPosition = await reduced.page.$eval('#pinned', (el) => getComputedStyle(el).position)
  check(
    'reduced motion: pin-section never applies sticky positioning (JS body never ran)',
    reducedPosition !== 'sticky',
    `position=${reducedPosition}`,
  )
  await snap(reduced.page, 'pin-reduced-motion-static')
  await reduced.context.close()
}

/**
 * Confirm a real mouse drag under reduced motion never attaches the recogniser: no dragging
 * attribute, no translate write, contrasted with the same drag succeeding under normal motion.
 *
 * @complexity O(1) browser round trips per call.
 * @overallScore 100
 */
async function checkDraggableNeverAttaches(browser, check, snap) {
  const normal = await loadPage(browser, { reduce: false })
  await attemptDrag(normal.page)
  const normalState = await normal.page.$eval('#drag', (el) => ({
    dragging: el.getAttribute('data-dsg-dragging'),
    translate: el.style.getPropertyValue('translate'),
  }))
  check(
    'control: a real drag under normal motion writes translate and dragging state',
    normalState.dragging === 'false' && normalState.translate !== '',
    `dragging=${normalState.dragging}, translate=${normalState.translate}`,
  )
  await snap(normal.page, 'drag-normal-motion-active')
  await normal.context.close()

  const reduced = await loadPage(browser, { reduce: true })
  await attemptDrag(reduced.page)
  const reducedState = await reduced.page.$eval('#drag', (el) => ({
    dragging: el.getAttribute('data-dsg-dragging'),
    translate: el.style.getPropertyValue('translate'),
  }))
  check(
    'reduced motion: a real drag never attaches the recogniser (no attribute, no write, ever)',
    reducedState.dragging === null && reducedState.translate === '',
    `dragging=${reducedState.dragging}, translate="${reducedState.translate}"`,
  )
  await snap(reduced.page, 'drag-reduced-motion-inert')
  await reduced.context.close()
}

export async function run({ browser, ARTIFACT_DIR }) {
  const { check, results } = createChecker()
  const snap = createFrameRecorder(`${ARTIFACT_DIR}/frames/${name}`)

  await checkPinNeverActivates(browser, check, snap)
  await checkDraggableNeverAttaches(browser, check, snap)

  return results
}
