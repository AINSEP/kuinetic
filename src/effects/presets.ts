import type { Preset } from '../core/types.js'

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
  p('scroll-progress-bar', 'progress', 'kui-progress-x'),
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
