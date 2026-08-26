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
  /**
   * The `mask` shorthand and `mask-composite` sit here beside the longhands, for the same reason
   * `background` below lists `background` beside *its* longhands: a shorthand resets every
   * longhand it covers, so a rule writing `mask:` clobbers a `mask-image` another effect painted
   * just as thoroughly as a second `mask-image` would. Listing only the longhands left the
   * shorthand untracked, which meant `ambient-gradient-ring`'s ring rules (`mask` +
   * `mask-composite`, in `ambient.css`) were invisible to the static-rule check — the primitive
   * declares `'mask'` correctly today, but nothing here was verifying that, and the next primitive
   * to reach for the shorthand would not have been caught either.
   *
   * `-webkit-mask-composite` is the prefixed twin, tracked for the same reason
   * `-webkit-text-fill-color` and `-webkit-text-stroke` are: the property scanner admits
   * vendor-prefixed names, so leaving one half of a prefixed pair unmapped is a hole with the
   * shape of a covered channel.
   */
  mask: [
    'mask-image',
    'mask-position',
    'mask-size',
    'mask',
    'mask-composite',
    '-webkit-mask-composite',
  ],
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
  /**
   * `text-shadow` gets a channel of its own rather than joining `box-shadow` under `shadow`.
   *
   * They are independent CSS properties: writing one never disturbs the other, so a card that
   * lifts on a `box-shadow` while its heading carries an extruded `text-shadow` —
   * `data-kui="lift-shadow, text-3d-extrude"` — is physically fine. Folding both into one channel
   * would make the compiler refuse that pair, which is the *opposite* failure from the one the
   * `mask`/`clip` note at the top of this file guards against: not two channel names over one
   * property, but one channel name over two properties that never collide. Same reasoning as
   * `offset`, which is deliberately kept out of `translate`/`rotate` because both stages apply and
   * neither overwrites the other.
   *
   * Splitting also keeps the *existing* `shadow` members honest. Filed together, `lift-shadow` and
   * `border-glow` — which declare `shadow` for their `box-shadow` work — would silently gain
   * permission to paint `text-shadow` too, and this map's whole job is to withhold exactly that.
   *
   * Until this entry existed the property was mapped under no channel at all, so it never reached
   * `TRACKED_PROPERTIES` and the static-rule check in `css-invariants.test.ts` skipped it
   * outright — structurally invisible rather than merely unasserted. `text-3d-extrude` is the one
   * primitive writing it today (an unconditional stack in `text.css`); it declared only
   * `rotate`/`translate` for the whole time the hole was open.
   */
  'text-shadow': ['text-shadow'],
}
