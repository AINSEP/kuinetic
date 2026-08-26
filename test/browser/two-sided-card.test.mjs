import { fileURLToPath } from 'node:url'
import { createChecker, createFrameRecorder } from '../../scripts/browser-harness.mjs'

/**
 * Behavioural coverage for the two-sided-card rules `56d5e2a` added at `src/css/three-d.css`.
 *
 * `82ffe08` claimed those rules were "covered by the suites that passed". They were not: grepping
 * the whole `test/` tree for `nth-child(2)`, `backface-visibility`, "two-sided" and `preserve-3d`
 * returns nothing. `test/three-d.test.ts` and `test/three-d-perspective.test.ts` check keyframe
 * shape and registration metadata — that the CSS *text* is right — which is a different claim from
 * "the compositor picks the correct face", and the second one is the whole point of the rules.
 *
 * ## Why this cannot be a jsdom test
 *
 * `test/three-d.test.ts`'s own header says jsdom cannot lay out 3D transforms, and every claim
 * below is downstream of exactly that: which face paints is decided by the compositor from a
 * composed 3D matrix, and jsdom has neither. jsdom would also resolve `:has(> :nth-child(2))`
 * against no cascade at all — it does not load the compiled stylesheet — so the gate that
 * separates the one-sided and two-sided readings is not even evaluated there.
 *
 * ## What is measured, and how
 *
 * `document.elementFromPoint` at the card's rendered left-quarter, centre and right-quarter.
 * Verified before this file was written: Chromium's hit testing honours
 * `backface-visibility: hidden`, so a hit is proof the face genuinely painted, not merely that it
 * occupies the box. Each face is split into two hit-testable halves carrying `data-probe` names,
 * so one sample answers both "which face" and "did it arrive mirrored" — a screenshot would answer
 * the first and need a second mechanism for the second.
 *
 * Rects are re-read after each seek, because a 3D-turned card does not project onto its
 * untransformed footprint and a sample taken at the resting rect drifts off the card at precisely
 * the angles that matter.
 *
 * ## Negative controls
 *
 * Every behavioural claim here has a broken twin in the fixture, run in the same pass, so "this
 * passes" is never the only evidence that it means anything:
 *
 *   - `ts-y-wrong-axis` pre-turns the back face about X on a `card-flip-y`, the mistake
 *     `three-d.css`'s own comment warns about ("turned about the same axis the parent's keyframe
 *     turns, or the back would arrive mirrored").
 *   - `os-y-half-turn` forces a one-sided card back to the 180deg default, i.e. the state before
 *     `56d5e2a`'s `:not(:has(> :nth-child(2)))` override.
 *   - `os-y-backface-hidden` opts a one-sided card into `backface-visibility: hidden` inline,
 *     i.e. what a one-sided card would inherit if the `:has(> :nth-child(2))` gate were dropped.
 *
 * ## The nested-3D case
 *
 * `card-flip-x/-y` set `transform-style: preserve-3d` on themselves (`three-d.css`'s perspective
 * context rule), so nesting one inside another 3D-transformed, preserve-3d ancestor merges the
 * card's faces into the *ancestor's* 3D space — the hazard this repo has already been bitten by
 * twice (`fold-panel` broke, `wipe-circle` read reversed, `82ffe08` reverted). `nested-deep` and
 * `nested-flat` are the same card under the same 180deg-turned ancestor, differing only in
 * `transform-style`, so the finding is attributable to that one property.
 *
 * That pair is asserted as a *finding*, not as desired behaviour: it is what the platform does,
 * the library cannot change it, and the value of pinning it is that the day it stops being true —
 * or the day someone "fixes" it by putting a two-sided card inside an animated 3D frame again —
 * this file says so instead of a revert commit discovering it later.
 */
export const name = 'two-sided-card'

const FIXTURE_URL = `file://${fileURLToPath(new URL('./fixtures/two-sided-card.html', import.meta.url))}`

/** `rotate: y 180deg` and `rotate: x 180deg` as Chromium serialises them in a computed style. */
const ROTATE_Y_HALF = /^(y 180deg|0 1 0 180deg)$/
const ROTATE_X_HALF = /^(x 180deg|1 0 0 180deg)$/

/** Seek a card's animations to a fraction of their duration and report what paints where. */
async function probe(page, id, fraction) {
  return page.evaluate(([target, at]) => window.__probe(target, at), [id, fraction])
}

/** Read the declarations the two-sided rules are supposed to install. */
async function readStructure(page, id) {
  return page.$eval(`#${id}`, (card) => {
    const face = (child) => {
      if (!child) return undefined
      const style = getComputedStyle(child)
      return { backfaceVisibility: style.backfaceVisibility, gridArea: style.gridArea, rotate: style.rotate }
    }
    return {
      display: getComputedStyle(card).display,
      transformStyle: getComputedStyle(card).transformStyle,
      fromAngle: getComputedStyle(card).getPropertyValue('--kui-from-angle').trim(),
      first: face(card.children[0]),
      second: face(card.children[1]),
    }
  })
}

export async function run({ browser, ARTIFACT_DIR }) {
  const { check, results } = createChecker()
  const snap = createFrameRecorder(`${ARTIFACT_DIR}/frames/${name}`)

  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await context.newPage()
  await page.goto(FIXTURE_URL)
  await page.waitForFunction(() => window.__kui !== undefined)

  // Every card's `on:enter` has to have fired before any of this means anything — a hidden tab
  // delivers no intersection callbacks, and a fixture full of never-started animations would read
  // as "every card sits at its rest state", which is also what several of these checks expect at
  // fraction 0. This is what stops that being mistaken for a pass.
  const started = await page.evaluate(() =>
    [...document.querySelectorAll('[data-kui]')].map((el) => ({ id: el.id, state: el.getAttribute('data-kui-state'), animations: el.getAnimations().length })),
  )
  for (const card of started) {
    check(
      `${card.id} started (on:enter fired and it has a running animation to seek)`,
      card.state !== 'ready' && card.animations > 0,
      `state=${card.state}, animations=${card.animations}`,
    )
  }
  await snap(page, 'all-cards-at-rest')

  // --- the declarations the rules claim to install ---------------------------------------------
  const tsY = await readStructure(page, 'ts-y')
  const tsX = await readStructure(page, 'ts-x')
  const osY = await readStructure(page, 'os-y')

  for (const [id, structure] of [
    ['ts-y', tsY],
    ['ts-x', tsX],
  ]) {
    check(`${id} (two children) becomes a grid, so its faces stack in one cell`, structure.display === 'grid', `display=${structure.display}`)
    check(
      `${id} puts both faces in the same grid cell`,
      structure.first.gridArea.startsWith('1 / 1') && structure.second.gridArea.startsWith('1 / 1'),
      `first=${structure.first.gridArea}, second=${structure.second.gridArea}`,
    )
    check(
      `${id} hides both faces' backs, so only the one pointing at the viewer paints`,
      structure.first.backfaceVisibility === 'hidden' && structure.second.backfaceVisibility === 'hidden',
      `first=${structure.first.backfaceVisibility}, second=${structure.second.backfaceVisibility}`,
    )
  }

  check(
    'ts-y pre-turns its back face about Y — the same axis its own keyframe turns',
    ROTATE_Y_HALF.test(tsY.second.rotate),
    `rotate=${tsY.second.rotate}`,
  )
  check(
    'ts-x pre-turns its back face about X — the same axis its own keyframe turns',
    ROTATE_X_HALF.test(tsX.second.rotate),
    `rotate=${tsX.second.rotate}`,
  )

  check(
    'os-y (one child) is not turned into a grid — the two-sided reading stays off',
    osY.display !== 'grid',
    `display=${osY.display}`,
  )
  check(
    'os-y does not inherit backface-visibility: hidden, so it cannot vanish for half its own turn',
    osY.first.backfaceVisibility === 'visible',
    `backface-visibility=${osY.first.backfaceVisibility}`,
  )
  check(
    'os-y turns a full 360deg, not the two-sided 180deg default',
    osY.fromAngle === '360deg',
    `--kui-from-angle=${osY.fromAngle}`,
  )

  // --- behaviour: which face paints, and does it arrive the right way round ---------------------
  const tsYRest = await probe(page, 'ts-y', 0)
  await snap(page, 'ts-y-at-rest')
  check(
    'ts-y shows its front at rest, un-mirrored',
    tsYRest.left === 'front-left' && tsYRest.right === 'front-right',
    `left=${tsYRest.left}, right=${tsYRest.right}`,
  )

  const tsYTurned = await probe(page, 'ts-y', 1)
  await snap(page, 'ts-y-after-a-half-turn')
  check(
    'ts-y shows its back after a half turn, un-mirrored — the back arrives readable, not as its own mirror image',
    tsYTurned.left === 'back-left' && tsYTurned.right === 'back-right',
    `left=${tsYTurned.left}, right=${tsYTurned.right}`,
  )

  const tsXTurned = await probe(page, 'ts-x', 1)
  await snap(page, 'ts-x-after-a-half-turn')
  check(
    'ts-x shows its back after a half turn, un-mirrored',
    tsXTurned.left === 'back-left' && tsXTurned.right === 'back-right',
    `left=${tsXTurned.left}, right=${tsXTurned.right}`,
  )

  // Negative control for both of the above.
  const wrongAxis = await probe(page, 'ts-y-wrong-axis', 1)
  await snap(page, 'ts-y-wrong-axis-after-a-half-turn')
  check(
    '[negative control] a back face pre-turned about the wrong axis arrives reversed, so the two checks above are measuring the axis and not just "some back face showed up"',
    wrongAxis.left === 'back-right' && wrongAxis.right === 'back-left',
    `left=${wrongAxis.left}, right=${wrongAxis.right}`,
  )

  // --- the one-sided complement -----------------------------------------------------------------
  // Sampled at the same fraction on both cards rather than at a computed angle. The pair is what
  // validates the sample point: the control card vanishing there is proof the seek really did land
  // past 90deg, with the card's own front pointing away, which is the only place this claim means
  // anything. Asserting a fraction alone would silently degrade into a test of the resting state if
  // the preset's easing ever changed.
  const osYMid = await probe(page, 'os-y', 0.5)
  await snap(page, 'os-y-halfway-through-its-full-turn')
  check(
    'os-y still paints halfway through its turn, with its own front pointing away — the `:has(> :nth-child(2))` gate is what keeps it from vanishing here',
    !osYMid.left.startsWith('no-face') && !osYMid.centre.startsWith('no-face'),
    `left=${osYMid.left}, centre=${osYMid.centre}`,
  )

  const bfHidden = await probe(page, 'os-y-backface-hidden', 0.5)
  await snap(page, 'os-y-backface-hidden-halfway')
  check(
    '[negative control] the same card with backface-visibility: hidden does vanish at that point, so the check above is measuring the gate — and so the seek genuinely landed past 90deg',
    bfHidden.left.startsWith('no-face') && bfHidden.centre.startsWith('no-face'),
    `left=${bfHidden.left}, centre=${bfHidden.centre}`,
  )

  const osYEnd = await probe(page, 'os-y', 1)
  await snap(page, 'os-y-at-the-end-of-its-full-turn')
  check(
    'os-y lands on the face it started on, un-mirrored — a full turn ends facing forward',
    osYEnd.left === 'front-left' && osYEnd.right === 'front-right',
    `left=${osYEnd.left}, right=${osYEnd.right}`,
  )

  const halfTurn = await probe(page, 'os-y-half-turn', 1)
  await snap(page, 'os-y-half-turn-at-its-end')
  check(
    '[negative control] the same card forced back to 180deg ends mirrored — the defect 56d5e2a fixed, and proof the check above would catch its return',
    halfTurn.left === 'front-right' && halfTurn.right === 'front-left',
    `left=${halfTurn.left}, right=${halfTurn.right}`,
  )

  // --- nested inside another 3D-transformed ancestor ---------------------------------------------
  const nestedFlat = await probe(page, 'nested-flat', 0)
  const nestedDeep = await probe(page, 'nested-deep', 0)
  await snap(page, 'nested-cards-at-rest')

  check(
    'nested-flat: a two-sided card inside a flat (default transform-style) 180deg-turned ancestor keeps its own face selection — it still shows its front, and only the finished pixels are turned',
    nestedFlat.centre.startsWith('front'),
    `left=${nestedFlat.left}, centre=${nestedFlat.centre}, right=${nestedFlat.right}`,
  )

  check(
    'nested-deep: the same card inside a preserve-3d 180deg-turned ancestor shows its BACK at rest — the card joins the ancestor 3D space and its face selection inverts. Recorded as a platform finding: this is why 82ffe08 was reverted, and why a two-sided card must not be nested inside an animated 3D frame',
    nestedDeep.centre.startsWith('back'),
    `left=${nestedDeep.left}, centre=${nestedDeep.centre}, right=${nestedDeep.right}`,
  )

  check(
    'the nested pair differs only by transform-style, so the inversion is attributable to preserve-3d alone',
    nestedFlat.centre.startsWith('front') && nestedDeep.centre.startsWith('back'),
    `flat=${nestedFlat.centre}, preserve-3d=${nestedDeep.centre}`,
  )

  console.log('\n  --- what paints, by card and seek point (left / centre / right of the rendered card) ---')
  const table = [
    ['ts-y @0', tsYRest],
    ['ts-y @1', tsYTurned],
    ['ts-x @1', tsXTurned],
    ['ts-y-wrong-axis @1', wrongAxis],
    ['os-y @0.5', osYMid],
    ['os-y-backface-hidden @0.5', bfHidden],
    ['os-y @1', osYEnd],
    ['os-y-half-turn @1', halfTurn],
    ['nested-flat @0', nestedFlat],
    ['nested-deep @0', nestedDeep],
  ]
  for (const [label, sample] of table) {
    console.log(`  ${label.padEnd(28)} ${String(sample.left).padEnd(12)} ${String(sample.centre).padEnd(12)} ${String(sample.right).padEnd(12)} rect=${sample.rect.width}x${sample.rect.height}`)
  }
  console.log('')

  await context.close()
  return results
}
