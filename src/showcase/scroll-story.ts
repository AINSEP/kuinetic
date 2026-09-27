import type { PrepareContext } from '../core/effect-context.js'
import { continuousSetup, deferPrepare } from '../core/instances.js'
import type { SetupResult } from '../core/instances.js'
import { createAttributeLedger, createStyleLedger } from '../core/owned-styles.js'
import { queryScoped, resolveTarget } from '../core/target.js'
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

function syncVideos(media: Element[], activeIndex: number, reducedMotion: boolean): void {
  media.forEach((item, index) => {
    const video = findVideo(item)
    if (!video) return
    if (index !== activeIndex || reducedMotion) {
      video.pause()
      return
    }
    if (shouldAutoPlay(video)) {
      playVideo(video)
    }
  })
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

  let currentStep = -1
  function applyStep(stepIndex: number): void {
    const mapped = stepIndex === -1 ? 0 : stepIndex
    if (mapped === currentStep) return
    currentStep = mapped
    hostAttrs.set('data-kui-step', String(mapped))
    hostStyle.set('--kui-step', String(mapped))
    marker.mark(mapped)
    syncVideos(media, mapped, ctx.reducedMotion)
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
    media.forEach((item) => {
      findVideo(item)?.pause()
    })
    marker.restore()
    hostAttrs.restore()
    hostStyle.restore()
  })
}

export const SCROLL_STORY_PRIMITIVE: Primitive = widgetPrimitive(
  'scroll-story',
  { channels: ['widget'], parameters: scrollStoryParams, perfClass: 'layout' },
  withTimingContract(
    'scroll-story',
    { because: 'scroll position' },
    deferPrepare(prepareScrollStory),
  ),
)

export const SCROLL_STORY_PRESETS: Preset[] = [
  { name: 'scroll-story', primitive: 'scroll-story', phase: 'idle', requiresOwnSubtree: true },
]
