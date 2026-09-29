/**
 * Pixel-comparison and report plumbing shared by the two advisory visual scripts:
 * `visual-regression.mjs` (the effect canaries) and `visual-regression-pages.mjs` (whole demo
 * pages). Key-generic on purpose — a "row" is just `{ label, status, ... }`, so neither script's
 * notion of what it captures (a canary and a theme, a page and a viewport) leaks in here, and the
 * two cannot drift apart on how a comparison is decided or how the review artifact is drawn.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { PNG } from 'pngjs'
import pixelmatch from 'pixelmatch'

export function readPng(buffer) {
  return PNG.sync.read(buffer)
}

/**
 * Compare one freshly captured image against its baseline on disk.
 *
 * The three ways a comparison can end — no baseline yet, the image changed size, or a real pixel
 * diff — are each their own row `status`, because collapsing them into one "fail" loses the only
 * thing that tells you whether to regenerate, look at the layout, or look at the render. A size
 * change short-circuits rather than diffing: `pixelmatch` requires equal dimensions, and an image
 * that changed size has already told you what you needed to know.
 *
 * @param names.logLabel - What the console line calls this row.
 * @param names.label - What the report heading calls it.
 * @param png - The fresh capture, PNG bytes.
 * @param target - Baseline file path.
 * @param options.threshold - Per-pixel colour tolerance for `pixelmatch` (0-1, higher = more forgiving).
 * @param options.maxFraction - Differing-pixel budget as a fraction of the image.
 * @returns The row to record for the summary and the report.
 * @complexity O(w * h) time and space in image pixels.
 * @overallScore 100
 */
export function compareToBaseline({ logLabel, label }, png, target, { threshold, maxFraction }) {
  if (!existsSync(target)) {
    console.log(`FAIL   ${logLabel} — no baseline; run with --update first`)
    return { label, status: 'missing-baseline' }
  }

  const baseline = readPng(readFileSync(target))
  const current = readPng(png)
  if (baseline.width !== current.width || baseline.height !== current.height) {
    console.log(
      `FAIL   ${logLabel} — size changed: ${baseline.width}x${baseline.height} -> ${current.width}x${current.height}`,
    )
    return { label, status: 'size-mismatch', baseline, current }
  }

  const diff = new PNG({ width: baseline.width, height: baseline.height })
  const diffPixels = pixelmatch(baseline.data, current.data, diff.data, baseline.width, baseline.height, { threshold })
  const totalPixels = baseline.width * baseline.height
  const fraction = diffPixels / totalPixels
  const pass = fraction <= maxFraction
  console.log(
    `${pass ? 'PASS' : 'FAIL'}   ${logLabel} — ${diffPixels}/${totalPixels} px differ (${(fraction * 100).toFixed(2)}%, budget ${(maxFraction * 100).toFixed(0)}%)`,
  )
  return { label, status: pass ? 'pass' : 'fail', diffPixels, totalPixels, fraction, baseline, current, diff }
}

/**
 * A three-panel (baseline | current | diff) static HTML report — the actual review artifact, not
 * the raw PNGs.
 *
 * @param rows - Rows from `compareToBaseline` (or `{ label, status: 'updated' }`).
 * @param outFile - Where to write the HTML.
 * @param title - Page title and heading.
 */
export function writeReport(rows, outFile, title) {
  const toDataUri = (png) => `data:image/png;base64,${PNG.sync.write(png).toString('base64')}`
  const sections = rows
    .map((r) => {
      const label = r.label
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

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
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
<h1>${title} — ${new Date().toISOString()}</h1>
${sections}
</body></html>`
  mkdirSync(dirname(outFile), { recursive: true })
  writeFileSync(outFile, html)
}
