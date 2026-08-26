import type {
  Activation,
  NamedActivation,
  ParameterSchema,
  Primitive,
  ReducedMotionPolicy,
  Timeline,
} from '../core/types.js'

/**
 * The one `delay` declaration, spread by every primitive that waits for a trigger before playing.
 *
 * Two spellings of an authored delay exist and they arrive by different routes. The positional
 * one (`count-up 320ms 300ms`) rides alongside the parameter record as `params.timing` — see the
 * design note in `core/js-effect-preparer.ts` for why timing is deliberately *not* merged into
 * that record — while the named one (`count-up delay:300ms`) reaches a primitive only if its
 * schema declares `delay`, and is otherwise dropped by `resolveParams` as an unknown parameter.
 * So every primitive whose start moment is a trigger has to declare this, and declaring it is
 * safe precisely because `0ms` is a true no-op: `readEffectParams` pre-fills every declared
 * parameter, so a non-zero default would be indistinguishable from an authored value.
 *
 * Spread (`...TRIGGER_DELAY_PARAM`) rather than retyped so that rationale has one home.
 * `test/js-effect-timing.test.ts` asserts every `defaultActivation: 'enter'` primitive ends up
 * with this entry, whichever route it took to get there.
 */
export const TRIGGER_DELAY_PARAM: ParameterSchema = {
  delay: { type: 'time', default: '0ms', cssProperty: '--kui-delay' },
}

/**
 * "Accepts every timeline, is driven by none of them."
 *
 * A few primitives have no relationship to progress at all: `background-media` paints a backdrop,
 * and the scroll-mechanics drivers read the scroll position themselves rather than being driven by
 * an `animation-timeline`. None of them ever reads `Timeline`.
 *
 * They still have to *accept* one, because `compile.ts`'s `intersect` narrows a composed element's
 * timeline support to what every primitive on it supports. Declaring the honest answer — `['time']`,
 * or nothing — empties that intersection for `data-kui="background-media src:/hero.mp4, parallax"`
 * with `timeline:view`, `style-plan.ts` then refuses the timeline, and the neighbour's scrub
 * silently degrades to a one-shot. Nothing is wrong with either effect; the intersection is simply
 * the wrong question to ask of a primitive that has no opinion.
 *
 * So the list stays exhaustive and this name is what makes it truthful. Written out inline it reads
 * as a claim to support all four — the same lie in four places, each needing its own paragraph to
 * walk back. Written as `supportedTimelines: TIMELINE_AGNOSTIC` it reads as what it is: an
 * abstention, not a claim.
 *
 * One shared array instance, like `ENTRANCE_TIMELINES` in `catalog/core.ts`. Every consumer
 * (`intersect`, `warnUnsupportedTimeline`) only reads it.
 */
export const TIMELINE_AGNOSTIC: Timeline[] = ['time', 'view', 'scroll', 'pin']

const COMMON: ParameterSchema = {
  duration: { type: 'time', default: '600ms', cssProperty: '--kui-duration' },
  ...TRIGGER_DELAY_PARAM,
  ease: { type: 'easing', default: 'ease-out', cssProperty: '--kui-ease' },
  stagger: { type: 'time', default: '0ms', cssProperty: '--kui-stagger' },
}

export interface CssPrimitiveOptions {
  parameters?: ParameterSchema
  timelines?: Timeline[]
  activations?: NamedActivation[]
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
