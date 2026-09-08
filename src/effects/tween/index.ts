import type { Registry } from '../../core/registry.js'
import type {
  EffectSpec,
  EffectVariant,
  ParameterSchema,
  Preset,
  Primitive,
  Timeline,
} from '../../core/types.js'
import { cssPrimitive } from '../shared.js'
import {
  TWEEN_GROUP_CHANNELS,
  TWEEN_GROUP_ORDER,
  TWEEN_PROPERTIES,
  TWEEN_SCHEMA,
  tweenValue,
} from './properties.js'
import type { TweenGroup } from './properties.js'
import {
  collectWaypoints,
  expandWaypoints,
  readWaypoints,
  waypointKeyframes,
} from './waypoints.js'
import type { GroupWaypoints } from './waypoints.js'

/**
 * The generic tween — the one effect that is not in the catalog.
 *
 * Everything else in `effects/` is a name with a fixed meaning: `fade-up` moves up and fades, and
 * an author who wants something the catalog does not have is stuck. This closes that: the author
 * names the properties instead of the effect.
 *
 *     <div data-kui="tween x:100 opacity:0 rotate:45deg 800ms">   <!-- to the given values -->
 *     <div data-kui="tween-from y:40 opacity:0 600ms">            <!-- from them, to rest -->
 *
 * **It renders as CSS keyframes, like the rest of the catalog.** That is worth stating because
 * "arbitrary values" reads like a reason to reach for JavaScript, and it is not one: the compiler
 * already writes author values into custom properties, and a static `@keyframes` block that
 * interpolates `var(--kui-tween-x)` is an ordinary CSS animation running off the main thread. The
 * arbitrary part is the *value*, which CSS was always going to resolve at computed-value time
 * anyway; the *properties* are a fixed vocabulary (see `properties.ts`) with a keyframe block each.
 *
 * **The other half of "from the element's current state" is free.** A keyframe block that declares
 * only a `to` step has its `from` step constructed by the browser from the element's own computed
 * style — so `tween x:100` starts wherever the element already is, with nothing measuring anything
 * and no forced layout. `tween-from` is the mirror: a `from`-only block, whose implicit `to` is
 * the element's natural state. That is exactly GSAP's `.to()`/`.from()` pair, and CSS has had it
 * all along.
 *
 * **Why two names rather than one name and a `from` token.** The sketch for this feature spelled
 * the second form `tween from y:40`, and the grammar has nowhere to put that: a spec is
 * `name [duration] [delay] [easing] key:value*` (see `core/parse.ts`), where the first token is the
 * name and every later bare token is either a time or an easing. Admitting a bare keyword would
 * mean every future mistyped token had to be checked against a keyword list before it could be
 * reported as unrecognised, weakening the one diagnostic the grammar has, for one effect's benefit.
 * Encoding direction in the name is also simply what this library already does — `fade-in`/
 * `fade-out`, `flip-in-x`/`flip-out-x`, 48 names in the entrance matrix built exactly this way.
 */

type TweenDirection = 'to' | 'from'

/**
 * Same list as the entrance family (`catalog/core.ts`'s `ENTRANCE_TIMELINES`), and for the same
 * reason: a tween is a one-shot from A to B, which is meaningful whether the thing driving it is a
 * clock, the element's travel through the viewport, or a pinned scrub. Nothing here reads the
 * timeline — the whole mechanism is the compiled `animation-*` declaration.
 */
const TWEEN_TIMELINES: Timeline[] = ['time', 'view', 'scroll', 'pin']

/**
 * Warn when a `from` tween starts at zero scale.
 *
 * A collapsed start makes viewport activation depend on a point or line instead of the resting
 * box. This can strand an entrance outside the observer root, but is not a guaranteed deadlock:
 * IntersectionObserver explicitly allows zero-area targets to intersect. Diagnose the risk
 * without claiming to know the element's geometry, its transforms, or its activation at compile time.
 *
 * A warning rather than a clamp, and rather than the `[data-kui-state='ready']` gate the six
 * presets use. Clamping would silently animate something other than what the author wrote, and the
 * ready-gate trick works there because those keyframes have one known collapsing value to
 * neutralise — here the from-state *is* the author's parameter, so neutralising it would make every
 * legitimate `tween-from scale:0.5` sit at full size while it waits and then jump when released.
 *
 * @complexity O(1) time and space — three fixed keys.
 * @overallScore 100
 */
function warnZeroScale(name: string, starts: Record<string, string>, warn: (m: string) => void): void {
  const zero = ['scale-x', 'scale-y'].filter((key) => Number(starts[key] ?? starts.scale ?? '1') === 0)
  if (zero.length === 0) return
  warn(
    `"${name}" starts with no box area on ${zero.join(', ')}, which can prevent on:enter activation ` +
      `depending on its geometry — use a small non-zero scale, or on:load`,
  )
}

/**
 * The state each key starts the animation *at*, which is the only thing the zero-area trap cares
 * about.
 *
 * For a plain `tween-from` that is the authored value. For a waypoint list it is the first value,
 * whichever direction the name says — a list writes its own 0% step, so `tween x:'0,…' scale:'0,1'`
 * walks into the same deadlock `tween-from scale:0` does, and a check that only ran for `from`
 * would have missed exactly the new spelling.
 *
 * @complexity O(p) time and space in the authored property count.
 * @overallScore 100
 */
function startStates(
  direction: TweenDirection,
  values: [string, string[]][],
  params: Record<string, string>,
): Record<string, string> {
  const starts: Record<string, string> = {}
  // The whole group gets an explicit 0% step, including scalar neighbours. Checking the shape
  // of each key alone misses `scale-x:0` held throughout `scale-y:'1,2'`.
  const explicit = new Set(values.filter(([, list]) => list.length > 1).map(([key]) => TWEEN_PROPERTIES[key]!.group))
  for (const [key] of values) {
    if (direction === 'from' || explicit.has(TWEEN_PROPERTIES[key]!.group)) {
      // Invalid values are absent, just as they are in CSS. In particular `0banana` must not be
      // diagnosed as zero by parseFloat while validation leaves the identity fallback in charge.
      if (params[key] !== undefined) starts[key] = params[key]
    }
  }
  return starts
}

/**
 * Sort the properties an author named into the keyframe blocks that render them.
 *
 * @param direction - Which end of the animation the authored values sit at.
 * @param spec - The authored spec, untouched — the returned params are a fresh record.
 * @param warn - Diagnostic sink, used for a tween that animates nothing and for the zero-scale trap.
 * @returns The channels, keyframe blocks and normalised parameters for this one attribute.
 * @complexity O(p) time and space in the number of authored parameters.
 * @overallScore 100
 */
function buildVariant(
  direction: TweenDirection,
  spec: EffectSpec,
  warn: (message: string) => void,
): EffectVariant {
  const params: Record<string, string> = Object.create(null)
  const values = authoredValues(spec, params, warn)
  const groups = new Set(values.map(([key]) => TWEEN_PROPERTIES[key]!.group))

  const touched = TWEEN_GROUP_ORDER.filter((group) => groups.has(group))
  if (touched.length === 0) {
    warn(
      `"${spec.name}" names no properties to animate — add at least one, e.g. ` +
        `"${spec.name} x:100" (known: ${Object.keys(TWEEN_PROPERTIES).join(', ')})`,
    )
    return { channels: [], keyframes: [], params }
  }
  warnZeroScale(spec.name, startStates(direction, values, params), warn)

  const waypoints = collectWaypoints(values, warn)
  const schema: ParameterSchema = {}
  for (const group of waypoints.values()) expandWaypoints(group, params, schema, warn)
  for (const group of touched) {
    const key = `${group}[ease]`
    const easing = groupEasing(direction, spec, group)
    params[key] = easing.value
    schema[key] = easing.schema
  }

  const variant: EffectVariant = {
    channels: touched.map((group) => TWEEN_GROUP_CHANNELS[group]),
    keyframes: touched.map((group) => keyframesFor(group, direction, waypoints.get(group))),
    params,
    schema,
  }
  return variant
}

/**
 * Keep author-controlled record writes in a null-prototype sink. An own-property lookup protects
 * the vocabulary, but is not enough on its own: assigning an unknown `__proto__` to `{}` invokes
 * its setter and loses the key before the core can report the unknown parameter.
 */
function authoredValues(spec: EffectSpec, params: Record<string, string>, warn: (message: string) => void) {
  const values: [string, string[]][] = []

  for (const [key, raw] of Object.entries(spec.params)) {
    // `Object.hasOwn`, not a truthiness test on the lookup: a plain object resolves `constructor`
    // and `__proto__` through `Object.prototype`, so an author-controlled key would read as a
    // known property and then fail on `.group`. Same rule, same reason, as `core/parse.ts`'s
    // hoist table and `resolveParams`' schema lookup.
    const property = Object.hasOwn(TWEEN_PROPERTIES, key) ? TWEEN_PROPERTIES[key] : undefined
    if (!property) {
      // Not a tween property — `duration`, `delay`, `ease` and `stagger` all arrive this way when
      // spelled as pairs. Passed through untouched for `resolveParams` to accept or name.
      params[key] = raw
      continue
    }
    const list = readWaypoints(raw)
    values.push([key, list])
    // The plain custom property is written whatever the shape. For a single value it is the whole
    // animation; for a list it is the broadcast fallback every step falls back to, which is what
    // lets one key in a group write a list and its neighbour write a value that simply holds.
    const accepted = tweenValue(key, list[0]!, warn)
    if (accepted !== undefined) params[key] = accepted
  }

  return values
}

/**
 * A keyframe-local easing lets groups use different curves without changing the compiler's
 * shared animation timing list. Its fallback must preserve positional easing precedence and the
 * correct primitive's CSS theme variable, including for waypoint blocks shared by both names.
 * The keyword schema admits only this library-generated var() expression; author curves still
 * use the core easing validator and its named-curve/spring conversion.
 *
 * The two branches are written out rather than folded into one object with a ternary `type`,
 * because {@link ParamSpec} is now a union discriminated on `type` — a `'keyword'` spec must carry
 * a closed `keywords` list and an `'easing'` spec must not carry one at all, and a conditional
 * type cannot say which of those it is. Writing both is also the more honest shape: the value
 * being validated is a different thing in each case (an author's curve, or this function's own
 * generated `var()`), and only one of them ever needed the literal.
 */
function groupEasing(direction: TweenDirection, spec: EffectSpec, group: TweenGroup) {
  const id = direction === 'from' ? 'tween-from' : 'tween'
  const fallback = `var(--kui-${id}-ease, ease-out)`
  const cssProperty = `--kui-tween-${group}-default-ease`
  if (spec.easing) {
    return { value: spec.easing, schema: { type: 'easing' as const, default: fallback, cssProperty } }
  }
  return {
    value: fallback,
    schema: { type: 'keyword' as const, default: fallback, keywords: [fallback], cssProperty },
  }
}

/**
 * Which block renders one group: the half-keyframe pair the two-point tween has always used, or the
 * fully explicit N-step block a waypoint list selects.
 *
 * @complexity O(1) time and space.
 * @overallScore 100
 */
function keyframesFor(
  group: TweenGroup,
  direction: TweenDirection,
  waypoints: GroupWaypoints | undefined,
): string {
  return waypoints ? waypointKeyframes(group, waypoints.count) : `kui-tween-${direction}-${group}`
}

/**
 * One direction of the tween.
 *
 * `channels: []` is the honest static answer and not an oversight: on its own the primitive writes
 * nothing, and every channel it ends up claiming comes from `variantFor` reading the attribute.
 * `perfClass: 'paint'` is the upper bound across the vocabulary — the transform and opacity groups
 * are compositor work, but `color` and `background-color` repaint, and a primitive gets one class
 * for all the attributes that can be written with it.
 *
 * @complexity O(p) time and space in the shared schema's size.
 * @overallScore 100
 */
function tweenPrimitive(id: string, direction: TweenDirection): Primitive {
  return {
    ...cssPrimitive(id, [], {
      timelines: TWEEN_TIMELINES,
      parameters: TWEEN_SCHEMA,
      perfClass: 'paint',
    }),
    variantFor: (spec, warn) => buildVariant(direction, spec, warn),
  }
}

export const TWEEN_PRIMITIVES: Primitive[] = [
  tweenPrimitive('tween', 'to'),
  tweenPrimitive('tween-from', 'from'),
]

/**
 * Two names, no parameter defaults of their own.
 *
 * `tween-from` cloaks and `tween` does not, which is the same rule every other name in the catalog
 * follows: a `from` tween's start state is installed by the runtime, so between first paint and
 * `start()` the element is painted at its *rest* state and then jumps back to animate — the flash
 * `Preset.cloak` exists to remove. A `to` tween starts at the rest state by construction, so there
 * is nothing to hide and cloaking it would blank an element that was always meant to be visible.
 *
 * **Neither declares `phase`, and that is deliberate — checked against the actual stylesheet, not
 * assumed from "generic effect, therefore unknowable".**
 *
 * `tween` (the `to` direction) is knowable and the answer is still "no phase fits". Every block in
 * `kui-tween-to-*` (`src/css/tween.css`) declares an explicit `to` — `translate: var(--kui-tween-x,
 * 0) ...`, not a missing endpoint — so, per D1's correction #5, `animation-fill-mode: both` pins that
 * exact authored value on the channel forever once the animation finishes; it never resolves against
 * whatever the cascade underneath would otherwise say. That is precisely the shape `EffectPhase`'s
 * own doc calls out as the trap: fifteen of the catalog's fifty-four `cloak: true` entrances close
 * their block the same way and are *deliberately* left unphased rather than marked `entrance`,
 * because `entrance` specifically means "plays once and releases the channel". `tween` is that same
 * closed shape by construction — every property group's `to` block closes, with no exception — so it
 * belongs in that same deliberately-unphased set on the same grounds, not because nothing is known.
 * It is not `state` either (nothing gates it behind a visitor condition — it runs the moment it
 * activates), not `idle` (it is a bounded, one-shot animation, not an unbounded loop), and not `exit`
 * (it does not start at rest and depart; it moves *to* an arbitrary authored value).
 *
 * `tween-from` is where "cannot be known statically" is the literal, checked reason, not a hedge.
 * Its two-point blocks (`kui-tween-from-*`) are the mirror of `tween`'s — `from` is explicit and `to`
 * is missing, so a plain `tween-from y:40` *does* release: it is structurally identical to an open
 * entrance like `fade-up`, and would be a defensible `phase: 'entrance'` on its own. But
 * `waypoints.ts`'s `waypointKeyframes` compiles a **different, fully-explicit block** the moment any
 * key in the group is authored as a list — `tween-from x:'0,100,40'` renders through
 * `kui-tween-keys3-translate`, whose own comment in `tween.css` says it plainly: "unlike everything
 * above they are fully explicit from 0% to 100%... there is no implicit half left for the browser to
 * fill from computed style." That block does **not** release, for the same fill-forever reason
 * `tween`'s `to` blocks do not. So whether this preset's one instance releases its channel depends on
 * whether the *author* wrote a single value or a list for at least one key in the group — a fact
 * about the spec, not about the preset, and exactly the shape D1 was killed over (`repeat:` turning
 * a finite entrance into a loop at author time, invisible to a preset-level field). Declaring
 * `phase: 'entrance'` here would be right for `tween-from y:40` and silently wrong for `tween-from
 * y:'0,40'` on the very same element — the "wrong phase is worse than none" case this project was
 * warned about, so it stays undeclared and collides with everything, exactly as before this field
 * existed. See `test/catalog-phase-mechanics.test.ts` for what stays checked instead.
 */
export const TWEEN_PRESETS: Preset[] = [
  { name: 'tween', primitive: 'tween' },
  { name: 'tween-from', primitive: 'tween-from', cloak: true },
]

/**
 * Register the generic tween.
 *
 * @param registry - Registry to populate.
 * @returns The same registry, for chaining.
 * @complexity O(1) time and space — two primitives, two presets.
 * @overallScore 100
 */
export function registerTween(registry: Registry): Registry {
  return registry.registerPrimitives(TWEEN_PRIMITIVES).registerPresets(TWEEN_PRESETS)
}
