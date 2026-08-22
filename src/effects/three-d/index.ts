import { CHANNEL, inertInstance } from '../../core/types.js'
import type { Preset, Primitive } from '../../core/types.js'
import type { Registry } from '../../core/registry.js'
import { cssPrimitive } from '../shared.js'

/**
 * 3D, perspective, and page-transition effects — all CSS-rendered.
 *
 * Nothing here needs JavaScript: the browser interpolates `rotate`, `clip-path`, and `opacity`
 * natively, so these cost a keyframe block and a registry row each. That ratio is the whole
 * architecture, and it is why tripling the catalog does not triple the payload.
 */

/**
 * A two-sided card that stays on whichever face you turned it to.
 *
 * Not the same thing as `card-flip-y`, despite the names living in the same section. That is an
 * *entrance*: one keyframe, half a turn, played once, with nothing on the other side. This is a
 * component with a front and a back and a state in between, which a keyframe cannot express —
 * a one-shot animation has no way to come back.
 *
 * So it works the way `forms.css`'s native-state family and the section E icon toggles work: the
 * whole effect is a CSS transition keyed off an attribute the author already maintains. Here that
 * is `aria-pressed` on the control *inside* the card, reached with `:has()`, which means the
 * accessibility state and the visual state cannot drift apart — there is only one of them.
 *
 * `prepare` is inert. Registration exists to stamp `data-kui-fx` and resolve the timing parameters
 * onto the card, which the faces then inherit.
 */
const CARD_TOGGLE_PRIMITIVE: Primitive = {
  id: 'card-toggle',
  renderer: 'javascript',
  channels: [CHANNEL.rotate],
  parameters: {
    duration: { type: 'time', default: '700ms', cssProperty: '--kui-duration' },
    ease: { type: 'easing', default: 'ease-in-out', cssProperty: '--kui-ease' },
    perspective: { type: 'length', default: '1600px', cssProperty: '--kui-perspective' },
  },
  supportedTimelines: ['time'],
  supportedActivations: ['load'],
  defaultActivation: 'load',
  perfClass: 'compositor',
  reducedMotion: 'disable',
  prepare: () => inertInstance(),
}

export const THREE_D_PRIMITIVES: Primitive[] = [
  // `skew`, not `rotate`: the keyframes in three-d.css write `transform: perspective(...)
  // rotateX/Y(...)`, not the individual `rotate:` property — `perspective` only creates depth for
  // an element's *children*, so giving one of these effects its own depth means reaching for the
  // `perspective()` transform *function*, which only exists inside the `transform` shorthand.
  // `CHANNEL.skew` is this catalog's name for "claims the whole `transform` shorthand"; see the
  // comment on it in `core/types.ts`.
  cssPrimitive('flip-face', [CHANNEL.skew], {
    parameters: {
      angle: { type: 'angle', default: '180deg', cssProperty: '--kui-from-angle' },
      perspective: { type: 'length', default: '1200px', cssProperty: '--kui-perspective' },
    },
  }),

  cssPrimitive('page-reveal', [CHANNEL.opacity, CHANNEL.translate], {
    parameters: { distance: { type: 'length', default: '40px', cssProperty: '--kui-distance' } },
  }),

  cssPrimitive('wipe', [CHANNEL.clip]),

  // `from` gives `loading-bar` a real knob on its start scale — it had none before, unlike
  // `flip-face`'s `angle:` two rows up. `--kui-bar-from` is also what the fold-panel-style
  // `[data-kui-fx~='loading-bar'][data-kui-state='ready']` gate neutralizes in three-d.css; see
  // that rule's comment for the on:enter fix this parameter doubles as.
  cssPrimitive('bar', [CHANNEL.scale], {
    parameters: { from: { type: 'number', default: '0', cssProperty: '--kui-bar-from' } },
  }),

  CARD_TOGGLE_PRIMITIVE,
]

export const THREE_D_PRESETS: Preset[] = [
  // --- 3D & perspective ---
  { name: 'card-flip-y', primitive: 'flip-face', keyframes: 'kui-card-flip-y', cloak: true },
  { name: 'card-flip-x', primitive: 'flip-face', keyframes: 'kui-card-flip-x', cloak: true },
  { name: 'cube-rotate', primitive: 'flip-face', keyframes: 'kui-cube-rotate', params: { angle: '90deg' } },
  {
    name: 'book-page-turn',
    primitive: 'flip-face',
    keyframes: 'kui-book-page-turn',
    params: { angle: '-160deg', duration: '900ms' },
  },
  // `cloak: true`, unlike its `flip-face` siblings above: those are `to`-only keyframes, so their
  // paused/waiting box is the ordinary, untransformed rest state. `fold-panel` is `from`-only —
  // its `rotateX(-90deg)` (three-d.css) *is* the paused box, edge-on and zero-height, so it holds
  // no space in layout for the whole wait; see the
  // `[data-kui-fx~='fold-panel'][data-kui-state='ready']` rule in three-d.css for the other half
  // of that fix. `cloak` only ever hid the pre-JS flash, not this, but adding it here keeps the
  // pre-JS and post-JS "ready" appearances the same (invisible) instead of trading one flash for
  // the other.
  {
    name: 'fold-panel',
    primitive: 'flip-face',
    keyframes: 'kui-fold-panel',
    params: { angle: '-90deg' },
    cloak: true,
  },

  // --- page transitions ---
  { name: 'page-fade', primitive: 'page-reveal', keyframes: 'kui-page-fade' },
  { name: 'page-slide', primitive: 'page-reveal', keyframes: 'kui-page-slide' },
  { name: 'curtain-wipe', primitive: 'wipe', keyframes: 'kui-curtain-wipe', params: { duration: '800ms' } },
  // `cloak: true` for the same reason as `fold-panel`: `kui-loading-bar`'s `from { scale: 0 1 }`
  // (three-d.css) is a zero-width box, not just an invisible one — see that file's
  // `[data-kui-fx~='loading-bar'][data-kui-state='ready']` rule.
  { name: 'loading-bar', primitive: 'bar', keyframes: 'kui-loading-bar', cloak: true },

  // No `keyframes`: its motion is a CSS transition in three-d.css keyed off the control's
  // aria-pressed, not a compiled animation. Same shape as the icon toggles in svg.ts.
  { name: 'flip-card', primitive: 'card-toggle' },
]

/**
 * Register the 3D and page-transition catalog.
 *
 * @param registry - Registry to populate.
 * @returns The same registry, for chaining.
 * @complexity O(n) time in the number of primitives and presets.
 * @overallScore 100
 */
export function registerThreeD(registry: Registry): Registry {
  return registry.registerPrimitives(THREE_D_PRIMITIVES).registerPresets(THREE_D_PRESETS)
}
