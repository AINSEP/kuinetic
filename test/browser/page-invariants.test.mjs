import { mkdirSync, rmSync } from 'node:fs'
import { createChecker, startStaticServer } from '../../scripts/browser-harness.mjs'
import {
  SELECTOR_PATH_SOURCE,
  VIEWPORTS,
  listDemoPages,
  openDemoPage,
  settle,
  walkPage,
  scrollToY,
} from './lib/demo-pages.mjs'

/**
 * Invariants every `demo/*.html` page must hold, at phone, tablet and desktop widths.
 *
 * The rest of `test/browser/` proves the library's effects on purpose-built fixtures. None of it
 * renders the shipped pages, so a page can regress while every effect suite stays green — it has:
 * a home-page reel that stopped moving because the window scroller was treated as an inner
 * scroller, and section text that collapsed to zero width when a layout rule changed. This suite
 * is the net under the pages themselves: it loads each one over a throwaway static server, walks
 * it, and checks properties that are true of every page rather than of any one effect.
 *
 * Checks (each named `<page> @ <viewport>: <invariant>`):
 *   A. no uncaught error, console error, or broken same-origin asset from load through a full walk
 *   B. no horizontal overflow at scroll 0
 *   C. no visible text element collapsed to zero size (or font-size 0)
 *   D. the sticky/fixed header does not cover the first heading at scroll 0
 *   F. (index.html) the reel moves: scrolling through it advances `--kui-progress` and slides the track
 *   G. (index.html) the hero title column has not collapsed, and its heading is a real size
 *   E. the replay button (pages that load `replay.js`) sits fully inside the viewport and is what
 *      a tap at its centre would hit
 *
 * Off-origin requests (Google Fonts, YouTube thumbnails) are answered with local stand-ins, so the
 * result never depends on the network. Library warnings (`kuinetic: ...`) are reported in the
 * detail of check A but do not fail it yet.
 */
export const name = 'page-invariants'

/**
 * Console errors that are properties of this environment, not of a page. Each entry needs a
 * `reason`; an entry that matches nothing in a whole run fails the suite, so this list cannot go
 * stale and quietly widen.
 *
 * @type {{ page: string, pattern: RegExp, reason: string }[]}
 */
const KNOWN_CONSOLE = []

const usedKnownConsole = new Set()

/**
 * The button `replay.js` mounts: a direct child of `<body>`, labelled for what it does. Not bare
 * `.kui-replay-fab` — `nav-forms.html` reuses that class on an unrelated back-to-top demo inside a
 * scroll box.
 */
const REPLAY_FAB = 'body > button.kui-replay-fab[aria-label^="Replay"]'

/** Pages where check E found a replay button. */
const pagesWithFab = new Set()

/** Pages where check D found a sticky/fixed header to test against. */
const pagesWithHeader = new Set()

/**
 * Text boxes that legitimately measure zero in a way this environment cannot tell from a bug. Same
 * rules as `KNOWN_CONSOLE`: a `reason` each, and a stale entry fails the suite.
 *
 * @type {{ page: string, selector: string, reason: string }[]}
 */
const KNOWN_ZERO_SIZE = []

const usedKnownZeroSize = new Set()

/** Drop console errors covered by `KNOWN_CONSOLE`, recording which entries earned their place. */
function withoutKnownConsole(file, messages) {
  return messages.filter((message) => {
    const entry = KNOWN_CONSOLE.find((known) => known.page === file && known.pattern.test(message))
    if (entry) usedKnownConsole.add(entry)
    return !entry
  })
}

const firstFew = (items, count = 3) => items.slice(0, count).join(' | ')

/**
 * Check B in the page. Passes iff the layout viewport never widened (mobile emulation widens it to
 * fit overflowing content, so `innerWidth` growing is the overflow itself), the page cannot be
 * scrolled sideways, and the document is not wider than the viewport unless `html`/`body` clip it.
 * On failure it names the five widest elements that stick out past the viewport and are not inside
 * a clipping ancestor, so the fix is a lookup rather than a hunt.
 */
async function measureOverflow(page, viewportWidth) {
  return page.evaluate(
    ({ selectorSource, width }) => {
      const selectorPath = (0, eval)(selectorSource)
      const root = document.documentElement
      const clips = (el) => ['hidden', 'clip', 'auto', 'scroll'].includes(getComputedStyle(el).overflowX)
      const rootClips = ['hidden', 'clip'].includes(getComputedStyle(root).overflowX) ||
        ['hidden', 'clip'].includes(getComputedStyle(document.body).overflowX)

      window.scrollTo({ left: 100000, behavior: 'instant' })
      const scrolledX = window.scrollX
      window.scrollTo({ left: 0, behavior: 'instant' })

      const clipCache = new WeakMap()
      const insideClip = (el) => {
        for (let node = el.parentElement; node && node !== document.body && node !== root; node = node.parentElement) {
          if (!clipCache.has(node)) clipCache.set(node, clips(node))
          if (clipCache.get(node)) return true
        }
        return false
      }
      // A fixed box never adds to the document's scrollable width — when one sits past the edge it is
      // only riding a layout viewport something else widened — so it is not a culprit.
      const insideFixed = (el) => {
        for (let node = el; node && node !== root; node = node.parentElement) {
          if (getComputedStyle(node).position === 'fixed') return true
        }
        return false
      }
      const limit = root.clientWidth + 1
      const offenders = []
      const clippedButPast = []
      const fixedPast = []
      for (const el of document.querySelectorAll('*')) {
        // The root is as wide as the (already widened) layout viewport: a symptom, never the cause.
        if (el === root) continue
        const rect = el.getBoundingClientRect()
        if (rect.width === 0 && rect.height === 0) continue
        // Text or children spilling out of a box that does not clip them stick out further than the
        // box's own rect; scrollWidth is where that shows up.
        const spills = clips(el) ? 0 : el.scrollWidth - el.clientWidth
        const right = Math.max(rect.right, spills > 0 ? rect.left + el.scrollWidth : 0)
        if (right <= limit) continue
        if (insideFixed(el)) {
          fixedPast.push({ path: selectorPath(el) + ' (fixed)', right: Math.round(right) })
          continue
        }
        // A clipping ancestor is not proof of innocence (an absolutely-positioned child escapes a
        // clip its containing block is outside of), so keep those as a fallback lead.
        if (insideClip(el)) clippedButPast.push({ path: selectorPath(el) + ' (inside a clipping ancestor)', right: Math.round(right) })
        else offenders.push({ path: selectorPath(el), right: Math.round(right) })
      }
      offenders.sort((a, b) => b.right - a.right)
      clippedButPast.sort((a, b) => b.right - a.right)
      if (offenders.length === 0) offenders.push(...clippedButPast.slice(0, 5), ...fixedPast.slice(0, 5))

      return {
        innerWidth: window.innerWidth,
        scrolledX,
        scrollWidth: root.scrollWidth,
        clientWidth: root.clientWidth,
        rootClips,
        wider: width,
        offenders: offenders.slice(0, 5),
      }
    },
    { selectorSource: SELECTOR_PATH_SOURCE, width: viewportWidth },
  )
}

/**
 * Check C in the page: every element that directly holds visible text must have a real box.
 *
 * Layout sizes (`offsetWidth`/`offsetHeight`), not painted rects: an entrance preset legitimately
 * starts at `scale:0.05` or a zero-area clip, and a rect would call those collapsed. `offsetWidth`
 * is the layout box, so it is 0 only when layout itself gave the text no room — the failure where a
 * flex/grid change squeezed a column to nothing. Width AND height are read; a height-only check
 * missed exactly that bug.
 *
 * Skipped, and counted in the detail so a growing skip count is visible: text that is not
 * displayed at all (`checkVisibility`) and text inside a clipping ancestor that is itself zero in
 * either axis (a collapsed accordion or closed menu — zero is its job).
 */
async function findCollapsedText(page, knownSelectors) {
  return page.evaluate(({ selectorSource, known }) => {
    const selectorPath = (0, eval)(selectorSource)
    const root = document.documentElement
    const skipTags = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT', 'HEAD', 'OPTION', 'OPTGROUP'])
    const visible = (el) =>
      // Both spellings of each option: Chromium renamed them, and an unknown key is silently ignored.
      el.checkVisibility({
        checkOpacity: false,
        checkVisibilityCSS: true,
        visibilityProperty: true,
        contentVisibilityAuto: true,
      })
    const inCollapsedClip = (el) => {
      for (let node = el.parentElement; node && node !== root; node = node.parentElement) {
        const style = getComputedStyle(node)
        const clips = [style.overflowX, style.overflowY].some((value) => value === 'hidden' || value === 'clip')
        if (clips && (node.offsetWidth === 0 || node.offsetHeight === 0)) return true
      }
      return false
    }
    const widths = (el) => {
      const chain = []
      for (let node = el; node && node !== root; node = node.parentElement) {
        chain.push(`${node.localName}=${node.offsetWidth}`)
        if (node.offsetWidth > 0 && node !== el) break
      }
      return chain.join(' < ')
    }

    let checked = 0
    let skipped = 0
    const offenders = []
    for (const el of document.querySelectorAll('body *')) {
      if (skipTags.has(el.tagName) || el.closest('svg, template, noscript')) continue
      const hasText = [...el.childNodes].some((node) => node.nodeType === 3 && node.textContent.trim() !== '')
      if (!hasText) continue
      if (getComputedStyle(el).display === 'contents') continue
      if (!visible(el) || inCollapsedClip(el)) {
        skipped += 1
        continue
      }
      checked += 1
      const fontSize = Number.parseFloat(getComputedStyle(el).fontSize)
      if (fontSize === 0 || el.offsetWidth === 0 || el.offsetHeight === 0) {
        offenders.push({
          known: known.find((selector) => el.matches(selector)) ?? null,
          path: selectorPath(el),
          text: el.textContent.trim().replace(/\s+/g, ' ').slice(0, 30),
          size: `${el.offsetWidth}x${el.offsetHeight}`,
          fontSize,
          chain: widths(el),
        })
      }
    }
    return { checked, skipped, offenders }
  }, { selectorSource: SELECTOR_PATH_SOURCE, known: knownSelectors })
}

/**
 * Check D in the page: at scroll 0 the first heading must not sit under the page's sticky or fixed
 * header. Pages start with their header over the top of the document, so a hero that lost its top
 * padding slides the title beneath it. Visual rects, 1px of tolerance. Returns `applies: false` when
 * the page has no such header (only `motif-blueprint.html` today), which the caller counts.
 */
async function measureHeaderOverlap(page, file) {
  return page.evaluate(
    ({ selectorSource, docs }) => {
      const selectorPath = (0, eval)(selectorSource)
      const shows = (el) =>
        el.checkVisibility({ checkOpacity: false, checkVisibilityCSS: true, visibilityProperty: true })
      const header = [...document.querySelectorAll('.site-header, body > header')].find((el) =>
        ['fixed', 'sticky'].includes(getComputedStyle(el).position),
      )
      if (!header) return { applies: false }
      if (header.getAttribute('data-kui-hidden') === 'true') return { applies: true, hidden: true }
      // docs.html has no static h1 — its markdown body renders one after the fetch.
      const heading =
        (docs && document.querySelector('#doc-body h1')) ||
        [...document.querySelectorAll('h1')].find(shows) ||
        [...document.querySelectorAll('h2')].find(shows)
      if (!heading) return { applies: true, noHeading: true }
      const a = header.getBoundingClientRect()
      const b = heading.getBoundingClientRect()
      const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left)
      const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
      return {
        applies: true,
        overlap: overlapX > 1 && overlapY > 1 ? `${Math.round(overlapX)}x${Math.round(overlapY)}px` : null,
        header: `${selectorPath(header)} bottom=${Math.round(a.bottom)}`,
        heading: `${selectorPath(heading)} top=${Math.round(b.top)}`,
      }
    },
    { selectorSource: SELECTOR_PATH_SOURCE, docs: file === 'docs.html' },
  )
}

/**
 * Check E in the page: the floating replay button, once mounted, must be entirely on screen and not
 * buried under another layer. A `right:` offset that is wrong by a few rem pushes it off the edge of
 * a phone, where it is simply gone — nothing errors. `elementFromPoint` at its centre proves a tap
 * would land on it.
 */
async function measureReplayFab(page) {
  return page.evaluate((selector) => {
    const fab = document.querySelector(selector)
    if (!fab) return { found: false }
    const rect = fab.getBoundingClientRect()
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
    return {
      found: true,
      rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      hitIsFab: hit === fab || (hit !== null && fab.contains(hit)),
      hit: hit ? `${hit.localName}${hit.getAttribute('class') ? '.' + hit.getAttribute('class').split(' ')[0] : ''}` : 'nothing',
    }
  }, REPLAY_FAB)
}

/**
 * Check G in the page: the hero's title column keeps most of the hero's width and the headline a
 * headline's size. `.hero-title-col` is a size container (`container-type: inline-size`), which
 * reports no intrinsic width — when its parent stops stretching, it shrinks to nothing and the
 * `h1` inside goes to zero with it. Measured at scroll 0, settled, before any walk.
 */
async function measureHeroTitle(page) {
  return page.evaluate(() => {
    const column = document.querySelector('.hero-title-col')
    const inner = document.querySelector('.wrap.hero-inner')
    const heading = column?.querySelector('h1')
    if (!column || !inner || !heading) return { found: false }
    return {
      found: true,
      columnWidth: column.offsetWidth,
      innerWidth: inner.offsetWidth,
      fontSize: Number.parseFloat(getComputedStyle(heading).fontSize),
    }
  })
}

/** Read the reel's live progress (custom property on the `horizontal-scroll` host) and its track's x translation. */
async function readReel(page) {
  return page.evaluate(() => {
    const host = document.querySelector('#reel-track')
    const track = host.querySelector('.track')
    const translate = getComputedStyle(track).translate
    const x = translate === 'none' ? 0 : Number.parseFloat(translate.split(' ')[0])
    return { progress: Number.parseFloat(host.style.getPropertyValue('--kui-progress') || '0'), x: Number.isFinite(x) ? x : 0 }
  })
}

/**
 * Check F: the home page's horizontal reel actually moves as the page scrolls through it.
 *
 * The page composes `scroll-snap-y` on `<html>` with `horizontal-scroll` further down, and that
 * composition once left the reel dead: an overflowing `<html>` was mistaken for an inner scroller,
 * so the reel's progress was read from the wrong element and never advanced. Nothing errored and no
 * effect suite could see it, because none of them mount that composition. Three samples down the
 * reel's own scroll distance, reading live values (no settling — progress is a function of scroll).
 */
async function checkReel(page, record) {
  const composed = await page.evaluate(() => /scroll-snap-y/.test(document.documentElement.getAttribute('data-kui') ?? ''))
  await record('reel test runs on the composition under test (<html data-kui> has scroll-snap-y)', composed)

  const { top, vh } = await page.evaluate(() => ({
    top: document.querySelector('#reel-track').getBoundingClientRect().top + window.scrollY,
    vh: window.innerHeight,
  }))
  const sample = async (y) => {
    const landing = await scrollToY(page, y)
    await page.waitForTimeout(100)
    return { landing, ...(await readReel(page)) }
  }
  const before = await sample(top - 0.5 * vh)
  const middle = await sample(top + 1.5 * vh)
  const late = await sample(top + 2.6 * vh)

  const landed = Math.abs(middle.landing.landed - middle.landing.asked) <= 0.3 * vh
  const advanced = middle.progress - before.progress >= 0.2
  const slid = before.x - middle.x >= 40
  const keptGoing = late.progress > middle.progress
  await record(
    'reel progress advances and the track slides as the page scrolls through it',
    landed && advanced && slid && keptGoing,
    `progress ${before.progress.toFixed(2)} -> ${middle.progress.toFixed(2)} -> ${late.progress.toFixed(2)}, ` +
      `track x ${Math.round(before.x)} -> ${Math.round(middle.x)} -> ${Math.round(late.x)}px, ` +
      `middle sample landed at ${Math.round(middle.landing.landed)} (asked ${Math.round(middle.landing.asked)}, max ${Math.round(middle.landing.max)})`,
  )
}

/**
 * Every per-page invariant, for one page at one viewport, in its own context.
 *
 * Returns the outcomes instead of logging them: the three viewports of a page run concurrently, and
 * the caller emits each batch in order so the log reads page by page instead of interleaved.
 */
async function checkPageAtViewport({ browser, origin, shotDir, file, usesReplay, viewportName, contextOptions }) {
  const { context, page, collected } = await openDemoPage(browser, origin, file, contextOptions)
  const label = `${file} @ ${viewportName}`
  const entries = []
  /** Record one invariant; on failure keep the viewport as evidence. */
  const record = async (invariant, passed, detail = '') => {
    entries.push({ name: `${label}: ${invariant}`, passed, detail })
    if (!passed) {
      const slug = invariant.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
      await page.screenshot({ path: `${shotDir}/${file.replace('.html', '')}-${viewportName}-${slug}.png` })
    }
  }

  try {
    // D runs first: it is a property of the page as it opens, before a walk can move anything.
    await settle(page)
    const header = await measureHeaderOverlap(page, file)
    if (header.applies) pagesWithHeader.add(file)
    if (!header.applies || header.hidden || header.noHeading) {
      await record(
        'sticky header does not cover the first heading',
        true,
        header.applies ? (header.hidden ? 'n/a: header starts hidden' : 'n/a: no visible heading') : 'n/a: no sticky/fixed header',
      )
    } else {
      await record(
        'sticky header does not cover the first heading',
        header.overlap === null,
        header.overlap ? `${header.overlap} overlap: ${header.header} over ${header.heading}` : `${header.header}; ${header.heading}`,
      )
    }

    if (file === 'index.html') {
      const hero = await measureHeroTitle(page)
      const share = hero.found ? hero.columnWidth / hero.innerWidth : 0
      await record(
        'hero title column is not collapsed and the headline is a real size',
        hero.found && share >= 0.4 && hero.fontSize >= 24,
        hero.found
          ? `title column ${hero.columnWidth}px of ${hero.innerWidth}px (${(share * 100).toFixed(0)}%, want >= 40%), h1 ${hero.fontSize}px (want >= 24px)`
          : 'missing .hero-title-col, .wrap.hero-inner, or its h1',
      )
    }

    if (usesReplay) {
      // Mounted from `replay.js` on DOMContentLoaded; a missing button is itself the failure.
      await page.waitForSelector(REPLAY_FAB, { timeout: 5000 }).catch(() => {})
      const fab = await measureReplayFab(page)
      if (fab.found) pagesWithFab.add(file)
      const inside =
        fab.found &&
        fab.rect.width >= 24 &&
        fab.rect.height >= 24 &&
        fab.rect.left >= 0 &&
        fab.rect.top >= 0 &&
        fab.rect.right <= fab.viewport.width &&
        fab.rect.bottom <= fab.viewport.height
      await record(
        'replay button is inside the viewport and tappable',
        inside && fab.hitIsFab,
        !fab.found
          ? 'no replay button although the page loads replay.js'
          : `rect ${Math.round(fab.rect.left)},${Math.round(fab.rect.top)} ${Math.round(fab.rect.width)}x${Math.round(fab.rect.height)} ` +
              `in ${fab.viewport.width}x${fab.viewport.height}; centre hits ${fab.hit}`,
      )
    }

    const beforeWalk = await measureOverflow(page, contextOptions.viewport.width)
    // A phone widens its layout viewport the moment anything sticks out and may not shrink it
    // back, so an overflow that exists only at one scroll position still shows up at the end.
    // Sampling `innerWidth` along the walk names where it first happened.
    let firstWidened = null
    await walkPage(page, async (y) => {
      if (firstWidened) return
      const seen = await page.evaluate(() => window.innerWidth)
      if (seen !== contextOptions.viewport.width) {
        firstWidened = { y, offenders: (await measureOverflow(page, contextOptions.viewport.width)).offenders }
      }
    })
    await settle(page)
    await scrollToY(page, 0)

    const overflow = await measureOverflow(page, contextOptions.viewport.width)
    const widened = overflow.innerWidth !== contextOptions.viewport.width
    const scrollsSideways = overflow.scrolledX !== 0
    const documentWider = !overflow.rootClips && overflow.scrollWidth > overflow.clientWidth + 1
    await record(
      'no horizontal overflow',
      !widened && !scrollsSideways && !documentWider,
      widened || scrollsSideways || documentWider
        ? `innerWidth=${overflow.innerWidth} (want ${contextOptions.viewport.width}), scrollX after pushing right=${overflow.scrolledX}, ` +
            `scrollWidth=${overflow.scrollWidth} vs clientWidth=${overflow.clientWidth}; widest: ` +
            overflow.offenders.map((o) => `${o.path} right=${o.right}`).join('; ') +
            (firstWidened
              ? `; first widened at scrollY=${firstWidened.y} by ${firstWidened.offenders.map((o) => `${o.path} right=${o.right}`).join('; ')}`
              : '')
        : beforeWalk.scrollWidth > beforeWalk.clientWidth + 1 && !beforeWalk.rootClips
          ? `advisory: was ${beforeWalk.scrollWidth}px wide before the walk`
          : '',
    )

    const knownHere = KNOWN_ZERO_SIZE.filter((known) => known.page === file)
    const text = await findCollapsedText(page, knownHere.map((known) => known.selector))
    const collapsed = text.offenders.filter((offender) => {
      if (offender.known) usedKnownZeroSize.add(knownHere.find((known) => known.selector === offender.known))
      return !offender.known
    })
    await record(
      'no visible text collapsed to zero size',
      collapsed.length === 0,
      collapsed.length
        ? `${collapsed.length} of ${text.checked}: ` +
            collapsed
              .slice(0, 5)
              .map((o) => `${o.path} "${o.text}" ${o.size} font ${o.fontSize}px [${o.chain}]`)
              .join('; ')
        : `${text.checked} text boxes checked, ${text.skipped} skipped (hidden or in a collapsed clip)`,
    )

    if (file === 'index.html') await checkReel(page, record)

    const consoleErrors = withoutKnownConsole(file, collected.consoleErrors)
    const problems = collected.errors.length + consoleErrors.length + collected.brokenAssets.length
    await record(
      'no page errors, console errors, or broken assets',
      problems === 0,
      [
        collected.errors.length && `uncaught: ${firstFew(collected.errors)}`,
        consoleErrors.length && `console: ${firstFew(consoleErrors)}`,
        collected.brokenAssets.length && `assets: ${firstFew(collected.brokenAssets)}`,
        collected.kuiWarnings.length && `(report-only library warnings: ${firstFew(collected.kuiWarnings, 1)})`,
      ]
        .filter(Boolean)
        .join('; '),
    )
  } finally {
    await context.close()
  }
  return entries
}

export async function run({ browser, ARTIFACT_DIR }) {
  const { check, results } = createChecker()
  const shotDir = `${ARTIFACT_DIR}/${name}`
  rmSync(shotDir, { recursive: true, force: true })
  mkdirSync(shotDir, { recursive: true })
  const { origin, close } = await startStaticServer()
  // KUI_PAGES=reveals.html,tween-advanced.html narrows a local run; CI never sets it.
  const only = process.env.KUI_PAGES?.split(',')
  const pages = listDemoPages().filter((page) => !only || only.includes(page.file))

  try {
    for (const { file, usesReplay } of pages) {
      // The three viewports are independent contexts on the one shared browser; running them
      // together cuts the suite's wall time by about a third without sharing any page state.
      const batches = await Promise.all(
        Object.entries(VIEWPORTS).map(([viewportName, contextOptions]) =>
          checkPageAtViewport({ browser, origin, shotDir, file, usesReplay, viewportName, contextOptions }),
        ),
      )
      for (const entry of batches.flat()) check(entry.name, entry.passed, entry.detail)
    }
    // Without this, a selector typo that finds no header anywhere would pass every page as "n/a".
    if (!only) {
      check(
        'check D found a sticky/fixed header on at least 17 pages',
        pagesWithHeader.size >= 17,
        `found on ${pagesWithHeader.size}: missing ${pages.filter((p) => !pagesWithHeader.has(p.file)).map((p) => p.file).join(', ') || 'none'}`,
      )
    }
    if (!only) {
      const expected = pages.filter((p) => p.usesReplay).map((p) => p.file)
      check(
        `check E found a replay button on every page that loads replay.js (${expected.length})`,
        expected.length >= 10 && expected.every((file) => pagesWithFab.has(file)) && pagesWithFab.size === expected.length,
        `found on ${pagesWithFab.size}`,
      )
    }
    for (const entry of KNOWN_ZERO_SIZE) {
      check(
        `KNOWN_ZERO_SIZE entry for ${entry.page} (${entry.selector}) still matches something`,
        usedKnownZeroSize.has(entry),
        `stale entry — its reason was: ${entry.reason}`,
      )
    }
    for (const entry of KNOWN_CONSOLE) {
      check(
        `KNOWN_CONSOLE entry for ${entry.page} (${entry.pattern}) still matches something`,
        usedKnownConsole.has(entry),
        `stale entry — its reason was: ${entry.reason}`,
      )
    }
  } finally {
    await close()
  }

  return results
}
