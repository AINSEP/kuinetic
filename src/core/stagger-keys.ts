import type { ParsedValue, SegmentHoists } from './types.js'
import type { StaggerGroupKeys } from './stagger-config.js'

/**
 * `target:`'s own stagger-key plumbing — kept apart from `stagger-config.ts` (the attribute
 * grammar) and `stagger.ts` (ranking) because these five functions answer questions only a
 * retargeted group has: which keys does the *host* carry element-wide, which does one *group*
 * carry once its own scoped hoists are folded in, is a group "grouped" (one activation binding
 * for the lot, B-a), and — bug 3 — how `declaresGroup` tells a `target:` host apart from an
 * ordinary stagger group so it never double-indexes the host's own DOM children.
 *
 * SKELETON STUB (§1): every body below is inert (`undefined`/`false`/a no-op unmark) so the tree
 * typechecks and lints while 3a is unbuilt. Real bodies land with 3a — see `target-phases-2-9.md`.
 */

/**
 * An element's own stagger keys, off its (already `scopeHoists`-folded) `ParsedValue` — the
 * element-wide defaults a group's scoped hoists override per key (D-B.3).
 *
 * @param parsed - The host's parsed `data-kui`, after `compile.ts`'s `scopeHoists` has folded back
 *   any hoist an unknown or non-declaring segment provisionally routed to `SegmentHoists`.
 * @returns `undefined` when the element declares no group key at all.
 * STUB: always `undefined` — 3a fills this in.
 * @complexity O(1) time and space.
 * @overallScore 100
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- stub: param unused until 3a fills this in
export function elementStaggerKeys(parsed: ParsedValue): StaggerGroupKeys | undefined {
  return undefined
}

/**
 * One `target:` group's effective stagger keys: its own scoped hoists (from `CompiledTarget.hoists`)
 * override the host's element-wide keys per key, not per attribute (D-B.3) — the same "each key
 * decided on its own" rule `resolveStaggerConfigFrom` already applies to the two *attributes*,
 * extended to the two *scopes* a `target:` group adds.
 *
 * @param scoped - The group's own hoisted keys (`CompiledTarget.hoists`), or `undefined` when the
 *   targeted segment hoisted none of its own.
 * @param elementWide - {@link elementStaggerKeys}'s result for the host.
 * @returns `undefined` when neither scope declares a key.
 * STUB: always `undefined` — 3a fills this in.
 * @complexity O(1) time and space.
 * @overallScore 100
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- stub: params unused until 3a fills this in
export function staggerKeysFor(scoped: SegmentHoists | undefined, elementWide: StaggerGroupKeys | undefined): StaggerGroupKeys | undefined {
  return undefined
}

/**
 * Whether a group's effective keys make it "grouped" in B-a's sense: one activation binding on the
 * host fans out to every member, rather than each member binding its own gate. `cascade:`,
 * `spread:` and `order:` all imply it — any key that only makes sense read across the whole group
 * at once.
 *
 * @param keys - A group's effective keys, from {@link staggerKeysFor}.
 * STUB: always `false` — 3a fills this in.
 * @complexity O(1) time and space.
 * @overallScore 100
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- stub: param unused until 3a fills this in
export function isGroupedKeys(keys: StaggerGroupKeys | undefined): boolean {
  return false
}

/**
 * Mark `host` as a `target:`-group host, so an ordinary stagger scan (`applyStagger`/
 * `restageAround`, via `declaresGroup`) never indexes its DOM children as an unrelated stagger
 * group (bug 3) — a `target:` host publishes its own `--kui-stagger`/`-count` through
 * `indexTargetGroup` instead, over the *matched* set, not its DOM children.
 *
 * @param host - The element to mark.
 * @returns The unmark — call it when the host's derived groups are released.
 * STUB: marks nothing, returns a no-op unmark — 3a fills this in.
 * @complexity O(1) time and space.
 * @overallScore 100
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- stub: param unused until 3a fills this in
export function claimTargetGroupHost(host: Element): () => void {
  return () => {}
}

/**
 * Whether {@link claimTargetGroupHost} has marked this element.
 *
 * @param el - The candidate element.
 * STUB: always `false` — 3a fills this in. Until then `declaresGroup`'s new check is a no-op and
 * HEAD's ordinary stagger-group behaviour is unchanged, which is the skeleton's whole point.
 * @complexity O(1) time and space.
 * @overallScore 100
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- stub: param unused until 3a fills this in
export function isTargetGroupHost(el: Element): boolean {
  return false
}
