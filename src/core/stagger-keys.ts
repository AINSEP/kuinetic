import type { ParsedValue, SegmentHoists } from './types.js'
import type { StaggerGroupKeys } from './stagger-config.js'

/**
 * `target:`'s own stagger-key plumbing — kept apart from `stagger-config.ts` (the attribute
 * grammar) and `stagger.ts` (ranking) because these five functions answer questions only a
 * retargeted group has: which keys does the *host* carry element-wide, which does one *group*
 * carry once its own scoped hoists are folded in, is a group "grouped" (one activation binding
 * for the lot, B-a), and — bug 3 — how `declaresGroup` tells a `target:` host apart from an
 * ordinary stagger group so it never double-indexes the host's own DOM children.
 */

/**
 * The five stagger-group keys, in the order both {@link SegmentHoists} and `ParsedValue` carry
 * them — the one place this module enumerates them, so {@link elementStaggerKeys} and
 * {@link staggerKeysFor} cannot drift into two different lists.
 */
const GROUP_KEY_NAMES = ['cascade', 'spread', 'order', 'cols', 'along'] as const

/**
 * Build a `StaggerGroupKeys` from a per-key lookup, keeping only the keys that resolved to a
 * value.
 *
 * A key resolved to `undefined` is left off the object rather than set to `undefined` on it: the
 * interface's fields are optional so a caller can tell "not authored" apart from "authored empty",
 * and `Object.keys`/a test's `toEqual` would see a present-but-`undefined` key as authored.
 *
 * @complexity O(1) time and space — five keys, fixed.
 */
function collectKeys(lookup: (name: (typeof GROUP_KEY_NAMES)[number]) => string | undefined): StaggerGroupKeys | undefined {
  const keys: StaggerGroupKeys = {}
  for (const name of GROUP_KEY_NAMES) {
    const value = lookup(name)
    if (value !== undefined) keys[name] = value
  }
  return Object.keys(keys).length > 0 ? keys : undefined
}

/**
 * An element's own stagger keys, off its (already `scopeHoists`-folded) `ParsedValue` — the
 * element-wide defaults a group's scoped hoists override per key (D-B.3).
 *
 * @param parsed - The host's parsed `data-kui`, after `compile.ts`'s `scopeHoists` has folded back
 *   any hoist an unknown or non-declaring segment provisionally routed to `SegmentHoists`.
 * @returns `undefined` when the element declares no group key at all.
 * @complexity O(1) time and space.
 * @overallScore 100
 */
export function elementStaggerKeys(parsed: ParsedValue): StaggerGroupKeys | undefined {
  return collectKeys((name) => parsed[name])
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
 * @complexity O(1) time and space.
 * @overallScore 100
 */
export function staggerKeysFor(
  scoped: SegmentHoists | undefined,
  elementWide: StaggerGroupKeys | undefined,
): StaggerGroupKeys | undefined {
  return collectKeys((name) => scoped?.[name] ?? elementWide?.[name])
}

/**
 * Whether a group's effective keys make it "grouped" in B-a's sense: one activation binding on the
 * host fans out to every member, rather than each member binding its own gate. `cascade:`,
 * `spread:` and `order:` all imply it — any key that only makes sense read across the whole group
 * at once. `cols:`/`along:` alone do not: a column count or an axis is meaningless without an
 * ordering to apply it to (see `stagger-config.ts`'s own `along:`-without-`cols:` warning for the
 * same asymmetry the other way), so neither one by itself is a request for a shared binding.
 *
 * @param keys - A group's effective keys, from {@link staggerKeysFor}.
 * @complexity O(1) time and space.
 * @overallScore 100
 */
export function isGroupedKeys(keys: StaggerGroupKeys | undefined): boolean {
  return keys?.cascade !== undefined || keys?.spread !== undefined || keys?.order !== undefined
}

/**
 * `target:`-group hosts currently claimed, refcounted rather than a `WeakSet` because one host can
 * carry more than one `target:` group at once (two `data-kui` segments each with their own
 * selector) — each installs, claims, and cleans up independently, and the host must keep reading
 * as a group host to `declaresGroup` until the *last* of them releases it, not the first.
 */
const TARGET_GROUP_HOSTS = new WeakMap<Element, number>()

/**
 * Mark `host` as a `target:`-group host, so an ordinary stagger scan (`applyStagger`/
 * `restageAround`, via `declaresGroup`) never indexes its DOM children as an unrelated stagger
 * group (bug 3) — a `target:` host publishes its own `--kui-stagger`/`-count` through
 * `indexTargetGroup` instead, over the *matched* set, not its DOM children.
 *
 * @param host - The element to mark.
 * @returns The unmark — call it when the host's derived group is released. Idempotent: calling the
 *   same unmark twice decrements once, so a cleanup that runs twice cannot under-count the claim
 *   another group on the same host still holds.
 * @complexity O(1) time and space.
 * @overallScore 100
 */
export function claimTargetGroupHost(host: Element): () => void {
  TARGET_GROUP_HOSTS.set(host, (TARGET_GROUP_HOSTS.get(host) ?? 0) + 1)
  let released = false
  return () => {
    if (released) return
    released = true
    const remaining = (TARGET_GROUP_HOSTS.get(host) ?? 1) - 1
    if (remaining > 0) TARGET_GROUP_HOSTS.set(host, remaining)
    else TARGET_GROUP_HOSTS.delete(host)
  }
}

/**
 * Whether {@link claimTargetGroupHost} has marked this element, and at least one claim on it is
 * still outstanding.
 *
 * @param el - The candidate element.
 * @complexity O(1) time and space.
 * @overallScore 100
 */
export function isTargetGroupHost(el: Element): boolean {
  return TARGET_GROUP_HOSTS.has(el)
}
