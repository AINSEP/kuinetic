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
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const dir = process.argv[2] ?? 'dist'
const js = readFileSync(`${root}${dir}/kuinetic.js`, 'utf8')
const css = readFileSync(`${root}${dir}/kuinetic.css`, 'utf8')

const tail = `
;(function () {
  if (!document.getElementById('kuinetic-styles')) {
    var style = document.createElement('style')
    style.id = 'kuinetic-styles'
    style.textContent = ${JSON.stringify(css)}
    document.head.appendChild(style)
  }
})()
`

const outFile = `${root}${dir}/kuinetic.all.js`
writeFileSync(outFile, js + tail)
console.log(`wrote ${dir}/kuinetic.all.js (${js.length + tail.length} bytes)`)
