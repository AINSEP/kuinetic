import { fileURLToPath } from 'node:url'
import { burstSample, createChecker, createFrameRecorder } from '../../scripts/browser-harness.mjs'

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
 * Drag movement and the spring return are both continuous motion, not discrete state — a single
 * before/after frame pair proves the endpoints but says nothing about whether tracking stayed 1:1
 * throughout the drag or whether the spring return actually moved smoothly toward the origin
 * instead of, say, sitting frozen. Both are burst-sampled at several points instead.
 *
 * The `elastic-pull` and `swipe` checks are regression guards for a defect that used to reproduce
 * here: `src/core/gesture.ts`'s `recognise()` did not call `setPointerCapture`, so once an
 * element's rendered position diverged from the real cursor position — which rubber-band
 * resistance causes by design, and which `swipeable` causes always, since it never repositions the
 * element — the browser's native hit-testing delivered `pointerup` to whatever was now under the
 * cursor instead of the gesture's target, and the recognizer's listeners never saw it. Fixed by
 * capturing the pointer on `pointerdown` and releasing it on `pointerup`/`pointercancel`; see
 * `docs/browser-findings.md` for the original defect-finding write-up. A synthetic
 * `dispatchEvent(new PointerEvent('pointerup'))` on the target element — the shortcut this suite
 * deliberately avoids — bypasses hit-testing entirely and cannot reproduce this; that is exactly
 * why the dispatch asked for genuine `page.mouse` interaction.
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

/** Cumulative (dx, dy) targets for a burst-sampled 80px×40px drag, four steps of equal size. */
const DRAG_BURST_TARGETS = [
  { dx: 20, dy: 10 },
  { dx: 40, dy: 20 },
  { dx: 60, dy: 30 },
  { dx: 80, dy: 40 },
]

/**
 * Move the real pointer through several intermediate points of a drag, sampling
 * `data-dsg-dragging`/`translate` and a frame at each — proof that 1:1 tracking holds
 * continuously through the gesture, not only at wherever the mouse happens to end up.
 *
 * @complexity O(t) browser round trips in the number of targets.
 * @overallScore 100
 */
async function burstSampleDragMovement(page, snap, selector, box, label, targets) {
  const samples = []
  for (const [index, target] of targets.entries()) {
    await page.mouse.move(box.x + target.dx, box.y + target.dy, { steps: 3 })
    samples.push(await readGestureState(page, selector))
    await snap(page, `${label}-${index + 1}-of-${targets.length}-dx${target.dx}`)
  }
  return samples
}

/**
 * Drive a real mouse-down-move-up drag and confirm the plain `drag` primitive tracks the pointer
 * 1:1 at every sampled point of the movement — not just the final one — and rests exactly where
 * it was released, once residual velocity has decayed to zero.
 *
 * @complexity O(1) browser round trips.
 * @overallScore 100
 */
async function checkPlainDrag(page, check, snap) {
  const box = await centerOf(page, '#drag')
  await page.mouse.move(box.x, box.y)
  await page.mouse.down()

  const samples = await burstSampleDragMovement(page, snap, '#drag', box, 'drag-movement', DRAG_BURST_TARGETS)

  check(
    'draggable marks data-dsg-dragging during a real pointer drag',
    samples[0].dragging === 'true',
    `dragging=${samples[0].dragging}`,
  )
  const tracks1to1 = samples.every(
    (s, i) => approx(s.tx, DRAG_BURST_TARGETS[i].dx, 2) && approx(s.ty, DRAG_BURST_TARGETS[i].dy, 2),
  )
  check(
    'draggable translate tracks real pointer movement 1:1 continuously, not just at the end',
    tracks1to1,
    samples.map((s, i) => `dx${DRAG_BURST_TARGETS[i].dx}→${s.translate}`).join(', '),
  )

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

/** Cumulative raw pointer dx for a burst-sampled elastic drag; the last two exceed bounds:80. */
const ELASTIC_BURST_TARGETS = [{ dx: 40, dy: 0 }, { dx: 80, dy: 0 }, { dx: 115, dy: 0 }, { dx: 150, dy: 0 }]

/** ~100ms cadence across an 800ms spring settle. */
const SPRING_BURST_FRACTIONS = [0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1.0]

/**
 * Drag `elastic-pull` past its configured bounds, sampling resistance at several points of the
 * movement, then release and burst-sample the spring's return to the origin.
 *
 * The spring-return check asserts two things, not one: the motion must be monotonic toward zero
 * (real physics — `DEFAULT_SPRING`'s damping ratio is ≈0.89, technically underdamped, so a hair of
 * overshoot is legitimate and the tolerance absorbs it) *and* it must actually move a meaningful
 * distance. Without the second half, a permanently frozen offset — exactly the pointer-capture
 * defect this suite already found — would read as trivially "monotonic" and falsely pass.
 *
 * @complexity O(1) browser round trips plus O(t) for each burst.
 * @overallScore 100
 */
async function checkElasticPull(page, check, snap) {
  const box = await centerOf(page, '#elastic')
  await page.mouse.move(box.x, box.y)
  await page.mouse.down()

  const dragSamples = await burstSampleDragMovement(
    page,
    snap,
    '#elastic',
    box,
    'elastic-resisted',
    ELASTIC_BURST_TARGETS,
  )
  const alwaysResisted = dragSamples.every((s, i) => s.tx > 0 && s.tx < ELASTIC_BURST_TARGETS[i].dx)
  const resistanceGrows = dragSamples.every((s, i) => i === 0 || s.tx >= dragSamples[i - 1].tx)
  check(
    'elastic-pull resists throughout the movement, not just at the final point',
    alwaysResisted && resistanceGrows,
    dragSamples.map((s, i) => `dx${ELASTIC_BURST_TARGETS[i].dx}→${s.translate}`).join(', '),
  )

  await page.waitForTimeout(VELOCITY_DECAY_MS)
  await page.mouse.up()
  const released = await readGestureState(page, '#elastic')
  check(
    'elastic-pull clears data-dsg-dragging after pointerup (pointer capture)',
    released.dragging === 'false',
    `dragging=${released.dragging}`,
  )

  const { samples: returnSamples } = await burstSample({
    page,
    snap,
    label: 'elastic-spring-return',
    durationMs: SPRING_SETTLE_MS,
    fractions: SPRING_BURST_FRACTIONS,
    read: (p) => p.$eval('#elastic', (el) => el.style.getPropertyValue('translate')),
  })
  const returnMagnitudes = returnSamples.map((t) => Math.abs(Number.parseFloat(t) || 0))
  const monotonicReturn = returnMagnitudes.every((m, i) => i === 0 || m <= returnMagnitudes[i - 1] + 2)
  const meaningfulMovement = returnMagnitudes[0] - returnMagnitudes[returnMagnitudes.length - 1] > 10
  check(
    'elastic-pull spring-return moves smoothly and meaningfully back to the origin',
    monotonicReturn && meaningfulMovement,
    `translate.x magnitude at ${SPRING_BURST_FRACTIONS.map((f) => `${Math.round(f * 100)}%`).join('/')}: ` +
      returnMagnitudes.map((m) => m.toFixed(1)).join(', '),
  )
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
    `data-dsg-swipe=${direction}`,
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
