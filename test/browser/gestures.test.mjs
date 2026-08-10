import { fileURLToPath } from 'node:url'
import { createChecker, createFrameRecorder } from '../../scripts/browser-harness.mjs'

/**
 * Real pointer events for the gesture family.
 *
 * `docs/HANDOFF.md` asked for genuine `page.mouse`/`page.touchscreen` interaction rather than
 * `dispatchEvent(new PointerEvent(...))` shortcuts — a hand-dispatched event can carry any
 * coordinates or omit `movementX`/timing altogether, so it cannot prove the recogniser actually
 * reacts to a moving input device. This suite drives real mouse-generated pointer events through
 * three primitives: plain `drag` (no return, no inertia), `elastic-pull` (bounds resistance plus a
 * spring return), and `swipe` (velocity-gated direction detection).
 *
 * The `elastic-pull` and `swipe` checks are defect-finding, not regression guards, and are
 * expected to fail: `src/core/gesture.ts`'s `recognise()` never calls `setPointerCapture`, so once
 * an element's rendered position diverges from the real cursor position — which rubber-band
 * resistance causes by design, and which `swipeable` causes always, since it never repositions the
 * element — the browser's native hit-testing delivers `pointerup` to whatever is now under the
 * cursor instead of the gesture's target, and the recognizer's listeners never see it. See
 * `docs/browser-findings.md`. `src/` is out of scope for this dispatch, so it is reported here, not
 * patched. A synthetic `dispatchEvent(new PointerEvent('pointerup'))` on the target element — the
 * shortcut this suite deliberately avoids — bypasses hit-testing entirely and cannot reproduce
 * this; that is exactly why the dispatch asked for genuine `page.mouse` interaction.
 */
export const name = 'gestures'

const FIXTURE_URL = `file://${fileURLToPath(new URL('./fixtures/gestures.html', import.meta.url))}`

/**
 * Pause long enough that the gesture recogniser's 100ms velocity window has fully aged out, so a
 * release afterward carries zero residual velocity. Without this, `settle()`'s free-throw term
 * (`vector.vx * 0.2`) makes the resting position depend on exactly how the automation happened to
 * time its last move, not on the drag distance under test.
 */
const VELOCITY_DECAY_MS = 150
const SPRING_SETTLE_MS = 800

async function centerOf(page, selector) {
  return page.$eval(selector, (el) => {
    const rect = el.getBoundingClientRect()
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
  })
}

async function readGestureState(page, selector) {
  return page.$eval(selector, (el) => {
    const [tx, ty] = el.style.getPropertyValue('translate').split(' ').map(Number.parseFloat)
    return {
      dragging: el.getAttribute('data-dsg-dragging'),
      swipe: el.getAttribute('data-dsg-swipe'),
      translate: el.style.getPropertyValue('translate'),
      tx,
      ty,
    }
  })
}

const approx = (actual, expected, tolerance) => Math.abs(actual - expected) <= tolerance

/**
 * Drive a real mouse-down-move-up drag and confirm the plain `drag` primitive both tracks the
 * pointer 1:1 mid-gesture and rests exactly where it was released, once residual velocity has
 * decayed to zero.
 *
 * @complexity O(1) browser round trips.
 * @overallScore 100
 */
async function checkPlainDrag(page, check, snap) {
  const box = await centerOf(page, '#drag')
  await page.mouse.move(box.x, box.y)
  await page.mouse.down()
  await page.mouse.move(box.x + 80, box.y + 40, { steps: 10 })

  const mid = await readGestureState(page, '#drag')
  check(
    'draggable marks data-dsg-dragging during a real pointer drag',
    mid.dragging === 'true',
    `dragging=${mid.dragging}`,
  )
  check(
    'draggable translate tracks real pointer movement 1:1',
    approx(mid.tx, 80, 2) && approx(mid.ty, 40, 2),
    `translate=${mid.translate}`,
  )
  await snap(page, 'drag-mid-gesture')

  await page.waitForTimeout(VELOCITY_DECAY_MS)
  await page.mouse.up()
  const released = await readGestureState(page, '#drag')
  check(
    'draggable clears data-dsg-dragging on release',
    released.dragging === 'false',
    `dragging=${released.dragging}`,
  )

  await page.waitForTimeout(SPRING_SETTLE_MS)
  const settled = await readGestureState(page, '#drag')
  check(
    'plain drag rests exactly where it was released (no return, no residual velocity)',
    approx(settled.tx, 80, 3) && approx(settled.ty, 40, 3),
    `translate=${settled.translate}`,
  )
  await snap(page, 'drag-settled')
}

/**
 * Drag `elastic-pull` past its configured bounds and confirm rubber-band resistance damps the
 * tracked offset, then confirm a spring return actually carries it back to the origin.
 *
 * @complexity O(1) browser round trips.
 * @overallScore 100
 */
async function checkElasticPull(page, check, snap) {
  const box = await centerOf(page, '#elastic')
  await page.mouse.move(box.x, box.y)
  await page.mouse.down()
  await page.mouse.move(box.x + 150, box.y, { steps: 12 }) // 150px against bounds:80

  const mid = await readGestureState(page, '#elastic')
  check(
    'elastic-pull resists past its bounds instead of tracking the pointer 1:1',
    mid.tx > 0 && mid.tx < 150,
    `translate=${mid.translate} (raw pointer delta was 150px)`,
  )
  await snap(page, 'elastic-mid-resisted')

  await page.waitForTimeout(VELOCITY_DECAY_MS)
  await page.mouse.up()
  const released = await readGestureState(page, '#elastic')
  check(
    'elastic-pull clears data-dsg-dragging after pointerup (pointer capture)',
    released.dragging === 'false',
    `dragging=${released.dragging} — release landed outside the element once resistance made ` +
      'its rendered position lag the real cursor; see docs/browser-findings.md',
  )

  await page.waitForTimeout(SPRING_SETTLE_MS)
  const settled = await readGestureState(page, '#elastic')
  check(
    'elastic-pull springs back to the origin on release',
    Math.abs(settled.tx) < 2 && Math.abs(settled.ty) < 2,
    `translate=${settled.translate}`,
  )
  await snap(page, 'elastic-settled-at-origin')
}

/**
 * Drive a fast real-pointer flick — several moves with real elapsed time between them, so the
 * recogniser's velocity window sees genuine non-zero timestamps — and confirm `swipeable`
 * publishes the direction.
 *
 * @complexity O(1) browser round trips.
 * @overallScore 100
 */
async function checkSwipe(page, check, snap) {
  const box = await centerOf(page, '#swipe')
  await page.mouse.move(box.x, box.y)
  await page.mouse.down()
  for (let i = 1; i <= 4; i++) {
    await page.mouse.move(box.x + i * 30, box.y)
    await page.waitForTimeout(15)
  }
  await page.mouse.up()
  await page.waitForTimeout(50)

  const direction = await page.$eval('#swipe', (el) => el.getAttribute('data-dsg-swipe'))
  check(
    'a fast real-pointer flick is recognised as a rightward swipe',
    direction === 'right',
    `data-dsg-swipe=${direction} — swipeable never repositions its element, so the cursor always ` +
      'ends the gesture outside it; see docs/browser-findings.md',
  )
  await snap(page, 'swipe-detected')
}

export async function run({ browser, ARTIFACT_DIR }) {
  const { check, results } = createChecker()
  const snap = createFrameRecorder(`${ARTIFACT_DIR}/frames/${name}`)

  const context = await browser.newContext({ viewport: { width: 900, height: 400 } })
  const page = await context.newPage()

  await page.goto(FIXTURE_URL)
  await page.waitForFunction(() => window.__dsg !== undefined)
  await snap(page, 'initial-load')

  await checkPlainDrag(page, check, snap)
  await checkElasticPull(page, check, snap)
  await checkSwipe(page, check, snap)

  await context.close()
  return results
}
