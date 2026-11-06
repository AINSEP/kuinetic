import { createJsInstance } from '../../core/instances.js'
import type { Primitive } from '../../core/types.js'
import { supportsFineHover } from './interaction-shared.js'

export const preparePointerWobble: NonNullable<Primitive['prepare']> = (el, _params, ctx) => {
  const enter = (event: Event): void => {
    const pointer = event as PointerEvent
    if (pointer.pointerType === 'touch' || !supportsFineHover(ctx.win)) return
    // CSS re-reads var() mid-run, so keep this run's amplitudes until it settles.
    if (el.getAnimations?.().some((animation) =>
      (animation as Animation & { animationName?: string }).animationName === 'kui-wobble' && animation.playState === 'running',
    )) return
    const box = el.getBoundingClientRect()
    const x = Math.max(-1, Math.min(1, (pointer.clientX - box.left - box.width / 2) / (box.width / 2 || 1)))
    const y = Math.max(-1, Math.min(1, (pointer.clientY - box.top - box.height / 2) / (box.height / 2 || 1)))
    ctx.style.set('--kui-wobble-x', String(x))
    ctx.style.set('--kui-wobble-y', `${-y * 6}px`)
    ctx.style.set('--kui-wobble-angle', String(x || -y))
  }
  // Preparation precedes the activation binder for a fresh run.
  el.addEventListener('pointerenter', enter, { signal: ctx.signal })
  return { ...createJsInstance({ activate() {}, destroy() {} }), setupOnly: true }
}
