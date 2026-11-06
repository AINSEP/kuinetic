import { frameScheduler } from '../../core/element-size.js'
import { continuousSetup, deferPrepare } from '../../core/instances.js'
import { ABSOLUTE_BASIS, toPixels } from '../../core/js-params.js'
import { resolveTarget } from '../../core/target.js'
import { SUBTREE_CHANNEL } from '../../core/types.js'
import type { Cleanup, EffectParams, Primitive } from '../../core/types.js'
import type { PrepareContext } from '../../core/effect-context.js'
import { withTimingContract } from '../shared.js'
import { supportsFineHover } from './interaction-shared.js'

interface Point { x: number; y: number }

function sourceImages(el: Element, params: EffectParams, ctx: PrepareContext): string[] {
  const selector = resolveTarget(params.text('images'), ctx, 'cursor-trail images')
  if (!selector) return []
  return [...el.querySelectorAll<HTMLImageElement>(selector)]
    .filter((node) => node.tagName === 'IMG')
    .map((image) => image.currentSrc || image.getAttribute('src') || '')
    .filter(Boolean)
}

function trailPool(layer: HTMLElement, sources: string[], ctx: PrepareContext): HTMLImageElement[] {
  return Array.from({ length: 24 }, (_, i) => {
    const image = ctx.doc.createElement('img')
    image.src = sources[i % sources.length]!
    image.alt = ''
    image.onanimationend = () => { image.style.display = 'none' }
    image.onerror = () => { image.dataset.kuiTrailFailed = ''; image.style.display = 'none' }
    layer.append(image)
    return image
  })
}

function trailEmitter(pool: HTMLImageElement[], ctx: PrepareContext): (point: Point) => void {
  let next = 0
  let order = 0
  return (point) => {
    const image = pool[next]!
    next = (next + 1) % pool.length
    if (image.hasAttribute('data-kui-trail-failed')) return
    image.style.display = 'block'
    image.style.left = `${point.x}px`
    image.style.top = `${point.y}px`
    // Restart a reused slot with a style flush, never a geometry read.
    image.style.animationName = 'none'
    ctx.win.getComputedStyle(image).getPropertyValue('animation-name')
    image.style.animationName = 'kui-trail-photo'
    image.style.zIndex = String(++order)
  }
}

function distanceSampler(spacing: number, emit: (point: Point) => void) {
  let previous: Point | undefined
  let remainder = 0
  return {
    reset() { previous = undefined; remainder = 0 },
    move(point: Point) {
      if (!previous) {
        previous = point
        emit(point)
        return
      }
      const dx = point.x - previous.x
      const dy = point.y - previous.y
      const distance = Math.hypot(dx, dy)
      const count = Math.min(4, Math.floor((distance + remainder) / spacing))
      for (let i = 0; i < count; i++) {
        const fraction = (spacing - remainder + i * spacing) / distance
        emit({ x: previous.x + dx * fraction, y: previous.y + dy * fraction })
      }
      remainder = (remainder + distance) % spacing
      previous = point
    },
  }
}

function prepareTrail(el: Element, params: EffectParams, ctx: PrepareContext): Cleanup | ReturnType<typeof continuousSetup> {
  if (!supportsFineHover(ctx.win)) return () => {}
  const sources = sourceImages(el, params, ctx)
  if (!sources.length) {
    ctx.warn('cursor-trail images must select source images inside the host')
    return () => {}
  }
  const node = el as HTMLElement
  if (ctx.win.getComputedStyle(node).position === 'static') ctx.style.set('position', 'relative')
  ctx.style.set('isolation', 'isolate')
  const layer = ctx.doc.createElement('span')
  layer.setAttribute('data-kui-trail-layer', '')
  layer.setAttribute('aria-hidden', 'true')
  layer.inert = true
  node.append(layer)
  return listenTrail(node, trailPool(layer, sources, ctx), params, ctx)
}

function listenTrail(node: HTMLElement, pool: HTMLImageElement[], params: EffectParams, ctx: PrepareContext) {
  let rect: DOMRect | undefined
  let latest: Point | undefined
  const spacing = Math.max(1, toPixels(params.text('spacing'), ABSOLUTE_BASIS, 60))
  const sampler = distanceSampler(spacing, trailEmitter(pool, ctx))
  const frame = frameScheduler(ctx.win, () => {
    if (!latest || ctx.doc.hidden) return
    rect ??= node.getBoundingClientRect()
    sampler.move({ x: latest.x - rect.left + node.scrollLeft - node.clientLeft,
      y: latest.y - rect.top + node.scrollTop - node.clientTop })
  })
  const reset = (): void => {
    frame.cancel()
    rect = undefined
    latest = undefined
    sampler.reset()
  }
  const move = (event: Event): void => {
    const pointer = event as PointerEvent
    if (pointer.pointerType === 'touch' || ctx.doc.hidden) return
    latest = { x: pointer.clientX, y: pointer.clientY }
    frame.request()
  }
  node.addEventListener('pointermove', move, { signal: ctx.signal, passive: true })
  node.addEventListener('pointerleave', reset, { signal: ctx.signal })
  ctx.doc.addEventListener('visibilitychange', reset, { signal: ctx.signal })
  const unsubscribe = ctx.scheduler.subscribe(ctx.rootFor(node), reset)
  return continuousSetup(() => {
    reset()
    unsubscribe()
    node.removeEventListener('pointermove', move)
    node.removeEventListener('pointerleave', reset)
    ctx.doc.removeEventListener('visibilitychange', reset)
    pool[0]!.parentElement!.remove()
  })
}

export const CURSOR_TRAIL: Primitive = {
  id: 'cursor-trail',
  renderer: 'javascript',
  channels: ['position', 'isolation', SUBTREE_CHANNEL],
  parameters: {
    images: { type: 'text', default: '', cssProperty: '' },
    spacing: { type: 'length', default: '60px', cssProperty: '' },
  },
  supportedTimelines: ['time', 'pointer'],
  supportedActivations: ['load', 'manual'],
  defaultActivation: 'load',
  reducedMotion: 'disable',
  perfClass: 'continuous',
  prepare: withTimingContract('cursor-trail', {
    because: 'it samples pointer distance, so it has no fixed duration, delay or easing',
  }, deferPrepare(prepareTrail)),
}
