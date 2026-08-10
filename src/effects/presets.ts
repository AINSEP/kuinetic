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
  p('fade-in', 'reveal', 'dsg-in'),
  p('fade-out', 'reveal', 'dsg-out'),
  p('fade-up', 'reveal', 'dsg-in-up'),
  p('fade-down', 'reveal', 'dsg-in-down'),
  p('fade-left', 'reveal', 'dsg-in-left'),
  p('fade-right', 'reveal', 'dsg-in-right'),
  p('fade-out-up', 'reveal', 'dsg-out-up'),
  p('fade-out-down', 'reveal', 'dsg-out-down'),
  p('fade-out-left', 'reveal', 'dsg-out-left'),
  p('fade-out-right', 'reveal', 'dsg-out-right'),
]

/** Slides travel further and keep full opacity — same keyframes, different defaults. */
const SLIDE_PARAMS = { distance: '100px', opacity: '1' }

const SLIDE: Preset[] = [
  p('slide-up', 'reveal', 'dsg-in-up', SLIDE_PARAMS),
  p('slide-down', 'reveal', 'dsg-in-down', SLIDE_PARAMS),
  p('slide-left', 'reveal', 'dsg-in-left', SLIDE_PARAMS),
  p('slide-right', 'reveal', 'dsg-in-right', SLIDE_PARAMS),
  p('slide-out-up', 'reveal', 'dsg-out-up', SLIDE_PARAMS),
  p('slide-out-down', 'reveal', 'dsg-out-down', SLIDE_PARAMS),
  p('slide-out-left', 'reveal', 'dsg-out-left', SLIDE_PARAMS),
  p('slide-out-right', 'reveal', 'dsg-out-right', SLIDE_PARAMS),
]

/**
 * Logical directions honour writing mode; the physical `slide-left` deliberately does not.
 * Silently reversing "left" in RTL would surprise authors, so both vocabularies exist.
 */
const LOGICAL: Preset[] = [
  p('slide-inline-start', 'reveal', 'dsg-in-inline-start', SLIDE_PARAMS),
  p('slide-inline-end', 'reveal', 'dsg-in-inline-end', SLIDE_PARAMS),
  p('slide-block-start', 'reveal', 'dsg-in-up', SLIDE_PARAMS),
  p('slide-block-end', 'reveal', 'dsg-in-down', SLIDE_PARAMS),
]

const ZOOM: Preset[] = [
  p('zoom-in', 'scale', 'dsg-zoom-in'),
  p('zoom-out', 'scale', 'dsg-zoom-out'),
  p('pop-in', 'scale', 'dsg-zoom-in', { scale: '0.6', ease: 'back-out' }),
  p('pop-out', 'scale', 'dsg-zoom-out', { scale: '0.6', ease: 'back-in' }),
  p('zoom-in-up', 'scale-move', 'dsg-zoom-in-up'),
  p('zoom-in-down', 'scale-move', 'dsg-zoom-in-down'),
]

const FLIP: Preset[] = [
  p('flip-in-x', 'flip-3d', 'dsg-flip-in-x'),
  p('flip-in-y', 'flip-3d', 'dsg-flip-in-y'),
  p('flip-out-x', 'flip-3d', 'dsg-flip-out-x'),
  p('flip-out-y', 'flip-3d', 'dsg-flip-out-y'),
]

const ROTATE: Preset[] = [
  p('rotate-in', 'rotate', 'dsg-rotate-in'),
  p('rotate-out', 'rotate', 'dsg-rotate-out'),
  p('rotate-in-left', 'rotate', 'dsg-rotate-in', { angle: '-45deg' }),
  p('rotate-in-right', 'rotate', 'dsg-rotate-in', { angle: '45deg' }),
  p('roll-in', 'roll', 'dsg-roll-in'),
  p('roll-out', 'roll', 'dsg-roll-out'),
  p('swing-in', 'rotate', 'dsg-swing-in', { angle: '-15deg', ease: 'back-out' }),
]

const BLUR: Preset[] = [
  p('blur-in', 'blur', 'dsg-blur-in'),
  p('blur-out', 'blur', 'dsg-blur-out'),
  p('fade-blur-up', 'reveal-blur', 'dsg-fade-blur-up'),
  p('fade-blur-in', 'reveal-blur', 'dsg-fade-blur-in'),
]

/** Character variants: identical keyframes, different easing. Zero extra CSS. */
const CHARACTER: Preset[] = [
  p('bounce-in', 'scale', 'dsg-zoom-in', { scale: '0.3', ease: 'back-out' }),
  p('bounce-in-up', 'reveal', 'dsg-in-up', { distance: '60px', ease: 'back-out' }),
  p('bounce-in-down', 'reveal', 'dsg-in-down', { distance: '60px', ease: 'back-out' }),
  p('back-in-up', 'reveal', 'dsg-in-up', { distance: '120px', ease: 'expo-out' }),
  p('back-in-down', 'reveal', 'dsg-in-down', { distance: '120px', ease: 'expo-out' }),
]

// --- B. Scroll reveal & parallax — 10 names -----------------------------------------------

const SCROLL: Preset[] = [
  p('parallax-y', 'parallax', 'dsg-parallax-y'),
  p('parallax-x', 'parallax', 'dsg-parallax-x'),
  p('parallax-scale', 'parallax-scale', 'dsg-parallax-scale'),
  p('parallax-rotate', 'parallax-rotate', 'dsg-parallax-rotate'),
  p('depth-layer', 'parallax', 'dsg-parallax-y', { distance: '200px' }),
  p('scroll-fade', 'scroll-fade', 'dsg-scroll-fade'),
  p('scroll-progress-bar', 'progress', 'dsg-progress-x'),
  p('scroll-progress-ring', 'progress-stroke', 'dsg-progress-ring'),
  p('reveal-once', 'reveal', 'dsg-in-up'),
  p('reveal-repeat', 'reveal', 'dsg-in-up'),
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
