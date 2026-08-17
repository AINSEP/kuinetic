import type { Activation, ParameterSchema, Primitive, ReducedMotionPolicy, Timeline } from '../core/types.js'

const COMMON: ParameterSchema = {
  duration: { type: 'time', default: '600ms', cssProperty: '--kui-duration' },
  delay: { type: 'time', default: '0ms', cssProperty: '--kui-delay' },
  ease: { type: 'easing', default: 'ease-out', cssProperty: '--kui-ease' },
  stagger: { type: 'time', default: '0ms', cssProperty: '--kui-stagger' },
}

export interface CssPrimitiveOptions {
  parameters?: ParameterSchema
  timelines?: Timeline[]
  activations?: Activation[]
  defaultActivation?: Activation
  reducedMotion?: ReducedMotionPolicy
  perfClass?: Primitive['perfClass']
}

/**
 * Build the metadata shared by every CSS-keyframe-rendered primitive.
 *
 * The one factory for "a CSS-keyframes `Primitive` with the shared timing defaults
 * (`duration`/`delay`/`ease`/`stagger`), `renderer: 'css-keyframes'`, and a default
 * activation/perfClass/reducedMotion policy" — every category under `effects/` that renders
 * with CSS keyframes builds its primitives through this, so a change to a shared default only
 * has one call site to update.
 *
 * @param id - Stable primitive identifier.
 * @param channels - CSS property groups owned by the primitive.
 * @param options - Optional schema and lifecycle overrides.
 * @returns A CSS-keyframe primitive ready for registry registration.
 * @complexity O(p) time and space in parameter count.
 * @overallScore 100
 */
export function cssPrimitive(
  id: string,
  channels: string[],
  options: CssPrimitiveOptions = {},
): Primitive {
  return {
    id,
    renderer: 'css-keyframes',
    channels,
    parameters: { ...COMMON, ...options.parameters },
    supportedTimelines: options.timelines ?? ['time'],
    supportedActivations: options.activations ?? [
      'load',
      'enter',
      'hover',
      'focus',
      'click',
      'manual',
    ],
    perfClass: options.perfClass ?? 'compositor',
    reducedMotion: options.reducedMotion ?? 'shorten',
    ...(options.defaultActivation ? { defaultActivation: options.defaultActivation } : {}),
  }
}
