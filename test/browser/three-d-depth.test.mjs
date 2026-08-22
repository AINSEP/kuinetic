import { fileURLToPath } from 'node:url'
import { createChecker, createFrameRecorder, perspectiveOf } from '../../scripts/browser-harness.mjs'

/**
 * Confirms every effect that claims a `perspective` parameter actually renders with depth, not
 * just that its CSS is structurally capable of it.
 *
 * `test/three-d-perspective.test.ts` and `test/entrance-flip-perspective.test.ts` (added by
 * `bccf4de`/`7dffd00`) both say the same thing in their own doc comments: they prove the keyframe
 * combines `perspective(...)` with a rotate function in the right order, and cannot prove the
 * render looks foreshortened, because jsdom does not lay out 3D transforms at all. That gap is
 * exactly what let `card-flip-x/-y`, `cube-rotate`, `book-page-turn`, `fold-panel`, and all four
 * `flip-in/-out-x/-y` ship rendering completely flat — every unit test green, because "the CSS
 * text is structurally correct" and "the compositor actually projects it in 3D" are different
 * claims, and only a real browser can check the second one.
 *
 * `perspectiveOf` (`scripts/browser-harness.mjs`) is the shared answer to that — written first for
 * `click-toggle.test.mjs`'s `card-flip-y`-by-click check, generalised here to every other effect
 * that makes the same claim. Lifted rather than reimplemented: two independent copies of "parse
 * `matrix3d`, read index 11" is exactly the kind of drift that lets one of them go stale.
 *
 * The effect list is derived from the registry (`primitive.parameters.perspective !== undefined`),
 * the same discipline `effect-sweep.test.mjs` uses to derive its own property list from
 * `getKeyframes()` instead of a hand-written one — a hand-kept list is exactly what let six
 * effects get wrongly called dead there. Four primitives currently declare `perspective`:
 * `flip-face`, `flip-3d`, `card-toggle`, and `tilt-3d`. Only the first two are checked here — see
 * `EXCLUDED` below for the other two and why, named and reasoned rather than silently dropped.
 */
export const name = 'three-d-depth'

const FIXTURE_URL = `file://${fileURLToPath(new URL('./fixtures/three-d-depth.html', import.meta.url))}`

/**
 * Perspective-claiming presets this suite deliberately does not check, and why. Named explicitly
 * rather than filtered out silently — same discipline as `effect-sweep.test.mjs`'s `UNSAMPLEABLE`
 * doc comment, because a canary set that quietly shrinks reads as "depth is covered" when it covers
 * fewer pathways than it looks like. A check below asserts every non-`css-keyframes` perspective
 * primitive the registry reports is one of these two — so a *third* one showing up in the future
 * fails loudly here instead of silently getting neither this suite's coverage nor a comment.
 */
const EXCLUDED = new Map([
  [
    'flip-card',
    'its primitive (card-toggle) is not attribute-triggered — prepare() is inertInstance(), and ' +
      'the whole effect is a CSS transition keyed off a real click toggling aria-pressed via ' +
      ':has(). This suite\'s "write the attribute, pause the animation, read the matrix" shape has ' +
      'nothing to pause here. Already covered end-to-end, by a real click, in ' +
      'click-toggle.test.mjs — which is also where perspectiveOf() was first written.',
  ],
  [
    'tilt-3d',
    'pointerPrimitive, renderer: "javascript" — driven continuously by real pointer movement ' +
      '(prepareTilt3d), never a WAAPI Animation, so there is nothing for getAnimations() to find ' +
      'or pause. This is a real, currently-uncovered gap, not a deliberate equivalent-coverage ' +
      'exclusion like card-toggle above: nothing anywhere asserts tilt-3d itself renders with ' +
      'depth. Left for a pointer-driven suite in the shape of gesture-sweep.test.mjs, not this one.',
  ],
])

/** How long the mid-rotation sample and the "human can see it" sample wait for, respectively. */
const ASSERTION_FRACTION = 0.25
const VISIBLE_FRACTION = 0.45

/**
 * Same "fresh element, attribute before insertion, poll for animations" shape as
 * effect-sweep.test.mjs. Pauses at `fraction` of the animation's own duration and returns the
 * resolved `transform` string — deliberately not `animation.cancel()`ed before returning: an
 * earlier version of this suite cancelled here, which snaps the element straight back to its
 * pre-animation resting transform, so every screenshot taken by the caller *after* this returned
 * was silently photographing the flat rest state a moment after the real mid-rotation frame had
 * already been thrown away. The numeric read below happens before any cancel and was never wrong;
 * only the screenshots were. `stage.replaceChildren(el)` on the next call detaches this element
 * (and its animation with it) anyway, so nothing here needs to clean up early.
 */
async function installAndSample(page, effect, fraction) {
  return page.evaluate(
    async ([effectName, sampleFraction]) => {
      const stage = document.getElementById('stage')
      const el = document.createElement('div')
      el.id = 'probe'
      el.textContent = effectName
      el.setAttribute('data-kui', `${effectName} 400ms`)
      stage.replaceChildren(el)

      const deadline = 500
      let animations = []
      for (let waited = 0; waited <= deadline; waited += 40) {
        animations = el.getAnimations()
        if (animations.length > 0 && animations.every((a) => a.playState !== 'paused')) break
        await new Promise((resolve) => setTimeout(resolve, 40))
      }
      if (animations.length === 0) return { installed: false }

      const duration = Math.max(...animations.map((a) => a.effect.getComputedTiming().duration || 0)) || 400
      for (const animation of animations) {
        animation.pause()
        animation.currentTime = duration * sampleFraction
      }
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))

      return { installed: true, resolved: getComputedStyle(el).transform }
    },
    [effect, fraction],
  )
}

/**
 * A raw, library-free element the harness drives directly, proving `perspectiveOf` itself before
 * trusting it against the library. If this ever reported the "bad" shape as carrying depth, or the
 * "good" shape as flat, the checks below would be measuring nothing.
 */
async function checkControlCases(page, check) {
  const bad = await page.evaluate(() => {
    const el = document.getElementById('control')
    el.style.transform = 'rotateY(45deg)' // the exact shape of the shipped bug: rotation, no perspective()
    return getComputedStyle(el).transform
  })
  check(
    'control: a bare rotateY() with no perspective() resolves to a zero perspective term',
    perspectiveOf(bad) === 0,
    `transform=${bad}`,
  )

  const good = await page.evaluate(() => {
    const el = document.getElementById('control')
    el.style.transform = 'perspective(1200px) rotateY(45deg)'
    return getComputedStyle(el).transform
  })
  check(
    'control: perspective(1200px) rotateY(45deg) resolves to a non-zero perspective term',
    perspectiveOf(good) > 0,
    `implied perspective=${perspectiveOf(good).toFixed(0)}px from ${good}`,
  )
}

export async function run({ browser, ARTIFACT_DIR }) {
  const { check, results } = createChecker()
  const snap = createFrameRecorder(`${ARTIFACT_DIR}/frames/${name}`)

  const context = await browser.newContext({ viewport: { width: 900, height: 700 } })
  const page = await context.newPage()
  await page.goto(FIXTURE_URL)
  await page.waitForFunction(() => window.__kui !== undefined)

  await checkControlCases(page, check)

  // Every preset whose primitive declares a `perspective` parameter — not a hand-kept list. See
  // the module doc comment for why, and `EXCLUDED` above for the two this derives that this suite
  // does not itself check.
  const catalog = await page.evaluate(() => {
    const registry = window.__registry
    return registry
      .names()
      .map((effect) => ({ effect, ...registry.resolve(effect) }))
      .filter((entry) => entry.primitive?.parameters?.perspective !== undefined)
      .map((entry) => ({ effect: entry.effect, renderer: entry.primitive.renderer }))
  })
  check('the fixture sees at least one perspective-claiming effect to check', catalog.length > 0, `${catalog.length} found`)

  const cssKeyframeEffects = catalog.filter((e) => e.renderer === 'css-keyframes').map((e) => e.effect)
  const other = catalog.filter((e) => e.renderer !== 'css-keyframes').map((e) => e.effect)
  const unaccounted = other.filter((effect) => !EXCLUDED.has(effect))
  check(
    'every non-css-keyframes perspective-claiming effect is a named, reasoned exclusion, not a silent gap',
    unaccounted.length === 0,
    unaccounted.length === 0
      ? `${other.length} excluded (${other.join(', ')}), all accounted for in EXCLUDED`
      : `unaccounted for: ${unaccounted.join(', ')} — add to EXCLUDED with a reason, or cover them`,
  )

  for (const effect of cssKeyframeEffects) {
    const sample = await installAndSample(page, effect, ASSERTION_FRACTION)
    check(`${effect} installs an animation on its own element`, sample.installed === true, JSON.stringify(sample))
    if (!sample.installed) continue

    // A human-reviewable frame at the same point the assertion below reads. Kept honest rather
    // than flattering: at 25% of duration the foreshortening is real (the assertion proves it
    // numerically) but visually mild — differs in apparent edge height by roughly 7% for a 220px
    // box at these angles, which does not leap out of a static PNG the way it would if you watched
    // it move.
    await snap(page, `${effect}-at-25pct`)

    check(
      `${effect} carries a real, non-zero perspective term mid-rotation (not just a bare rotate())`,
      perspectiveOf(sample.resolved) > 0,
      `implied perspective=${perspectiveOf(sample.resolved).toFixed(0)}px from ${sample.resolved}`,
    )

    // A second, later frame for the same reason task #11 exists: something a human can look at
    // and see depth in, not just read a number for. 45% keeps every one of these comfortably under
    // the 90°/270° zero-crossing perspectiveOf's own doc comment warns about (largest resulting
    // angle here is 81°, for the 180°-target effects) while landing far enough into the turn that
    // the near/far edges visibly differ.
    const dramatic = await installAndSample(page, effect, VISIBLE_FRACTION)
    if (dramatic.installed) await snap(page, `${effect}-at-45pct-visibly-foreshortened`)
  }

  await context.close()
  return results
}
