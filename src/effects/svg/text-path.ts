import type { PrepareContext } from '../../core/effect-context.js'
import { continuousSetup, deferPrepare } from '../../core/instances.js'
import type { SetupResult } from '../../core/instances.js'
import { effectDurationMs } from '../../core/js-params.js'
import { createAttributeLedger } from '../../core/owned-styles.js'
import type { EffectParams, Primitive } from '../../core/types.js'
import { attributeChannel } from '../../core/types.js'
import { timeScaleOf } from '../../core/time-scale.js'
import { resolveEasing } from '../catalog/numbers-shared.js'
import { TRIGGER_DELAY_PARAM } from '../shared.js'
import { distanceParam } from '../scroll-mechanics/params.js'
import { trackProgress } from '../scroll-mechanics/tracker.js'

function offsets(params: EffectParams, ctx: PrepareContext) {
  const from = params.text('from')
  const to = params.text('to')
  const unit = from.replace(/^[+-]?(?:\d*\.)?\d+/, '')
  if (!Number.isFinite(parseFloat(from)) || !Number.isFinite(parseFloat(to)) ||
    unit !== to.replace(/^[+-]?(?:\d*\.)?\d+/, '')) {
    ctx.warn('text-path from: and to: need numeric lengths with the same unit.')
    return undefined
  }
  return { from: parseFloat(from), to: parseFloat(to), unit }
}

function prepareTextPath(el: Element, params: EffectParams, ctx: PrepareContext): SetupResult {
  if (el.localName !== 'textPath') {
    ctx.warn('text-path needs an SVG textPath element.')
    return () => {}
  }
  const range = offsets(params, ctx)
  if (!range) return () => {}
  const attributes = createAttributeLedger(el)
  const write = (progress: number): void => {
    attributes.set('startOffset', `${range.from + (range.to - range.from) * progress}${range.unit}`)
  }
  if (ctx.reducedMotion) { write(1); return () => attributes.restore() }
  if (ctx.timeline === 'scroll') {
    const svg = (el as SVGTextPathElement).ownerSVGElement!
    const release = trackProgress(svg, ctx, { distance: params.text('distance') }, write)
    return continuousSetup(() => { release(); attributes.restore() })
  }
  return timedTextPath(el, params, ctx, { write, restore: () => attributes.restore(), range })
}

function timedTextPath(el: Element, params: EffectParams, ctx: PrepareContext,
  { write, restore, range }: { write(progress: number): void; restore(): void; range: { from: number; to: number; unit: string } }): SetupResult {
  const duration = effectDurationMs(params, 8000) / timeScaleOf(el)
  if (duration <= 0) { write(1); return restore }
  const animation = ctx.doc.createElementNS('http://www.w3.org/2000/svg', 'animate')
  if (typeof animation.beginElementAt !== 'function') {
    ctx.warn('text-path timer needs native SVG animation support.')
    write(1)
    return restore
  }
  const ease = resolveEasing(params.timing.easing ?? params.text('ease'), ctx.warn)
  animation.setAttribute('attributeName', 'startOffset')
  animation.setAttribute('values', Array.from({ length: 33 }, (_, i) =>
    `${range.from + (range.to - range.from) * ease(i / 32)}${range.unit}`).join(';'))
  animation.setAttribute('dur', `${duration}ms`)
  animation.setAttribute('begin', 'indefinite')
  animation.setAttribute('fill', 'freeze')
  animation.setAttribute('repeatCount', params.is('loop') ? 'indefinite' : '1')
  let resolve!: () => void
  const finished = new Promise<void>(done => { resolve = done })
  const finish = (): void => { write(1); animation.remove(); resolve() }
  const cleanup = (): void => {
    animation.removeEventListener('endEvent', finish)
    animation.remove()
    restore()
    resolve()
  }
  if (!params.is('loop')) animation.addEventListener('endEvent', finish)
  write(0)
  el.append(animation)
  try { animation.beginElementAt((params.timing.delayMs ?? params.ms('delay')) / 1000) }
  catch (error) { cleanup(); throw error }
  return params.is('loop') ? continuousSetup(cleanup) : { cleanup, finished, finish }
}

export const TEXT_PATH_PRIMITIVE: Primitive = {
  id: 'text-path',
  renderer: 'javascript',
  channels: [attributeChannel('startOffset')],
  parameters: {
    from: { type: 'length', default: '0%', cssProperty: '--kui-text-path-from' },
    to: { type: 'length', default: '100%', cssProperty: '--kui-text-path-to' },
    duration: { type: 'time', default: '8s', cssProperty: '--kui-duration' },
    ...TRIGGER_DELAY_PARAM,
    ease: { type: 'easing', default: 'linear', cssProperty: '--kui-ease' },
    loop: { type: 'keyword', default: 'false', keywords: ['true', 'false'], cssProperty: '--kui-text-path-loop' },
    ...distanceParam,
  },
  supportedTimelines: ['time', 'scroll'],
  supportedActivations: ['load', 'enter', 'manual', 'click'],
  defaultActivation: 'load',
  perfClass: 'paint',
  reducedMotion: 'shorten',
  prepare: deferPrepare(prepareTextPath),
}
