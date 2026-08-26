import { gatedAnimationName } from './breakpoints.js'
import { describeConflicts, findConflicts } from './channels.js'
import { resolveParams } from './params.js'
import type { Registry, ResolvedEffect } from './registry.js'
import { suggest, timingProperty } from './registry.js'
import { durationExpression, isReadableTime, resolveSequence } from './sequence.js'
import type { SequenceMember, SequenceStep } from './sequence.js'
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

/** CSS-native timing keywords; anything else resolves to a `--kui-ease-*` custom property. */
const NATIVE_EASINGS = new Set([
  'linear',
  'ease',
  'ease-in',
  'ease-out',
  'ease-in-out',
  'step-start',
  'step-end',
])

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
 * Keyframe blocks one entry compiles, one animation track each.
 *
 * A preset names exactly one block, so this is a single-element list for the whole catalog. A
 * variant may name several — the generic tween compiles one block per CSS property group it
 * touches, because `translate` and `opacity` cannot be written from the same `@keyframes` without
 * that block also writing the properties the author never asked for. It may also name *none*,
 * which is how `data-kui="tween 400ms"` — a tween with nothing to tween — emits no animation.
 *
 * @complexity O(k) time and space in the number of blocks.
 * @overallScore 100
 */
function keyframesFor(entry: Entry): string[] {
  const { preset } = entry.resolved
  return entry.variant?.keyframes ?? [preset.keyframes ?? `kui-${preset.name}`]
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
  const warnings = [...parsed.warnings]
  const { entries, unknown } = resolveEntries(parsed.specs, registry, warnings)

  if (entries.length === 0) {
    return emptyPlan(unknown, warnings)
  }

  const composed = resolveComposition(entries, registry, warnings)
  const plan = buildPlan(composed, timeline, unknown, warnings)
  plan.reducedMotion = resolvedPolicy(plan.reducedMotion, parsed.rm, warnings)
  return plan
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
    if (resolved) {
      // Asked here, not in `buildPlan`, because `resolveComposition` runs in between and needs the
      // variant's channels to decide whether this spec may compose with its neighbours at all.
      const variant = resolved.primitive.variantFor?.(spec, (m) => warnings.push(m))
      entries.push(variant ? { spec, resolved, variant } : { spec, resolved })
      continue
    }
    unknown.push(spec.name)
    const hint = suggest(spec.name, registry.names())
    const suffix = hint ? ` — did you mean "${hint}"?` : ''
    warnings.push(`unknown effect "${spec.name}"${suffix}`)
  }

  return { entries, unknown }
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
  const tracks: AnimationTracks = {
    names: [],
    keyframes: [],
    durations: [],
    delays: [],
    easings: [],
    iterationCounts: [],
  }
  const channels = new Set<Channel>()
  // Accumulated outside `plan` so `undefined` (no effect has contributed yet) stays distinct from
  // `[]` (the composed effects genuinely share nothing) — see `intersect`.
  let activations: NamedActivation[] | undefined
  let timelines: Timeline[] | undefined
  // Resolved for the whole list up front, and over the *composed* entries rather than the parsed
  // specs: `resolveComposition` may already have dropped a conflicting effect, and an `at:` must
  // never be measured against a neighbour that is not being compiled.
  const sequence = resolveSequence(entries.map(memberFor), timeline, (m) => warnings.push(m))

  for (const [index, entry] of entries.entries()) {
    const { preset, primitive } = entry.resolved
    const step = sequence[index]!
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
  }

  Object.assign(plan.declarations, declarationsFor(tracks))
  plan.keyframeNames = tracks.keyframes
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

interface AnimationTracks {
  /** What is written to `animation-name` — an ident, or a `var()` around one when gated. */
  names: string[]
  /** The ident inside it, for `CompiledPlan.keyframeNames`. Same length, same order. */
  keyframes: string[]
  durations: string[]
  delays: string[]
  easings: string[]
  iterationCounts: string[]
}

/**
 * Custom property a looping preset's static CSS sets to `infinite` (see `ambient.css`,
 * `feedback.css`). Namespaced per *preset*, not primitive: iteration count is a fact about the
 * preset's own keyframes, not something an author configures, and presets sharing one primitive
 * are not guaranteed to agree on it.
 */
function iterationCountProperty(presetName: string): string {
  return `--kui-fx-${presetName}-iterations`
}

/**
 * Append one effect to the parallel animation lists, as one track per keyframe block it compiles.
 *
 * Separate rules cannot both contribute an `animation` declaration — the cascade discards one —
 * so composition is expressed as parallel longhand value lists on a single declaration.
 *
 * Usually one block, so usually one track. A variant naming several (`keyframesFor`) gets the same
 * timing repeated across all of them, which is the point: `tween x:100 opacity:0 800ms` is *one*
 * effect the author gave one duration, rendered as two tracks only because CSS has no way to write
 * two unrelated properties from one keyframe without also writing everything in between.
 *
 * @param step - Where the sequencer placed this segment. For a segment with no `at:` this is the
 *   segment's own delay, so the compiled output is unchanged from before sequencing existed.
 * @complexity O(k) time in the entry's keyframe count; O(k) space in the tracks.
 * @overallScore 100
 */
function pushTrack(
  tracks: AnimationTracks,
  entry: Entry,
  timeline: Timeline,
  step: SequenceStep,
): void {
  const { spec, resolved } = entry
  const id = resolved.primitive.id
  // Each track reads its *own* primitive's timing property. Sharing one `--kui-duration` across
  // tracks meant a composed effect inherited its neighbour's timing.
  const duration = durationExpression(spec.duration, id)
  const delay = staggerDelay(step.delayExpr, timeline, duration)
  const easing = easingValue(spec.easing, id)
  // Defaults to 1 (one-shot). A looping preset's own CSS sets its property to `infinite` — see
  // `iterationCountProperty`. Reading it per track, rather than a bare `animation-iteration-count:
  // infinite` in that CSS, is what stops a composed one-shot effect from inheriting the loop: CSS
  // repeats a shorter value list to match the longest one across every longhand in the group.
  const iterations = `var(${iterationCountProperty(resolved.preset.name)}, 1)`

  for (const name of keyframesFor(entry)) {
    // Every track this segment compiles carries the same gate, including the several a `tween`
    // variant produces: the author wrote one effect with one condition, and splitting it across
    // properties is an implementation detail of CSS keyframes that the gate must not leak through.
    tracks.names.push(gatedAnimationName(name, spec.gate))
    tracks.keyframes.push(name)
    tracks.durations.push(duration)
    tracks.delays.push(delay)
    tracks.easings.push(easing)
    tracks.iterationCounts.push(iterations)
  }
}

function declarationsFor(tracks: AnimationTracks): Record<string, string> {
  if (tracks.names.length === 0) return {}
  return {
    'animation-name': tracks.names.join(', '),
    'animation-duration': tracks.durations.join(', '),
    'animation-delay': tracks.delays.join(', '),
    'animation-timing-function': tracks.easings.join(', '),
    'animation-iteration-count': tracks.iterationCounts.join(', '),
    'animation-fill-mode': tracks.names.map(() => 'both').join(', '),
  }
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

/**
 * Fold stagger into the delay so the browser does the arithmetic; the scanner only writes each
 * child's index once.
 *
 * On `timeline: 'pin'` the delay does double duty as the *scrub head*. The animation is held
 * paused (see `style-plan.ts`'s `scrubbed` gate) and a negative delay of `progress x duration`
 * seeks it to the matching frame — progress 0 leaves it at its from-state, progress 1 at its
 * to-state, and every value between renders proportionally. This is why the delay needs the
 * track's own duration expression: the seek has to be in that track's time base, or a composed
 * effect whose neighbour has a different duration scrubs at the wrong rate.
 *
 * The stagger term survives untouched and keeps working, because a positive delay pushes an
 * item *back* along the same head: at progress 0.5 with `--kui-stagger: 200ms` over a 1000ms
 * track, index 0/1/2 render at 50%/30%/10%. That is the staggered scroll-scrub that pages
 * previously had to hand-write as `calc((var(--kui-progress) - var(--step)) * 5)` per child.
 *
 * A sequenced `at:` position arrives here already folded into `base`, and the two compose without
 * double-counting because they answer different questions: `at:` positions a segment against its
 * *neighbouring segments on this element*, while stagger shifts *this whole element* against its
 * siblings. Every track on the element takes the same stagger term, so the relative spacing `at:`
 * established inside the list survives the shift intact.
 *
 * @param base - The segment's start, from `core/sequence.ts`. An unwrapped sum, so it nests here
 *   without a second `calc()`.
 * @complexity O(1) time, O(1) space.
 * @overallScore 100
 */
function staggerDelay(base: string, timeline: Timeline, duration: string): string {
  const staggered = `${base} + var(--kui-i, 0) * var(--kui-stagger, 0ms)`
  if (timeline !== 'pin') return `calc(${staggered})`
  // The head spans one duration *plus* the group's whole stagger span, so the last-staggered
  // child lands exactly on its final frame at progress 1 (see `stagger.ts`). Unstaggered, the
  // `var()` fallbacks collapse the extra term to zero and this is `progress x duration`.
  const span = `${duration} + (var(--kui-stagger-count, 1) - 1) * var(--kui-stagger, 0ms)`
  return `calc(${staggered} - var(--kui-progress, 0) * (${span}))`
}

function easingValue(easing: string | undefined, primitiveId: string): string {
  if (!easing) return `var(${timingProperty(primitiveId, 'ease')}, ease-out)`
  if (NATIVE_EASINGS.has(easing)) return easing
  if (easing.includes('(')) return easing
  return `var(--kui-ease-${easing}, ease-out)`
}
