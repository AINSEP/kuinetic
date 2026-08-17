/**
 * Smoke-test the published package shape.
 *
 * `package.json`'s `main`/`module`/`types`/`unpkg`/`jsdelivr`/`exports` fields are promises about
 * what `dist/` contains and what `npm publish` ships. Nothing before this script ever checked
 * those promises against reality — a path could be renamed in one and not the other, or `files`
 * could drift out of sync with `exports`, and the break would only surface for a consumer who
 * just installed the package. This checks, in order: every promised path exists after a build,
 * every promised path is actually inside the tarball `npm publish` would produce, and every ESM
 * and IIFE entry point actually evaluates.
 *
 * Not part of `vitest run`, for the same reason `verify:standalone` isn't: it exercises built
 * artifacts (`dist/`) and the `npm pack` CLI, not source. Run it after a build — wire it behind
 * `build:dist` the way `verify:standalone` is, so a stale `dist/` from an earlier run can't hide
 * a regression:
 *
 *   "verify:pack": "npm run build:dist && node scripts/verify-pack.mjs"
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { JSDOM } from 'jsdom'

const root = fileURLToPath(new URL('..', import.meta.url))
const pkg = JSON.parse(readFileSync(`${root}package.json`, 'utf8'))

let failures = 0
function fail(message) {
  console.error(`verify:pack — FAIL: ${message}`)
  failures++
}
function ok(message) {
  console.log(`verify:pack — OK: ${message}`)
}

// --- 1. collect every dist-relative path the package.json fields promise ------------------
// `exports` conditions nest ("./core": { types, default }), so this walks the whole tree rather
// than assuming a fixed shape — a future added condition (e.g. "require") is picked up for free.
function collectStrings(node, out) {
  if (typeof node === 'string') out.add(node)
  else if (node && typeof node === 'object') for (const value of Object.values(node)) collectStrings(value, out)
  return out
}

const promised = collectStrings(
  { main: pkg.main, module: pkg.module, types: pkg.types, unpkg: pkg.unpkg, jsdelivr: pkg.jsdelivr, exports: pkg.exports },
  new Set(),
)
// "./package.json" resolves to the manifest itself — nothing a build produces, and npm always
// includes it in the tarball regardless of `files`, so it would never be a meaningful check.
promised.delete('./package.json')

const normalize = (p) => p.replace(/^\.\//, '')
const promisedPaths = [...promised].map(normalize)

// --- 2. every promised artifact must exist on disk after the build ------------------------
for (const relPath of promisedPaths) {
  if (existsSync(`${root}${relPath}`)) ok(`${relPath} exists`)
  else fail(`${relPath} is referenced by package.json but was not produced by the build`)
}

// dist/kuinetic.all.js isn't in `exports` — it's the opt-in standalone bundle described in
// build-standalone.mjs, loaded by URL rather than imported — but .size-limit.json budgets it and
// verify:standalone depends on it existing, so a clean build silently failing to produce it is
// just as real a packaging regression as a missing exports target.
for (const entry of JSON.parse(readFileSync(`${root}.size-limit.json`, 'utf8'))) {
  if (existsSync(`${root}${entry.path}`)) ok(`${entry.path} exists (size-limit target)`)
  else fail(`${entry.path} is budgeted in .size-limit.json but was not produced by the build`)
}

// --- 3. what `npm pack` actually ships -----------------------------------------------------
// `--ignore-scripts` is deliberate: without it, `prepack` re-runs `build:dist`, and that script's
// own console.log lines (generate-preset-css.mjs, build-standalone.mjs) land on the same stdout
// as `npm pack --json`, corrupting the JSON below. The build already happened via the npm script
// chain that calls this file — re-running it here would just be redundant work with a parsing
// hazard attached.
let packed
try {
  const packJson = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    cwd: root,
    encoding: 'utf8',
  })
  packed = JSON.parse(packJson)
} catch (error) {
  fail(`npm pack --dry-run --json failed or returned unparseable output: ${error.message}`)
  packed = [{ files: [] }]
}
const packedPaths = new Set(packed[0].files.map((f) => f.path))

for (const relPath of promisedPaths) {
  if (packedPaths.has(relPath)) ok(`${relPath} is included in the npm tarball`)
  else fail(`${relPath} is in package.json but MISSING from "npm pack" — a fresh install would 404 on it`)
}

// The reverse direction: anything shipped that isn't package.json, an npm-always-included file
// (README/LICENSE/CHANGELOG), or under a declared `files` entry is a packaging leak — a stray
// build artifact or source file made public by accident. Not the failure mode the task called
// out, but it's the same "files" vs. "exports" drift and costs nothing extra to catch here.
const alwaysIncluded = /^(package\.json|(README|LICEN[SC]E|CHANGELOG|NOTICE)(\..*)?)$/i
for (const path of packedPaths) {
  const declared = pkg.files.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))
  if (!declared && !alwaysIncluded.test(path)) {
    fail(`npm pack included "${path}", which is outside the declared "files" field`)
  }
}

// --- 4. every ESM entry point actually imports and yields something usable ----------------
try {
  const [main, core, effects] = await Promise.all(
    ['dist/esm/index.mjs', 'dist/esm/core/index.mjs', 'dist/esm/effects/index.mjs'].map((p) =>
      import(pathToFileURL(`${root}${p}`).href),
    ),
  )

  if (typeof main.kuinetic !== 'function') fail('dist/esm/index.mjs does not export a `kuinetic` function')
  else {
    // Constructed, never `.start()`-ed: per src/index.ts's doc comment, importing and constructing
    // must have no side effects and must not touch `document` — this Node process has no DOM, so
    // the constructor throwing here would mean that promise is broken.
    const animator = main.kuinetic()
    if (typeof animator.start !== 'function') fail('kuinetic() did not return a usable Animator')
    else ok('dist/esm/index.mjs: kuinetic() constructs without touching the DOM')
  }

  if (typeof core.Registry !== 'function') fail('dist/esm/core/index.mjs does not export `Registry`')
  else ok('dist/esm/core/index.mjs exports Registry')

  if (typeof effects.createRegistry !== 'function') {
    fail('dist/esm/effects/index.mjs does not export `createRegistry`')
  } else {
    const names = effects.createRegistry().names()
    if (names.length < 100) fail(`the built registry only has ${names.length} effect names — catalog looks truncated`)
    else ok(`dist/esm/effects/index.mjs: registry resolves to ${names.length} effect names`)
  }
} catch (error) {
  fail(`an ESM entry point failed to import: ${error.stack ?? error}`)
}

// --- 5. the unpkg/jsdelivr IIFE actually evaluates in a real <script> tag -----------------
// A real script tag, not eval() — same reasoning as verify-standalone.mjs: esbuild's IIFE output
// starts with "use strict", and strict-mode indirect eval scopes top-level `var` to the eval call
// rather than the global object, so an eval-based check would pass or fail on a wiring detail no
// real browser (or CDN consumer using <script src>) ever hits.
try {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'dangerously' })
  const script = dom.window.document.createElement('script')
  script.textContent = readFileSync(`${root}dist/kuinetic.js`, 'utf8')
  dom.window.document.body.appendChild(script)
  if (typeof dom.window.kuinetic?.kuinetic !== 'function') {
    fail('dist/kuinetic.js (the unpkg/jsdelivr target) did not expose window.kuinetic.kuinetic')
  } else {
    ok('dist/kuinetic.js evaluates as a real <script> tag and exposes window.kuinetic.kuinetic')
  }
} catch (error) {
  fail(`dist/kuinetic.js threw when evaluated as a <script> tag: ${error.stack ?? error}`)
}

// --- 6. summary -----------------------------------------------------------------------------
if (failures > 0) {
  console.error(`\nverify:pack — ${failures} check(s) failed`)
  process.exit(1)
}
console.log('\nverify:pack — OK: package.json exports, npm pack contents, and entry points all agree')
