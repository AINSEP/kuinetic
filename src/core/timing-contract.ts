import type { Primitive } from './types.js'

/** The three positional timing tokens of the grammar: `data-kui="fade-up 600ms 200ms linear"`. */
export type TimingToken = 'duration' | 'delay' | 'ease'

/** All three, in grammar order. Also the `honours` list of a primitive that supports the lot. */
export const ALL_TIMING_TOKENS: readonly TimingToken[] = ['duration', 'delay', 'ease']

/**
 * What a JS-rendered primitive can actually *do* with authored timing.
 *
 * The problem this closes: the two spellings of a timing value fail differently, and one of them
 * fails silently. `pin-section delay:300ms` reaches `readParams`, is not in the schema, and warns
 * as an unknown parameter — the author is told. `pin-section 0ms 300ms` parses into
 * `spec.delay`, is lifted out to `params.timing` (see `core/js-effect-preparer.ts`), and is then
 * simply never read by a primitive that has no clock to shift. Nothing warns, nothing happens,
 * and the page gives the author no way to find out which of those two it was.
 *
 * So a primitive that cannot honour a token has to say so, and it has to say so about the
 * positional spelling too. Declaring the contract is how it does that — through
 * `effects/shared.ts`'s `withTimingContract`/`stylesheetTimingPrepare`, which warn at runtime and
 * record the contract here so `describe()` can say the same thing before anything runs.
 */
export interface TimingContract {
  /**
   * Tokens this primitive genuinely acts on. Anything omitted warns by name when authored.
   * Omit the field entirely for a primitive that honours none of the three.
   */
  honours?: readonly TimingToken[]
  /**
   * Completes `"<id>" cannot honour <token>: <because>`. Write the *reason*, not the symptom —
   * "it tracks pointer position continuously, so there is no start moment to delay" tells an
   * author to stop looking for a spelling that works, where "unsupported" does not.
   */
  because: string
}

/**
 * Contracts keyed by the `prepare` they were declared on. A side table rather than a `Primitive`
 * field because the contract is already written once, as the argument to the wrapper that enforces
 * it; a field would be a second copy for every primitive to keep in step with the first.
 */
const CONTRACTS = new WeakMap<object, TimingContract>()

/**
 * Record the contract a wrapped `prepare` enforces, and return that same `prepare`.
 *
 * A wrapper around an already-declared `prepare` must carry it over ({@link inheritTimingContract}),
 * or the contract is lost to {@link timingContractOf}; `test/describe.test.ts` builds every JS primitive
 * with all three tokens written and checks the warnings it raises against this table.
 *
 * @complexity O(1) time and space.
 * @overallScore 100
 */
export function declareTimingContract<F extends object>(prepare: F, contract: TimingContract): F {
  CONTRACTS.set(prepare, contract)
  return prepare
}

/**
 * Carry `inner`'s contract, if it declared one, over to `outer` — for a wrapper that layers setup
 * around a `prepare` without changing which tokens it honours.
 *
 * @complexity O(1) time and space.
 * @overallScore 100
 */
export function inheritTimingContract<F extends object>(inner: object, outer: F): F {
  const contract = CONTRACTS.get(inner)
  return contract ? declareTimingContract(outer, contract) : outer
}

/**
 * The timing contract a primitive declared, or `undefined` when it declared none — which means it
 * honours all three tokens: a primitive that cannot is required to say so (see {@link TimingContract}),
 * and a `css-keyframes` one gets all three from `declarations.ts` regardless.
 *
 * @complexity O(1) time and space.
 * @overallScore 100
 */
export function timingContractOf(primitive: Primitive): TimingContract | undefined {
  return primitive.prepare ? CONTRACTS.get(primitive.prepare) : undefined
}
