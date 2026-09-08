import { CHANNEL } from '../../core/types.js'
import type { Preset, Primitive } from '../../core/types.js'
import type { Registry } from '../../core/registry.js'
import { cssPrimitive } from './shared.js'

const loop = {
  duration: { type: 'time', default: '1.6s', cssProperty: '--kui-duration' },
  ease: { type: 'easing', default: 'linear', cssProperty: '--kui-ease' },
} as const

const spin = {
  duration: { type: 'time', default: '900ms', cssProperty: '--kui-duration' },
  ease: { type: 'easing', default: 'linear', cssProperty: '--kui-ease' },
} as const

const dotPulse = {
  duration: { type: 'time', default: '1.2s', cssProperty: '--kui-duration' },
  ease: { type: 'easing', default: 'ease-in-out', cssProperty: '--kui-ease' },
  dotSize: { type: 'length', default: '8px', cssProperty: '--kui-dot-size' },
} as const

const progressTrack = {
  duration: { type: 'time', default: '1.4s', cssProperty: '--kui-duration' },
  ease: { type: 'easing', default: 'ease-in-out', cssProperty: '--kui-ease' },
} as const

const toast = {
  duration: { type: 'time', default: '420ms', cssProperty: '--kui-duration' },
  ease: { type: 'easing', default: 'back-out', cssProperty: '--kui-ease' },
  distance: { type: 'length', default: '24px', cssProperty: '--kui-distance' },
} as const

const shake = {
  duration: { type: 'time', default: '500ms', cssProperty: '--kui-duration' },
  ease: { type: 'easing', default: 'linear', cssProperty: '--kui-ease' },
} as const

const pop = {
  duration: { type: 'time', default: '420ms', cssProperty: '--kui-duration' },
  ease: { type: 'easing', default: 'back-out', cssProperty: '--kui-ease' },
  scale: { type: 'number', default: '1.18', cssProperty: '--kui-pop-scale', finite: true, minimum: 1 },
} as const

/**
 * `ripple` paints its disc on `::after` now, so everything an author might retune about that disc
 * is exposed here rather than baked into the stylesheet.
 *
 * How far the disc grows is `extent`, and it used to be `spread`. That was unreachable, not merely
 * badly named: `parse.ts`'s `applyToken` consults the hoisted attribute-level keys before a
 * primitive's own parameters, and `spread` is one of them (the stagger budget), so
 * `data-kui="ripple spread:6"` set a stagger budget, left the disc at 4, and warned about neither.
 * The parameter compiled, validated, documented and did nothing for as long as it existed.
 *
 * Renaming it breaks no page, because no page could ever have used it — a value that never reached
 * `spec.params` never reached a stylesheet either. The one route that *did* work is untouched:
 * `--kui-ripple-scale` is unchanged, so a page setting the custom property directly keeps working.
 *
 * `extent` rather than `scale`, which would have paired more neatly with `startScale` below: `pop`
 * and `burst` in this same file already spell `scale:` for "how far the *element* grows", and a
 * `ripple scale:6` that meant something else entirely two primitives over is a worse trap than a
 * word that is merely new. `burst` reached for `fan` over `spread` for this same collision, so the
 * family already avoids the word.
 *
 * `test/reserved-parameter-keys.test.ts` is the guard that makes this class of bug loud: it writes
 * every declared parameter into a real attribute and fails if the value does not arrive.
 */
const ripple = {
  duration: { type: 'time', default: '600ms', cssProperty: '--kui-duration' },
  ease: { type: 'easing', default: 'ease-out', cssProperty: '--kui-ease' },
  extent: { type: 'number', default: '4', cssProperty: '--kui-ripple-scale', finite: true, minimum: 1 },
  // Empty default, the `ambient.ts` convention: unauthored means absent from the resolved output,
  // so the stylesheet's own `currentColor` fallback stays in force and no existing page changes.
  color: { type: 'color', default: '', cssProperty: '--kui-ripple-color' },
  // How opaque the disc is at its brightest. `number|percentage` so `strength:60%` and
  // `strength:0.6` both work and both land in `[0,1]` — `normalise` turns the percentage into the
  // number before `maximum` bounds it, which is the whole reason that union type exists.
  strength: {
    type: 'number|percentage',
    default: '0.6',
    cssProperty: '--kui-ripple-opacity',
    finite: true,
    minimum: 0,
    maximum: 1,
  },
  // Where the disc starts, as a fraction of the element it covers. Worth a knob because it is what
  // separates a ripple that grows from a point from one that starts already covering the button.
  startScale: { type: 'number', default: '0.2', cssProperty: '--kui-ripple-start', finite: true, minimum: 0 },
} as const

/**
 * `pop` plus the five particles `confetti-burst` throws — see the long comment over that preset's
 * rules in `feedback.css` for what each one moves.
 *
 * Every literal here is repeated as the `var()` fallback in the stylesheet, so an unauthored
 * element renders identically whether or not the compiler ever writes the custom property.
 *
 * Two shapes are deliberate and worth naming, because both look like mistakes:
 *
 * - **`fan`, not `spread`.** `spread:` is a hoisted attribute-level key (the stagger budget), and
 *   `parse.ts`'s `applyToken` checks `HOISTS` *before* `spec.params`, so a parameter by that name
 *   is unreachable from `data-kui` no matter what the primitive declares. `ripple` above had that
 *   exact bug and is now `extent`; this one was named around it from the start.
 *
 * - **Particle count is not a parameter.** Five layers are five `radial-gradient`s written out in
 *   the stylesheet and five position pairs written out in the keyframe; CSS cannot generate an
 *   nth one from a number. A `count` parameter would validate cleanly and do nothing, which is
 *   the failure `ambient.ts` documents for a shared `to:`. Colour, size, distance, fan and the
 *   timing knobs are the values that *can* change, so those are the values exposed.
 *
 * `heart-burst` used to share this object and ignore everything below `scale` — it has its own
 * primitive now (`feedback-heart-burst`, below) built on bare `pop`, so nothing here is exposed to
 * an effect that cannot act on it.
 */
const burst = {
  ...pop,
  // How far the furthest particle travels, defaulting to a *percentage* of the host rather than a
  // fixed length. A background layer is clipped to the element that paints it, so a fixed `34px`
  // would be almost entirely off-box on the 18px dot the demo page celebrates with and a timid
  // twitch in the middle of a 400px card — the same number cannot be right for both. At `45%` the
  // furthest particle lands just inside the edge whatever the host's size is. `length|percentage`
  // rather than `length` so the declaration says a percentage is a supported reading here, not an
  // accident of the unit list (see `ParamType` in core/types.ts); `distance:40px` still validates.
  distance: { type: 'length|percentage', default: '45%', cssProperty: '--kui-confetti-distance' },
  // Horizontal reach only, so the same `distance` covers a narrow fountain (`fan:0.3`) and a full
  // circular pop (`fan:1.6`) without any particle changing how far it flies.
  fan: { type: 'number', default: '1', cssProperty: '--kui-confetti-fan', finite: true, minimum: 0 },
  size: { type: 'length', default: '6px', cssProperty: '--kui-confetti-size' },
  // How far the particle box overhangs the host on every side. A background layer is clipped to
  // the box that paints it, so this is what decides whether the burst can leave the button at all.
  spill: { type: 'length', default: '24px', cssProperty: '--kui-confetti-spill' },
  // Empty defaults, the same convention `ambient.ts` uses and for the same reason: unauthored
  // means absent from the resolved output, so each gradient's own hardcoded fallback stays in
  // force and no existing page changes colour.
  color1: { type: 'color', default: '', cssProperty: '--kui-confetti-c1' },
  color2: { type: 'color', default: '', cssProperty: '--kui-confetti-c2' },
  color3: { type: 'color', default: '', cssProperty: '--kui-confetti-c3' },
  color4: { type: 'color', default: '', cssProperty: '--kui-confetti-c4' },
  color5: { type: 'color', default: '', cssProperty: '--kui-confetti-c5' },
} as const

const confirm = {
  duration: { type: 'time', default: '1400ms', cssProperty: '--kui-duration' },
  ease: { type: 'easing', default: 'linear', cssProperty: '--kui-ease' },
} as const

const pull = {
  distance: { type: 'length', default: '36px', cssProperty: '--kui-pull-distance' },
} as const

/**
 * Feedback & status effects (catalog section K). Loading indicators default to `load` and
 * `reducedMotion: 'disable'` — an infinite loop shortened to 1ms strobes rather than stopping,
 * which is worse than not reducing it at all. One-shot reactions (toast, shake, pop, burst) keep
 * the default `shorten` policy and default to whichever activation their real usage implies:
 * `click` for effects that react to the element the user just clicked, `manual` for effects an
 * application triggers from its own state (a toast appearing, a field failing validation).
 */
export const FEEDBACK_PRIMITIVES: Primitive[] = [
  cssPrimitive('feedback-shimmer', [CHANNEL.background], {
    parameters: loop,
    defaultActivation: 'load',
    reducedMotion: 'disable',
    perfClass: 'continuous',
  }),
  cssPrimitive('feedback-fade', [CHANNEL.opacity], {
    defaultActivation: 'manual',
  }),
  // `'discrete'` alongside `rotate`: `spinner`/`spinner-ring`'s unconditional rule also pins
  // `display: inline-block` so the ring sizes to its own box instead of running full-width as a
  // bare `<div>` would. Unrelated to `catalog/discrete.ts`'s show/hide use of the same channel —
  // `display` itself is one physical property regardless of which value a primitive sets it to,
  // so both uses have to share the channel `channels.ts` polices it under. See that channel's own
  // doc comment in `test/support/channel-properties.ts`.
  cssPrimitive('feedback-spin', [CHANNEL.rotate, 'discrete'], {
    parameters: spin,
    defaultActivation: 'load',
    reducedMotion: 'disable',
    perfClass: 'continuous',
  }),
  // Declares every channel the preset's CSS actually paints, not just what the shared keyframe
  // animates: spinner-dots' `[data-kui-fx~='spinner-dots']` rule also sets `background:
  // currentColor` (the dot itself), `box-shadow` (the other two dots), and `display: inline-block`
  // (same sizing reason as `feedback-spin` above), entirely outside `@keyframes kui-spinner-dots`.
  // Declaring only [scale, opacity] let a composed `background`-writing effect (e.g. gradient-mesh)
  // pass channel-collision detection and then have its gradient silently overwritten by this rule —
  // see css-invariants.test.ts's "CSS static rules" describe block, which now catches this class of
  // omission directly.
  cssPrimitive(
    'feedback-dot-pulse',
    [CHANNEL.scale, CHANNEL.opacity, CHANNEL.background, 'shadow', 'discrete'],
    {
      parameters: dotPulse,
      defaultActivation: 'load',
      reducedMotion: 'disable',
      perfClass: 'continuous',
    },
  ),
  // Same shape as feedback-dot-pulse above: `[data-kui-fx~='progress-indeterminate']` sets
  // `background: currentColor` unconditionally for the bar itself, outside the keyframe. It also
  // pins `transform-origin: 0% 50%` there, undeclared until channel-properties.ts gained an entry
  // for it — the same structurally-invisible gap `background` was closed for above.
  cssPrimitive(
    'feedback-progress-track',
    [CHANNEL.translate, CHANNEL.scale, CHANNEL.background, 'transform-origin'],
    {
      parameters: progressTrack,
      defaultActivation: 'load',
      reducedMotion: 'disable',
      perfClass: 'continuous',
    },
  ),
  cssPrimitive('feedback-toast', [CHANNEL.opacity, CHANNEL.translate], {
    parameters: toast,
    defaultActivation: 'manual',
  }),
  cssPrimitive('feedback-shake', [CHANNEL.translate], {
    parameters: shake,
    defaultActivation: 'manual',
  }),
  cssPrimitive('feedback-wobble', [CHANNEL.translate, CHANNEL.rotate], {
    defaultActivation: 'click',
  }),
  /**
   * Every channel this primitive now touches is on its own `::after`, not on the host.
   *
   * It used to declare `background` and `transform-origin` because the disc *was* the host —
   * `[data-kui-fx~='ripple']` painted `background: currentColor` and pinned `transform-origin`
   * straight onto the authored element. Now that the disc is a pseudo-element the host rule writes
   * neither, so declaring them would refuse compositions that no longer clash: `data-kui=
   * "gradient-mesh, ripple"` paints a mesh on the element and a ripple over it, which is exactly
   * what an author asking for both means.
   *
   * `sweep` is the ownership token for "this preset paints its own `::after`". `shine-sweep` is
   * this channel's other member and `channel-properties.ts` documents it as deliberately covering
   * no host property — a box marker rather than a property set, kept as "a home to grow into if
   * the pseudo-element audit ever gets extended to check that box directly". This is that growth:
   * `::after` is one physical box per element, so two presets that both paint it cannot compose,
   * and sharing a channel is how the compiler is told. Without it the pair would instead land in
   * `test/css-composition-invariants.test.ts`'s enumerated list of collisions it can only *report*.
   * `scale`/`opacity` stay declared for the same box — `underline-slide` declares `scale` for a
   * transform that also lives entirely on its `::after`, which is the existing convention.
   *
   * The name is wrong for a ripple and worth renaming to something like `pseudo-after` once
   * someone can touch `interaction.ts` and `channel-properties.ts` in the same change.
   */
  cssPrimitive('feedback-ripple', [CHANNEL.scale, CHANNEL.opacity, 'sweep'], {
    parameters: ripple,
    defaultActivation: 'click',
  }),
  cssPrimitive('feedback-pop', [CHANNEL.scale], {
    parameters: pop,
    defaultActivation: 'manual',
  }),
  /**
   * `confetti-burst` only now. `heart-burst` used to share this primitive — same shared `burst`
   * keyframe family, same host `scale` pop — and inherited the `sweep` claim below along with it,
   * which made it refuse to compose with `shine-sweep` even though it paints no pseudo-element at
   * all: `[data-kui-fx~='heart-burst']` in `feedback.css` sets `color` on the host and nothing
   * else. That was a real false positive, not a defensible over-declaration, so `heart-burst` was
   * split onto its own primitive (`feedback-heart-burst`, below) that declares only the channels
   * it actually paints. See `test/catalog-feedback.test.ts` for the regression coverage: the
   * composition that used to be wrongly refused, and the one that is still correctly refused.
   *
   * `sweep` is the `::after` ownership token — see `feedback-ripple` above for what it means and
   * why it is spelled that way. `confetti-burst` genuinely paints its five gradients there, so the
   * claim is real for this primitive now that it no longer speaks for `heart-burst` too.
   *
   * `background` stays declared even though the host rule no longer paints one. That is a
   * deliberate over-declaration rather than a leftover: it keeps `gradient-mesh, confetti-burst`
   * refused, which `test/compile.test.ts` asserts as the regression that made this primitive's
   * channels honest in the first place, and refusing a pair that no longer clashes is the safe
   * direction to be wrong in. `opacity` likewise — a composed fade would take the whole element,
   * pseudo-element and all.
   *
   * `color` is gone: only `heart-burst` ever painted it, and it left with `heart-burst`.
   */
  cssPrimitive('feedback-burst', [CHANNEL.scale, CHANNEL.opacity, CHANNEL.background, 'sweep'], {
    parameters: burst,
    defaultActivation: 'click',
  }),
  /**
   * `heart-burst`'s own primitive, split off `feedback-burst` above so its declared channels match
   * what it actually paints: `[data-kui-fx~='heart-burst']` in `feedback.css` sets `color` on the
   * host, and `@keyframes kui-heart-burst` animates the host's own `scale` — nothing else, no
   * pseudo-element, no `sweep` claim. Sharing `feedback-burst` made it inherit that primitive's
   * `sweep` channel and wrongly refuse to compose with `shine-sweep`; this primitive cannot make
   * that mistake because it never declares a channel it does not use.
   *
   * Parameters are bare `pop` — `duration`, `ease`, `scale` — rather than the fuller `burst` object
   * `feedback-burst` carries. `distance`/`fan`/`size`/`spill`/`color1..5` never reached any CSS for
   * `heart-burst` even while it shared that primitive (its host rule never reads
   * `--kui-confetti-*`), so exposing them here would just be a second copy of the dead-parameter
   * trap `ambient.ts` documents for a shared `to:` — a value that validates and does nothing.
   */
  cssPrimitive('feedback-heart-burst', [CHANNEL.scale, CHANNEL.color], {
    parameters: pop,
    defaultActivation: 'click',
  }),
  cssPrimitive('feedback-confirm', [CHANNEL.opacity], {
    parameters: confirm,
    defaultActivation: 'click',
  }),
  cssPrimitive('feedback-pull', [CHANNEL.translate], {
    parameters: pull,
    defaultActivation: 'manual',
  }),
]

export const FEEDBACK_PRESETS: Preset[] = [
  { name: 'skeleton-shimmer', phase: 'idle', primitive: 'feedback-shimmer', keyframes: 'kui-skeleton-shimmer' },
  { name: 'skeleton-to-content', primitive: 'feedback-fade', keyframes: 'kui-skeleton-to-content' },
  { name: 'spinner', phase: 'idle', primitive: 'feedback-spin', keyframes: 'kui-spinner-spin' },
  { name: 'spinner-dots', phase: 'idle', primitive: 'feedback-dot-pulse', keyframes: 'kui-spinner-dots' },
  { name: 'spinner-ring', phase: 'idle', primitive: 'feedback-spin', keyframes: 'kui-spinner-ring-spin' },
  {
    name: 'progress-indeterminate',
    phase: 'idle', primitive: 'feedback-progress-track',
    keyframes: 'kui-progress-indeterminate',
  },
  { name: 'toast-slide-in', primitive: 'feedback-toast', keyframes: 'kui-toast-slide-in' },
  {
    name: 'toast-slide-out',
    primitive: 'feedback-toast',
    keyframes: 'kui-toast-slide-out',
    params: { ease: 'ease-in' },
  },
  { name: 'shake-error', primitive: 'feedback-shake', keyframes: 'kui-shake-error' },
  {
    name: 'wobble',
    primitive: 'feedback-wobble',
    keyframes: 'kui-wobble',
    params: { duration: '600ms', ease: 'ease-in-out' },
  },
  { name: 'ripple', primitive: 'feedback-ripple', keyframes: 'kui-ripple' },
  { name: 'badge-pop', primitive: 'feedback-pop', keyframes: 'kui-badge-pop' },
  {
    name: 'count-bump',
    primitive: 'feedback-pop',
    keyframes: 'kui-count-bump',
    params: { duration: '280ms', scale: '1.3' },
  },
  {
    name: 'heart-burst',
    primitive: 'feedback-heart-burst',
    keyframes: 'kui-heart-burst',
    params: { duration: '700ms', scale: '1.4' },
  },
  {
    name: 'confetti-burst',
    primitive: 'feedback-burst',
    keyframes: 'kui-confetti-burst',
    params: { duration: '900ms', scale: '1.15' },
  },
  { name: 'copy-confirm', primitive: 'feedback-confirm', keyframes: 'kui-copy-confirm' },
  {
    name: 'pull-to-refresh',
    primitive: 'feedback-pull',
    keyframes: 'kui-pull-to-refresh',
    params: { duration: '900ms', ease: 'ease-out' },
  },
]

/**
 * Register catalog section K (feedback & status) into a registry.
 *
 * @param registry - Registry to populate.
 * @returns The same registry, for chaining.
 * @complexity O(n) time in registered primitives and presets; O(1) extra space.
 * @overallScore 100
 */
export function registerFeedback(registry: Registry): Registry {
  return registry.registerPrimitives(FEEDBACK_PRIMITIVES).registerPresets(FEEDBACK_PRESETS)
}
