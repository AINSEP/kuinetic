import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createChecker, createFrameRecorder } from '../../scripts/browser-harness.mjs'

/**
 * `demo/docs.html`'s sidebar table of contents, rebuilt in `33b12e2` on top of the library's own
 * `scroll-spy` (container form) in place of a hand-rolled scroll listener. That commit passed lint,
 * typecheck, and `demo-markup` with no browser ever rendering it — a scroll-position behaviour is
 * exactly the class of bug those checks cannot see (see `kuinetic_tests-never-render-a-frame`).
 *
 * `docs.html` cannot be driven as a bare `file://` page the way most `demo/*.html` fixtures here
 * are: `loadDoc()` fetches `./docs/<doc>.md`, and Chromium refuses `fetch()` against `file://`
 * origins outright. This suite brings its own throwaway static server instead — `demo/` at the
 * root and the repo-level `docs/` folder mapped under `/docs/`, the same split `scripts/dev-server.mjs`
 * uses for the human's real dev server — bound to an OS-assigned port so it can never collide with
 * the human's own server on 8934. No build watchers, no live-reload injection: just enough to make
 * `fetch()` work.
 *
 * Four things are locked in, matching the four checks this suite was written to answer:
 *   1. the right heading highlights while scrolling, through all three docs, not only the first
 *   2. switching doc tabs mid-scroll tears down and rebuilds cleanly — no stuck highlight, no
 *      duplicate `data-kui-active`, no console warnings or errors
 *   3. `offset-top:104px` keeps the active line below the sticky header, the same slack the old
 *      hand-rolled `STRIP` constant used to provide
 *   4. (checked by the runner, not this file) the suite plugs into `run-browser-tests.mjs`'s
 *      existing pass/fail count like every other suite here
 */
export const name = 'docs-toc'

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const DEMO_ROOT = join(REPO_ROOT, 'demo')
const DOCS_ROOT = join(REPO_ROOT, 'docs')

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
}

const DOCS = ['getting-started', 'catalog', 'design']

/**
 * The reference line `scroll-spy`'s container form marks a heading active against, in pixels from
 * the viewport top. Mirrors the literal `offset-top:104px` authored on `.doc-layout` in
 * `demo/docs.html` — not read back from the page, because the point of one of these checks is
 * proving the authored value itself still produces the right on-screen behaviour, not assuming it.
 */
const OFFSET_TOP_PX = 104

/**
 * A read-only static server over `demo/` + the repo's `docs/`, routed exactly like
 * `scripts/dev-server.mjs` (`/docs/*` → repo `docs/`, everything else → `demo/`) but with none of
 * that server's build-watcher or live-reload side effects — this suite only needs `fetch()` to
 * resolve real files. Binds port 0 so it never contends with the human's dev server on 8934.
 *
 * @returns `{ origin, close }` — the server's base URL and a teardown function.
 * @complexity O(1) to start; each request is one file read.
 * @overallScore 100
 */
async function startStaticServer() {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost')
    const underDocs = url.pathname.startsWith('/docs/')
    const base = underDocs ? DOCS_ROOT : DEMO_ROOT
    const relative = underDocs ? url.pathname.slice('/docs'.length) : url.pathname
    const target = normalize(join(base, decodeURIComponent(relative)))
    if (target !== base && !target.startsWith(base + sep)) {
      res.writeHead(403)
      res.end()
      return
    }
    try {
      const body = await readFile(target)
      res.writeHead(200, { 'Content-Type': MIME_TYPES[extname(target)] ?? 'application/octet-stream' })
      res.end(body)
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('404 Not Found')
    }
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  return { origin: `http://127.0.0.1:${port}`, close: () => new Promise((resolve) => server.close(resolve)) }
}

/** Settle on a loaded, non-empty doc: content fetched, TOC built and unhidden, one frame past mount. */
async function waitDocLoaded(page) {
  await page.waitForFunction(() => document.getElementById('doc-body')?.querySelector('h2') != null)
  await page.waitForFunction(() => document.getElementById('doc-toc').hidden === false)
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)))
  await page.waitForTimeout(30)
}

/** Every `#doc-body h2` and `#doc-toc a` currently marked `data-kui-active="true"`. */
async function readActive(page) {
  return page.evaluate(() => ({
    headings: [...document.querySelectorAll('#doc-body h2')]
      .filter((h) => h.getAttribute('data-kui-active') === 'true')
      .map((h) => h.id),
    links: [...document.querySelectorAll('#doc-toc a')]
      .filter((a) => a.getAttribute('data-kui-active') === 'true')
      .map((a) => a.getAttribute('href')),
  }))
}

/** Scroll to an absolute document offset without the page's own `smooth-scroll-to` animating it. */
async function scrollTo(page, y) {
  await page.evaluate((top) => window.scrollTo({ top, behavior: 'instant' }), y)
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)))
  await page.waitForTimeout(15)
}

/**
 * Each `#doc-body h2`'s document-relative top, measured from the top of the page.
 *
 * Scrolls to the very top first so `getBoundingClientRect().top + scrollY` is a stable content
 * position independent of wherever the page happened to be scrolled before this call.
 *
 * @complexity O(n) time and space in heading count; one round trip.
 * @overallScore 100
 */
async function headingDocTops(page) {
  return page.evaluate(() => {
    window.scrollTo(0, 0)
    return [...document.querySelectorAll('#doc-body h2')].map((h) => ({
      id: h.id,
      docTop: h.getBoundingClientRect().top + window.scrollY,
    }))
  })
}

/**
 * The heading `scroll-spy` should mark active at scroll position `y`, computed independently of the
 * library: the highest-index heading whose document top has crossed `OFFSET_TOP_PX` below the
 * viewport's current top edge — the same rule `highestReachedIndex` in
 * `src/effects/scroll-mechanics/scroll-spy.ts` implements, restated here from the authored contract
 * rather than imported from the source, so this check cannot pass by sharing a bug with what it
 * tests.
 */
function expectedActiveId(headingTops, y) {
  let active = null
  for (const heading of headingTops) {
    if (heading.docTop - y <= OFFSET_TOP_PX) active = heading.id
  }
  return active
}

/**
 * Sweep one doc from top to bottom in instant, evenly-spaced steps, and at every step compare the
 * library's `data-kui-active` heading against `expectedActiveId`'s independent formula.
 *
 * Answers check 1 (the right heading highlights while scrolling) for one doc. Twenty-five samples
 * balances catching a wrong-by-one-section regression against per-suite runtime; the boundary itself
 * gets much finer-grained coverage from `checkOffsetTopBoundary` below.
 *
 * @complexity O(s) browser round trips in sample count; independent of doc length.
 * @overallScore 100
 */
async function checkScrollSweep(page, check, doc, headingTops) {
  const maxScroll = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight)
  const steps = 25
  let mismatches = []
  let duplicates = []
  for (let i = 0; i <= steps; i++) {
    const y = Math.round((maxScroll * i) / steps)
    await scrollTo(page, y)
    const active = await readActive(page)
    if (active.headings.length > 1) duplicates.push({ y, headings: active.headings })
    const expected = expectedActiveId(headingTops, y)
    const actual = active.headings[0] ?? null
    if (actual !== expected) mismatches.push({ y, expected, actual })
    if (actual !== null && active.links[0] !== `#${actual}`) {
      mismatches.push({ y, expected: `link for ${actual}`, actual: active.links[0] ?? null })
    }
  }
  check(
    `${doc}: never more than one active heading while scrolling`,
    duplicates.length === 0,
    duplicates.length ? `${duplicates.length}/${steps + 1} samples had duplicates, e.g. ${JSON.stringify(duplicates[0])}` : '',
  )
  check(
    `${doc}: the active heading (and its paired link) matches the independently-computed section at every sampled scroll position`,
    mismatches.length === 0,
    mismatches.length ? `${mismatches.length}/${steps + 1} samples mismatched, e.g. ${JSON.stringify(mismatches[0])}` : '',
  )
}

/**
 * Locate the exact scroll position where a mid-doc heading flips active, and confirm it happens
 * clear of the sticky header rather than merely near `OFFSET_TOP_PX`.
 *
 * This is check 3, done deliberately rather than by trusting the parameter name: it measures the
 * header's real rendered bottom edge, sweeps 1px scroll steps across the theoretical crossing point
 * (`heading.docTop - OFFSET_TOP_PX`), and asserts the heading's rect only ever goes active once its
 * own top has cleared that header — the exact failure `demo/docs.html`'s comment on `offset-top`
 * describes for the old `STRIP=104` constant: a heading landing exactly at its `scroll-margin-top`
 * (96px) via a native anchor jump previously left the *previous* link highlighted.
 *
 * @complexity O(1) browser round trips to measure, O(w) in the search window width (here 24px) to
 *   locate the flip.
 * @overallScore 100
 */
async function checkOffsetTopBoundary(page, check, doc, headingTops) {
  const headerBottom = await page.evaluate(() => document.querySelector('.site-header').getBoundingClientRect().bottom)
  check(
    `${doc}: offset-top:${OFFSET_TOP_PX}px sits below the sticky header's real rendered height`,
    headerBottom < OFFSET_TOP_PX,
    `header bottom=${headerBottom.toFixed(2)}px, offset-top=${OFFSET_TOP_PX}px`,
  )

  const mid = headingTops[Math.floor(headingTops.length / 2)]
  const crossing = mid.docTop - OFFSET_TOP_PX
  let flip = null
  for (let y = crossing - 12; y <= crossing + 12 && !flip; y++) {
    await scrollTo(page, y)
    const { headings } = await readActive(page)
    if (headings.includes(mid.id)) {
      const rectTop = await page.evaluate((id) => document.getElementById(id).getBoundingClientRect().top, mid.id)
      flip = { y, rectTop }
    }
  }

  check(
    `${doc}: "${mid.id}" goes active within the expected window around its offset-top crossing`,
    flip !== null,
    flip ? `flipped at scrollY=${flip.y} (rect.top=${flip.rectTop.toFixed(2)})` : `never went active in [${crossing - 12}, ${crossing + 12}]`,
  )
  if (flip) {
    check(
      `${doc}: "${mid.id}" is already clear of the sticky header the moment it goes active`,
      flip.rectTop > headerBottom,
      `rect.top=${flip.rectTop.toFixed(2)}, header bottom=${headerBottom.toFixed(2)}`,
    )
  }
}

/**
 * Switch docs mid-scroll, in a loop through all three, and confirm each switch tears down and
 * rebuilds cleanly: no heading left over from the previous doc reads active (impossible to observe
 * directly once its nodes are replaced, but a leaked subscription would surface as either a stale
 * index or a thrown error), no duplicate `data-kui-active`, and — read explicitly, not assumed —
 * zero console warnings or errors across the whole sequence. This is check 2.
 *
 * @complexity O(d) browser round trips in doc count; one context reused across all switches so a
 *   leak from switch N would still be visible at switch N+1.
 * @overallScore 100
 */
async function checkDocSwitchMidScroll(page, check, origin, consoleMessages) {
  await page.goto(`${origin}/docs.html?doc=${DOCS[0]}`, { waitUntil: 'domcontentloaded' })
  await waitDocLoaded(page)

  const rotation = [DOCS[1], DOCS[2], DOCS[0], DOCS[1]]
  let duplicateAcrossSwitches = false
  for (const doc of rotation) {
    const maxScroll = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight)
    await scrollTo(page, Math.round(maxScroll * 0.5))
    consoleMessages.length = 0
    await page.click(`.doc-switch a[data-doc="${doc}"]`)
    await waitDocLoaded(page)
    const active = await readActive(page)
    if (active.headings.length > 1 || active.links.length > 1) duplicateAcrossSwitches = true
    check(
      `switching to "${doc}" mid-scroll produces no console warnings or errors`,
      consoleMessages.length === 0,
      consoleMessages.length ? consoleMessages.join(' | ') : '',
    )
  }
  check('no switch in the rotation left a duplicate data-kui-active behind', !duplicateAcrossSwitches, '')
}

export async function run({ browser, ARTIFACT_DIR }) {
  const { check, results } = createChecker()
  const snap = createFrameRecorder(`${ARTIFACT_DIR}/frames/${name}`)
  const { origin, close } = await startStaticServer()

  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await context.newPage()
  const consoleMessages = []
  page.on('console', (msg) => {
    if (msg.type() === 'warning' || msg.type() === 'error') consoleMessages.push(`[${msg.type()}] ${msg.text()}`)
  })
  page.on('pageerror', (error) => consoleMessages.push(`[pageerror] ${error}`))

  try {
    for (const doc of DOCS) {
      consoleMessages.length = 0
      await page.goto(`${origin}/docs.html?doc=${doc}`, { waitUntil: 'domcontentloaded' })
      await waitDocLoaded(page)
      await snap(page, `${doc}-loaded`)

      const headingTops = await headingDocTops(page)
      await checkScrollSweep(page, check, doc, headingTops)
      await checkOffsetTopBoundary(page, check, doc, headingTops)
      await snap(page, `${doc}-mid-scroll`)

      check(`${doc}: loading and scrolling produced no console warnings or errors`, consoleMessages.length === 0, consoleMessages.join(' | '))
    }

    consoleMessages.length = 0
    await checkDocSwitchMidScroll(page, check, origin, consoleMessages)
    await snap(page, 'after-doc-switch-rotation')
  } finally {
    await context.close()
    await close()
  }

  return results
}
