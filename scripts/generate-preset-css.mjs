/**
 * Generate the preset-defaults stylesheet.
 *
 * A preset is a name plus different parameter defaults — `slide-up` is `fade-up` with a longer
 * distance. Those defaults were previously written to `element.style` at runtime, which meant an
 * inline custom property beat every consumer stylesheet: a site could not restyle `slide-up`
 * without `!important`, contradicting the library's central cascade promise.
 *
 * Emitting them as ordinary rules inside a cascade layer puts them back in the cascade, where a
 * consumer's own selector wins normally.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const tmpDir = `${root}.generated-tmp`
const bundle = `${tmpDir}/effects.mjs`
const outFile = `${root}src/css/presets.generated.css`

function build() {
  mkdirSync(tmpDir, { recursive: true })
  execFileSync(
    'npx',
    ['esbuild', `${root}src/effects/index.ts`, '--bundle', '--format=esm', `--outfile=${bundle}`],
    { stdio: 'pipe' },
  )
}

/**
 * The CSS timing functions a browser accepts verbatim. Everything else the library names —
 * `back-out`, `expo-out`, `spring` — is a kUInetic token defined in `base.css` as
 * `--kui-ease-<name>`, and has to be emitted as a `var()` reference.
 *
 * Writing the bare token instead produced `animation-timing-function: back-out`, which is not a
 * valid value, so the browser threw the declaration away and fell back to the initial `ease`.
 * Every "easing character" preset — `bounce-in`, `bounce-in-up`, `back-in-up`, `pop-in`,
 * `swing-in` — therefore animated on the default curve and none of them actually bounced. This
 * mirrors `easingValue()` in `src/core/compile.ts`, which already gets the inline
 * `ease:back-out` grammar right; only this generated stylesheet was missing the same step.
 */
const NATIVE_EASINGS = new Set([
  'linear',
  'ease',
  'ease-in',
  'ease-out',
  'ease-in-out',
  'step-start',
  'step-end',
])

function easingValue(value) {
  if (NATIVE_EASINGS.has(value)) return value
  if (value.includes('(')) return value
  return `var(--kui-ease-${value}, ease-out)`
}

/**
 * Timing parameters are namespaced per primitive at registration (`--kui-<primitive>-duration`
 * and friends, see `registry.ts`'s `namespaceTiming`), and `compile.ts` emits them as
 * `var(--kui-ambient-float-duration, 600ms)` — with a *hardcoded* fallback that knows nothing
 * about the primitive. So a primitive's own declared default only ever took effect if some
 * preset happened to restate it. It usually did not: `ambient-float` declares `4s`, no preset
 * restated it, no rule was generated, and `float` animated at the 600ms fallback instead — a
 * nearly 7x speed error that had been sitting in the shipped stylesheet. Same for every
 * `ease` default in the ambient and drift families, which all rendered `ease-out` while
 * declaring `ease-in-out`.
 *
 * Emitting the primitive's defaults here closes that gap in the one place that already exists
 * for "preset parameter defaults, as ordinary overridable rules".
 */
const TIMING_PARAMS = ['duration', 'delay', 'ease']

/** `--kui-distance: 100px;` lines for one resolved preset+primitive pair. */
function declarationsFor(resolved) {
  const { preset, primitive } = resolved
  const params = preset.params ?? {}

  const declaration = (name, value) => {
    const spec = primitive.parameters[name]
    // `text` parameters are JS-only and must never reach a stylesheet.
    if (!spec || spec.type === 'text') return []
    if (spec.type === 'easing') return [`  ${spec.cssProperty}: ${easingValue(value)};`]
    return [`  ${spec.cssProperty}: ${value};`]
  }

  // The preset's own overrides win, so they are collected first and the primitive's defaults
  // only fill in the timing params the preset left alone.
  const fromPreset = Object.entries(params).flatMap(([name, value]) => declaration(name, value))
  const fromPrimitive = TIMING_PARAMS.flatMap((name) => {
    if (name in params) return []
    const spec = primitive.parameters[name]
    if (!spec || spec.default === undefined) return []
    return declaration(name, spec.default)
  })

  return [...fromPreset, ...fromPrimitive]
}

async function main() {
  build()
  const { createRegistry } = await import(bundle)
  const registry = createRegistry()

  const blocks = []
  // `registry.names()` walks every registered category (core, ambient, feedback, interaction,
  // numbers, text, forms, navigation, scroll-mechanics, layout, svg, gestures, three-d) — the
  // previous version only iterated the `PRESETS` export, which is the core v1 catalog alone, so
  // every preset registered by another package's `register*` silently never got a stylesheet rule.
  for (const name of registry.names()) {
    const resolved = registry.resolve(name)
    const declarations = declarationsFor(resolved)
    if (declarations.length === 0) continue
    blocks.push(`  [data-kui-fx~='${name}'] {\n  ${declarations.join('\n  ')}\n  }`)
  }

  const css = `/*
 * GENERATED by scripts/generate-preset-css.mjs — do not edit.
 *
 * Preset parameter defaults, as ordinary rules so consumer CSS can override them without
 * \`!important\`. Run \`npm run generate:css\` after changing any preset's params.
 */
@layer kui.presets {
${blocks.join('\n\n')}
}
`
  writeFileSync(outFile, css)
  rmSync(tmpDir, { recursive: true, force: true })
  console.log(`wrote ${blocks.length} preset rules to src/css/presets.generated.css`)
}

main().catch((error) => {
  rmSync(tmpDir, { recursive: true, force: true })
  console.error(error)
  process.exit(1)
})
