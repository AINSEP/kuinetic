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
export const COLOR_PARAMS: Record<string, ParameterSchema> = {
  borderDraw: { color: { type: 'color', default: '', cssProperty: '--kui-border-draw-color' } },
  borderGlow: { color: { type: 'color', default: '', cssProperty: '--kui-border-glow-color' } },
  underlineSlide: { color: { type: 'color', default: '', cssProperty: '--kui-underline-slide-color' } },
  underlineCenter: { color: { type: 'color', default: '', cssProperty: '--kui-underline-center-color' } },
}
