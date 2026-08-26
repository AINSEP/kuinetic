import { describeConflicts, findConflicts } from './channels.js'
import { resolveParams } from './params.js'
import type { Registry, ResolvedEffect } from './registry.js'
import { suggest, timingProperty } from './registry.js'
import type {
  Activation,
  Channel,
  EffectSpec,
  NamedActivation,
  ParsedValue,
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
}

export interface CompiledPlan {
  /** Effect names to stamp into `data-kui-fx` for CSS hooks and debugging. */
  fxNames: string[]
  /** Custom properties to write. Author overrides only — defaults stay in CSS `var()` fallbacks. */
  vars: Record<string, string>
  /** Longhand animation declarations, compiled as parallel lists so effects compose. */
  declarations: Record<string, string>
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
  return buildPlan(composed, timeline, unknown, warnings)
}

function emptyPlan(unknown: string[], warnings: string[]): CompiledPlan {
  return {
    fxNames: [],
    vars: {},
    declarations: {},
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
      entries.push({ spec, resolved })
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
 * @returns The entries to compile — either the original list, a single combo, or a single effect.
 * @complexity O(e * c) time in effects and their channels; O(c) space.
 * @overallScore 100
 */
function resolveComposition(entries: Entry[], registry: Registry, warnings: string[]): Entry[] {
  if (entries.length <= 1) return entries

  const conflicts = findConflicts(
    entries.map((e) => ({ name: e.spec.name, channels: e.resolved.primitive.channels })),
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

  for (const entry of entries) {
    const { preset, primitive } = entry.resolved
    plan.fxNames.push(preset.name)
    plan.reducedMotion = strictestPolicy(plan.reducedMotion, primitive.reducedMotion)
    plan.defaultActivation ??= primitive.defaultActivation
    activations = intersect(activations, primitive.supportedActivations)
    timelines = intersect(timelines, primitive.supportedTimelines)
    for (const channel of primitive.channels) channels.add(channel)
    warnUnsupportedTimeline(preset.name, primitive.supportedTimelines, timeline, warnings)

    // Only the author's own overrides go inline. Preset defaults are emitted as cascade rules by
    // `scripts/generate-preset-css.mjs`; writing them to element.style made them unoverridable by
    // any consumer stylesheet, which contradicts the library's whole cascade promise.
    Object.assign(
      plan.vars,
      resolveParams(entry.spec.params, primitive.parameters, (m) => warnings.push(m)),
    )

    if (primitive.renderer === 'css-keyframes') pushTrack(tracks, entry, timeline)
    else plan.jsEffects.push(entry)
  }

  Object.assign(plan.declarations, declarationsFor(tracks))
  // `activations`/`timelines` start `undefined` only until the loop's first iteration; `compile`
  // already returns `emptyPlan` before `buildPlan` is ever called with zero entries, so the loop
  // above always runs at least once and both are real arrays (possibly empty) by here.
  plan.supportedActivations = activations!
  plan.supportedTimelines = timelines!
  plan.channels = [...channels]
  return plan
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
  names: string[]
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
 * Append one effect to the parallel animation lists.
 *
 * Separate rules cannot both contribute an `animation` declaration — the cascade discards one —
 * so composition is expressed as parallel longhand value lists on a single declaration.
 *
 * @complexity O(1) time, O(1) space.
 * @overallScore 100
 */
function pushTrack(tracks: AnimationTracks, entry: Entry, timeline: Timeline): void {
  const { spec, resolved } = entry
  const id = resolved.primitive.id
  tracks.names.push(resolved.preset.keyframes ?? `kui-${resolved.preset.name}`)
  // Each track reads its *own* primitive's timing property. Sharing one `--kui-duration` across
  // tracks meant a composed effect inherited its neighbour's timing.
  const duration = spec.duration ?? `var(${timingProperty(id, 'duration')}, 600ms)`
  tracks.durations.push(duration)
  tracks.delays.push(staggerDelay(spec.delay, id, timeline, duration))
  tracks.easings.push(easingValue(spec.easing, id))
  // Defaults to 1 (one-shot). A looping preset's own CSS sets its property to `infinite` — see
  // `iterationCountProperty`. Reading it per track, rather than a bare `animation-iteration-count:
  // infinite` in that CSS, is what stops a composed one-shot effect from inheriting the loop: CSS
  // repeats a shorter value list to match the longest one across every longhand in the group.
  tracks.iterationCounts.push(`var(${iterationCountProperty(resolved.preset.name)}, 1)`)
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
 * @complexity O(1) time, O(1) space.
 * @overallScore 100
 */
function staggerDelay(
  delay: string | undefined,
  primitiveId: string,
  timeline: Timeline,
  duration: string,
): string {
  const base = delay ?? `var(${timingProperty(primitiveId, 'delay')}, 0ms)`
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
