/**
 * Which CSS properties each channel is allowed to claim.
 *
 * Shared by `css-invariants.test.ts` (the full catalog) and `three-d.test.ts` (`three-d.css`
 * alone) — a channel/property map that used to be copy-pasted between the two. That let them
 * drift: three-d.test.ts's copy never gained `background`, `mask`, or `font` because nothing
 * forced the two lists to agree, and either file could add a channel the other silently lacked.
 * One export, two importers, closes that gap.
 *
 * `mask-image`/`mask-position`/`mask-size` live under `mask`, not `clip`, even though both
 * channels hide part of an element. `media-mask` (catalog section G) is the only primitive that
 * ever writes them, and it declares channel `mask`, not `clip` — filing the properties under
 * `clip` as well would let a `clip`-channel primitive and a `mask`-channel primitive both
 * legitimately paint `mask-image` while the compiler sees two disjoint channels and composes
 * them, exactly the "two different channel names, one physical property" collision this map
 * exists to catch.
 */
export const CHANNEL_PROPERTIES: Record<string, string[]> = {
  opacity: ['opacity'],
  translate: ['translate'],
  scale: ['scale'],
  rotate: ['rotate'],
  filter: ['filter'],
  clip: ['clip-path'],
  mask: ['mask-image', 'mask-position', 'mask-size'],
  background: [
    'background-position',
    'background-image',
    'background-size',
    'background-color',
    'background',
  ],
  color: ['color'],
  stroke: ['stroke-dashoffset', 'stroke-dasharray', 'stroke'],
  /**
   * `skew` claims the whole `transform` shorthand, because CSS never gave skew an independent
   * property the way it did `translate`/`rotate`/`scale`. Anything that writes `transform` replaces
   * all of it, so nothing else in the catalog is allowed to — `scroll-skew` is the only member.
   */
  skew: ['transform'],
  text: ['letter-spacing', 'word-spacing', 'font-variation-settings'],
  font: ['font-weight', 'font-stretch', 'font-style'],
  shadow: ['box-shadow'],
}
