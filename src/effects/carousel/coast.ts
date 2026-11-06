import type { PrepareContext } from '../../core/effect-context.js'

/** A finite pixel coast; the deck keeps ownership of position and its motion hold. */
export function createCoast(el: Element, ctx: PrepareContext, move: (dx: number) => void, done: () => void) {
  let frame = 0
  let last = 0
  let speed = 0
  let minimumSpeed = 8
  const stop = (): void => {
    if (!frame) return
    ctx.win.cancelAnimationFrame(frame)
    frame = 0
    done()
  }
  const tick = (now: number): void => {
    const dt = Math.max(0, Math.min(32, now - last)) / 1000
    last = now
    move(speed * (1 - Math.exp(-5 * dt)) / 5)
    speed *= Math.exp(-5 * dt)
    if (Math.abs(speed) < minimumSpeed) stop()
    else frame = ctx.win.requestAnimationFrame(tick)
  }
  const hide = (): void => { if (ctx.doc.hidden) stop() }
  ctx.doc.addEventListener('visibilitychange', hide)
  const Observer = (ctx.win as Window & { IntersectionObserver?: typeof IntersectionObserver }).IntersectionObserver
  const observer = Observer ? new Observer(entries => {
    if (entries.some(entry => !entry.isIntersecting)) stop()
  }) : undefined
  observer?.observe(el)
  return {
    stop,
    start(velocity: number, baseline = 8): void {
      minimumSpeed = Math.max(8, baseline)
      speed = Math.max(-6000, Math.min(6000, velocity))
      if (ctx.reducedMotion || ctx.doc.hidden || Math.abs(speed) < minimumSpeed) { done(); return }
      last = ctx.win.performance.now()
      frame = ctx.win.requestAnimationFrame(tick)
    },
    release(): void {
      stop()
      observer?.disconnect()
      ctx.doc.removeEventListener('visibilitychange', hide)
    },
  }
}
