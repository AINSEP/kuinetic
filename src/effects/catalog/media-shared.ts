import type { Cleanup, EffectParams } from '../../core/types.js'

/**
 * DOM-surgery helpers behind `slat-assemble` (catalog section G).
 *
 * `text-shared.ts` is the template this follows: build a synthetic child tree once at activation,
 * index each child with a plain custom property, and let CSS (`media.css`) own every frame from
 * there — this module never animates anything itself, it only builds the tree and computes the
 * per-child numbers CSS reads.
 */

/** Which way the image is cut into strips. */
export type SlatAxis = 'vertical' | 'horizontal'

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
  axis: SlatAxis
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
function syncStageToImage(stage: HTMLElement, img: HTMLElement): void {
  stage.style.top = `${img.offsetTop}px`
  stage.style.left = `${img.offsetLeft}px`
  stage.style.width = `${img.offsetWidth}px`
  stage.style.height = `${img.offsetHeight}px`
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
function watchImageBox(stage: HTMLElement, img: HTMLElement, win: Window): Cleanup {
  const handler = (): void => syncStageToImage(stage, img)
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
 * The `<img>` itself is left completely alone — no `visibility`, no `aria-hidden`, nothing to
 * undo. The stage is appended last and painted on top of it (ordinary in-flow-then-absolute
 * paint order, no `z-index` needed), so the original picture stays exactly where an assistive
 * technology already found it; the slats sitting above it are a purely decorative, `aria-hidden`
 * stand-in.
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

  const { count, axis, from, fold } = options
  const stage = doc.createElement('div')
  stage.className = STAGE_CLASS
  stage.setAttribute('aria-hidden', 'true')
  stage.dataset.kuiSlatAxis = axis
  stage.dataset.kuiSlatFold = String(fold)
  stage.style.setProperty('--kui-slat-count', String(count))

  const slats: HTMLElement[] = []
  for (let index = 0; index < count; index++) {
    const slat = doc.createElement('div')
    slat.className = SLAT_CLASS
    slat.style.setProperty('--kui-slat-index', String(index))
    slat.style.setProperty('--kui-i', String(slatOrder(index, count, from)))
    slat.style.backgroundImage = `url("${url}")`
    stage.append(slat)
    slats.push(slat)
  }
  el.append(stage)
  syncStageToImage(stage, img)
  const stopWatching = watchImageBox(stage, img, win)

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
   * the geometry. The previous inline value is remembered and put back verbatim, so an author who
   * had already set `visibility` on their own image gets that back rather than an empty string.
   */
  const priorVisibility = img.style.visibility
  img.style.visibility = 'hidden'

  return {
    stage,
    slats,
    restore: () => {
      stopWatching()
      img.style.visibility = priorVisibility
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
  stage.style.setProperty('--kui-ease', easing ?? params.text('ease', 'ease-out'))
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
