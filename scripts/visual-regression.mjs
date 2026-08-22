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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PNG } from 'pngjs'
import pixelmatch from 'pixelmatch'
import { loadChromium } from './browser-harness.mjs'

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

function readPng(buffer) {
  return PNG.sync.read(buffer)
}

function baselinePath(canary, theme) {
  return `${BASELINE_DIR}/${canary.id}-${theme}.png`
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

      if (UPDATE) {
        writeFileSync(target, png)
        rows.push({ canary, theme, status: 'updated' })
        console.log(`WROTE  ${canary.id} (${theme}) -> ${target}`)
        continue
      }

      if (!existsSync(target)) {
        rows.push({ canary, theme, status: 'missing-baseline' })
        console.log(`FAIL   ${canary.id} (${theme}) — no baseline; run with --update first`)
        continue
      }

      const baseline = readPng(readFileSync(target))
      const current = readPng(png)
      if (baseline.width !== current.width || baseline.height !== current.height) {
        rows.push({ canary, theme, status: 'size-mismatch', baseline, current })
        console.log(`FAIL   ${canary.id} (${theme}) — size changed: ${baseline.width}x${baseline.height} -> ${current.width}x${current.height}`)
        continue
      }

      const diff = new PNG({ width: baseline.width, height: baseline.height })
      const diffPixels = pixelmatch(baseline.data, current.data, diff.data, baseline.width, baseline.height, {
        threshold: PIXEL_THRESHOLD,
      })
      const totalPixels = baseline.width * baseline.height
      const fraction = diffPixels / totalPixels
      const pass = fraction <= MAX_DIFF_FRACTION
      rows.push({ canary, theme, status: pass ? 'pass' : 'fail', diffPixels, totalPixels, fraction, baseline, current, diff })
      console.log(
        `${pass ? 'PASS' : 'FAIL'}   ${canary.id} (${theme}) — ${diffPixels}/${totalPixels} px differ (${(fraction * 100).toFixed(2)}%, budget ${(MAX_DIFF_FRACTION * 100).toFixed(0)}%)`,
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
  writeReport(rows)
  console.log(`\n${rows.length - failed.length}/${rows.length} visual checks within tolerance`)
  console.log(`Diff report: ${ARTIFACT_DIR}/visual-diff-report.html`)
  if (failed.length > 0) process.exit(1)
}

/** A three-panel (baseline | current | diff) static HTML report — the actual review artifact, not the raw PNGs. */
function writeReport(rows) {
  const toDataUri = (png) => `data:image/png;base64,${PNG.sync.write(png).toString('base64')}`
  const sections = rows
    .map((r) => {
      const label = `${r.canary.id} — ${r.theme} (${r.canary.pathway})`
      if (r.status === 'updated') return `<section><h2>${label}</h2><p>baseline just written, nothing to compare</p></section>`
      if (r.status === 'missing-baseline') return `<section><h2>${label}</h2><p class="fail">no baseline on disk — run with --update</p></section>`
      if (r.status === 'size-mismatch') {
        return `<section><h2 class="fail">${label} — size mismatch</h2>
          <div class="row"><figure><figcaption>baseline (${r.baseline.width}x${r.baseline.height})</figcaption><img src="${toDataUri(r.baseline)}"></figure>
          <figure><figcaption>current (${r.current.width}x${r.current.height})</figcaption><img src="${toDataUri(r.current)}"></figure></div></section>`
      }
      const cls = r.status === 'pass' ? 'pass' : 'fail'
      return `<section><h2 class="${cls}">${label} — ${(r.fraction * 100).toFixed(2)}% differs</h2>
        <div class="row">
          <figure><figcaption>baseline</figcaption><img src="${toDataUri(r.baseline)}"></figure>
          <figure><figcaption>current</figcaption><img src="${toDataUri(r.current)}"></figure>
          <figure><figcaption>diff</figcaption><img src="${toDataUri(r.diff)}"></figure>
        </div></section>`
    })
    .join('\n')

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>visual-regression diff report</title>
<style>
body { font-family: system-ui, sans-serif; background: #14110f; color: #f5efe8; margin: 0; padding: 2rem; }
h1 { font-size: 1.1rem; }
section { margin-bottom: 2rem; padding-bottom: 1.5rem; border-bottom: 1px solid #333; }
h2 { font-size: 0.95rem; font-family: ui-monospace, monospace; }
h2.pass { color: #7ce07c; } h2.fail { color: #ff8a80; }
.row { display: flex; gap: 1rem; flex-wrap: wrap; }
figure { margin: 0; } figcaption { font-size: 0.75rem; color: #999; margin-bottom: 0.25rem; }
img { max-width: 220px; border: 1px solid #333; background: #222; }
</style></head><body>
<h1>Visual regression diff report — ${new Date().toISOString()}</h1>
${sections}
</body></html>`
  writeFileSync(`${ARTIFACT_DIR}/visual-diff-report.html`, html)
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
