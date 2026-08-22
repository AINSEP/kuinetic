import { fileURLToPath } from 'node:url'
import { createChecker } from '../../scripts/browser-harness.mjs'

/**
 * Every name in the gesture catalog, driven by a real pointer, each against its own contract.
 *
 * `gestures.test.mjs` goes deep on three names — 1:1 tracking, resistance curve, spring return.
 * This goes wide on all thirteen, because the two bugs found on 2026-08-22 were not failures of
 * depth. Both were parameters the deep suite happened to hold constant:
 *
 *   - it dragged **once**, and a second pickup reset the element to the origin;
 *   - it paused 150ms before `pointerup`, and a fast release carried a plain `drag` past the finger.
 *
 * So the checks here are chosen to vary what the deep suite fixes: how many times you interact, how
 * fast you let go, which axis you push, and whether the pointer arrives or leaves. Each assertion
 * is the *distinguishing* property of its preset — the thing that would be true of the wrong effect
 * if the preset table in `src/effects/gestures/index.ts` were wired up incorrectly.
 */
export const name = 'gesture-sweep'

const FIXTURE_URL = `file://${fileURLToPath(new URL('./fixtures/gesture-sweep.html', import.meta.url))}`

/** How long the springs need to come to rest after a release. */
const SETTLE_MS = 900

const near = (actual, expected, tolerance) => Math.abs(actual - expected) <= tolerance

/**
 * Scroll a chip into view and give the observer a beat to activate it.
 *
 * Not optional. Every gesture here is a `prepare`d effect behind the default `on:enter`, so a chip
 * below the fold is never wired up at all — it reports no pull, no swipe, no press, and looks
 * exactly like a broken effect. The first run of this sweep "found" four bugs that were entirely
 * this: the last row of the grid sat under the viewport.
 */
async function focus(page, id) {
  await page.locator(`#${id}`).scrollIntoViewIfNeeded()
  await page.waitForTimeout(250)
}

/** The `translate` the primitive has written, as numbers. Never the `transform` shorthand. */
async function offsetOf(page, id) {
  return page.$eval(`#${id}`, (el) => {
    const [x, y] = getComputedStyle(el).translate.split(' ')
    return { x: Number.parseFloat(x) || 0, y: Number.parseFloat(y) || 0 }
  })
}

/**
 * Press, move in `steps` increments, release. `holdMs` before the release is the knob that decides
 * whether the gesture ends fast (velocity intact, inertia engages) or slow (velocity decayed).
 */
async function dragBy(page, id, dx, dy, { steps = 8, stepMs = 16, holdMs = 0 } = {}) {
  const box = await page.locator(`#${id}`).boundingBox()
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  for (let step = 1; step <= steps; step++) {
    await page.mouse.move(x + (dx * step) / steps, y + (dy * step) / steps)
    await page.waitForTimeout(stepMs)
  }
  if (holdMs > 0) await page.waitForTimeout(holdMs)
  await page.mouse.up()
  await page.waitForTimeout(SETTLE_MS)
}

export async function run({ browser }) {
  const { check, results } = createChecker()
  const context = await browser.newContext({ viewport: { width: 1300, height: 1000 } })
  const page = await context.newPage()
  await page.goto(FIXTURE_URL)
  await page.waitForFunction(() => window.__kui !== undefined)

  // --- axis locking: the distinguishing property of drag-x and drag-y -------------------------
  for (const [id, expected] of [
    ['drag', { x: 90, y: 60 }],
    ['drag-x', { x: 90, y: 0 }],
    ['drag-y', { x: 0, y: 60 }],
  ]) {
    await focus(page, id)
    await dragBy(page, id, 90, 60, { holdMs: 160 })
    const settled = await offsetOf(page, id)
    check(
      `${id} moves on exactly the axes it allows`,
      near(settled.x, expected.x, 4) && near(settled.y, expected.y, 4),
      `translate=${settled.x.toFixed(1)},${settled.y.toFixed(1)} expected ${expected.x},${expected.y}`,
    )
  }

  // --- accumulation: the bug that shipped ------------------------------------------------------
  for (const id of ['drag', 'drag-x', 'drag-inertia', 'throwable']) {
    await focus(page, id)
    const before = await offsetOf(page, id)
    await dragBy(page, id, 40, 0, { holdMs: 160 })
    const after = await offsetOf(page, id)
    check(
      `${id} continues from where it rests when picked up again`,
      after.x > before.x + 30,
      `x ${before.x.toFixed(1)} → ${after.x.toFixed(1)} after a further +40 drag`,
    )
  }

  // --- release speed: the other bug that shipped ----------------------------------------------
  // A plain `drag` must land in the same place whether you stop first or let go at speed. An
  // inertial one must not: that difference is the entire point of the two names.
  await focus(page, 'drag')
  const restBefore = await offsetOf(page, 'drag')
  await dragBy(page, 'drag', 50, 0, { steps: 5, stepMs: 8, holdMs: 0 })
  const restFast = await offsetOf(page, 'drag')
  check(
    'plain drag ignores release velocity — it stops where the finger stopped',
    near(restFast.x - restBefore.x, 50, 5),
    `moved ${(restFast.x - restBefore.x).toFixed(1)}px for a 50px flick (a carry would overshoot)`,
  )

  await focus(page, 'drag-inertia')
  const inertiaBefore = await offsetOf(page, 'drag-inertia')
  await dragBy(page, 'drag-inertia', 50, 0, { steps: 5, stepMs: 8, holdMs: 0 })
  const inertiaAfter = await offsetOf(page, 'drag-inertia')
  check(
    'drag-inertia does carry past the release point, which is what distinguishes it from drag',
    inertiaAfter.x - inertiaBefore.x > 55,
    `moved ${(inertiaAfter.x - inertiaBefore.x).toFixed(1)}px for the same 50px flick`,
  )

  // --- the returning family --------------------------------------------------------------------
  for (const id of ['elastic-pull', 'rubber-band', 'snap-back']) {
    await focus(page, id)
    await dragBy(page, id, 140, 0, { holdMs: 160 })
    const settled = await offsetOf(page, id)
    check(
      `${id} springs back to its origin after release`,
      near(settled.x, 0, 3) && near(settled.y, 0, 3),
      `translate=${settled.x.toFixed(2)},${settled.y.toFixed(2)}`,
    )
  }

  // Resistance is what separates the returning family from a plain drag that snaps home: the
  // element must lag the pointer well before the release, not track it and then jump back.
  {
    await focus(page, 'rubber-band')
    const box = await page.locator('#rubber-band').boundingBox()
    const x = box.x + box.width / 2
    const y = box.y + box.height / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    for (let step = 1; step <= 6; step++) {
      await page.mouse.move(x + step * 40, y)
      await page.waitForTimeout(16)
    }
    const pulled = await offsetOf(page, 'rubber-band')
    await page.mouse.up()
    await page.waitForTimeout(SETTLE_MS)
    check(
      'rubber-band resists past its bounds instead of tracking the pointer 1:1',
      pulled.x > 40 && pulled.x < 200,
      `pointer moved 240px, element reached ${pulled.x.toFixed(1)}px`,
    )
  }

  // --- swipe, and the axis filter on swipe-x ---------------------------------------------------
  async function flick(id, dx, dy) {
    await focus(page, id)
    const box = await page.locator(`#${id}`).boundingBox()
    const x = box.x + box.width / 2
    const y = box.y + box.height / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    for (let step = 1; step <= 5; step++) {
      await page.mouse.move(x + (dx * step) / 5, y + (dy * step) / 5)
      await page.waitForTimeout(6)
    }
    await page.mouse.up()
    await page.waitForTimeout(120)
    return page.$eval(`#${id}`, (el) => el.getAttribute('data-kui-swipe'))
  }

  check('swipe reports the direction of a fast horizontal flick', (await flick('swipe', 160, 0)) === 'right', '')
  check('swipe reports a vertical flick too', (await flick('swipe', 0, 160)) === 'down', '')
  check(
    'swipe-x reports horizontal flicks',
    (await flick('swipe-x', 160, 0)) === 'right',
    'the axis filter must not suppress the axis it is for',
  )
  const verticalOnX = await flick('swipe-x', 0, 160)
  check(
    'swipe-x ignores a vertical flick rather than reporting it',
    verticalOnX !== 'up' && verticalOnX !== 'down',
    `data-kui-swipe=${verticalOnX}`,
  )

  // --- long-press: the timing is the contract ---------------------------------------------------
  {
    await focus(page, 'long-press')
    const box = await page.locator('#long-press').boundingBox()
    const x = box.x + box.width / 2
    const y = box.y + box.height / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.waitForTimeout(120)
    const early = await page.$eval('#long-press', (el) => el.getAttribute('data-kui-pressed'))
    await page.waitForTimeout(700)
    const late = await page.$eval('#long-press', (el) => el.getAttribute('data-kui-pressed'))
    await page.mouse.up()
    await page.waitForTimeout(120)
    const released = await page.$eval('#long-press', (el) => el.getAttribute('data-kui-pressed'))

    check('long-press has not engaged 120ms in', early !== 'true', `pressed=${early}`)
    check('long-press engages once the hold is long enough', late === 'true', `pressed=${late}`)
    check('long-press disengages on release', released !== 'true', `pressed=${released}`)
  }

  // --- magnetic: the pointer never touches it, it just comes near ------------------------------
  for (const id of ['magnetic', 'magnetic-snap']) {
    await focus(page, id)
    const box = await page.locator(`#${id}`).boundingBox()
    const centreX = box.x + box.width / 2
    const centreY = box.y + box.height / 2
    // Just outside the chip but well inside the field, so any pull is unambiguous.
    await page.mouse.move(centreX + 70, centreY)
    await page.waitForTimeout(400)
    const attracted = await offsetOf(page, id)
    // Somewhere still inside the viewport, but well outside the 120px field. Moving the pointer
    // *past* the viewport edge dispatches nothing, and the element stays pulled — which reads as a
    // failure to release when it is really a failure to send the event.
    await page.mouse.move(8, 8)
    await page.waitForTimeout(SETTLE_MS)
    const released = await offsetOf(page, id)

    check(
      `${id} is pulled toward a pointer that comes near without touching it`,
      attracted.x > 2,
      `translate.x=${attracted.x.toFixed(2)} with the pointer 70px to its right`,
    )
    check(
      `${id} returns to rest once the pointer leaves its field`,
      near(released.x, 0, 2) && near(released.y, 0, 2),
      `translate=${released.x.toFixed(2)},${released.y.toFixed(2)}`,
    )
  }

  await context.close()
  return results
}
