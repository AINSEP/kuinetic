/**
 * Build the standalone drop-in bundle.
 *
 * `kuinetic.all.js` is the already-built browser IIFE plus its already-built CSS, self-injected
 * into a <style> tag, so integration is exactly one <script src="..."> tag and no <link>.
 *
 * **What this file used to do and no longer does:** it also appended a self-start
 * (`kuinetic.kuinetic({ observe: true }).start()`). That is now `src/browser/boot.ts`, appended by
 * `scripts/build-tiers.mjs` to *every* distributed browser bundle including `kuinetic.js` itself —
 * so a self-starting core is just core, and this file's remaining job is the one thing
 * `kuinetic.js` still does not do: carry its own stylesheet. It runs after `build-tiers.mjs`, and
 * the boot it inherits from `kuinetic.js` therefore sits above the <style> injection in the
 * finished file. Both halves run synchronously at parse time, well before the boot's own work at
 * DOMContentLoaded, so the stylesheet is always in the document before anything is scanned.
 *
 * This is NOT a replacement for the split `kuinetic.js` + `kuinetic.css` dist output — a
 * consumer who wants the CSS to keep working if this script is slow, blocked, or fails to load
 * (the guarantee `docs/design.md` §1a makes for the library generally) should use the split
 * files. This one trades that guarantee for one-tag convenience, on purpose.
 *
 * Requires `<dir>/kuinetic.js` and `<dir>/kuinetic.css` to already exist — run after the esbuild
 * steps that produce them, not standalone. `<dir>` defaults to `dist` (the publishable package
 * output) and also runs against `demo` (the local showcase / CDN deploy target) so both stay in
 * sync automatically instead of needing a manual copy step.
 *
 * It also writes `kuinetic.all.min.js`: the same file minified, JS and embedded CSS both. That is
 * the one the landing page and README hand to people, since the readable `kuinetic.all.js` is
 * roughly twice the transfer size for identical behaviour. It is derived from the finished bundle
 * above rather than built separately, so the two can never drift apart.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { transformSync } from 'esbuild'

const root = fileURLToPath(new URL('..', import.meta.url))
const dir = process.argv[2] ?? 'dist'
const js = readFileSync(`${root}${dir}/kuinetic.js`, 'utf8')
const css = readFileSync(`${root}${dir}/kuinetic.css`, 'utf8')

const styleInjector = (stylesheet) => `
;(function () {
  if (!document.getElementById('kuinetic-styles')) {
    var style = document.createElement('style')
    style.id = 'kuinetic-styles'
    style.textContent = ${JSON.stringify(stylesheet)}
    document.head.appendChild(style)
  }
})()
`

const bundle = js + styleInjector(css)
writeFileSync(`${root}${dir}/kuinetic.all.js`, bundle)
console.log(`wrote ${dir}/kuinetic.all.js (${bundle.length} bytes)`)

const minCss = transformSync(css, { loader: 'css', minify: true }).code
const minBundle = transformSync(js + styleInjector(minCss), { loader: 'js', minify: true }).code
writeFileSync(`${root}${dir}/kuinetic.all.min.js`, minBundle)
console.log(`wrote ${dir}/kuinetic.all.min.js (${minBundle.length} bytes)`)
