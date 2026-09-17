/**
 * Build the modular tier bundles, and give every distributed browser bundle its self-start.
 *
 * The shape this produces is a script-tag user composing tiers, writing no JavaScript at all:
 *
 *   <script src=".../kuinetic.min.js"></script>
 *   <script src=".../kuinetic.advanced.min.js"></script>
 *
 * in either order, with no inline script, one animator, and no core shipped twice. A fourth tier is
 * a fourth file and one more line in `TIERS` below — never a combined bundle, and never a 2^n
 * matrix of pre-composed pairs, because the tiers compose at runtime (see `src/browser/boot.ts`).
 *
 * ## How the self-start reaches the IIFE but not the ESM output
 *
 * `src/browser/boot.ts` imports nothing and no ESM entry point references it, so it is unreachable
 * from `dist/esm/*`. This script bundles it on its own and *appends* it, plus one call line naming
 * the tier, to bundles esbuild has already produced from the unchanged library entries. The
 * appended block is wrapped in its own function scope, so the boot's `__kuineticBoot` binding never
 * becomes a global — the only globals a bundle adds are the one it was built under and, at runtime,
 * `__kuineticRuntime`/`__kuinetic`. `scripts/verify-tiers.mjs` checks all of that after the fact.
 *
 * This is the same technique `scripts/build-standalone.mjs` has always used for `kuinetic.all.js`:
 * a tail appended to a built artifact, not a modified entry point.
 *
 * ## Running it
 *
 *   node scripts/build-tiers.mjs [dir]
 *
 * `<dir>` defaults to `dist` (the publishable package output) and is also run against `demo` (the
 * local showcase and CDN deploy target), exactly as `build-standalone.mjs` is, so the two stay in
 * sync without a manual copy step. The core bundles it appends to must already exist — run it after
 * the esbuild steps in `package.json`'s `build`/`build:dist`, not standalone.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const dir = process.argv[2] ?? 'dist'
// The same scratch directory `generate-preset-css.mjs` uses, created and removed the same way — it
// is untracked because it never outlives the script that made it.
const tmpDir = `${root}.generated-tmp`
mkdirSync(tmpDir, { recursive: true })

/**
 * Every tier this library ships, plus core itself, which is a participant rather than a special
 * case: it is simply the one that creates the animator.
 *
 * `global` is the `--global-name` the bundle is built under, and doubles as the binding the
 * appended call line reads — it is guaranteed in scope there, because the call sits in the same
 * file, after the `var` esbuild emits.
 */
const TIERS = [
  {
    name: 'core',
    entry: 'src/index.ts',
    global: 'kuinetic',
    // Built by package.json's own esbuild steps, under the name it has always had. This script only
    // appends to it: `kuinetic.js` / `kuinetic.min.js` keep their filenames and their CDN URLs.
    prebuilt: true,
    outputs: ['kuinetic.js', 'kuinetic.min.js'],
    call: (g) => `__kuineticBoot.boot({ tier: 'core', core: ${g}, globalName: '${g}' })`,
  },
  {
    name: 'advanced',
    entry: 'src/advanced/index.ts',
    global: 'kuineticAdvanced',
    prebuilt: false,
    outputs: ['kuinetic.advanced.js', 'kuinetic.advanced.min.js'],
    call: (g) => `__kuineticBoot.boot({ tier: 'advanced', register: ${g}.registerAdvanced })`,
  },
]

const esbuild = (args) =>
  execFileSync('npx', ['esbuild', ...args], { stdio: 'pipe', cwd: root }).toString()

/**
 * The boot, bundled to a self-contained IIFE. Built twice so a minified tier gets a minified tail
 * and a readable one gets a readable tail — a `kuinetic.js` whose last 200 lines are minified would
 * be a poor thing to hand someone debugging in a browser.
 */
function bootSnippet(minify) {
  const out = `${tmpDir}/boot${minify ? '.min' : ''}.js`
  esbuild([
    `${root}src/browser/boot.ts`,
    '--bundle',
    '--format=iife',
    '--global-name=__kuineticBoot',
    ...(minify ? ['--minify'] : []),
    `--outfile=${out}`,
  ])
  return readFileSync(out, 'utf8')
}

const MARKER = '__kuineticRuntime'

/**
 * Wrapped in a function scope so `var __kuineticBoot` stays local. The call line is generated rather
 * than written into `boot.ts` because it is the only part that differs per tier, and because the
 * tier's own global has to be named by a binding that exists in the finished file.
 */
function appendBoot(file, snippet, call) {
  const path = `${root}${dir}/${file}`
  const existing = readFileSync(path, 'utf8')
  if (existing.includes(MARKER)) {
    throw new Error(
      `${dir}/${file} already carries the boot — rebuild the bundle before appending again ` +
        `(this script is not idempotent on its own output, by design: appending twice would ` +
        `install two boots).`,
    )
  }
  const tail = `\n;(function () {\n${snippet}\n${call};\n})();\n`
  writeFileSync(path, existing + tail)
  return existing.length + tail.length
}

const snippets = { plain: bootSnippet(false), min: bootSnippet(true) }

function emit(tier, file) {
  const minified = file.endsWith('.min.js')
  const path = `${root}${dir}/${file}`
  // Only `dist` carries minified output; `demo` is the local showcase and ships the readable one,
  // which is what `build` already does for core.
  if (minified && dir !== 'dist') return

  if (tier.prebuilt) {
    if (!existsSync(path)) return
  } else {
    esbuild([
      `${root}${tier.entry}`,
      '--bundle',
      '--format=iife',
      `--global-name=${tier.global}`,
      ...(minified ? ['--minify'] : []),
      `--outfile=${path}`,
    ])
  }

  const size = appendBoot(file, minified ? snippets.min : snippets.plain, tier.call(tier.global))
  console.log(`wrote ${dir}/${file} (${size} bytes, ${tier.name} tier)`)
}

for (const tier of TIERS) for (const file of tier.outputs) emit(tier, file)

rmSync(tmpDir, { recursive: true, force: true })
