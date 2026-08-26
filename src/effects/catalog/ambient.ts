import { CHANNEL } from '../../core/types.js'
import type { Preset, Primitive } from '../../core/types.js'
import type { Registry } from '../../core/registry.js'
import { cssPrimitive } from './shared.js'

// `--kui-ambient-c1`..`--kui-ambient-c4` are section J's shared palette, deliberately one namespace
// across both colour primitives below so an outer `aurora from:` still tints a nested `starfield`.
// The `ambient-` prefix is the whole point: the unprefixed `--kui-c1`/`--kui-c2` these used to write
// are read by `shine-sweep` (interaction.css) and `confetti-burst` (feedback.css) too, and custom
// properties inherit — so `<section data-kui="aurora from:red">` silently recoloured every
// descendant carrying either of those. Prefixed, the palette reaches only rules that opt into it.
//
// Each ambient rule still falls back to the bare `--kui-cN` behind the prefixed name, so a page that
// hand-sets `--kui-c1` to tint an ambient effect (demo/motif-blueprint.html does) keeps working. The
// library no longer writes those names itself, which is what closed the leak.
//
// Empty defaults, the same convention as `beam-border`'s `color:` (interaction.ts): unauthored means
// absent from the resolved output, so each rule's own hardcoded fallback stays in force and no
// existing page changes colour. `--kui-ambient-c3`/`--kui-ambient-c4` stay author-set by hand.
const drift = {
  duration: { type: 'time', default: '10s', cssProperty: '--kui-duration' },
  ease: { type: 'easing', default: 'ease-in-out', cssProperty: '--kui-ease' },
  from: { type: 'color', default: '', cssProperty: '--kui-ambient-c1' },
  to: { type: 'color', default: '', cssProperty: '--kui-ambient-c2' },
} as const

// Same drift, one colour slot. `scanline`, both grids, `starfield`, `spotlight-follow` and
// `wave-blob` paint a single-colour pattern or wash — none of them reads a second stop.
// (`noise-overlay` was a sixth until it was cut below; the reasoning is unchanged.) Sharing
// `drift` meant `to:` validated cleanly and then did nothing at all on six of
// the ten colour-taking names here; a separate schema turns that silence into an
// unknown-parameter warning. Parameters are per-primitive, so a narrower schema means a second
// primitive — hence `ambient-tint` rather than a per-preset schema override.
const tint = {
  duration: { type: 'time', default: '10s', cssProperty: '--kui-duration' },
  ease: { type: 'easing', default: 'ease-in-out', cssProperty: '--kui-ease' },
  from: { type: 'color', default: '', cssProperty: '--kui-ambient-c1' },
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
  /*
   * `gradient-rotate-border` and `gradient-border` are not background fills, and a second
   * primitive is how this catalog says so — the same reason `ambient-tint` exists beside
   * `ambient-gradient` above. Channels are per-primitive, so a different channel set means a
   * different primitive; folding these into `ambient-gradient` would make `gradient-mesh` and
   * `aurora` claim a mask and a box they never touch, and `aurora, pin` would start reporting a
   * conflict that isn't there.
   *
   * What the ring rules actually write (`ambient.css`) beyond the gradient: `mask` +
   * `mask-composite`, which subtract the element's own content box to leave a ring — the same
   * physical property `media-mask` claims under the `'mask'` channel — and `position: relative`
   * plus a `padding` that *is* the ring's thickness, which is a claim on the host's box in the
   * sense `pin` and `background-media` already use `'layout'` for. Declared only as
   * `background`, a `gradient-border, pin-section` pair composed silently while both decided the
   * host's `position`, and `gradient-border, mask-reveal` while both wrote `mask`.
   */
  cssPrimitive('ambient-gradient-ring', [CHANNEL.background, 'mask', 'layout'], {
    parameters: drift,
    defaultActivation: 'load',
    reducedMotion: 'disable',
    perfClass: 'continuous',
  }),
  cssPrimitive('ambient-tint', [CHANNEL.background], {
    parameters: tint,
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
    primitive: 'ambient-gradient-ring',
    keyframes: 'kui-gradient-rotate-border',
    params: { duration: '6s', ease: 'linear' },
  },
  {
    // Not `gradient`: this rule masks its own content box away (`mask-composite: exclude`) to leave
    // a ring, so putting the name on real content deletes the content. `-border` says that out loud,
    // matching `gradient-rotate-border` and `beam-border`.
    name: 'gradient-border',
    primitive: 'ambient-gradient-ring',
    keyframes: 'kui-gradient-border',
    params: { duration: '6s', ease: 'linear' },
  },
  // Cut 2026-08-26, human call — the rewritten version wasn't useful. Commented out, not
  // deleted, so it can be revived: uncomment this row, the matching rule + @keyframes in
  // ambient.css, restore the docs/catalog.md entry, and regenerate presets.generated.css.
  // {
  //   name: 'noise-overlay',
  //   primitive: 'ambient-tint',
  //   keyframes: 'kui-noise-overlay',
  //   params: { duration: '650ms', ease: 'steps(6)' },
  // },
  {
    name: 'scanline',
    primitive: 'ambient-tint',
    keyframes: 'kui-scanline',
    params: { duration: '3.5s', ease: 'linear' },
  },
  {
    name: 'dot-grid-drift',
    primitive: 'ambient-tint',
    keyframes: 'kui-dot-grid-drift',
    params: { duration: '16s', ease: 'linear' },
  },
  {
    name: 'line-grid-drift',
    primitive: 'ambient-tint',
    keyframes: 'kui-line-grid-drift',
    params: { duration: '16s', ease: 'linear' },
  },
  {
    name: 'starfield',
    primitive: 'ambient-tint',
    keyframes: 'kui-starfield',
    params: { duration: '40s', ease: 'linear' },
  },
  {
    name: 'spotlight-follow',
    primitive: 'ambient-tint',
    keyframes: 'kui-spotlight-follow',
    params: { duration: '9s' },
  },
  {
    name: 'wave-blob',
    primitive: 'ambient-tint',
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
