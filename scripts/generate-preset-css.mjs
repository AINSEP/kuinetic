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
// The breakpoint scale is bundled and imported rather than restated here. It is already written
// twice — once in `src/core/breakpoints.ts`, once as media queries in `src/css/base.css` — and a
// third copy in the generator would be the one nobody thinks to update, producing a cloak release
// keyed on a width no gate ever uses.
const breakpointsBundle = `${tmpDir}/breakpoints.mjs`
/** Bundled for the same reason the breakpoint scale is — see {@link easingValue}. */
const easingBundle = `${tmpDir}/easing.mjs`
const outFile = `${root}src/css/presets.generated.css`

function build() {
  mkdirSync(tmpDir, { recursive: true })
  const bundleOne = (entry, outfile) =>
    execFileSync('npx', ['esbuild', entry, '--bundle', '--format=esm', `--outfile=${outfile}`], {
      stdio: 'pipe',
    })
  bundleOne(`${root}src/effects/index.ts`, bundle)
  bundleOne(`${root}src/core/breakpoints.ts`, breakpointsBundle)
  bundleOne(`${root}src/core/easing.ts`, easingBundle)
}

/**
 * How a preset's declared easing becomes a stylesheet value.
 *
 * Everything the library names — `back-out`, `expo-out`, `spring` — is a kUInetic token defined in
 * `base.css` as `--kui-ease-<name>`, not a CSS keyword, and `spring(...)` is not a CSS function at
 * all. Writing either verbatim produced `animation-timing-function: back-out`, which browsers throw
 * away, so every "easing character" preset — `bounce-in`, `bounce-in-up`, `back-in-up`, `pop-in`,
 * `swing-in` — animated on the default curve and none of them actually bounced.
 *
 * This used to be a copy of the runtime's rule, with a comment saying it mirrored it. It is now the
 * rule itself, bundled from `src/core/easing.ts`: two implementations of "what CSS does this token
 * mean" is exactly how the two halves drifted apart in the first place.
 */
let easingValue

/**
 * A `path` parameter's value, as the CSS `<string>` the custom property has to hold.
 *
 * `offset-path: path(...)` takes a string, and `var()` substitutes tokens rather than text, so
 * `--kui-motion-path` only works if the quotes are part of its value. A preset declares its path
 * the way an author would type it in `data-kui` — raw path data, no quotes — exactly as every
 * other preset parameter is declared in the spelling the attribute grammar uses. So the quotes are
 * added here, mirroring `easingValue` above: the same "the schema's spelling is not the
 * stylesheet's spelling" step, for the same reason.
 *
 * `validate()` in `src/core/params.ts` does this for *authored* paths and is the one that has to
 * be careful about it; a preset's path is repository source, not untrusted input.
 */
function pathValue(value) {
  return `"${value}"`
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
    if (spec.type === 'path') return [`  ${spec.cssProperty}: ${pathValue(value)};`]
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

/**
 * The pre-JS cloak selector for one preset name.
 *
 * `~=`, not `^=`. The cloak has to match before any script runs, so the only thing it can key on
 * is the *authored* `data-kui` value — never `data-kui-fx` or `data-kui-state`, which the runtime
 * stamps. `~=` treats that value as a whitespace-separated token list and matches an exact token,
 * which gets three things right that a prefix match does not:
 *
 *   - `data-kui="fade-up 700ms"`                     → tokens include `fade-up`            ✓
 *   - `data-kui="slide-up 700ms, blur-in 700ms"`     → matches BOTH names, not just the first
 *   - `data-kui="word-cycler words:fade-up|blur-in"` → token is `words:fade-up|blur-in`, no match
 *
 * That last one is the reason to care: `^=` would also have hit any name that happens to be a
 * prefix of another, and `~=` cannot, because the token has to be the whole word.
 *
 * A comma with no space after it (`data-kui="fade-up,blur-in"`) makes one token and matches
 * neither. That is a deliberate fail-open: not cloaking is exactly today's behaviour.
 */
function cloakSelector(name) {
  return `  html[data-kui-cloak] [data-kui~='${name}']:not([data-kui-state])`
}

/**
 * The cloak's viewport-gate release.
 *
 * Same argument as the reduced-motion block below it, arriving from the other axis: an effect that
 * is not going to run at this width has no entrance to smooth, so cloaking the element is pure
 * cost. With JavaScript working it is a few milliseconds; with JavaScript slow, blocked, or broken
 * it is the full two seconds of `kui-cloak-release`, spent hiding content from a phone for the sake
 * of an animation that phone was never going to see.
 *
 * Keyed on the gate token in the *authored* attribute — `[data-kui~='above:md']` — for exactly the
 * reason `cloakSelector` gives above: the cloak has to match before any script runs, so
 * `data-kui-fx` does not exist yet and `data-kui` is the only thing there is to match on. That also
 * makes these rules generic rather than per-preset: ten of them cover every preset in the catalog,
 * present and future, because the token is the same wherever it appears.
 *
 * `not all and (min-width: X)` rather than `(width < X)`: the complement has to be *exact* — a
 * `max-width` a hair under X leaves a sliver of widths where the cloak is not released — and the
 * range syntax is newer than the browsers this stylesheet still has to parse in. `not all and (…)`
 * is the exact negation and is understood everywhere.
 *
 * Emitted after the cloak selectors, and with identical specificity to them, so ordinary source
 * order decides. Placing them before would silently do nothing.
 */
function gateReleaseRules(breakpoints) {
  const release = (token, query) =>
    `  @media ${query} {\n` +
    `    html[data-kui-cloak] [data-kui~='${token}']:not([data-kui-state]) {\n` +
    `      opacity: 1;\n` +
    `      animation: none;\n` +
    `    }\n` +
    `  }`

  return Object.entries(breakpoints)
    .flatMap(([name, width]) => [
      // `above:md` is off below md; `below:md` is off from md up.
      release(`above:${name}`, `not all and (min-width: ${width})`),
      release(`below:${name}`, `(min-width: ${width})`),
    ])
    .join('\n\n')
}

/**
 * The whole `kui.cloak` layer for a list of preset names.
 *
 * Split out of `main` so the layer's own long explanation lives next to the rules it explains,
 * rather than as a template literal three levels deep inside the writer.
 */
function cloakLayer(names, breakpoints) {
  const selectors = names.map(cloakSelector).join(',\n')
  return `
/*
 * The pre-JS cloak — one selector per preset that declares \`cloak: true\`.
 *
 * The problem: an entrance's from-state is installed by the runtime, so between first paint and
 * \`start()\` the element is painted at its REST state. The visitor sees the finished content, and
 * then it jumps back to invisible and animates in. That is the flash this layer removes.
 *
 * Opt in by putting \`data-kui-cloak\` on the root element:
 *
 *   <html lang="en" data-kui-cloak>
 *
 * **It is fail-open three times over,** because a cloak that sticks is a blank page:
 *
 *   1. \`Animator.start()\` removes the root attribute, which drops this whole layer at once.
 *   2. A JS watchdog removes it anyway if \`start()\` stalls (\`animator.ts\`, CLOAK_WATCHDOG_MS).
 *   3. \`kui-cloak-release\` below needs no JS at all: every cloaked element un-hides itself after
 *      2s on a pure CSS animation. So a script that is blocked, 404s, or throws before the
 *      watchdog is ever scheduled still cannot leave content permanently hidden.
 *
 * \`:not([data-kui-state])\` releases each element individually the moment the runtime claims it,
 * rather than waiting for the whole page.
 */
@layer kui.cloak {
${selectors} {
    opacity: 0;
    animation: kui-cloak-release 1ms linear 2s forwards;
  }

  @keyframes kui-cloak-release {
    to {
      opacity: 1;
    }
  }

  /* Reduced motion never wanted the entrance in the first place, so hiding content to smooth one
     is pure cost: the visitor gets a blank region and then a hard cut, instead of the content. */
  @media (prefers-reduced-motion: reduce) {
${selectors} {
      opacity: 1;
      animation: none;
    }
  }

  /* The same argument on the width axis — see \`gateReleaseRules\`. */
${gateReleaseRules(breakpoints)}
}
`
}

async function main() {
  build()
  const { createRegistry } = await import(bundle)
  const { BREAKPOINTS } = await import(breakpointsBundle)
  easingValue = (await import(easingBundle)).cssEasingValue
  const registry = createRegistry()

  const blocks = []
  const cloakable = []
  // `registry.names()` walks every registered category (core, ambient, feedback, interaction,
  // numbers, text, forms, navigation, scroll-mechanics, layout, svg, gestures, three-d) — the
  // previous version only iterated the `PRESETS` export, which is the core v1 catalog alone, so
  // every preset registered by another package's `register*` silently never got a stylesheet rule.
  for (const name of registry.names()) {
    const resolved = registry.resolve(name)
    if (resolved.preset.cloak) cloakable.push(name)
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
${cloakLayer(cloakable, BREAKPOINTS)}`
  writeFileSync(outFile, css)
  rmSync(tmpDir, { recursive: true, force: true })
  console.log(
    `wrote ${blocks.length} preset rules and ${cloakable.length} cloak selectors to src/css/presets.generated.css`,
  )
}

main().catch((error) => {
  rmSync(tmpDir, { recursive: true, force: true })
  console.error(error)
  process.exit(1)
})
