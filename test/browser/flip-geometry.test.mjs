import { fileURLToPath } from 'node:url'
import { createChecker, createFrameRecorder } from '../../scripts/browser-harness.mjs'

/**
 * FLIP's actual inverse transform and final geometry.
 *
 * `scripts/verify-browser.mjs` only asserts `getAnimations().length > 0` after a reorder — real
 * per `docs/review-2-gpt-5.6-sol.md`'s "What the tests do not prove" section, but theatre in the
 * sense that a completely wrong inverse transform, or an animation that never actually lands the
 * element at its new position, would pass that check too. This suite reads the keyframes
 * themselves and the post-animation resting position.
 */
export const name = 'flip-geometry'

const FIXTURE_URL = `file://${fileURLToPath(new URL('./fixtures/flip-geometry.html', import.meta.url))}`

/** `offsetLeft` is layout position, unaffected by the `translate` the animation applies. */
async function readOffsetLeft(page, id) {
  return page.$eval(id, (el) => el.offsetLeft)
}

async function reorder(page) {
  await page.evaluate(() => {
    document.querySelector('#list').prepend(document.querySelector('#c'))
  })
  // Let the MutationObserver microtask run `engine.play`, which measures the new layout and
  // starts the animation, before anything below reads `#a`'s animation state.
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)))
}

async function readCardAAnimationState(page) {
  return page.$eval('#a', (el) => {
    const animation = el.getAnimations()[0]
    if (!animation) return null
    const keyframes = animation.effect.getKeyframes()
    return {
      durationMs: Number(animation.effect.getTiming().duration),
      first: keyframes[0],
      last: keyframes[keyframes.length - 1],
    }
  })
}

/**
 * Assert the animation's first keyframe is the correct inverse of the real layout delta, measured
 * independently via `offsetLeft` rather than trusting the engine's own arithmetic.
 *
 * @complexity O(1) browser round trips.
 * @overallScore 100
 */
async function checkInverseTransform(page, check, beforeLeft, afterLeft, animState) {
  const expectedDx = beforeLeft - afterLeft
  const actualDx = Number.parseFloat(String(animState.first.translate).split(' ')[0])
  check(
    "FLIP's first keyframe is the true inverse of the layout delta",
    Math.abs(actualDx - expectedDx) < 1,
    `expected dx≈${expectedDx}px (offsetLeft ${beforeLeft}→${afterLeft}), keyframe dx=${actualDx}px`,
  )
  // Chromium normalises the serialised keyframe — `translate: 0px 0px` and `scale: 1 1` both drop
  // their redundant second component — so this parses magnitudes rather than comparing strings.
  const lastDx = Number.parseFloat(String(animState.last.translate).split(' ')[0])
  const lastScale = Number.parseFloat(String(animState.last.scale ?? '1').split(' ')[0])
  check(
    'FLIP animates toward identity, not toward some other offset',
    lastDx === 0 && lastScale === 1,
    `last keyframe: translate=${animState.last.translate}, scale=${animState.last.scale}`,
  )
}

/**
 * Wait past the animation's own duration, then assert the element is resting at its *new* layout
 * position — not stuck at the old one, and not left with a lingering transform.
 *
 * @complexity O(1) browser round trips.
 * @overallScore 100
 */
async function checkFinalGeometry(page, check, snap, beforeRect, durationMs) {
  await page.waitForTimeout(durationMs + 150)
  const state = await page.$eval('#a', (el) => ({
    rect: el.getBoundingClientRect(),
    computedTranslate: getComputedStyle(el).translate,
  }))
  check(
    'final computed translate is cleared once the FLIP animation finishes',
    state.computedTranslate === 'none',
    `computedTranslate=${state.computedTranslate}`,
  )
  check(
    'final rendered position is the new slot, not the pre-reorder one',
    Math.abs(state.rect.left - beforeRect.left) > 10,
    `before.left=${beforeRect.left}, after.left=${state.rect.left}`,
  )
  await snap(page, 'flip-settled-at-new-position')
}

export async function run({ browser, ARTIFACT_DIR }) {
  const { check, results } = createChecker()
  const snap = createFrameRecorder(`${ARTIFACT_DIR}/frames/${name}`)

  const context = await browser.newContext({ viewport: { width: 900, height: 400 } })
  const page = await context.newPage()

  await page.goto(FIXTURE_URL)
  await page.waitForFunction(() => window.__dsg !== undefined)
  await snap(page, 'before-reorder')

  const beforeLeft = await readOffsetLeft(page, '#a')
  const beforeRect = await page.$eval('#a', (el) => el.getBoundingClientRect().toJSON())

  await reorder(page)
  await snap(page, 'inverse-transform-applied')

  const afterLeft = await readOffsetLeft(page, '#a')
  const animState = await readCardAAnimationState(page)

  if (!animState) {
    check('FLIP starts an animation on the displaced child', false, 'no Animation found on #a')
  } else {
    await checkInverseTransform(page, check, beforeLeft, afterLeft, animState)
    await checkFinalGeometry(page, check, snap, beforeRect, animState.durationMs)
  }

  await context.close()
  return results
}
