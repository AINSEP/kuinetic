/**
 * Pure math for the pointer-tracking half of section I (`tilt-3d`, `tilt-parallax`, and the
 * `cursor-*` family) — kept separate from DOM/timer wiring so the position → transform arithmetic
 * is assertable without a browser, the same separation `text-shared.ts` uses for its state
 * machines.
 *
 * `HOVER_TRANSITIONS` at the bottom is an unrelated second concern sharing this file only because
 * `interaction.ts` hit its own 400-line lint ceiling — the same reason `css-invariants.test.ts`
 * split into `css-scan.ts`/`channel-properties.ts`, not a claim that a lookup table belongs beside
 * pointer-tracking arithmetic.
 */

import type { ParameterSchema, TransitionSegment } from '../../core/types.js'

export interface TiltAngles {
  rotateX: number
  rotateY: number
}

/** A pointer position relative to an element's own top-left corner, in pixels. */
export interface LocalPoint {
  x: number
  y: number
}

/** An element's own content box size, in pixels. */
export interface ElementSize {
  width: number
  height: number
}

/**
 * Normalize a pointer position within an element to a -0.5..0.5 offset from centre on each axis,
 * so downstream math never has to branch on element size.
 *
 * @complexity O(1) time and space.
 * @overallScore 100
 */
function centeredOffset(point: LocalPoint, size: ElementSize): LocalPoint {
  return {
    x: size.width > 0 ? point.x / size.width - 0.5 : 0,
    y: size.height > 0 ? point.y / size.height - 0.5 : 0,
  }
}

/**
 * Convert a pointer position within an element into a two-axis tilt, for `tilt-3d`.
 *
 * X drives `rotateY` (moving right tilts the far edge away) and Y drives `rotateX`, inverted, so
 * hovering the top of the card tilts it back rather than forward — the direction a physical card
 * would rotate if pushed at that point.
 *
 * @param point - Pointer position relative to the element's own top-left corner.
 * @param size - Element's own content box size.
 * @param maxAngleDeg - Rotation at the element's edge, in degrees.
 * @returns The rotation to apply on each axis.
 * @complexity O(1) time and space.
 * @overallScore 100
 */
export function tiltAngles(point: LocalPoint, size: ElementSize, maxAngleDeg: number): TiltAngles {
  const centered = centeredOffset(point, size)
  return { rotateY: centered.x * maxAngleDeg * 2, rotateX: -centered.y * maxAngleDeg * 2 }
}

/**
 * Convert a pointer position within an element into a translate offset, for `tilt-parallax`'s
 * per-layer depth effect. The caller multiplies the result by each layer's own depth factor.
 *
 * @param point - Pointer position relative to the element's own top-left corner.
 * @param size - Element's own content box size.
 * @param strengthPx - Translation at the element's edge, in pixels, for a depth of 1.
 * @returns The base offset to scale by each layer's depth.
 * @complexity O(1) time and space.
 * @overallScore 100
 */
export function parallaxOffset(point: LocalPoint, size: ElementSize, strengthPx: number): LocalPoint {
  const centered = centeredOffset(point, size)
  return { x: centered.x * strengthPx * 2, y: centered.y * strengthPx * 2 }
}

/**
 * Whether the environment can express a genuine hover — a touchscreen cannot, and treating a tap
 * as a hover leaves an element visibly "stuck" in its hovered state with no pointer to leave it.
 *
 * @param win - Window to query; injected so tests can supply a fake `matchMedia`.
 * @complexity O(1) time and space.
 * @overallScore 100
 */
export function supportsFineHover(win: Window): boolean {
  return win.matchMedia?.('(hover: hover) and (pointer: fine)').matches ?? true
}

/**
 * Transition segments for the five hover-family presets whose motion is a bare host-rule
 * `transition:` in `interaction.css` (`lift`, `pop`, `lift-shadow`, `border-draw`, `border-glow`).
 * The other eight — `shine-sweep`, `split-flap`, `beam-border`, `underline-slide`,
 * `underline-center`, `icon-wiggle`, `icon-spin`, `icon-bounce` — animate via a keyframed
 * `animation:` on `:hover`/`:focus-visible`, or transition a pseudo-element (`::after`) rather than
 * the host box `Preset.transitions` describes, so they declare none here.
 *
 * A lookup keyed by primitive id, not a parallel array, so a typo in one list can't silently pair
 * the wrong segments with the wrong preset — `HOVER_PRESETS` (`interaction.ts`) still derives its
 * name/primitive pair from `HOVER_PRIMITIVES` the same way it always has.
 */
export const HOVER_TRANSITIONS: Partial<Record<string, TransitionSegment[]>> = {
  lift: [{ property: 'translate' }],
  pop: [{ property: 'scale' }],
  'lift-shadow': [{ property: 'translate' }, { property: 'box-shadow' }],
  'border-draw': [{ property: '--kui-border-pct' }],
  'border-glow': [{ property: 'box-shadow' }],
}

/**
 * The hover names whose motion is a host-level `animation:` in `interaction.css` rather than a
 * transition or a pseudo-element rule — `Preset.delivery`'s one declared value, applied by
 * `HOVER_PRESETS`.
 *
 * Beside {@link HOVER_TRANSITIONS} because it is the same shape of fact about the same family: a
 * per-name detail of how that name's CSS is written, which `HOVER_PRIMITIVES` cannot carry because
 * one primitive backs names on both sides of it.
 *
 * Written out rather than derived, because there is nothing in the effect record to derive it from:
 * `HOVER_TRANSITIONS` does not separate them (`shine-sweep`, `beam-border`, `underline-slide` and
 * `underline-center` are absent from it too, and are safe — they animate a pseudo-element that
 * inline style cannot reach), and neither does the channel list, the renderer, or the parameter
 * set. The fact lives in the stylesheet, so the stylesheet is what audits it:
 * `test/css-composition-invariants.test.ts` derives the true set from `src/css/*.css` with
 * `extractHostAnimationBindings` and fails in both directions, which is what stops this drifting the
 * first time a fifth hover keyframe is added.
 */
export const STYLESHEET_ANIMATED_HOVERS = ['icon-bounce', 'icon-spin', 'icon-wiggle', 'split-flap']

/*
 * `color:` for the border and underline families. Here rather than in `interaction.ts` for the
 * same reason `HOVER_TRANSITIONS` is — that file sits exactly on its 400-line lint ceiling — not
 * because a parameter table belongs beside pointer-tracking arithmetic. One record instead of four
 * loose consts so `interaction.ts` gains a single imported name and no new lines.
 *
 * Every entry declares `default: ''`, and that is the whole contract. An unset `color:` must emit
 * no declaration at all, so the CSS falls through its own `var(--kui-x-color, var(--accent, ...))`
 * chain and the page's accent still wins. A real default here would silently seize the colour from
 * every author who never asked for one. The properties are the ones `interaction.css` already
 * reads — the hooks existed long before anything was wired to them.
 */
/*
 * `beam-border`/`beam-border-auto`'s non-timing parameters. Here for the same reason
 * `COLOR_PARAMS` below and `HOVER_TRANSITIONS` above are: `interaction.ts` sits on the 400-line
 * lint ceiling, and this record was the smallest thing that could move without splitting a
 * primitive from its own registration row.
 *
 * `color`/`outset` carry the empty default `COLOR_PARAMS` documents at length: unauthored means
 * "not in the resolved output at all" (see `resolveParams`), so `interaction.css`'s existing
 * four-stop rainbow fallback in `var(--kui-beam-border-c1, #ff5f6d)` is untouched for every
 * instance that never sets `color:`, and c2-c4 fall back to c1 before their own hardcoded defaults
 * so authoring one colour turns the rainbow into a single-colour beam without a second parameter.
 *
 * `outset:` is the same empty-default story for geometry rather than colour: it pulls the ring out
 * over the host's own border, which the pseudo-element's `inset: 0` alone cannot reach — see that
 * rule's own comment in `interaction.css` for why no CSS length can read a host's `border-width`.
 *
 * ### `arc` and `softness`: the same ring, made soft enough to read as a specular rim
 *
 * These two exist because a glass panel (`catalog/materials.ts`) wants a *rim light* — a soft,
 * partial, blurred arc travelling round the edge — and the obvious move was to mint a second
 * near-duplicate of this effect for it. That was rejected, correctly: the mechanism is identical
 * (a conic gradient rotated behind a perimeter mask) and only the stop geometry differs, so the
 * difference belongs in parameters.
 *
 * **They are geometry, not a filter, and that is forced rather than chosen.** The visually obvious
 * way to soften a ring is `filter: blur()` on the pseudo-element. It does not work here: CSS
 * Filter Effects applies a filter *before* clipping and masking, so the `mask-composite` that cuts
 * this gradient down to the perimeter would slice the blur back to hard inner and outer edges and
 * the ring would come out exactly as crisp as it went in — just dimmer. Softening has to happen in
 * the gradient's own stops, which is what these two do.
 *
 * **The defaults reproduce today's ring exactly**, which is the whole reason they are shaped the
 * way they are. Today's stops are `transparent 260deg`, `c1 282`, `c2 306`, `c3 330`, `c4 354`,
 * `transparent 360`. Read as fractions of a 100deg arc ending 6deg before the seam: the colour ramp
 * is 22% of the arc, and c1..c4 are evenly spaced across what is left. So with `arc:100deg` and
 * `softness:0.22` the `calc()` chain in `interaction.css` resolves to 260/282/306/330/354 — the
 * same six numbers, not merely a similar-looking ring. Every page that never writes either
 * parameter renders identically.
 *
 * `softness` is capped at `0.9` rather than `1`. At exactly `1` the ramp consumes the whole arc,
 * which puts the first colour stop past the last one; CSS clamps out-of-order stops to their
 * predecessor, so the result is a *hard* edge — the opposite of what the parameter's name promises,
 * reached by asking for the maximum of it. `0.9` is the largest value that still leaves the stops
 * in order, and rejecting `1` by name is better than accepting it and rendering the inverse.
 */
export const BEAM_PARAMS: ParameterSchema = {
  color: { type: 'color', default: '', cssProperty: '--kui-beam-border-c1' },
  outset: { type: 'length', default: '', cssProperty: '--kui-beam-border-outset' },
  /**
   * How many degrees of the ring carry colour; the rest is transparent. Small values read as a
   * short bright dash chasing the perimeter, large ones as a full glowing ring.
   *
   * `angle`, so `arc:100`, `arc:100d` and `arc:100deg` are one value (`core/params.ts`'s
   * `BARE_ANGLE`), and `0.28turn` works too.
   */
  arc: { type: 'angle', default: '100deg', cssProperty: '--kui-beam-border-arc' },
  /**
   * What fraction of the arc is spent fading up from transparent to the first colour. `0` is a
   * hard leading edge; `0.9` is an arc that is almost entirely fade, which is the soft specular
   * rim the glass family reaches for.
   *
   * `'number|percentage'` so `softness:0.6` and `softness:60%` are the same request — the union
   * normalises to the number, which is what keeps the bounds below meaningful for both spellings.
   */
  softness: {
    type: 'number|percentage',
    default: '0.22',
    cssProperty: '--kui-beam-border-softness',
    finite: true,
    minimum: 0,
    maximum: 0.9,
  },
}

/*
 * `shine-sweep`'s non-timing parameters — the diagonal band that crosses a control's face on hover.
 *
 * The effect shipped with none at all: the gradient's angle, band width and colour were three
 * literals in `interaction.css`, so a page that wanted a wider or warmer sweep had to restate the
 * whole `::after` rule. These three are those literals, promoted.
 *
 * As with `BEAM_PARAMS` above, the defaults are the existing values rather than an improvement on
 * them: `115deg`, a band spanning 40%→60% of the gradient (hence `width: 0.2`), and the
 * `rgb(255 255 255 / 0.35)` highlight. `interaction.css` computes the two outer stops as
 * `calc(50% ∓ width * 50%)`, which resolves to exactly 40% and 60% at the default.
 *
 * `color` carries the empty default for the reason `COLOR_PARAMS` documents, with one extra wrinkle
 * worth naming: the rule's existing fallback reads `var(--kui-c1, …)` — an un-namespaced property
 * predating the per-effect naming convention. The new parameter is layered *outside* it
 * (`var(--kui-shine-sweep-color, var(--kui-c1, …))`) rather than replacing it, so any page already
 * setting `--kui-c1` keeps working.
 *
 * These are what let a glass panel express its sheen sweep without a new effect: `shine-sweep
 * angle:135deg width:0.4 color:rgb(255 255 255 / 0.5)` is the wide, bright, steeply-raked band the
 * glassmorphism reference asks for, and it is the same primitive a plain button uses.
 */
export const SHINE_PARAMS: ParameterSchema = {
  color: { type: 'color', default: '', cssProperty: '--kui-shine-sweep-color' },
  /** Rake of the band. `115deg` is the shipped default — steeper than a diagonal, which is what
   *  stops it reading as a corner-to-corner wipe. */
  angle: { type: 'angle', default: '115deg', cssProperty: '--kui-shine-sweep-angle' },
  /**
   * Band width as a fraction of the gradient's own span, centred on the midpoint. `0.2` is the
   * shipped 40%→60% band; `1` is a full-width wash with no transparent margin left.
   *
   * `'number|percentage'`, bounded 0..1, for the same reason `softness` above is: `width:40%` and
   * `width:0.4` are the same request, and normalising to the number is what keeps the bounds
   * honest for both.
   */
  width: {
    type: 'number|percentage',
    default: '0.2',
    cssProperty: '--kui-shine-sweep-width',
    finite: true,
    minimum: 0,
    maximum: 1,
  },
}

export const COLOR_PARAMS: Record<string, ParameterSchema> = {
  borderDraw: { color: { type: 'color', default: '', cssProperty: '--kui-border-draw-color' } },
  borderGlow: { color: { type: 'color', default: '', cssProperty: '--kui-border-glow-color' } },
  underlineSlide: { color: { type: 'color', default: '', cssProperty: '--kui-underline-slide-color' } },
  underlineCenter: { color: { type: 'color', default: '', cssProperty: '--kui-underline-center-color' } },
}

/*
 * `border-draw`'s own parameters — its `color:` from `COLOR_PARAMS` above, plus the two knobs its
 * move off `border-image` onto a masked `::before` created rather than invented.
 *
 * `width:` was the literal `2px` in the `border:` shorthand the old rule seeded. While the ring was
 * a real CSS border, a page that wanted a thicker one could restate `border-width` and the
 * `border-image` would follow it; now that the ring is a pseudo-element's padding, nothing a page
 * writes on the host reaches it, so the knob has to exist here or the thickness is unreachable.
 *
 * `outset:` is character-for-character the same problem `BEAM_PARAMS.outset` documents above, and
 * it is here for the same reason: an absolutely positioned pseudo-element resolves `inset` against
 * its host's *padding* box, so every pixel of border on the host pushes this ring that far inward,
 * and no CSS length can read a host's `border-width` to compensate automatically. `0px` — not the
 * empty default the colour parameters carry — because unlike a colour, "not authored" here has a
 * correct concrete answer: a borderless host's padding box already is its border box.
 */
export const BORDER_DRAW_PARAMS: ParameterSchema = {
  ...COLOR_PARAMS.borderDraw,
  width: { type: 'length', default: '2px', cssProperty: '--kui-border-draw-width' },
  outset: { type: 'length', default: '0px', cssProperty: '--kui-border-draw-outset' },
}
