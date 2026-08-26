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
  /**
   * `-webkit-text-fill-color` is a text glyph's *fill*, distinct from `color` everywhere it is
   * actually used — `gradient-shimmer`/`gradient-sweep` set it to `transparent` so a `background`
   * gradient shows through the glyphs, and `text-outline-fill` animates it while `color` and
   * `-webkit-text-stroke` (the `stroke` channel, below) both hold a stable `currentColor`. It lives
   * under `color` — not `background`, even though the shimmer/sweep pair reach it as part of their
   * gradient-text technique — because that is the channel `text-outline-fill` already declared for
   * itself before this property had any `CHANNEL_PROPERTIES` entry at all. Filing it under `color`
   * is what surfaces the real collision this map exists to catch: `text-shimmer`/`text-sweep` only
   * declared `background`, so composing either with `text-outline-fill` looked disjoint to the
   * compiler while both primitives paint the same glyphs' fill — see `catalog/text.ts`'s
   * `text-shimmer`/`text-sweep` primitives, now on `color` too, for the fix.
   */
  color: ['color', '-webkit-text-fill-color'],
  // `-webkit-text-stroke` is `text-outline-fill`'s other half — see `-webkit-text-fill-color`
  // above. Filed under `stroke` because that is the channel `text-outline-fill` already declares,
  // grouping it with the SVG stroke properties above as "an outline traced around a shape,"
  // text glyphs included.
  stroke: ['stroke-dashoffset', 'stroke-dasharray', 'stroke', '-webkit-text-stroke'],
  /**
   * `skew` claims the whole `transform` shorthand, because CSS never gave skew an independent
   * property the way it did `translate`/`rotate`/`scale`. Anything that writes `transform` replaces
   * all of it, so every primitive that does shares this one channel regardless of what it uses
   * `transform` for — `scroll-skew`, `flip-face` (the 3D-flip family: `card-flip-x`/`-y`,
   * `cube-rotate`, `book-page-turn`, `fold-panel`), and `flip-3d` (the entrance family:
   * `flip-in-x`/`-y`, `flip-out-x`/`-y`) are the three members.
   */
  skew: ['transform'],
  /**
   * CSS Motion Path's four properties, all under one channel because they are one mechanism:
   * `offset-distance` means nothing without `offset-path`, and `offset-rotate`/`offset-anchor`
   * only apply while a path is set. Nothing outside `effects/motion-path` writes any of them.
   *
   * Deliberately *not* filed under `translate`/`rotate`. The motion-path transform is a separate
   * stage from the individual transform properties — both apply, neither overwrites the other —
   * so a path-driven element genuinely can compose with a `parallax-y` or a spin, and grouping
   * them would make the compiler reject pairs that do not collide.
   */
  offset: ['offset-path', 'offset-distance', 'offset-rotate', 'offset-anchor'],
  text: ['letter-spacing', 'word-spacing', 'font-variation-settings'],
  font: ['font-weight', 'font-stretch', 'font-style'],
  shadow: ['box-shadow'],
}
