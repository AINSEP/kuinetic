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

const ripple = {
  duration: { type: 'time', default: '600ms', cssProperty: '--kui-duration' },
  ease: { type: 'easing', default: 'ease-out', cssProperty: '--kui-ease' },
  spread: { type: 'number', default: '4', cssProperty: '--kui-ripple-scale', finite: true, minimum: 1 },
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
  // `[data-kui-fx~='ripple']` sets `background: currentColor` unconditionally for the ripple
  // disc itself, outside the keyframe — same gap as feedback-dot-pulse/feedback-progress-track.
  // It also pins `transform-origin: center` there, same structurally-invisible gap as above.
  cssPrimitive(
    'feedback-ripple',
    [CHANNEL.scale, CHANNEL.opacity, CHANNEL.background, 'transform-origin'],
    {
      parameters: ripple,
      defaultActivation: 'click',
    },
  ),
  cssPrimitive('feedback-pop', [CHANNEL.scale], {
    parameters: pop,
    defaultActivation: 'manual',
  }),
  // Declares every channel any preset built on it actually paints, not just what the shared
  // keyframes animate: heart-burst's CSS also sets `color`, confetti-burst's also sets
  // `background-image`. Understating this let a composed `background`-writing effect (e.g.
  // gradient-mesh) pass channel-collision detection and silently overwrite confetti-burst's dots.
  cssPrimitive('feedback-burst', [CHANNEL.scale, CHANNEL.opacity, CHANNEL.background, CHANNEL.color], {
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
  { name: 'skeleton-shimmer', primitive: 'feedback-shimmer', keyframes: 'kui-skeleton-shimmer' },
  { name: 'skeleton-to-content', primitive: 'feedback-fade', keyframes: 'kui-skeleton-to-content' },
  { name: 'spinner', primitive: 'feedback-spin', keyframes: 'kui-spinner-spin' },
  { name: 'spinner-dots', primitive: 'feedback-dot-pulse', keyframes: 'kui-spinner-dots' },
  { name: 'spinner-ring', primitive: 'feedback-spin', keyframes: 'kui-spinner-ring-spin' },
  {
    name: 'progress-indeterminate',
    primitive: 'feedback-progress-track',
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
    primitive: 'feedback-burst',
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
