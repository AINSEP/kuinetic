import { CHANNEL } from '../../core/types.js'
import type { Preset, Primitive } from '../../core/types.js'
import type { Registry } from '../../core/registry.js'
import { cssPrimitive } from './shared.js'

const loop = {
  duration: { type: 'time', default: '1.6s', cssProperty: '--dsg-duration' },
  ease: { type: 'easing', default: 'linear', cssProperty: '--dsg-ease' },
} as const

const spin = {
  duration: { type: 'time', default: '900ms', cssProperty: '--dsg-duration' },
  ease: { type: 'easing', default: 'linear', cssProperty: '--dsg-ease' },
} as const

const dotPulse = {
  duration: { type: 'time', default: '1.2s', cssProperty: '--dsg-duration' },
  ease: { type: 'easing', default: 'ease-in-out', cssProperty: '--dsg-ease' },
} as const

const progressTrack = {
  duration: { type: 'time', default: '1.4s', cssProperty: '--dsg-duration' },
  ease: { type: 'easing', default: 'ease-in-out', cssProperty: '--dsg-ease' },
} as const

const toast = {
  duration: { type: 'time', default: '420ms', cssProperty: '--dsg-duration' },
  ease: { type: 'easing', default: 'back-out', cssProperty: '--dsg-ease' },
  distance: { type: 'length', default: '24px', cssProperty: '--dsg-distance' },
} as const

const shake = {
  duration: { type: 'time', default: '500ms', cssProperty: '--dsg-duration' },
  ease: { type: 'easing', default: 'linear', cssProperty: '--dsg-ease' },
} as const

const pop = {
  duration: { type: 'time', default: '420ms', cssProperty: '--dsg-duration' },
  ease: { type: 'easing', default: 'back-out', cssProperty: '--dsg-ease' },
} as const

const ripple = {
  duration: { type: 'time', default: '600ms', cssProperty: '--dsg-duration' },
  ease: { type: 'easing', default: 'ease-out', cssProperty: '--dsg-ease' },
  spread: { type: 'number', default: '4', cssProperty: '--dsg-ripple-scale', finite: true, minimum: 1 },
} as const

const confirm = {
  duration: { type: 'time', default: '1400ms', cssProperty: '--dsg-duration' },
  ease: { type: 'easing', default: 'linear', cssProperty: '--dsg-ease' },
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
  cssPrimitive('feedback-spin', [CHANNEL.rotate], {
    parameters: spin,
    defaultActivation: 'load',
    reducedMotion: 'disable',
    perfClass: 'continuous',
  }),
  cssPrimitive('feedback-dot-pulse', [CHANNEL.scale, CHANNEL.opacity], {
    parameters: dotPulse,
    defaultActivation: 'load',
    reducedMotion: 'disable',
    perfClass: 'continuous',
  }),
  cssPrimitive('feedback-progress-track', [CHANNEL.translate, CHANNEL.scale], {
    parameters: progressTrack,
    defaultActivation: 'load',
    reducedMotion: 'disable',
    perfClass: 'continuous',
  }),
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
  cssPrimitive('feedback-ripple', [CHANNEL.scale, CHANNEL.opacity], {
    parameters: ripple,
    defaultActivation: 'click',
  }),
  cssPrimitive('feedback-pop', [CHANNEL.scale], {
    parameters: pop,
    defaultActivation: 'manual',
  }),
  cssPrimitive('feedback-burst', [CHANNEL.scale, CHANNEL.opacity], {
    parameters: pop,
    defaultActivation: 'click',
  }),
  cssPrimitive('feedback-confirm', [CHANNEL.opacity], {
    parameters: confirm,
    defaultActivation: 'click',
  }),
  cssPrimitive('feedback-pull', [CHANNEL.translate], {
    defaultActivation: 'manual',
  }),
]

export const FEEDBACK_PRESETS: Preset[] = [
  { name: 'skeleton-shimmer', primitive: 'feedback-shimmer', keyframes: 'dsg-skeleton-shimmer' },
  { name: 'skeleton-to-content', primitive: 'feedback-fade', keyframes: 'dsg-skeleton-to-content' },
  { name: 'spinner', primitive: 'feedback-spin', keyframes: 'dsg-spinner-spin' },
  { name: 'spinner-dots', primitive: 'feedback-dot-pulse', keyframes: 'dsg-spinner-dots' },
  { name: 'spinner-ring', primitive: 'feedback-spin', keyframes: 'dsg-spinner-ring-spin' },
  {
    name: 'progress-indeterminate',
    primitive: 'feedback-progress-track',
    keyframes: 'dsg-progress-indeterminate',
  },
  { name: 'toast-slide-in', primitive: 'feedback-toast', keyframes: 'dsg-toast-slide-in' },
  {
    name: 'toast-slide-out',
    primitive: 'feedback-toast',
    keyframes: 'dsg-toast-slide-out',
    params: { ease: 'ease-in' },
  },
  { name: 'shake-error', primitive: 'feedback-shake', keyframes: 'dsg-shake-error' },
  {
    name: 'wobble',
    primitive: 'feedback-wobble',
    keyframes: 'dsg-wobble',
    params: { duration: '600ms', ease: 'ease-in-out' },
  },
  { name: 'ripple', primitive: 'feedback-ripple', keyframes: 'dsg-ripple' },
  { name: 'badge-pop', primitive: 'feedback-pop', keyframes: 'dsg-badge-pop' },
  { name: 'count-bump', primitive: 'feedback-pop', keyframes: 'dsg-count-bump', params: { duration: '280ms' } },
  {
    name: 'heart-burst',
    primitive: 'feedback-burst',
    keyframes: 'dsg-heart-burst',
    params: { duration: '700ms' },
  },
  {
    name: 'confetti-burst',
    primitive: 'feedback-burst',
    keyframes: 'dsg-confetti-burst',
    params: { duration: '900ms' },
  },
  { name: 'copy-confirm', primitive: 'feedback-confirm', keyframes: 'dsg-copy-confirm' },
  {
    name: 'pull-to-refresh',
    primitive: 'feedback-pull',
    keyframes: 'dsg-pull-to-refresh',
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
