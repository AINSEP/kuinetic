import { CHANNEL } from '../../core/types.js'
import type { Preset, Primitive } from '../../core/types.js'
import { cssPrimitive } from './shared.js'

const geometry = {
  distance: { type: 'length', default: '24px', cssProperty: '--kui-distance' },
  scale: { type: 'number', default: '1.12', cssProperty: '--kui-to-scale' },
} as const

export const MEDIA_PRIMITIVES: Primitive[] = [
  cssPrimitive('media-wipe', [CHANNEL.clip]),
  cssPrimitive('media-mask', ['mask'], { perfClass: 'paint' }),
  // Not `reducedMotion: 'disable'` — that policy means "no finite duration would make sense,
  // because the animation never ends" (see `ambient.ts`/`feedback.ts`), and a Ken Burns pan/zoom
  // is the opposite of that: a one-shot cinematic move with a real, shortenable duration. The demo
  // authors it as `ken-burns 9000ms` (a still image, one slow zoom, then it holds) and
  // `ken-burns 3000ms on:hover` (zooms in while hovered), and its complement `ken-burns-out` is a
  // second one-shot preset for the reverse move — not a `-loop` variant the way `typewriter-loop`
  // or `marquee`/`marquee-scroll-linked` are. `kui-ken-burns`'s keyframe (`scale: 1` to `1.12`,
  // no loop-safe midpoint) is shaped for exactly that: run once, land on the zoomed frame, stay
  // there. `'disable'` here previously looked like the same missing-`--kui-fx-*-iterations` bug as
  // `marquee`/`gradient-shimmer`, but the actual defect was this policy — the default `'shorten'`
  // is correct, so no `--kui-fx-ken-burns-iterations` is needed at all.
  cssPrimitive('media-ken-burns', [CHANNEL.translate, CHANNEL.scale], {
    parameters: geometry,
  }),
  cssPrimitive('media-filter', [CHANNEL.filter], {
    defaultActivation: 'hover',
    perfClass: 'paint',
  }),
  cssPrimitive('media-blur-up', [CHANNEL.translate, CHANNEL.filter], {
    parameters: geometry,
    perfClass: 'paint',
  }),
  cssPrimitive('media-parallax-frame', [CHANNEL.translate], {
    parameters: geometry,
    timelines: ['view', 'scroll'],
    activations: ['manual'],
    defaultActivation: 'manual',
    reducedMotion: 'disable',
  }),
  cssPrimitive('media-lightbox', [CHANNEL.opacity, CHANNEL.scale], {
    parameters: geometry,
  }),
]

export const MEDIA_PRESETS: Preset[] = [
  { name: 'wipe-up', primitive: 'media-wipe', keyframes: 'kui-wipe-up' },
  { name: 'wipe-down', primitive: 'media-wipe', keyframes: 'kui-wipe-down' },
  { name: 'wipe-left', primitive: 'media-wipe', keyframes: 'kui-wipe-left' },
  { name: 'wipe-right', primitive: 'media-wipe', keyframes: 'kui-wipe-right' },
  { name: 'wipe-circle', primitive: 'media-wipe', keyframes: 'kui-wipe-circle' },
  { name: 'wipe-diagonal', primitive: 'media-wipe', keyframes: 'kui-wipe-diagonal' },
  { name: 'mask-reveal', primitive: 'media-mask', keyframes: 'kui-mask-reveal' },
  { name: 'curtain-reveal', primitive: 'media-wipe', keyframes: 'kui-curtain-reveal' },
  { name: 'ken-burns', primitive: 'media-ken-burns', keyframes: 'kui-ken-burns' },
  { name: 'ken-burns-out', primitive: 'media-ken-burns', keyframes: 'kui-ken-burns-out' },
  { name: 'blur-up', primitive: 'media-blur-up', keyframes: 'kui-blur-up' },
  { name: 'duotone-hover', primitive: 'media-filter', keyframes: 'kui-duotone-hover' },
  { name: 'grayscale-hover', primitive: 'media-filter', keyframes: 'kui-grayscale-hover' },
  { name: 'saturate-hover', primitive: 'media-filter', keyframes: 'kui-saturate-hover' },
  {
    name: 'image-parallax-frame',
    primitive: 'media-parallax-frame',
    keyframes: 'kui-image-parallax-frame',
  },
  { name: 'before-after-wipe', primitive: 'media-wipe', keyframes: 'kui-before-after-wipe' },
  { name: 'lightbox-open', primitive: 'media-lightbox', keyframes: 'kui-lightbox-open' },
]
