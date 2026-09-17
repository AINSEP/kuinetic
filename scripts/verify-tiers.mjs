/**
 * Prove the tier bundles compose, auto-start, and keep the ESM path pure.
 *
 * Not part of `vitest run`, for the same reason `verify:standalone` is not: it exercises *built
 * artifacts* rather than source. It loads the real `dist/kuinetic.js` and `dist/kuinetic.advanced.js`
 * into jsdom as real `<script src>` tags in a real HTML file, so tag order, `DOMContentLoaded`
 * timing and `document.currentScript` all behave the way they do in a browser — none of which
 * survives being `eval`'d or imported.
 *
 * jsdom rather than Chromium is the right tool here specifically because the bug this whole scheme
 * routes around is a pure JavaScript-identity bug: two independently-bundled copies of one class,
 * and an `instanceof` that compares them. Nothing about it needs a compositor, and the existing
 * real-browser suite in `test/browser/` covers what the advanced modules then go on to *draw*.
 *
 * Run after the esbuild steps and `scripts/build-tiers.mjs`, against `dist`.
 */
import { mkdtempSync, copyFileSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { JSDOM, VirtualConsole } from 'jsdom'

const root = fileURLToPath(new URL('..', import.meta.url))
const dist = `${root}dist`
const RUNTIME_MARKER = '__kuineticRuntime'

let failures = 0
function check(passed, label, detail = '') {
  if (passed) {
    console.log(`  ok   ${label}`)
    return
  }
  failures += 1
  const because = detail ? ` — ${detail}` : ''
  console.log(`  FAIL ${label}${because}`)
}

// ---------------------------------------------------------------------------------------------
// 1. The ESM output must not have learned to start itself.
//
// `src/browser/boot.ts` imports nothing and nothing under `src/` imports it, so the side effect is
// unreachable from the module graph rather than merely tree-shaken out of it. This check is what
// turns that from a thing we were careful about into a thing that fails the build.
// ---------------------------------------------------------------------------------------------
console.log('\nESM purity')
function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    return statSync(path).isDirectory() ? walk(path) : [path]
  })
}
const esmFiles = walk(`${dist}/esm`).filter((path) => path.endsWith('.mjs'))
check(esmFiles.length > 0, 'dist/esm has modules to check')
const contaminated = esmFiles.filter((path) => readFileSync(path, 'utf8').includes(RUNTIME_MARKER))
check(
  contaminated.length === 0,
  'no ESM output carries the browser boot',
  contaminated.map((path) => path.replace(root, '')).join(', '),
)

// ---------------------------------------------------------------------------------------------
// 2. The IIFE global must expose exactly what the ESM entry exports.
//
// Core's boot replaces the global with a flat copy of esbuild's namespace object, because that
// object's properties are getter-only and non-configurable and so cannot be wrapped in place. A
// flat copy is only safe while it stays complete, and "we copied every own property name" is the
// kind of claim that quietly stops being true.
// ---------------------------------------------------------------------------------------------
console.log('\nIIFE global parity')
const esmExports = Object.keys(await import(`${dist}/esm/index.mjs`)).sort()

async function loadPage(html, { name }) {
  const file = join(stage, `${name}.html`)
  writeFileSync(file, html)
  const warnings = []
  const virtualConsole = new VirtualConsole()
  virtualConsole.on('warn', (message) => warnings.push(String(message)))
  // jsdom's CSS engine cannot parse `@layer`/`color-mix()`/`linear()` easing and raises a jsdomError
  // for the stylesheet. Real browsers parse it, and `verify:browser` covers it there. Swallowed so
  // it does not bury the pass/fail lines — exactly the filter `verify-standalone.mjs` applies.
  virtualConsole.on('jsdomError', () => {})
  const dom = await JSDOM.fromFile(file, {
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    virtualConsole,
  })
  const { window } = dom
  if (window.document.readyState !== 'complete') {
    await new Promise((resolve) => window.addEventListener('load', resolve, { once: true }))
  }
  return { window, warnings, dom }
}

const stage = mkdtempSync(join(tmpdir(), 'kuinetic-tiers-'))
for (const file of ['kuinetic.js', 'kuinetic.advanced.js']) {
  copyFileSync(`${dist}/${file}`, join(stage, file))
}

const page = (tags, body = '') =>
  `<!doctype html><html><head>${tags}</head><body>${body}</body></html>`

const SUBJECT = '<div id="core-fx" data-kui="fade-up"></div><div id="tier-fx" data-kui="particle-dissolve"></div>'
const CORE_TAG = '<script src="./kuinetic.js"></script>'
const TIER_TAG = '<script src="./kuinetic.advanced.js"></script>'

{
  const { window } = await loadPage(page(CORE_TAG), { name: 'parity' })
  const globalKeys = Object.keys(window.kuinetic).sort()
  const missing = esmExports.filter((key) => !globalKeys.includes(key))
  check(missing.length === 0, 'the global exposes every ESM export', missing.join(', '))
  check(typeof window.kuinetic.default === 'function', '`default` survives the guard')
  check(window.kuinetic.default === window.kuinetic.kuinetic, '`default` and `kuinetic` are the same guarded function')
}

// ---------------------------------------------------------------------------------------------
// 3. Composition, in both tag orders, with no author JavaScript anywhere on the page.
//
// This is the regression test for `asRegistry` in `src/advanced/base.ts`. Before that gate was
// duck-typed, `registerAdvanced` threw `requires a Registry or Animator instance` here — two
// bundles, two inlined copies of `Registry`, one `instanceof` comparing them.
// ---------------------------------------------------------------------------------------------
console.log('\nComposition (zero author JavaScript)')
for (const [label, tags] of [
  ['core tag first', CORE_TAG + TIER_TAG],
  ['tier tag first', TIER_TAG + CORE_TAG],
]) {
  const { window, warnings } = await loadPage(page(tags, SUBJECT), { name: `compose-${label.replace(/\W+/g, '-')}` })
  const animator = window.__kuinetic
  check(!!animator, `${label}: an animator exists`)
  const registry = animator?.registry
  check(!!registry?.resolve('fade-up'), `${label}: core's catalog is registered`)
  check(!!registry?.resolve('particle-dissolve'), `${label}: the advanced tier registered into it`)
  check(
    registry === window.__kuinetic?.registry,
    `${label}: both tiers registered into one animator`,
  )
  check(
    !!window.document.querySelector('#core-fx[data-kui-fx]'),
    `${label}: the document was scanned without a line of author JavaScript`,
  )
  check(warnings.length === 0, `${label}: nothing warned`, warnings.join(' | '))
}

// ---------------------------------------------------------------------------------------------
// 4. `window.__kuinetic` is readable by an inline script placed immediately after the tag.
//
// `kuinetic.all.js` used to create *and* start synchronously at parse time. Starting moved to
// DOMContentLoaded so a tier loading afterwards can still be folded into the same animator; the
// animator itself is still constructed synchronously, precisely so this keeps working. Constructing
// one touches nothing, which is what makes that safe.
// ---------------------------------------------------------------------------------------------
console.log('\nSynchronous readability')
{
  const probe = `<script>window.__probe = { present: !!window.__kuinetic, started: !!document.querySelector('[data-kui-fx]') }</script>`
  const { window } = await loadPage(page(CORE_TAG + probe, SUBJECT), { name: 'sync-read' })
  check(window.__probe?.present === true, 'window.__kuinetic is set synchronously after the tag')
  check(window.__probe?.started === false, 'but the document is not scanned until DOMContentLoaded')
  check(!!window.document.querySelector('[data-kui-fx]'), 'and it is scanned by the time the page loads')
}

// ---------------------------------------------------------------------------------------------
// 5. The double-animator guard.
// ---------------------------------------------------------------------------------------------
console.log('\nDouble-animator guard')
{
  // The exact line 19 demo pages and the pre-auto-start README both carry, custom reporter and all.
  // Nothing has been scanned yet when it runs, so the author's animator takes over wholesale —
  // their `reporter` is honoured, which returning a shared animator instead would have silently
  // thrown away.
  const legacy = `<script>window.__mine = kuinetic.kuinetic({ observe: true, reporter: kuinetic.consoleReporter() }).start()</script>`
  const { window, warnings } = await loadPage(page(CORE_TAG + legacy, SUBJECT), { name: 'guard-adopt' })
  check(window.__mine === window.__kuinetic, "an inline call before the boot becomes the page's animator")
  check(warnings.some((line) => line.includes('data-kui-manual')), 'and is told how to turn auto-start off', warnings.join(' | '))
  check(!!window.document.querySelector('[data-kui-fx]'), 'the page still animates')
  check(
    !!window.__kuinetic?.registry?.resolve('fade-up'),
    'and it is a complete animator, not a stub',
  )
}
{
  // Adoption has to survive a tier, too: the tier registers into whatever the runtime holds, so the
  // author's animator is the one that ends up carrying the advanced catalog.
  const legacy = `<script>window.__mine = kuinetic.kuinetic({ observe: true }).start()</script>`
  const { window } = await loadPage(page(CORE_TAG + legacy + TIER_TAG, SUBJECT), { name: 'guard-adopt-tier' })
  check(window.__mine === window.__kuinetic, 'the adopted animator is still the only one with a tier present')
  check(
    !!window.__mine?.registry?.resolve('particle-dissolve'),
    'and the tier registered into it',
  )
}
{
  // After the boot has scanned, a hand-built animator is a genuine second one. Deferred to
  // DOMContentLoaded so it lands on the far side of the boot.
  const late = `<script>window.addEventListener('DOMContentLoaded', function () { window.__bare = kuinetic.kuinetic(); window.__mine = kuinetic.kuinetic({ root: document.body }) })</script>`
  const { window, warnings } = await loadPage(page(CORE_TAG + late, SUBJECT), { name: 'guard-late' })
  check(window.__bare === window.__kuinetic, 'after the scan, an option-free call is handed the existing animator')
  check(window.__mine !== window.__kuinetic, 'but a call naming its own root gets its own')
  check(
    warnings.some((line) => line.includes('data-kui-manual')),
    'and is warned about it',
    warnings.join(' | '),
  )
}

// ---------------------------------------------------------------------------------------------
// 6. An author's own `.start()` between the two tags.
//
// The nastiest ordering: core creates the animator, the author starts it, and only *then* does the
// tier register. Everything using a tier effect was compiled against a registry that did not have
// it yet, and `Animator.process()` will not retry an element whose fingerprint has not changed —
// hence the `reset()`-then-`scan()` pass in the boot.
// ---------------------------------------------------------------------------------------------
console.log('\nRecompile after a late registration')
{
  const early = `<script>kuinetic.kuinetic({ observe: true }).start()</script>`
  const { window } = await loadPage(page(CORE_TAG + early + TIER_TAG, SUBJECT), { name: 'late-tier' })
  check(
    !!window.__kuinetic?.registry?.resolve('particle-dissolve'),
    'the late tier still registered',
  )
  check(
    !!window.document.querySelector('#tier-fx[data-kui-fx]'),
    'and the element that needed it was recompiled rather than left stale',
  )
}

// ---------------------------------------------------------------------------------------------
// 7. Opt-out.
// ---------------------------------------------------------------------------------------------
console.log('\nOpt-out')
{
  const tags = '<script src="./kuinetic.js" data-kui-manual></script><script src="./kuinetic.advanced.js" data-kui-manual></script>'
  const { window, warnings } = await loadPage(page(tags, SUBJECT), { name: 'manual' })
  check(!window.__kuinetic, 'no animator is created')
  check(!window.document.querySelector('[data-kui-fx]'), 'nothing is scanned')
  check(typeof window.kuinetic?.kuinetic === 'function', 'core is still there to be driven by hand')
  check(typeof window.kuineticAdvanced?.registerAdvanced === 'function', 'and so is the tier')
  check(warnings.length === 0, 'and it is silent about it', warnings.join(' | '))
}
{
  // Core manual, tier not. Core is the only thing that creates an animator, so the tier has nothing
  // to attach to — and should stay quiet rather than claim core is missing, because it is not.
  const tags = '<script src="./kuinetic.js" data-kui-manual></script>' + TIER_TAG
  const { window, warnings } = await loadPage(page(tags, SUBJECT), { name: 'manual-core-only' })
  check(!window.__kuinetic, 'marking core manual disables the whole chain')
  check(
    !warnings.some((line) => line.includes('core did not')),
    'and the tier does not wrongly report core missing',
    warnings.join(' | '),
  )
}
{
  const { warnings } = await loadPage(page(TIER_TAG, SUBJECT), { name: 'tier-alone' })
  check(
    warnings.some((line) => line.includes('core did not')),
    'a tier loaded with no core at all names the missing tag',
    warnings.join(' | '),
  )
}

if (failures === 0) {
  console.log('\nverify:tiers — OK')
} else {
  const plural = failures === 1 ? 'check' : 'checks'
  console.log(`\nverify:tiers — FAIL: ${failures} ${plural}`)
  process.exitCode = 1
}
