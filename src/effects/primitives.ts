import { CHANNEL } from '../core/types.js'
import type { ParameterSchema, Primitive } from '../core/types.js'

/**
 * Parameters every primitive accepts. `duration`/`delay`/`ease` are also settable positionally
 * (`fade-up 800ms 200ms ease-out`); the custom-property form exists so presets can carry
 * different defaults without new code — `bounce-in` is `fade-up` with `ease:back-out`.
 */
const common: ParameterSchema = {
  duration: { type: 'time', default: '600ms', cssProperty: '--dsg-duration' },
  delay: { type: 'time', default: '0ms', cssProperty: '--dsg-delay' },
  ease: { type: 'easing', default: 'ease-out', cssProperty: '--dsg-ease' },
  stagger: { type: 'time', default: '0ms', cssProperty: '--dsg-stagger' },
}

const TIME_ONLY: Primitive['supportedTimelines'] = ['time']
const ALL_ACTIVATIONS: Primitive['supportedActivations'] = [
  'load',
  'enter',
  'hover',
  'focus',
  'click',
  'manual',
]

function css(
  id: string,
  channels: string[],
  extra: ParameterSchema,
  overrides: Partial<Primitive> = {},
): Primitive {
  return {
    id,
    renderer: 'css-keyframes',
    channels,
    parameters: { ...common, ...extra },
    supportedTimelines: TIME_ONLY,
    supportedActivations: ALL_ACTIVATIONS,
    perfClass: 'compositor',
    reducedMotion: 'shorten',
    ...overrides,
  }
}

const distance: ParameterSchema = {
  distance: { type: 'length', default: '24px', cssProperty: '--dsg-distance' },
  opacity: { type: 'number', default: '0', cssProperty: '--dsg-from-opacity' },
}

export const PRIMITIVES: Primitive[] = [
  // --- entrance / exit -------------------------------------------------------------------
  css('reveal', [CHANNEL.opacity, CHANNEL.translate], distance),

  css('scale', [CHANNEL.scale], {
    scale: { type: 'number', default: '0.92', cssProperty: '--dsg-from-scale' },
  }),

  // Separate from `scale` because it claims translate as well and so composes differently.
  css('scale-move', [CHANNEL.scale, CHANNEL.translate], {
    ...distance,
    scale: { type: 'number', default: '0.92', cssProperty: '--dsg-from-scale' },
  }),

  css('rotate', [CHANNEL.rotate], {
    angle: { type: 'angle', default: '-8deg', cssProperty: '--dsg-from-angle' },
  }),

  css('roll', [CHANNEL.rotate, CHANNEL.translate], {
    ...distance,
    angle: { type: 'angle', default: '-120deg', cssProperty: '--dsg-from-angle' },
  }),

  css('flip-3d', [CHANNEL.rotate], {
    angle: { type: 'angle', default: '90deg', cssProperty: '--dsg-from-angle' },
    perspective: { type: 'length', default: '1200px', cssProperty: '--dsg-perspective' },
  }),

  css('blur', [CHANNEL.filter], {
    blur: { type: 'length', default: '12px', cssProperty: '--dsg-blur' },
  }),

  // Purpose-built combination: one keyframe, so opacity is written once instead of twice.
  css('reveal-blur', [CHANNEL.opacity, CHANNEL.translate, CHANNEL.filter], {
    ...distance,
    blur: { type: 'length', default: '12px', cssProperty: '--dsg-blur' },
  }),

  // --- scroll-linked ---------------------------------------------------------------------
  // These are progress-linked, not time-triggered: they reverse as the user scrolls back.
  // That is by design and is why `timeline:` is a different axis from `on:`.
  css('parallax', [CHANNEL.translate], distance, {
    supportedTimelines: ['view', 'scroll'],
    supportedActivations: ['manual'],
    reducedMotion: 'disable',
    perfClass: 'compositor',
  }),

  css('parallax-scale', [CHANNEL.scale], {
    scale: { type: 'number', default: '1.2', cssProperty: '--dsg-to-scale' },
  }, {
    supportedTimelines: ['view', 'scroll'],
    supportedActivations: ['manual'],
    reducedMotion: 'disable',
  }),

  css('parallax-rotate', [CHANNEL.rotate], {
    angle: { type: 'angle', default: '12deg', cssProperty: '--dsg-to-angle' },
  }, {
    supportedTimelines: ['view', 'scroll'],
    supportedActivations: ['manual'],
    reducedMotion: 'disable',
  }),

  css('scroll-fade', [CHANNEL.opacity], {
    opacity: { type: 'number', default: '0', cssProperty: '--dsg-from-opacity' },
  }, {
    supportedTimelines: ['view', 'scroll'],
    supportedActivations: ['manual'],
    reducedMotion: 'disable',
  }),

  css('progress', [CHANNEL.scale], {}, {
    supportedTimelines: ['scroll', 'view'],
    supportedActivations: ['manual'],
    reducedMotion: 'disable',
  }),

  // Separate primitive because it writes `stroke-dashoffset`, not `scale` — declaring the
  // wrong channel would let it silently compose with an effect it actually collides with.
  css('progress-stroke', [CHANNEL.stroke], {
    length: { type: 'number', default: '100', cssProperty: '--dsg-path-length' },
  }, {
    supportedTimelines: ['scroll', 'view'],
    supportedActivations: ['manual'],
    reducedMotion: 'disable',
    perfClass: 'paint',
  }),
]
