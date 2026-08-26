import { fileURLToPath } from 'node:url'
import { createChecker, createFrameRecorder } from '../../scripts/browser-harness.mjs'

/**
 * Settles which variable actually kills `heart-fill`, `bookmark-fill` and `chart-area-fill`.
 *
 * `todo.md` parks this with two hypotheses and an explicit instruction not to guess between them:
 * the original measurement saw `intersectionRect {0,0,0,0}` on an SVG `<path>` carrying a
 * collapsed `clip-path` and blamed the `clip-path`, but all three broken presets sit on `<path>`
 * while the working fourth (`chart-bar-grow`) sits on a `<div>`, so the two variables moved
 * together and neither was isolated.
 *
 * ## The answer this file measures
 *
 * **Neither variable alone. The two together, plus a third nobody had named.**
 *
 *   - A collapsed `clip-path` on an **HTML** element still reports `isIntersecting: true`
 *     (`intersectionRatio: 0`, empty `intersectionRect`) and `on:enter` fires normally. So
 *     `clip-path` alone does not deadlock anything — `star-rating-fill`, which is exactly that
 *     shape and which `todo.md` flags as unchecked, works.
 *   - An **SVG `<path>`** with no clip reports `intersectionRatio: 1` and fires normally. So an
 *     SVG target alone does not deadlock anything either.
 *   - A collapsed `clip-path` on an SVG child **whose bbox is inset within its `<svg>`'s own
 *     viewport** is never reported as intersecting at all — no callback, ever, at any scroll
 *     position. `on:enter` therefore never fires and the effect is permanently dead.
 *   - The same collapsed `clip-path` on an SVG child whose bbox **covers the whole `<svg>`
 *     viewport** fires normally.
 *
 * That last pair is why this had to be measured rather than reasoned about, and it is a live trap
 * for the next person: a synthetic SVG probe drawn to fill its `<svg>` **does not reproduce the
 * bug**. An earlier draft of this very file built its 2x2 out of full-bleed paths, came back
 * completely clean, and would have concluded "neither variable, the demo page must be at fault".
 * Every real FILLS target on the demo pages is an inset path, which is why the fixture's SVG cells
 * are too. `todo.md` notes this repo has shipped a confident-wrong mechanism twice; a 2x2 whose
 * cells are drawn wrong is exactly how a third one gets shipped.
 *
 * A partially-collapsed `clip-path` (one that still paints something) fires normally in every
 * cell, so the trigger is a clip that leaves zero painted area, not `clip-path` as such.
 *
 * The internal reason Chromium treats the two SVG geometries differently is *not* established
 * here — only the boundary condition is, and only for Chromium, which is this repository's one
 * real-browser tier. Nothing below depends on the internal reason.
 *
 * ## What this means for the code
 *
 * `test/entrance-zero-area.test.ts:180-186` excludes `clip-path` from its zero-area backstop on
 * the argument that a clip-path-hidden element still occupies its layout rect and is still a valid
 * observation target. The layout-rect half of that is **confirmed** below — `getBoundingClientRect()`
 * is untouched by the clip in every cell. The conclusion drawn from it is **wrong for SVG
 * children**: `IntersectionObserver` does not simply read that rect, and for an inset SVG child it
 * reports nothing at all. The exclusion is right for HTML and wrong for SVG.
 *
 * ## Why this cannot be a jsdom test
 *
 * jsdom has no layout and no compositor: every `getBoundingClientRect()` is zeros, so the
 * clipped-versus-unclipped and inset-versus-full-bleed distinctions this file turns on are not
 * observable there at all. Its `IntersectionObserver` is a stub, so an activation deadlock cannot
 * occur in it and its absence proves nothing.
 *
 * ## Controlling for `document.hidden`
 *
 * A backgrounded tab reports `document.hidden === true`; Chromium then delivers no intersection
 * callbacks whatsoever, stalling *every* `on:enter` on the page at once. That looks exactly like
 * the bug under investigation and would fake every dead reading here. Two guards, because either
 * alone is arguable:
 *
 *   - a direct assertion that the measuring page reports `visibilityState === 'visible'`; and
 *   - `chart-bar-grow` — the preset the bug report itself calls working, in the same demo row as
 *     the three dead ones — is required to activate, twice: once as a synthetic probe and once as
 *     the verbatim demo card. If callbacks were frozen, those fail too, which disqualifies every
 *     dead reading as harness error instead of believing it.
 *
 * The second is the load-bearing one: it is a property of the measurement rather than a claim
 * about the environment, so it stays true if Playwright's visibility reporting ever changes.
 *
 * ## This suite is red until the library is fixed
 *
 * The three reported presets are asserted at their *correct* behaviour — activates, and ends
 * revealed — so this file fails today, on purpose, and goes green when the bug is fixed. It is not
 * a description of current behaviour dressed up as a test.
 *
 * Its negative control is run in the same pass rather than described: `PROPOSED_GATE` below is the
 * `dd1f770` `[data-kui-state='ready']` pattern extended to the clip channel, injected as page CSS
 * (no library edit), and the identical assertions are re-run against it. Broken code fails them,
 * gated code passes them, one run, no second checkout. That also tells whoever picks the fix up
 * that the `dd1f770` pattern is the right shape for it before they write a line of it.
 */
export const name = 'fills-clip-path-io'

const FIXTURE_URL = `file://${fileURLToPath(new URL('./fixtures/fills-clip-path-io.html', import.meta.url))}`

/**
 * The bare-IO matrix: {HTML, SVG child covering its viewport, SVG child inset in its viewport}
 * x {clipped away, unclipped}. Ids read `io-<target>-<clip>`.
 */
const IO_CELLS = [
  'io-html-open',
  'io-html-clip',
  'io-svg-full-open',
  'io-svg-full-clip',
  'io-svg-inset-open',
  'io-svg-inset-clip',
]

/** The cell the bug lives in, and the only bare-IO cell expected never to intersect. */
const IO_DEAD_CELL = 'io-svg-inset-clip'

/** The library-driven matrix, same variables, using the demo pages' real inset-path geometry. */
const KUI_CELLS = ['kui-html-clip', 'kui-html-open', 'kui-svg-clip', 'kui-svg-open']

/** The three presets `todo.md` reports permanently dead, as `demo/icons-transitions.html` writes them. */
const REPORTED_DEAD = ['demo-heart-fill', 'demo-bookmark-fill', 'demo-chart-area-fill']

/** The working fourth card in the same demo row — the positive control, in its real markup. */
const REPORTED_WORKING = 'demo-chart-bar-grow'

/** clip-path on an ordinary HTML element, shipping on demo/data-hover.html, never before checked. */
const STAR_RATING = 'star-rating-fill'

/**
 * The candidate fix, as page CSS rather than a library edit — `dd1f770`'s
 * `[data-kui-state='ready']` gate (see `[data-kui-fx~='chart-bar-grow'][data-kui-state='ready']`
 * in `src/css/svg.css`) extended to the clip channel.
 *
 * `!important` because author-important outranks the Animations origin in the cascade, which is
 * how the existing gate's `--kui-bar-from: 1 !important` beats its own paused 0%-keyframe. The
 * `opacity: 0` is the other half and is *not* `!important`, matching that rule exactly: these
 * presets own no opacity channel, so un-clipping alone would park a fully-filled shape in view for
 * the whole wait — the "collapsed geometry" bug traded for a "wrong state, fully visible" one.
 * Both revert in the same `data-kui-state` attribute set (`animator.ts`'s `activate()`), so no
 * frame shows one without the other.
 *
 * Written against `data-kui-fx` because that is the attribute the compiled CSS keys on; the
 * preset names are listed literally for the same reason the catalog CSS lists them.
 */
const PROPOSED_GATE = `
  [data-kui-fx~='heart-fill'][data-kui-state='ready'],
  [data-kui-fx~='bookmark-fill'][data-kui-state='ready'],
  [data-kui-fx~='chart-area-fill'][data-kui-state='ready'],
  [data-kui-fx~='star-rating-fill'][data-kui-state='ready'] {
    clip-path: none !important;
    opacity: 0;
  }
`

/** How long a scrolled-into-view probe gets to leave `data-kui-state="ready"`. */
const TRIGGER_DEADLINE_MS = 1500

/** Longest any probe's animation runs (`star-rating-fill` is 900ms), plus slack to settle. */
const SETTLE_MS = 1300

/**
 * Read everything one library-driven cell can say about itself in a single round trip.
 *
 * Reads `clip-path`, `scale` and the layout rect together for every cell regardless of which
 * preset is on it. The clip column and the scale column are different presets, and a per-column
 * reader would make the two halves of the matrix non-comparable — one shape for every cell is what
 * keeps a matrix a matrix.
 */
async function readCell(page, id) {
  return page.$eval(`#${id}`, (el) => {
    const rect = el.getBoundingClientRect()
    const style = getComputedStyle(el)
    return {
      state: el.getAttribute('data-kui-state'),
      fx: el.getAttribute('data-kui-fx'),
      rect: { width: Math.round(rect.width), height: Math.round(rect.height), top: Math.round(rect.top) },
      clipPath: style.clipPath,
      scale: style.scale,
      opacity: style.opacity,
      animations: el.getAnimations().length,
    }
  })
}

/**
 * Put one element at a fixed offset from the viewport top using the page's own scroll API.
 *
 * Deliberately not Playwright's `scrollIntoViewIfNeeded`: that helper makes its own decision about
 * whether an element needs scrolling and how far, from geometry this fixture is deliberately
 * manipulating. Every probe landing at the same offset by the same mechanism is what makes the
 * cells comparable — a helper that treats a clipped target differently from an unclipped one would
 * be a fourth uncontrolled variable in a file whose entire purpose is controlling variables.
 */
async function scrollTo(page, id) {
  await page.evaluate((target) => {
    const el = document.getElementById(target)
    window.scrollBy(0, el.getBoundingClientRect().top - 300)
  }, id)
  await page.waitForTimeout(150)
}

/** Scroll one cell into view and wait for it to leave `ready`, returning the state it settled on. */
async function triggerAndWait(page, id) {
  await scrollTo(page, id)
  const deadline = Date.now() + TRIGGER_DEADLINE_MS
  let state = await page.$eval(`#${id}`, (el) => el.getAttribute('data-kui-state'))
  while (Date.now() < deadline && state === 'ready') {
    await page.waitForTimeout(40)
    state = await page.$eval(`#${id}`, (el) => el.getAttribute('data-kui-state'))
  }
  return state
}

/** True once a `clip-path` no longer hides its whole element — i.e. the fill actually revealed. */
function isRevealed(clipPath) {
  if (!clipPath || clipPath === 'none') return true
  const percentages = [...clipPath.matchAll(/(-?[\d.]+)%/g)].map((match) => Number.parseFloat(match[1]))
  // `inset(100% 0 0 0)` collapses; `inset(0%)` and `inset(0 30% 0 0)` (star-rating at 70%) do not.
  return percentages.every((value) => value < 100)
}

/**
 * Walk every FILLS probe on a freshly-loaded fixture and return what it settled on.
 *
 * Factored out because it runs twice — once against the library as it ships, once against the
 * library plus `PROPOSED_GATE` — and the two runs have to be the same measurement or the
 * comparison says nothing.
 */
async function measureFills(page, snap, tag) {
  const settled = {}
  for (const id of [...REPORTED_DEAD, REPORTED_WORKING, STAR_RATING]) {
    const state = await triggerAndWait(page, id)
    await page.waitForTimeout(SETTLE_MS)
    settled[id] = { ...(await readCell(page, id)), triggeredState: state }
    await snap(page, `${tag}-${id}`)
  }
  return settled
}

export async function run({ browser, ARTIFACT_DIR }) {
  const { check, results } = createChecker()
  const snap = createFrameRecorder(`${ARTIFACT_DIR}/frames/${name}`)

  const context = await browser.newContext({ viewport: { width: 1000, height: 800 } })
  const page = await context.newPage()
  await page.goto(FIXTURE_URL)
  await page.waitForFunction(() => window.__kui !== undefined)

  // --- guard 1: this page is genuinely foregrounded ---------------------------------------------
  const visibility = await page.evaluate(() => ({ hidden: document.hidden, state: document.visibilityState }))
  check(
    'the measuring page is foregrounded (a hidden tab delivers no intersection callbacks and would fake every dead reading below)',
    visibility.hidden === false && visibility.state === 'visible',
    `document.hidden=${visibility.hidden}, visibilityState=${visibility.state}`,
  )
  await snap(page, 'top-of-fixture-before-any-scroll')

  // --- the bare-IntersectionObserver matrix ------------------------------------------------------
  // Every cell is put at the same offset from the viewport top by the same mechanism, then the
  // observer's own log is read. No library anywhere in this half: it measures `clip-path` the CSS
  // property against the element type and the SVG geometry, which is the level the original
  // `intersectionRect {0,0,0,0}` reading was taken at.
  for (const id of IO_CELLS) await scrollTo(page, id)

  const ioLog = await page.evaluate(() => window.__ioLog)
  const ioMatrix = {}
  for (const id of IO_CELLS) {
    const entries = ioLog[id] ?? []
    const intersecting = entries.filter((entry) => entry.isIntersecting)
    ioMatrix[id] = { entries, intersecting: intersecting.at(-1) }
    const detail = ioMatrix[id].intersecting
      ? `ratio=${ioMatrix[id].intersecting.intersectionRatio}, bounding=${ioMatrix[id].intersecting.boundingClientRect.width}x${ioMatrix[id].intersecting.boundingClientRect.height}, intersection=${ioMatrix[id].intersecting.intersectionRect.width}x${ioMatrix[id].intersecting.intersectionRect.height}`
      : `never intersected across ${entries.length} callback(s)`

    if (id === IO_DEAD_CELL) {
      // The one cell the bug lives in. Asserted as a *finding*, not as desired behaviour: it is a
      // browser-engine fact this library has to work around, and if Chromium ever changes it this
      // check firing is exactly the notice the eventual workaround needs.
      check(
        `[bare IO] ${id} is never reported as intersecting — the engine behaviour the dead FILLS presets sit on`,
        ioMatrix[id].intersecting === undefined,
        detail,
      )
    } else {
      check(`[bare IO] ${id} is reported as intersecting once scrolled in`, ioMatrix[id].intersecting !== undefined, detail)
    }
  }

  // The premise `test/entrance-zero-area.test.ts:180-186` rests its clip-path exclusion on: a
  // clipped element keeps its layout rect. True in every cell, including the dead one — which is
  // precisely why "it still has a rect, so it is still a valid IO target" does not follow.
  for (const id of ['io-html-clip', 'io-svg-full-clip', 'io-svg-inset-clip']) {
    const rect = await page.$eval(`#${id}`, (el) => {
      const box = el.getBoundingClientRect()
      return { width: Math.round(box.width), height: Math.round(box.height) }
    })
    check(
      `[bare IO] ${id} keeps a non-zero layout rect despite its collapsed clip-path`,
      rect.width > 1 && rect.height > 1,
      `rect=${rect.width}x${rect.height}`,
    )
  }

  // --- the same matrix, driven by the library ----------------------------------------------------
  const kuiBefore = {}
  for (const id of KUI_CELLS) kuiBefore[id] = await readCell(page, id)
  for (const id of KUI_CELLS) {
    check(
      `[library, off-screen] ${id} is deferred (data-kui-state="ready")`,
      kuiBefore[id].state === 'ready',
      `state=${kuiBefore[id].state}, fx=${kuiBefore[id].fx}`,
    )
  }

  const kuiAfter = {}
  for (const id of KUI_CELLS) {
    const state = await triggerAndWait(page, id)
    await page.waitForTimeout(SETTLE_MS)
    kuiAfter[id] = { ...(await readCell(page, id)), triggeredState: state }
    await snap(page, `matrix-${id}`)
    check(`[library] ${id} activates on:enter`, state !== 'ready', `state=${state}`)
  }

  check(
    'positive control: chart-bar-grow on a div activated, so intersection callbacks are being delivered and no dead reading is harness error',
    kuiAfter['kui-html-open'].triggeredState !== 'ready',
    `kui-html-open state=${kuiAfter['kui-html-open'].triggeredState}`,
  )

  // Activating and finishing are different claims — an effect can leave `ready`, run, and still
  // end sitting at a collapsed clip-path. "Dead" as reported is a visual claim, so it is checked
  // visually-equivalently: the resolved clip-path once everything has settled.
  for (const id of ['kui-html-clip', 'kui-svg-clip']) {
    check(
      `[library] ${id} ends revealed, not still clipped away`,
      isRevealed(kuiAfter[id].clipPath),
      `clip-path=${kuiAfter[id].clipPath}, state=${kuiAfter[id].triggeredState}`,
    )
  }

  // --- the reported row, in its real markup ------------------------------------------------------
  const shipped = await measureFills(page, snap, 'shipped')

  check(
    `positive control (real markup): ${REPORTED_WORKING} activates`,
    shipped[REPORTED_WORKING].triggeredState !== 'ready',
    `state=${shipped[REPORTED_WORKING].triggeredState}`,
  )
  check(
    `${STAR_RATING} activates and reveals — clip-path on an HTML element, the cell todo.md records as never checked`,
    shipped[STAR_RATING].triggeredState !== 'ready' && isRevealed(shipped[STAR_RATING].clipPath),
    `state=${shipped[STAR_RATING].triggeredState}, clip-path=${shipped[STAR_RATING].clipPath}`,
  )

  for (const id of REPORTED_DEAD) {
    check(
      `${id} activates on:enter`,
      shipped[id].triggeredState !== 'ready',
      `state=${shipped[id].triggeredState} after ${TRIGGER_DEADLINE_MS}ms in view`,
    )
    check(
      `${id} ends revealed, not still clipped away`,
      isRevealed(shipped[id].clipPath),
      `clip-path=${shipped[id].clipPath}`,
    )
  }

  // --- negative control: the same assertions against a gated build --------------------------------
  // Same fixture, same walk, same reads, one added stylesheet. The pair is the control: if the
  // gated run passed and the shipped run had passed too, these assertions would be measuring
  // nothing.
  const gatedPage = await context.newPage()
  await gatedPage.goto(FIXTURE_URL)
  await gatedPage.waitForFunction(() => window.__kui !== undefined)
  await gatedPage.addStyleTag({ content: PROPOSED_GATE })

  // The gate's other half, read *before* anything is triggered — un-clipping alone would park the
  // finished-looking shape in view for the whole wait, the same "wrong state, fully visible"
  // regression the chart-bar-grow gate's `opacity: 0` exists to prevent. This has to be sampled
  // while the probe is genuinely still waiting: reading it after the walk below measures the
  // aftermath and passes on a gate with no opacity in it at all.
  const waiting = await readCell(gatedPage, REPORTED_DEAD[0])
  check(
    `[negative control] a gated ${REPORTED_DEAD[0]} stays invisible while it waits (un-clipping alone would show the finished shape for the whole wait)`,
    waiting.state === 'ready' && waiting.opacity === '0' && waiting.clipPath === 'none',
    `state=${waiting.state}, opacity=${waiting.opacity}, clip-path=${waiting.clipPath}`,
  )
  await snap(gatedPage, 'gated-probe-while-waiting')

  const gated = await measureFills(gatedPage, snap, 'gated')

  for (const id of REPORTED_DEAD) {
    check(
      `[negative control] ${id} activates once the ready gate un-clips it while it waits`,
      gated[id].triggeredState !== 'ready',
      `state=${gated[id].triggeredState} (shipped: ${shipped[id].triggeredState})`,
    )
    check(
      `[negative control] ${id} ends revealed once gated`,
      isRevealed(gated[id].clipPath),
      `clip-path=${gated[id].clipPath} (shipped: ${shipped[id].clipPath})`,
    )
  }

  await gatedPage.close()

  // --- the matrices, printed whole so the answer is readable without reading the check log -------
  console.log('\n  --- bare IntersectionObserver, every cell parked 300px below the viewport top ---')
  for (const id of IO_CELLS) {
    const best = ioMatrix[id].intersecting
    console.log(
      `  ${id.padEnd(19)} ` +
        (best
          ? `isIntersecting=true  ratio=${best.intersectionRatio}  bounding=${best.boundingClientRect.width}x${best.boundingClientRect.height}  intersectionRect=${best.intersectionRect.width}x${best.intersectionRect.height}`
          : `isIntersecting=NEVER (${ioMatrix[id].entries.length} callback(s), all false)`),
    )
  }
  console.log('\n  --- library on:enter ---')
  for (const id of KUI_CELLS) {
    console.log(
      `  ${id.padEnd(19)} fx=${(kuiAfter[id].fx ?? '-').padEnd(16)} before=${kuiBefore[id].state} after=${kuiAfter[id].triggeredState}  clip-path=${kuiAfter[id].clipPath}  scale=${kuiAfter[id].scale}`,
    )
  }
  console.log('\n  --- the demo row, shipped vs. ready-gated ---')
  for (const id of [...REPORTED_DEAD, REPORTED_WORKING, STAR_RATING]) {
    console.log(
      `  ${id.padEnd(22)} shipped: state=${String(shipped[id].triggeredState).padEnd(8)} clip=${String(shipped[id].clipPath).padEnd(22)} | gated: state=${String(gated[id].triggeredState).padEnd(8)} clip=${gated[id].clipPath}`,
    )
  }
  console.log('')

  await context.close()
  return results
}
