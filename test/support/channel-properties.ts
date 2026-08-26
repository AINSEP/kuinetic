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
    /**
     * `background-repeat` and `background-clip` (`-webkit-background-clip` its prefixed twin, same
     * reasoning as `-webkit-mask-composite` above) were the two remaining background longhands
     * with no channel to land in. Widening an existing channel rather than opening a new one,
     * because every current writer of either already declares `background` for the shorthand or a
     * sibling longhand: `ambient-tint` (`scanline`/`starfield`/`spotlight-follow`/`wave-blob`),
     * `feedback-burst` (`confetti-burst`), and `text-shimmer`/`text-sweep`
     * (`gradient-shimmer`/`gradient-sweep`/`highlight-sweep`/`underline-draw`) all declare
     * `background` already — confirmed against every writer of either property before adding this,
     * not assumed from the primitive names.
     */
    'background-repeat',
    'background-clip',
    '-webkit-background-clip',
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
  /**
   * `fill` joins the SVG-outline properties below it, not `background`: every current writer is a
   * `path-draw` or `stroke-sweep` preset that pairs `fill: none` with `stroke-dasharray` on the same
   * unconditional rule, so an unclosed path does not paint its interior while the stroke draws
   * (`svg.css`'s `draw-stroke`/`draw-signature`/`draw-underline`/`checkmark-draw`/`cross-draw`/
   * `chart-line-draw`, `numbers.css`'s `progress-ring`/`gauge-sweep`/`donut-sweep`/`sparkline-draw`
   * — all six declare `channels: ['stroke']` already). Static today — none of them animate `fill` —
   * so nothing currently exercises this beyond the static-rule check, but the day an SVG effect
   * *does* animate a shape's fill, a composed `background`- or `color`-channel effect would
   * otherwise be free to paint over it unflagged.
   */
  stroke: ['stroke-dashoffset', 'stroke-dasharray', 'stroke', '-webkit-text-stroke', 'fill'],
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
  /**
   * `border-draw`'s only channel-tracked writes: the shorthand it uses to seed a transparent 2px
   * base ring, and the two `border-image-*` longhands that paint the animated conic-gradient over
   * it (`interaction.css`'s `[data-kui-fx~='border-draw']` rule). `allowedProperties()` returned an
   * empty set for `channels: ['border']` before this entry existed, which made every property
   * `border-draw` writes structurally invisible to the static-rule check — the same "absent, not
   * merely unasserted" hole the top-of-file note describes for `text-shadow`.
   *
   * Deliberately narrow. Plain `border-color`/`border-width`/`border-style`/`border-top-color` stay
   * untracked on purpose: `feedback.css`'s `spinner`/`spinner-ring` (primitive `feedback-spin`,
   * declared channel `rotate`) and `forms.css`'s `.kui-spinner` each paint a static ring with a
   * plain `border`/`border-top-color` that never varies and was never meant to compose against
   * anything. Tracking the shorthand itself would flag both as new violations for a primitive this
   * map does not own the fix for, the day this entry went from absent to present. `beam-border`/
   * `beam-border-auto` also declare `border`, but their ring lives entirely on `::before` — nothing
   * here checks a pseudo-element's own rule (see "pseudo-element ownership" in
   * `css-invariants.test.ts`), so their static rule contributes nothing to this channel today.
   */
  border: ['border-image-source', 'border-image-slice'],
  /**
   * `shine-sweep` is the one primitive on this channel, and every property its sweep actually
   * paints — `background`, `background-size`, `background-position` — lives on its own `::after`
   * (`interaction.css`), which both `extractBaseRuleProperties` and `extractHostAnimationBindings`
   * deliberately skip (see their doc comments: a pseudo-element paints a different box than the one
   * `data-kui-fx` sits on, so it cannot clobber a composed effect's property there the way an
   * always-on base-selector rule can). So there is nothing on the *host* element for this channel to
   * police yet, and an empty array is the honest answer rather than a placeholder for properties
   * that would just create the "two channel names, one physical property" hazard this file's
   * opening note warns about if filed under `background` too.
   *
   * Declaring the channel anyway — rather than leaving it absent — turns `allowedProperties(['sweep'])`
   * from an unintentional `?? []` fallback into an intentional, documented one, and gives it a home
   * to grow into if the pseudo-element audit ever gets extended to check that box directly.
   */
  sweep: [],
  /**
   * One property, its own channel — same shape as `text-shadow` above, and for the same reason:
   * `transform-origin` does not collide with a transform the way writing `transform` itself would
   * (that failure already has a channel — `skew`, above). It changes what every transform on the
   * element *pivots around*. Two primitives that compose because their `translate`/`scale`/`rotate`/
   * `skew` channels are disjoint can still silently disagree about where "home" is, if only one of
   * them gets to declare the origin.
   *
   * Seven primitives write it on their own unconditional rule, covering all eight named writers:
   * `progress` (`scroll-progress-bar`/`scroll-progress-bar-y`, `core.ts`/`scroll.css`),
   * `feedback-progress-track` (`progress-indeterminate`, `feedback.ts`/`feedback.css`),
   * `feedback-ripple` (`ripple`, `feedback.ts`/`feedback.css`), `meter-bar` (`progress-bar`,
   * `numbers.ts`/`numbers.css`), `flip-face` (`book-page-turn`/`fold-panel`, of its five presets —
   * `card-flip-x`/`-y`/`cube-rotate` don't write it — `three-d/index.ts`/`three-d.css`), `bar`
   * (`loading-bar`, `three-d/index.ts`/`three-d.css`), and `bar-grow` (`chart-bar-grow`,
   * `effects/svg/index.ts`/`svg.css`). `underline-slide`/`underline-center`/`label-float`/
   * `input-underline-grow` also write `transform-origin`, but on a pseudo-element or a sibling —
   * never the host `data-kui-fx` element — so neither scanner reaches them and they need no
   * channel entry here.
   */
  'transform-origin': ['transform-origin'],
}
