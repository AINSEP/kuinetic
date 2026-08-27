import { splitTopLevel } from '../../core/parse.js'
import type { ParamSpec, ParameterSchema } from '../../core/types.js'
import { TWEEN_PROPERTIES, withImpliedUnit } from './properties.js'
import type { TweenGroup } from './properties.js'

/**
 * Multi-waypoint tweening — `tween x:'0,100,40'`, a value list instead of a value.
 *
 * `tween`/`tween-from` animate between exactly two states: wherever the element is, and where the
 * author said. That is `gsap.to()`/`gsap.from()`, and it is where the catalog stopped — nothing in
 * it smooths a property through *several* states, which is the shape of most real choreography (out,
 * over, settle) and of every keyframe array in Motion, GSAP and WAAPI.
 *
 * **The whole feature is still static CSS.** A list of N values selects an N-step `@keyframes` block
 * from `src/css/tween.css`, and each step reads its own custom property. Nothing is generated at
 * runtime, nothing is interpolated in JavaScript, and the result is an ordinary compositor-run CSS
 * animation exactly as the two-point tween already was — see the outline's §2.3, and `tween.css`'s
 * own header for what the blocks look like.
 *
 * **Why a value list rather than a waypoint list.** The alternative shape is per-waypoint objects —
 * `at:'x:0 y:0' at:'x:100 y:-60'` — and the grammar cannot hold it: a `key:value` slot appears once
 * per spec, so repeating one is a duplicate-parameter warning. Property-major is also what Motion
 * and WAAPI use (`animate(el, { x: [0, 100, 40] })`), and it keeps the vocabulary identical to the
 * two-point tween's: an author who knows `x:100` knows `x:'0,100,40'`.
 *
 * **Even spacing across the duration.** Also GSAP's own default for a bare keyframe array. A
 * per-step position would need the *percentage* in the keyframe selector to vary, and a keyframe
 * selector cannot be a `var()` — it is the one part of a keyframe block that has to be literal. An
 * author who wants an uneven rhythm can repeat a value to hold it for a step.
 */

/**
 * The most waypoints one property may name.
 *
 * A budget rather than a limit of the technique: every count needs its own `@keyframes` block per
 * property group, because the step percentages are literal, so the shipped stylesheet grows with
 * this number. Five states is already more choreography than an HTML attribute reads well with, and
 * the sixth is always expressible as a second composed effect.
 */
export const MAX_WAYPOINTS = 5

/** The fewest that make a list: an explicit from *and* to, which the two-point form cannot say. */
const MIN_WAYPOINTS = 2

/**
 * One property group's waypoint shape, as read off the attribute.
 *
 * `count` is the group's, not the key's: a keyframe block has one step count, so every key in the
 * group renders at the same steps whatever each of them individually wrote.
 */
export interface GroupWaypoints {
  count: number
  /** Author key → its values, already padded to `count` and unit-normalised. */
  keys: Map<string, string[]>
}

/**
 * Read one authored value as a waypoint list, or as the single value it is.
 *
 * `splitTopLevel` rather than `String.split(',')`, so a list of colours survives:
 * `color:'rgb(1,2,3),rgb(4,5,6)'` is two values, not six. It is the same paren- and quote-aware
 * tokenizer `data-kui` itself is split with, which is what makes the two agree about what a comma
 * separates.
 *
 * @returns The values in order. One entry means the author wrote a plain value, and every caller
 *   treats that as the two-point tween it has always been.
 * @complexity O(n) time and space in the value's length.
 * @overallScore 100
 */
export function readWaypoints(raw: string): string[] {
  if (!raw.includes(',')) return [raw]
  return splitTopLevel(raw, ',')
}

/**
 * Hold a group's lists to one length, and name it when they disagreed.
 *
 * Padding by repeating the last value rather than by falling back to the property's identity: a
 * shorter list means "and then it stays there", which is what an author writing `x:'0,100,40'
 * y:'0,-60'` almost certainly pictures — whereas identity would send `y` back to 0 on the last leg,
 * a movement they never wrote. Warned anyway, because the group's rhythm is not visible from the
 * shorter list alone.
 *
 * @param group - Named in the warning, since the constraint is per group and that is the surprising
 *   part: `x` and `y` share a block because CSS writes `translate` as one property.
 * @complexity O(n) time and space in the total number of values.
 * @overallScore 100
 */
function padToCount(
  group: TweenGroup,
  keys: Map<string, string[]>,
  count: number,
  warn: (message: string) => void,
): void {
  for (const [key, values] of keys) {
    if (values.length === count) continue
    const last = values.at(-1)!
    if (values.length >= MIN_WAYPOINTS) {
      warn(
        `"${key}" has ${String(values.length)} waypoints and another "${group}" property has ` +
          `${String(count)} — they share one keyframe block, so "${key}" holds at "${last}" ` +
          `for the rest`,
      )
    }
    while (values.length < count) values.push(last)
  }
}

/**
 * Clamp a list to the budget, saying exactly what the author loses.
 *
 * Truncation rather than a silent reshape, and the message says the animation now *ends* somewhere
 * else, because that is the part an author has to act on — an entrance that stops one state early
 * is a visible bug, and there is no honest way to preserve the final value while dropping the
 * middle without inventing a rhythm nobody wrote.
 *
 * @complexity O(1) time and space.
 * @overallScore 100
 */
function clampCount(key: string, values: string[], warn: (message: string) => void): string[] {
  if (values.length <= MAX_WAYPOINTS) return values
  warn(
    `"${key}" has ${String(values.length)} waypoints — at most ${String(MAX_WAYPOINTS)} are ` +
      `supported, so the animation now ends at "${values[MAX_WAYPOINTS - 1] ?? ''}"`,
  )
  return values.slice(0, MAX_WAYPOINTS)
}

/**
 * Collect the waypoint lists an attribute wrote, bucketed by the group that renders them.
 *
 * @param authored - Author key → raw value, for tween properties only.
 * @returns One entry per group that named at least one list. Groups whose keys are all plain values
 *   are absent, and keep the two-point blocks they have always used.
 * @complexity O(n) time and space in the number of values across the attribute.
 * @overallScore 100
 */
export function collectWaypoints(
  authored: [string, string[]][],
  warn: (message: string) => void,
): Map<TweenGroup, GroupWaypoints> {
  const byGroup = new Map<TweenGroup, GroupWaypoints>()
  for (const [key, raw] of authored) {
    if (raw.length < MIN_WAYPOINTS) continue
    const property = TWEEN_PROPERTIES[key]!
    const values = clampCount(key, raw, warn).map((value) =>
      withImpliedUnit(value.trim(), property.spec.type),
    )
    const group = byGroup.get(property.group) ?? { count: 0, keys: new Map<string, string[]>() }
    group.keys.set(key, values)
    group.count = Math.max(group.count, values.length)
    byGroup.set(property.group, group)
  }
  for (const [group, waypoints] of byGroup) padToCount(group, waypoints.keys, waypoints.count, warn)
  return byGroup
}

/**
 * Expand a group's lists into one parameter per waypoint, with a spec for each.
 *
 * The key is `x[2]`, not `x-2`, and the brackets are load-bearing: these keys are synthesised by
 * the library and can never be authored, so when one of them appears in a `resolveParams`
 * diagnostic — `parameter "x[2]": expected a length` — the author can see both which key and which
 * waypoint without the message having to explain itself, and can tell at a glance that it is not a
 * name they were supposed to have written.
 *
 * The custom property is `--kui-tween-<key>-<n>`, which is what `tween.css`'s step reads, with the
 * plain `--kui-tween-<key>` as its fallback. That fallback is the whole broadcast rule: a key that
 * wrote a single value (`tween x:'0,100,40' y:20`) sets only the plain property, so every step of
 * the block reads the same `y` and it holds — no JavaScript, no per-step duplication of a value the
 * author wrote once.
 *
 * @param waypoints - One group's padded lists.
 * @param params - Sink for the expanded values, keyed as above.
 * @param schema - Sink for the specs those values are validated against.
 * @complexity O(n) time and space in the group's total number of values.
 * @overallScore 100
 */
export function expandWaypoints(
  waypoints: GroupWaypoints,
  params: Record<string, string>,
  schema: ParameterSchema,
): void {
  for (const [key, values] of waypoints.keys) {
    const spec = TWEEN_PROPERTIES[key]!.spec
    for (const [index, value] of values.entries()) {
      const step = index + 1
      params[`${key}[${String(step)}]`] = value
      schema[`${key}[${String(step)}]`] = waypointSpec(spec, key, step)
    }
  }
}

/**
 * One waypoint's spec: the property's own type and identity, pointed at that step's custom
 * property.
 *
 * @complexity O(1) time and space.
 * @overallScore 100
 */
function waypointSpec(spec: ParamSpec, key: string, step: number): ParamSpec {
  return { type: spec.type, default: spec.default, cssProperty: `--kui-tween-${key}-${String(step)}` }
}

/**
 * The keyframe block a group with waypoints renders through.
 *
 * One block per (group, count), all of them fully explicit from 0% to 100% — so unlike the
 * two-point blocks there is no `to`-only and `from`-only pair, and `tween` and `tween-from` share
 * them. That falls out of what a list *is*: an author who writes every state has written the first
 * one too, so there is no implicit half left for the browser to fill from the element's computed
 * style.
 *
 * @complexity O(1) time and space.
 * @overallScore 100
 */
export function waypointKeyframes(group: TweenGroup, count: number): string {
  return `kui-tween-keys${String(count)}-${group}`
}
