import { CHANNEL } from '../../core/types.js'
import type { Cleanup, EffectParams, Preset, PrepareContext, Primitive } from '../../core/types.js'
import { deferPrepare } from '../../core/instances.js'
import type { Registry } from '../../core/registry.js'
import { ALL_TIMING_TOKENS, cssPrimitive, mirrorTimingToCss, TRIGGER_DELAY_PARAM } from '../shared.js'
import { supportsFineHover } from '../catalog/interaction-shared.js'

/**
 * 3D, perspective, and page-transition effects — all CSS-rendered.
 *
 * Nothing here needs JavaScript: the browser interpolates `rotate`, `clip-path`, and `opacity`
 * natively, so these cost a keyframe block and a registry row each. That ratio is the whole
 * architecture, and it is why tripling the catalog does not triple the payload.
 */

/** The card's own state lives on this control's `aria-pressed`; three-d.css reads it via `:has()`. */
const FLIP_CONTROL_SELECTOR = ':scope > .kui-flip-control'

/**
 * Wire a hover trigger onto a flip card, for the `trigger:` values that need one.
 *
 * `click` needs nothing here — the control is a real `<button>` and toggling it is the author's
 * one line, exactly as before this parameter existed. The two latching modes deliberately do not
 * listen for `pointerleave`: "stays where you left it" is the whole difference between them and
 * `hover`, and a leave handler is precisely what would undo it.
 *
 * No-ops without fine hover. On a touch screen `pointerenter` fires from a tap, so a hover-flipped
 * card would flip on the same tap that was trying to press something inside it — the control stays
 * clickable, which is the accessible path on those devices anyway.
 *
 * @complexity O(1) time and space; one listener.
 * @overallScore 100
 */
function prepareCardToggle(el: Element, params: EffectParams, ctx: PrepareContext): Cleanup {
  // Before any trigger branch, and before either bail-out below: three-d.css reads
  // `--kui-card-toggle-duration`/`-delay`/`-ease`, and only the `key:value` spelling of those
  // reaches it on its own (`declarations.ts`'s `pushTrack` writes the positional tokens for `css-keyframes`
  // primitives and no others). So `flip-card 900ms` used to turn at the 700ms default while
  // `flip-card duration:900ms` worked. A `trigger:click` card has no listeners to wire and still
  // needs this, which is why it is not inside the hover branch.
  mirrorTimingToCss('card-toggle', ALL_TIMING_TOKENS, params, ctx)

  const trigger = params.text('trigger', 'click')
  if (trigger === 'click') return () => {}
  if (!supportsFineHover(ctx.win)) return () => {}

  const control = el.querySelector(FLIP_CONTROL_SELECTOR)
  if (!control) {
    // The two bail-outs above are silent by design — `click` has nothing to wire, and a coarse
    // pointer is a documented no-op. This one is a misconfiguration: the card renders, the pointer
    // does nothing, and the usual cause is a control nested one level deeper than the direct child
    // the `:has()` rule and this lookup both require.
    ctx.warn(`flip-card trigger:${trigger} found no direct-child .kui-flip-control — the card will not flip`)
    return () => {}
  }

  const set = (flipped: boolean): void => control.setAttribute('aria-pressed', String(flipped))
  const isFlipped = (): boolean => control.getAttribute('aria-pressed') === 'true'

  const onEnter = (): void => {
    // `hover-toggle` alternates on each entry; `hover` and `hover-latch` both just turn it on,
    // and differ only in whether anything ever turns it back off (see `onLeave`).
    set(trigger === 'hover-toggle' ? !isFlipped() : true)
  }
  const onLeave = (): void => set(false)

  el.addEventListener('pointerenter', onEnter, { passive: true })
  if (trigger === 'hover') el.addEventListener('pointerleave', onLeave, { passive: true })

  return () => {
    el.removeEventListener('pointerenter', onEnter)
    el.removeEventListener('pointerleave', onLeave)
  }
}

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
 * `trigger:` is the one thing JS does here, and only because a hover that *latches* cannot be
 * expressed in CSS at all: `:hover` is true exactly while the pointer is inside, so it can style
 * `hover`, but the moment a card is meant to stay turned after the pointer leaves, the state has
 * to outlive the selector that set it. All three hover modes still write the same `aria-pressed`
 * the click path writes, so there remains exactly one source of truth.
 */
const CARD_TOGGLE_PRIMITIVE: Primitive = {
  id: 'card-toggle',
  renderer: 'javascript',
  // `'discrete'` alongside `rotate`: the unconditional `[data-kui-fx~='flip-card']` rule pins
  // `display: grid` so the two faces stack in one cell instead of flowing as normal block
  // siblings — unrelated to `catalog/discrete.ts`'s show/hide use of the same physical property,
  // but `display` is tracked as one channel regardless of the value written into it.
  channels: [CHANNEL.rotate, 'discrete'],
  parameters: {
    duration: { type: 'time', default: '700ms', cssProperty: '--kui-duration' },
    // The turn has a start moment — the click, or the pointer arriving — so a delay before it is
    // coherent. three-d.css spends it as a `transition-delay` on the turned-face rules only, so it
    // delays turning to the back and never turning back to the front; see that file's comment.
    ...TRIGGER_DELAY_PARAM,
    ease: { type: 'easing', default: 'ease-in-out', cssProperty: '--kui-ease' },
    perspective: { type: 'length', default: '1600px', cssProperty: '--kui-perspective' },
    trigger: {
      type: 'keyword',
      default: 'click',
      cssProperty: '--kui-flip-trigger',
      values: ['click', 'hover', 'hover-latch', 'hover-toggle'],
    },
  },
  supportedTimelines: ['time'],
  supportedActivations: ['load'],
  defaultActivation: 'load',
  perfClass: 'compositor',
  reducedMotion: 'disable',
  prepare: deferPrepare(prepareCardToggle),
}

export const THREE_D_PRIMITIVES: Primitive[] = [
  // `skew`, not `rotate`: the keyframes in three-d.css write `transform: perspective(...)
  // rotateX/Y(...)`, not the individual `rotate:` property — `perspective` only creates depth for
  // an element's *children*, so giving one of these effects its own depth means reaching for the
  // `perspective()` transform *function*, which only exists inside the `transform` shorthand.
  // `CHANNEL.skew` is this catalog's name for "claims the whole `transform` shorthand"; see the
  // comment on it in `core/types.ts`.
  // `'transform-origin'` alongside `skew`: two of this primitive's five presets pin one —
  // `book-page-turn` (`left center`) and `fold-panel` (`top center`), each on its own unconditional
  // rule in three-d.css — undeclared until channel-properties.ts gained an entry for it.
  // `card-flip-x`/`-y`/`cube-rotate` don't write it, but the channel only says what this primitive
  // is *allowed* to paint, not what every preset built on it does.
  cssPrimitive('flip-face', [CHANNEL.skew, 'transform-origin'], {
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
  // `transform-origin: left center` pins the bar's growth edge on the same unconditional rule —
  // undeclared until channel-properties.ts gained an entry for it.
  cssPrimitive('bar', [CHANNEL.scale, 'transform-origin'], {
    parameters: { from: { type: 'number', default: '0', cssProperty: '--kui-bar-from' } },
  }),

  CARD_TOGGLE_PRIMITIVE,
]

export const THREE_D_PRESETS: Preset[] = [
  // --- 3D & perspective ---
  // `requiresOwnSubtree`: `three-d.css:106-154` branches on `:has(> :nth-child(2))` — a flip
  // relocated onto a childless element silently takes the single-face branch and spins a bare box.
  {
    name: 'card-flip-y',
    primitive: 'flip-face',
    keyframes: 'kui-card-flip-y',
    cloak: true,
    requiresOwnSubtree: true,
  },
  {
    name: 'card-flip-x',
    primitive: 'flip-face',
    keyframes: 'kui-card-flip-x',
    cloak: true,
    requiresOwnSubtree: true,
  },
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
  // `requiresOwnSubtree`: the transition rotates `> .kui-face-front`/`.kui-face-back` children
  // (three-d.css:297-306), assumed to exist under the fx element itself.
  { name: 'flip-card', primitive: 'card-toggle', requiresOwnSubtree: true },
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
