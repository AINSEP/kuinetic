import type { AnimatorPort, DerivedInstallContext } from './types.js'
import type { CompiledTarget } from '../compile.js'
import type { InstanceState } from '../types.js'

/**
 * Owned by phase 3b — B-a's "one host binding when grouped" rule. A `target:` group whose
 * effective stagger keys carry `cascade:`/`spread:`/`order:` is read across the whole group at
 * once, so it gets one activation binding on the *host* that fans out to every member in document
 * order, instead of each member independently binding its own gate the way an ordinary derived
 * match does.
 *
 * SKELETON STUB (§1): every group behaves as ungrouped (`groupGateOwner` never names a host,
 * `skipsOwnBinding` never skips), and no group binding is ever installed. Real bodies land with
 * 3b — see `target-phases-2-9.md`.
 */

/**
 * The gate owner for one derived group: the host itself, when the group's effective stagger keys
 * are grouped (`isGroupedKeys`); `undefined` otherwise, meaning each member binds its own gate as
 * an ordinary derived install would.
 *
 * @param port - The animator's narrow window.
 * @param context - The host's derived-install context.
 * @param target - The group being installed.
 * STUB: always `undefined` — no group is ever grouped until 3a's `isGroupedKeys` is real and 3b
 * reads it.
 * @complexity O(1) time and space.
 * @overallScore 100
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- stub: params unused until 3b fills this in
export function groupGateOwner(port: AnimatorPort, context: DerivedInstallContext, target: CompiledTarget): Element | undefined {
  return undefined
}

/**
 * Whether `Animator.openGate` must skip binding this (deferred-gate) element's own activation,
 * because a grouped derived match's gate is owned by its host instead (`groupGateOwner`) —
 * `state.gateOwner` names that host.
 *
 * @param state - The element's instance state.
 * STUB: always `false` — no state ever carries `gateOwner` until 3b lands, so every element still
 * binds its own gate exactly as HEAD does.
 * @complexity O(1) time and space.
 * @overallScore 100
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- stub: param unused until 3b fills this in
export function skipsOwnBinding(state: InstanceState): boolean {
  return false
}

/**
 * Install one activation binding on `host` per grouped live `target:` group, activating (and, for
 * a paired exit, deactivating) every member in document order through `port.activateOne`/
 * `port.deactivateOne` rather than each member's own gate. Registers its own release in
 * `port.book.cleanups` so the binding is torn down when the host is released.
 *
 * @param port - The animator's narrow window.
 * @param host - The `target:` host whose live groups may need a group binding.
 * STUB: no-op — there is nothing to bind until 2a records live groups and 3a can tell a grouped
 * group from an ungrouped one.
 * @complexity O(1) time and space.
 * @overallScore 100
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- stub: params unused until 3b fills this in
export function bindGroups(port: AnimatorPort, host: Element): void {}
