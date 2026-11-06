import { watchElementSize } from '../../core/element-size.js'
import type { SizeWatch } from '../../core/element-size.js'
import { deferPrepare } from '../../core/instances.js'
import { createAttributeLedger, createStyleLedger } from '../../core/owned-styles.js'
import type { PrepareContext } from '../../core/effect-context.js'
import { attributeChannel, CHANNEL } from '../../core/types.js'
import type { EffectParams, Primitive, Preset } from '../../core/types.js'
import { commitWithoutTransition, DECK_PARAMETERS, prepareSpatialDeck, SPATIAL_DECK_CHANNELS, WRAP_ATTR } from './deck.js'
import type { DeckLayout } from './deck.js'
import { wrapPlace } from './drag.js'
import { createRowCopies, watchCopySources } from './row-copies.js'
import { deckSourceVariant } from './sources.js'
import { clampPeriod } from '../auto-motion.js'

function rowGap({ lefts, widths }: { lefts: number[]; widths: number[] }, host: HTMLElement, ctx: PrepareContext, copying: boolean): number {
  if (lefts.length > 1) return lefts[1]! - lefts[0]! - widths[0]!
  if (!copying) return 0
  const style = ctx.win.getComputedStyle(host)
  return parseFloat(style.columnGap || style.gap) || 0
}

// One layout closes over its measured geometry and per-slot ownership, like the ring view.
// eslint-disable-next-line max-lines-per-function
function prepareRow(el: Element, params: EffectParams, ctx: PrepareContext) {
  const host = el as HTMLElement
  const originalScrollLeft = host.scrollLeft
  const attributes = createAttributeLedger(el)
  const slideStyles = new Map<Element, ReturnType<typeof createStyleLedger>>()
  const shifts = new Map<Element, number>()
  const copies = params.is('copies', 'auto') ? createRowCopies(el, ctx) : undefined
  let slides: readonly HTMLElement[] = []
  let visuals: readonly HTMLElement[] = []
  let visualCentres: number[] = []
  let visualCycle = 0
  let centres: number[] = []
  let slideWidths: number[] = []
  let cycleLength = 0
  let viewportWidth = 0
  let widest = 0
  let pixelPosition = 0
  let looping = false
  let measured = true
  let inlineSign: 1 | -1 = 1
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
    visuals.forEach((slide, index) => {
      const centre = visualCentres[index]!
      const cycle = looping ? Math.floor((midpoint - centre + visualCycle / 2) / visualCycle) : 0
      const shift = cycle * visualCycle
      const previous = shifts.get(slide)
      if (previous === shift) return
      const wasVisible = previous !== undefined && previous % visualCycle === 0 &&
        Math.abs(centre + previous - pixelPosition) <= (viewportWidth + slideWidths[index % slides.length]!) / 2
      // Keep a leaving card until it is offscreen; instant relayouts use the arrival geometry.
      if (!instant && looping && wasVisible) return
      shifts.set(slide, shift)
      slideStyles.get(slide)!.set('--kui-row-cycle', `${inlineSign * shift}px`)
      shifted.push(slide)
    })
    return shifted
  }

  const measureCopies = (stride: number): void => {
    for (const visual of visuals) {
      if (!visual.hasAttribute('data-kui-row-copy')) continue
      slideStyles.delete(visual)
      shifts.delete(visual)
    }
    const extra = copies?.measure(slides, slideWidths, cycleLength, viewportWidth + widest + stride) ?? []
    visuals = [...slides, ...extra]
    visualCentres = visuals.map((_, index) => centres[index % slides.length]! + Math.floor(index / slides.length) * cycleLength)
    visualCycle = slides.length ? cycleLength * (visuals.length / slides.length) : 0
    for (const copy of extra) slideStyles.set(copy, createStyleLedger(copy))
    if (copies || params.is('speed')) {
      visuals.forEach((visual, index) => {
        slideStyles.get(visual)!.set('--kui-row-centre', `${inlineSign * visualCentres[index]!}px`)
      })
      ctx.style.set('--kui-row-width', `${viewportWidth}px`)
    }
  }

  const render = (position: number, settle: (nodes: readonly Element[]) => void): void => {
    const target = pixelAt(wrapPlace(position, centres.length))
    let turns = Math.floor(position / centres.length)
    if (!copies) turns = Math.round((pixelPosition - target) / cycleLength)
    const nextPixel = cycleLength > 0 ? target + turns * cycleLength : 0
    const instant = measured || Math.abs(nextPixel - pixelPosition) > visualCycle - viewportWidth - widest
    const write = (): void => {
      const shifted = shiftSlides(nextPixel, instant)
      if (!instant) settle(shifted)
      pixelPosition = nextPixel
      ctx.style.set('--kui-row-x', `${looping ? viewportWidth / 2 - inlineSign * nextPixel : 0}px`)
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
      inlineSign = ctx.win.getComputedStyle(host).direction === 'rtl' ? -1 : 1
      slideWidths = slides.map(slide => slide.offsetWidth)
      const lefts = slides.map((slide, i) => inlineSign === 1 ? slide.offsetLeft : -slide.offsetLeft - slideWidths[i]!)
      centres = lefts.map((left, index) => left + slideWidths[index]! / 2)
      const gap = rowGap({ lefts, widths: slideWidths }, host, ctx, !!copies)
      cycleLength = slides.length ? lefts.at(-1)! + slideWidths.at(-1)! - lefts[0]! + gap : 0
      widest = Math.max(...slideWidths)
      const stride = Math.max(...centres.map((centre, index) => (centres[index + 1] ?? centres[0]! + cycleLength) - centre))
      measureCopies(stride)
      // Viewport coverage, a recycled slide's width, and one animated step must all fit.
      looping = visuals.length > 1 && visualCycle - widest - stride >= viewportWidth && viewportWidth > 0
      attributes.set('data-kui-row-static', String(!looping))
      if (looping) host.scrollLeft = 0
      ctx.style.set('touch-action', looping ? 'pan-y' : 'auto')
      measured = true
    },
    render,
    positionAt(from, dx) {
      if (!looping) return 0
      const count = centres.length
      const pixel = pixelAt(wrapPlace(from, count)) - inlineSign * dx
      const turns = Math.floor((pixel - centres[0]!) / cycleLength)
      const local = pixel - turns * cycleLength
      let index = 0
      while (index < count - 1 && local >= centres[index + 1]!) index++
      const end = centres[index + 1] ?? centres[0]! + cycleLength
      const fraction = (local - centres[index]!) / (end - centres[index]!)
      return (Math.floor(from / count) + turns) * count + index + fraction
    },
    faceOf: () => 'front',
    travelSign: () => inlineSign,
    keyboardSign: () => inlineSign,
    pixelPosition: () => -inlineSign * pixelPosition,
    pickup(position): number | undefined {
      if (!params.is('release', 'free') || !looping) return undefined
      const visual = visuals.find((node, i) =>
        Math.abs(visualCentres[i]! + shifts.get(node)! - pixelPosition) <= viewportWidth / 2)
      // A wide authored gap can leave no visual near the centre.
      if (!visual) return undefined
      const matrix = /^matrix\(([^)]+)\)$/.exec(ctx.win.getComputedStyle(visual).transform)
      const translation = matrix ? Number(matrix[1]!.split(',')[4]) : NaN
      if (!Number.isFinite(translation)) return undefined
      const shown = inlineSign * (viewportWidth / 2 - translation) + shifts.get(visual)!
      return view.positionAt(position, inlineSign * (pixelPosition - shown))
    },
    watch(refresh, goTo) {
      const releaseSources = copies ? watchCopySources(el, ctx, refresh) : () => {}
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
        releaseSources()
        sizeWatch!.disconnect()
        el.removeEventListener('focusin', onFocus)
      }
    },
  } satisfies NonNullable<DeckLayout['view']>
  const release = prepareSpatialDeck(el, params, ctx, {
    id: 'spatial-row',
    unwrapped: !!copies,
    coastSpeed(spinMs) {
      const period = clampPeriod(spinMs)
      return period ? Math.abs(cycleLength * 1000 / period) : 0
    },
    label: 'carousel-loop',
    measure: false,
    includeSlot: copies ? node => !node.hasAttribute('data-kui-row-copy') : undefined,
    view,
    faceOf: view.faceOf,
  })
  return () => {
    release()
    for (const styles of slideStyles.values()) styles.restore()
    copies?.clear()
    attributes.restore()
    host.scrollLeft = originalScrollLeft
  }
}

export const SPATIAL_ROW_PRIMITIVE: Primitive = {
  id: 'spatial-row',
  renderer: 'javascript',
  channels: [
    CHANNEL.skew,
    'discrete',
    ...SPATIAL_DECK_CHANNELS,
    attributeChannel('data-kui-row-static'),
    attributeChannel(WRAP_ATTR),
  ],
  parameters: {
    ...Object.fromEntries(Object.entries(DECK_PARAMETERS).filter(([name]) => name !== 'travel')),
    copies: { type: 'keyword', default: 'none', keywords: ['none', 'auto'], cssProperty: '--kui-copies' },
    release: { type: 'keyword', default: 'snap', keywords: ['snap', 'free'], cssProperty: '--kui-release' },
  },
  supportedTimelines: ['time', 'scroll'],
  supportedActivations: ['load', 'enter', 'click', 'manual'],
  defaultActivation: 'load',
  perfClass: 'compositor',
  reducedMotion: 'shorten',
  prepare: deferPrepare(prepareRow),
  variantFor: deckSourceVariant,
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
