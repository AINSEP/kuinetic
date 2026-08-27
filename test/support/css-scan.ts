/**
 * Static scanners over the shipped stylesheets, shared by the channel invariants.
 *
 * These lived inside `css-invariants.test.ts` until that file hit its 400-line lint ceiling — it
 * was sitting at 399 — and the honest fix was not to shave a comment but to notice that none of
 * this is *assertion* code. It is a small CSS reader: find the blocks, find the properties, find
 * which rule runs which keyframes. `channel-properties.ts` next door exists for the same reason,
 * and the same benefit follows: `three-d.test.ts` and `tween.test.ts` assert versions of the same
 * two invariants and can reach for these rather than growing a second copy that drifts.
 *
 * Everything here is deliberately regex-and-brace-counting rather than a real CSS parse. The
 * shared hazard is that a scanner which quietly matches *nothing* makes every assertion built on
 * it pass vacuously, so each function below documents what it is anchored to, and the suites that
 * use them carry size/reach assertions as the backstop.
 *
 * The mirror-image hazard is a scanner that matches *too much* — prose inside a `/* ... *\/` block
 * that happens to look like a real declaration. `stripComments` below exists so every scanner in
 * this file can be handed comment-free input once, at the source, rather than each one growing its
 * own ad hoc defense (or, as happened once, not growing one at all).
 */

/**
 * Strip every `/* ... *\/` block comment before any other scanner in this file sees the text.
 *
 * Call this on raw CSS before passing it to any function below. Without it, a regex that looks for
 * `@keyframes name {` (or `[data-kui-fx~=...] {`, or `::before`/`::after`, or `transition:`) cannot
 * tell a real declaration from the same text sitting inside a comment — and this catalog's own
 * convention is to retire a preset by commenting out its whole CSS block with an explanatory note
 * (`ambient.css`'s `noise-overlay` cut is exactly this shape), so live-looking declarations inside
 * comments are not a hypothetical, they are how "removed but kept for reference" is spelled here.
 * `extractKeyframes` read `@keyframes kui-noise-overlay {` out of one such comment and reported it
 * as a real, unreferenced block — an orphan that was never live.
 *
 * Non-greedy (`*?`) is required, not a style preference: CSS comments do not nest, so each `/*`
 * closes at the *nearest* `*\/`, and a greedy `*` would run past that boundary into whatever real
 * code follows — the exact failure mode a prior fix to the `@layer kui.effects` scan hit, where a
 * prose mention of that text inside a comment matched and the following "read to the next brace"
 * step swallowed a live selector. Stripping comments *before* any pattern runs is what keeps this
 * function's own scan, and every scanner downstream of it, out of that trap: there is no comment
 * left by the time a regex sees the text, so a comment can no longer be mistaken for code, and a
 * comment's own `{`/`}` characters can no longer be counted as if they belonged to a real block.
 *
 * @complexity O(n) time and space in the length of `css`.
 * @overallScore 100
 */
export function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

/** Read from `start` to the brace that closes the block opened just before it. */
export function readBalancedBlock(source: string, start: number): string {
  let depth = 1
  for (let i = start; i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}' && --depth === 0) return source.slice(start, i)
  }
  return source.slice(start)
}

/**
 * Declared CSS property names inside a block body, however the declarations are laid out.
 *
 * Anchored to "right after the block's own opening brace, or after `{`/`;`" rather than to
 * start-of-line: a line-anchored regex silently extracts nothing from a compact
 * `from { prop: val; }` single-line keyframe — media.css writes several this way — which is
 * worse than a hard failure, since every assertion would then pass vacuously instead of
 * checking anything.
 *
 * The optional leading `-?` admits vendor-prefixed properties (`-webkit-text-fill-color`,
 * `-webkit-mask-composite`) without also admitting a custom property: `--kui-border-angle` starts
 * with *two* dashes, and `-?` only ever consumes one, so the required `[a-z]` immediately after it
 * fails to match the second dash and the whole property is correctly skipped — the channel model
 * polices painted CSS properties, not the custom properties that sometimes drive them. Before this
 * was widened, every `-webkit-*` declaration in the catalog was invisible to every channel check:
 * `gradient-shimmer`, `gradient-sweep`, and `text-outline-fill` all write `-webkit-text-fill-color`
 * in an unconditional rule or a keyframe with no entry anywhere in `CHANNEL_PROPERTIES` to catch a
 * channel that didn't cover it.
 */
export function extractDeclaredProperties(body: string): Set<string> {
  const properties = new Set<string>()
  for (const [, property] of body.matchAll(/(?:^|[{;])\s*(-?[a-z][a-z-]*)\s*:/g)) {
    if (property) properties.add(property)
  }
  return properties
}

/**
 * name → the CSS properties its `@keyframes` blocks write.
 *
 * Brace-balanced rather than indentation-matched: an indentation-sensitive regex would quietly
 * extract nothing if a formatter reflowed the file, and every assertion would then pass vacuously.
 */
export function extractKeyframes(css: string): Map<string, Set<string>> {
  const found = new Map<string, Set<string>>()

  for (const match of css.matchAll(/@keyframes\s+([\w-]+)\s*\{/g)) {
    const body = readBalancedBlock(css, match.index + match[0].length)
    found.set(match[1]!, extractDeclaredProperties(body))
  }
  return found
}

/**
 * preset name → the CSS properties its *unconditional* `[data-kui-fx~='name']` rule writes.
 *
 * Deliberately excludes anything with a combinator, pseudo-class, or pseudo-element in the
 * selector (`:hover`, `:focus-visible`, `::before`, `~ .foo`) — those rules paint a conditional
 * state or a different box (a sibling, a pseudo-element) than the element `data-kui-fx` lives on,
 * so they cannot silently clobber another composed effect's property on the *same* box the way an
 * always-on base-selector declaration can. That is exactly the shape of the spinner-dots bug:
 * `[data-kui-fx~='spinner-dots'] { background: currentColor; ... }` is unconditional and lands on
 * the same element `gradient-mesh` paints its background on.
 */
export function extractBaseRuleProperties(css: string): Map<string, Set<string>> {
  const found = new Map<string, Set<string>>()
  for (const match of css.matchAll(/^[ \t]*\[data-kui-fx~=(['"])([\w-]+)\1\][ \t]*\{/gm)) {
    const body = readBalancedBlock(css, match.index + match[0].length)
    const name = match[2]!
    const existing = found.get(name) ?? new Set<string>()
    for (const property of extractDeclaredProperties(body)) existing.add(property)
    found.set(name, existing)
  }
  return found
}

/**
 * Selector = the base attribute rule plus any pseudo-*classes*; `(?!:)` rejects `::before`.
 *
 * Exported so any scanner that needs "this rule paints the host box, in some state" rather than
 * "this rule paints the host box, unconditionally" can share the one pattern instead of growing a
 * second copy — `extractTransitionedProperties` below is the second consumer.
 */
export const HOST_RULE =
  /^[ \t]*\[data-kui-fx~=(['"])([\w-]+)\1\](?::(?!:)[\w-]+(?:\([^)]*\))?)*[ \t]*\{/gm

/**
 * The `@keyframes` blocks a declaration body actually runs, from `animation`/`animation-name`.
 *
 * Names are recovered by intersecting the declaration value against blocks that are known to
 * exist, rather than by taking the token straight after the colon. `animation` is a shorthand with
 * no fixed order, so `animation: 2s linear kui-foo` would otherwise register `2s` as the name.
 */
function animatedBlockNames(body: string, blocks: ReadonlyMap<string, unknown>): string[] {
  const names: string[] = []
  for (const declaration of body.matchAll(/\banimation(?:-name)?\s*:\s*([^;}]+)/g)) {
    for (const token of declaration[1]!.matchAll(/[\w-]+/g)) {
      if (blocks.has(token[0])) names.push(token[0])
    }
  }
  return names
}

/**
 * preset name → pseudo-element ('before' | 'after') → the CSS properties its own unconditional
 * `[data-kui-fx~=name]::before`/`::after` rule declares.
 *
 * The counterpart `extractBaseRuleProperties`/`extractHostAnimationBindings` deliberately do NOT
 * reach — both exclude pseudo-elements by design, correctly, because a pseudo-element paints a
 * different box than the one `data-kui-fx` sits on and so cannot clobber a *host* channel. But
 * nothing audited the pseudo-element box itself: two presets that both use `::after` (or both use
 * `::before`) share one physical box exactly the way two presets both writing `background` on the
 * host would, and the channel model — keyed on the host element — has no way to see that.
 *
 * Matched by the selector token, not the line, unlike the two functions above: a shared rule such
 * as `[data-kui-fx~='beam-border']::before,\n[data-kui-fx~='beam-border-auto']::before { ... }`
 * needs both names attributed to the one block, and a line-anchored match (`extractBaseRuleProperties`'s
 * approach) only ever catches the last selector on the block's own line. Each match's own regex
 * ends right after `::before`/`::after`, deliberately not `\{` — extending it that far would inherit
 * that same limitation — so instead this walks forward from there to the next literal `{`, which is
 * always the block's opening brace: nothing else in this call, comment-stripped or not, can put an
 * unmatched `{` between one selector in a list and the rule's own body. A pseudo-*class* gate
 * (`:focus-visible::after`) is excluded on purpose: the base rule is the box's persistent identity —
 * `content`, `position`, `background` — and that is what two composed presets actually fight over,
 * not a state-only addition like an `animation-delay`.
 *
 * @complexity O(n) time and space in the length of the scanned CSS.
 * @overallScore 100
 */
export function extractPseudoElementProperties(
  css: string,
): Map<string, Map<'before' | 'after', Set<string>>> {
  const found = new Map<string, Map<'before' | 'after', Set<string>>>()
  for (const match of css.matchAll(/\[data-kui-fx~=(['"])([\w-]+)\1\]::(before|after)\b/g)) {
    const openBrace = css.indexOf('{', match.index + match[0].length)
    if (openBrace === -1) continue
    const body = readBalancedBlock(css, openBrace + 1)
    const name = match[2]!
    const which = match[3] as 'before' | 'after'
    const byPseudo = found.get(name) ?? new Map<'before' | 'after', Set<string>>()
    const existing = byPseudo.get(which) ?? new Set<string>()
    for (const property of extractDeclaredProperties(body)) existing.add(property)
    byPseudo.set(which, existing)
    found.set(name, byPseudo)
  }
  return found
}

/**
 * Split a `transition:` value on its top-level commas only.
 *
 * A plain `.split(',')` is wrong here: `var(--kui-lift-duration, 220ms)` carries its own comma, and
 * naively splitting on every comma turns that fallback argument into a second, bogus "segment"
 * whose first token (`220ms)`) then gets misread as a property name. Depth-tracking is the fix —
 * only a comma at paren depth 0 is a real segment boundary.
 */
function splitTopLevel(value: string): string[] {
  const segments: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < value.length; i++) {
    if (value[i] === '(') depth++
    else if (value[i] === ')') depth--
    else if (value[i] === ',' && depth === 0) {
      segments.push(value.slice(start, i))
      start = i + 1
    }
  }
  segments.push(value.slice(start))
  return segments
}

/**
 * The property named by each comma-separated segment of a `transition:` shorthand value.
 *
 * CSS's `transition` grammar puts the property first in each segment (`property duration
 * timing-function delay`, any of the last three optional) — none of the 29 declarations in this
 * catalog omit it in favour of the bare-duration `all` spelling, so taking the first
 * whitespace-separated token is exact for what exists today rather than a simplification.
 */
function transitionedProperties(body: string): Set<string> {
  const properties = new Set<string>()
  for (const declaration of body.matchAll(/\btransition\s*:\s*([^;}]+)/g)) {
    for (const segment of splitTopLevel(declaration[1]!)) {
      const property = segment.trim().split(/\s+/)[0]
      if (property) properties.add(property)
    }
  }
  return properties
}

/**
 * preset name → every property named in a `transition:` shorthand on that preset's own host rule —
 * the unconditional rule and any pure-pseudo-*class* state variant (`:hover`, `:focus-visible`),
 * reusing `HOST_RULE` so this asks exactly the same "same box, some state" question
 * `extractHostAnimationBindings` does, not a wider one.
 *
 * That restriction matters here specifically. An earlier version of this scanner matched
 * `[data-kui-fx~='name']` anywhere at all, with no restriction on what followed before the next
 * `{` — which reached `strength-meter ~ .kui-meter > *`, `toggle-morph ~ .kui-track`, and
 * `step-progress > [data-kui-step-state]` (all real, but on a *sibling* or *descendant*, a
 * different box than the one `channels` describes) and `beam-border`/`cursor-spotlight`'s own
 * `::before` (a different box for the same reason `extractPseudoElementProperties` exists
 * separately). All four produced "violations" that were artifacts of the scanner reaching a box
 * `channels` was never describing, not real gaps — the same false-positive shape
 * `extractBaseRuleProperties`'s own doc comment warns against for the static-rule check.
 *
 * Now backs one direction of the "transition channel" invariant in
 * `css-composition-invariants.test.ts`: after the compile-time merge (`Preset.transitions`,
 * `src/core/declarations.ts`'s `pushTransitions`), no preset has any legitimate reason left to carry a
 * bare host-rule `transition:` of its own, so this scanner finding one at all is the violation —
 * asserted as an empty result, not a named clobber-pair list the way it used to be.
 *
 * @complexity O(n) time and space in the length of the scanned CSS.
 * @overallScore 100
 */
export function extractTransitionedProperties(css: string): Map<string, Set<string>> {
  const found = new Map<string, Set<string>>()
  for (const match of css.matchAll(HOST_RULE)) {
    const body = readBalancedBlock(css, match.index + match[0].length)
    const properties = transitionedProperties(body)
    if (properties.size === 0) continue
    const name = match[2]!
    const existing = found.get(name) ?? new Set<string>()
    for (const property of properties) existing.add(property)
    found.set(name, existing)
  }
  return found
}

/**
 * Every pair, among those given, whose channels are disjoint — the set the compiler treats as safe
 * to compose (`findConflicts` in `core/channels.ts` reports nothing for a disjoint pair). Backs the
 * pseudo-element ownership audit in `css-composition-invariants.test.ts`: a box outside what
 * `channels` describes, fought over by two presets the compiler waves through as safe. Formerly
 * shared with a second, now-removed "transition-clobber" audit of the same shape — the compile-time
 * transition merge (`Preset.transitions`, `src/core/compile.ts`) made that hazard unreachable rather
 * than merely detected, so its own caller (`transitionClobberPairs`) was deleted rather than kept
 * finding nothing. Takes a lookup rather than a registry directly, so this file's dependency graph
 * stays what it has always been: string/regex analysis, nothing that knows what a `Registry` is.
 *
 * @complexity O(n^2) time in `items.length`; every pair is compared once. The one remaining call
 * site passes a preset count with a pseudo-element rule specifically — tens, not the full
 * ~260-preset catalog — cheap even squared.
 * @overallScore 100
 */
export function disjointPairs<T>(
  items: readonly T[],
  channelsOf: (item: T) => readonly string[] | undefined,
): [T, T][] {
  const pairs: [T, T][] = []
  for (let i = 0; i < items.length; i++) {
    const a = channelsOf(items[i]!)
    if (!a) continue
    for (let j = i + 1; j < items.length; j++) {
      const b = channelsOf(items[j]!)
      if (b && !a.some((channel) => b.includes(channel))) pairs.push([items[i]!, items[j]!])
    }
  }
  return pairs
}

/**
 * Format every disjoint-channel pair that shares a written property on the same pseudo-element, as
 * `"a + b (::which): prop1, prop2"` strings sorted for a stable assertion order.
 *
 * Pulled out of the test file for the same reason `disjointPairs` was: this is a data
 * transformation over an already-computed pair list, not the assertion itself, which stays in
 * `css-composition-invariants.test.ts` as the one line that calls this and compares the result.
 *
 * @complexity O(p * P) time in pair count `p` times the larger property-set size `P`; both are
 * small (property sets here run in the single digits).
 * @overallScore 100
 */
function formatPseudoCollisions(
  pseudoElements: ReadonlyMap<string, ReadonlyMap<'before' | 'after', ReadonlySet<string>>>,
  pairs: readonly [string, string][],
): string[] {
  const collisions = pairs.flatMap(([a, b]) => {
    const found: string[] = []
    for (const which of ['before', 'after'] as const) {
      const propsA = pseudoElements.get(a)?.get(which)
      const propsB = pseudoElements.get(b)?.get(which)
      if (!propsA || !propsB) continue
      const shared = [...propsA].filter((property) => propsB.has(property))
      shared.sort((x, y) => x.localeCompare(y))
      if (shared.length > 0) found.push(`${a} + ${b} (::${which}): ${shared.join(', ')}`)
    }
    return found
  })
  // Sorted, not insertion order: pair order walks CSS source position, a detail of file layout
  // rather than of the finding — the same reason the "reaches the hover family keyframes" test in
  // css-composition-invariants.test.ts sorts before comparing a named baseline.
  collisions.sort((a, b) => a.localeCompare(b))
  return collisions
}

/**
 * Named collisions ready for the "pseudo-element ownership" assertion in css-composition-invariants.test.ts:
 * every disjoint-channel preset pair that shares a written property on the same `::before`/`::after`.
 * The test file keeps only the one line that calls this and compares the result — see
 * `disjointPairs`'s own comment for why `channelsOf` is a lookup rather than a `Registry` import.
 */
export function pseudoElementCollisions(
  css: string,
  channelsOf: (name: string) => readonly string[] | undefined,
): string[] {
  const pseudoElements = extractPseudoElementProperties(css)
  const pairs = disjointPairs([...pseudoElements.keys()], channelsOf)
  return formatPseudoCollisions(pseudoElements, pairs)
}

/**
 * fx name → the keyframe blocks a literal `animation:` runs *on that effect's own element*.
 *
 * This is the second join path into the keyframe-channel invariant, and it exists because the
 * first one had a hole the size of a whole family. That check reaches a keyframe only through
 * `Preset.keyframes`, and `HOVER_PRESETS` (`catalog/interaction.ts`) are built by mapping over
 * `HOVER_PRIMITIVES` with just a name and a primitive — no `keyframes` field, deliberately: those
 * primitives are `renderer: 'javascript'` and their motion is `:hover`/`:focus-visible` CSS, not
 * the compiled `animation-*` path a `keyframes` field feeds. Adding the field to make them visible
 * would change what the compiler emits, so the invariant has to come to them instead. Until it
 * did, `kui-split-flap`, `kui-icon-spin`, `kui-icon-wiggle` and `kui-icon-bounce` were never
 * audited against their primitives' channels at all — and `split-flap` had been writing the
 * `transform` shorthand while declaring `['rotate']`, with `interaction.css` carrying a
 * hand-written NOTE about it precisely because no test could say it.
 *
 * Restricted to the host element the way `extractBaseRuleProperties` is, and for the same reason:
 * the base selector plus pseudo-*classes* still paints the box `data-kui-fx` sits on, so it can
 * clobber a composed effect's property there, while a pseudo-*element* or descendant rule
 * (`shine-sweep`'s `::after`, `beam-border`'s `::before`, `submit-to-spinner-to-check`'s
 * ` .kui-spinner`) paints a different box and cannot.
 */
export function extractHostAnimationBindings(
  css: string,
  blocks: ReadonlyMap<string, unknown>,
): Map<string, Set<string>> {
  const found = new Map<string, Set<string>>()
  for (const match of css.matchAll(HOST_RULE)) {
    const body = readBalancedBlock(css, match.index + match[0].length)
    const names = animatedBlockNames(body, blocks)
    if (names.length === 0) continue
    const name = match[2]!
    found.set(name, new Set([...(found.get(name) ?? []), ...names]))
  }
  return found
}
