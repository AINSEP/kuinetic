import type { EffectSpec } from './types.js'
import type { Registry } from './registry.js'

/**
 * Owned by phase 9b — catching the classic `target:` typo: `pop target:.a, .b` reads as three
 * effect segments (`pop`, `.a`, `.b`), not one effect with a two-part selector, because a comma
 * separates *segments* everywhere else in the grammar and `target:` is the one place a selector
 * can legitimately contain one. An author who forgets the quotes (`target:'.a, .b'`) gets a stray
 * segment named `.a` that is not a registered effect and looks exactly like a selector — this
 * module finds that shape and 9b's diagnostics surface it via `data-kui-unmatched`.
 *
 * SKELETON STUB (§1): `findUnquotedSelectors` always returns `[]`, so `compileTargets`'s call site
 * is a no-op and no `data-kui` value is parsed any differently than HEAD parses it today. Real
 * bodies land with 9b — see `target-phases-2-9.md`.
 */

/** One stray segment that looks like a continuation of the previous segment's `target:` selector. */
export interface UnquotedSelector {
  /** The previous segment's `target:` value, as authored. */
  previous: string
  /** The stray segment's name — the text between commas that isn't a registered effect. */
  segment: string
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
 * @param specs - The document's parsed effect segments, in authored order.
 * @param registry - Where a segment's first token is looked up to decide if it names a real
 *   effect.
 * @returns Every suspect segment found, in authored order.
 * STUB: always `[]`.
 * @complexity O(1) time and space.
 * @overallScore 100
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- stub: params unused until 9b fills this in
export function findUnquotedSelectors(specs: EffectSpec[], registry: Registry): UnquotedSelector[] {
  return []
}

/**
 * Render one {@link UnquotedSelector} finding as a warning string, naming both halves of the fix:
 * quote the previous segment's selector so the whole comma list is one `target:` value.
 *
 * @param found - One finding from {@link findUnquotedSelectors}.
 * STUB: `''` — never called while `findUnquotedSelectors` returns `[]`.
 * @complexity O(1) time and space.
 * @overallScore 100
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- stub: param unused until 9b fills this in
export function unquotedSelectorWarning(found: UnquotedSelector): string {
  return ''
}
