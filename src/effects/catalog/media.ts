import { CHANNEL } from '../../core/types.js'
import type { Preset, Primitive } from '../../core/types.js'
import { cssPrimitive } from './shared.js'

const geometry = {
  distance: { type: 'length', default: '24px', cssProperty: '--dsg-distance' },
  scale: { type: 'number', default: '1.12', cssProperty: '--dsg-to-scale' },
} as const

export const MEDIA_PRIMITIVES: Primitive[] = [
  cssPrimitive('media-wipe', [CHANNEL.clip]),
  cssPrimitive('media-mask', ['mask'], { perfClass: 'paint' }),
  cssPrimitive('media-ken-burns', [CHANNEL.translate, CHANNEL.scale], {
    parameters: geometry,
    reducedMotion: 'disable',
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
  { name: 'wipe-up', primitive: 'media-wipe', keyframes: 'dsg-wipe-up' },
  { name: 'wipe-down', primitive: 'media-wipe', keyframes: 'dsg-wipe-down' },
  { name: 'wipe-left', primitive: 'media-wipe', keyframes: 'dsg-wipe-left' },
  { name: 'wipe-right', primitive: 'media-wipe', keyframes: 'dsg-wipe-right' },
  { name: 'wipe-circle', primitive: 'media-wipe', keyframes: 'dsg-wipe-circle' },
  { name: 'wipe-diagonal', primitive: 'media-wipe', keyframes: 'dsg-wipe-diagonal' },
  { name: 'mask-reveal', primitive: 'media-mask', keyframes: 'dsg-mask-reveal' },
  { name: 'curtain-reveal', primitive: 'media-wipe', keyframes: 'dsg-curtain-reveal' },
  { name: 'ken-burns', primitive: 'media-ken-burns', keyframes: 'dsg-ken-burns' },
  { name: 'ken-burns-out', primitive: 'media-ken-burns', keyframes: 'dsg-ken-burns-out' },
  { name: 'blur-up', primitive: 'media-blur-up', keyframes: 'dsg-blur-up' },
  { name: 'duotone-hover', primitive: 'media-filter', keyframes: 'dsg-duotone-hover' },
  { name: 'grayscale-hover', primitive: 'media-filter', keyframes: 'dsg-grayscale-hover' },
  { name: 'saturate-hover', primitive: 'media-filter', keyframes: 'dsg-saturate-hover' },
  {
    name: 'image-parallax-frame',
    primitive: 'media-parallax-frame',
    keyframes: 'dsg-image-parallax-frame',
  },
  { name: 'before-after-wipe', primitive: 'media-wipe', keyframes: 'dsg-before-after-wipe' },
  { name: 'lightbox-open', primitive: 'media-lightbox', keyframes: 'dsg-lightbox-open' },
]
