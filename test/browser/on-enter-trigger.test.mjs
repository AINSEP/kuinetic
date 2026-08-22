import { fileURLToPath } from 'node:url'
import { createChecker, createFrameRecorder } from '../../scripts/browser-harness.mjs'

/**
 * Proves the six presets whose default from-state collapses the element to zero area no longer
 * sit in that collapsed, fully-visible geometry while a deferred `on:enter` effect waits below
 * the fold — and that a `loading="lazy"` image nested inside one of them, the bug's second
 * symptom, now actually loads.
 *
 * `rotateX`/`rotateY` at ±90deg and `scale: 0 <axis>`/`scale: <axis> 0` all give the paused box a
 * bounding rect with no width or no height. `element-config.ts`'s `activation: authored ?? 'enter'`
 * means a bare `data-kui="fold-panel"` with no `on:` clause already gets the deferred, IO-gated
 * activation this file is about, which is why the fixture never writes the literal string
 * `on:enter` anywhere.
 *
 * The *both halves of "ready"* check below is the one that actually discriminates the fix. Each
 * half alone passes a broken variant: geometry-only would pass a fix that leaves the element
 * sitting fully visible, at its rest look, for the entire wait (the exact regression an
 * angle/scale-only flatten with no opacity pairing would ship, since none of these six presets own
 * an opacity channel of their own); opacity-only would pass the original bug outright, since a
 * permanently `opacity: 0` box that never leaves its collapsed geometry looks identical from that
 * one property alone. Both are asserted together, matching the fix itself: `animator.ts`'s
 * `activate()` writes `data-kui-state="running"` as a single attribute set, which is the only thing
 * that stops `[data-kui-fx~='X'][data-kui-state='ready']` matching — so the flattened
 * angle/scale and the forced `opacity: 0` revert in the same style recalc, and a visitor is never
 * shown an "opaque but wrong shape" frame. This is written directly against the same "wrong
 * from-state paints the whole time it's paused" failure `entrance.css`'s `--kui-distance` rule
 * already fixed for translate-based entrances: it fails on the code before
 * `[data-kui-state='ready']` gates `--kui-from-angle`/`--kui-bar-from` back to identity alongside
 * `opacity` (`entrance.css`, `three-d.css`, `numbers.css`, `svg.css`), and passes once those gates
 * are in place.
 *
 * The *does it still activate, and does it still start from its real collapsed shape* check that
 * follows is a no-regression sanity check on the trigger and the token hand-off, not the
 * discriminating one for the deadlock itself — it passes on the code before this fix too. A
 * standalone probe against three bare `IntersectionObserver`s (zero-width, zero-height, and
 * zero-both target rects, no kuinetic involved) confirmed why: Chromium resolves a zero-area
 * target's `intersectionRatio` to `1`, not `0`, once its position is contained within the root —
 * it does not special-case zero area as "never intersecting" the way the original bug report
 * assumed. That may not hold in every engine (WebKit and Gecko compute the zero-area edge case
 * differently by spec history), but this repository's only real-browser tier runs Chromium, so
 * this suite cannot demonstrate a cross-engine activation deadlock either way — only the
 * collapsed-geometry-plus-visible defect, which is real and browser-independent, and which this
 * suite does prove and does fix. (The most likely explanation for the original "never starts"
 * report: a backgrounded tab's `document.hidden` freezes the whole rendering lifecycle and
 * delivers no intersection callbacks at all, stalling *every* `on:enter` effect on the page at
 * once — not just the six with a collapsed from-state — which reads exactly like this bug from a
 * hidden tab. This suite runs in a foreground page throughout and cannot exercise that path.) It is
 * still worth asserting that the *token hand-off* is clean:
 * once activated, the animation must start from its real, authored collapsed value (the ready
 * gate's override must not leak past the moment it stops applying), which the pause-at-currentTime-0
 * sample below confirms directly.
 *
 * The *nested lazy image* check at the end is, likewise, a confirmation rather than a
 * discriminator: it also passes on the code before this fix, and for a related reason to the
 * `IntersectionObserver` finding above. `loading="lazy"`'s distance-based preload heuristic
 * appears to key off the image's normal-flow *layout* position, not its rendered, transformed
 * geometry — a `rotateX(90deg)` ancestor moves nothing in layout, only in paint, so the image
 * starts loading once its untransformed box crosses the preload margin regardless of whether the
 * ancestor's paint-time shape is a collapsed line or a full box. (The fixture's `#spacer` has to be
 * pushed to several thousand pixels, well past a normal "below the fold", before the image defers
 * at all in this environment — the plain "put it below the fold" distance still eagerly loads
 * everything, fix or no fix.) The check is kept anyway because it is exactly what was asked for — a
 * real `loading="lazy"` image, nested the way `demo/reveals.html`'s `flip-in-x`/`flip-in-y` cards
 * nest one, does load once its ancestor is triggered — even though, in this engine, it was never
 * observed failing to.
 *
 * Neither existing browser tier would have caught the part that does discriminate:
 * `effect-sweep.test.mjs` inserts a probe and then unconditionally calls `animation.pause()` / sets
 * `animation.currentTime` itself to take its samples, which reads the paused animation's resolved
 * values without ever asking whether its `on:enter` trigger has (or ever will) actually fire.
 * `three-d-depth.test.mjs` does the same "pause and read the matrix" thing for a different
 * property. Both stop at "the CSS text is correct"; this suite is the one that leaves an untouched,
 * still-waiting element's geometry and opacity to speak for themselves.
 */
export const name = 'on-enter-trigger'

const FIXTURE_URL = `file://${fileURLToPath(new URL('./fixtures/on-enter-below-fold.html', import.meta.url))}`

/** The six presets `#21` found. */
const PROBES = ['fold-panel', 'flip-in-x', 'flip-in-y', 'loading-bar', 'progress-bar', 'chart-bar-grow']

/** The two whose fixture markup nests a real `loading="lazy"` img — `demo/reveals.html`'s shape. */
const LAZY_IMAGE_PROBES = ['flip-in-x', 'flip-in-y']

/** How long a scrolled-into-view probe gets to leave `data-kui-state="ready"` before this fails it. */
const TRIGGER_DEADLINE_MS = 1500

/** How long a triggered probe's nested lazy image gets to finish loading before this fails it. */
const IMAGE_LOAD_DEADLINE_MS = 2000

export async function run({ browser, ARTIFACT_DIR }) {
  const { check, results } = createChecker()
  const snap = createFrameRecorder(`${ARTIFACT_DIR}/frames/${name}`)

  const context = await browser.newContext({ viewport: { width: 1000, height: 800 } })
  const page = await context.newPage()
  await page.goto(FIXTURE_URL)
  await page.waitForFunction(() => window.__kui !== undefined)

  // --- everything starts below the fold, paused, with real area, and invisible ------------------
  // Read every probe's state, geometry, and opacity *before* touching scroll position at all: this
  // is the pair of assertions that fails on the unfixed code (zero area) or a half-fixed one
  // (visible at rest) regardless of what happens next, since a collapsed-and-visible from-state is
  // wrong the instant the runtime installs it, not just once a trigger tries and fails to fire.
  const before = {}
  for (const id of PROBES) {
    before[id] = await page.$eval(`#${id}`, (el) => {
      const rect = el.getBoundingClientRect()
      return {
        state: el.getAttribute('data-kui-state'),
        width: rect.width,
        height: rect.height,
        opacity: getComputedStyle(el).opacity,
      }
    })
  }

  for (const id of PROBES) {
    check(`${id} is deferred (data-kui-state="ready") while off-screen`, before[id].state === 'ready', `state=${before[id].state}`)
  }
  await snap(page, 'all-probes-off-screen-before-scroll')

  for (const id of PROBES) {
    const { width, height, opacity } = before[id]
    check(
      `${id} has real area while it waits, and stays invisible with it (both halves of the fix)`,
      width > 1 && height > 1 && opacity === '0',
      `rect=${width.toFixed(2)}x${height.toFixed(2)}, opacity=${opacity}, while data-kui-state="ready"`,
    )
  }

  // A lazy image nested inside a still-`ready` probe must not have started loading yet — otherwise
  // the "does it load once triggered" check below would be trivially true regardless of this bug.
  for (const id of LAZY_IMAGE_PROBES) {
    const loadedAlready = await page.$eval(`#${id} img`, (img) => img.complete && img.naturalWidth > 0)
    check(`${id}'s nested lazy image has not loaded yet while off-screen`, loadedAlready === false, `complete-with-content=${loadedAlready}`)
  }

  // --- no-regression sanity: scrolling into view still activates it, and the real animation still
  // starts from its authored collapsed value, not from whatever the ready gate overrode it to (see
  // module doc comment for why the activation half does not, itself, discriminate the deadlock in
  // Chromium) --------------------------------------------------------------------------------------
  for (const id of PROBES) {
    await page.locator(`#${id}`).scrollIntoViewIfNeeded()

    let state = before[id].state
    const deadline = Date.now() + TRIGGER_DEADLINE_MS
    while (Date.now() < deadline) {
      state = await page.$eval(`#${id}`, (el) => el.getAttribute('data-kui-state'))
      if (state !== 'ready') break
      await page.waitForTimeout(40)
    }

    await snap(page, `${id}-after-scroll-into-view`)
    check(
      `${id} still activates once scrolled into view (the fix did not break the trigger)`,
      state !== 'ready',
      `data-kui-state=${state} within ${TRIGGER_DEADLINE_MS}ms of scrolling into view`,
    )
    if (state === 'ready') continue

    // Pause every animation on the element at its own currentTime 0 — the real `from` keyframe,
    // authored value and all, with the ready gate no longer matching (its selector requires
    // `data-kui-state='ready'`, which just stopped being true). If the gate's override ever leaked
    // past the moment it stops applying, this would render the flattened placeholder instead of
    // the genuine collapsed shape.
    const atStart = await page.$eval(`#${id}`, (el) => {
      for (const animation of el.getAnimations()) {
        animation.pause()
        animation.currentTime = 0
      }
      const rect = el.getBoundingClientRect()
      return { width: rect.width, height: rect.height }
    })
    check(
      `${id}'s real animation starts from its authored collapsed shape, not the ready gate's flattened one`,
      atStart.width < 1 || atStart.height < 1,
      `rect=${atStart.width.toFixed(2)}x${atStart.height.toFixed(2)} at the animation's own currentTime=0`,
    )
  }

  // --- the second symptom: a nested loading="lazy" image must actually load once triggered --------
  for (const id of LAZY_IMAGE_PROBES) {
    let loaded = false
    const deadline = Date.now() + IMAGE_LOAD_DEADLINE_MS
    while (Date.now() < deadline) {
      loaded = await page.$eval(`#${id} img`, (img) => img.complete && img.naturalWidth > 0)
      if (loaded) break
      await page.waitForTimeout(60)
    }
    await snap(page, `${id}-nested-lazy-image`)
    check(
      `${id}'s nested loading="lazy" image loads once the ancestor is triggered and its geometry is real`,
      loaded,
      `loaded=${loaded} within ${IMAGE_LOAD_DEADLINE_MS}ms of scrolling into view`,
    )
  }

  await context.close()
  return results
}
