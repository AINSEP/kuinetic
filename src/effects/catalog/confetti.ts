import { cssEasingValue } from '../../core/easing.js'
import { createCssInstance, createJsInstance } from '../../core/instances.js'
import { effectDurationMs } from '../../core/js-params.js'
import { createAttributeLedger, createStyleLedger } from '../../core/owned-styles.js'
import type { EffectInstance, EffectParams, PrepareContext, Primitive } from '../../core/types.js'
import { effectDelayMs, effectEasing } from '../shared.js'

function scatter(index: number, salt: number): number {
  let hash = Math.imul(index + 1, salt)
  hash = Math.imul(hash ^ (hash >>> 16), 0x21f0aaad)
  hash = Math.imul(hash ^ (hash >>> 15), 0x735a2d97)
  return ((hash ^ (hash >>> 15)) >>> 0) / 2 ** 32
}

function createPiece(el: Element, params: EffectParams, ctx: PrepareContext, i: number) {
  const piece = ctx.doc.createElement('span')
  piece.setAttribute('data-kui-confetti-piece', '')
  piece.setAttribute('aria-hidden', 'true')
  piece.inert = true
  const duration = effectDurationMs(params, 900)
  piece.style.animationDuration = `${duration}ms`
  piece.style.animationDelay = `${effectDelayMs(params) + duration * 0.12 * scatter(i, 29)}ms`
  piece.style.animationTimingFunction = cssEasingValue(effectEasing(params, params.text('ease')))
  piece.style.setProperty('--kui-piece-x', `${(scatter(i, 11) - 0.5) * 360}px`)
  piece.style.setProperty('--kui-piece-rise', `${-40 - scatter(i, 17) * 200}px`)
  piece.style.setProperty('--kui-piece-turn', `${(scatter(i, 23) - 0.5) * 1440}deg`)
  piece.style.background = `var(--kui-confetti-c${i % 5 + 1}, var(--kui-c${i % 5 + 1}, var(--accent, currentColor)))`
  piece.style.borderRadius = i % 3 === 0 ? '50%' : '0'
  piece.style.height = i % 3 === 0 ? 'calc(var(--kui-confetti-size, 6px) / 2)' : 'calc(var(--kui-confetti-size, 6px) * 2)'
  el.append(piece)
  return { node: piece, style: createStyleLedger(piece) }
}

export const prepareConfetti: NonNullable<Primitive['prepare']> = (el, params, ctx) => {
  if (ctx.reducedMotion) return createJsInstance({ activate() {}, destroy() {} })
  const attrs = createAttributeLedger(el)
  attrs.set('data-kui-confetti-pieces', '')
  const pieces = Array.from({ length: params.num('pieces', 0) }, (_, i) => createPiece(el, params, ctx, i))
  let instances: EffectInstance[] = []
  let finished = Promise.resolve()
  let generation = 0
  const hide = (): void => { for (const piece of pieces) piece.style.set('display', 'none') }
  const cancel = (): void => {
    generation++
    for (const instance of instances) instance.cancel()
    hide()
  }
  return {
    activate() {
      cancel()
      const run = generation
      instances = pieces.map((piece) => {
        piece.style.set('display', 'block')
        const instance = createCssInstance(piece.node, piece.style, ['kui-confetti-piece'])
        instance.activate()
        return instance
      })
      finished = Promise.all(instances.map((instance) => instance.finished)).then(() => {
        if (run === generation) hide()
      })
    },
    cancel,
    finish() { for (const instance of instances) instance.finish() },
    get finished() { return finished },
    destroy() {
      cancel()
      for (const piece of pieces) piece.node.remove()
      attrs.restore()
    },
  }
}
