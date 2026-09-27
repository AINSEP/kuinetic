import type { AnimatorPort, DerivedInstallContext, InstallRequest, ResolvedGroup } from './types.js'
import type { CompiledTarget } from '../compile.js'

/**
 * Owned by phase 2a — the derived-host install path, entered from `Animator.install` whenever a
 * host's compiled document carries at least one non-empty-selector `target:` group. Everything a
 * `target:` host needs beyond an ordinary install: resolving each group's matches, applying the
 * collision rules (D-D), installing every claimed match as its own derived state, and stamping the
 * host itself last (either its own group, via `port.install`, or — with no own group — as a
 * zero-instance aggregate, via `port.installAggregate`).
 *
 * SKELETON STUB (§1): every body below falls straight through to HEAD behaviour (`installWithTargets`
 * returns `false`, so `Animator.install` runs its existing, un-derived path) or is a no-op. Real
 * bodies land with 2a — see `target-phases-2-9.md`.
 */

/**
 * Install `request.el` the derived-host way, when its compiled document has at least one
 * non-empty-selector `target:` group.
 *
 * @param port - The animator's narrow window (see `AnimatorPort`).
 * @param request - The would-be host's install request.
 * @returns `true` when this function handled the install and the caller should return without
 *   running its own body; `false` to fall through to the ordinary, un-derived install path.
 * STUB: always `false` — every `target:` host installs through HEAD's existing path until 2a lands.
 * @complexity O(1) time and space.
 * @overallScore 100
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- stub: params unused until 2a fills this in
export function installWithTargets(port: AnimatorPort, request: InstallRequest): boolean {
  return false
}

/**
 * Release a derived-host's bookkeeping, called at the very start of `Animator.release(el)`, before
 * `el`'s own teardown runs. For a host: release every one of its derived matches first (via
 * `port.release`), then run its `book.cleanups`, then drop its own book entries. For a derived
 * match: unlink it from its host's `derived` set and the owning group's `members`, and delete its
 * `book.hosts` entry. Must never touch (write to, or restore) the *host's* own ledgers on behalf of
 * a match — a match's writes live on its own ledgers, opened when it was installed.
 *
 * @param port - The animator's narrow window.
 * @param el - The element being released — a host, a derived match, or neither.
 * STUB: no-op — there is no book to release from until 2a starts writing one.
 * @complexity O(1) time and space.
 * @overallScore 100
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- stub: params unused until 2a fills this in
export function releaseDerived(port: AnimatorPort, el: Element): void {}

/**
 * Called once at the end of `Animator.releaseTree`, after every removed candidate in the batch has
 * had its own teardown run. Re-indexes (`restageTargets`) every surviving host that lost one or
 * more derived matches in this removal — the derived-host analogue of `restageAfterRemoval` for
 * ordinary stagger groups.
 *
 * @param port - The animator's narrow window.
 * @param removed - Every element `releaseTree` visited while tearing down one removal batch.
 * STUB: no-op.
 * @complexity O(1) time and space.
 * @overallScore 100
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- stub: params unused until 2a fills this in
export function restageAfterTreeRelease(port: AnimatorPort, removed: Element[]): void {}

/**
 * Apply the collision rules (D-D) over one host's resolved `target:` groups, deciding which
 * matched elements this host is actually allowed to claim.
 *
 * A match is skipped, with a warning naming the selector and the group's effects, when it is the
 * host itself, when it already carries its own `data-kui` (an authored element animates itself,
 * never a host's group), or when another host has already claimed it. A match this same host has
 * already claimed under an earlier group in the same resolution is skipped silently — that is the
 * ordinary "one element, several groups" case `compileUnion` exists for, not a collision.
 *
 * @param port - The animator's narrow window.
 * @param host - The element whose `target:` groups are being resolved.
 * @param groups - Every non-empty-selector group's `CompiledTarget` and its resolved matches.
 * @returns Each claimed match mapped to every group of *this* host that claims it, in authored
 *   group order; the map's own iteration order is document order.
 * STUB: `new Map()` — nothing is ever claimed until 2a lands.
 * @complexity O(1) time and space.
 * @overallScore 100
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- stub: params unused until 2a fills this in
export function claimMatches(port: AnimatorPort, host: Element, groups: ResolvedGroup[]): Map<Element, CompiledTarget[]> {
  return new Map()
}

/**
 * Install every claimed match as its own derived host — a single group installs directly, two or
 * more recompile through `compileUnion` first — and record the result in `port.book` (the host's
 * `derived` set, each match's `hosts` entry, and the owning group's `members`).
 *
 * Used both by `installWithTargets` (the initial install) and by phase 6's `adoptLateMatches` (a
 * late-inserted match joining an already-live group).
 *
 * @param port - The animator's narrow window.
 * @param context - The host's derived-install context (fingerprint, parsed value, base config).
 * @param claims - `claimMatches`'s output: each match to install, and which of the host's groups
 *   claim it.
 * @returns The matches actually installed, in document order.
 * STUB: `[]` — nothing is ever installed until 2a lands.
 * @complexity O(1) time and space.
 * @overallScore 100
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- stub: params unused until 2a fills this in
export function installDerivedMatches(port: AnimatorPort, context: DerivedInstallContext, claims: Map<Element, CompiledTarget[]>): Element[] {
  return []
}

/**
 * Re-run `indexTargetGroup` for every one of a host's live `target:` groups, over its *current*
 * members — each match's own `--kui-i` through its own ledger, the host's `--kui-stagger`/
 * `-count` through the host's. Called whenever a group's membership changes after its initial
 * install: a late adoption (phase 6) or a removal (`restageAfterTreeRelease`).
 *
 * @param port - The animator's narrow window.
 * @param host - The `target:` host to re-index.
 * STUB: no-op.
 * @complexity O(1) time and space.
 * @overallScore 100
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- stub: params unused until 2a fills this in
export function restageTargets(port: AnimatorPort, host: Element): void {}
