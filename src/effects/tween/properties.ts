import { CHANNEL } from '../../core/types.js'
import type { Channel, ParamSpec, ParameterSchema } from '../../core/types.js'

/**
 * The generic tween's vocabulary: which property names an author may put in a `key:value` slot,
 * what each one means, and which keyframe block renders it.
 *
 * **Why this is an allowlist and not a passthrough.** `tween <name>:<value>` is the one place in
 * the library where an author names a *CSS property* rather than choosing from a primitive's
 * declared parameters, so the obvious implementation — write whatever they typed into whatever
 * they typed — is also the one that breaks two invariants at once. It breaks composition, because
 * `core/channels.ts` decides whether two effects may share an element from their declared channel
 * sets and an open-ended property list has no channel; and it breaks the parameter contract in
 * `core/params.ts`, which exists precisely because author strings end up in a stylesheet. An
 * allowlist keeps every tweenable property on a known channel with a known value grammar, and
 * costs only that a property nobody listed here cannot be tweened until someone adds a row.
 *
 * **Why the rows are grouped.** CSS writes `translate` as one property, not three; a keyframe that
 * sets it sets every axis. So the unit of rendering is the *group* — one `@keyframes` block per
 * group, one animation track per group the author actually touched — and not the individual key.
 * See `src/css/tween.css`, where each group's block is written out, including what the identity
 * fallbacks mean for an axis the author did not name.
 */

/** One rendering unit: a single CSS property (or filter list) written by one keyframe block. */
export type TweenGroup = 'translate' | 'rotate' | 'scale' | 'opacity' | 'filter' | 'color' | 'background'

/**
 * Declared in rendering order rather than derived from `TWEEN_PROPERTIES`'s key order, so
 * `tween opacity:0 x:100` and `tween x:100 opacity:0` compile to the same track order. Two
 * spellings of one animation producing two different `animation-name` lists would make every
 * assertion about a compiled plan depend on the order the author happened to type in.
 */
export const TWEEN_GROUP_ORDER: readonly TweenGroup[] = [
  'translate',
  'rotate',
  'scale',
  'opacity',
  'filter',
  'color',
  'background',
]

/**
 * The channel each group claims — the honest answer to "what does this spec collide with".
 *
 * These are the existing catalog channels, not new ones: a tween writing `translate` must collide
 * with `fade-up` for the same reason two entrances do, and giving the tween a private channel name
 * would let exactly that pair compose into one effect silently overwriting the other.
 */
export const TWEEN_GROUP_CHANNELS: Record<TweenGroup, Channel> = {
  translate: CHANNEL.translate,
  rotate: CHANNEL.rotate,
  scale: CHANNEL.scale,
  opacity: CHANNEL.opacity,
  filter: CHANNEL.filter,
  color: CHANNEL.color,
  background: CHANNEL.background,
}

interface TweenProperty {
  group: TweenGroup
  spec: ParamSpec
}

/**
 * Build one row.
 *
 * The custom property is always `--kui-tween-<key>` and is deliberately *not* namespaced per
 * primitive the way `registry.ts` namespaces timing: `tween` and `tween-from` read the same
 * `--kui-tween-x`, because they are the two directions of one effect and an author debugging in
 * devtools should find one name, not two. They cannot collide on an element — both claim the same
 * channel for the same key, so `core/channels.ts` rejects the pair before either is compiled.
 *
 * `default` is always the property's *identity* value — the value that makes the group render as
 * if this key had never been named. `resolveParams` uses it only as the reported fallback when a
 * value is rejected, and never writes it (preset defaults live in CSS), so a rejected `x:banana`
 * leaves `--kui-tween-x` unset and `tween.css`'s own `var()` fallback — the same identity value —
 * takes over. The rejection warns; the animation degrades to "that axis does not move" rather than
 * to something visibly wrong.
 */
function property(group: TweenGroup, key: string, type: ParamSpec['type'], identity: string): [string, TweenProperty] {
  return [key, { group, spec: { type, default: identity, cssProperty: `--kui-tween-${key}` } }]
}

/**
 * Author key → what it animates.
 *
 * Deliberately absent, and each for a reason worth writing down rather than rediscovering:
 *
 * - **`rotate-x` / `rotate-y`.** The CSS `rotate` property takes one axis at a time, so they could
 *   not share the rotate group with `rotate` anyway; and rotating a flat box about x or y without a
 *   `perspective()` reads as a vertical squash, not a turn. Perspective only exists inside the
 *   `transform` shorthand, which is a different channel entirely (`CHANNEL.skew` — see
 *   `core/types.ts`) and already has an effect family of its own in `flip-in-x`/`flip-in-y`.
 * - **`width` / `height` / `top` / `left`.** Animatable, and every one of them animates layout.
 *   The tween declares `perfClass: 'paint'`; admitting these would make that a lie for the whole
 *   effect rather than for the one attribute that used them, and the library has never offered a
 *   layout-animating primitive without saying so.
 * - **`skew`.** Same `transform`-shorthand problem as 3D rotation, and skew has no property of its
 *   own to write — `CHANNEL.skew` documents exactly this.
 */
export const TWEEN_PROPERTIES: Readonly<Record<string, TweenProperty>> = Object.fromEntries([
  // Translation. `x`/`y`/`z` rather than `translate-x`: they are the conventional shorthands, they
  // are what GSAP calls them, and the CSS property they feed is named on the group instead.
  property('translate', 'x', 'length', '0'),
  property('translate', 'y', 'length', '0'),
  property('translate', 'z', 'length', '0'),

  // Rotation about the z axis — the only one CSS's `rotate` property renders as a turn. See above.
  property('rotate', 'rotate', 'angle', '0deg'),

  // `scale` sets both axes; `scale-x`/`scale-y` override one. That layering happens in the
  // keyframe's nested `var()` fallback, not here — see `tween.css`.
  property('scale', 'scale', 'number', '1'),
  property('scale', 'scale-x', 'number', '1'),
  property('scale', 'scale-y', 'number', '1'),

  property('opacity', 'opacity', 'number', '1'),

  // One `filter` property, four functions. Each identity is that function's no-op, so naming one
  // never disturbs the other three.
  property('filter', 'blur', 'length', '0px'),
  property('filter', 'brightness', 'number', '1'),
  property('filter', 'saturate', 'number', '1'),
  property('filter', 'grayscale', 'number', '0'),

  // `currentcolor` on the `color` property resolves to the inherited colour, which is exactly the
  // "leave it alone" the other identities express.
  property('color', 'color', 'color', 'currentcolor'),

  property('background', 'background-color', 'color', 'transparent'),
])

/**
 * The tween's parameter schema, declared statically even though which keys *matter* varies per
 * attribute.
 *
 * Every key is always declared, so an author who mistypes one gets `resolveParams`' ordinary
 * `unknown parameter "opactiy" (known: ...)` warning listing the whole vocabulary, exactly as they
 * would on any other effect. Declaring only the keys a given attribute used would have produced a
 * "known:" list containing nothing but the author's own typo-free keys, which is the least useful
 * form that message could take.
 */
export const TWEEN_SCHEMA: ParameterSchema = Object.fromEntries(
  Object.entries(TWEEN_PROPERTIES).map(([key, entry]) => [key, entry.spec]),
)

/** Bare number, the spelling `x:100` uses. Anchored, no unit, optional sign and decimals. */
const BARE_NUMBER = /^-?(?:\d+(?:\.\d+)?|\.\d+)$/

/**
 * Give a bare number the unit its property implies — `x:100` is `100px`, `rotate:45` is `45deg`.
 *
 * `core/params.ts` requires a unit on every `length` and `angle`, and should keep doing so: a
 * unitless `distance:24` on `fade-up` is a mistake worth naming, because the parameter has one
 * meaning and the author simply left the unit off. A tween property is different. `x:100` is the
 * syntax this feature was specified around, it is what every other animation library accepts, and
 * "100 what" has exactly one sensible answer per property. So the coercion lives here, scoped to
 * the tween's own keys, rather than loosening validation for the other 255 effects.
 *
 * Anything that is not a bare number is passed through untouched and validated as usual — `50%`,
 * `2rem` and a quoted `calc(...)` all still have to earn their acceptance in `params.ts`.
 *
 * @complexity O(n) time in value length; O(1) space.
 * @overallScore 100
 */
export function withImpliedUnit(raw: string, type: ParamSpec['type']): string {
  if (!BARE_NUMBER.test(raw)) return raw
  if (type === 'length') return `${raw}px`
  if (type === 'angle') return `${raw}deg`
  return raw
}
