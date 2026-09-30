import type { Cleanup } from '../../core/types.js'
import type { PrepareContext } from '../../core/effect-context.js'
import type { StyleLedger } from '../../core/owned-styles.js'
import { frameScheduler, watchElementSize } from '../../core/element-size.js'

/**
 * The largest radius at which a depth ring still fits the page it is on.
 *
 * A depth ring's radius is derived from its cards (or authored) and knows nothing about the width
 * it got, so on a phone its edge cards project hundreds of pixels past the screen and push the page
 * sideways. This file finds the radius at which that stops happening, and `carousel.css` uses
 * `min(wanted, fit)`: a ring that already fits — every desktop ring — is untouched to the pixel,
 * and only a ring that would overflow is pulled in, exactly as far as it has to be.
 *
 * ## Why a solver in JavaScript and not a formula in the stylesheet
 *
 * The first attempt was CSS: a size container on the host and one closed-form bound,
 * `R = D * cos(atan2(D, P))`, with `D` the host's half-width less half a card. It was correct and
 * far too cautious, because a closed form has to assume the worst case: a card at *any* angle, seen
 * from the side, at full width. Real rings reach much less than that. A 180-degree inside slice
 * never shows a card past a quarter turn; a card at the silhouette is turned nearly edge-on; the
 * tilt, the facing and the perspective all move where a card's corners land. The bound shrank the
 * showcase's rows at 1440px from radius 805 to 500 — rings that were not overflowing anything.
 *
 * The exact answer is a maximum over the angles the ring can actually reach, of where each card's
 * *corners* project under the ring's own perspective, tilt and facing — and a stylesheet cannot
 * take a maximum over a continuous range. It also needs two facts CSS cannot see at all: where the
 * host sits on the page (a ring off-centre has less room on one side), and whether anything
 * between it and the page already clips it. So the geometry is solved here, once per resize, and
 * published as one length (`--kui-ring-fit`) the stylesheet spends.
 *
 * The size container went with the formula. It had a side effect the solver does not: a host sized
 * by its content (a flex or grid item with no width) took its container's width instead. Nothing
 * here changes how any host is sized — the solver measures the page and writes one custom property.
 *
 * ## What counts as "the page"
 *
 * The nearest ancestor that contains horizontal overflow decides, walking up to (not including)
 * `<body>`:
 *
 * - `overflow-x: clip` or `hidden` — the author has already decided what happens past that edge:
 *   the ring bleeds and is cut, which is a composition (the showcase's rows run off both sides of
 *   their band on purpose). Nothing is fitted; the ring keeps the radius it asked for.
 * - `auto` or `scroll` — overflow would scroll that box sideways, so the ring fits its padding box.
 * - none — the ring fits the page's own width, `0..clientWidth` in document coordinates.
 *
 * `<html>` and `<body>` are skipped for the reason `warnFlatteningAncestor` stops at `<body>`: a
 * page-level `overflow-x: hidden` is on a large fraction of all sites as a blanket guard, not a
 * statement that this ring should be cut off at the screen edge.
 *
 * ## Which cards count
 *
 * Every card on the reachable arc, as it moves: a card sits within half a place of its offset
 * while it is dragged or spun, so the reachable angles are the offsets' range widened by half a
 * spacing each side — the whole circle for a full ring. On an *inside* ring a card at or past a
 * quarter turn is `visibility: hidden` (`carousel.css`), so only the front half counts. On an
 * outside ring every angle counts: the far half is content there, and its cards sit further from
 * the camera than the near half's, so they never set the width anyway.
 */

/** Custom property this module owns on the ring host. */
export const RING_FIT_PROPERTY = '--kui-ring-fit'

/** Angular sampling of the reachable arc. At the largest radius a phone reaches this is < 1px. */
const SAMPLE_DEG = 0.25

/** Upper end of the search. A ring that fits even here fits at any radius, and gets no cap. */
const SEARCH_CEILING_PX = 100_000

/** Bisection steps: 100000 / 2^34 is well under a hundredth of a pixel. */
const SEARCH_STEPS = 34

const RAD = Math.PI / 180

/** Everything the projection needs, in pixels and degrees. */
export interface RingFitGeometry {
  /** A card's laid-out size. */
  width: number
  height: number
  /** The host's `perspective`; `Infinity` for `none`. */
  perspective: number
  /** The `rotateX` every slot is placed under — the stylesheet's `--kui-ring-tilt`, not the param. */
  tiltDeg: number
  /** Whether cards sit behind the host's plane (`carousel-3d-inside`). */
  inside: boolean
  /** Whether each card is counter-rotated to face the viewer. */
  facing: 'radial' | 'camera'
  /** The reachable ring angles (see {@link reachableAngles}). */
  fromDeg: number
  toDeg: number
  /** The slot centre's horizontal distance from the perspective origin. */
  originOffset: number
  /** The page's edges, as horizontal distances from the perspective origin (min < 0 < max). */
  minX: number
  maxX: number
}

/**
 * The ring angles a card can occupy, in the stylesheet's own terms.
 *
 * `carousel.css` places a slot at `(offset - drift) * arc / count`. Offsets are circular, from
 * `floor(count/2) - count + 1` to `floor(count/2)` (`circularOffset`), and the drift stays within
 * half a place either way (`snapPosition`), so the union over every card and every moment is that
 * range widened by half a spacing each side. A full ring reaches the whole circle.
 *
 * @complexity O(1) time and space.
 */
export function reachableAngles(arcDeg: number, count: number): { fromDeg: number; toDeg: number } {
  if (Math.abs(arcDeg) >= 360) return { fromDeg: -180, toDeg: 180 }
  const places = Math.max(1, count)
  const spacing = arcDeg / places
  const high = Math.floor(places / 2)
  const low = high - places + 1
  const ends = [(low - 0.5) * spacing, (high + 0.5) * spacing]
  return { fromDeg: Math.min(...ends), toDeg: Math.max(...ends) }
}

type Vec = [number, number, number]

/** Sines and cosines of one placement: the ring angle `a` and the camera tilt `t`. */
interface Rotation {
  sinA: number
  cosA: number
  sinT: number
  cosT: number
}

/** CSS `rotateY(a)` followed by `rotateX(t)` applied to a point: the slot's placement rotations. */
function place(point: Vec, { sinA, cosA, sinT, cosT }: Rotation): Vec {
  const [x, y, z] = point
  const x1 = x * cosA + z * sinA
  const z1 = -x * sinA + z * cosA
  return [x1, y * cosT - z1 * sinT, y * sinT + z1 * cosT]
}

/**
 * Whether one card, placed at one angle, projects inside the page. False as well for a corner at or
 * behind the camera plane: a ring the viewer is inside of never fits.
 *
 * @complexity O(1).
 */
function cardFits(g: RingFitGeometry, r: number, rotation: Rotation): boolean {
  const z0 = (g.inside ? -1 : 1) * r
  const centre = place([0, 0, z0], rotation)
  const hw = g.width / 2
  const hh = g.height / 2
  for (const [cx, cy] of [[-hw, -hh], [hw, -hh], [-hw, hh], [hw, hh]] as const) {
    const [x, , z] = g.facing === 'camera' ? [centre[0] + cx, centre[1] + cy, centre[2]] : place([cx, cy, z0], rotation)
    if (z >= g.perspective - 1) return false
    const scale = Number.isFinite(g.perspective) ? g.perspective / (g.perspective - z) : 1
    const screen = (g.originOffset + x) * scale
    if (screen < g.minX || screen > g.maxX) return false
  }
  return true
}

/**
 * Whether every card corner, at every sampled angle, projects inside the page at radius `r`.
 *
 * The corner maths is the stylesheet's transform read as matrices: `rotateX(t) rotateY(a)
 * translateZ(±r)` on the card's corners for `facing:radial`; for `facing:camera` the child's
 * counter-rotation cancels both rotations, so the card is the placed centre plus its flat corners.
 * A corner at or behind the camera plane is a ring the viewer is inside of, which never fits.
 *
 * @complexity O(s) in samples of the reachable arc.
 */
function fitsAt(g: RingFitGeometry, r: number, angles: readonly number[]): boolean {
  const sinT = Math.sin(g.tiltDeg * RAD)
  const cosT = Math.cos(g.tiltDeg * RAD)
  return angles.every((angle) => cardFits(g, r, { sinA: Math.sin(angle * RAD), cosA: Math.cos(angle * RAD), sinT, cosT }))
}

/**
 * The reachable angles, sampled, with the ends included exactly.
 *
 * An inside ring hides every card at or past a quarter turn, so its arc stops there — the edge-on
 * card at exactly 90 degrees is the supremum of what is shown, and is included as the limit.
 *
 * @complexity O(s) time and space in samples.
 */
function sampleAngles(g: RingFitGeometry): number[] {
  const from = g.inside ? Math.max(g.fromDeg, -90) : g.fromDeg
  const to = g.inside ? Math.min(g.toDeg, 90) : g.toDeg
  const steps = Math.max(1, Math.ceil((to - from) / SAMPLE_DEG))
  return Array.from({ length: steps + 1 }, (_, i) => from + ((to - from) * i) / steps)
}

/**
 * The largest radius at which the ring fits, or `Infinity` when every radius does.
 *
 * Bisection, because the extent grows with the radius: every card moves outward along its own
 * direction, and the perspective only magnifies that on the near side and shrinks it less than
 * linearly on the far side. Floored to a hundredth of a pixel so rounding never lands outside.
 *
 * @complexity O(s * k) — samples of the arc times {@link SEARCH_STEPS}; runs on resize, never per
 *   frame.
 */
export function solveRingFit(g: RingFitGeometry): number {
  const angles = sampleAngles(g)
  if (!fitsAt(g, 0, angles)) return 0
  if (fitsAt(g, SEARCH_CEILING_PX, angles)) return Infinity
  let low = 0
  let high = SEARCH_CEILING_PX
  for (let i = 0; i < SEARCH_STEPS; i++) {
    const mid = (low + high) / 2
    if (fitsAt(g, mid, angles)) low = mid
    else high = mid
  }
  return Math.floor(low * 100) / 100
}

/** The box a ring has to fit, in viewport coordinates, or `null` when an ancestor clips it. */
export function fitBounds(el: Element, win: Window): { left: number; right: number } | null {
  const doc = el.ownerDocument
  for (let node = el.parentElement; node && node !== doc.body && node !== doc.documentElement; node = node.parentElement) {
    const overflow = win.getComputedStyle(node).overflowX
    if (overflow === 'clip' || overflow === 'hidden') return null
    if (overflow === 'auto' || overflow === 'scroll') {
      const left = node.getBoundingClientRect().left + node.clientLeft
      return { left, right: left + node.clientWidth }
    }
  }
  const left = -win.scrollX
  return { left, right: left + doc.documentElement.clientWidth }
}

/** A length off `getComputedStyle`, or the fallback for `none`/unparsable. */
function pixels(value: string, fallback: number): number {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

/** What the ring tells the fit that the page cannot: its parameters. */
export interface RingFitOptions {
  el: Element
  ctx: PrepareContext
  styles: StyleLedger
  arcDeg: number
  /** The `tilt:` parameter in degrees, before the stylesheet's negation and clamp. */
  tiltParamDeg: number
  facing: 'radial' | 'camera'
}

/**
 * Keep a depth ring's `--kui-ring-fit` current: at every full render whose cards changed, and on
 * every resize of the host or the page (coalesced to one solve per frame).
 *
 * @complexity O(s * k) per solve (see {@link solveRingFit}); O(1) space.
 */
export function createRingFit(options: RingFitOptions): { render(nodes: readonly Element[], count: number): void; release: Cleanup } {
  const { el, ctx, styles } = options
  // A realm with no layout (a server render, a test double) has no page for the ring to overflow,
  // and a fit must never be the thing that throws during `prepare`.
  if (typeof ctx.win.getComputedStyle !== 'function' || typeof ctx.win.addEventListener !== 'function') {
    return { render() {}, release() {} }
  }
  // The stylesheet's `--kui-ring-tilt`: negated, clamped to ±80deg. See `carousel.css`.
  const tiltDeg = Math.min(80, Math.max(-80, -options.tiltParamDeg))
  let card: HTMLElement | undefined
  let count = 1

  const solve = (): void => {
    const bounds = fitBounds(el, ctx.win)
    if (!bounds || !card || card.offsetWidth === 0) {
      styles.set(RING_FIT_PROPERTY, '')
      return
    }
    const style = ctx.win.getComputedStyle(el)
    const host = el.getBoundingClientRect()
    const originX = host.left + pixels(style.perspectiveOrigin, host.width / 2)
    const fit = solveRingFit({
      width: card.offsetWidth,
      height: card.offsetHeight,
      perspective: pixels(style.perspective, Infinity),
      tiltDeg,
      // The stylesheet's own selector for the concave placement, read rather than threaded through
      // as a parameter: the name is what `carousel.css` branches on, so it is what this must too.
      inside: el.matches("[data-kui-fx~='carousel-3d-inside']"),
      // `facing:camera` counter-rotates the slot's element *children* (`carousel.css`); a slot with
      // none — bare text — is drawn at its radial angle, and is fitted as the radial card it is.
      facing: card.firstElementChild ? options.facing : 'radial',
      ...reachableAngles(options.arcDeg, count),
      originOffset: host.left + host.width / 2 - originX,
      minX: bounds.left - originX,
      maxX: bounds.right - originX,
    })
    styles.set(RING_FIT_PROPERTY, Number.isFinite(fit) ? `${fit}px` : '')
  }

  const frame = frameScheduler(ctx.win, solve)
  const watch = watchElementSize(ctx.win, frame.request)
  watch.observe(el)
  watch.observe(el.ownerDocument.documentElement)

  return {
    render(nodes, total) {
      const first = nodes[0] as HTMLElement | undefined
      if (first === card && total === count) return
      card = first
      count = total
      solve()
    },
    release() {
      watch.disconnect()
      frame.cancel()
    },
  }
}
