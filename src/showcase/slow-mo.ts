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

/**
 * Remembers each animation's rate from before slow-mo first touched it, so switching off (or
 * teardown) hands back *that* rate — a `control(el).rate()`/`timeScale()` override survives — and
 * touches only animations slow-mo itself rescaled.
 */
interface RateLedger {
  slow(animations: Animation[], scale: number): void
  restore(scale: number): void
}

/** Scroll- and view-timeline animations are driven by scroll position; a rate would distort them. */
function onDocumentTimeline(animation: Animation, doc: Document): boolean {
  return animation.timeline === doc.timeline
}

function restoreRate(animation: Animation, prior: number, scale: number): void {
  const current = animation.playbackRate
  // Any magnitude but ours means someone set an absolute rate since (control().timeScale): keep theirs.
  // A sign change is ours to keep — hover in/out drives ±scale while slowed.
  if (Math.abs(Math.abs(current) - scale) > 1e-9) return
  animation.playbackRate = Math.sign(current) * Math.abs(prior)
}

function createRateLedger(doc: Document): RateLedger {
  const prior = new Map<Animation, number>()
  return {
    slow(animations, scale) {
      for (const animation of animations) {
        if (!onDocumentTimeline(animation, doc)) continue
        if (!prior.has(animation)) prior.set(animation, animation.playbackRate)
        animation.playbackRate = Math.sign(animation.playbackRate || 1) * scale
      }
    },
    restore(scale) {
      for (const [animation, rate] of prior) restoreRate(animation, rate, scale)
      prior.clear()
    },
  }
}

function belongsToEvent(animation: Animation, target: Element, pseudo: string): boolean {
  const effect = animation.effect as KeyframeEffect | null
  if (!effect || effect.target !== target) return false
  return (effect.pseudoElement ?? '') === pseudo
}

function eventAnimations(event: Event): Animation[] {
  const target = event.target as Element
  const typed = event as AnimationEvent & TransitionEvent
  const isAnimation = event.type === 'animationstart'
  const key = isAnimation ? 'animationName' : 'transitionProperty'
  const name = isAnimation ? typed.animationName : typed.propertyName
  const pseudo = typed.pseudoElement ?? ''
  // `subtree: true` is what reaches ::before/::after; the filter narrows it back to the event's own
  // element and pseudo-element so a child's same-named animation is not rescaled twice.
  return animationsOf(target, true).filter((animation) =>
    belongsToEvent(animation, target, pseudo) &&
    (animation as Animation & Record<string, unknown>)[key] === name,
  )
}

function prepareSlowMo(el: Element, params: EffectParams): SetupResult {
  const attrs = createAttributeLedger(el)
  const rate = params.num('rate', 0.25)
  const controls = params.text('controls', 'button')
  const button = controls === 'button' ? el.ownerDocument.createElement('button') : null
  let slowed = controls === 'none'
  const rates = createRateLedger(el.ownerDocument)

  const apply = (): void => {
    if (slowed) attrs.set(TIME_SCALE_ATTR, String(rate))
    else attrs.remove(TIME_SCALE_ATTR)
    if (button) button.setAttribute('aria-pressed', String(slowed))
    if (slowed) rates.slow(animationsOf(el, true), rate)
    else rates.restore(rate)
  }
  const onClick = (): void => {
    slowed = !slowed
    apply()
  }
  const onStart = (event: Event): void => {
    if (slowed) rates.slow(eventAnimations(event), rate)
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
    rates.restore(rate)
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
