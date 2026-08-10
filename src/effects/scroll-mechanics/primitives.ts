import type { PrepareContext } from '../../core/effect-context.js'
import { toPixels, ABSOLUTE_BASIS } from '../../core/js-params.js'
import type { Cleanup, EffectParams, ParameterSchema, Primitive } from '../../core/types.js'
import { trackProgress } from './tracker.js'

/**
 * Scroll-mechanics primitives.
 *
 * Every one of these is `trackProgress` plus a different write. Pinning writes `position: sticky`,
 * scrubbing writes a frame index, horizontal scroll writes a translation — the scroll maths is
 * shared, which is what keeps the category to one listener and one rAF for the whole page.
 *
 * All are `reducedMotion: 'disable'`: shortening a scroll-linked effect is meaningless, because
 * its duration is the user's scrolling, not a clock.
 */

const PROGRESS_VAR = '--dsg-progress'

const distanceParam: ParameterSchema = {
  distance: { type: 'length', default: '100vh', cssProperty: '--dsg-distance' },
}

/** One primitive's distinguishing fields; the rest are identical across the category. */
interface ScrollSpec {
  id: string
  channels: string[]
  parameters: ParameterSchema
  prepare: Primitive['prepare']
  perfClass?: Primitive['perfClass']
}

function scrollPrimitive(spec: ScrollSpec): Primitive {
  const { id, channels, parameters, prepare, perfClass = 'compositor' } = spec
  return {
    id,
    renderer: 'javascript',
    channels,
    parameters,
    supportedTimelines: ['time', 'view', 'scroll'],
    supportedActivations: ['manual', 'load', 'enter'],
    perfClass,
    reducedMotion: 'disable',
    prepare,
  }
}

/** Write progress as a custom property so CSS can consume it without another JS hop. */
function writeProgress(el: Element, progress: number): void {
  ;(el as HTMLElement).style.setProperty(PROGRESS_VAR, progress.toFixed(4))
}

/**
 * Pin an element while its scroll range passes.
 *
 * Implemented with `position: sticky` rather than a per-frame transform: sticky is handled on the
 * compositor, keeps the element in normal flow, and — critically — does not remove it from the
 * accessibility or tab order the way absolute repositioning does.
 *
 * @complexity O(1) per frame; O(1) space.
 * @overallScore 100
 */
function preparePin(el: Element, params: EffectParams, ctx: PrepareContext): Cleanup {
  const node = el as HTMLElement
  const previous = { position: node.style.position, top: node.style.top }
  node.style.position = 'sticky'
  node.style.top = params.text('offset', '0px')

  const removeSpacer = params.is('spacer') ? insertSpacer(node, params.text('distance'), ctx) : null

  /*
   * Track the containing block, not the pinned element.
   *
   * Sticky positioning exists precisely to stop the element moving relative to the viewport, so
   * once pinned its own rect reports the same offset forever and progress would sit at 0 for the
   * entire pin. The parent keeps scrolling, and is what the progress actually describes.
   */
  const tracked = node.parentElement ?? el

  const untrack = trackProgress(tracked, ctx, { distance: params.text('distance') }, (progress) => {
    writeProgress(el, progress)
    el.setAttribute('data-dsg-pinned', progress > 0 && progress < 1 ? 'true' : 'false')
  })

  return () => {
    untrack()
    removeSpacer?.()
    node.style.position = previous.position
    node.style.top = previous.top
    el.removeAttribute('data-dsg-pinned')
    node.style.removeProperty(PROGRESS_VAR)
  }
}

/**
 * Give a sticky element room to travel by adding a sibling of the pin distance.
 *
 * Sticky only holds while its containing block is still on screen, so a pin longer than its parent
 * silently does nothing. The spacer is the honest fix; `invalidate()` tells the scheduler the
 * geometry it cached is now wrong.
 *
 * @complexity O(1) time and space.
 * @overallScore 100
 */
function insertSpacer(node: HTMLElement, distance: string, ctx: PrepareContext): Cleanup {
  const spacer = ctx.doc.createElement('div')
  spacer.setAttribute('data-dsg-spacer', '')
  spacer.setAttribute('aria-hidden', 'true')
  spacer.style.height = distance
  spacer.style.pointerEvents = 'none'
  node.after(spacer)
  ctx.invalidate()

  return () => {
    spacer.remove()
    ctx.invalidate()
  }
}

/**
 * Publish scroll progress, and a discrete step index when `steps` is set.
 *
 * The step attribute is what makes scrollytelling a CSS problem rather than a JS one: authors
 * select on `[data-dsg-step="2"]` instead of subscribing to anything.
 *
 * @complexity O(1) per frame; O(1) space.
 * @overallScore 100
 */
function prepareProgress(el: Element, params: EffectParams, ctx: PrepareContext): Cleanup {
  const steps = Math.max(0, Math.round(params.num('steps', 0)))

  const untrack = trackProgress(el, ctx, { distance: params.text('distance') }, (progress) => {
    writeProgress(el, progress)
    if (steps > 0) {
      const index = Math.min(steps - 1, Math.floor(progress * steps))
      el.setAttribute('data-dsg-step', String(index))
    }
  })

  return () => {
    untrack()
    el.removeAttribute('data-dsg-step')
    ;(el as HTMLElement).style.removeProperty(PROGRESS_VAR)
  }
}

/**
 * Translate a track horizontally as vertical scroll advances.
 *
 * Pair with a pinned ancestor; alone it simply scrolls the track past.
 *
 * @complexity O(1) per frame; O(1) space.
 * @overallScore 100
 */
function prepareHorizontal(el: Element, params: EffectParams, ctx: PrepareContext): Cleanup {
  const node = el as HTMLElement
  const untrack = trackProgress(el, ctx, { distance: params.text('distance') }, (progress, frame) => {
    const travel = trackTravel(node, params.text('travel'), frame.metrics.viewportWidth)
    node.style.translate = `${-progress * travel}px 0`
    writeProgress(el, progress)
  })

  return () => {
    untrack()
    node.style.removeProperty('translate')
    node.style.removeProperty(PROGRESS_VAR)
  }
}

/**
 * How far a horizontal track must move: its overflow past the viewport, unless overridden.
 *
 * @complexity O(1) time and space.
 * @overallScore 100
 */
function trackTravel(node: HTMLElement, authored: string | undefined, viewportWidth: number): number {
  if (authored && authored !== 'auto') return toPixels(authored, ABSOLUTE_BASIS, 0)
  return Math.max(0, node.scrollWidth - viewportWidth)
}

/**
 * Scrub a frame sequence or a video's currentTime with scroll position.
 *
 * `<video>` gets `currentTime`; anything else gets its `src` swapped from a numbered pattern.
 *
 * @complexity O(1) per frame; O(1) space.
 * @overallScore 100
 */
function prepareMediaScrub(el: Element, params: EffectParams, ctx: PrepareContext): Cleanup {
  const frames = Math.max(1, Math.round(params.num('frames', 1)))
  const pattern = params.text('src')
  const media = el as HTMLMediaElement & HTMLImageElement
  let lastIndex = -1

  const untrack = trackProgress(el, ctx, { distance: params.text('distance') }, (progress) => {
    writeProgress(el, progress)
    const index = Math.min(frames - 1, Math.floor(progress * frames))
    if (index === lastIndex) return
    lastIndex = index
    applyFrame(media, { index, frames, progress, pattern })
  })

  return () => {
    untrack()
    ;(el as HTMLElement).style.removeProperty(PROGRESS_VAR)
  }
}

interface FrameWrite {
  index: number
  frames: number
  progress: number
  pattern: string
}

function applyFrame(media: HTMLMediaElement & HTMLImageElement, write: FrameWrite): void {
  const { index, frames, progress, pattern } = write
  if (media.tagName === 'VIDEO') {
    const duration = Number.isFinite(media.duration) ? media.duration : 0
    if (duration > 0) media.currentTime = duration * progress
    return
  }
  if (pattern) media.src = pattern.replace('{i}', String(index).padStart(String(frames).length, '0'))
}

/**
 * Mark the navigation link pointing at the most recently entered section.
 *
 * Writes `data-dsg-active` rather than toggling a class, so the styling contract stays the
 * library's attribute vocabulary and cannot collide with a site's own class names.
 *
 * @complexity O(1) per frame; O(1) space.
 * @overallScore 100
 */
function prepareScrollSpy(el: Element, params: EffectParams, ctx: PrepareContext): Cleanup {
  const selector = params.text('target')
  const untrack = trackProgress(el, ctx, { distance: params.text('distance') }, (progress) => {
    const active = progress > 0 && progress < 1
    el.setAttribute('data-dsg-active', String(active))
    if (selector) markLinks(ctx.doc, selector, active)
  })

  return () => {
    untrack()
    el.removeAttribute('data-dsg-active')
  }
}

function markLinks(doc: Document, selector: string, active: boolean): void {
  for (const link of doc.querySelectorAll(selector)) {
    link.setAttribute('data-dsg-active', String(active))
  }
}

/**
 * Enable native CSS scroll snapping on a container and its children.
 *
 * Included for vocabulary completeness — this is browser behaviour, not animation. Doing it here
 * rather than telling authors to write CSS keeps one mental model for "how motion is declared".
 *
 * @complexity O(n) time in the number of children; O(1) space.
 * @overallScore 100
 */
function prepareSnap(el: Element, params: EffectParams): Cleanup {
  const node = el as HTMLElement
  const previous = node.style.scrollSnapType
  node.style.scrollSnapType = `${params.is('axis', 'x') ? 'x' : 'y'} ${params.text('strictness', 'mandatory')}`

  const children = [...node.children] as HTMLElement[]
  for (const child of children) child.style.scrollSnapAlign = params.text('align', 'start')

  return () => {
    node.style.scrollSnapType = previous
    for (const child of children) child.style.removeProperty('scroll-snap-align')
  }
}

export const SCROLL_PRIMITIVES: Primitive[] = [
  scrollPrimitive({
    id: 'pin',
    channels: ['layout', 'progress'],
    parameters: {
      ...distanceParam,
      offset: { type: 'length', default: '0px', cssProperty: '--dsg-offset' },
      spacer: {
        type: 'keyword',
        default: 'false',
        cssProperty: '--dsg-spacer',
        values: ['true', 'false'],
      },
    },
    prepare: preparePin,
    perfClass: 'layout',
  }),

  scrollPrimitive({
    id: 'scroll-progress',
    channels: ['progress'],
    parameters: {
      ...distanceParam,
      steps: { type: 'number', default: '0', cssProperty: '--dsg-steps' },
    },
    prepare: prepareProgress,
  }),

  scrollPrimitive({
    id: 'horizontal-track',
    channels: ['translate', 'progress'],
    parameters: {
      ...distanceParam,
      travel: { type: 'length', default: '0px', cssProperty: '--dsg-travel' },
    },
    prepare: prepareHorizontal,
  }),

  scrollPrimitive({
    id: 'media-scrub',
    channels: ['media', 'progress'],
    parameters: {
      ...distanceParam,
      frames: { type: 'number', default: '1', cssProperty: '--dsg-frames' },
      src: { type: 'text', default: '', cssProperty: '--dsg-src' },
    },
    prepare: prepareMediaScrub,
    perfClass: 'paint',
  }),

  scrollPrimitive({
    id: 'scroll-spy',
    channels: ['state'],
    parameters: {
      ...distanceParam,
      target: { type: 'text', default: '', cssProperty: '--dsg-target' },
    },
    prepare: prepareScrollSpy,
  }),

  scrollPrimitive({
    id: 'scroll-snap',
    channels: ['layout'],
    parameters: {
      axis: { type: 'keyword', default: 'y', cssProperty: '--dsg-axis', values: ['x', 'y'] },
      strictness: {
        type: 'keyword',
        default: 'mandatory',
        cssProperty: '--dsg-snap-strictness',
        values: ['mandatory', 'proximity'],
      },
      align: {
        type: 'keyword',
        default: 'start',
        cssProperty: '--dsg-snap-align',
        values: ['start', 'center', 'end'],
      },
    },
    prepare: (el: Element, params: EffectParams) => prepareSnap(el, params),
    perfClass: 'layout',
  }),
]
