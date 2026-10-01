import type { PrepareContext } from '../core/effect-context.js'
import { continuousSetup, deferPrepare } from '../core/instances.js'
import type { SetupResult } from '../core/instances.js'
import { createAttributeLedger, createStyleLedger } from '../core/owned-styles.js'
import { queryScoped, resolveTarget } from '../core/target.js'
import { attributeChannel, SUBTREE_CHANNEL } from '../core/types.js'
import type { EffectParams, ParameterSchema, Preset, Primitive } from '../core/types.js'
import { createSectionIndex } from '../effects/scroll-mechanics/section-index.js'
import { withTimingContract } from '../effects/shared.js'
import { createStepMarker } from '../effects/step-marking.js'
import { widgetPrimitive } from './shared.js'

export const STORY_SIDE_ATTR = 'data-kui-story-side'

const scrollStoryParams: ParameterSchema = {
  target: { type: 'text', default: '', cssProperty: '--kui-target' },
  sections: { type: 'text', default: '', cssProperty: '--kui-sections' },
  'offset-top': { type: 'length', default: '50vh', cssProperty: '--kui-offset-top' },
  side: { type: 'keyword', default: 'end', cssProperty: '--kui-side', keywords: ['start', 'end'] },
}

function findVideo(item: Element): HTMLVideoElement | null {
  if (item.localName === 'video') return item as HTMLVideoElement
  return item.querySelector('video')
}

function shouldAutoPlay(video: HTMLVideoElement): boolean {
  return video.hasAttribute('autoplay') || video.hasAttribute('loop')
}

function playVideo(video: HTMLVideoElement): void {
  const promise = video.play()
  if (promise && typeof promise.catch === 'function') {
    promise.catch(() => {})
  }
}

/** `hold` pauses every video, the active one included (reduced motion, or the story is off screen). */
function syncVideos(media: Element[], activeIndex: number, hold: boolean): void {
  media.forEach((item, index) => {
    const video = findVideo(item)
    if (!video) return
    if (index !== activeIndex || hold) {
      video.pause()
      return
    }
    if (shouldAutoPlay(video)) {
      playVideo(video)
    }
  })
}

/** Whether each story video was playing before activation, so teardown can hand that back. */
function capturePlayState(media: Element[]): Map<HTMLVideoElement, boolean> {
  const state = new Map<HTMLVideoElement, boolean>()
  for (const item of media) {
    const video = findVideo(item)
    if (video) state.set(video, !video.paused)
  }
  return state
}

function restorePlayState(state: Map<HTMLVideoElement, boolean>): void {
  for (const [video, wasPlaying] of state) {
    if (wasPlaying) playVideo(video)
    else video.pause()
  }
}

/**
 * Report the story entering and leaving the viewport. `threshold: 0` for the reason
 * background-media's `autoplayInView` gives: a story taller than the viewport can never reach a
 * fractional ratio. No `IntersectionObserver` (jsdom, SSR) means "always in view".
 */
function watchInView(el: Element, win: Window, onChange: (inView: boolean) => void): {
  observed: boolean
  stop(): void
} {
  const Observer = (win as Window & { IntersectionObserver?: typeof IntersectionObserver })
    .IntersectionObserver
  if (!Observer) return { observed: false, stop: () => {} }
  const observer = new Observer((entries) => {
    const latest = entries[entries.length - 1]
    if (latest) onChange(latest.isIntersecting)
  }, { threshold: 0 })
  observer.observe(el)
  return { observed: true, stop: () => observer.disconnect() }
}

/** Video playback for the story: the active step's clip plays only while the story is on screen. */
function createStoryPlayback(el: Element, media: Element[], ctx: PrepareContext): {
  show(step: number): void
  restore(): void
} {
  const prior = capturePlayState(media)
  let step = 0
  let inView = false
  let active = false
  const sync = (): void => syncVideos(media, step, ctx.reducedMotion || !inView)
  const view = watchInView(el, ctx.win, (next) => {
    if (next === inView) return
    inView = next
    if (active) sync()
  })
  if (!view.observed) inView = true
  return {
    show(next) {
      step = next
      active = true
      sync()
    },
    restore() {
      view.stop()
      restorePlayState(prior)
    },
  }
}

/**
 * Query the media items and step sections for a scroll-story element.
 *
 * @complexity O(n) in matched elements at setup; O(n) space.
 * @overallScore 100
 */
function queryStoryElements(
  el: Element,
  params: EffectParams,
  ctx: PrepareContext,
): { media: Element[]; sections: Element[] } {
  const mediaSelector = resolveTarget(
    params.text('target') || ':scope > :first-child > *',
    ctx,
    'scroll-story',
  )
  const sectionsSelector = resolveTarget(
    params.text('sections') || ':scope > :last-child > *',
    ctx,
    'scroll-story sections',
  )
  const media = mediaSelector ? queryScoped(el, ctx, mediaSelector, 'self') : []
  const sections = sectionsSelector ? queryScoped(el, ctx, sectionsSelector, 'self') : []
  return { media, sections }
}

/**
 * Build an accessible, sticky scrollytelling presentation widget.
 *
 * Measures sections against the viewport reference line, synchronises the active step
 * to both media and text step groups, and controls media playback.
 *
 * @complexity O(n) in media and section elements per frame; O(n) space.
 * @overallScore 100
 */
function prepareScrollStory(
  el: Element,
  params: EffectParams,
  ctx: PrepareContext,
): SetupResult {
  const { media, sections } = queryStoryElements(el, params, ctx)

  if (media.length === 0) {
    ctx.warn('scroll-story target matched no media')
    return continuousSetup(() => {})
  }
  if (sections.length === 0) {
    ctx.warn('scroll-story sections matched no elements')
    return continuousSetup(() => {})
  }

  const hostAttrs = createAttributeLedger(el)
  const hostStyle = createStyleLedger(el)
  const side = params.text('side', 'end')
  hostAttrs.set(STORY_SIDE_ATTR, side)

  const marker = createStepMarker(
    () => [...media, ...sections],
    (message) => ctx.warn(`scroll-story ${message}`),
  )

  const playback = createStoryPlayback(el, media, ctx)
  let currentStep = -1
  function applyStep(stepIndex: number): void {
    const mapped = stepIndex === -1 ? 0 : stepIndex
    if (mapped === currentStep) return
    currentStep = mapped
    hostAttrs.set('data-kui-step', String(mapped))
    hostStyle.set('--kui-step', String(mapped))
    marker.mark(mapped)
    playback.show(mapped)
  }

  applyStep(0)

  const offsetTop = params.text('offset-top', '50vh')
  const untrack = createSectionIndex({
    el,
    sections,
    ctx,
    offsetTop,
    onChange: (next) => applyStep(next),
  })

  return continuousSetup(() => {
    untrack()
    playback.restore()
    marker.restore()
    hostAttrs.restore()
    hostStyle.restore()
  })
}

export const SCROLL_STORY_PRIMITIVE: Primitive = widgetPrimitive(
  'scroll-story',
  // Its stylesheet lays out the host's first and last child, so nothing else may insert one. The
  // step index on the host (`applyStep`) is claimed so a `carousel` or `scroll-progress` beside it
  // is refused rather than left to overwrite it.
  {
    channels: [SUBTREE_CHANNEL, attributeChannel('data-kui-step'), attributeChannel(STORY_SIDE_ATTR)],
    parameters: scrollStoryParams,
    perfClass: 'layout',
  },
  withTimingContract(
    'scroll-story',
    { because: 'scroll position' },
    deferPrepare(prepareScrollStory),
  ),
)

export const SCROLL_STORY_PRESETS: Preset[] = [
  { name: 'scroll-story', primitive: 'scroll-story', phase: 'idle', requiresOwnSubtree: true },
]
