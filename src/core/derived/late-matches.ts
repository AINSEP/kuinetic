import type { AnimatorPort } from './types.js'

/**
 * Owned by phase 6 — C(a)'s "late inserts for `scope:self`" rule. A `target:` host does not
 * re-scan the whole document on every mutation; instead, when a node is inserted under
 * `observe:true`, every bounded ancestor with a live `scope:'self'` group gets a chance to claim
 * only the *new* matches it did not have before, then re-index.
 *
 * SKELETON STUB (§1): no-op — nothing is ever adopted, matching HEAD (which has no `target:`
 * derived hosts at all yet, so there is nothing for a late insert to join). Real body lands with
 * 6 — see `target-phases-2-9.md`.
 */

/**
 * C(a): a node was inserted under `observe:true`. Walk its ancestors (bounded) for a live
 * `target:` host with `scope:'self'` groups, and for each, claim and install only matches it did
 * not already have, then restage. Never re-processes a host already visited in the same walk.
 *
 * @param port - The animator's narrow window.
 * @param node - The newly inserted element.
 * STUB: no-op.
 * @complexity O(1) time and space.
 * @overallScore 100
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- stub: params unused until 6 fills this in
export function adoptLateMatches(port: AnimatorPort, node: Element): void {}
