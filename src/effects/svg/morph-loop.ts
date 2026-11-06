import type { PrepareContext } from '../../core/effect-context.js'
import { effectDurationMs } from '../../core/js-params.js'
import { continuousSetup } from '../../core/instances.js'
import type { SetupResult } from '../../core/instances.js'
import { createMorph } from '../../core/path-morph.js'
import { timeScaleOf } from '../../core/time-scale.js'
import type { EffectParams } from '../../core/types.js'
import { resolveEasing } from '../catalog/numbers-shared.js'

/** Precompute every adjacent pair, including the last shape's return to the first. */
function loopShapes(paths: string[]) {
  const pairs = paths.map((path, index) => createMorph(path, paths[(index + 1) % paths.length]!))
  const failed = pairs.find((pair) => !pair.morph)
  return failed ? { reason: failed.reason } : { morphs: pairs.map((pair) => pair.morph!) }
}

function loopColor(path: Element, value: string, count: number) {
  const colors = value.split('|').map((color) => color.trim()).filter(Boolean)
  if (colors.length && colors.length !== count) {
    return { reason: 'morph colors must contain one color per shape, including the starting shape' }
  }
  const color = colors.length ? path.animate?.([...colors, colors[0]!].map((fill) => ({ fill })), {
    duration: count, fill: 'both',
  }) : undefined
  color?.pause()
  if (color) color.currentTime = 0
  return { color }
}

/** An opt-in loop; the interactive morph's listeners, timing and geometry remain separate. */
export function prepareMorphLoop(path: Element, params: EffectParams, ctx: PrepareContext): SetupResult {
  const duration = effectDurationMs(params, 300)
  if (ctx.reducedMotion || duration <= 0) return () => {}
  const start = params.text('from') || path.getAttribute('d') || ''
  const shapes = [start, ...params.text('to').split('|').map((shape) => shape.trim())]
  const { morphs, reason } = loopShapes(shapes)
  if (!morphs) {
    ctx.warn(`cannot morph: ${reason}`)
    return () => {}
  }
  const { color, reason: colorReason } = loopColor(path, params.text('colors'), shapes.length)
  if (colorReason) {
    ctx.warn(colorReason)
    return () => {}
  }
  const ease = resolveEasing(params.timing.easing ?? params.text('ease', 'linear'), ctx.warn)
  const scale = timeScaleOf(path)
  let elapsed = -(params.timing.delayMs ?? params.ms('delay', 0))
  let previous = performance.now()
  let frame = 0
  const step = (now: number): void => {
    elapsed += (now - previous) * scale
    previous = now
    if (elapsed >= 0) {
      const phase = (elapsed / duration) % morphs.length
      const index = Math.floor(phase)
      const progress = Math.min(1, Math.max(0, ease(phase - index)))
      path.setAttribute('d', morphs[index]!.at(progress))
      if (color) color.currentTime = index + progress
    }
    frame = requestAnimationFrame(step)
  }
  const visibility = (): void => {
    cancelAnimationFrame(frame)
    previous = performance.now()
    if (!ctx.doc.hidden) frame = requestAnimationFrame(step)
  }
  ctx.doc.addEventListener('visibilitychange', visibility)
  visibility()
  return continuousSetup(() => {
    cancelAnimationFrame(frame)
    color?.cancel()
    ctx.doc.removeEventListener('visibilitychange', visibility)
    path.setAttribute('d', start)
  })
}
