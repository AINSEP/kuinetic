/**
 * Build the standalone drop-in bundle.
 *
 * Everything else this library ships is deliberately side-effect-free on import (see
 * `src/index.ts`'s doc comment) — a consumer links the CSS, imports `kuinetic`, and calls
 * `.start()` themselves. That's the right default for a library, but it is two extra steps for
 * "I just want this working on my own site." `kuinetic.all.js` is that opt-in convenience: the
 * already-built browser IIFE plus its already-built CSS, self-injected into a <style> tag and
 * self-started with `observe: true`, so integration is exactly one <script src="..."> tag.
 *
 * This is NOT a replacement for the split `kuinetic.js` + `kuinetic.css` dist output — a
 * consumer who wants the CSS to keep working if this script is slow, blocked, or fails to load
 * (the guarantee `docs/design.md` §1a makes for the library generally) should use the split
 * files. This one trades that guarantee for one-tag convenience, on purpose.
 *
 * Requires `dist/kuinetic.js` and `dist/kuinetic.css` to already exist — run after `build:dist`'s
 * own esbuild steps, not standalone.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const js = readFileSync(`${root}dist/kuinetic.js`, 'utf8')
const css = readFileSync(`${root}dist/kuinetic.css`, 'utf8')

const tail = `
;(function () {
  if (!document.getElementById('kuinetic-styles')) {
    var style = document.createElement('style')
    style.id = 'kuinetic-styles'
    style.textContent = ${JSON.stringify(css)}
    document.head.appendChild(style)
  }
  window.__kuinetic = kuinetic.kuinetic({ observe: true }).start()
})()
`

const outFile = `${root}dist/kuinetic.all.js`
writeFileSync(outFile, js + tail)
console.log(`wrote dist/kuinetic.all.js (${js.length + tail.length} bytes)`)
