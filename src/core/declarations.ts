import { gatedAnimationName } from './breakpoints.js'
import type { Entry } from './compile.js'
import { cssEasingValue } from './easing.js'
import { timingProperty } from './registry.js'
import { directionValue, playbackExpression } from './repeat.js'
import { durationExpression } from './sequence.js'
import type { SequenceStep } from './sequence.js'
import type { Timeline } from './types.js'

/**
 * The CSS-emission half of the compiler: how one resolved entry becomes longhand declarations.
 *
 * `compile.ts` decides *what* animates — which effects resolve, which `target:` group they belong
 * to, whether they may compose, what the reduced-motion policy is. This file decides *how that is
 * spelled in CSS*: the parallel `animation-*` value lists that let composed effects share one
 * declaration, and the merged `transition` shorthand that does the same job for the ten presets
 * that transition rather than keyframe. Nothing here reads a registry, a parse tree, or a target
 * group; nothing in `compile.ts` writes a CSS value string any more.
 *
 * The `Entry` import is deliberately type-only, so the module graph edge exists at type level and
 * nowhere at runtime — `.dependency-cruiser.cjs` resolves the graph with `tsPreCompilationDeps:
 * false` precisely because `import type` is erased by `verbatimModuleSyntax` and a mutual type
 * reference is not an initialisation-order hazard. `Entry` stays in `compile.ts` because that is
 * where entries are built and where every other consumer already imports it from.
 */

export interface AnimationTracks {
  /** What is written to `animation-name` — an ident, or a `var()` around one when gated. */
  names: string[]
  /** The ident inside it, for `CompiledPlan.keyframeNames`. Same length, same order. */
  keyframes: string[]
  durations: string[]
  /**
   * Where each track *starts*, as an unwrapped `calc()` sum. Left unwrapped because
   * {@link declarationsFor} is what finalizes it: on a pin timeline it folds the scrub head into
   * the same expression, and `calc(calc(a + b) - c)` buries the arithmetic an author has to read
   * in a devtools panel.
   */
  delays: string[]
  /**
   * Where each track *ends* — its start plus its whole playback — as an unwrapped sum.
   *
   * Read only to size the pin scrub head, which has to span the element's longest track rather
   * than each track's own playback. Accumulated for every timeline because it costs one string
   * concatenation and knowing the timeline here would buy nothing else.
   */
  ends: string[]
  easings: string[]
  iterationCounts: string[]
  /**
   * One `animation-direction` per track. Almost always every entry is `normal`, which is the CSS
   * initial value — see {@link declarationsFor} for why that case emits no declaration at all.
   */
  directions: string[]
}

/**
 * A fresh accumulator for one plan's worth of tracks.
 *
 * @complexity O(1) time and space.
 * @overallScore 100
 */
export function emptyTracks(): AnimationTracks {
  return {
    names: [],
    keyframes: [],
    durations: [],
    delays: [],
    ends: [],
    easings: [],
    iterationCounts: [],
    directions: [],
  }
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
export function pushTrack(tracks: AnimationTracks, entry: Entry, step: SequenceStep): void {
  const { spec, resolved } = entry
  const id = resolved.primitive.id
  // Each track reads its *own* primitive's timing property. Sharing one `--kui-duration` across
  // tracks meant a composed effect inherited its neighbour's timing.
  const duration = durationExpression(spec.duration, id)
  const delay = staggerDelay(step.delayExpr)
  // The segment's *whole* playback, so a `repeat:3` track is not read as ending after one play.
  const end = `${step.delayExpr} + ${playbackExpression(duration, spec.repeat)}`
  const easing = easingValue(spec.easing, id)
  // Defaults to 1 (one-shot). A looping preset's own CSS sets its property to `infinite` — see
  // `iterationCountProperty`. Reading it per track, rather than a bare `animation-iteration-count:
  // infinite` in that CSS, is what stops a composed one-shot effect from inheriting the loop: CSS
  // repeats a shorter value list to match the longest one across every longhand in the group.
  //
  // An authored `repeat:` replaces that `var()` with a literal rather than writing the custom
  // property inline, and the difference matters: `--kui-*` is a flat inherited namespace, so an
  // inline `--kui-fx-glow-pulse-iterations` would be picked up by any descendant also carrying
  // `glow-pulse`. `animation-iteration-count` is not inherited, so the literal cannot travel.
  //
  // It is a sanitized value by the time it arrives — `compile.ts`'s `refusePlayback` has already
  // dropped anything the renderer or the timeline cannot honour.
  const iterations = spec.repeat ?? `var(${iterationCountProperty(resolved.preset.name)}, 1)`
  const direction = directionValue(spec.yoyo)

  for (const name of keyframesFor(entry)) {
    // Every track this segment compiles carries the same gate, including the several a `tween`
    // variant produces: the author wrote one effect with one condition, and splitting it across
    // properties is an implementation detail of CSS keyframes that the gate must not leak through.
    tracks.names.push(gatedAnimationName(name, spec.gate))
    tracks.keyframes.push(name)
    tracks.durations.push(duration)
    tracks.delays.push(delay)
    tracks.ends.push(end)
    tracks.easings.push(easing)
    tracks.iterationCounts.push(iterations)
    tracks.directions.push(direction)
  }
}

/**
 * Append one entry's declared {@link TransitionSegment}s to the element's merged transition list.
 *
 * Reuses `durationExpression`/`easingValue` — the same two functions `pushTrack` resolves an
 * `animation-duration`/`-timing-function` through — so `data-kui="lift 400ms"` reaches a
 * transitioned property and a keyframed one through one code path that cannot disagree with
 * itself. The delay is a per-*preset* custom-property slot (`--kui-tx-delay-<name>`) rather than a
 * shared `animation-delay`-style list: the CSS state rule (`:hover`, `[aria-expanded]`) that
 * actually triggers the transition writes that slot directly (see `interaction.css`), and distinct
 * property names per preset are what let two composed presets carry independent delays without a
 * second clobber one level down.
 *
 * Mutates `segments`/`owners` rather than returning a value, the same accumulator shape `pushTrack`
 * already uses for `tracks` — a per-entry return would need concatenating at every call site for no
 * benefit, since every caller already owns one shared list for the whole composed entry set.
 *
 * @param segments - Accumulator of `"property duration easing delay"` strings, mutated in place.
 * @param owners - property → the preset name that most recently claimed it, mutated in place, kept
 *   only to name both presets in the duplicate-property warning below.
 * @param entry - The composed entry to read `preset.transitions` from.
 * @param warnings - Diagnostic sink. Two presets transitioning the same property compose — the
 *   channel model does not forbid it, and CSS resolves the shorthand's last occurrence
 *   deterministically — but the author is owed a name for which one wins.
 * @complexity O(t) time and space in the preset's declared transition segment count.
 * @overallScore 100
 */
export function pushTransitions(
  segments: string[],
  owners: Map<string, string>,
  entry: Entry,
  warnings: string[],
): void {
  const { spec, resolved } = entry
  const { preset, primitive } = resolved

  for (const segment of preset.transitions ?? []) {
    const previousOwner = owners.get(segment.property)
    if (previousOwner !== undefined && previousOwner !== preset.name) {
      warnings.push(
        `"${previousOwner}" and "${preset.name}" both transition ${segment.property} — ` +
          `"${preset.name}" wins (last in the list)`,
      )
    }
    owners.set(segment.property, preset.name)

    const duration = segment.duration ?? durationExpression(spec.duration, primitive.id)
    const easing = segment.easing ?? easingValue(spec.easing, primitive.id)
    const delay = `var(--kui-tx-delay-${preset.name}, 0ms)`
    segments.push(`${segment.property} ${duration} ${easing} ${delay}`)
  }
}

/**
 * Collapse the parallel track lists into the `animation-*` longhands they compile to.
 *
 * Six of them unconditionally, and `animation-direction` only when some track actually alternates.
 * That last one is not tidiness: `normal` is the CSS initial value, so emitting a list of them
 * would be a no-op declaration written onto every animated element on every page for the sake of
 * the rare one that uses `yoyo:`. Omitting it is what keeps an attribute written before `yoyo:`
 * existed compiling byte-for-byte identically. When it *is* emitted it carries one value per
 * track, the full length — a shorter list would be repeated by the browser to match
 * `animation-name` and would silently alternate a neighbour that never asked to.
 *
 * The delays arrive unwrapped and are finalized here, because the pin scrub head is the one term
 * in them that cannot be computed per track — see {@link pinnedDelays}.
 *
 * @complexity O(t) time and space in the track count.
 * @overallScore 100
 */
export function declarationsFor(
  tracks: AnimationTracks,
  timeline: Timeline,
): Record<string, string> {
  if (tracks.names.length === 0) return {}
  const delays = timeline === 'pin' ? pinnedDelays(tracks) : tracks.delays.map(wrapped)
  const declarations: Record<string, string> = {
    'animation-name': tracks.names.join(', '),
    'animation-duration': tracks.durations.join(', '),
    'animation-delay': delays.join(', '),
    'animation-timing-function': tracks.easings.join(', '),
    'animation-iteration-count': tracks.iterationCounts.join(', '),
    'animation-fill-mode': tracks.names.map(() => 'both').join(', '),
  }
  if (tracks.directions.some((value) => value !== 'normal')) {
    declarations['animation-direction'] = tracks.directions.join(', ')
  }
  return declarations
}

/**
 * Fold stagger into the delay so the browser does the arithmetic; the scanner only writes each
 * child's index once.
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
function staggerDelay(base: string): string {
  return `${base} + var(--kui-i, 0) * var(--kui-stagger, 0ms)`
}

/** Close an unwrapped sum into the `calc()` a declaration can actually carry. */
function wrapped(sum: string): string {
  return `calc(${sum})`
}

/**
 * Seek every track by scroll progress, which is what `timeline: 'pin'` makes the delay mean.
 *
 * The animation is held paused (see `style-plan.ts`'s `scrubbed` gate) and a negative delay of
 * `progress x head` seeks it to the matching frame — progress 0 leaves it at its from-state,
 * progress 1 at its to-state, and every value between renders proportionally.
 *
 * The head is one number for the whole element: how long its compiled timeline runs, start to
 * finish. It used to be each track's *own* playback, which is right only for the single-track,
 * zero-delay element and silently wrong for everything else, because a track's start is subtracted
 * from a head that never included it. `fade-up 1s timeline:pin, zoom-in 1s at:after` computed
 * `1s - 1 x 1s = 0s` for the second track at progress 1 and left it sitting on its first frame,
 * unreachable at any scroll position; `fade-up delay:300ms timeline:pin` stopped half way through
 * for the same reason. Spanning the element instead — the furthest any of its tracks ends — puts
 * progress 1 on the last frame of the last track and leaves every earlier one held at its own end
 * by `animation-fill-mode: both`.
 *
 * `max()` rather than the last track's end because `at:with` and a negative `at:` offset both let
 * an earlier segment finish last, and an unsequenced list has no order to its ends at all.
 *
 * The stagger term survives untouched and keeps working, because a positive delay pushes an item
 * *back* along the same head: at progress 0.5 with `--kui-stagger: 200ms` over a 1000ms track,
 * index 0/1/2 render at 50%/30%/10%. That is the staggered scroll-scrub that pages previously had
 * to hand-write as `calc((var(--kui-progress) - var(--step)) * 5)` per child. The head is widened
 * by the group's whole stagger span so the last-staggered child still lands exactly on its final
 * frame at progress 1 (see `stagger.ts`); unstaggered, the `var()` fallbacks collapse that term to
 * zero.
 *
 * An authored `repeat:` is already inside each end, through `playbackExpression`, which is the only
 * reading under which `repeat:3 timeline:pin` means anything: with a one-iteration head, progress 1
 * lands on the end of the first play and iterations 2 and 3 are unreachable no matter how far the
 * page is scrolled — a knob that exists and does nothing, which is worse than a missing one.
 * Widened, the pin scrubs all three, and with `yoyo:true` it scrubs forward and back. It is the
 * same expression the `at:` sequencer builds for "after the previous one ends", so the two cannot
 * disagree about how long a repeated effect takes.
 *
 * `repeat:infinite` never reaches here — `compile.ts`'s `refusePlayback` drops it under `pin` and
 * says why — because there is no finite head that spans it and `calc(600ms * infinite)` is not an
 * expression.
 *
 * @complexity O(t) time and space in the track count.
 * @overallScore 100
 */
function pinnedDelays(tracks: AnimationTracks): string[] {
  // Deduplicated because a variant compiling several keyframe blocks pushes the same end once per
  // block, and `max(a, a)` is noise in a value an author reads in devtools.
  const ends = [...new Set(tracks.ends)]
  const span = ends.length === 1 ? ends[0]! : `max(${ends.join(', ')})`
  const head = `${span} + (var(--kui-stagger-count, 1) - 1) * var(--kui-stagger, 0ms)`
  return tracks.delays.map((delay) => wrapped(`${delay} - var(--kui-progress, 0) * (${head})`))
}

/**
 * The timing function one segment compiles to.
 *
 * Only the "the author wrote nothing" branch lives here; every authored spelling resolves through
 * `core/easing.ts`, which the `ease:` *parameter* path goes through too. Keeping one resolver is
 * the point: the two spellings reach CSS by different routes (`animation-timing-function` here,
 * `--kui-<primitive>-ease` there) and had drifted into two different answers for the same token.
 *
 * @complexity O(1) amortised — see `cssEasingValue`; O(1) space.
 * @overallScore 100
 */
function easingValue(easing: string | undefined, primitiveId: string): string {
  if (!easing) return `var(${timingProperty(primitiveId, 'ease')}, ease-out)`
  return cssEasingValue(easing)
}
