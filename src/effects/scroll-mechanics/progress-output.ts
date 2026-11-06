import type { PrepareContext } from '../../core/effect-context.js'
import { clamp01, createMeasureCache, windowScrollRoot } from '../../core/scroll-scheduler.js'
import { createSpringRunner, DEFAULT_SPRING, defaultSpringDeps } from '../../core/spring.js'
import type { ProgressHandler } from './tracker.js'

/** A document-length source, independent of the progress bar's fixed box. */
export function trackPageProgress(ctx: PrepareContext, onProgress: ProgressHandler) {
  const height = createMeasureCache(() => (ctx.doc.scrollingElement ?? ctx.doc.documentElement).scrollHeight)
  return ctx.scheduler.subscribe(windowScrollRoot(ctx.win), frame => {
    const span = height.read(frame.epoch) - frame.metrics.viewportHeight
    onProgress(span > 0 ? clamp01(frame.metrics.scrollTop / span) : 0, frame)
  })
}

/** Only the visual output is smoothed; discrete marking still receives raw progress. */
export function smoothProgress(ctx: PrepareContext, write: (value: number) => void) {
  let target = 0
  let initial = true
  const runner = createSpringRunner({ ...DEFAULT_SPRING, restDisplacement: .0001, restVelocity: .001 },
    value => write(clamp01(value)), { ...defaultSpringDeps(), warn: ctx.warn })
  const snap = (): void => {
    runner.stop()
    runner.set(target)
    write(target)
  }
  const visibility = (): void => { if (ctx.doc.hidden) snap() }
  ctx.doc.addEventListener('visibilitychange', visibility)
  return {
    write(value: number): void {
      target = value
      if (initial || ctx.reducedMotion || ctx.doc.hidden) snap()
      else runner.to(value)
      initial = false
    },
    release(): void {
      runner.stop()
      ctx.doc.removeEventListener('visibilitychange', visibility)
    },
  }
}
