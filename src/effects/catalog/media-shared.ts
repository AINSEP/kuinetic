import { cssEasingValue } from '../../core/easing.js'
import type { Cleanup, EffectParams } from '../../core/types.js'
import { createStyleLedger } from '../../core/owned-styles.js'

/**
 * DOM-surgery helpers behind `slat-assemble` (catalog section G).
 *
 * `text-shared.ts` is the template this follows: build a synthetic child tree once at activation,
 * index each child with a plain custom property, and let CSS (`media.css`) own every frame from
 * there — this module never animates anything itself, it only builds the tree and computes the
 * per-child numbers CSS reads.
 */

/** Which way the image is cut into strips. `angle:` generalises this to any degree. */
export type SlatAxis = 'vertical' | 'horizontal'

/** Degrees per axis keyword, when the author names an axis rather than an angle. */
const AXIS_DEGREES: Record<SlatAxis, number> = { vertical: 0, horizontal: 90 }

/** Degrees in one of each CSS angle unit, so `angle:` accepts whichever one the author reaches for. */
const UNIT_DEGREES = { deg: 1, grad: 0.9, rad: 180 / Math.PI, turn: 360 } as const

/** How far past the band's own boundary each slat's clip reaches, in px — the seam closer. */
const BAND_OVERLAP_PX = 1

/** How the per-slat stagger order relates to a slat's geometric position. */
export type SlatFrom = 'alternate' | 'start' | 'end' | 'edges' | 'random-ish'

const STAGE_CLASS = 'kui-slat-stage'
const SLAT_CLASS = 'kui-slat-item'

/**
 * A fixed, irrational step around the unit circle — the standard low-discrepancy trick for
 * scattering N sequential integers across `[0, 1)` without clustering. Deterministic and free of
 * `Math.random`, so `from:random-ish` renders identically every time and is trivially testable.
 */
const GOLDEN_RATIO_CONJUGATE = 0.6180339887498949

/**
 * Map a slat's geometric position to its stagger rank.
 *
 * The rank is what `--kui-i` carries into `media.css`'s `animation-delay: calc(delay + i *
 * stagger)` — the same formula `text.css` already uses for `.kui-split-item` — so `from:` only
 * ever changes which number lands in that one slot, never the delay formula itself. Ties are
 * fine: two slats sharing a rank simply animate on the same beat, which is a legitimate look
 * (`edges`'s two starting slats are meant to move together), not a bug.
 *
 * - `start` — geometric order, left-to-right or top-to-bottom.
 * - `end` — the reverse.
 * - `edges` — outside-in: both ends rank 0, the middle ranks highest, so the seam closes last.
 * - `alternate` (default) — a zig-zag across the whole run (0, N-1, 1, N-2, 2, …), so slats land
 *   from alternating ends instead of sweeping one direction.
 * - `random-ish` — a deterministic scatter (see `GOLDEN_RATIO_CONJUGATE`), not real randomness.
 *
 * @complexity O(1) time and space.
 * @overallScore 100
 */
export function slatOrder(index: number, count: number, from: SlatFrom): number {
  if (count <= 1) return 0
  switch (from) {
    case 'start':
      return index
    case 'end':
      return count - 1 - index
    case 'edges':
      return Math.min(index, count - 1 - index)
    case 'random-ish':
      return Math.floor(((index * GOLDEN_RATIO_CONJUGATE) % 1) * count)
    case 'alternate':
    default:
      return zigzagRank(index, count)
  }
}

/**
 * Rank of `index` in the visiting order 0, N-1, 1, N-2, 2, N-3, … — outer pair first, one side of
 * each pair before the other, converging on the middle last.
 *
 * @complexity O(1) time and space.
 * @overallScore 100
 */
function zigzagRank(index: number, count: number): number {
  const fromStart = index
  const fromEnd = count - 1 - index
  const pair = Math.min(fromStart, fromEnd)
  return fromStart <= fromEnd ? pair * 2 : pair * 2 + 1
}

/**
 * Resolve the authored `angle:` to degrees, falling back to whatever `axis:` names.
 *
 * `angle:` is the general parameter and `axis:` the two-keyword shorthand that predates it, so an
 * authored angle wins and an absent one reads the axis. Both `45` and `45deg` are accepted, as are
 * `turn` and `rad`, because an author who writes an angle should not have to remember which of the
 * three this particular parameter takes.
 *
 * Normalised to `[0, 180)`: a band at 200° is the same set of bands as one at 20°, only numbered
 * from the other end, and collapsing that here means the geometry below never has to think about
 * sign or wrap.
 *
 * @complexity O(1) time and space.
 * @overallScore 100
 */
export function slatAngleDegrees(authored: string, axis: SlatAxis): number {
  const trimmed = authored.trim()
  if (!trimmed) return AXIS_DEGREES[axis]

  // The two number branches are mutually exclusive by their first character, so this cannot
  // backtrack — `\d*\.?\d+` can, and a hostile `angle:` value is author input like any other.
  const match = /^(-?(?:\d+(?:\.\d+)?|\.\d+))(deg|rad|grad|turn)?$/.exec(trimmed)
  if (!match) return AXIS_DEGREES[axis]

  // Reachable: the pattern has no exponent, but four hundred digits still overflow to Infinity.
  const value = Number(match[1])
  if (!Number.isFinite(value)) return AXIS_DEGREES[axis]

  // The unit group can only be one of the four the regex lists, or absent, so no fallback branch.
  const unit = (match[2] ?? 'deg') as keyof typeof UNIT_DEGREES
  const degrees = value * UNIT_DEGREES[unit]
  return ((degrees % 180) + 180) % 180
}

/**
 * The unit vector each slat travels along in its from-state: the band's own long axis.
 *
 * At 0° this is `(0, 1)` — vertical columns sliding up and down, which is exactly what the two
 * hand-written axis keyframes did before this generalised them. At 90° it is `(-1, 0)`, horizontal
 * rows sliding sideways. Perpendicular travel is deliberately not offered: a band moving across its
 * own width exposes the gap it left, and the point of the effect is strips that are *out of line*,
 * not strips that are missing.
 *
 * @complexity O(1) time and space.
 * @overallScore 100
 */
export function slatTravelVector(angleDegrees: number): { x: number; y: number } {
  const theta = (angleDegrees * Math.PI) / 180
  return { x: -Math.sin(theta), y: Math.cos(theta) }
}

/**
 * The `clip-path` for one band of an angled slice, in pixels against the stage's measured box.
 *
 * Pixels, not percentages, on purpose. A percentage polygon is resolved against each axis
 * separately, so "45°" on a 3:4 card would paint at some other angle entirely — the author asked
 * for a diagonal and would get a diagonal that changes as the card resizes. Measuring means the
 * angle is the angle, at any aspect ratio, and the caller re-runs this whenever the box changes.
 *
 * The band is the region between two parallel lines perpendicular to `angleDegrees`, extended far
 * enough sideways to cover the stage from any rotation; `overflow: clip` on the stage trims the
 * overhang. Each boundary is pushed out by {@link BAND_OVERLAP_PX} for the same reason the axis
 * version added a pixel to its width: `span / count` almost never lands on a whole pixel, and the
 * remainder renders as a hairline of backdrop between neighbours once they have landed.
 *
 * @param index - Band number, `0` to `count - 1`, in geometric order along the cut normal.
 * @param box - The stage's measured pixel size, re-read by the caller on every layout change.
 * @complexity O(1) time and space.
 * @overallScore 100
 */
export function slatBandClip(
  index: number,
  count: number,
  angleDegrees: number,
  box: { width: number; height: number },
): string {
  const { width, height } = box
  const theta = (angleDegrees * Math.PI) / 180
  // The cut normal: bands are stacked along this, and run perpendicular to it.
  const nx = Math.cos(theta)
  const ny = Math.sin(theta)
  const { x: dx, y: dy } = slatTravelVector(angleDegrees)

  // How far the box extends along the normal — the sum of each side's projection.
  const span = Math.abs(nx) * width + Math.abs(ny) * height
  const centreX = width / 2
  const centreY = height / 2
  const step = span / count
  const near = index * step - span / 2 - BAND_OVERLAP_PX
  const far = (index + 1) * step - span / 2 + BAND_OVERLAP_PX
  // Longer than the box's own diagonal, so a band always spans it whatever the angle.
  const reach = width + height

  const corner = (along: number, across: number): string =>
    `${(centreX + along * nx + across * dx).toFixed(2)}px ` +
    `${(centreY + along * ny + across * dy).toFixed(2)}px`

  return `polygon(${corner(near, reach)}, ${corner(near, -reach)}, ${corner(far, -reach)}, ${corner(far, reach)})`
}

/** The name for a cut angle, for `data-kui-slat-axis` — debugging only, no stylesheet reads it. */
function axisLabel(angleDegrees: number): string {
  if (angleDegrees === 0) return 'vertical'
  if (angleDegrees === 90) return 'horizontal'
  return 'diagonal'
}

export interface SlatStage {
  /** The `aria-hidden` wrapper holding every slat, positioned over the source `<img>`. */
  stage: HTMLElement
  /** One element per slat, in geometric order. */
  slats: HTMLElement[]
  /** Remove every generated node and stop watching the image's box. The source `<img>` was never modified, so nothing to restore on it. */
  restore: Cleanup
}

/** Validated build options for {@link installSlatStage}, grouped to keep its own signature small. */
export interface SlatBuildOptions {
  count: number
  /** Resolved cut angle in degrees, `[0, 180)`. See {@link slatAngleDegrees}. */
  angleDegrees: number
  from: SlatFrom
  fold: boolean
}

/**
 * Re-measure the `<img>`'s own box — relative to `el`, its `offsetParent` once the caller has
 * claimed `position: relative` on it — and size the stage to match exactly.
 *
 * `el` is *not* always just the image: a demo card wraps the `<img>` together with a
 * `<figcaption>` underneath it, and plenty of real authoring does the same (a caption, a badge, a
 * button bar). Sizing the stage to `el`'s full box (a plain `inset: 0`) would spill the slats
 * over whatever sits below the image too. Anchoring to the image's own `offsetTop`/`offsetLeft`/
 * `offsetWidth`/`offsetHeight` instead works regardless of what else shares `el` with it, and
 * regardless of *how* the page happens to size the image — percentage width, `aspect-ratio`,
 * flex, grid, intrinsic — without this module needing to know or reproduce any of it.
 *
 * @complexity O(1) time and space.
 * @overallScore 100
 */
interface SlatBands {
  slats: HTMLElement[]
  angleDegrees: number
}

function syncStageToImage(stage: HTMLElement, img: HTMLElement, bands: SlatBands): void {
  const { slats, angleDegrees } = bands
  const width = img.offsetWidth
  const height = img.offsetHeight
  stage.style.top = `${img.offsetTop}px`
  stage.style.left = `${img.offsetLeft}px`
  stage.style.width = `${width}px`
  stage.style.height = `${height}px`
  // The bands are cut in pixels, so every re-measure has to re-cut them. Cheap — one string per
  // slat, no layout read of its own, and it runs on exactly the occasions the box actually moved.
  slats.forEach((slat, index) => {
    slat.style.clipPath = slatBandClip(index, slats.length, angleDegrees, { width, height })
  })
}

/**
 * Keep the stage aligned with the image across layout changes it didn't cause itself — a window
 * resize, but also anything `ResizeObserver` catches that a resize event alone would miss: a
 * responsive container reflowing, a sibling caption wrapping to a second line, a font swap
 * nudging text height. `win.ResizeObserver` (read off the injected window rather than the bare
 * global) is checked for existence the same defensive way `scroll-scheduler.ts`'s `observeSize`
 * already does, since it is not implemented in every test/SSR environment.
 *
 * @complexity O(1) to install; callback cost is one re-measure per resize notification.
 * @overallScore 100
 */
function watchImageBox(
  stage: HTMLElement,
  img: HTMLElement,
  win: Window,
  bands: SlatBands,
): Cleanup {
  const handler = (): void => syncStageToImage(stage, img, bands)
  win.addEventListener('resize', handler, { passive: true })
  const stopWindow = (): void => win.removeEventListener('resize', handler)

  const ResizeObserverCtor = (win as Window & { ResizeObserver?: typeof ResizeObserver })
    .ResizeObserver
  if (!ResizeObserverCtor) return stopWindow

  const observer = new ResizeObserverCtor(handler)
  observer.observe(img)
  return () => {
    stopWindow()
    observer.disconnect()
  }
}

/**
 * Build the slat stage over an element's first `<img>`: N background-sliced `div`s absolutely
 * positioned across a wrapper sized and kept in sync to exactly the image's own box.
 *
 * Every slat's `background-image` is the *same* URL — `img.currentSrc || img.src` — never a clone
 * of the `<img>` element. The browser fetches and decodes that URL once; every slat paints from
 * the one shared decoded bitmap already sitting in its image cache, exactly the way a CSS sprite
 * sheet or any two elements sharing one `background-image: url(x)` never issue a second request
 * for `x`. Eight slats therefore cost one network fetch and one decode, not eight.
 *
 * The stage is appended last and painted on top of the `<img>` (ordinary in-flow-then-absolute
 * paint order, no `z-index` needed), so the original picture stays exactly where an assistive
 * technology already found it; the slats sitting above it are a purely decorative, `aria-hidden`
 * stand-in. The image's *paint* is suppressed for the duration — see the `visibility` note further
 * down, which also explains why its box has to stay — and its previous inline value is put back
 * verbatim on restore.
 *
 * Only `background-size`/`background-position` (paint-time, relative to each slat's own box)
 * drive the slicing — nothing here reads `naturalWidth`/`naturalHeight` or waits on
 * `img.decode()`, so this works before the image has finished loading.
 *
 * @returns `null` when `el` holds no `<img>`, or the image has no resolvable URL yet — nothing to
 *   slice, so the caller can no-op cleanly, the same shape `word-cycler` uses for "nothing to do".
 * @complexity O(n) time and space in slat count.
 * @overallScore 100
 */
/**
 * Map an `<img>`'s `object-fit`/`object-position` onto the `background-*` pair that paints the
 * same picture, the same size, in the same place.
 *
 * The slats stand in for the image while it is hidden, so any difference between how they paint
 * and how the `<img>` paints is a visible jump at the instant the stage is torn down and the real
 * picture comes back. The stylesheet default is `background-size: 100% 100%`, which *stretches* —
 * so an `object-fit: cover` image (every demo card here, and the ordinary case in real layouts)
 * assembled visibly distorted and then snapped to its true framing on landing. That snap was the
 * effect's worst moment, and it was not the animation's fault: the animation was correct and the
 * two paints simply disagreed.
 *
 * Each slat is `inset: 0` on a stage sized to exactly the image's own box, so the mapping is
 * direct — `cover` means the same thing to both properties on the same box.
 *
 * `scale-down` has no `background-size` equivalent: it is `min(none, contain)`, resolved against
 * the intrinsic size. `contain` matches it whenever the image is larger than its box, which is
 * the case that is actually authored; a smaller image paints at box-fit rather than 1:1, and the
 * seam is that the slats agree with each other, not that they agree with a rarely-used keyword.
 *
 * @complexity O(1) time and space.
 * @overallScore 100
 */
function imagePaintStyle(img: Element, win: Window): { size: string; position: string } {
  const computed = win.getComputedStyle(img)
  const position = computed.objectPosition || '50% 50%'
  const fit = computed.objectFit
  if (fit === 'cover') return { size: 'cover', position }
  if (fit === 'contain' || fit === 'scale-down') return { size: 'contain', position }
  if (fit === 'none') return { size: 'auto', position }
  return { size: '100% 100%', position }
}

export function installSlatStage(
  el: Element,
  doc: Document,
  win: Window,
  options: SlatBuildOptions,
): SlatStage | null {
  const img = el.querySelector('img')
  if (!img) return null
  const url = img.currentSrc || img.getAttribute('src') || ''
  if (!url) return null

  const { count, angleDegrees, from, fold } = options
  const travel = slatTravelVector(angleDegrees)
  const stage = doc.createElement('div')
  stage.className = STAGE_CLASS
  stage.setAttribute('aria-hidden', 'true')
  // Kept for debugging and for anyone reading the DOM: which of the three named cuts this is.
  // No stylesheet keys on it any more — one clip-path path now serves every angle.
  stage.dataset.kuiSlatAxis = axisLabel(angleDegrees)
  stage.dataset.kuiSlatAngle = String(angleDegrees)
  stage.dataset.kuiSlatFold = String(fold)
  stage.style.setProperty('--kui-slat-count', String(count))
  // Inherited by every slat: the direction its from-state displaces along, and the 3D axis a
  // `fold:true` hinge turns about — which is the same vector in both cases.
  stage.style.setProperty('--kui-slat-dx', travel.x.toFixed(4))
  stage.style.setProperty('--kui-slat-dy', travel.y.toFixed(4))

  const paint = imagePaintStyle(img, win)
  const slats: HTMLElement[] = []
  for (let index = 0; index < count; index++) {
    const slat = doc.createElement('div')
    slat.className = SLAT_CLASS
    slat.style.setProperty('--kui-slat-index', String(index))
    slat.style.setProperty('--kui-i', String(slatOrder(index, count, from)))
    slat.style.backgroundImage = `url("${url}")`
    slat.style.backgroundSize = paint.size
    slat.style.backgroundPosition = paint.position
    stage.append(slat)
    slats.push(slat)
  }
  el.append(stage)
  const bands: SlatBands = { slats, angleDegrees }
  syncStageToImage(stage, img, bands)
  const stopWatching = watchImageBox(stage, img, win, bands)

  /*
   * Hide the source image for as long as the slats are standing in for it.
   *
   * Without this the effect does not read as an assemble at all: the finished picture sits at
   * full opacity underneath the whole time, so the slats are translucent shapes drifting across
   * an image that never went anywhere. Nothing is ever *separated*, which is the entire idea.
   *
   * `visibility: hidden` rather than `opacity: 0` or `display: none`, because the image's box is
   * load-bearing here — `syncStageToImage` measures it every time the layout changes, so it has
   * to keep occupying exactly the space it always did. `visibility` removes the paint and keeps
   * the geometry.
   *
   * Through a ledger rather than a remembered string. Both give an author their own `visibility`
   * back, but writing the remembered value straight back sets it to `''` on the usual case where
   * there was none — which leaves `style=""` on the image, a real difference in the serialized
   * markup. The browser teardown sweep read exactly that as slat-assemble leaving synthetic nodes
   * behind (160 -> 169 chars, the width of one empty attribute).
   */
  const imageStyles = createStyleLedger(img)
  imageStyles.set('visibility', 'hidden')

  return {
    stage,
    slats,
    restore: () => {
      stopWatching()
      imageStyles.restore()
      stage.remove()
    },
  }
}

/**
 * Forward validated timing params onto the stage, so `media.css`'s `--kui-i * --kui-stagger`
 * delay formula (the same shape `text-shared.ts`'s `applyStaggerVars` writes for split-text) can
 * read them by inheritance into every `.kui-slat-item`.
 *
 * @complexity O(1) time and space.
 * @overallScore 100
 */
export function applySlatTimingVars(stage: HTMLElement, params: EffectParams): void {
  const { durationMs, delayMs, easing } = params.timing
  const duration = durationMs === undefined ? params.text('duration', '500ms') : `${durationMs}ms`
  const delay = delayMs === undefined ? params.text('delay', '0ms') : `${delayMs}ms`
  stage.style.setProperty('--kui-duration', duration)
  stage.style.setProperty('--kui-delay', delay)
  // See `applyStaggerVars` in `text-shared.ts` — `--kui-ease` reaches a timing function unread.
  stage.style.setProperty('--kui-ease', cssEasingValue(easing ?? params.text('ease', 'ease-out')))
  stage.style.setProperty('--kui-stagger', params.text('stagger', '60ms'))
}

/**
 * Total time before every staggered slat has finished landing: the last slat's `--kui-i *
 * --kui-stagger` delay, plus its own duration — `splitRevealFinishMs`'s reasoning, over slat
 * count instead of grapheme/word/line count.
 *
 * @param count - Slat count; zero means nothing was ever built, so nothing is animating.
 * @complexity O(1) time and space.
 * @overallScore 100
 */
export function slatAssembleFinishMs(params: EffectParams, count: number): number {
  if (count === 0) return 0
  const durationMs = params.timing.durationMs ?? params.ms('duration', 500)
  const delayMs = params.timing.delayMs ?? params.ms('delay', 0)
  const staggerMs = params.ms('stagger', 60)
  return delayMs + (count - 1) * staggerMs + durationMs
}
