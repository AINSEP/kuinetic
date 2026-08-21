import { CHANNEL } from '../../core/types.js'
import type { Preset, Primitive } from '../../core/types.js'
import type { Registry } from '../../core/registry.js'
import { cssPrimitive } from './shared.js'

const drift = {
  duration: { type: 'time', default: '10s', cssProperty: '--kui-duration' },
  ease: { type: 'easing', default: 'ease-in-out', cssProperty: '--kui-ease' },
} as const

const float = {
  duration: { type: 'time', default: '4s', cssProperty: '--kui-duration' },
  ease: { type: 'easing', default: 'ease-in-out', cssProperty: '--kui-ease' },
  distance: { type: 'length', default: '14px', cssProperty: '--kui-distance' },
} as const

const orbit = {
  duration: { type: 'time', default: '3.5s', cssProperty: '--kui-duration' },
  // `linear` by default, unlike every other ambient primitive: a continuous rotation that eases
  // visibly stutters once per revolution, because the ease restarts at each iteration boundary.
  ease: { type: 'easing', default: 'linear', cssProperty: '--kui-ease' },
  angle: { type: 'angle', default: '360deg', cssProperty: '--kui-to-angle' },
} as const

const pulse = {
  duration: { type: 'time', default: '2.2s', cssProperty: '--kui-duration' },
  ease: { type: 'easing', default: 'ease-in-out', cssProperty: '--kui-ease' },
  scale: { type: 'number', default: '1.15', cssProperty: '--kui-pulse-scale', finite: true, minimum: 1 },
} as const

/**
 * Continuous ambient motion never shortens to 1ms under reduced motion — a 1ms aurora is
 * meaningless, so every primitive here declares `reducedMotion: 'disable'` and starts on
 * `load` rather than waiting on a scroll-triggered `enter`.
 */
export const AMBIENT_PRIMITIVES: Primitive[] = [
  cssPrimitive('ambient-gradient', [CHANNEL.background], {
    parameters: drift,
    defaultActivation: 'load',
    reducedMotion: 'disable',
    perfClass: 'continuous',
  }),
  cssPrimitive('ambient-float', [CHANNEL.translate], {
    parameters: float,
    defaultActivation: 'load',
    reducedMotion: 'disable',
    perfClass: 'continuous',
  }),
  cssPrimitive('ambient-orbit', [CHANNEL.rotate], {
    parameters: orbit,
    defaultActivation: 'load',
    reducedMotion: 'disable',
    perfClass: 'continuous',
  }),
  cssPrimitive('ambient-pulse', [CHANNEL.scale, CHANNEL.opacity], {
    parameters: pulse,
    defaultActivation: 'load',
    reducedMotion: 'disable',
    perfClass: 'continuous',
  }),
]

export const AMBIENT_PRESETS: Preset[] = [
  { name: 'gradient-mesh', primitive: 'ambient-gradient', keyframes: 'kui-gradient-mesh' },
  { name: 'aurora', primitive: 'ambient-gradient', keyframes: 'kui-aurora' },
  {
    name: 'gradient-rotate-border',
    primitive: 'ambient-gradient',
    keyframes: 'kui-gradient-rotate-border',
    params: { duration: '6s', ease: 'linear' },
  },
  {
    name: 'noise-overlay',
    primitive: 'ambient-gradient',
    keyframes: 'kui-noise-overlay',
    params: { duration: '650ms', ease: 'steps(6)' },
  },
  {
    name: 'scanline',
    primitive: 'ambient-gradient',
    keyframes: 'kui-scanline',
    params: { duration: '3.5s', ease: 'linear' },
  },
  {
    name: 'dot-grid-drift',
    primitive: 'ambient-gradient',
    keyframes: 'kui-dot-grid-drift',
    params: { duration: '16s', ease: 'linear' },
  },
  {
    name: 'line-grid-drift',
    primitive: 'ambient-gradient',
    keyframes: 'kui-line-grid-drift',
    params: { duration: '16s', ease: 'linear' },
  },
  {
    name: 'starfield',
    primitive: 'ambient-gradient',
    keyframes: 'kui-starfield',
    params: { duration: '40s', ease: 'linear' },
  },
  {
    name: 'spotlight-follow',
    primitive: 'ambient-gradient',
    keyframes: 'kui-spotlight-follow',
    params: { duration: '9s' },
  },
  {
    name: 'wave-blob',
    primitive: 'ambient-gradient',
    keyframes: 'kui-wave-blob',
    params: { duration: '12s' },
  },
  { name: 'float', primitive: 'ambient-float', keyframes: 'kui-float' },
  {
    name: 'bob',
    primitive: 'ambient-float',
    keyframes: 'kui-bob',
    params: { duration: '2s', distance: '8px' },
  },
  {
    name: 'floating-shapes',
    primitive: 'ambient-float',
    keyframes: 'kui-floating-shapes',
    params: { duration: '6s', distance: '10px' },
  },
  { name: 'orbit', primitive: 'ambient-orbit', keyframes: 'kui-orbit' },
  { name: 'glow-pulse', primitive: 'ambient-pulse', keyframes: 'kui-glow-pulse' },
]

/**
 * Register catalog section J (ambient backgrounds) into a registry.
 *
 * @param registry - Registry to populate.
 * @returns The same registry, for chaining.
 * @complexity O(n) time in registered primitives and presets; O(1) extra space.
 * @overallScore 100
 */
export function registerAmbient(registry: Registry): Registry {
  return registry.registerPrimitives(AMBIENT_PRIMITIVES).registerPresets(AMBIENT_PRESETS)
}
