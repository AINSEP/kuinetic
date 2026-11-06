import type { PrepareContext } from '../../core/effect-context.js'
import type { StyleLedger } from '../../core/owned-styles.js'
import type { EffectParams, EffectSpec, EffectVariant } from '../../core/types.js'
import { createSpringRunner, DEFAULT_SPRING, defaultSpringDeps } from '../../core/spring.js'
import { trackProgress } from '../scroll-mechanics/tracker.js'

export function deckSourceVariant(spec: EffectSpec): EffectVariant {
  return spec.params.speed === 'true' ? { channels: ['--kui-motion-speed'] } : {}
}

/** A scroll-driven deck has one source; its clock must not write over the scroller. */
export function deckMotionParams(params: EffectParams, ctx: PrepareContext, label: string): EffectParams {
  if (ctx.timeline !== 'scroll') return params
  if (params.ms('spin') || params.ms('autoplay')) ctx.warn(`${label}: timeline:scroll disables spin: and autoplay:.`)
  return { ...params, ms: (name, fallback) => name === 'spin' || name === 'autoplay' ? 0 : params.ms(name, fallback) }
}

/** Physical pixels per second, sampled after the single position writer has rendered. */
export function createDeckSpeed(ctx: PrepareContext, styles: StyleLedger) {
  let previous: number | undefined
  let time = 0
  let quiet: number | undefined
  const write = (value: number): void => styles.set('--kui-motion-speed', value.toFixed(3))
  const runner = createSpringRunner({
    ...DEFAULT_SPRING,
    damping: 2 * Math.sqrt(DEFAULT_SPRING.stiffness * DEFAULT_SPRING.mass),
  }, write, { ...defaultSpringDeps(), warn: ctx.warn })
  const reset = (): void => {
    previous = undefined
    ctx.win.clearTimeout(quiet)
    runner.stop()
    runner.set(0)
    write(0)
  }
  const visibility = (): void => reset()
  ctx.doc.addEventListener('visibilitychange', visibility)
  return {
    reset,
    sample(pixel: number, discrete: boolean): void {
      const now = ctx.win.performance.now()
      const dt = now - time
      const speed = previous !== undefined && dt > 0 && dt < 250 ? (pixel - previous) * 1000 / dt : 0
      previous = pixel
      time = now
      if (discrete) return
      ctx.win.clearTimeout(quiet)
      runner.stop()
      if (ctx.reducedMotion || ctx.doc.hidden) { write(0); return }
      runner.set(speed)
      write(speed)
      quiet = ctx.win.setTimeout(() => runner.to(0), 100)
    },
    release(): void {
      ctx.win.clearTimeout(quiet)
      runner.stop()
      ctx.doc.removeEventListener('visibilitychange', visibility)
    },
  }
}

interface ScrollDeck {
  el: Element
  params: EffectParams
  ctx: PrepareContext
  count(): number
  position(): number
  dragging(): boolean
  move(position: number): void
  resetSpeed(): void
  driving(active: boolean): void
}

/** A grab rebases the scroll source instead of letting a dirty scroll frame steal it. */
export function trackDeckScroll(request: ScrollDeck) {
  if (request.ctx.timeline !== 'scroll') return () => {}
  let offset = 0
  let epoch: number | undefined
  let lastProgress = 0
  let written: number | undefined
  const release = trackProgress(request.el, request.ctx, { distance: request.params.text('distance') }, (progress, frame) => {
    if (frame.epoch !== epoch) { request.resetSpeed(); epoch = frame.epoch }
    const next = progress * request.count()
    if (request.dragging()) {
      written = request.position()
      offset = written - next
    }
    else {
      if (written !== undefined && request.position() !== written) offset = request.position() - lastProgress * request.count()
      written = offset + next
      request.move(written)
    }
    lastProgress = progress
  })
  return () => { release(); request.driving(false) }
}
