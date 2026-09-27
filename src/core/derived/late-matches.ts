import { ATTR } from '../attrs.js'
import type { CompiledTarget } from '../compile.js'
import { claimMatches, installDerivedMatches, restageTargets } from './install.js'
import type { AnimatorPort, LiveTargetGroup, ResolvedGroup } from './types.js'

/**
 * Owned by phase 6 — C(a)'s "late inserts for `scope:'self'`" rule. A `target:` host does not
 * re-scan the whole document on every mutation; instead, when a node is inserted under
 * `observe:true`, every bounded ancestor with a live `scope:'self'` group gets a chance to claim
 * only the *new* matches it did not have before, then re-index.
 */

/** How far up from a newly-inserted node this module walks looking for a live `target:` host —
 *  the same value as `diagnostics.ts`'s own (private) `ANCESTOR_WALK_BOUND`, chosen independently
 *  here since that constant is not exported, but for the identical reason: a page is rarely nested
 *  this deep, so the bound only ever bites a pathological tree, not a real one. */
const ANCESTOR_WALK_BOUND = 64

/**
 * Every element `node`'s insertion could have newly introduced into `host`'s `scope:'self'` query
 * for `target.selector` — `node` itself, when it matches (`querySelectorAll` never returns the
 * element it is called on, so this has to be checked separately), plus its own matching
 * descendants. Nothing outside `node`'s own subtree could be new: everything else was already part
 * of the document `host`'s groups resolved against at install (or a previous adoption).
 *
 * Excludes anything 7a/7b stamped as a library-owned part (`ATTR.part`) — an injected control (the
 * flip-card button, an icon's generated child) must never itself be adopted as a `target:` match,
 * no matter what selector it happens to satisfy. `host.contains`/`!== host` mirror `queryScoped`'s
 * own scoping (`target.ts`) for the elements this walk could otherwise never produce anyway, since
 * `node` only ever reaches this function already known to sit under `host`.
 *
 * @complexity O(n) time and space in `node`'s own subtree size (the query itself is the DOM's).
 * @overallScore 100
 */
function newMatchesFor(node: Element, host: Element, target: CompiledTarget): Element[] {
  const candidates: Element[] = [...node.querySelectorAll(target.selector)]
  if (node.matches(target.selector)) candidates.unshift(node)
  return candidates.filter((el) => host.contains(el) && el !== host && !el.hasAttribute(ATTR.part))
}

/**
 * Resolve every one of `host`'s live groups against `node`'s own subtree, keeping a `scope:'self'`
 * group's new matches (a `scope:'page'` match can sit anywhere in the document, so a bounded
 * ancestor walk from one insertion point is never how it is meant to be found — it is left for a
 * future full rescan, not adopted here). Also snapshots every group's current member count: the
 * caller needs it to tell, after `installDerivedMatches` has run, which of a group's members just
 * arrived.
 *
 * @complexity O(g) time in the host's live group count, plus each group's own subtree query;
 *   O(g) space.
 * @overallScore 100
 */
function resolveNewGroups(
  node: Element,
  host: Element,
  groups: LiveTargetGroup[],
): { resolved: ResolvedGroup[]; before: Map<LiveTargetGroup, number> } {
  const resolved: ResolvedGroup[] = []
  const before = new Map<LiveTargetGroup, number>()
  for (const group of groups) {
    before.set(group, group.members.length)
    if (group.target.scope !== 'self') continue
    const matches = newMatchesFor(node, host, group.target)
    if (matches.length > 0) resolved.push({ target: group.target, matches })
  }
  return { resolved, before }
}

/** Where in `members` a newly-adopted block belongs, keeping the array in document order —
 *  the first existing member `anchor` precedes, or the end when none does. */
function insertionIndex(members: Element[], anchor: Element): number {
  const index = members.findIndex((existing) => Boolean(existing.compareDocumentPosition(anchor) & Node.DOCUMENT_POSITION_PRECEDING))
  return index === -1 ? members.length : index
}

/** True once any of a grouped group's *existing* members (everything but `added`) has moved off
 *  `'ready'` — the signal that its one-shot binding already fired and will never fire again on its
 *  own. A toggle simply fires again later and picks `added` up itself, since `bindGroups` reads
 *  `group.members` live — that case never needs this. */
function hasAlreadyFired(port: AnimatorPort, group: LiveTargetGroup, added: Element[]): boolean {
  return group.members.some((member) => !added.includes(member) && port.stateOf(member)?.status !== 'ready')
}

/** Start a grouped group's newly-adopted members immediately when {@link hasAlreadyFired} — the
 *  one case a group binding's own "reads `group.members` live" behaviour cannot reach on its own.
 *  A no-op for an ungrouped group (`gateOwner` unset): each of its members bound its own gate at
 *  install, through the ordinary `openGate` path, exactly as `installDerivedMatches` just ran. */
function activateIfAlreadyFired(port: AnimatorPort, group: LiveTargetGroup, added: Element[]): void {
  if (group.gateOwner === undefined) return
  if (hasAlreadyFired(port, group, added)) for (const member of added) port.activateOne(member)
}

/**
 * Move one group's just-appended tail — what `installDerivedMatches`'s own `recordClaim` pushed on
 * (in claim order, but always at the *end* of `members`, regardless of where the match actually
 * sits in the document) — to its correct document-order position, then activate it immediately if
 * the group's binding already fired. A no-op when this group gained no members this call.
 *
 * @complexity O(m) time in the group's member count (the reinsertion scan); O(1) space.
 * @overallScore 100
 */
function reindexGroup(port: AnimatorPort, group: LiveTargetGroup, before: number): void {
  if (group.members.length === before) return
  const added = group.members.splice(before)
  // Always present: `group.members.length` just grew past `before`, so at least one element was
  // spliced off into `added`.
  group.members.splice(insertionIndex(group.members, added[0]!), 0, ...added)
  activateIfAlreadyFired(port, group, added)
}

/**
 * Claim and install `node`'s newly-matched elements into one live `target:` host, then re-index
 * every group that gained a member. A no-op when `host` has no live groups at all (an ordinary DOM
 * ancestor, not a `target:` host), or none of its `scope:'self'` groups matched anything new, or
 * every candidate match was rejected by the collision rules (`claimMatches`, D-D — e.g. already
 * claimed by another host).
 *
 * Reuses 2a's own `claimMatches`/`installDerivedMatches` rather than a parallel implementation: a
 * late-inserted match is subject to exactly the same collision rules and the same install path as
 * one resolved at the host's initial install.
 *
 * @complexity O(g * m) time in `host`'s live group count and matches per group; O(g + m) space.
 * @overallScore 100
 */
function adoptIntoHost(port: AnimatorPort, node: Element, host: Element): void {
  const groups = port.book.groups.get(host)
  const context = port.book.contexts.get(host)
  if (!groups || !context) return
  const { resolved, before } = resolveNewGroups(node, host, groups)
  if (resolved.length === 0) return
  const claims = claimMatches(port, host, resolved)
  if (claims.size === 0) return
  installDerivedMatches(port, context, claims)
  // Always present: `resolveNewGroups` snapshotted every group in `groups`, unconditionally.
  for (const group of groups) reindexGroup(port, group, before.get(group)!)
  restageTargets(port, host)
}

/**
 * C(a): a node was inserted under `observe:true`. Walk its ancestors (bounded) for a live
 * `target:` host with `scope:'self'` groups, and for each, claim and install only matches it did
 * not already have, then restage. Never re-processes a host: one straight-line ancestor walk from
 * `node.parentElement` visits each ancestor at most once.
 *
 * `node` itself is skipped outright when it carries `ATTR.part`: 7a's injected flip-card control
 * (and any other library-injected part) must never itself be adopted as a `target:` match, no
 * matter what selector it happens to satisfy.
 *
 * @param port - The animator's narrow window.
 * @param node - The newly inserted element.
 * @complexity O(d * g * m) time in the walk depth (bounded by `ANCESTOR_WALK_BOUND`), each
 *   ancestor's live group count, and each group's match count; O(1) space beyond what each host's
 *   own reindex retains.
 * @overallScore 100
 */
export function adoptLateMatches(port: AnimatorPort, node: Element): void {
  if (node.hasAttribute(ATTR.part)) return
  let ancestor = node.parentElement
  let depth = 0
  while (ancestor && depth < ANCESTOR_WALK_BOUND) {
    adoptIntoHost(port, node, ancestor)
    ancestor = ancestor.parentElement
    depth++
  }
}
