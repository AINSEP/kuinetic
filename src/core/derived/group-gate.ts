import { isOneShot, resolveActivationSpec } from '../activation.js'
import { planStyles } from '../style-plan.js'
import { elementStaggerKeys, isGroupedKeys, staggerKeysFor } from '../stagger-keys.js'
import type { AnimatorPort, DerivedInstallContext, LiveTargetGroup } from './types.js'
import type { CompiledTarget } from '../compile.js'
import type { InstanceState } from '../types.js'

/**
 * Owned by phase 3b — B-a's "one host binding when grouped" rule. A `target:` group whose
 * effective stagger keys carry `cascade:`/`spread:`/`order:` is read across the whole group at
 * once, so it gets one activation binding on the *host* that fans out to every member in document
 * order, instead of each member independently binding its own gate the way an ordinary derived
 * match does.
 */

/**
 * The gate owner for one derived group: the host itself, when the group's effective stagger keys
 * are grouped (`isGroupedKeys`); `undefined` otherwise, meaning each member binds its own gate as
 * an ordinary derived install would.
 *
 * The effective keys follow the same "each key decided on its own" rule the rest of `target:`
 * uses: the group's own scoped hoists (`target.hoists`) override the host's element-wide keys
 * per key, via {@link staggerKeysFor}/{@link elementStaggerKeys} — the identical recipe
 * `restageTargets` uses to index the group, so a group that reads as "grouped" for stagger
 * indexing reads as "grouped" for gating too.
 *
 * @param port - The animator's narrow window. Unused: the decision only needs the group's own
 *   keys, not anything the animator itself knows — kept in the signature for parity with every
 *   other derived-host module function, all of which take it.
 * @param context - The host's derived-install context.
 * @param target - The group being installed.
 * @complexity O(1) time and space.
 * @overallScore 100
 */
export function groupGateOwner(port: AnimatorPort, context: DerivedInstallContext, target: CompiledTarget): Element | undefined {
  const keys = staggerKeysFor(target.hoists, elementStaggerKeys(context.parsed))
  return isGroupedKeys(keys) ? context.host : undefined
}

/**
 * Whether `Animator.openGate` must skip binding this (deferred-gate) element's own activation,
 * because a grouped derived match's gate is owned by its host instead (`groupGateOwner`) —
 * `state.gateOwner` names that host.
 *
 * `openGate` only ever reaches this check once it has already established `stylePlan.gate ===
 * 'deferred'` (see `animator.ts`), so this needs no gate check of its own: `gateOwner` being set
 * at all is sufficient.
 *
 * @param state - The element's instance state.
 * @complexity O(1) time and space.
 * @overallScore 100
 */
export function skipsOwnBinding(state: InstanceState): boolean {
  return state.gateOwner !== undefined
}

/**
 * Start every member of a grouped `target:` group, in document order, through `port.activateOne`
 * — never through a member's own gate, which {@link skipsOwnBinding} has already suppressed.
 *
 * Reads `group.members` live on every call rather than a snapshot captured at bind time: Phase 6
 * can splice a late-inserted member into that same array after this binding was installed, and
 * the next fire must reach it too.
 *
 * A one-shot activation (`enter`, no exit half) only starts members still `'ready'` — a second
 * `activate()` on an already-`finished` CSS instance reverses it (see `Animator.openGate`), so a
 * group binding that fires again after some members finished must skip those rather than replay
 * them backwards. A toggle (`click`/`hover`) legitimately fires more than once and must reach
 * every member each time, finished or not.
 *
 * @param port - The animator's narrow window.
 * @param group - The live group whose members to start.
 * @param oneShot - Whether the group's activation is spent by its first firing.
 * @complexity O(n) time in the group's live member count; O(1) space.
 * @overallScore 100
 */
function activateGroup(port: AnimatorPort, group: LiveTargetGroup, oneShot: boolean): void {
  for (const member of group.members) {
    if (oneShot && port.stateOf(member)?.status !== 'ready') continue
    port.activateOne(member)
  }
}

/**
 * Play every member of a grouped `target:` group back out, through `port.deactivateOne`.
 *
 * @param port - The animator's narrow window.
 * @param group - The live group whose members to reverse.
 * @complexity O(n) time in the group's live member count; O(1) space.
 * @overallScore 100
 */
function deactivateGroup(port: AnimatorPort, group: LiveTargetGroup): void {
  for (const member of group.members) port.deactivateOne(member)
}

/**
 * Record `cleanup` so it runs when `host` is released, creating `host`'s cleanup list the first
 * time one is needed — an ungrouped host, or one whose only groups render natively/immediately,
 * may never otherwise touch `book.cleanups` at all.
 *
 * @param port - The animator's narrow window.
 * @param host - The element whose release should run `cleanup`.
 * @param cleanup - The release to run.
 * @complexity O(1) amortized time; O(1) space.
 * @overallScore 100
 */
function registerCleanup(port: AnimatorPort, host: Element, cleanup: () => void): void {
  const cleanups = port.book.cleanups.get(host) ?? []
  cleanups.push(cleanup)
  port.book.cleanups.set(host, cleanups)
}

/**
 * Bind one grouped `target:` group's activation on `host`, when its style plan actually needs a
 * binding at all (`gate === 'deferred'` — the same check `Animator.openGate` makes per element: a
 * group that renders natively or immediately has nothing to gate). Registers the release with
 * {@link registerCleanup} so the binding is torn down when the host is released. Passes no
 * `cross` — a v1 limitation: a grouped target's `actions:` four-way crossings are not wired up,
 * only the two-way activate/deactivate.
 *
 * @param port - The animator's narrow window.
 * @param host - The group's gate owner.
 * @param group - The live group to (maybe) bind.
 * @complexity O(1) time and space — the fan-out lives in the closures this installs, not here.
 * @overallScore 100
 */
function bindOneGroup(port: AnimatorPort, host: Element, group: LiveTargetGroup): void {
  const stylePlan = planStyles({
    plan: group.target.plan,
    config: group.config,
    capabilities: port.capabilities,
    respectReducedMotion: port.respectReducedMotion,
  })
  if (stylePlan.gate !== 'deferred') return
  // `planStyles` only sets `activation: null` when `gate !== 'deferred'`; the check above
  // guarantees `gate === 'deferred'` here, so this is always real (same reasoning as
  // `animator.ts`'s `openGate`).
  const activation = stylePlan.activation!
  const oneShot = isOneShot(resolveActivationSpec(activation))
  const release = port.binder.bind(host, activation, {
    threshold: group.config.threshold,
    from: group.config.activationSource,
    activate: () => activateGroup(port, group, oneShot),
    deactivate: () => deactivateGroup(port, group),
  })
  registerCleanup(port, host, release)
}

/**
 * Install one activation binding on `host` per grouped live `target:` group, activating (and, for
 * a paired exit, deactivating) every member in document order through `port.activateOne`/
 * `port.deactivateOne` rather than each member's own gate. Registers its own release in
 * `port.book.cleanups` so the binding is torn down when the host is released.
 *
 * Only groups `groupGateOwner` (via 2a) named `host` as the owner of are candidates — `host`'s
 * other live groups, if any, are ungrouped and already bind per-member through the ordinary
 * `openGate` path.
 *
 * @param port - The animator's narrow window.
 * @param host - The `target:` host whose live groups may need a group binding.
 * @complexity O(g) time in the host's live group count (each binding's own fan-out is amortized
 *   into its later `activate`/`deactivate` calls, not this call); O(1) space beyond what each
 *   binding retains.
 * @overallScore 100
 */
export function bindGroups(port: AnimatorPort, host: Element): void {
  const groups = port.book.groups.get(host)
  if (groups === undefined) return
  for (const group of groups) {
    if (group.gateOwner === host) bindOneGroup(port, host, group)
  }
}
