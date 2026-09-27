import type { EffectSpec } from './types.js'
import type { Registry } from './registry.js'

/**
 * Owned by phase 9b — catching the classic `target:` typo: `pop target:.a, .b` reads as three
 * effect segments (`pop`, `.a`, `.b`), not one effect with a two-part selector, because a comma
 * separates *segments* everywhere else in the grammar and `target:` is the one place a selector
 * can legitimately contain one. An author who forgets the quotes (`target:'.a, .b'`) gets a stray
 * segment named `.a` that is not a registered effect and looks exactly like a selector — this
 * module finds that shape and 9b's diagnostics surface it via `data-kui-unmatched`.
 */

/** One stray segment that looks like a continuation of the previous segment's `target:` selector. */
export interface UnquotedSelector {
  /** The previous segment's `target:` value, as authored. */
  previous: string
  /** The stray segment's name — the text between commas that isn't a registered effect. */
  segment: string
}

/** A bare segment name starting with a class/id/attribute/universal/pseudo selector marker. */
const SELECTOR_START = /^[.#[*:]/
/** A bare segment name containing a combinator — only ever legal inside a selector. */
const SELECTOR_COMBINATOR = /[>~+]/

/**
 * True when `name` — a segment's first token, i.e. what would be its effect name — instead looks
 * like a fragment of a CSS selector: it opens with a class/id/attribute/universal/pseudo marker,
 * or contains a combinator. Neither shape is a legal effect name, so either is evidence the
 * segment is really the tail of the previous segment's unquoted `target:` selector.
 */
function looksLikeSelectorFragment(name: string): boolean {
  return SELECTOR_START.test(name) || SELECTOR_COMBINATOR.test(name)
}

/**
 * Find segments whose first token is not a registered effect name, that look like a selector
 * fragment (start with `.`, `#`, `[`, `*`, `:`, or contain `>`, `~`, `+`), and whose *previous*
 * segment carries a `target:` token — the shape an unquoted, comma-containing selector leaves
 * behind once `parse.ts` has already split it on the comma.
 *
 * Pure: it only reads `specs` and `registry`, and never changes how anything is parsed or
 * compiled — the fix is a warning, not a silent re-join, because re-joining would have to guess
 * where the selector was supposed to end.
 *
 * Known limitation: only catches a stray segment whose *first token* looks like a selector.
 * `pop target:.a, li > a` splits into a stray segment `li > a` whose first token is `li` — a
 * plausible effect name — so it is not flagged, even though `>` later in the segment is still a
 * combinator. Detecting that shape would mean scanning every segment for a `target:`-less
 * combinator, not just the one right after a `target:`-bearing segment, which is out of scope
 * here: this pass only looks at the segment immediately following one that carries `target:`.
 *
 * @param specs - The document's parsed effect segments, in authored order. Pre-lift: `target:`
 *   still lives in `spec.params.target` rather than having been pulled onto a separate field.
 * @param registry - Where a segment's first token is looked up to decide if it names a real
 *   effect.
 * @returns Every suspect segment found, in authored order.
 * @complexity O(n) time in `specs.length`, each iteration doing an O(1) registry lookup; O(f)
 *   space in the number of findings.
 * @overallScore 100
 */
export function findUnquotedSelectors(specs: EffectSpec[], registry: Registry): UnquotedSelector[] {
  const found: UnquotedSelector[] = []
  // `specs.entries()` rather than an index loop: `noUncheckedIndexedAccess` still makes
  // `specs[i - 1]` possibly-`undefined`, so that lookup keeps its own guard below, but `spec`
  // itself comes typed straight off the iterator instead of a second unchecked index read.
  for (const [i, spec] of specs.entries()) {
    // `specs[-1]` is undefined, so the first segment falls out through the optional chain.
    const target = specs[i - 1]?.params.target
    if (!target || registry.has(spec.name) || !looksLikeSelectorFragment(spec.name)) continue
    found.push({ previous: target, segment: spec.name })
  }
  return found
}

/**
 * Render one {@link UnquotedSelector} finding as a warning string, naming both halves of the fix:
 * quote the previous segment's selector so the whole comma list is one `target:` value.
 *
 * @param found - One finding from {@link findUnquotedSelectors}.
 * @complexity O(1) time and space.
 * @overallScore 100
 */
export function unquotedSelectorWarning(found: UnquotedSelector): string {
  return (
    `target:${found.previous} looks like it continues into "${found.segment}", but a comma ` +
    `always starts a new effect segment — a target: selector containing a comma must be quoted, ` +
    `e.g. target:'${found.previous}, ${found.segment}'`
  )
}
