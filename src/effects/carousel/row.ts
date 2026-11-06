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
import { createLine } from './line.js'
import { createArchive } from './archive.js'

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
  const line = params.is('shape', 'line') ? createLine(host, params, ctx) : undefined
  const originalScrollLeft = host.scrollLeft
  const attributes = createAttributeLedger(el)
  const archive = line && params.text('attribute') ? createArchive(host, params, ctx, attributes) : undefined
  const slideStyles = new Map<Element, ReturnType<typeof createStyleLedger>>()
  const shifts = new Map<Element, number>()
  // Copies have no place in a column, whose ends are real.
  const copies = !archive && params.is('copies', 'auto') ? createRowCopies(el, ctx) : undefined
  let slides: readonly HTMLElement[] = []
  let visuals: readonly HTMLElement[] = []
  let visualCentres: number[] = []
  let visualCycle = 0
  let centres: number[] = []
  let slideWidths: number[] = []
  let cycleLength = 0
  let viewportWidth = 0
  let widest = 0
  let lineReach = 0
  let pixelPosition = 0
  let looping = false
  let measured = true
  /** The one render after column to line: its transform change is the flight, so nothing commits. */
  let arriving = false
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
      const reach = line ? lineReach : (viewportWidth + slideWidths[index % slides.length]!) / 2
      const wasVisible = previous !== undefined && previous % visualCycle === 0 &&
        Math.abs(centre + previous - pixelPosition) <= reach
      // Keep a leaving card until it is offscreen; instant relayouts use the arrival geometry.
      if (!instant && looping && wasVisible) return
      shifts.set(slide, shift)
      slideStyles.get(slide)!.set('--kui-row-cycle', `${inlineSign * shift}px`)
      shifted.push(slide)
    })
    return shifted
  }

  const publishCentres = (): void => {
    if (copies || params.is('speed') || line) {
      visuals.forEach((visual, index) => {
        slideStyles.get(visual)!.set('--kui-row-centre', `${inlineSign * visualCentres[index]!}px`)
      })
      ctx.style.set('--kui-row-width', `${viewportWidth}px`)
    }
  }

  const measureCopies = (stride: number): void => {
    for (const visual of visuals) {
      if (!visual.hasAttribute('data-kui-row-copy')) continue
      slideStyles.delete(visual)
      shifts.delete(visual)
    }
    const required = viewportWidth + widest + stride
    // A line fades halfway round its cycle, so the cycle must cover the view twice.
    const extra = copies?.measure(slides, slideWidths, cycleLength, line ? 2 * required : required) ?? []
    visuals = [...slides, ...extra]
    visualCentres = visuals.map((_, index) => centres[index % slides.length]! + Math.floor(index / slides.length) * cycleLength)
    visualCycle = slides.length ? cycleLength * (visuals.length / slides.length) : 0
    for (const copy of extra) slideStyles.set(copy, createStyleLedger(copy))
    publishCentres()
  }

  const measureLine = (stride: number): number =>
    line?.({ stride, cycle: visualCycle, width: viewportWidth,
      height: Math.max(0, ...slides.map(slide => slide.offsetHeight)) }) ?? 0

  const renderColumn = (y: number): void => {
    const write = (): void => ctx.style.set('--kui-column-y', `${y}px`)
    if (measured) commitWithoutTransition(ctx.win, el, write)
    else write()
    measured = false
  }

  const render = (position: number, settle: (nodes: readonly Element[]) => void): void => {
    if (archive?.isColumn()) {
      renderColumn(archive.pixelAt(position))
      return
    }
    const target = pixelAt(wrapPlace(position, centres.length))
    let turns = Math.floor(position / centres.length)
    if (!copies) turns = Math.round((pixelPosition - target) / cycleLength)
    const nextPixel = cycleLength > 0 ? target + turns * cycleLength : 0
    const travelLimit = line ? visualCycle / 2 : visualCycle - viewportWidth - widest
    const instant = measured || Math.abs(nextPixel - pixelPosition) > travelLimit
    const write = (): void => {
      const shifted = shiftSlides(nextPixel, instant || arriving)
      if (!instant && !arriving) settle(shifted)
      pixelPosition = nextPixel
      ctx.style.set('--kui-row-x', `${looping ? viewportWidth / 2 - inlineSign * nextPixel : 0}px`)
    }
    if (instant && !arriving) commitWithoutTransition(ctx.win, el, write)
    else write()
    measured = false
    arriving = false
  }

  const view = {
    measure(elements) {
      observeSlides(elements)
      slides = elements as readonly HTMLElement[]
      archive?.measure(slides, slideStyles)
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
      lineReach = measureLine(stride)
      // Viewport coverage, a recycled slide's width, and one animated step must all fit.
      const covers = line ? lineReach > 0 : visualCycle - widest - stride >= viewportWidth
      looping = visuals.length > 1 && covers && viewportWidth > 0
      attributes.set('data-kui-row-static', String(!looping))
      if (looping) host.scrollLeft = 0
      ctx.style.set('touch-action', looping ? 'pan-y' : 'auto')
      measured = true
    },
    render,
    bound: archive?.bound,
    positionAt(from, dx, dy = 0) {
      if (archive?.isColumn()) return archive.positionAt(from, dy)
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
    watch(refresh, goTo, hold) {
      const releaseSources = copies ? watchCopySources(el, ctx, refresh) : () => {}
      // One task from the attribute to the new transforms, so the flight starts at the current picture.
      const releaseArchive = archive ? archive.watch(() => {
        const live = Number(host.getAttribute('data-kui-step'))
        arriving = !archive.isColumn()
        archive.fly(live, slides, slideStyles, hold)
        goTo(live)
      }) : undefined
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
        releaseArchive?.()
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
    hostAttributes: line ? { 'data-kui-row-shape': 'line' } : undefined,
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

const LINE_ONLY = ['rise', 'depth', 'yaw', 'perspective', 'attribute'] as const

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
    shape: { type: 'keyword', default: 'row', keywords: ['row', 'line'], cssProperty: '--kui-row-shape' },
    rise: { type: 'length', default: '-36px', cssProperty: '--kui-line-rise' },
    depth: { type: 'length', default: '70px', cssProperty: '--kui-line-depth' },
    yaw: { type: 'angle', default: '-25deg', cssProperty: '--kui-line-yaw' },
    perspective: { type: 'length', default: '1600px', cssProperty: '--kui-perspective' },
    attribute: { type: 'text', default: '', cssProperty: '--kui-row-attribute' },
  },
  supportedTimelines: ['time', 'scroll'],
  supportedActivations: ['load', 'enter', 'click', 'manual'],
  defaultActivation: 'load',
  perfClass: 'compositor',
  reducedMotion: 'shorten',
  prepare: deferPrepare(prepareRow),
  variantFor: (spec, warn) => {
    const line = spec.params.shape === 'line'
    if (!line && LINE_ONLY.some(name => spec.params[name])) warn(`carousel-loop ${LINE_ONLY.join(', ')} require shape:line; ignored.`)
    if (spec.params.attribute && spec.params.copies === 'auto') warn('carousel-loop attribute: ignores copies:auto; a column has real ends.')
    return { channels: [...(deckSourceVariant(spec).channels ?? []),
      ...(line ? [CHANNEL.opacity, attributeChannel('data-kui-row-shape')] : []),
      ...(line && spec.params.attribute ? [attributeChannel('data-kui-row-arrangement'), attributeChannel('data-kui-row-flight')] : [])] }
  },
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
