import type { PrepareContext } from '../../core/effect-context.js'
import { waapiEasingValue } from '../../core/easing.js'
import { flyImage, flightImageReady } from '../../core/image-flight.js'
import type { ImageFlight } from '../../core/image-flight.js'
import { ABSOLUTE_BASIS, effectDurationMs, toPixels } from '../../core/js-params.js'
import { deferPrepare } from '../../core/instances.js'
import type { SetupResult } from '../../core/instances.js'
import type { EffectParams, Primitive } from '../../core/types.js'
import { resolveTarget } from '../../core/target.js'
import { createStyleLedger } from '../../core/owned-styles.js'
import { effectDelayMs, effectEasing, TRIGGER_DELAY_PARAM } from '../shared.js'

function flightTargets(el: Element, params: EffectParams, ctx: PrepareContext): { image: HTMLImageElement; destination: Element } | undefined {
  const imageSelector = resolveTarget(params.text('image'), ctx, 'image-flight image')
  const destinationSelector = resolveTarget(params.text('destination'), ctx, 'image-flight destination')
  if (!imageSelector || !destinationSelector) return
  const source = el.closest('[data-kui-flight-source]') ?? el
  const image = source.querySelector(imageSelector)
  const destination = ctx.doc.querySelector(destinationSelector)
  if (image instanceof HTMLImageElement && destination) return { image, destination }
  ctx.warn('image-flight needs an image inside the closest data-kui-flight-source and a destination on the page')
}

function prepareFlight(el: Element, params: EffectParams, ctx: PrepareContext): SetupResult {
  // Resolve before installing anything, so an invalid selector cannot orphan listeners.
  const targets = flightTargets(el, params, ctx)
  if (!targets) {
    let stopped = false
    queueMicrotask(() => { if (!stopped) ctx.cancel?.() })
    return () => { stopped = true }
  }
  const { image, destination } = targets
  const controller = new AbortController()
  const sourceStyle = createStyleLedger(image)
  let run: ImageFlight | undefined
  const cleanup = (): void => { controller.abort(); run?.cancel(); sourceStyle.restore(); observer.disconnect() }
  const cancel = (): void => { ctx.cancel?.(); cleanup() }
  const observer = new MutationObserver(() => {
    if (!el.isConnected || !image.isConnected || !destination.isConnected) cancel()
  })
  observer.observe(ctx.doc.documentElement, { childList: true, subtree: true })
  ctx.win.addEventListener('scroll', cancel, { capture: true, signal: controller.signal })
  ctx.win.addEventListener('resize', cancel, { signal: controller.signal })
  ctx.win.visualViewport?.addEventListener('resize', cancel, { signal: controller.signal })
  const finished = flightImageReady(image, controller.signal).then(async (ready) => {
    if (controller.signal.aborted) return
    if (!ready) { cancel(); return }
    const from = image.getBoundingClientRect()
    const to = destination.getBoundingClientRect()
    if (!from.width || !from.height || !to.width || !to.height) { cancel(); return }
    run = flyImage({ image, parent: ctx.doc.body, from, to, zIndex: '2147483647',
      duration: effectDurationMs(params, 600), delay: effectDelayMs(params),
      easing: waapiEasingValue(effectEasing(params, 'ease-in-out'), el, ctx.warn)!,
      lift: toPixels(params.text('lift'), ABSOLUTE_BASIS),
    })
    sourceStyle.set('opacity', '0')
    if (!await run.finished && !controller.signal.aborted) cancel()
    sourceStyle.restore()
    observer.disconnect()
    controller.abort()
  }).catch((error: unknown) => { ctx.warn(`image-flight failed: ${String(error)}`); cancel() })
  return { cleanup, finished, finish() { run?.finish(); controller.abort(); observer.disconnect() } }
}

export const IMAGE_FLIGHT_PRIMITIVE: Primitive = {
  id: 'image-flight',
  renderer: 'javascript',
  channels: ['image-flight:decoration'],
  parameters: {
    image: { type: 'text', default: 'img', cssProperty: '--kui-flight-image' },
    destination: { type: 'text', default: '', cssProperty: '--kui-flight-destination' },
    lift: { type: 'length', default: '60px', cssProperty: '--kui-flight-lift' },
    duration: { type: 'time', default: '600ms', cssProperty: '--kui-duration' },
    ease: { type: 'easing', default: 'ease-in-out', cssProperty: '--kui-ease' },
    ...TRIGGER_DELAY_PARAM,
  },
  supportedTimelines: ['time'],
  supportedActivations: ['click', 'manual', 'load'],
  defaultActivation: 'click',
  perfClass: 'layout',
  reducedMotion: 'disable',
  prepare: (el, params, ctx) => Object.assign(deferPrepare(prepareFlight)(el, params, ctx), { replaceOnActivate: true }),
}
