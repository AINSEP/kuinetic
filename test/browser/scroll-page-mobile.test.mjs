import { fileURLToPath } from 'node:url'
import { createChecker, createFrameRecorder } from '../../scripts/browser-harness.mjs'

/**
 * `demo/scroll.html` at a real phone viewport.
 *
 * Unlike every other suite here this one drives the shipped demo page rather than a fixture,
 * because the thing being gated is a property of that page's own markup and it has already
 * regressed once. `ce7a87a` fixed a genuine mobile overlap — three sticky sidebars riding down over
 * the content beside them in a single column — by writing `position: static !important` over the
 * `position: sticky` that `data-kui="pin-until"` sets inline. That was the right call for the two
 * sidebar pins (see the comments on `.showcase-media` and `.pin-until-aside`: `pin-until` is the
 * sticky-*sidebar* pattern and there is no sidebar in one column), but the same stroke applied one
 * selector wider would take the page's other nine pins with it, and nothing would have failed.
 *
 * `4f18816` offered a better fix for one of the two: `above:lg` on `.pin-until-aside`'s own
 * `data-kui` attribute, so `preparePin` never calls `installSticky` below the gate and there is
 * nothing for a page-level override to beat. `lg` (1024px) is the nearest name on the gate's
 * closed five-name scale that is never inside its one-column band (800px), so it sits idle-with-
 * room from 800px up to 1024px rather than pinning a moment too early. `.showcase-media` was tried
 * the same way and is not gated after all — see `SIDEBAR_PINS` below for why, and its own comment
 * in `demo/scroll.html` for the full account; it keeps the `ce7a87a` CSS override. This suite locks
 * in both: the gate on one sidebar, at its boundary and across a live resize, and the CSS override
 * still holding the other.
 *
 * So this suite fixes/locks three things in place:
 *   - the nine full-width pins still pin on a phone,
 *   - the two sidebar pins are kept off in one column — one by never asking for sticky at all, one
 *     by an overridden ask — do not overlap the content they used to cover, and still publish
 *     progress so `timeline:pin` effects keep running,
 *   - and all of it still pins on a desktop viewport, so "fix mobile" cannot quietly mean
 *     "unpin everything".
 *
 * It also gates the Flip control's corner. It sat 3.1rem above its own card's bottom edge on every
 * phone, on all three flip-cards, because the rule that stacked the hero card's two controls was
 * scoped to `.kui-flip-control` rather than to the one card that has two.
 *
 * `resize_window` in the Chrome extension silently floors at ~500px CSS width on this machine, so a
 * mobile check driven that way tests the wrong viewport and comes back clean. `newContext` does
 * not, which is the whole reason this lives here.
 */
export const name = 'scroll-page-mobile'

const PAGE_URL = `file://${fileURLToPath(new URL('../../demo/scroll.html', import.meta.url))}`

const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 }
const SMALL_PHONE = { viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 }
const WIDE_PHONE = { viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 }
const DESKTOP = { viewport: { width: 1280, height: 800 } }
// Inside `.pin-until-aside`'s own two-column layout breakpoint (800px) but below the `above:lg`
// gate (1024px) that switches its pin — the band the gate trades away. `.showcase-media` is not
// tested at this width: it does not use the gate (see SIDEBAR_PINS below), so it has no boundary
// here to lock in.
const TABLET = { viewport: { width: 1000, height: 900 } }
// Exactly `lg` (`min-width: 64rem`) — where the gate opens.
const GATE_EDGE = { viewport: { width: 1024, height: 900 } }

/**
 * The two `pin-until` sidebars, and how each one is kept off below its own two-column layout
 * breakpoint.
 *
 * Not the same mechanism, and deliberately so. `above:lg` on `.pin-until-aside`'s own `data-kui`
 * (`4f18816`) is a real fix — proven below at the gate boundary and by live resize — because that
 * subtree has no `timeline:pin` child depending on `--kui-progress`, so gating the whole
 * `pin-until` instance off costs nothing. `.showcase-media` was tried the same way first and
 * reverted: its video's `parallax-scale timeline:pin` went dead the moment the gate suppressed the
 * effect, because `applyViewportGates` (`core/animator.ts`) gates a JS-rendered primitive as one
 * unit — there is no way to keep `trackProgress` running while refusing only `installSticky`. It
 * still uses the `ce7a87a` CSS `!important` override, which vetoes the position only.
 */
const SIDEBAR_PINS = [
  { selector: '.showcase-media', twoColumnFrom: 900, mechanism: 'css-override', beside: '.showcase-copy' },
  { selector: '.pin-until-aside', twoColumnFrom: 800, mechanism: 'gate', gateFrom: 1024, beside: '.pin-until-content' },
]

/** Whether a CSS grid container has resolved to more than one column track. */
async function isTwoColumn(page, gridSelector) {
  return page.evaluate(
    (selector) =>
      getComputedStyle(document.querySelector(selector)).gridTemplateColumns.trim().split(/\s+/).length > 1,
    gridSelector,
  )
}

/** `margin: 0.85rem` on a 16px root. The corner inset every control in a card shares. */
const CORNER_INSET = 13.6
/** Sub-pixel layout slack — a pill can land a fraction off its own margin. */
const EPSILON = 2

/**
 * Open the demo page with every off-origin request refused.
 *
 * The page preconnects to Google Fonts and pulls YouTube poster frames. Neither participates in any
 * measurement here (the pills are set in `ui-monospace`, a local stack, and the posters sit inside
 * boxes with authored aspect ratios), and letting a suite's geometry depend on the network is how a
 * gate turns flaky.
 */
async function openPage(browser, contextOptions) {
  const context = await browser.newContext(contextOptions)
  await context.route('**://**', (route) =>
    route.request().url().startsWith('file://') ? route.continue() : route.abort(),
  )
  const page = await context.newPage()
  await page.goto(PAGE_URL, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => window.__kui !== undefined, null, { timeout: 20_000 })
  // One frame past mount, so the animator has written its inline `position`/`top` before anything
  // reads them back.
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)))
  await page.waitForTimeout(120)
  return { context, page }
}

/**
 * Every element the page asks the library to pin, with what actually resolved.
 *
 * `installSticky` writes `position: sticky` inline, so `el.style.position === 'sticky'` is the ask
 * and `getComputedStyle(el).position` is the answer. A page rule that overrides the ask shows up
 * here as the two disagreeing — the state `ce7a87a` used to produce and this suite still watches
 * for, since a page-level CSS override remains a legal (if now unused) way to refuse a pin. An
 * `above:`/`below:` gate is a different, cleaner kind of "no": the primitive never calls
 * `installSticky` outside its own gate, so `asked` is false and `data-kui-pinned` is absent rather
 * than `"false"` — `preparePin` only ever sets that attribute from inside the same callback that
 * calls `installSticky`. `pinned` is `null` when the attribute was never written at all, which is
 * how a gate-refused pin is told apart from one CSS merely overrode.
 */
function readPins(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('[data-kui]')]
      .filter((el) => /\b(pin-section|pin-until|pin-spacer|stacking-cards|horizontal-scroll|sequence-scrub)\b/.test(el.getAttribute('data-kui')))
      .map((el) => ({
        attr: el.getAttribute('data-kui'),
        label: el.id || el.className.toString().split(/\s+/)[0] || el.tagName,
        asked: el.style.position === 'sticky',
        resolved: getComputedStyle(el).position,
        pinned: el.getAttribute('data-kui-pinned'),
      })),
  )
}

/** Scroll to an absolute document offset without the smooth behaviour the page sets globally. */
async function scrollTo(page, y) {
  await page.evaluate((top) => window.scrollTo({ top, behavior: 'instant' }), y)
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)))
  await page.waitForTimeout(30)
}

/** The largest rectangle overlap between two elements over a sweep across their shared section. */
async function maxOverlapAcross(page, sectionSelector, aSelector, bSelector, steps = 12) {
  const box = await page.$eval(sectionSelector, (el) => {
    const rect = el.getBoundingClientRect()
    return { top: rect.top + window.scrollY, height: rect.height }
  })
  let worst = { area: 0, scrollY: 0 }
  for (let i = 0; i <= steps; i += 1) {
    await scrollTo(page, Math.round(box.top + (box.height * i) / steps) - 200)
    const area = await page.evaluate(
      ([a, b]) => {
        const first = document.querySelector(a)?.getBoundingClientRect()
        const second = document.querySelector(b)?.getBoundingClientRect()
        if (!first || !second) return 0
        const x = Math.min(first.right, second.right) - Math.max(first.left, second.left)
        const y = Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top)
        return x > 0 && y > 0 ? Math.round(x * y) : 0
      },
      [aSelector, bSelector],
    )
    if (area > worst.area) worst = { area, scrollY: await page.evaluate(() => Math.round(window.scrollY)) }
  }
  return worst
}

/**
 * Where each flip control sits inside its own card, as insets from that card's bottom-left.
 *
 * `#showcase-flip-demo`'s control is `display: none` while a hover trigger is driving that card,
 * which is the desktop default — it exists there to hold `aria-pressed`, and nobody is meant to
 * press it. A hidden element has no rect to measure, so for that one the placement *contract* is
 * read instead: `grid-area: 1 / 1` plus `justify-self: start`, `align-self: end` and an even
 * `0.85rem` margin is the bottom-left corner, and it is the same declaration the two measured
 * cards resolve their geometry from. Its rendered geometry is covered anyway — under
 * `(hover: none)` the page shows this control, so every phone viewport below measures it for real.
 */
function readFlipCorners(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('[data-kui~="flip-card"]')].map((card) => {
      const control = card.querySelector(':scope > .kui-flip-control')
      const style = getComputedStyle(control)
      const cardRect = card.getBoundingClientRect()
      const controlRect = control.getBoundingClientRect()
      return {
        id: card.id,
        hidden: style.display === 'none',
        justifySelf: style.justifySelf,
        alignSelf: style.alignSelf,
        margin: [style.marginTop, style.marginRight, style.marginBottom, style.marginLeft].join(' '),
        fromLeft: Math.round((controlRect.left - cardRect.left) * 10) / 10,
        fromBottom: Math.round((cardRect.bottom - controlRect.bottom) * 10) / 10,
      }
    }),
  )
}

/** Bottom-left: measured off the card when the control is rendered, declared when it is not. */
function inBottomLeftCorner(card, inset) {
  if (card.hidden) {
    return (
      card.justifySelf === 'start' && card.alignSelf === 'end' && card.margin === `${inset}px ${inset}px ${inset}px ${inset}px`
    )
  }
  return Math.abs(card.fromLeft - inset) <= EPSILON && Math.abs(card.fromBottom - inset) <= EPSILON
}

/** One line per card, so a failure names the corner it actually landed in. */
function describeCorners(cards) {
  return cards
    .map((card) =>
      card.hidden
        ? `${card.id}: hidden, ${card.justifySelf}/${card.alignSelf} margin ${card.margin}`
        : `${card.id}: ${card.fromLeft}/${card.fromBottom}`,
    )
    .join('; ')
}

/** Whether the document is wider than the viewport it was given. */
function readOverflow(page) {
  return page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))
}

export async function run({ browser, ARTIFACT_DIR }) {
  const { check, results } = createChecker()
  const snap = createFrameRecorder(`${ARTIFACT_DIR}/frames/${name}`)

  // ---------------------------------------------------------------- phone: pins
  {
    const { context, page } = await openPage(browser, PHONE)
    await snap(page, 'phone-390-top')

    const pins = await readPins(page)
    const sidebarSelectors = SIDEBAR_PINS.map((pin) => pin.selector.slice(1))
    const fullWidth = pins.filter((pin) => !sidebarSelectors.includes(pin.label))
    const dead = fullWidth.filter((pin) => pin.asked && pin.resolved !== 'sticky')

    check(
      'every pin the page is not deliberately stacking still pins at 390px',
      fullWidth.length >= 9 && dead.length === 0,
      `${fullWidth.length - dead.length}/${fullWidth.length} sticky${dead.length ? `; dead: ${dead.map((p) => p.label).join(', ')}` : ''}`,
    )

    for (const pin of SIDEBAR_PINS) {
      const row = pins.find((entry) => entry.label === pin.selector.slice(1))
      if (pin.mechanism === 'gate') {
        check(
          `${pin.selector} never asks for sticky below its ${pin.gateFrom}px gate, at 390px`,
          row !== undefined && !row.asked && row.resolved === 'static' && row.pinned === null,
          row ? `asked=${row.asked ? 'sticky' : 'none'}, resolved=${row.resolved}, pinned=${row.pinned}` : 'element not found',
        )
      } else {
        check(
          `${pin.selector} is deliberately stacked below its ${pin.twoColumnFrom}px two-column breakpoint`,
          row !== undefined && row.asked && row.resolved === 'static',
          row ? `asked=${row.asked ? 'sticky' : 'none'}, resolved=${row.resolved}` : 'element not found',
        )
      }
    }

    // The overlap that `ce7a87a` was reacting to. Whatever replaces the current rule has to keep
    // this at zero, including a rule that restores the pin — a restored pin that covers the copy
    // again is the original bug, not a fix for this one.
    const showcaseOverlap = await maxOverlapAcross(page, '.showcase', '.showcase-media', '.showcase-copy')
    check(
      'the pinned reference never covers the beats it is captioning at 390px',
      showcaseOverlap.area === 0,
      `max overlap ${showcaseOverlap.area}px² (worst at scrollY=${showcaseOverlap.scrollY})`,
    )

    const asideOverlap = await maxOverlapAcross(page, '#pin-until-demo', '.pin-until-aside', '.pin-until-content')
    check(
      'the pin-until panel never covers its own itinerary at 390px',
      asideOverlap.area === 0,
      `max overlap ${asideOverlap.area}px² (worst at scrollY=${asideOverlap.scrollY})`,
    )

    // Stacking the sidebar switches off the hold, and only the hold. The effect stays mounted, so
    // `--kui-progress` keeps running and `parallax-scale timeline:pin` on the video inside the
    // frame keeps scrubbing. Deleting the `data-kui` attribute instead would pass every check
    // above and silently take this with it.
    const box = await page.$eval('.showcase', (el) => {
      const rect = el.getBoundingClientRect()
      return { top: rect.top + window.scrollY, height: rect.height }
    })
    const scales = []
    for (const fraction of [0, 0.5, 1]) {
      await scrollTo(page, Math.round(box.top + box.height * fraction) - 400)
      scales.push(
        await page.$eval('[data-kui*="parallax-scale"][data-kui*="timeline:pin"]', (el) =>
          Number.parseFloat(getComputedStyle(el).scale),
        ),
      )
    }
    await snap(page, 'phone-390-showcase-scrubbed')
    check(
      'the stacked pin still publishes progress, so timeline:pin effects keep running at 390px',
      scales[0] < scales[1] && scales[1] < scales[2] && scales[2] - scales[0] > 0.03,
      `parallax-scale over the section: ${scales.map((value) => value.toFixed(4)).join(' -> ')}`,
    )

    await context.close()
  }

  // ---------------------------------------------------------------- gate boundary: idle with room to spare
  {
    const { context, page } = await openPage(browser, TABLET)

    const showcaseTwoCol = await isTwoColumn(page, '.showcase-grid')
    const asideTwoCol = await isTwoColumn(page, '.pin-until-layout')
    check(
      "both sidebars' own two-column layouts are already active at 1000px",
      showcaseTwoCol && asideTwoCol,
      `showcase-grid two-column=${showcaseTwoCol}, pin-until-layout two-column=${asideTwoCol}`,
    )

    // The trade `above:lg` makes, stated as a check rather than only as a comment: the gated
    // sidebar is still idle here even though its own layout already has room to hold against,
    // because the gate's closed scale has no name between its layout breakpoint (800px) and `lg`
    // (1024px). Idle-with-room, not held-too-early, is the whole point of picking `lg` over `md`.
    // Only the gated sidebar is checked here — `.showcase-media` does not use the gate (see
    // `SIDEBAR_PINS`) and is already covered by the 390px and 1280px checks above/below.
    const gatedPins = SIDEBAR_PINS.filter((pin) => pin.mechanism === 'gate')
    const pins = await readPins(page)
    for (const pin of gatedPins) {
      const row = pins.find((entry) => entry.label === pin.selector.slice(1))
      check(
        `${pin.selector} still declines sticky at 1000px, though its own layout already has room`,
        row !== undefined && !row.asked && row.resolved === 'static' && row.pinned === null,
        row ? `asked=${row.asked ? 'sticky' : 'none'}, resolved=${row.resolved}, pinned=${row.pinned}` : 'element not found',
      )
    }
    await snap(page, 'tablet-1000-idle-with-room')
    await context.close()
  }

  // ---------------------------------------------------------------- gate boundary: engages at lg (1024px)
  {
    const { context, page } = await openPage(browser, GATE_EDGE)
    const pins = await readPins(page)
    for (const pin of SIDEBAR_PINS.filter((p) => p.mechanism === 'gate')) {
      const row = pins.find((entry) => entry.label === pin.selector.slice(1))
      check(
        `${pin.selector} asks for sticky again at exactly its ${pin.gateFrom}px gate`,
        row !== undefined && row.asked && row.resolved === 'sticky',
        row ? `asked=${row.asked ? 'sticky' : 'none'}, resolved=${row.resolved}` : 'element not found',
      )
    }
    await context.close()
  }

  // ---------------------------------------------------------------- gate boundary: live resize, no reload
  {
    // The gate's `MediaQueryList` listener (`createGateWatcher`), not just the install-time read.
    // A reader never reloads on resize, so a gate that only worked at load would be a gate that
    // silently stopped working the moment a window changed size — the one failure mode a purely
    // static repro (open once at each width) cannot see.
    const { context, page } = await openPage(browser, TABLET)

    await page.setViewportSize({ width: 1100, height: 900 })
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)))
    await page.waitForTimeout(150)
    const afterUp = await readPins(page)

    await page.setViewportSize({ width: 1000, height: 900 })
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)))
    await page.waitForTimeout(150)
    const afterDown = await readPins(page)

    for (const pin of SIDEBAR_PINS.filter((p) => p.mechanism === 'gate')) {
      const up = afterUp.find((entry) => entry.label === pin.selector.slice(1))
      const down = afterDown.find((entry) => entry.label === pin.selector.slice(1))
      check(
        `${pin.selector} engages on a live resize across 1024px, with no reload`,
        up !== undefined && up.asked && up.resolved === 'sticky',
        up ? `asked=${up.asked ? 'sticky' : 'none'}, resolved=${up.resolved}` : 'element not found',
      )
      check(
        `${pin.selector} disengages again on a live resize back down, with no reload`,
        down !== undefined && !down.asked && down.resolved === 'static',
        down ? `asked=${down.asked ? 'sticky' : 'none'}, resolved=${down.resolved}` : 'element not found',
      )
    }
    await context.close()
  }

  // ---------------------------------------------------------------- phone: flip corners + overflow
  for (const [label, options] of [
    ['360px', SMALL_PHONE],
    ['390px', PHONE],
    ['430px', WIDE_PHONE],
  ]) {
    const { context, page } = await openPage(browser, options)

    const corners = await readFlipCorners(page)
    const misplaced = corners.filter((card) => !inBottomLeftCorner(card, CORNER_INSET))
    check(
      `every flip control sits in its card's bottom-left corner at ${label}`,
      corners.length === 3 && misplaced.length === 0,
      misplaced.length ? describeCorners(misplaced) : describeCorners(corners),
    )

    // The hero card is the only one with a second control. Wherever that control goes, it may not
    // land on top of the Flip pill — the arrangement that stacks them is what put the Flip pill
    // 3.1rem off its own corner in the first place.
    const heroCollision = await page.evaluate(() => {
      const card = document.getElementById('hero-flip-demo')
      const control = card.querySelector(':scope > .kui-flip-control').getBoundingClientRect()
      const code = card.querySelector(':scope > .hero-flip-code').getBoundingClientRect()
      const x = Math.min(control.right, code.right) - Math.max(control.left, code.left)
      const y = Math.min(control.bottom, code.bottom) - Math.max(control.top, code.top)
      return { overlap: x > 0 && y > 0 ? Math.round(x * y) : 0, gap: Math.round(Math.max(x > 0 ? -y : -x, 0)) }
    })
    check(
      `the hero card's two controls do not collide at ${label}`,
      heroCollision.overlap === 0,
      `overlap ${heroCollision.overlap}px²`,
    )

    const { scrollWidth, clientWidth } = await readOverflow(page)
    check(
      `the page does not scroll sideways at ${label}`,
      scrollWidth <= clientWidth,
      `scrollWidth=${scrollWidth}, clientWidth=${clientWidth}`,
    )

    await snap(page, `flip-corners-${label}`)
    await context.close()
  }

  // ---------------------------------------------------------------- desktop: still pinned
  {
    const { context, page } = await openPage(browser, DESKTOP)
    const pins = await readPins(page)
    const dead = pins.filter((pin) => pin.asked && pin.resolved !== 'sticky')
    check(
      'every pin on the page, sidebars included, still pins at 1280px',
      pins.length >= 11 && dead.length === 0,
      `${pins.length - dead.length}/${pins.length} sticky${dead.length ? `; dead: ${dead.map((p) => p.label).join(', ')}` : ''}`,
    )

    const corners = await readFlipCorners(page)
    const misplaced = corners.filter((card) => !inBottomLeftCorner(card, CORNER_INSET))
    check(
      "every flip control sits in its card's bottom-left corner at 1280px too",
      corners.length === 3 && misplaced.length === 0,
      misplaced.length ? describeCorners(misplaced) : describeCorners(corners),
    )

    await snap(page, 'desktop-1280-top')
    await context.close()
  }

  return results
}
