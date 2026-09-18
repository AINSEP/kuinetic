import type { EffectGate } from './breakpoints.js'
import {
  additiveChannels,
  additiveResolution,
  deliveryClobbers,
  describeConflicts,
  findConflicts,
} from './channels.js'
import { declarationsFor, emptyTracks, pushTrack, pushTransitions } from './declarations.js'
import type { AnimationTracks } from './declarations.js'
import {
  intersect,
  mergeHostFacts,
  resolveDefaultActivation,
  resolvedPolicy,
  strictestPolicy,
} from './host-facts.js'
import { resolveParams } from './params.js'
import type { Registry, ResolvedEffect } from './registry.js'
import { suggest } from './registry.js'
import { resolvePlayback } from './repeat.js'
import { isReadableTime, resolveSequence } from './sequence.js'
import type { SequenceMember, SequenceStep } from './sequence.js'
import type { TargetScope } from './target.js'
import type {
  Activation,
  Channel,
  EffectPhase,
  EffectSpec,
  EffectVariant,
  NamedActivation,
  ParameterSchema,
  ParsedValue,
  Preset,
  ReducedMotionPolicy,
  Timeline,
} from './types.js'

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
   * (see `liftTarget`'s comment for the current set — they read the key from `spec.params`,
   * unchanged).
   */
  target?: string
  /** Which tree {@link target} is searched in. Only meaningful when `target` is set. */
  scope?: TargetScope
  /**
   * `animation-composition` for every track this entry compiles, when the composition resolver had
   * to make it additive to let a same-channel neighbour survive — see {@link resolveComposition}.
   *
   * Absent means the CSS initial value, `replace`, which is what every entry compiled before this
   * existed and what all but the handful of additively-resolved ones still compile to.
   * `declarations.ts` omits the declaration entirely when no track sets it, the same way it already
   * omits an all-`normal` `animation-direction`.
   */
  composite?: 'add'
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

/**
 * The parameter specs one entry's values are validated against — the primitive's declaration,
 * extended by any its variant synthesised for keys the primitive could not declare statically.
 *
 * Merged rather than replaced: see `EffectVariant.schema`. The primitive's own specs stay in force,
 * so a variant can add parameters but never relax one.
 *
 * @complexity O(p) time and space in the schema size, and only when a variant declares one.
 * @overallScore 100
 */
export function schemaFor(entry: Entry): ParameterSchema {
  const extra = entry.variant?.schema
  if (!extra) return entry.resolved.primitive.parameters
  return { ...entry.resolved.primitive.parameters, ...extra }
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

  // Both sanitizers run before the sequencer, and `refusePlayback` has to: `at:after` measures the
  // previous segment's whole playback, so it must see the repeat that survived rather than the one
  // that was authored.
  const sanitized = entries.map((entry) =>
    refusePlayback(refuseContainerGate(entry, warnings), timeline, warnings),
  )
  // Sequenced once, over the full list, before the group split below — see this function's own
  // comment. `resolveSequence` always returns one step per member, in the same order, so zipping
  // by index is safe.
  const steps = resolveSequence(sanitized.map(memberFor), timeline, (m) => warnings.push(m))
  const sequenced = sanitized.map((entry, index) => ({ ...entry, step: steps[index]! }))

  // Every entry that survived composition, in host-group-first order, kept so the element's one
  // activation can be decided from all of them at once — see {@link resolveDefaultActivation}. It
  // has to be the *composed* lists rather than `sequenced`: an effect the resolver dropped is not
  // going to run, so letting it name the trigger would bind the element for a corpse.
  const composedEntries: Entry[] = []
  const targets = partitionByTarget(sequenced).map(({ selector, scope, entries: group }) => {
    // A sink of its own per group, never the document's. `buildPlan` stores the array it is handed
    // *by reference* as `plan.warnings`, so passing `warnings` here would make every plan and the
    // document share one object: `animator.ts` walks the document's list and then each group's,
    // and printed every warning 1 + (group count) times off a single authored attribute.
    const groupWarnings: string[] = []
    const composed = resolveComposition(group, registry, groupWarnings)
    composedEntries.push(...composed)
    return { selector, scope, plan: buildPlan(composed, timeline, unknown, groupWarnings) }
  })
  // Flattened to the two facts the decision needs, rather than handing over the entries: `phaseOf`
  // is this module's derivation and `host-facts.ts` has no business calling it — the same
  // structural-input argument `channels.ts` makes for `ChannelClaim`, and what keeps that module's
  // import of `CompiledPlan` type-only.
  const activationClaims = composedEntries.map((entry) => ({
    phase: phaseOf(entry),
    defaultActivation: entry.resolved.primitive.defaultActivation,
  }))
  mergeHostFacts(targets, resolveDefaultActivation(activationClaims))
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
 * Some primitives declare `target` themselves — `scroll-progress`, `horizontal-track`,
 * `media-scrub`, `scroll-spy` and `scroll-snap` in `effects/scroll-mechanics/primitives.ts`,
 * `step-progress` in `effects/forms/primitives.ts`, `spatial-ring` in `effects/carousel/index.ts`,
 * `audio-source` in `advanced/audio.ts` — and read the key themselves through `EffectParams` inside
 * their own `prepare`; see `effects/step-marking.ts`'s module comment for where the shared
 * `target:`/`scope:` grammar lives. Lifting it here too would be lifting nothing, since
 * `Object.hasOwn` below is false for none of them; the early return is what keeps their existing
 * behaviour untouched. This list is not the source of truth and will drift the next time a
 * primitive opts in — re-derive it with `grep -rn "'--kui-target'" src/ --include=*.ts` (excluding
 * `__tests__`) rather than trusting a remembered count.
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
 * Strip a `repeat:`/`yoyo:` the compiled output cannot honour, warning by name.
 *
 * Deliberately the same shape as {@link refuseContainerGate} above it, and mapped in the same pass:
 * both are "this modifier is unusable here, so run without it and say so". `core/repeat.ts` owns
 * every rule and every sentence; this only rebuilds the spec around the answer.
 *
 * The rebuild is a copy, never a mutation — `compile` is pure and the same parsed value is compiled
 * again on every rescan, so writing back onto `spec` would make the second compile of an element
 * see a repeat the first one had already dropped.
 *
 * @complexity O(1) time and space.
 * @overallScore 100
 */
function refusePlayback(entry: Entry, timeline: Timeline, warnings: string[]): Entry {
  const { spec, resolved } = entry
  if (spec.repeat === undefined && spec.yoyo === undefined) return entry

  const { repeat, yoyo, warnings: raised } = resolvePlayback({
    name: resolved.preset.name,
    renderer: resolved.primitive.renderer,
    cloak: resolved.preset.cloak,
    timeline,
    repeat: spec.repeat,
    yoyo: spec.yoyo,
  })
  warnings.push(...raised)
  return { ...entry, spec: { ...spec, repeat, yoyo } }
}

/**
 * When one entry holds the channels it claims.
 *
 * Three sources, in a fixed order, and the order is the whole design:
 *
 * 1. **An authored `repeat:infinite` wins outright.** `repeat` is per effect segment, so
 *    `data-kui="fade-up repeat:infinite"` turns a finite entrance into an unbounded loop at
 *    authoring time — the preset's own declaration is describing a name, not this segment. A loop
 *    never yields its channel back, which is exactly what `idle` means, so the promotion happens
 *    here rather than leaving the detector to reason about a preset that no longer describes what
 *    will run. Read *after* `refusePlayback` has had its say (see `compileTargets`'s ordering), so
 *    a `repeat:infinite` the renderer or timeline refused does not promote anything.
 * 2. **The preset's own declaration**, which is the source of truth — see {@link EffectPhase}.
 * 3. **One derived signal, and only one.** `transitions` means the preset's motion is a CSS state
 *    rule easing between two normal declarations, which is `state` by construction — a transition
 *    has no clock of its own and emits no animation track, so it cannot be an entrance or a loop.
 *    That saves the seventeen presets carrying it from needing a declaration at all.
 *
 * `cloak` is deliberately **not** a second signal, and that was measured rather than assumed. It
 * looks like a perfect proxy — it means "begins from a state the visitor must not see", every
 * entrance in the catalog carries it and no exit does — but the exemption is not really about
 * *starting* hidden, it is about *ending* released: an entrance may hand its channel back only
 * because its keyframes name no endpoint, so CSS resolves the missing one against the underlying
 * value. Fifteen of the fifty-four `cloak: true` presets close their block anyway (`wipe-up`,
 * `blur-up`, `slat-assemble` and the rest), and eleven of those share a channel with a preset the
 * derivation calls `state`. Deriving from `cloak` would have composed those eleven into a fill that
 * pins the property and a hover that silently does nothing — a loud drop traded for a quiet clobber,
 * which is the one trade this whole change exists to avoid. So an entrance says so itself.
 *
 * `undefined` is the honest fourth answer and not a default: an unphased claim collides with
 * everything, which is how every claim behaved before phases existed.
 *
 * @complexity O(1) time and space.
 * @overallScore 100
 */
function phaseOf(entry: Entry): EffectPhase | undefined {
  if (entry.spec.repeat === 'infinite') return 'idle'
  const { preset } = entry.resolved
  if (preset.phase) return preset.phase
  if (preset.transitions?.length) return 'state'
  return undefined
}

/**
 * Whether this entry's tracks could carry `animation-composition: add` without lying about what
 * they animate.
 *
 * Three conditions, and each of them has already cost someone a debugging session somewhere:
 *
 * - **It must render through CSS keyframes.** `animation-composition` is a property of an animation
 *   track. `lift` has none — its motion is a `:hover` normal declaration plus a transition — so
 *   there is nothing on it to make additive.
 * - **It must compile exactly one keyframe block.** A variant naming several (the generic tween)
 *   splits its channels across them and records nowhere which block writes which, so there is no
 *   honest way to mark only the additive half.
 * - **Every channel it claims must be additive.** See `channels.ts`'s `additiveChannels`: one block
 *   writes all of the preset's channels, so rescuing `fade-up`'s `translate` this way would also
 *   add its `opacity` to the underlying 1 and delete the fade.
 *
 * @complexity O(c) time in the entry's channel count; O(1) space.
 * @overallScore 100
 */
function additivelyComposable(entry: Entry): boolean {
  if (entry.resolved.primitive.renderer !== 'css-keyframes') return false
  if (entry.variant?.keyframes) return false
  return additiveChannels(channelsFor(entry))
}

/**
 * Decide whether a comma list may compose.
 *
 * Order matters: a purpose-built combo preset beats channel analysis, because `fade-up, blur-in`
 * has a tested single-keyframe implementation even though both effects write `opacity`.
 * A genuine collision falls back to the first effect rather than emitting a visibly wrong
 * animation, and always warns.
 *
 * Each segment reaches the detector with three facts about it, not one, because "these two write
 * the same property" is only the first of three questions:
 *
 * - **its channels** — what it writes at all;
 * - **its viewport gate** — two effects that can never be live at the same width cannot collide,
 *   and `fade-up below:md, parallax-y above:md` is the case the gate exists for;
 * - **its {@link phaseOf phase}** — two effects that hold the channel at different times are not
 *   fighting over it. `fade-up, lift` is that case, and it is the one this whole axis was added
 *   for: the compiler used to drop `lift` outright and tell the author their hover had been
 *   removed, for a pair the browser composes correctly on its own.
 *
 * A clash that survives all three gets one last chance at `channels.ts`'s `additiveResolution`
 * before the list is cut down to its first effect.
 *
 * A fourth question runs beside those three and is not asked of the detector at all, because it is
 * not about channels: {@link deliveryClobbers} asks whether one effect's motion can physically
 * survive being composed with another's, whatever either of them writes. It has no rescue — an
 * inline declaration outranking an author rule is a cascade fact, not a blend the browser can be
 * asked to perform — so a clobber refuses the list outright and `additiveResolution` is skipped
 * rather than consulted. Marking a track additive answers "these two both write `translate`"; it
 * has nothing to say about a rule that never becomes active.
 *
 * @returns The entries to compile — the original list, the same list marked additive, a single
 *   combo, or a single effect.
 * @complexity O(e * c) time in effects and their channels; O(c) space.
 * @overallScore 100
 */
function resolveComposition(entries: Entry[], registry: Registry, warnings: string[]): Entry[] {
  if (entries.length <= 1) return entries

  const claims = entries.map((e) => ({
    name: e.spec.name,
    channels: channelsFor(e),
    gate: e.spec.gate,
    phase: phaseOf(e),
    additive: additivelyComposable(e),
    delivery: e.resolved.preset.delivery,
    // "Writes `animation-name` inline" needs no declaration of its own: `buildPlan` sends exactly
    // the `css-keyframes` entries to `pushTrack`, and `declarations.ts` emits the longhands from
    // the tracks. Only the losing side of a delivery clobber has to say what it is.
    inlineAnimation: e.resolved.primitive.renderer === 'css-keyframes',
  }))
  const conflicts = findConflicts(claims)
  const clobbers = deliveryClobbers(claims)
  if (conflicts.length === 0 && clobbers.length === 0) return entries

  if (clobbers.length === 0) {
    const additive = additiveResolution(claims, conflicts)
    if (additive) return entries.map((e, i) => (additive.has(i) ? { ...e, composite: 'add' } : e))
  }

  const combo = registry.findCombo(entries.map((e) => e.spec.name))
  const remedy = combo
    ? `Use the "${combo.preset.name}" effect instead.`
    : 'Apply them to nested elements, or register a combined effect.'
  /*
   * Name what was dropped, not just what clashed.
   *
   * The old sentence said two effects both animate a channel and then stopped, which describes the
   * *diagnosis* and hides the *consequence*: everything after the first entry is discarded on the
   * next line, so an author who wrote `fade-up, lift` gets a page with no lift and a message that
   * never uses the word. That is the whole reason this read as "the attribute silently did nothing"
   * rather than "the library removed an effect" — the removal was the one fact left out.
   *
   * Kept inside the existing single-reporter contract deliberately. `animator.ts:222` and
   * `control.ts:350` both record that every diagnostic goes to one sink and `consoleReporter()`
   * makes them loud together; a private channel for this one message would be exactly the split
   * those comments rejected. Whether a *destructive* diagnostic should outrank the silent default
   * is a separate question about the default itself, not about this call site.
   */
  const kept = entries[0]!.spec.name
  const dropped = entries.slice(1).map((entry) => `"${entry.spec.name}"`)
  const loss = `Dropped ${dropped.join(', ')} — only "${kept}" will run.`
  // Both diagnoses in one sentence when a list manages both, rather than two warnings for one
  // refusal: the list is cut down once, so an author owed two reasons is owed them together.
  // `describeConflicts` already joins its own with `; `, so this is the same separator one level up.
  const diagnosis = [...(conflicts.length > 0 ? [describeConflicts(conflicts)] : []), ...clobbers]
  warnings.push(`cannot compose: ${diagnosis.join('; ')}. ${loss} ${remedy}`)
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
    // `defaultActivation` is deliberately absent from this loop. It is the one element-scoped fact
    // that cannot be folded per group and then merged — see `resolveDefaultActivation`, which
    // decides it once over every group's composed entries, and `mergeHostFacts`, which writes the
    // answer onto every plan including this one.
    activations = intersect(activations, primitive.supportedActivations)
    timelines = intersect(timelines, primitive.supportedTimelines)
    for (const channel of channelsFor(entry)) channels.add(channel)
    warnUnsupportedTimeline(preset.name, primitive.supportedTimelines, timeline, warnings)

    // Only the author's own overrides go inline. Preset defaults are emitted as cascade rules by
    // `scripts/generate-preset-css.mjs`; writing them to element.style made them unoverridable by
    // any consumer stylesheet, which contradicts the library's whole cascade promise.
    Object.assign(
      plan.vars,
      resolveParams(authoredParams(entry), schemaFor(entry), (m) => warnings.push(m)),
    )

    if (primitive.renderer === 'css-keyframes') pushTrack(tracks, entry, step)
    else plan.jsEffects.push(positioned(entry, step))
    pushTransitions(transitionSegments, transitionOwners, entry, warnings)
  }

  Object.assign(plan.declarations, declarationsFor(tracks, timeline))
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
    repeat: spec.repeat,
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

