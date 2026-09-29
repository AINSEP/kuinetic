/**
 * Plumbing for the page-level browser tier (`page-*.test.mjs`, `scripts/visual-regression-pages.mjs`):
 * discovering `demo/*.html`, opening one in a controlled context, and scrolling / settling it the
 * same way everywhere. Not a suite — `run-browser-tests.mjs` only imports top-level `*.test.mjs`.
 *
 * Every helper here assumes a HEADLESS page that Playwright drives directly. A headless page is
 * always "visible", so `requestAnimationFrame` and `IntersectionObserver` run; a page in a
 * background tab of a real browser freezes both, and every `on:enter` effect then looks dead. Never
 * point this at a headed or backgrounded browser or at the Chrome extension.
 *
 * One page per context: a context carries the page's `localStorage` (theme), its route stubs, and
 * its collectors, and none of that should leak into the next page.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEMO_ROOT = fileURLToPath(new URL('../../../demo', import.meta.url))

/**
 * The three viewports the page tier runs at. `phone` and `tablet` are mobile-emulated (touch,
 * meta-viewport honoured, layout viewport widens on overflow — which check B relies on); `desktop`
 * is not, so `setViewportSize` is a pure resize there.
 */
export const VIEWPORTS = {
  phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 },
  tablet: { viewport: { width: 820, height: 1180 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 },
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
}

/** Pages under `demo/` that are not tested, each with the reason. */
export const EXCLUDED = {
  'index-old.html': 'legacy snapshot of the previous home page, kept for reference (scripts/generate-nav-header.mjs)',
}

/** localStorage key `demo/theme.js` and each page's inline boot script read. */
const THEME_KEY = 'kuinetic-showcase-theme'

/**
 * Every testable demo page, discovered at run time so a new page is covered the day it lands.
 *
 * `usesReplay` and `themes` are read off the page's own source rather than listed here: a list would
 * drift from the pages, and this is the tier that exists to catch drift.
 *
 * @returns `{ file, html, usesReplay, themes }[]` in file-name order.
 * @complexity O(p) time and space in page count; one file read each.
 * @overallScore 100
 */
export function listDemoPages() {
  const pages = readdirSync(DEMO_ROOT)
    .filter((file) => file.endsWith('.html') && !EXCLUDED[file])
    .sort()
    .map((file) => {
      const html = readFileSync(join(DEMO_ROOT, file), 'utf8')
      return {
        file,
        html,
        usesReplay: /<script[^>]+src="\.\/replay\.js"/.test(html),
        themes: /kuinetic-showcase-theme|prefers-color-scheme/.test(html) ? ['light', 'dark'] : ['light'],
      }
    })
  // A directory rename or a wrong cwd would otherwise let every per-page check pass over nothing.
  if (pages.length < 15 || !pages.some((page) => page.file === 'index.html')) {
    throw new Error(`demo page discovery found ${pages.length} pages (expected 15+ including index.html)`)
  }
  return pages
}

/** A 1x1 transparent PNG, the stand-in for any off-origin image. */
const BLANK_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)

/**
 * Answer every off-origin request locally. Fulfilled, never aborted: an aborted request logs a
 * console error, which check A would then report as the page's fault. The pages reach Google Fonts
 * and YouTube thumbnails; the tier must not depend on the network being up or on those hosts.
 */
async function stubOffOrigin(context, origin) {
  await context.route('**/*', (route) => {
    const request = route.request()
    if (request.url().startsWith(origin) || request.url().startsWith('data:') || request.url().startsWith('blob:')) {
      return route.continue()
    }
    switch (request.resourceType()) {
      case 'image':
        return route.fulfill({ status: 200, contentType: 'image/png', body: BLANK_PNG })
      case 'stylesheet':
        return route.fulfill({ status: 200, contentType: 'text/css', body: '' })
      default:
        return route.fulfill({ status: 204, body: '' })
    }
  })
}

/**
 * Open one demo page in a fresh context and wait until it is really ready.
 *
 * "Ready" is `window.__kui` (every page sets it from `kuinetic.kuinetic(...).start()`), web fonts
 * loaded, two frames past that, plus a beat for the first `on:enter` observers to report. Smooth
 * scrolling is forced off so every scripted scroll lands where it was asked.
 *
 * @param browser - The shared browser.
 * @param origin - `startStaticServer()`'s origin.
 * @param file - Page file name, e.g. `index.html`.
 * @param contextOptions - One of `VIEWPORTS`.
 * @param options.theme - `'light'` or `'dark'`; written to localStorage before any page script runs.
 * @param options.beforeGoto - Optional `async (page, context)` hook, e.g. to install a fake clock.
 * @returns `{ context, page, collected }` — `collected` holds `errors` (uncaught), `consoleErrors`,
 *   `kuiWarnings` (library warnings; report-only) and `brokenAssets` (same-origin responses >= 400).
 * @complexity O(1) round trips beyond the load itself.
 * @overallScore 100
 */
export async function openDemoPage(browser, origin, file, contextOptions, { theme = 'light', beforeGoto } = {}) {
  const context = await browser.newContext({
    ...contextOptions,
    colorScheme: theme,
    reducedMotion: 'no-preference',
  })
  await context.addInitScript(
    ([key, value]) => {
      try {
        localStorage.setItem(key, value)
      } catch {
        // storage blocked: the page falls back to prefers-color-scheme, which is also set above
      }
    },
    [THEME_KEY, theme],
  )
  await stubOffOrigin(context, origin)

  const page = await context.newPage()
  const collected = { errors: [], consoleErrors: [], kuiWarnings: [], brokenAssets: [] }
  page.on('pageerror', (error) => collected.errors.push(String(error)))
  page.on('console', (msg) => {
    if (msg.type() === 'error') collected.consoleErrors.push(msg.text())
    // The library's own diagnostics read "kuinetic: ..." (sometimes "[kuinetic] ...").
    else if (msg.type() === 'warning' && /^\[?kuinetic\]?:?\s/.test(msg.text())) collected.kuiWarnings.push(msg.text())
  })
  page.on('response', (response) => {
    if (response.url().startsWith(origin) && response.status() >= 400) {
      collected.brokenAssets.push(`${response.status()} ${response.url().slice(origin.length)}`)
    }
  })

  if (beforeGoto) await beforeGoto(page, context)
  await page.goto(`${origin}/${file}`, { waitUntil: 'load' })
  await page.waitForFunction(() => window.__kui !== undefined, undefined, { timeout: 20000 })
  if (file === 'docs.html') {
    // The body is fetched markdown: nothing to measure until a heading and the TOC exist.
    await page.waitForSelector('#doc-body h2', { timeout: 20000 })
    await page.waitForFunction(() => document.getElementById('doc-toc')?.hidden === false, undefined, { timeout: 20000 })
  }
  await page.evaluate(() => document.fonts.ready)
  await nextFrames(page, 2)
  await page.waitForTimeout(150)
  await page.addStyleTag({ content: 'html{scroll-behavior:auto !important}' })
  return { context, page, collected }
}

/** Resolve after `count` animation frames. */
export function nextFrames(page, count = 2) {
  return page.evaluate(
    (n) =>
      new Promise((resolve) => {
        const step = (left) => (left === 0 ? resolve() : requestAnimationFrame(() => step(left - 1)))
        step(n)
      }),
    count,
  )
}

/**
 * Scroll to an absolute offset and report where the page actually landed.
 *
 * `scrollTo` clamps at the document's end and the home page's `scroll-snap-y` can pull a landing to
 * a section edge, so a caller compares `landed` against `Math.min(asked, max)` with a tolerance
 * instead of assuming the request was honoured.
 *
 * @returns `{ asked, landed, max }`.
 * @complexity O(1) round trips.
 * @overallScore 100
 */
export async function scrollToY(page, y) {
  await page.evaluate((top) => window.scrollTo({ top, behavior: 'instant' }), y)
  await nextFrames(page, 2)
  await page.waitForTimeout(60)
  const { landed, max } = await page.evaluate(() => ({
    landed: window.scrollY,
    max: document.documentElement.scrollHeight - window.innerHeight,
  }))
  return { asked: y, landed, max }
}

/**
 * Scroll the whole page top to bottom in 0.8-viewport steps, then back to 0.
 *
 * That fires every `on:enter`/scroll-driven effect on the page (so a mid-page error surfaces in the
 * collectors) and leaves the page at the top for the measurements that assume it. On `index.html`
 * the `scroll-snap-y` proximity snap can move a landing, so only the two ends are asserted there.
 * `onStep(y)` runs after each mid-page step, for a caller that wants to sample something along the way.
 *
 * @returns `{ steps, bottomLanded, bottomMax, topLanded }`.
 * @complexity O(h / (0.8 * viewport height)) round trips in page height.
 * @overallScore 100
 */
export async function walkPage(page, onStep) {
  const { height, max } = await page.evaluate(() => ({
    height: window.innerHeight,
    max: document.documentElement.scrollHeight - window.innerHeight,
  }))
  const stride = Math.max(1, Math.round(height * 0.8))
  let steps = 0
  let last = null
  for (let y = stride; y < max; y += stride) {
    last = await scrollToY(page, y)
    steps += 1
    if (onStep) await onStep(y)
  }
  const bottom = await scrollToY(page, max)
  const top = await scrollToY(page, 0)
  return { steps, bottomLanded: bottom.landed, bottomMax: bottom.max, topLanded: top.landed, lastMid: last }
}

/**
 * Put every running animation into a stable end state so a measurement does not depend on timing.
 *
 * Document-timeline animations are finished (not seeked to 0: entrance presets start from tiny or
 * zero-area states such as `bounce-in scale:0.05`, and those are the states a "visible text" check
 * must not be measuring); infinite ones cannot finish, so they are paused at 0. Scroll- and
 * view-driven timelines are left alone — they are functions of scroll position, already stable.
 *
 * @complexity O(a) time in running animations; two frames.
 * @overallScore 100
 */
export async function settle(page) {
  await page.evaluate(() => {
    for (const animation of document.getAnimations()) {
      if (animation.timeline !== document.timeline) continue
      const end = animation.effect?.getComputedTiming().endTime
      if (end === Infinity) {
        animation.pause()
        animation.currentTime = 0
        continue
      }
      try {
        animation.finish()
      } catch {
        // finish() throws on a zero-rate or infinite animation; a paused one is stable already
      }
    }
  })
  await nextFrames(page, 2)
}

/** `settle`, plus the two things a screenshot would otherwise catch mid-change: video frames and the caret. */
export async function freezeForScreenshot(page) {
  await settle(page)
  await page.addStyleTag({ content: '*{caret-color:transparent !important}' })
  await page.evaluate(() => {
    for (const video of document.querySelectorAll('video')) {
      video.pause()
      try {
        video.currentTime = 0
      } catch {
        // a video with no loaded metadata cannot seek; it has no frame to differ either
      }
    }
  })
  await nextFrames(page, 2)
}

/**
 * Serialised into pages via `page.evaluate`, so it must stay self-contained: a short CSS-ish path
 * (`tag#id.class.class`, up to four ancestors) good enough to find an element again by eye.
 */
export const SELECTOR_PATH_SOURCE = `(el) => {
  const parts = []
  for (let node = el; node && node.nodeType === 1 && parts.length < 4; node = node.parentElement) {
    let part = node.localName
    if (node.id) part += '#' + node.id
    else if (node.classList.length) part += '.' + [...node.classList].slice(0, 2).join('.')
    parts.unshift(part)
    if (node.id) break
  }
  return parts.join(' > ')
}`
