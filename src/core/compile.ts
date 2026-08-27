import type { EffectGate } from './breakpoints.js'
import { describeConflicts, findConflicts } from './channels.js'
import { declarationsFor, emptyTracks, pushTrack, pushTransitions } from './declarations.js'
import type { AnimationTracks } from './declarations.js'
import { resolveParams } from './params.js'
import type { Registry, ResolvedEffect } from './registry.js'
import { suggest } from './registry.js'
import { isReadableTime, resolveSequence } from './sequence.js'
import type { SequenceMember, SequenceStep } from './sequence.js'
import type { TargetScope } from './target.js'
import type {
  Activation,
  Channel,
  EffectSpec,
  EffectVariant,
  NamedActivation,
  ParameterSchema,
  ParsedValue,
  Preset,
  ReducedMotionPolicy,
  Timeline,
} from './types.js'

/** `disable` is the strongest claim: if any effect must not run, none of the list should. */
const RM_RANK: Record<ReducedMotionPolicy, number> = { shorten: 0, crossfade: 1, disable: 2 }

export interface Entry {
  spec: EffectSpec
  resolved: ResolvedEffect
  /**
   * Per-spec refinement from `primitive.variantFor`, computed once in `resolveEntries` and carried
   * on the entry so nothing downstream has to call it a second time. Absent for every primitive
   * that is fully described without seeing an attribute, which is all but the generic tween.
   */
  variant?: EffectVariant
  /**
   * Concrete milliseconds an `at:` position resolved to, for JS-rendered entries only.
   *
   * A CSS-rendered entry needs no such field: its position is a symbolic `calc()` the browser
   * evaluates, which is both more accurate and re-evaluated when a stylesheet moves one of the
   * durations underneath it (see `core/sequence.ts`). A JS-rendered one has no `animation-delay`
   * to write to and needs a number, so the sequencer's numeric mirror is carried here and applied
   * by `js-effect-preparer.ts` over whatever `readEffectTiming` read off the spec.
   *
   * Absent when the segment carries no `at:`, and when the position was refused — in both cases the
   * effect keeps its own authored delay. There is no third case: a sequenced step always carries a
   * real number, because the sequencer refuses a duration it cannot read rather than passing an
   * unknown along.
   */
  sequencedDelayMs?: number
  /**
   * Where the sequencer placed this segment, resolved once for the whole authored comma list
   * before {@link compileTargets} partitions it by target — see that function's own comment for
   * why the order matters. Always present once an entry leaves `compileTargets`; absent only on an
   * `Entry` a test builds by hand without going through it.
   */
  step?: SequenceStep
  /**
   * Selector this entry retargets to, lifted out of `spec.params` by `resolveEntries` for any
   * primitive that does not declare a `target` parameter of its own. Undefined means "compiles on
   * the host", which is every entry today and every entry whose primitive owns `target:` itself
   * (the six scroll-mechanics/forms primitives — they read the key from `spec.params`, unchanged).
   */
  target?: string
  /** Which tree {@link target} is searched in. Only meaningful when `target` is set. */
  scope?: TargetScope
}

/**
 * Channels one entry actually writes — the primitive's declaration, widened by any variant.
 *
 * Read by conflict detection *and* by the plan's channel union, which must agree: a `tween x:100`
 * that is checked for collisions on `translate` but reports no channel to `style-plan.ts` would
 * compose correctly and then skip the individual-transform fallback that same channel exists to
 * trigger.
 *
 * @complexity O(c) time and space in the entry's channel count.
 * @overallScore 100
 */
export function channelsFor(entry: Entry): Channel[] {
  const declared = entry.resolved.primitive.channels
  if (!entry.variant?.channels) return declared
  return [...declared, ...entry.variant.channels]
}

/**
 * Authored parameter values in force for one entry — `spec.params`, or a variant's normalisation
 * of them. Exported because the JS-effect path reads them too, and the two must not disagree about
 * what the author wrote.
 *
 * @complexity O(1) time and space.
 * @overallScore 100
 */
export function authoredParams(entry: Entry): Record<string, string> {
  return entry.variant?.params ?? entry.spec.params
}

export interface CompiledPlan {
  /** Effect names to stamp into `data-kui-fx` for CSS hooks and debugging. */
  fxNames: string[]
  /** Custom properties to write. Author overrides only — defaults stay in CSS `var()` fallbacks. */
  vars: Record<string, string>
  /** Longhand animation declarations, compiled as parallel lists so effects compose. */
  declarations: Record<string, string>
  /**
   * The bare `@keyframes` idents behind those declarations, one per track, in the same order.
   *
   * Carried separately because `animation-name` is no longer a list of idents that can be recovered
   * by splitting it: a gated segment compiles to `var(--kui-above-md, kui-in-up)` (see
   * `core/breakpoints.ts`), and `String.split(',')` shreds that into `var(--kui-above-md` and
   * `kui-in-up)`. `animator.ts` hands this list to `createCssInstance`, which matches it against
   * `getAnimations()` to decide which handles it owns — so a re-parse that produced `kui-in-up)`
   * would own nothing, settle its completion promise immediately, and strand `data-kui-state` on
   * `finished` while the animation was still visibly running.
   */
  keyframeNames: string[]
  /** Effects whose renderer needs JS setup. */
  jsEffects: Entry[]
  /** Names that are not registered. Must NOT be stamped, or the element is never rescanned. */
  unknown: string[]
  /** Strictest reduced-motion policy among the composed effects. */
  reducedMotion: ReducedMotionPolicy
  /** Activation preferred by the composed primitives when the author named none. */
  defaultActivation?: Activation
  /** Activations every composed primitive supports, for enforcement by the animator. */
  supportedActivations: NamedActivation[]
  /**
   * Timelines every composed primitive supports. Empty means none — `style-plan.ts` must not
   * apply a native `view()`/`scroll()` timeline the author's effect doesn't declare support for,
   * even when the browser itself is capable of one; `warnUnsupportedTimeline` only warns, it
   * doesn't change what's compiled, so this is what actually stops the mismatch from being applied.
   */
  supportedTimelines: Timeline[]
  /** Union of channels every composed effect writes to, so callers can react to what actually moves. */
  channels: Channel[]
  /**
   * Merged `transition` shorthand value for the composed effects' declared {@link TransitionSegment}s,
   * or absent when none of them transitions anything. Consumed by the one
   * `:where([data-kui-fx])` rule in `base.css` through the ledger, the same way `vars`/`declarations`
   * are.
   *
   * Deliberately NOT folded into `declarations`: `style-plan.ts` reads that field's emptiness as
   * "this element has a CSS animation" and would gate every one of these ten presets — all
   * `renderer: 'javascript'` — behind `animation-play-state: paused`, pausing an animation that
   * does not exist. Deliberately NOT folded into `vars` either: that field means "author parameter
   * overrides", and several tests assert its exact contents with `toEqual`.
   */
  transition?: string
  warnings: string[]
}

/**
 * Turn a parsed `data-kui` value into the writes an element needs.
 *
 * Pure: same inputs always produce the same plan, and nothing is applied to the DOM here. That
 * is what lets composition rules, parameter validation, and declaration output be asserted
 * directly rather than through a rendered document.
 *
 * @param parsed - Output of `parse`.
 * @param registry - Effect catalog to resolve names against.
 * @param timeline - Element-scoped timeline, used to warn on unsupported combinations.
 * @returns A plan describing custom properties, declarations, JS effects, and warnings.
 * @complexity O(e * p) time in composed effects and their parameters; O(e) space.
 * @overallScore 100
 */
export function compile(
  parsed: ParsedValue,
  registry: Registry,
  timeline: Timeline,
): CompiledPlan {
  // The host's plan is always `targets[0]` — see `compileTargets` — so this keeps its exact
  // original signature and behaviour for every caller that has never heard of `target:`: with no
  // targeted segment there is exactly one group, and `mergeHostFacts` folding a single plan's own
  // facts into itself is the identity, so the returned plan is byte-identical to before this
  // feature existed.
  //
  // The one field that has to be rebuilt is `warnings`. A group's plan carries only the warnings
  // raised *inside that group*; the ones raised before partitioning live on the document (see
  // `CompiledDocument.warnings`). A single-plan caller has no document to read, so the two halves
  // are concatenated back into the flat list this function has always returned — and concatenated
  // here, once, rather than by aliasing one array into both places, which is what made
  // `animator.ts` report every warning twice.
  const { targets, warnings } = compileTargets(parsed, registry, timeline)
  const host = targets[0]!.plan
  return { ...host, warnings: [...warnings, ...host.warnings] }
}

/**
 * One `target:`-partitioned group of a compiled `data-kui` attribute — the plan for the segments
 * that share one `(scope, selector)` pair, plus which pair that is.
 *
 * `selector: ''` is the host: the element the attribute is authored on, always present, always
 * `CompiledDocument.targets[0]`. Every other entry names a `target:` a primitive did not claim for
 * itself — see `Entry.target`'s own comment for which primitives those are.
 */
export interface CompiledTarget {
  /** `''` for the host group. */
  selector: string
  scope: TargetScope
  plan: CompiledPlan
}

/**
 * The full compilation of one authored `data-kui` value, before it is narrowed to a single plan.
 *
 * `warnings` here are the ones about the authored comma list as a whole rather than about any one
 * target group: unknown effect names, the `at:` sequencer's own diagnostics, a refused container
 * gate, a retarget the preset would not survive, and the hoisted `rm:`'s one-way-ratchet refusal.
 * A group's own composition/parameter warnings live on `CompiledTarget.plan.warnings` instead,
 * exactly where they always have.
 *
 * The two lists are disjoint, and that is load-bearing rather than tidy: `animator.ts` reports this
 * one and then every group's, so a warning reachable through both would be printed twice — which is
 * exactly what a shared array reference used to do to all of them.
 */
export interface CompiledDocument {
  targets: CompiledTarget[]
  warnings: string[]
}

/**
 * Compile a parsed `data-kui` value into one plan per `target:`/`scope:` group.
 *
 * The host group (selector `''`) is always present and always first, whether or not the author
 * targeted anything — `install` in `animator.ts` loops every group the same way, and a page that
 * never uses `target:` compiles to exactly the one group it always has.
 *
 * A fixed order, not to be reshuffled:
 *
 * 1. **Resolve and lift**, once, over the whole authored list (`resolveEntries`). Every entry gets
 *    a primitive; every entry whose primitive does not own `target:` itself gets `.target`/`.scope`
 *    pulled off its params here, before anything downstream can see them.
 * 2. **Sanitize container gates** (`refuseContainerGate`), before composition sees them — see that
 *    function's own comment for why a stripped gate must not still count as "these can never
 *    collide".
 * 3. **Sequence**, once, over the whole *unpartitioned* list. `at:` positions a segment against its
 *    neighbours in the authored comma list — `fade-up target:h1, slide-left target:p at:-200ms` is
 *    one author's clearly-linked pair, and partitioning first would make them neighbourless.
 * 4. **Partition, then compose and build, per group.** Channel conflicts are only real within a
 *    group — two effects that land on different elements cannot collide — so `findConflicts`
 *    (inside `resolveComposition`) has to run after the split, not before it.
 *
 * @param parsed - Output of `parse`.
 * @param registry - Effect catalog to resolve names against.
 * @param timeline - Element-scoped timeline, used to warn on unsupported combinations.
 * @complexity O(e * p) time in composed effects and their parameters; O(e) space.
 * @overallScore 100
 */
export function compileTargets(
  parsed: ParsedValue,
  registry: Registry,
  timeline: Timeline,
): CompiledDocument {
  const warnings = [...parsed.warnings]
  const { entries, unknown } = resolveEntries(parsed.specs, registry, warnings)

  if (entries.length === 0) {
    // `[]`, not `warnings`: everything raised so far is document-scoped, and handing the same array
    // to the plan would make `plan.warnings` and `document.warnings` the same object — see this
    // function's own `warnings` comment above.
    return { targets: [{ selector: '', scope: 'self', plan: emptyPlan(unknown, []) }], warnings }
  }

  const sanitized = entries.map((entry) => refuseContainerGate(entry, warnings))
  // Sequenced once, over the full list, before the group split below — see this function's own
  // comment. `resolveSequence` always returns one step per member, in the same order, so zipping
  // by index is safe.
  const steps = resolveSequence(sanitized.map(memberFor), timeline, (m) => warnings.push(m))
  const sequenced = sanitized.map((entry, index) => ({ ...entry, step: steps[index]! }))

  const targets = partitionByTarget(sequenced).map(({ selector, scope, entries: group }) => {
    // A sink of its own per group, never the document's. `buildPlan` stores the array it is handed
    // *by reference* as `plan.warnings`, so passing `warnings` here would make every plan and the
    // document share one object: `animator.ts` walks the document's list and then each group's,
    // and printed every warning 1 + (group count) times off a single authored attribute.
    const groupWarnings: string[] = []
    const composed = resolveComposition(group, registry, groupWarnings)
    return { selector, scope, plan: buildPlan(composed, timeline, unknown, groupWarnings) }
  })
  mergeHostFacts(targets)
  // `rm:` is hoisted off the whole attribute and `mergeHostFacts` has already folded one policy
  // across every group, so this resolves once, against the document, and is written back to all of
  // them. Resolving it per group instead re-raised the identical "may only strengthen" warning once
  // per group for a decision that was only ever made once.
  const reducedMotion = resolvedPolicy(targets[0]!.plan.reducedMotion, parsed.rm, warnings)
  for (const target of targets) target.plan.reducedMotion = reducedMotion
  return { targets, warnings }
}

/**
 * Group already-sequenced entries by `target:`/`scope:`, host first.
 *
 * The key is `` `${scope} ${target}` ``, not `target` alone: the same selector under `scope:self`
 * and `scope:page` names two different match sets and must not share a group. `target` is always
 * `''` for the host, so its key can never collide with a real selector's — a selector is never the
 * empty string once `resolveEntries` has lifted it.
 *
 * The host group is moved to index 0 when it exists but was not first in authoring order —
 * `data-kui="fade-up target:h1, blur-in"` still has to compile its host segment (`blur-in`) into
 * `targets[0]`, which is the contract `compile()`'s single-plan return relies on. When there is no
 * untargeted segment at all (`data-kui="fade-up target:h1"` alone), there is no host group to move
 * and the one group present is already first by construction.
 *
 * @complexity O(e) time and space in the entry count.
 * @overallScore 100
 */
function partitionByTarget(
  entries: (Entry & { step: SequenceStep })[],
): { selector: string; scope: TargetScope; entries: (Entry & { step: SequenceStep })[] }[] {
  interface Group {
    selector: string
    scope: TargetScope
    entries: (Entry & { step: SequenceStep })[]
  }
  const byKey = new Map<string, Group>()
  const order: Group[] = []

  for (const entry of entries) {
    const selector = entry.target ?? ''
    const scope = entry.scope ?? 'self'
    const key = `${scope} ${selector}`
    let group = byKey.get(key)
    if (!group) {
      group = { selector, scope, entries: [] }
      byKey.set(key, group)
      order.push(group)
    }
    group.entries.push(entry)
  }

  const hostIndex = order.findIndex((group) => group.selector === '')
  if (hostIndex > 0) {
    const [host] = order.splice(hostIndex, 1)
    order.unshift(host!)
  }
  return order
}

/**
 * Fold the four element-scoped `CompiledPlan` facts across every target group and write the merged
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
 * and threading a copy through here for four field writes would cost more than it clarifies.
 *
 * @complexity O(g * c) time in groups and their channel counts; O(c) space.
 * @overallScore 100
 */
function mergeHostFacts(targets: { plan: CompiledPlan }[]): void {
  let reducedMotion: ReducedMotionPolicy = 'shorten'
  let activations: NamedActivation[] | undefined
  let timelines: Timeline[] | undefined
  let defaultActivation: Activation | undefined
  const channels = new Set<Channel>()

  for (const { plan } of targets) {
    reducedMotion = strictestPolicy(reducedMotion, plan.reducedMotion)
    activations = intersect(activations, plan.supportedActivations)
    timelines = intersect(timelines, plan.supportedTimelines)
    defaultActivation ??= plan.defaultActivation
    for (const channel of plan.channels) channels.add(channel)
  }

  const mergedChannels = [...channels]
  for (const { plan } of targets) {
    plan.reducedMotion = reducedMotion
    plan.supportedActivations = activations ?? []
    plan.supportedTimelines = timelines ?? []
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
 * The rule is not invented for this key — it is `strictestPolicy`'s, applied one more time. That
 * function already encodes "if any effect must not run, none of the list should", and an author
 * key that could overrule it would make the whole fold advisory: `parallax` declares `disable`
 * because parallax is a documented vestibular trigger, not because the library is being cautious
 * on the author's behalf, and `rm:shorten` on it would hand a visitor who has explicitly asked
 * their operating system for less motion exactly the motion they asked not to receive. The useful
 * direction is the other one and it stays open: `rm:disable` on a spinning logo whose primitive
 * only claims `shorten` is a real request the library previously had no spelling for.
 *
 * A weakening attempt warns by name rather than being ignored, because the author wrote a value
 * and is otherwise owed an explanation for why the page does not behave as they asked.
 *
 * @param declared - Strictest policy among the composed primitives.
 * @param authored - The hoisted `rm:` value, already validated by `parse.ts`.
 * @complexity O(1) time and space.
 * @overallScore 100
 */
function resolvedPolicy(
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

function emptyPlan(unknown: string[], warnings: string[]): CompiledPlan {
  return {
    fxNames: [],
    vars: {},
    declarations: {},
    keyframeNames: [],
    jsEffects: [],
    unknown,
    reducedMotion: 'shorten',
    supportedActivations: [],
    supportedTimelines: [],
    channels: [],
    warnings,
  }
}

/**
 * Look every named effect up in the registry, collecting unresolvable names separately.
 *
 * @returns Resolved entries plus the names that did not resolve.
 * @complexity O(e * n) time — the "did you mean" suggestion scans registered names. Only runs on
 *   the error path, so the common case is O(e).
 * @overallScore 100
 */
function resolveEntries(
  specs: EffectSpec[],
  registry: Registry,
  warnings: string[],
): { entries: Entry[]; unknown: string[] } {
  const entries: Entry[] = []
  const unknown: string[] = []

  for (const spec of specs) {
    const resolved = registry.resolve(spec.name)
    if (!resolved) {
      unknown.push(spec.name)
      warnUnknownEffect(spec.name, registry, warnings)
      continue
    }
    entries.push(entryFor(spec, resolved, warnings))
  }

  return { entries, unknown }
}

/**
 * Build one resolved entry: lift its `target:`/`scope:`, then refine it through the primitive's
 * own `variantFor`.
 *
 * @complexity O(p) time and space in the spec's parameter count.
 * @overallScore 100
 */
function entryFor(spec: EffectSpec, resolved: ResolvedEffect, warnings: string[]): Entry {
  const lifted = liftTarget(spec, resolved, warnings)
  // Variant is computed from the *lifted* spec, not the original: the generic tween's
  // `buildVariant` passes any parameter key it doesn't recognise straight through
  // (`effects/tween`'s `params[key] = raw`), so a `target`/`scope` still sitting in
  // `spec.params` here would ride along into `variant.params` and get validated as an
  // "unknown parameter" a second time, on top of the warning `liftTarget` already gave it.
  const variant = resolved.primitive.variantFor?.(lifted.spec, (m) => warnings.push(m))
  const entry: Entry = variant
    ? { spec: lifted.spec, resolved, variant }
    : { spec: lifted.spec, resolved }
  if (lifted.target !== undefined) {
    entry.target = lifted.target
    entry.scope = lifted.scope
  }
  return entry
}

/**
 * Name an unregistered effect, with a "did you mean" when one of the registered names is close.
 *
 * @complexity O(n) time in the registry's name count — the error path only.
 * @overallScore 100
 */
function warnUnknownEffect(name: string, registry: Registry, warnings: string[]): void {
  const hint = suggest(name, registry.names())
  const suffix = hint ? ` — did you mean "${hint}"?` : ''
  warnings.push(`unknown effect "${name}"${suffix}`)
}

/**
 * Pull `target:`/`scope:` off a spec's params for any primitive that does not declare a `target`
 * parameter of its own.
 *
 * The six scroll-mechanics/forms primitives that do declare `target` (`scroll-progress`,
 * `horizontal-track`, `media-scrub`, `scroll-spy`, `scroll-snap`, `step-progress`) read the key
 * themselves through `EffectParams` inside their own `prepare` — see `effects/step-marking.ts`'s
 * module comment. Lifting it here too would be lifting nothing, since `Object.hasOwn` below is
 * false for none of them; the early return is what keeps their existing behaviour untouched.
 *
 * For every other primitive, `target:h1` is not a parameter that primitive has ever heard of, so
 * it must be gone from `spec.params` before `resolveParams`/`readParams` validate the rest — left
 * in place it would warn "unknown parameter" on every retargeted effect in the catalog.
 *
 * `scope` travels with `target`, always, and is read here rather than through {@link scopeParam}:
 * this runs on the raw `spec.params` record, before `readParams` builds an `EffectParams` reader
 * over it, and the `'self'` default matches `target:`'s settled meaning — "search inside myself" —
 * for every primitive that does not otherwise say so for itself.
 *
 * `Preset.requiresOwnSubtree` is checked here too, not as a separate pass, so a preset whose CSS
 * cannot survive relocation is warned about and dropped in the same place the lift itself happens
 * — see that field's own comment. Dropping keeps the effect on the host with `target:`/`scope:`
 * still stripped from its params, rather than warning once for the refusal and a second time for
 * an "unknown parameter" that was never really unknown, only unusable here.
 *
 * @returns The spec to compile with — copied and stripped only when a lift or a refusal happened —
 *   plus the lifted target/scope. `target` is `undefined` when nothing was authored, the primitive
 *   owns the key itself, or the preset refused relocation; `resolveEntries` reads that as "leave
 *   this entry on the host group".
 * @complexity O(p) time and space in the spec's parameter count.
 * @overallScore 100
 */
function liftTarget(
  spec: EffectSpec,
  resolved: ResolvedEffect,
  warnings: string[],
): { spec: EffectSpec; target?: string; scope?: TargetScope } {
  if (Object.hasOwn(resolved.primitive.parameters, 'target')) return { spec }
  const target = spec.params.target
  if (!target) return { spec }

  // Copy-and-delete rather than a rest destructure (`const { target: _target, ...rest }`): that
  // form needs a named binding for every key it drops, and a binding whose only purpose is to be
  // thrown away is exactly what the unused-variable rules exist to catch. This spells the same
  // strip with nothing left over.
  const rest = { ...spec.params }
  const authoredScope = rest.scope
  delete rest.target
  delete rest.scope
  const stripped: EffectSpec = { ...spec, params: rest }

  if (resolved.preset.requiresOwnSubtree) {
    warnings.push(
      `"${resolved.preset.name}" cannot be retargeted — its CSS reaches past the animated ` +
        `element itself, so "target:${target}" is dropped and it stays on the host`,
    )
    return { spec: stripped }
  }

  const scope: TargetScope = authoredScope === 'page' ? 'page' : 'self'
  return { spec: stripped, target, scope }
}

/**
 * Strip a container gate (`wide:`/`narrow:`) off a JavaScript-rendered entry, warning by name.
 *
 * `wide:`/`narrow:` compile to the same kind of CSS custom-property switch `above:`/`below:` do
 * (`gatedAnimationName`), and a `css-keyframes` primitive's `animation-name` reads it for free —
 * no runtime involved, same as the viewport half. A `renderer: 'javascript'` primitive emits no
 * `animation-name` at all, so there is nothing for that switch to neutralise. `above:`/`below:`
 * already has a fallback for this gap — `gateMatches`/`createGateWatcher` mirror the media query in
 * JS — but there is no `matchContainer()` to write the container equivalent with: it would need a
 * `ResizeObserver` per container plus a re-entrancy-safe notify path, for one attribute, in v1.
 *
 * Refusing is the same fail-open the rest of the gate grammar uses (`parse.ts`'s `applyGate`,
 * `breakpoints.ts`'s `gateMatches`): warn and run unconditionally, never warn and silently do
 * nothing. `above:`/`below:` on the same segment are left alone — those still work.
 *
 * @complexity O(1) time and space.
 * @overallScore 100
 */
function refuseContainerGate(entry: Entry, warnings: string[]): Entry {
  const { spec, resolved } = entry
  if (resolved.primitive.renderer === 'css-keyframes') return entry
  if (!spec.gate?.wide && !spec.gate?.narrow) return entry

  warnings.push(
    `"${spec.name}" ignores "wide:"/"narrow:" — container gates are not supported on ` +
      `JavaScript-rendered effects yet, so it runs unconditionally`,
  )
  const { above, below } = spec.gate
  const gate: EffectGate | undefined = above || below ? { above, below } : undefined
  return { ...entry, spec: { ...spec, gate } }
}

/**
 * Decide whether a comma list may compose.
 *
 * Order matters: a purpose-built combo preset beats channel analysis, because `fade-up, blur-in`
 * has a tested single-keyframe implementation even though both effects write `opacity`.
 * A genuine collision falls back to the first effect rather than emitting a visibly wrong
 * animation, and always warns.
 *
 * Each segment's viewport gate goes to the detector along with its channels: two effects that can
 * never be live at the same width cannot collide, and `fade-up below:md, parallax-y above:md` —
 * the case the gate exists for — shares a channel in every other respect. See `channels.ts`.
 *
 * @returns The entries to compile — either the original list, a single combo, or a single effect.
 * @complexity O(e * c) time in effects and their channels; O(c) space.
 * @overallScore 100
 */
function resolveComposition(entries: Entry[], registry: Registry, warnings: string[]): Entry[] {
  if (entries.length <= 1) return entries

  const conflicts = findConflicts(
    entries.map((e) => ({ name: e.spec.name, channels: channelsFor(e), gate: e.spec.gate })),
  )
  if (conflicts.length === 0) return entries

  const combo = registry.findCombo(entries.map((e) => e.spec.name))
  const remedy = combo
    ? `Use the "${combo.preset.name}" effect instead.`
    : 'Apply them to nested elements, or register a combined effect.'
  warnings.push(`cannot compose: ${describeConflicts(conflicts)}. ${remedy}`)
  return [entries[0]!]
}

/**
 * Build the plan for an already-validated set of entries.
 *
 * @complexity O(e * p) time in effects and parameters; O(e) space.
 * @overallScore 100
 */
function buildPlan(
  entries: Entry[],
  timeline: Timeline,
  unknown: string[],
  warnings: string[],
): CompiledPlan {
  const plan = emptyPlan(unknown, warnings)
  const tracks: AnimationTracks = emptyTracks()
  const channels = new Set<Channel>()
  // One comma-separated `transition:` segment per declared `TransitionSegment`, in authoring
  // order — the same parallel-list shape `tracks` builds for `animation`, and for the same reason:
  // a bare `transition:` on two separate rules cannot both apply, so composition has to happen
  // here instead. `transitionOwners` is who most recently claimed a given property, purely to name
  // both presets in the duplicate-property warning below; it carries no other weight; a browser
  // that is handed the same property twice in one shorthand already resolves it last-wins.
  const transitionSegments: string[] = []
  const transitionOwners = new Map<string, string>()
  // Accumulated outside `plan` so `undefined` (no effect has contributed yet) stays distinct from
  // `[]` (the composed effects genuinely share nothing) — see `intersect`.
  let activations: NamedActivation[] | undefined
  let timelines: Timeline[] | undefined

  for (const entry of entries) {
    const { preset, primitive } = entry.resolved
    // Resolved once for the *whole authored comma list*, before `compileTargets` ever partitions
    // or composes it — see that function's own comment for why. `entry.step` is always present by
    // the time an entry reaches here: every caller of `buildPlan` sequences first.
    const step = entry.step!
    plan.fxNames.push(preset.name)
    plan.reducedMotion = strictestPolicy(plan.reducedMotion, primitive.reducedMotion)
    plan.defaultActivation ??= primitive.defaultActivation
    activations = intersect(activations, primitive.supportedActivations)
    timelines = intersect(timelines, primitive.supportedTimelines)
    for (const channel of channelsFor(entry)) channels.add(channel)
    warnUnsupportedTimeline(preset.name, primitive.supportedTimelines, timeline, warnings)

    // Only the author's own overrides go inline. Preset defaults are emitted as cascade rules by
    // `scripts/generate-preset-css.mjs`; writing them to element.style made them unoverridable by
    // any consumer stylesheet, which contradicts the library's whole cascade promise.
    Object.assign(
      plan.vars,
      resolveParams(authoredParams(entry), primitive.parameters, (m) => warnings.push(m)),
    )

    if (primitive.renderer === 'css-keyframes') pushTrack(tracks, entry, timeline, step)
    else plan.jsEffects.push(positioned(entry, step))
    pushTransitions(transitionSegments, transitionOwners, entry, warnings)
  }

  Object.assign(plan.declarations, declarationsFor(tracks))
  plan.keyframeNames = tracks.keyframes
  if (transitionSegments.length > 0) plan.transition = transitionSegments.join(', ')
  // `activations`/`timelines` start `undefined` only until the loop's first iteration; `compile`
  // already returns `emptyPlan` before `buildPlan` is ever called with zero entries, so the loop
  // above always runs at least once and both are real arrays (possibly empty) by here.
  plan.supportedActivations = activations!
  plan.supportedTimelines = timelines!
  plan.channels = [...channels]
  return plan
}

/**
 * Describe one entry to the sequencer.
 *
 * The sequencer is deliberately given a flat description rather than the `Entry` itself: it does
 * arithmetic on times and has no business reaching into a registry, and a structural input is what
 * lets its whole grammar be tested without building a catalog.
 *
 * @complexity O(1) time and space.
 * @overallScore 100
 */
function memberFor(entry: Entry): SequenceMember {
  const { spec, resolved } = entry
  const { preset, primitive } = resolved
  const authored = authoredParams(entry)
  return {
    name: preset.name,
    primitiveId: primitive.id,
    at: spec.at,
    delay: spec.delay,
    duration: spec.duration,
    cascadeDelay: cascadeValue(authored, preset, primitive.parameters, 'delay'),
    cascadeDuration: cascadeValue(authored, preset, primitive.parameters, 'duration'),
    // A `css-keyframes` segment is always positionable — it compiles to an `animation-delay` and
    // the browser honours it. A JavaScript-rendered one is positionable only if it declares the
    // parameter, which is the single compile-time signal that it reads a delay at all.
    positionable:
      primitive.renderer === 'css-keyframes' || Object.hasOwn(primitive.parameters, 'delay'),
  }
}

/**
 * What a timing custom property is expected to resolve to, following the same precedence
 * `scripts/generate-preset-css.mjs` writes it with: the author's named key, then the preset's own
 * override, then the primitive's declared default.
 *
 * The generated stylesheet is built from these very values, which is what makes the sequencer's
 * numeric mirror agree with its symbolic half for everything the library ships.
 *
 * The first *readable* candidate rather than simply the first, because that is what the cascade
 * itself does: `resolveParams` drops a value the validator rejected, so `duration:banana` never
 * reaches `--kui-reveal-duration` and CSS lands on the preset default. Taking the authored string
 * regardless would leave the two halves of a sequence built from different durations — the symbolic
 * one positioned off the preset default, the numeric one off nothing at all.
 *
 * @complexity O(1) time and space — three candidates, each a short-string time match.
 * @overallScore 100
 */
function cascadeValue(
  authored: Record<string, string>,
  preset: Preset,
  schema: ParameterSchema,
  name: 'delay' | 'duration',
): string | undefined {
  const candidates = [authored[name], preset.params?.[name], schema[name]?.default]
  return candidates.find((value) => value !== undefined && isReadableTime(value))
}

/**
 * Carry a resolved `at:` position onto a JS-rendered entry.
 *
 * Unconditional once the step is sequenced: `SequenceStep.delayMs` is always a real number, because
 * the sequencer refuses a duration it cannot read at the point it would have been added rather than
 * threading an unknown down the chain. There is deliberately no "could not resolve" branch here —
 * it would be unreachable code pretending to be caution.
 *
 * @complexity O(1) time and space.
 * @overallScore 100
 */
function positioned(entry: Entry, step: SequenceStep): Entry {
  if (!step.sequenced) return entry
  return { ...entry, sequencedDelayMs: step.delayMs }
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
function intersect<T>(accumulated: T[] | undefined, supported: T[]): T[] {
  if (!accumulated) return [...supported]
  return accumulated.filter((value) => supported.includes(value))
}

function strictestPolicy(a: ReducedMotionPolicy, b: ReducedMotionPolicy): ReducedMotionPolicy {
  return RM_RANK[b] > RM_RANK[a] ? b : a
}

function warnUnsupportedTimeline(
  name: string,
  supported: Timeline[],
  timeline: Timeline,
  warnings: string[],
): void {
  if (supported.includes(timeline)) return
  warnings.push(
    `"${name}" does not support timeline "${timeline}" (supports: ${supported.join(', ')})`,
  )
}

