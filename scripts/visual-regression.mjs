/**
 * Tier 1 of the owner-approved visual-regression plan: pixel baselines for the six rendering
 * pathways `getComputedStyle` genuinely cannot verify — filters, gradients/background-position,
 * clip-path, blend modes, backdrop-filter, and SVG stroke. `filter: blur(4px)` as a *string* proves
 * nothing about whether the compositor actually painted a blurred result; only a pixel can.
 *
 * Deliberately advisory (`npm run test:visual`), **not** part of `npm run ci`: every screenshot
 * here is one frame of a real animation, frozen by pausing/seeking a `getAnimations()` timeline —
 * which is the same freezing trick `effect-sweep.test.mjs`/`three-d-depth.test.mjs` use for their
 * assertions, not a new one invented for this file. It stays outside `ci` until its false-positive
 * rate across real runs is known; promoting it is a decision for whoever is watching that rate, not
 * something this script should decide for itself by wiring in silently.
 *
 * Scope is deliberately smaller than "every effect in the catalog": ~13 canaries across the four
 * pathways with real presence in the library (filter, background/gradient, clip-path, SVG stroke),
 * plus the one preset the library has for blend modes. `backdrop-filter` has zero presets anywhere
 * in the effect catalog — nothing exists to canary, so nothing is here for it; that is a fact about
 * the library today, not an oversight in this file. See the `CANARIES` list below for the full,
 * named accounting of what is and is not covered, and why — the same discipline
 * `effect-sweep.test.mjs`'s `UNSAMPLEABLE` map uses, so a canary set does not quietly shrink into
 * "we cover rendering" when it covers a handful of pathways.
 *
 * Two modes:
 *   `node scripts/visual-regression.mjs --update`  — (re)write `test/browser/baselines/*.png`.
 *   `node scripts/visual-regression.mjs`           — compare a fresh capture against those
 *                                                     baselines with `pixelmatch`, tolerance-based
 *                                                     (not byte-equality — anti-aliasing jitters
 *                                                     even between two runs on the same machine),
 *                                                     and write `.artifacts/visual-diff-report.html`
 *                                                     as the human review artifact. Non-zero exit
 *                                                     on any canary over tolerance.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { loadChromium } from './browser-harness.mjs'
import { compareToBaseline, writeReport } from './visual-compare.mjs'

const UPDATE = process.argv.includes('--update')
const FIXTURE_URL = `file://${fileURLToPath(new URL('../test/browser/fixtures/visual-regression.html', import.meta.url))}`
const BASELINE_DIR = fileURLToPath(new URL('../test/browser/baselines', import.meta.url))
const ARTIFACT_DIR = fileURLToPath(new URL('../.artifacts', import.meta.url))
const THEMES = ['light', 'dark']

/**
 * The full, named accounting of what this tier covers. Every entry is one of the ~13 canaries
 * approved: 3 filter, 3 background/gradient, 4 clip-path (two of which — `redaction-reveal`,
 * `gradient-stroke` — `effect-sweep.test.mjs` already documents as `UNSAMPLEABLE` by computed
 * style, which is exactly the justification for a pixel check existing at all), 3 SVG stroke, and
 * 1 blend-mode. `trigger` is `'enter'` (nothing extra needed, the fixture's on-load compile already
 * ran it), `'hover'` (real `page.hover()` before sampling), or `'pointer'` (cursor-invert's spring,
 * not a WAAPI timeline at all — dispatched and settled, not paused/seeked).
 */
const CANARIES = [
  { id: 'blur-in', pathway: 'filter', trigger: 'enter' },
  { id: 'duotone-hover', pathway: 'filter', trigger: 'hover' },
  { id: 'fade-blur-up', pathway: 'filter', trigger: 'enter' },
  { id: 'gradient-shimmer', pathway: 'background/gradient', trigger: 'enter' },
  { id: 'underline-draw', pathway: 'background/gradient', trigger: 'hover' },
  { id: 'shine-sweep', pathway: 'background/gradient', trigger: 'hover' },
  { id: 'curtain-wipe', pathway: 'clip-path', trigger: 'enter' },
  { id: 'redaction-reveal', pathway: 'clip-path', trigger: 'enter' },
  { id: 'mask-reveal', pathway: 'clip-path', trigger: 'enter' },
  { id: 'draw-stroke', pathway: 'svg-stroke', trigger: 'enter' },
  { id: 'gradient-stroke', pathway: 'svg-stroke', trigger: 'enter' },
  { id: 'progress-ring', pathway: 'svg-stroke', trigger: 'enter' },
  { id: 'cursor-invert', pathway: 'blend-mode', trigger: 'pointer' },
]

/**
 * Per-pixel colour tolerance for `pixelmatch` (0-1, higher = more forgiving) and the overall
 * differing-pixel budget as a fraction of the image (higher = more forgiving of anti-aliasing
 * jitter along soft edges — gradients and blurred edges are exactly where a same-machine,
 * back-to-back capture still differs by a few pixels of sub-pixel rounding).
 */
const PIXEL_THRESHOLD = 0.12
const MAX_DIFF_FRACTION = 0.02

async function loadThemedPage(browser, theme) {
  const context = await browser.newContext({ viewport: { width: 760, height: 620 } })
  await context.addInitScript((t) => {
    document.documentElement.dataset.theme = t
  }, theme)
  const page = await context.newPage()
  await page.goto(FIXTURE_URL)
  await page.waitForFunction(() => window.__kui !== undefined)
  return { context, page }
}

/** Pause every animation the element (or its subtree/pseudo-elements) is running, at `fraction` of the longest one. */
async function freezeAt(page, id, fraction) {
  return page.evaluate(
    ([elementId, sampleFraction]) => {
      const el = document.getElementById(elementId)
      const animations = el.getAnimations({ subtree: true })
      if (animations.length === 0) return { paused: false }
      const duration = Math.max(...animations.map((a) => a.effect.getComputedTiming().duration || 0)) || 500
      for (const animation of animations) {
        animation.pause()
        animation.currentTime = duration * sampleFraction
      }
      return { paused: true }
    },
    [id, fraction],
  )
}

/** One canary, one theme: trigger it, freeze it mid-motion (or settle it, for the pointer-driven one), screenshot its element. */
async function captureCanary(page, canary) {
  if (canary.trigger === 'hover') await page.hover(`#${canary.id}`)

  if (canary.trigger === 'pointer') {
    // cursor-invert: a real spring (src/core/spring.ts), never a WAAPI Animation — nothing to
    // pause/seek. Dispatch the move, wait for the spring to settle near the pointer, then shoot.
    const box = await page.locator(`#${canary.id}`).boundingBox()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 6 })
    await page.waitForTimeout(400)
    return page.locator(`#${canary.id}`).screenshot()
  }

  const deadline = 500
  let frozen = { paused: false }
  for (let waited = 0; waited <= deadline; waited += 40) {
    frozen = await freezeAt(page, canary.id, 0.5)
    if (frozen.paused) break
    await page.waitForTimeout(40)
  }
  if (!frozen.paused) {
    // Fallback path, and deliberately visible rather than silently identical: a couple of these
    // (shine-sweep in particular) may be a CSS `:hover` transition this Chromium build does not
    // surface through `getAnimations()`. Settle on a fixed real-time wait instead of a seek.
    console.log(`  (no getAnimations() result for #${canary.id} — falling back to a timed wait)`)
    await page.waitForTimeout(300)
  }
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
  return page.locator(`#${canary.id}`).screenshot()
}

function baselinePath(canary, theme) {
  return `${BASELINE_DIR}/${canary.id}-${theme}.png`
}

/**
 * Write a fresh baseline for one canary and report it.
 *
 * @returns The row to record for the summary and the diff report.
 */
function writeBaseline(canary, theme, png, target) {
  writeFileSync(target, png)
  console.log(`WROTE  ${canary.id} (${theme}) -> ${target}`)
  return { label: rowLabel(canary, theme), status: 'updated' }
}

/** The report heading for one canary in one theme. */
function rowLabel(canary, theme) {
  return `${canary.id} — ${theme} (${canary.pathway})`
}

async function run() {
  if (UPDATE) mkdirSync(BASELINE_DIR, { recursive: true })
  mkdirSync(ARTIFACT_DIR, { recursive: true })

  const chromium = await loadChromium()
  const browser = await chromium.launch({ headless: true })

  const rows = []
  for (const theme of THEMES) {
    const { context, page } = await loadThemedPage(browser, theme)
    for (const canary of CANARIES) {
      const png = await captureCanary(page, canary)
      const target = baselinePath(canary, theme)
      rows.push(
        UPDATE
          ? writeBaseline(canary, theme, png, target)
          : compareToBaseline(
              { logLabel: `${canary.id} (${theme})`, label: rowLabel(canary, theme) },
              png,
              target,
              { threshold: PIXEL_THRESHOLD, maxFraction: MAX_DIFF_FRACTION },
            ),
      )
    }
    await context.close()
  }

  await browser.close()

  if (UPDATE) {
    console.log(`\n${rows.length} baseline(s) written to ${BASELINE_DIR}`)
    return
  }

  const failed = rows.filter((r) => r.status !== 'pass')
  writeReport(rows, `${ARTIFACT_DIR}/visual-diff-report.html`, 'visual-regression diff report')
  console.log(`\n${rows.length - failed.length}/${rows.length} visual checks within tolerance`)
  console.log(`Diff report: ${ARTIFACT_DIR}/visual-diff-report.html`)
  if (failed.length > 0) process.exit(1)
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
