import { compileTargets } from '../compile.js'
import type { CompiledTarget } from '../compile.js'
import { gateMatches } from '../breakpoints.js'
import { KUI_EVENT } from '../control.js'
import type { InstanceState } from '../types.js'
import { derivedOf } from './book.js'
import type { AnimatorPort, DerivedInstallContext } from './types.js'

/**
 * Owned by phase 2b — an aggregate host's status (D-A) and multi-group union compilation. A host
 * with no own `target:`-less group has no instances of its own (`installAggregate`), so its
 * `data-kui-state` is derived entirely from its derived matches'; and a match claimed by two or
 * more of the same host's groups recompiles as one union rather than installing twice.
 */

/** A derived match currently running its entrance, not merely reversing back out. */
function isForwardRunning(state: InstanceState): boolean {
  return state.status === 'running' && state.direction !== 'reverse'
}

function isRunning(state: InstanceState): boolean {
  return state.status === 'running'
}

function isFailed(state: InstanceState): boolean {
  return state.status === 'failed'
}

function isSettled(state: InstanceState): boolean {
  return state.status === 'finished' || state.status === 'failed'
}

function isReady(state: InstanceState): boolean {
  return state.status === 'ready'
}

/**
 * A host's derived matches' own states, host itself excluded and any match not (yet) installed
 * dropped — `book.derived` and `stateOf` can disagree for one tick around install/release.
 */
function matchStates(port: AnimatorPort, host: Element): InstanceState[] {
  const states: InstanceState[] = []
  for (const match of derivedOf(port.book, host)) {
    const state = port.stateOf(match)
    if (state) states.push(state)
  }
  return states
}

/** Any derived running → host running, guarded so a second running match never re-fires the
 *  start the first one already raised. */
function applyRunning(port: AnimatorPort, host: Element, hostState: InstanceState, states: InstanceState[]): void {
  if (hostState.status === 'running') return
  port.writeStatus(host, hostState, 'running')
  if (states.some(isForwardRunning)) port.emit(host, hostState, KUI_EVENT.start, 'activated')
}

/** Every derived settled (`finished`/`failed`, at least one not `failed`) → host `finished`,
 *  guarded the same way `applyRunning` is so a later derived settling does not re-fire the event. */
function applyFinished(port: AnimatorPort, host: Element, hostState: InstanceState, states: InstanceState[]): void {
  if (hostState.status === 'finished') return
  const wasRunning = hostState.status === 'running'
  port.writeStatus(host, hostState, 'finished')
  if (states.every((state) => state.cancelled === true)) return
  port.emit(host, hostState, KUI_EVENT.finish, wasRunning ? 'complete' : 'reduced-motion')
}

/**
 * Recompute an aggregate host's `data-kui-state` from its derived matches' own states (D-A):
 * `'running'` (+ host `kui:start`('activated')) when any derived match is running; `'finished'`
 * (+ host `kui:finish`('complete', or `'reduced-motion'` if the host never ran any match; no event
 * at all if every match was cancelled)) once every match has settled to `'finished'`/`'failed'`;
 * back to `'ready'` (no event) if every match has been reset to `'ready'`. Idempotent, and a no-op
 * for any host whose own state is not `aggregate: true`, or that `port.stateOf` does not (yet)
 * know about.
 *
 * Checked in this order because the cases overlap: "any running" must win over "all failed" (a
 * mix of running and failed is still running), and "all failed" must win over "all finished |
 * failed" (a `failed`-only host reports `'failed'`, never a `kui:finish`). Any other mix — some
 * settled, some still `ready` — leaves the host exactly where it was, per D-A: an aggregate host
 * stays `running` until its last off-screen match finishes, however long that takes.
 *
 * @param port - The animator's narrow window.
 * @param host - The candidate aggregate host.
 * @complexity O(m) time in the host's derived match count; O(1) space.
 * @overallScore 100
 */
export function syncAggregate(port: AnimatorPort, host: Element): void {
  const hostState = port.stateOf(host)
  if (!hostState || !hostState.aggregate) return
  const states = matchStates(port, host)
  if (states.length === 0) return
  if (states.some(isRunning)) {
    applyRunning(port, host, hostState, states)
  } else if (states.every(isFailed)) {
    port.writeStatus(host, hostState, 'failed')
  } else if (states.every(isSettled)) {
    applyFinished(port, host, hostState, states)
  } else if (states.every(isReady)) {
    port.writeStatus(host, hostState, 'ready')
  }
}

/** The union cache key — order-independent, so the same group combination claimed in either
 *  authored order reuses one compile. */
function unionKey(targets: CompiledTarget[]): string {
  return targets
    .map((target) => `${target.scope} ${target.selector}`)
    .sort((a, b) => a.localeCompare(b))
    .join('\u0001')
}

/**
 * Compile one union group for a match claimed by two or more `target:` groups of the same host, so
 * `resolveComposition`'s conflict detection runs over the combined spec list exactly as it would
 * for a hand-written comma list on that element — a match must never see two groups' effects as
 * unrelated just because they arrived through different selectors. Cached in `port.book.unions`,
 * keyed by the sorted, `\u0001`-joined `${scope} ${selector}` list, so a second match claimed by
 * the same group combination reuses the compile. Folds the host's own `rm:` policy in (a union
 * belongs to no single authored segment to read it from). Reports its own warnings once per host,
 * not once per match.
 *
 * @param port - The animator's narrow window.
 * @param context - The host's derived-install context — what the union recompiles the timeline
 *   against.
 * @param targets - Every group claiming the match, in authored group order.
 * @returns The compiled union target.
 * @complexity O(e * p) time in the combined spec/parameter count on a cache miss, O(1) on a hit;
 *   O(e) space for the freshly compiled target.
 * @overallScore 100
 */
export function compileUnion(port: AnimatorPort, context: DerivedInstallContext, targets: CompiledTarget[]): CompiledTarget {
  const key = unionKey(targets)
  const cache = port.book.unions.get(context.host)
  const cached = cache?.get(key)
  if (cached) return cached

  const first = targets[0]!
  const compiled = compileTargets(
    { specs: targets.flatMap((target) => target.specs), warnings: [] },
    port.registry,
    context.timeline,
  )
  const union = compiled.targets[0]!
  // The recompile has no `rm:` of its own to read — a union belongs to no single authored
  // segment — so it borrows the policy every claiming group already agreed on element-wide.
  union.plan.reducedMotion = first.plan.reducedMotion
  // `process()` already filtered the claiming groups' own `plan.jsEffects` against the viewport at
  // install time; this fresh compile has not, so the gate has to be re-applied here or a JS effect
  // gated off on this viewport would run anyway once it lands inside a union.
  const win = context.host.ownerDocument?.defaultView ?? undefined
  union.plan.jsEffects = union.plan.jsEffects.filter((entry) => gateMatches(entry.spec.gate, win))

  const known = new Set(targets.flatMap((target) => target.plan.warnings))
  for (const warning of union.plan.warnings) {
    if (!known.has(warning)) port.reporter.warn(warning, context.host)
  }

  const result: CompiledTarget = { ...union, selector: first.selector, scope: first.scope }
  const unions = cache ?? new Map<string, CompiledTarget>()
  unions.set(key, result)
  if (!cache) port.book.unions.set(context.host, unions)
  return result
}
