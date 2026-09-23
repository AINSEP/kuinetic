import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Locks in the decision from the mobile-perf pass: `demo/` (kuinetic.com, the production site)
 * ships a minified `kuinetic.js` with a linked source map, not the readable bundle. `dist/` (the
 * publishable package) keeps shipping both a readable and a `.min.js` variant.
 *
 * This does not import `package.json`'s `build` script or `scripts/build-tiers.mjs` and run them —
 * `build-tiers.mjs` is a script with build side effects (it shells out to esbuild and writes real
 * output files) at module-load time, not an importable pure module, and running it from a test
 * would rebuild real artifacts as a side effect of `vitest run`. Instead this reads both files'
 * source text and asserts on the exact substrings the build depends on, and separately exercises
 * the selection rule as a small pure re-implementation mirrored from `build-tiers.mjs`'s `emit()`
 * (see the comment there) — so a change to either file's decision has to edit this test on purpose.
 */

const root = dirname(dirname(fileURLToPath(import.meta.url)))

describe('package.json build script — demo/kuinetic.js is minified', () => {
  it('passes --minify and --sourcemap=linked to the demo/kuinetic.js esbuild step', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    const build: string = pkg.scripts.build
    // Split on ' && ' the way the script itself is composed, then isolate the one step that
    // writes demo/kuinetic.js — a global --minify check would also pass if some other step in the
    // chain carried it, which wouldn't prove anything about the file this plan cared about.
    const steps = build.split(' && ')
    const demoJsStep = steps.find((step) => step.includes('--outfile=demo/kuinetic.js'))
    expect(demoJsStep, 'no build step writes demo/kuinetic.js').toBeDefined()
    expect(demoJsStep).toContain('--minify')
    expect(demoJsStep).toContain('--sourcemap=linked')
  })
})

describe('scripts/build-tiers.mjs — demo emits the minified, non-.min bundle', () => {
  const source = readFileSync(join(root, 'scripts', 'build-tiers.mjs'), 'utf8')

  it('keeps the exact selection rule emit() depends on', () => {
    // A change here that keeps the tests below green but silently drops the `dir === 'demo'`
    // clause (e.g. reverting to the old "demo ships the readable one" rule) would still make demo
    // build a readable, untailed bundle without failing the behavioural check below in some
    // refactors — pinning the source substring closes that gap.
    expect(source).toContain("file.endsWith('.min.js') || dir === 'demo'")
    expect(source).toContain("if (file.endsWith('.min.js') && dir !== 'dist') return")
  })

  // Mirrors emit()'s two decisions for every (file, dir) combination build-tiers.mjs actually
  // drives: demo's tier outputs (`kuinetic.js`, `kuinetic.advanced.js`, and their `.min.js`
  // counterparts, even though the config never emits the latter for demo) and dist's.
  function isMinified(file: string, dir: string): boolean {
    return file.endsWith('.min.js') || dir === 'demo'
  }
  function isSkipped(file: string, dir: string): boolean {
    return file.endsWith('.min.js') && dir !== 'dist'
  }

  it.each([
    ['kuinetic.js', 'demo', { skipped: false, minified: true }],
    ['kuinetic.min.js', 'demo', { skipped: true, minified: true }],
    ['kuinetic.advanced.js', 'demo', { skipped: false, minified: true }],
    ['kuinetic.advanced.min.js', 'demo', { skipped: true, minified: true }],
    ['kuinetic.js', 'dist', { skipped: false, minified: false }],
    ['kuinetic.min.js', 'dist', { skipped: false, minified: true }],
    ['kuinetic.advanced.js', 'dist', { skipped: false, minified: false }],
    ['kuinetic.advanced.min.js', 'dist', { skipped: false, minified: true }],
  ])('%s in %s → skipped=%o minified=%o', (file, dir, expected) => {
    expect(isSkipped(file, dir)).toBe(expected.skipped)
    expect(isMinified(file, dir)).toBe(expected.minified)
  })

  it('never lets demo end up with a second, .min-suffixed file', () => {
    // The whole point of Option A (minify in place): no page's <script src> changes. If demo ever
    // emitted a .min.js file too, that guarantee would be broken.
    expect(isSkipped('kuinetic.min.js', 'demo')).toBe(true)
    expect(isSkipped('kuinetic.advanced.min.js', 'demo')).toBe(true)
  })
})
