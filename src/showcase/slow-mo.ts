import { continuousSetup, deferPrepare } from '../core/instances.js'
import type { SetupResult } from '../core/instances.js'
import { createAttributeLedger } from '../core/owned-styles.js'
import { TIME_SCALE_ATTR } from '../core/time-scale.js'
import type { EffectParams, ParameterSchema, Preset, Primitive } from '../core/types.js'
import { withTimingContract } from '../effects/shared.js'
import { widgetPrimitive } from './shared.js'

const slowMoParams: ParameterSchema = {
  rate: { type: 'number', default: '0.25', cssProperty: '--kui-slowmo-rate', finite: true, minimum: 0.05, maximum: 1 },
  controls: { type: 'keyword', default: 'button', cssProperty: '--kui-slowmo-controls', keywords: ['button', 'none'] },
}

function animationsOf(el: Element, subtree = false): Animation[] {
  const getAnimations = (el as Element & { getAnimations?: Element['getAnimations'] }).getAnimations
  return typeof getAnimations === 'function' ? getAnimations.call(el, { subtree }) : []
}

function rescale(animations: Animation[], scale: number): void {
  for (const animation of animations) {
    animation.playbackRate = Math.sign(animation.playbackRate || 1) * scale
  }
}

function eventAnimations(event: Event): Animation[] {
  const target = event.target
  if (!(target instanceof Element)) return []
  const key = event.type === 'animationstart' ? 'animationName' : 'transitionProperty'
  const name = event.type === 'animationstart'
    ? (event as AnimationEvent).animationName
    : (event as TransitionEvent).propertyName
  return animationsOf(target).filter((animation) => {
    const value = (animation as Animation & Record<string, unknown>)[key]
    return value === name
  })
}

function prepareSlowMo(el: Element, params: EffectParams): SetupResult {
  const attrs = createAttributeLedger(el)
  const rate = params.num('rate', 0.25)
  const controls = params.text('controls', 'button')
  const button = controls === 'button' ? el.ownerDocument.createElement('button') : null
  let slowed = controls === 'none'

  const apply = (): void => {
    if (slowed) attrs.set(TIME_SCALE_ATTR, String(rate))
    else attrs.remove(TIME_SCALE_ATTR)
    if (button) button.setAttribute('aria-pressed', String(slowed))
    rescale(animationsOf(el, true), slowed ? rate : 1)
  }
  const onClick = (): void => {
    slowed = !slowed
    apply()
  }
  const onStart = (event: Event): void => {
    if (slowed) rescale(eventAnimations(event), rate)
  }

  if (button) {
    button.type = 'button'
    button.className = 'kui-slowmo-toggle'
    button.textContent = `Slow motion ${rate}×`
    button.setAttribute('aria-pressed', 'false')
    el.prepend(button)
    button.addEventListener('click', onClick)
  }
  el.addEventListener('animationstart', onStart, true)
  el.addEventListener('transitionrun', onStart, true)
  if (slowed) apply()

  return continuousSetup(() => {
    el.removeEventListener('animationstart', onStart, true)
    el.removeEventListener('transitionrun', onStart, true)
    button?.removeEventListener('click', onClick)
    rescale(animationsOf(el, true), 1)
    attrs.restore()
    button?.remove()
  })
}

/** A host-only speed control for Web Animations and CSS motion in its subtree. */
export const SLOW_MO_PRIMITIVE: Primitive = widgetPrimitive(
  'slow-mo',
  { channels: ['widget'], parameters: slowMoParams, perfClass: 'compositor' },
  withTimingContract(
    'slow-mo',
    { because: 'it changes playback rate rather than defining an animation timeline' },
    deferPrepare(prepareSlowMo),
  ),
)

/** The showcase name for the speed-control primitive. */
export const SLOW_MO_PRESETS: Preset[] = [{ name: 'slow-mo', primitive: 'slow-mo' }]
