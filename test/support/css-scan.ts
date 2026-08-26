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
 */

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

/** Selector = the base attribute rule plus any pseudo-*classes*; `(?!:)` rejects `::before`. */
const HOST_RULE = /^[ \t]*\[data-kui-fx~=(['"])([\w-]+)\1\](?::(?!:)[\w-]+(?:\([^)]*\))?)*[ \t]*\{/gm

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
