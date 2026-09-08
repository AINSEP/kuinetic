import type { Registry } from '../../src/core/registry.js'

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
  /**
   * `backdrop-filter` and its `-webkit-` twin (tracked for the same reason
   * `-webkit-mask-composite` is: the property scanner admits vendor-prefixed names, so leaving one
   * half of a prefixed pair unmapped is a hole with the shape of a covered channel).
   *
   * Deliberately **not** folded into `filter` above, even though the two properties differ by one
   * word. They are independent CSS properties — an element can carry both, and writing one never
   * disturbs the other — so a shared channel would make the compiler refuse `glass, blur`,
   * which is a coherent request: blur your own content *and* the backdrop behind you. That is the
   * "one channel name over two properties that never collide" failure the `text-shadow` entry
   * below documents at length, and the fix is the same one: a channel of its own.
   *
   * `glass` (`catalog/materials.ts`) is the only member today and the only writer of either
   * property in the catalog — confirmed by grep across `src/` before this entry was added, the
   * same discipline the `background`/`layout`/`discrete` entries record. Until it existed
   * `backdrop-filter` was in no channel at all, which made it structurally invisible to the
   * static-rule check rather than merely unasserted.
   */
  backdrop: ['backdrop-filter', '-webkit-backdrop-filter'],
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
  text: ['letter-spacing', 'word-spacing'],
  /*
   * `font-variation-settings` is filed here rather than under `text`, where it sat unused until
   * `var-axis` became the first primitive in the catalog to write it.
   *
   * `text` would have been the "two different channel names, one physical property" collision this
   * file's header describes, and a live one rather than a hypothetical: `font-variation-settings`
   * overrides `font-weight`/`font-stretch`/`font-style` for any axis it names, so a `var-axis`
   * on channel `text` and a `var-weight` on channel `font` would look disjoint to the compiler and
   * compose into one element where whichever landed last silently owns the glyph shape. Under one
   * channel the pair is refused, which is the correct answer.
   */
  font: ['font-weight', 'font-stretch', 'font-style', 'font-variation-settings'],
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
   * `border-draw`'s only channel-tracked write today: the registered custom property its transition
   * eases. `allowedProperties()` returned an empty set for `channels: ['border']` before this entry
   * existed, which made every property `border-draw` writes structurally invisible to the
   * static-rule check — the same "absent, not merely unasserted" hole the top-of-file note
   * describes for `text-shadow`.
   *
   * `border-image-source`/`border-image-slice` are kept listed although **nothing writes either one
   * any more.** They were `border-draw`'s ring until that ring moved onto a masked `::before`
   * (`interaction.css` records why: `border-image` ignores `border-radius`, so every rounded card
   * came out with square corners, and there is no workaround inside that approach). Keeping the two
   * longhands mapped costs nothing — an unwritten property is simply never scanned — and withdrawing
   * them would quietly re-open the hole for the next primitive that reaches for a border image,
   * which is the direction this map must not be wrong in.
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
  /**
   * `--kui-border-pct` joins the two longhands below it: `border-draw`'s compiled transition
   * (`Preset.transitions`, `catalog/interaction.ts`) eases this registered custom property, which
   * drives `border-image-source` above it on the same rule — a custom property is attributed to
   * the channel of the physical property it feeds, the same reasoning `--kui-redaction-x`
   * (text.css) would need if anything animated it through a channel this map polices. Before this
   * entry, `border-draw`'s own transition was invisible to the self-consistency check
   * (`transitionsOutsideChannels`, below) the same way the two longhands were invisible before
   * `border` existed at all.
   */
  border: ['border-image-source', 'border-image-slice', '--kui-border-pct'],
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
   * `pseudo-before` is `sweep`'s opposite number: the ownership token for "this preset paints its
   * own `::before`", where `sweep` (badly named, see `feedback.ts`) means the same for `::after`.
   * Empty for the identical reason `sweep` is — every property its four members paint lives on the
   * pseudo-element, and both `extractBaseRuleProperties` and `extractHostAnimationBindings`
   * deliberately skip that box — and declared rather than left absent so
   * `allowedProperties(['pseudo-before'])` reads as an intentional "no host property" instead of an
   * accidental `?? []`.
   *
   * Members: `border-draw`, `beam-border`, `beam-border-auto`, `cursor-spotlight`. `border-draw`
   * joined the box when its ring moved off `border-image`, and the other three were given the token
   * in the same change — a channel with one member refuses nothing, so declaring it only on the new
   * arrival would have documented the ownership without enforcing it. `redaction-reveal`
   * (`catalog/text.ts`) is the one `::before` painter still outside it, which is why
   * `border-draw + redaction-reveal` appears in `css-composition-invariants.test.ts`'s enumerated
   * collision list rather than being refused; adding the token there is the one-line follow-up.
   */
  'pseudo-before': [],
  /**
   * `masked-label-swap`'s three names, one primitive (`label-swap`, `catalog/interaction-reveal.ts`).
   *
   * All three properties are custom properties written on the *host* rule and read by the marked
   * parts' own standalone `[data-kui-swap]` rule, so they are attributed to the channel of the
   * physical property they feed — `translate`, on a child box — exactly the reasoning
   * `--kui-border-pct` records under `border` above. They are listed rather than left untracked so
   * the static-rule check can see the host rule writing them at all; the alternative is the
   * structurally-invisible state this map exists to end.
   *
   * A channel of its own rather than `translate`, for the reason `group` is not `opacity`: the
   * motion is on a child box, so folding it into `translate` would make the compiler refuse
   * `data-kui="lift, masked-label-swap"` — a button that rises while its label swaps — although the
   * two never touch the same box.
   */
  'label-swap': [
    '--kui-label-swap-shown',
    '--kui-label-swap-lag',
    '--kui-label-swap-dx',
    '--kui-label-swap-dy',
  ],
  /**
   * `hover-intent`'s two inherited signals, same shape and same reasoning as `label-swap` above:
   * written on the host rule, read by the standalone `[data-kui-hint]` rule, feeding `opacity` and
   * `translate` on a child box that no other effect can reach.
   */
  hint: ['--kui-hover-intent-shown', '--kui-hover-intent-lag'],
  /**
   * `anchored-preview`'s four inherited signals, same shape and reasoning as `hint`/`label-swap`
   * above: written on the host rule (one pair for state, one pair precomputed per placement
   * preset), read by the standalone `[data-kui-preview]` rule, feeding `opacity`/`scale`/`translate`
   * on a child box no other effect can reach. `catalog/interaction-reveal.ts`'s doc comment on the
   * primitive has the full placement-geometry derivation.
   */
  preview: [
    '--kui-anchored-preview-shown',
    '--kui-anchored-preview-lag',
    '--kui-anchored-preview-inset',
    '--kui-anchored-preview-travel',
  ],
  /**
   * `search-expand`'s two inherited signals, same shape and reasoning as `hint` above: written on
   * the host rule's `:focus-within`/`:hover`/`:has(...)` states, read by the standalone
   * `[data-kui-search-field]` rule, feeding `opacity` on the nested `<input>` — a child box the
   * host's own `expand`/`discrete` channels (below) never touch.
   */
  'search-field': ['--kui-search-expand-shown', '--kui-search-expand-lag'],
  /**
   * `search-expand`'s own box: the one physical property this primitive claims on its own host,
   * `inline-size`. A channel of its own for the reason `skew`/`border` document — no existing
   * channel names this property, and folding it into `layout` (which already tracks
   * `padding-block`/`font-size` for `header-shrink`) would couple two primitives that have nothing
   * to do with each other.
   */
  expand: ['inline-size'],
  /**
   * `proximity-field`'s ownership token — the container that tracks the pointer and publishes
   * `--kui-proximity-x`/`-y`/`-opacity` for `proximity-glow` (below) to read. Declared empty rather
   * than left absent, for the identical reason `sweep`/`pseudo-before`/`group` are: the container
   * paints nothing of its own, so there is nothing on the *host* for this channel to police, and an
   * explicit empty array says so rather than falling through `?? []` by accident. Exists purely so
   * two `proximity-field`s can never be composed on one element.
   */
  proximity: [],
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
  /**
   * `header-shrink`'s only channel-tracked writes on its own unconditional host rule: the two
   * properties `navigation.css` interpolates from the JS-published `--kui-shrink` progress, and
   * the two properties its compiled transition (`Preset.transitions`, `effects/navigation/index.ts`)
   * eases. `header-shrink`'s `box-shadow` write is deliberately NOT added here — it already lives
   * under `shadow`, and `header-shrink`'s primitive now declares that channel too (see
   * `navPrimitive('header-shrink', ...)`), for the same "two channels, one physical property"
   * reason `text-shadow` stays split from `shadow` above.
   *
   * `pin`/`stacking-cards`/`smooth-scroll` (`scroll-mechanics/primitives.ts`) and
   * `parallax-background` (`catalog/media.ts`) are this channel's other members; none of them
   * writes `padding-block`/`font-size` on an unconditional host rule, so widening this list from
   * empty admits nothing new for them — confirmed against every current writer of either property
   * before adding this, the same discipline the `background` entry above documents.
   */
  layout: ['padding-block', 'font-size'],
  /**
   * Declared explicitly empty rather than left absent, so `allowedProperties(['content'])` reads
   * as an intentional "this channel paints no channel-tracked CSS property" instead of an
   * accidental `?? []` fallback — the same reasoning `sweep` above gives for its own empty array.
   * `scramble-text`/`word-cycler` (`catalog/text.ts`) and `count-up` (`catalog/numbers.ts`) are its
   * only members. `word-cycler` also declares `opacity` now, which is the channel its own compiled
   * transition (`Preset.transitions`) actually falls under; `content` itself covers no physical
   * property any of the three writes.
   */
  content: [],
  /**
   * `display`/`overlay` — the two properties `transition-behavior: allow-discrete` exists to
   * animate. `catalog/discrete.ts`'s six `@starting-style` presets are the only writers of
   * `overlay`, and the only ones that write `display: none` for show/hide — that pairing is a
   * distinct question from "did this element's opacity/scale/translate/rotate change", which is
   * why it is not folded into any of those channels the way `transform-origin` was deliberately
   * kept out of `skew` above — conflating "I fade out" with "I leave the DOM entirely" would make
   * the compiler reject compositions that are actually fine (an element that both fades its
   * interior and is itself discretely shown/hidden).
   *
   * `display` alone (never `overlay`) also has eight *unrelated* writers — `feedback-spin`,
   * `feedback-dot-pulse`, `split-flap`, `text-marquee`, `redaction-reveal`, `text-3d-extrude`,
   * `word-cycler`, `card-toggle` — each pinning a static `inline-block`/`flex`/`grid` on its own
   * unconditional rule purely to size or lay out its own box, nothing to do with entering or
   * leaving the DOM. `display` is tracked here as one physical property regardless of which value
   * a primitive writes into it, the same "one property, one channel, whatever put it there"
   * reasoning `text-shadow` documents above — so all eight had to widen their own `channels` to
   * add `discrete` the day this channel was added, or this file's static-rule check would have
   * started flagging box-model declarations that were never a real collision risk with anything
   * written before this channel existed. Confirmed against every existing writer of `display`
   * before adding this entry, the same discipline the `background`/`layout` entries above record.
   */
  discrete: ['display', 'overlay'],
}

/**
 * `channels` a resolved preset's primitive is allowed to write, as concrete CSS property names —
 * the one-line fold `css-invariants.test.ts`'s own local `allowedProperties` already does over
 * `CHANNEL_PROPERTIES`, exported here so `transitionsOutsideChannels` below can share it rather
 * than growing a second private copy that drifts the way the map itself used to.
 *
 * @complexity O(c) time and space in the channel count.
 * @overallScore 100
 */
export function allowedProperties(channels: readonly string[]): Set<string> {
  return new Set(channels.flatMap((channel) => CHANNEL_PROPERTIES[channel] ?? []))
}

/**
 * Every registered preset whose declared `transitions` name a property outside its own
 * primitive's declared channels — the self-consistency question
 * `css-composition-invariants.test.ts`'s "transition channel" assertion 3 asks.
 *
 * This is what keeps the duplicate-transition-property case visible to `findConflicts`: a preset
 * that transitions a property its channels do not cover is invisible to conflict detection for
 * that property, which is exactly the bug `word-cycler` (declaring only `content`) had — it faded
 * `opacity` with nothing to flag a composed effect that also touched it. Fixing the three
 * offenders (`word-cycler`, `header-shrink`, `border-draw`) is what this function exists to keep
 * fixed, not merely to have fixed once.
 *
 * @param registry - Catalog to check every registered preset against.
 * @returns One message per violation, empty when every declared transition is self-consistent.
 * @complexity O(p * t) time in registered presets times their transition segment count; O(v) space
 *   in violation count.
 * @overallScore 100
 */
export function transitionsOutsideChannels(registry: Registry): string[] {
  const violations: string[] = []
  for (const name of registry.names()) {
    const resolved = registry.resolve(name)!
    const { preset, primitive } = resolved
    if (!preset.transitions || preset.transitions.length === 0) continue
    const allowed = allowedProperties(primitive.channels)
    for (const segment of preset.transitions) {
      if (!allowed.has(segment.property)) {
        violations.push(
          `"${name}" transitions "${segment.property}", not covered by channels ` +
            `[${primitive.channels.join(', ')}]`,
        )
      }
    }
  }
  return violations
}
