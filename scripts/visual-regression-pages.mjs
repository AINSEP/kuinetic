/**
 * Whole-page pixel baselines for every `demo/*.html`, at phone / tablet / desktop widths and in
 * each theme the page supports. The sibling of `visual-regression.mjs`, which pins ~13 effect
 * canaries on one fixture; this one photographs the shipped pages themselves, so a layout change
 * that no assertion names (a hero that shifted, a section that lost its background) shows up as a
 * picture instead of going unseen.
 *
 * Deliberately advisory, for the same reason `visual-regression.mjs` is (see its header): it stays
 * outside `npm run ci` until its false-positive rate across real runs is known, and promoting it is
 * a decision for whoever watches that rate. It is a separate script rather than more canaries in
 * that one because the shape differs — about 99 full-page captures against 13 element captures,
 * its own tolerance (a whole page has far more soft edges and text anti-aliasing than a canary
 * box), and its own false-positive rate to be measured.
 *
 * Three modes:
 *   `node scripts/visual-regression-pages.mjs --update`        — (re)write `test/browser/baselines/pages/*.png`.
 *   `node scripts/visual-regression-pages.mjs`                 — compare fresh captures against them and write
 *                                                                 `.artifacts/visual-pages-report.html`.
 *                                                                 Non-zero exit on any capture over tolerance.
 *   `node scripts/visual-regression-pages.mjs --capture-only`  — write the fresh captures to
 *                                                                 `.artifacts/visual-pages/` and compare nothing
 *                                                                 (what CI does: baselines are gitignored, local).
 * `--only <text>` narrows any mode to pages whose file name contains it.
 *
 * A capture is taken the way the page tier takes every measurement: the page is opened over a
 * throwaway static server with off-origin requests stubbed, walked top to bottom so every
 * scroll-triggered effect has fired, returned to the top, and every animation is finished (or, for
 * an infinite one, paused at its first frame) before the shot. Baselines only mean anything on the
 * machine that wrote them: font rasterisation differs between operating systems.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { loadChromium, startStaticServer } from './browser-harness.mjs'
import { compareToBaseline, writeReport } from './visual-compare.mjs'
import { VIEWPORTS, freezeForScreenshot, listDemoPages, openDemoPage, scrollToY, walkPage } from '../test/browser/lib/demo-pages.mjs'

const UPDATE = process.argv.includes('--update')
const CAPTURE_ONLY = process.argv.includes('--capture-only')
const onlyIndex = process.argv.indexOf('--only')
const ONLY = onlyIndex === -1 ? '' : (process.argv[onlyIndex + 1] ?? '')

const BASELINE_DIR = fileURLToPath(new URL('../test/browser/baselines/pages', import.meta.url))
const ARTIFACT_DIR = fileURLToPath(new URL('../.artifacts', import.meta.url))
const CAPTURE_DIR = `${ARTIFACT_DIR}/visual-pages`

/**
 * Per-pixel colour tolerance for `pixelmatch` and the differing-pixel budget as a fraction of the
 * image. The budget is tighter than the canaries' 2%: a page is mostly flat colour and text, so a
 * 1% change is already thousands of pixels of real layout movement.
 */
const PIXEL_THRESHOLD = 0.12
const MAX_DIFF_FRACTION = 0.01

/** A fixed wall-clock start, so a page that renders the date renders the same one every run. */
const FIXED_EPOCH = new Date('2026-01-15T12:00:00Z')

/**
 * Chromium refuses a single capture past roughly 16k pixels tall, and `scroll.html` alone is over
 * 32k. Taller pages are photographed as one viewport-tall tile per scroll step instead.
 */
const MAX_FULL_PAGE_HEIGHT = 15000

/**
 * Pages that need more than the defaults, each with the reason. `mask` is a selector painted over
 * before the diff; `maxFraction` replaces the default budget.
 */
const PAGE_OVERRIDES = {
  'shaders-audio.html': {
    mask: 'canvas',
    reason: 'WebGL canvases are rasterised by the GPU/driver (SwiftShader headless), so their pixels are not a function of the page and differ run to run',
  },
}

/** `<page without .html>-<viewport>-<theme>`, plus a tile suffix for tall pages. */
function captureId({ file, viewportName, theme }, tile) {
  const tileSuffix = tile === undefined ? '' : `-t${String(tile).padStart(2, '0')}`
  return `${file.replace('.html', '')}-${viewportName}-${theme}${tileSuffix}`
}

/** One viewport-tall shot per scroll step, for a page too tall for a single capture. */
async function captureTiles(page, job, options, { height, viewportHeight }) {
  const tiles = []
  for (let tile = 0, y = 0; y < height; tile += 1, y += viewportHeight) {
    await scrollToY(page, y)
    tiles.push({ id: captureId(job, tile), png: await page.screenshot(options) })
  }
  return tiles
}

/**
 * Photograph one page in one viewport and theme.
 *
 * @param job - `{ file, viewportName, contextOptions, theme }`.
 * @returns `{ id, png }[]` — one entry, or one per tile for a page taller than `MAX_FULL_PAGE_HEIGHT`.
 */
async function capturePage(browser, origin, job) {
  const { file, contextOptions, theme } = job
  const { context, page } = await openDemoPage(browser, origin, file, contextOptions, {
    theme,
    beforeGoto: (p) => p.clock.install({ time: FIXED_EPOCH }),
  })
  try {
    await walkPage(page)
    await scrollToY(page, 0)
    await freezeForScreenshot(page)

    const override = PAGE_OVERRIDES[file]
    const mask = override?.mask ? [page.locator(override.mask)] : []
    const options = { animations: 'disabled', caret: 'hide', mask }
    const size = await page.evaluate(() => ({
      height: document.documentElement.scrollHeight,
      viewportHeight: window.innerHeight,
    }))
    if (size.height <= MAX_FULL_PAGE_HEIGHT) {
      return [{ id: captureId(job), png: await page.screenshot({ ...options, fullPage: true }) }]
    }
    return await captureTiles(page, job, options, size)
  } finally {
    await context.close()
  }
}

/** Apply the run mode to one capture; returns the report row, or `null` for `--capture-only`. */
function handleShot({ id, png }) {
  const target = `${BASELINE_DIR}/${id}.png`
  if (CAPTURE_ONLY) {
    writeFileSync(`${CAPTURE_DIR}/${id}.png`, png)
    console.log(`CAPTURED  ${id}`)
    return null
  }
  if (UPDATE) {
    writeFileSync(target, png)
    console.log(`WROTE  ${id} -> ${target}`)
    return { label: id, status: 'updated' }
  }
  return compareToBaseline({ logLabel: id, label: id }, png, target, { threshold: PIXEL_THRESHOLD, maxFraction: MAX_DIFF_FRACTION })
}

/** Every viewport and theme of one demo page, in order; returns the report rows. */
async function capturePageJobs(browser, origin, { file, themes }) {
  const rows = []
  for (const [viewportName, contextOptions] of Object.entries(VIEWPORTS)) {
    for (const theme of themes) {
      const shots = await capturePage(browser, origin, { file, viewportName, contextOptions, theme })
      rows.push(...shots.map(handleShot).filter(Boolean))
    }
  }
  return rows
}

/** Launch the browser and photograph every selected page; returns the report rows. */
async function captureAll(pages) {
  const { origin, close } = await startStaticServer()
  const chromium = await loadChromium()
  const browser = await chromium.launch({ headless: true })
  const rows = []
  try {
    for (const page of pages) rows.push(...(await capturePageJobs(browser, origin, page)))
  } finally {
    await browser.close()
    await close()
  }
  return rows
}

function reportComparison(rows) {
  const failed = rows.filter((r) => r.status !== 'pass')
  writeReport(rows, `${ARTIFACT_DIR}/visual-pages-report.html`, 'visual-regression pages diff report')
  console.log(`\n${rows.length - failed.length}/${rows.length} page captures within tolerance`)
  console.log(`Diff report: ${ARTIFACT_DIR}/visual-pages-report.html`)
  if (failed.length > 0) process.exit(1)
}

async function run() {
  mkdirSync(ARTIFACT_DIR, { recursive: true })
  if (UPDATE) mkdirSync(BASELINE_DIR, { recursive: true })
  if (CAPTURE_ONLY) mkdirSync(CAPTURE_DIR, { recursive: true })

  const pages = listDemoPages().filter((page) => page.file.includes(ONLY))
  if (pages.length === 0) throw new Error(`no demo page matches --only "${ONLY}"`)
  const rows = await captureAll(pages)

  if (CAPTURE_ONLY) console.log(`\nCaptures written to ${CAPTURE_DIR}`)
  else if (UPDATE) console.log(`\n${rows.length} baseline(s) written to ${BASELINE_DIR}`)
  else reportComparison(rows)
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
