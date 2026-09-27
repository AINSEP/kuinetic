import type { AnimatorPort, DerivedInstallContext } from './types.js'
import type { CompiledTarget } from '../compile.js'

/**
 * Owned by phase 2b — an aggregate host's status (D-A) and multi-group union compilation. A host
 * with no own `target:`-less group has no instances of its own (`installAggregate`), so its
 * `data-kui-state` is derived entirely from its derived matches'; and a match claimed by two or
 * more of the same host's groups recompiles as one union rather than installing twice.
 *
 * SKELETON STUB (§1): both bodies are no-ops/pass-throughs so a multi-group claim behaves as if
 * only its first claiming group existed, and no aggregate host's status is ever touched. Real
 * bodies land with 2b — see `target-phases-2-9.md`.
 */

/**
 * Recompute an aggregate host's `data-kui-state` from its derived matches' own states (D-A):
 * `'running'` (+ host `kui:start`('activated')) when any derived match is running; `'finished'`
 * (+ host `kui:finish`('complete', or `'reduced-motion'` if the host never ran any match; no event
 * at all if every match was cancelled)) once every match has settled to `'finished'`/`'failed'`;
 * back to `'ready'` (no event) if every match has been reset to `'ready'`. Idempotent, and a no-op
 * for any host whose own state is not `aggregate: true`, or that `port.stateOf` does not (yet)
 * know about.
 *
 * @param port - The animator's narrow window.
 * @param host - The candidate aggregate host.
 * STUB: no-op — no host is ever marked `aggregate: true` until 2a installs one, so this has
 * nothing to read yet either way.
 * @complexity O(1) time and space.
 * @overallScore 100
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- stub: params unused until 2b fills this in
export function syncAggregate(port: AnimatorPort, host: Element): void {}

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
 * STUB: the first claiming group wins outright — no union is ever compiled, so a match claimed by
 * several groups behaves as if only the first one claimed it, until 2b lands.
 * @complexity O(1) time and space.
 * @overallScore 100
 */
export function compileUnion(port: AnimatorPort, context: DerivedInstallContext, targets: CompiledTarget[]): CompiledTarget {
  return targets[0]!
}
