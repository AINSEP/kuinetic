import { CHANNEL } from '../../core/types.js'
import type { ParameterSchema, Preset, Primitive, Timeline } from '../../core/types.js'
import type { Registry } from '../../core/registry.js'
import { cssPrimitive as css } from '../shared.js'

/**
 * The v1 catalog: entrance/exit, scroll reveal, and parallax. All CSS-rendered.
 *
 * The oldest and most heavily used section of the library — kept as one file, same shape as
 * every other catalog category (`ambient.ts`, `feedback.ts`, ...), rather than split across
 * `primitives.ts`/`presets.ts` one directory up.
 */

const distance: ParameterSchema = {
  distance: { type: 'length', default: '24px', cssProperty: '--kui-distance' },
  opacity: { type: 'number', default: '0', cssProperty: '--kui-from-opacity' },
}

/*
 * Entrances accept a scroll/view timeline as well as the clock.
 *
 * `cssPrimitive` defaults `supportedTimelines` to `['time']` when a primitive names none, and all
 * eight entrances below simply never named one — so `timeline:` was rejected by omission rather
 * than by decision. The cost was invisible: `planStyles` saw an unsupported timeline, left
 * `animation-timeline` at `auto`, and quietly degraded the effect to a one-shot `on:enter`
 * observer. `fade-up timeline:view` therefore played once and stayed, which reads as "the
 * animation does not reverse" rather than as "that combination is not supported".
 *
 * `'time'` stays first and stays the default, so this is additive: nothing changes for an
 * entrance that does not ask for a timeline.
 *
 * `'pin'` is included for the same reason `'view'` is: an entrance scrubbed across a pinned
 * hold is a thing authors want and had no way to spell. It needs nothing from the primitive —
 * the whole mechanism is the compiled `animation-delay` — so supporting it is a matter of not
 * rejecting it.
 */
const ENTRANCE_TIMELINES: Timeline[] = ['time', 'view', 'scroll', 'pin']

export const PRIMITIVES: Primitive[] = [
  // --- entrance / exit -------------------------------------------------------------------
  css('reveal', [CHANNEL.opacity, CHANNEL.translate], { timelines: ENTRANCE_TIMELINES, parameters: distance }),

  css('scale', [CHANNEL.scale], {
    timelines: ENTRANCE_TIMELINES,
    parameters: { scale: { type: 'number', default: '0.92', cssProperty: '--kui-from-scale' } },
  }),

  // Separate from `scale` because it claims translate as well and so composes differently.
  css('scale-move', [CHANNEL.scale, CHANNEL.translate], {
    timelines: ENTRANCE_TIMELINES,
    parameters: {
      ...distance,
      scale: { type: 'number', default: '0.92', cssProperty: '--kui-from-scale' },
    },
  }),

  css('rotate', [CHANNEL.rotate], {
    timelines: ENTRANCE_TIMELINES,
    parameters: { angle: { type: 'angle', default: '-8deg', cssProperty: '--kui-from-angle' } },
  }),

  css('roll', [CHANNEL.rotate, CHANNEL.translate], {
    timelines: ENTRANCE_TIMELINES,
    parameters: {
      ...distance,
      angle: { type: 'angle', default: '-120deg', cssProperty: '--kui-from-angle' },
    },
  }),

  css('flip-3d', [CHANNEL.rotate], {
    timelines: ENTRANCE_TIMELINES,
    parameters: {
      angle: { type: 'angle', default: '90deg', cssProperty: '--kui-from-angle' },
      perspective: { type: 'length', default: '1200px', cssProperty: '--kui-perspective' },
    },
  }),

  css('blur', [CHANNEL.filter], {
    timelines: ENTRANCE_TIMELINES,
    parameters: { blur: { type: 'length', default: '12px', cssProperty: '--kui-blur' } },
  }),

  // Purpose-built combination: one keyframe, so opacity is written once instead of twice.
  css('reveal-blur', [CHANNEL.opacity, CHANNEL.translate, CHANNEL.filter], {
    timelines: ENTRANCE_TIMELINES,
    parameters: { ...distance, blur: { type: 'length', default: '12px', cssProperty: '--kui-blur' } },
  }),

  // --- scroll-linked ---------------------------------------------------------------------
  // These are progress-linked, not time-triggered: they reverse as the user scrolls back.
  // That is by design and is why `timeline:` is a different axis from `on:`.
  css('parallax', [CHANNEL.translate], {
    parameters: distance,
    timelines: ['view', 'scroll', 'pin'],
    activations: ['manual'],
    reducedMotion: 'disable',
    perfClass: 'compositor',
  }),

  // `from` exists because the resting end was hardcoded (scale 1 / rotate 0deg), which fixed
  // these to "grow slightly" and "tilt slightly" — a scroll-driven element that should sweep in
  // from a quarter-size or from half a turn away had no way to say so. Same `--kui-from-*`
  // properties the entrance primitives already use, so the two stay spellable the same way.
  css('parallax-scale', [CHANNEL.scale], {
    parameters: {
      scale: { type: 'number', default: '1.2', cssProperty: '--kui-to-scale' },
      from: { type: 'number', default: '1', cssProperty: '--kui-from-scale' },
    },
    timelines: ['view', 'scroll', 'pin'],
    activations: ['manual'],
    reducedMotion: 'disable',
  }),

  css('parallax-rotate', [CHANNEL.rotate], {
    parameters: {
      angle: { type: 'angle', default: '12deg', cssProperty: '--kui-to-angle' },
      from: { type: 'angle', default: '0deg', cssProperty: '--kui-from-angle' },
    },
    timelines: ['view', 'scroll', 'pin'],
    activations: ['manual'],
    reducedMotion: 'disable',
  }),

  css('scroll-fade', [CHANNEL.opacity], {
    parameters: { opacity: { type: 'number', default: '0', cssProperty: '--kui-from-opacity' } },
    timelines: ['view', 'scroll', 'pin'],
    activations: ['manual'],
    reducedMotion: 'disable',
  }),

  // `filter`, not `opacity` — it collides with `blur`, and declaring the real channel is what
  // makes `channels.ts` say so instead of letting the two silently overwrite each other's
  // `filter` declaration.
  css('desaturate', [CHANNEL.filter], {
    parameters: {
      from: { type: 'percentage', default: '100%', cssProperty: '--kui-from-grayscale' },
      to: { type: 'percentage', default: '0%', cssProperty: '--kui-to-grayscale' },
    },
    timelines: ['view', 'scroll', 'pin'],
    activations: ['manual'],
    reducedMotion: 'disable',
    perfClass: 'paint',
  }),

  /*
   * `transform`, not one of the independent transform properties, because CSS never shipped a
   * standalone `skew:`. That is also why `skew` is its own channel rather than folded in with
   * `rotate`: writing `transform` replaces the entire shorthand, so a skew composed with anything
   * else that wrote `transform` would silently win. Nothing else in the catalog does — every other
   * transform in the library goes through `translate`/`rotate`/`scale` — so the shorthand is free.
   */
  css('skew', [CHANNEL.skew], {
    parameters: {
      from: { type: 'angle', default: '8deg', cssProperty: '--kui-from-skew' },
      to: { type: 'angle', default: '0deg', cssProperty: '--kui-to-skew' },
    },
    timelines: ['view', 'scroll', 'pin'],
    activations: ['manual'],
    reducedMotion: 'disable',
  }),

  css('progress', [CHANNEL.scale], {
    timelines: ['scroll', 'view'],
    activations: ['manual'],
    reducedMotion: 'disable',
  }),

  // Separate primitive because it writes `stroke-dashoffset`, not `scale` — declaring the
  // wrong channel would let it silently compose with an effect it actually collides with.
  css('progress-stroke', [CHANNEL.stroke], {
    parameters: { length: { type: 'number', default: '100', cssProperty: '--kui-path-length' } },
    timelines: ['scroll', 'view'],
    activations: ['manual'],
    reducedMotion: 'disable',
    perfClass: 'paint',
  }),
]

/**
 * Presets are data, not code. 48 entrance/exit names resolve to 8 primitives and ~24 keyframe
 * blocks — `slide-up` is `fade-up` with a longer distance and a starting opacity of 1.
 * Adding a name in a later release costs one row here plus (sometimes) one keyframe block.
 */

const p = (
  name: string,
  primitive: string,
  keyframes: string,
  params?: Record<string, string>,
): Preset => ({ name, primitive, keyframes, ...(params ? { params } : {}) })

// --- A. Entrance & exit matrix — 48 names -------------------------------------------------

const FADE: Preset[] = [
  p('fade-in', 'reveal', 'kui-in'),
  p('fade-out', 'reveal', 'kui-out'),
  p('fade-up', 'reveal', 'kui-in-up'),
  p('fade-down', 'reveal', 'kui-in-down'),
  p('fade-left', 'reveal', 'kui-in-left'),
  p('fade-right', 'reveal', 'kui-in-right'),
  p('fade-out-up', 'reveal', 'kui-out-up'),
  p('fade-out-down', 'reveal', 'kui-out-down'),
  p('fade-out-left', 'reveal', 'kui-out-left'),
  p('fade-out-right', 'reveal', 'kui-out-right'),
]

/** Slides travel further and keep full opacity — same keyframes, different defaults. */
const SLIDE_PARAMS = { distance: '100px', opacity: '1' }

const SLIDE: Preset[] = [
  p('slide-up', 'reveal', 'kui-in-up', SLIDE_PARAMS),
  p('slide-down', 'reveal', 'kui-in-down', SLIDE_PARAMS),
  p('slide-left', 'reveal', 'kui-in-left', SLIDE_PARAMS),
  p('slide-right', 'reveal', 'kui-in-right', SLIDE_PARAMS),
  p('slide-out-up', 'reveal', 'kui-out-up', SLIDE_PARAMS),
  p('slide-out-down', 'reveal', 'kui-out-down', SLIDE_PARAMS),
  p('slide-out-left', 'reveal', 'kui-out-left', SLIDE_PARAMS),
  p('slide-out-right', 'reveal', 'kui-out-right', SLIDE_PARAMS),
]

/**
 * Logical directions honour writing mode; the physical `slide-left` deliberately does not.
 * Silently reversing "left" in RTL would surprise authors, so both vocabularies exist.
 */
const LOGICAL: Preset[] = [
  p('slide-inline-start', 'reveal', 'kui-in-inline-start', SLIDE_PARAMS),
  p('slide-inline-end', 'reveal', 'kui-in-inline-end', SLIDE_PARAMS),
  p('slide-block-start', 'reveal', 'kui-in-up', SLIDE_PARAMS),
  p('slide-block-end', 'reveal', 'kui-in-down', SLIDE_PARAMS),
]

const ZOOM: Preset[] = [
  p('zoom-in', 'scale', 'kui-zoom-in'),
  p('zoom-out', 'scale', 'kui-zoom-out'),
  p('pop-in', 'scale', 'kui-zoom-in', { scale: '0.6', ease: 'back-out' }),
  p('pop-out', 'scale', 'kui-zoom-out', { scale: '0.6', ease: 'back-in' }),
  p('zoom-in-up', 'scale-move', 'kui-zoom-in-up'),
  p('zoom-in-down', 'scale-move', 'kui-zoom-in-down'),
]

const FLIP: Preset[] = [
  p('flip-in-x', 'flip-3d', 'kui-flip-in-x'),
  p('flip-in-y', 'flip-3d', 'kui-flip-in-y'),
  p('flip-out-x', 'flip-3d', 'kui-flip-out-x'),
  p('flip-out-y', 'flip-3d', 'kui-flip-out-y'),
]

const ROTATE: Preset[] = [
  p('rotate-in', 'rotate', 'kui-rotate-in'),
  p('rotate-out', 'rotate', 'kui-rotate-out'),
  p('rotate-in-left', 'rotate', 'kui-rotate-in', { angle: '-45deg' }),
  p('rotate-in-right', 'rotate', 'kui-rotate-in', { angle: '45deg' }),
  p('roll-in', 'roll', 'kui-roll-in'),
  p('roll-out', 'roll', 'kui-roll-out'),
  p('swing-in', 'rotate', 'kui-swing-in', { angle: '-15deg', ease: 'back-out' }),
]

const BLUR: Preset[] = [
  p('blur-in', 'blur', 'kui-blur-in'),
  p('blur-out', 'blur', 'kui-blur-out'),
  p('fade-blur-up', 'reveal-blur', 'kui-fade-blur-up'),
  p('fade-blur-in', 'reveal-blur', 'kui-fade-blur-in'),
]

/** Character variants: identical keyframes, different easing. Zero extra CSS. */
const CHARACTER: Preset[] = [
  p('bounce-in', 'scale', 'kui-zoom-in', { scale: '0.3', ease: 'back-out' }),
  p('bounce-in-up', 'reveal', 'kui-in-up', { distance: '60px', ease: 'back-out' }),
  p('bounce-in-down', 'reveal', 'kui-in-down', { distance: '60px', ease: 'back-out' }),
  p('back-in-up', 'reveal', 'kui-in-up', { distance: '120px', ease: 'expo-out' }),
  p('back-in-down', 'reveal', 'kui-in-down', { distance: '120px', ease: 'expo-out' }),
]

// --- B. Scroll reveal & parallax — 10 names -----------------------------------------------

const SCROLL: Preset[] = [
  p('parallax-y', 'parallax', 'kui-parallax-y'),
  p('parallax-x', 'parallax', 'kui-parallax-x'),
  p('parallax-scale', 'parallax-scale', 'kui-parallax-scale'),
  p('parallax-rotate', 'parallax-rotate', 'kui-parallax-rotate'),
  p('depth-layer', 'parallax', 'kui-parallax-y', { distance: '200px' }),
  p('scroll-fade', 'scroll-fade', 'kui-scroll-fade'),
  p('scroll-desaturate', 'desaturate', 'kui-desaturate'),
  p('scroll-skew', 'skew', 'kui-scroll-skew'),
  p('scroll-progress-bar', 'progress', 'kui-progress-x'),
  p('scroll-progress-bar-y', 'progress', 'kui-progress-y'),
  p('scroll-progress-ring', 'progress-stroke', 'kui-progress-ring'),
  // `reveal-repeat` was removed: it was byte-identical to `reveal-once`, and the activation
  // binder unobserves after first entry, so a repeating reveal is not implementable yet.
  p('reveal-once', 'reveal', 'kui-in-up'),
]

export const PRESETS: Preset[] = [
  ...FADE,
  ...SLIDE,
  ...LOGICAL,
  ...ZOOM,
  ...FLIP,
  ...ROTATE,
  ...BLUR,
  ...CHARACTER,
  ...SCROLL,
]

/**
 * Combinations with a purpose-built single keyframe. Checked before channel analysis, so
 * `fade-up, blur-in` resolves here instead of being rejected for both writing opacity.
 */
export const COMBOS: Array<[string[], string]> = [
  [['fade-up', 'blur-in'], 'fade-blur-up'],
  [['fade-in', 'blur-in'], 'fade-blur-in'],
]

/**
 * Register the v1 catalog: entrance/exit, scroll reveal, and parallax primitives, presets, and
 * combos.
 *
 * @param registry - Registry to populate.
 * @returns The same registry, for chaining.
 * @complexity O(n) time in the number of primitives, presets, and combos.
 * @overallScore 100
 */
export function registerCore(registry: Registry): Registry {
  registry.registerPrimitives(PRIMITIVES).registerPresets(PRESETS)
  for (const [names, preset] of COMBOS) registry.registerCombo(names, preset)
  return registry
}
