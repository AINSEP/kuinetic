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
  withImpliedUnit,
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
 * This is trap #2 from the repo's own list, and the tween is the first effect that can walk into it
 * from an *attribute* rather than from a keyframe someone wrote. An element scaled to nothing has
 * no box; `IntersectionObserver` measures geometry, not paint, so it never intersects; so the
 * default `on:enter` activation never fires; so it never leaves the state that made it invisible.
 * Six presets shipped that deadlock before it was understood.
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
  const zero = ['scale', 'scale-x', 'scale-y'].filter((key) => Number.parseFloat(starts[key] ?? '1') === 0)
  if (zero.length === 0) return
  warn(
    `"${name} ${zero[0]}:0" starts with no box at all, so an on:enter activation can never see it ` +
      `and the element stays invisible forever — use a small non-zero scale, or on:load`,
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
function startStates(direction: TweenDirection, values: [string, string[]][]): Record<string, string> {
  const starts: Record<string, string> = {}
  for (const [key, list] of values) {
    if (list.length > 1 || direction === 'from') starts[key] = list[0]!
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
  const groups = new Set<TweenGroup>()
  const params: Record<string, string> = {}
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
    groups.add(property.group)
    const list = readWaypoints(raw)
    values.push([key, list])
    // The plain custom property is written whatever the shape. For a single value it is the whole
    // animation; for a list it is the broadcast fallback every step falls back to, which is what
    // lets one key in a group write a list and its neighbour write a value that simply holds.
    params[key] = withImpliedUnit(list[0]!.trim(), property.spec.type)
  }

  const touched = TWEEN_GROUP_ORDER.filter((group) => groups.has(group))
  if (touched.length === 0) {
    warn(
      `"${spec.name}" names no properties to animate — add at least one, e.g. ` +
        `"${spec.name} x:100" (known: ${Object.keys(TWEEN_PROPERTIES).join(', ')})`,
    )
    return { channels: [], keyframes: [], params }
  }
  warnZeroScale(spec.name, startStates(direction, values), warn)

  const waypoints = collectWaypoints(values, warn)
  const schema: ParameterSchema = {}
  for (const group of waypoints.values()) expandWaypoints(group, params, schema)

  const variant: EffectVariant = {
    channels: touched.map((group) => TWEEN_GROUP_CHANNELS[group]),
    keyframes: touched.map((group) => keyframesFor(group, direction, waypoints.get(group))),
    params,
  }
  if (Object.keys(schema).length > 0) variant.schema = schema
  return variant
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
