import { watchElementSize } from '../../core/element-size.js'
import type { SizeWatch } from '../../core/element-size.js'
import { deferPrepare } from '../../core/instances.js'
import { createAttributeLedger, createStyleLedger } from '../../core/owned-styles.js'
import type { PrepareContext } from '../../core/effect-context.js'
import { CHANNEL } from '../../core/types.js'
import type { EffectParams, Primitive, Preset } from '../../core/types.js'
import { commitWithoutTransition, DECK_PARAMETERS, prepareSpatialDeck, SPATIAL_DECK_CHANNELS } from './deck.js'
import type { DeckLayout } from './deck.js'
import { wrapPlace } from './drag.js'

// One layout closes over its measured geometry and per-slot ownership, like the ring view.
// eslint-disable-next-line max-lines-per-function
function prepareRow(el: Element, params: EffectParams, ctx: PrepareContext) {
  const host = el as HTMLElement
  const originalScrollLeft = host.scrollLeft
  const attributes = createAttributeLedger(el)
  const slideStyles = new Map<Element, ReturnType<typeof createStyleLedger>>()
  const shifts = new Map<Element, number>()
  let slides: readonly HTMLElement[] = []
  let centres: number[] = []
  let slideWidths: number[] = []
  let cycleLength = 0
  let viewportWidth = 0
  let widest = 0
  let pixelPosition = 0
  let looping = false
  let measured = true
  let warnedRtl = false
  let sizeWatch: SizeWatch | undefined

  const observeSlides = (elements: readonly Element[]): void => {
    for (const slide of slides) if (!elements.includes(slide)) sizeWatch?.unobserve(slide)
    for (const slide of elements) {
      if (!slideStyles.has(slide)) slideStyles.set(slide, createStyleLedger(slide))
      sizeWatch?.observe(slide)
    }
  }

  /** The caller supplies a wrapped place; only drag conversion carries whole turns. */
  const pixelAt = (place: number): number => {
    if (!centres.length || cycleLength <= 0) return 0
    const index = Math.floor(place)
    const start = centres[index]!
    const end = centres[index + 1] ?? centres[0]! + cycleLength
    return start + (end - start) * (place - index)
  }

  const shiftSlides = (nextPixel: number, instant: boolean): Element[] => {
    const shifted: Element[] = []
    // Midpoint recycling leaves room on both sides of an animated one-step move.
    const midpoint = instant ? nextPixel : (nextPixel + pixelPosition) / 2
    slides.forEach((slide, index) => {
      const cycle = looping ? Math.floor((midpoint - centres[index]! + cycleLength / 2) / cycleLength) : 0
      const shift = cycle * cycleLength
      const previous = shifts.get(slide)
      if (previous === shift) return
      const wasVisible = previous !== undefined && previous % cycleLength === 0 &&
        Math.abs(centres[index]! + previous - pixelPosition) <= (viewportWidth + slideWidths[index]!) / 2
      // Keep a leaving card until it is offscreen; instant relayouts use the arrival geometry.
      if (!instant && looping && wasVisible) return
      shifts.set(slide, shift)
      slideStyles.get(slide)!.set('--kui-row-cycle', `${shift}px`)
      shifted.push(slide)
    })
    return shifted
  }

  const render = (position: number, settle: (nodes: readonly Element[]) => void): void => {
    const target = pixelAt(wrapPlace(position, centres.length))
    const nextPixel = cycleLength > 0 ? target + Math.round((pixelPosition - target) / cycleLength) * cycleLength : 0
    const instant = measured || Math.abs(nextPixel - pixelPosition) > cycleLength - viewportWidth - widest
    const write = (): void => {
      const shifted = shiftSlides(nextPixel, instant)
      if (!instant) settle(shifted)
      pixelPosition = nextPixel
      ctx.style.set('--kui-row-x', `${looping ? viewportWidth / 2 - nextPixel : 0}px`)
    }
    if (instant) commitWithoutTransition(ctx.win, el, write)
    else write()
    measured = false
  }

  const view = {
    measure(elements) {
      observeSlides(elements)
      slides = elements as readonly HTMLElement[]
      viewportWidth = host.offsetWidth
      const lefts = slides.map(slide => slide.offsetLeft)
      slideWidths = slides.map(slide => slide.offsetWidth)
      centres = lefts.map((left, index) => left + slideWidths[index]! / 2)
      const gap = slides.length > 1 ? lefts[1]! - lefts[0]! - slideWidths[0]! : 0
      cycleLength = slides.length ? lefts.at(-1)! + slideWidths.at(-1)! - lefts[0]! + gap : 0
      widest = Math.max(...slideWidths)
      const stride = Math.max(...centres.map((centre, index) => (centres[index + 1] ?? centres[0]! + cycleLength) - centre))
      // Viewport coverage, a recycled slide's width, and one animated step must all fit.
      looping = slides.length > 1 && cycleLength - widest - stride >= viewportWidth && viewportWidth > 0
      if (cycleLength < 0 && !warnedRtl) {
        ctx.warn('carousel-loop RTL is not supported; keeping a static strip.')
        warnedRtl = true
      }
      attributes.set('data-kui-row-static', String(!looping))
      if (looping) host.scrollLeft = 0
      ctx.style.set('touch-action', looping ? 'pan-y' : 'auto')
      measured = true
    },
    render,
    positionAt(from, dx) {
      if (!looping) return 0
      const count = centres.length
      const pixel = pixelAt(wrapPlace(from, count)) - dx
      const turns = Math.floor((pixel - centres[0]!) / cycleLength)
      const local = pixel - turns * cycleLength
      let index = 0
      while (index < count - 1 && local >= centres[index + 1]!) index++
      const end = centres[index + 1] ?? centres[0]! + cycleLength
      const fraction = (local - centres[index]!) / (end - centres[index]!)
      return (Math.floor(from / count) + turns) * count + index + fraction
    },
    faceOf: () => 'front',
    travelSign: () => 1,
    watch(refresh, goTo) {
      sizeWatch = watchElementSize(ctx.win, refresh)
      sizeWatch.observe(el)
      const onFocus = (event: Event): void => {
        const target = event.target as Element
        if (!target.matches(':focus-visible')) return
        const index = slides.findIndex(slide => slide.contains(target))
        if (index >= 0) goTo(index)
      }
      el.addEventListener('focusin', onFocus)
      refresh()
      return () => {
        sizeWatch!.disconnect()
        el.removeEventListener('focusin', onFocus)
      }
    },
  } satisfies NonNullable<DeckLayout['view']>
  const release = prepareSpatialDeck(el, params, ctx, {
    id: 'spatial-row',
    label: 'carousel-loop',
    measure: false,
    view,
    faceOf: view.faceOf,
  })
  return () => {
    for (const styles of slideStyles.values()) styles.restore()
    release()
    attributes.restore()
    host.scrollLeft = originalScrollLeft
  }
}

export const SPATIAL_ROW_PRIMITIVE: Primitive = {
  id: 'spatial-row',
  renderer: 'javascript',
  channels: [CHANNEL.skew, 'discrete', ...SPATIAL_DECK_CHANNELS],
  parameters: Object.fromEntries(Object.entries(DECK_PARAMETERS).filter(([name]) => name !== 'travel')),
  supportedTimelines: ['time'],
  supportedActivations: ['load', 'enter', 'click', 'manual'],
  defaultActivation: 'load',
  perfClass: 'compositor',
  reducedMotion: 'shorten',
  prepare: deferPrepare(prepareRow),
}

export const ROW_PRESETS: Preset[] = [
  {
    name: 'carousel-loop',
    primitive: 'spatial-row',
    requiresOwnSubtree: true,
    phase: 'idle',
    cloak: true,
  },
]
