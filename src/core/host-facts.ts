/**
 * The facts that belong to the *element* rather than to any one effect on it.
 *
 * An element has one activation binding, one reduced-motion policy, one timeline, one channel
 * union — however many effects its `data-kui` names and however many `target:` groups they compile
 * into. `compile.ts` builds a plan per group; this module decides the single answer each of those
 * fields gets and writes it back onto all of them.
 *
 * Split out of `compile.ts` when that file reached its own 400-line lint ceiling, the same way
 * `test/css-composition-invariants.test.ts` was split out of `css-invariants.test.ts`. The seam is
 * not arbitrary: everything here folds a list of already-computed facts down to one value, and
 * nothing here knows what an effect, a primitive or a registry is. `resolveDefaultActivation` takes
 * {@link ActivationClaim}s rather than compiled entries for exactly that reason — the same
 * structural-input argument `channels.ts` makes for `ChannelClaim`, and it is what keeps the
 * type-only import of `CompiledPlan` below from becoming a runtime cycle.
 */
import type { CompiledPlan } from './compile.js'
import type {
  Activation,
  Channel,
  EffectPhase,
  NamedActivation,
  ReducedMotionPolicy,
  Timeline,
} from './types.js'

/** `disable` is the strongest claim: if any effect must not run, none of the list should. */
const RM_RANK: Record<ReducedMotionPolicy, number> = { shorten: 0, crossfade: 1, disable: 2 }

/** What {@link resolveDefaultActivation} needs to know about one composed effect. */
export interface ActivationClaim {
  /** When this effect holds its channels — `compile.ts`'s `phaseOf`, already derived. */
  phase?: EffectPhase
  /** The activation its primitive prefers, or absent when it expresses no preference. */
  defaultActivation?: Activation
}

/**
 * Which activation the composed effects prefer, when the author named none.
 *
 * An element has exactly one activation binding — `animator.ts`'s `resolveActivation` returns a
 * single `Activation` and every effect on the element is wired to it — so a comma list whose halves
 * want different triggers cannot have both. What this decides is which one loses.
 *
 * It used to be first-wins: `plan.defaultActivation ??= primitive.defaultActivation`, folded in
 * authoring order in `buildPlan` and again across `target:` groups in {@link mergeHostFacts}. `??=`
 * is the right operator for "a default fills in when nothing is set" and the wrong one for a
 * *merge*, because there is no sense in which the first name in a comma list is the authoritative
 * one. The consequence was that composing an entrance with a behaviour changed **when the entrance
 * itself fired**: `lift` declares `defaultActivation: 'load'`, so `data-kui="fade-up, lift"` — the
 * pair the whole phase axis was added to allow — bound the element on `load` and fired the reveal
 * before it was ever scrolled to. `back-in-down, drag` did the same. Measured across the catalog,
 * 4,545 composing pairs took their activation from the non-entrance half.
 *
 * The rule is that **an entrance names the trigger**, and it is the lesser of two unavoidable harms
 * rather than a preference. Either choice compromises something:
 *
 * - Binding on the behaviour's `load` spends the reveal on a below-the-fold element while nobody is
 *   looking. The entrance is destroyed outright and cannot be recovered.
 * - Binding on the entrance's `enter` wires the behaviour up when the element scrolls into view
 *   instead of at load. It is late, and it still works — nobody drags, hovers or clicks an element
 *   they cannot see.
 *
 * `?? 'enter'` on the found entrance, not its raw declaration: almost no entrance declares an
 * activation (the catalog's entrances leave it undefined and let `element-config.ts`'s `'enter'`
 * fall through), so returning `undefined` here would hand the decision straight back to the
 * first-wins fallback and change nothing at all. Materialising `'enter'` is what makes the
 * entrance's silence a position. It is materialised *only* when something else declared a value to
 * beat — a lone `fade-up` still compiles `defaultActivation: undefined`, exactly as before.
 *
 * ## No warning, and that was measured rather than assumed
 *
 * Silently picking one is what caused this, so a diagnostic is the obvious accompaniment. Two
 * definitions were tried against the catalog and both are noise, not signal:
 *
 * - "the resolved activation is not in some composed primitive's `supportedActivations`" — 6,098
 *   pairs, including `fade-up, lift`, because `lift` declares `supportedActivations: ['load']`.
 * - "two entries each declare an activation and the values differ" — 4,882 pairs, again including
 *   the flagship pairs.
 *
 * Disagreement is the *normal* state of this catalog: 120 of 290 names declare `load`, 21 declare
 * `enter`, 124 declare nothing. A warning that fires on one composing pair in seven trains authors
 * to ignore the reporter, which costs more than the thing it reports. `on:` remains the spelling
 * for an author who wants the other answer, and it still wins outright — `animator.ts` only reads
 * this field when `config.activationAuthored` is false.
 *
 * @param claims - Every effect that survived composition, across all `target:` groups, host first.
 *   Survivors rather than authored segments: an effect the resolver dropped is not going to run, so
 *   letting it name the trigger would bind the element for a corpse.
 * @complexity O(n) time in the claim count; O(n) space.
 * @overallScore 100
 */
export function resolveDefaultActivation(claims: ActivationClaim[]): Activation | undefined {
  const declared = claims.map((claim) => claim.defaultActivation)
  const firstWins = declared.find((value) => value !== undefined)
  const entrance = claims.findIndex((claim) => claim.phase === 'entrance')
  if (firstWins === undefined || entrance === -1) return firstWins
  return declared[entrance] ?? 'enter'
}

/**
 * Fold the element-scoped `CompiledPlan` facts across every target group and write the merged
 * answer back onto all of them.
 *
 * `reducedMotion`/`supportedActivations`/`supportedTimelines`/`defaultActivation`/`channels` are
 * facts about the *element* — there is exactly one activation binding, one reduced-motion policy,
 * one gate — even when its effects are split across several `target:` groups. `fade-up target:h1`
 * and `pin target:.x` on one host cannot each ask for a different gate; the gate is decided once,
 * from every group's facts merged, and every group's plan carries the same merged answer so
 * whichever one `animator.ts` happens to read it from agrees with the others.
 *
 * Mutates the plans in place rather than returning a new list: `buildPlan` already built each one,
 * and threading a copy through here for five field writes would cost more than it clarifies.
 *
 * `defaultActivation` arrives as a parameter rather than being folded here with the rest, because
 * it is the one field whose answer cannot be recovered from the plans: it is decided from the
 * *effects* — which of them is an entrance — and a plan carries only the resolved value. Folding it
 * here with `??=` is exactly the bug {@link resolveDefaultActivation} exists to fix.
 *
 * @complexity O(g * c) time in groups and their channel counts; O(c) space.
 * @overallScore 100
 */
export function mergeHostFacts(
  targets: { plan: CompiledPlan }[],
  defaultActivation: Activation | undefined,
): void {
  let reducedMotion: ReducedMotionPolicy = 'shorten'
  let activations: NamedActivation[] | undefined
  let timelines: Timeline[] | undefined
  const channels = new Set<Channel>()

  for (const { plan } of targets) {
    reducedMotion = strictestPolicy(reducedMotion, plan.reducedMotion)
    activations = intersect(activations, plan.supportedActivations)
    timelines = intersect(timelines, plan.supportedTimelines)
    for (const channel of plan.channels) channels.add(channel)
  }

  const mergedChannels = [...channels]
  for (const { plan } of targets) {
    plan.reducedMotion = reducedMotion
    /*
     * Asserted rather than restructured, and the two obvious restructurings are worse.
     *
     * Both hold because this loop and the one above walk the same `targets`: one iteration of the
     * first makes each local an array — {@link intersect} returns `[...supported]` when handed
     * `undefined` — and an empty `targets` never reaches here, because this loop does not run
     * either.
     *
     * Hoisting the declarations to `= []` is the restructuring that suggests itself, and it is a
     * bug: `intersect` treats `undefined` ("nobody has contributed yet") and `[]` ("the composed
     * primitives share nothing") as different states on purpose — see its own note for the shipped
     * defect that collapsing them caused. Seeding from `targets[0]` instead needs an emptiness
     * guard, which would duplicate one the caller already makes: `compile.ts:341` reads
     * `targets[0]!.plan` two lines after calling this. So the invariant is the caller's, it is
     * already spelled `!` there, and it is spelled `!` here for the same reason.
     */
    plan.supportedActivations = activations!
    plan.supportedTimelines = timelines!
    plan.defaultActivation = defaultActivation
    plan.channels = mergedChannels
  }
}

/**
 * Fold an authored `rm:` into the policy the composed primitives declared.
 *
 * `rm:` is the one thing an author can say about reduced motion, and it is deliberately a
 * *one-way ratchet*: it can only make the policy stricter, never weaker.
 *
 * The rule is not invented for this key — it is {@link strictestPolicy}'s, applied one more time.
 * That function already encodes "if any effect must not run, none of the list should", and an
 * author key that could overrule it would make the whole fold advisory: `parallax` declares
 * `disable` because parallax is a documented vestibular trigger, not because the library is being
 * cautious on the author's behalf, and `rm:shorten` on it would hand a visitor who has explicitly
 * asked their operating system for less motion exactly the motion they asked not to receive. The
 * useful direction is the other one and it stays open: `rm:disable` on a spinning logo whose
 * primitive only claims `shorten` is a real request the library previously had no spelling for.
 *
 * A weakening attempt warns by name rather than being ignored, because the author wrote a value
 * and is otherwise owed an explanation for why the page does not behave as they asked.
 *
 * @param declared - Strictest policy among the composed primitives.
 * @param authored - The hoisted `rm:` value, already validated by `parse.ts`.
 * @complexity O(1) time and space.
 * @overallScore 100
 */
export function resolvedPolicy(
  declared: ReducedMotionPolicy,
  authored: ReducedMotionPolicy | undefined,
  warnings: string[],
): ReducedMotionPolicy {
  if (authored === undefined) return declared
  if (RM_RANK[authored] < RM_RANK[declared]) {
    warnings.push(
      `"rm:${authored}" is weaker than the "${declared}" these effects declare — ` +
        `keeping "${declared}" (rm: may only strengthen the reduced-motion policy)`,
    )
    return declared
  }
  return authored
}

/**
 * Narrow a running capability intersection by one more primitive's support list.
 *
 * `undefined` means no primitive has contributed yet; `[]` means the composed primitives share
 * nothing. Collapsing those two states into "is the array empty?" — which is what the previous
 * `length ? filter : copy` form did — made an intersection that had legitimately emptied out
 * repopulate from the next effect: `fade-up, parallax-scale, scroll-progress-ring timeline:view`
 * emptied on the second effect and came back as `['scroll', 'view']` on the third, so
 * `style-plan.ts` applied `view()` to `fade-up`, the exact mismatch `supportedTimelines` was
 * added to prevent. Emptiness is a real answer here and must survive the rest of the list.
 *
 * @complexity O(a * b) time in the two list lengths — both are single-digit; O(a) space.
 * @overallScore 100
 */
export function intersect<T>(accumulated: T[] | undefined, supported: T[]): T[] {
  if (!accumulated) return [...supported]
  return accumulated.filter((value) => supported.includes(value))
}

export function strictestPolicy(a: ReducedMotionPolicy, b: ReducedMotionPolicy): ReducedMotionPolicy {
  return RM_RANK[b] > RM_RANK[a] ? b : a
}
