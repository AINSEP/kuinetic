import type { PrepareContext } from '../../core/effect-context.js'
import { deferPrepare } from '../../core/instances.js'
import { effectDurationMs } from '../../core/js-params.js'
import { createFlipEngine, mutationWatcher, observeLayout, trackFlipRuns } from '../../core/flip.js'
import { waapiEasingValue } from '../../core/easing.js'
import type { Cleanup, EffectParams, ParameterSchema, Primitive } from '../../core/types.js'
import { effectDelayMs, effectEasing, TRIGGER_DELAY_PARAM } from '../shared.js'

/**
 * Layout-transition primitives.
 *
 * All three are FLIP. Reordering, filtering, sorting, grid↔list, and masonry reflow are the same
 * operation — "the children moved" — and none of them are expressible as keyframes, which is why
 * the whole group needs a measure/invert/play engine rather than more CSS.
 *
 * These are `perfClass: 'layout'` and honest about it: FLIP reads geometry by definition. The
 * mitigation is batching every read before any write, which `flip.ts` does.
 */

const timing: ParameterSchema = {
  duration: { type: 'time', default: '400ms', cssProperty: '--kui-duration' },
  /*
   * All three of these have a definite start moment even though they default to `on:load`: the
   * children moved, the watched attribute flipped, the indicator's target changed. `'load'` here
   * means "install the observer now", not "play now" — so "hold everything in place for 200ms,
   * then move" is a coherent thing to ask for, and it is what a sequence needs in order to
   * position a FLIP after something else.
   *
   * Spent as the Web Animations `delay` on the invert-to-identity keyframes (`core/flip.ts`) and
   * on the height tween, both with `fill: 'backwards'`, so the wait is spent looking *un-moved*
   * rather than looking finished. Symmetric, unlike the hover family's: a reorder has no
   * "leaving" direction to treat differently.
   */
  ...TRIGGER_DELAY_PARAM,
  ease: { type: 'easing', default: 'ease-out', cssProperty: '--kui-ease' },
}

function layoutPrimitive(
  id: string,
  channels: string[],
  parameters: ParameterSchema,
  prepare: Primitive['prepare'],
): Primitive {
  return {
    id,
    renderer: 'javascript',
    channels,
    parameters: { ...timing, ...parameters },
    supportedTimelines: ['time'],
    supportedActivations: ['load', 'manual', 'click'],
    defaultActivation: 'load',
    perfClass: 'layout',
    // A layout transition that is merely faster is still a layout transition; under reduced
    // motion the correct behaviour is for elements to appear in place.
    reducedMotion: 'disable',
    prepare,
  }
}

/**
 * FLIP a container's children whenever its child list or their visibility changes.
 *
 * @complexity O(n) per mutation batch in the number of children; O(n) space for the snapshot.
 * @overallScore 100
 */
function prepareFlipContainer(el: Element, params: EffectParams, ctx: PrepareContext): Cleanup {
  const engine = createFlipEngine()
  return observeLayout(
    el,
    engine,
    {
      durationMs: effectDurationMs(params, 400),
      delayMs: effectDelayMs(params),
      easing: waapiEasingValue(effectEasing(params), el, ctx.warn),
      scale: params.is('scale'),
    },
    mutationWatcher(el),
  )
}

/**
 * Animate an element's height between its collapsed and natural sizes.
 *
 * `height: auto` is not interpolable, so the natural height is measured and used as an explicit
 * endpoint. This is the accordion mechanism, and nothing more: it does not own `aria-expanded`,
 * focus, or keyboard handling. Those belong to the component, not to an animation library.
 *
 * @complexity O(1) per toggle, but forces a layout read on activation and on every toggle.
 * @overallScore 100
 */
function prepareAutoHeight(el: Element, params: EffectParams, ctx: PrepareContext): Cleanup {
  const node = el as HTMLElement
  ctx.style.set('overflow', 'hidden')
  // Measuring the natural height means clearing any inline `height` first, and a collapsed start
  // state is exactly the sort of thing an author writes inline. Claiming it makes that removal a
  // tracked write, so teardown hands the value back instead of eating it.
  ctx.style.claim('height')

  const duration = effectDurationMs(params, 400)
  const delay = effectDelayMs(params)
  // Resolved once, here, rather than per toggle: `waapiEasingValue` reads a custom property off
  // the element, and the answer cannot change between toggles without the stylesheet changing.
  const easing = waapiEasingValue(effectEasing(params), el, ctx.warn)
  let animation: Animation | null = null

  // The height the last toggle settled on, seeded from whatever is actually rendered right now —
  // this is the only moment the element's starting height can be read *before* any toggle has
  // touched it, which is what lets the very first toggle start from a real number (a collapsed
  // peek, a full open height) instead of guessing. From here on it is tracked rather than
  // re-measured, because by the time the observer below runs, the stylesheet has *already*
  // repainted at the new resting height, so the element can no longer be asked where it came from.
  let previous: number = node.getBoundingClientRect().height

  const observer = watchAttribute(node, params.text('attribute'), () => {
    animation?.cancel()
    const endpoints = heightEndpoints(node, previous)
    previous = endpoints.to
    animation = animateHeight(node, endpoints, { duration, delay, easing })
  })

  ctx.invalidate()

  return () => {
    observer()
    animation?.cancel()
  }
}

/**
 * Decide which two heights this toggle runs between.
 *
 * A mutation observer is a *reaction*: the watched attribute has already flipped and the browser
 * has already laid the element out at whatever height the stylesheet now asks for. So the rendered
 * height is the animation's **end**, never its start — reading it as the start is what made closing
 * play forwards, snap open, and then cut to nothing.
 *
 * The start is simply the height the previous toggle settled on — `prepareAutoHeight` seeds that
 * record once, from the element's actual rendered height before any toggle has happened, so even
 * the first toggle has a real measurement to start from rather than a guess. That is what lets a
 * panel collapsed to a non-zero "peek" open from its peek instead of from zero: nothing here has to
 * infer that "collapsed" and "zero" mean the same thing.
 *
 * @returns The `from` and `to` heights in pixels.
 * @complexity O(1) time; forces one layout read.
 * @overallScore 100
 */
function heightEndpoints(node: HTMLElement, previous: number): { from: number; to: number } {
  // Removed rather than written, so the rendered height reports what the stylesheet actually wants
  // rather than a stale inline value. `prepareAutoHeight` claims the property, which makes this
  // removal restorable.
  node.style.removeProperty('height')
  const to = node.getBoundingClientRect().height
  return { from: previous, to }
}

/**
 * Animate an element's height between two measured endpoints.
 *
 * `fill: 'none'` on purpose: the stylesheet owns the resting height at both ends, so the animation
 * hands it straight back instead of pinning an inline pixel value over `height: auto`. An authored
 * delay upgrades that to `'backwards'`, which fills only the *before* phase and so leaves that
 * hand-back at the end untouched.
 *
 * @returns The running animation, or `null` where the Web Animations API is unavailable.
 * @complexity O(1) time and space.
 * @overallScore 100
 */
function animateHeight(
  node: HTMLElement,
  endpoints: { from: number; to: number },
  timing: { duration: number; delay: number; easing: string | undefined },
): Animation | null {
  const animate = (node as HTMLElement & { animate?: Element['animate'] }).animate
  if (typeof animate !== 'function') return null
  return animate.call(
    node,
    [{ height: `${endpoints.from}px` }, { height: `${endpoints.to}px` }],
    // `fill: 'backwards'` only when there is a delay to fill, so the undelayed path stays exactly
    // as it was. It has to be there when there is one: by the time this runs the stylesheet has
    // already repainted at the destination height (see `heightEndpoints`), so an unfilled delay
    // would show the panel already open for the wait and then snap shut to animate.
    { ...timing, fill: timing.delay > 0 ? 'backwards' : 'none' },
  )
}

/**
 * Slide a single element to whichever target currently carries the active marker.
 *
 * The tab-indicator case: one element follows a moving target, so it is FLIP with a snapshot of
 * one and a layout change it does not cause.
 *
 * @complexity O(1) per change; forces one layout read.
 * @overallScore 100
 */
function prepareIndicator(el: Element, params: EffectParams, ctx: PrepareContext): Cleanup {
  const node = el as HTMLElement
  const engine = createFlipEngine()
  const easing = waapiEasingValue(effectEasing(params), el, ctx.warn)
  const selector = params.text('follow')
  const runs = trackFlipRuns()
  let currentShift = 0

  const move = (): void => {
    if (!selector) return
    const target = ctx.doc.querySelector(selector)
    if (!(target instanceof Element)) return

    const before = engine.snapshot([node])
    const box = target.getBoundingClientRect()
    const current = node.getBoundingClientRect()
    // Translate by the *delta*, not the target's viewport x. Writing an absolute coordinate as a
    // relative transform overshot by the indicator's own starting offset.
    const shift = box.left - current.left + currentShift
    currentShift = shift
    ctx.style.set('width', `${box.width}px`)
    ctx.style.set('translate', `${shift}px 0`)
    // Held rather than dropped: the slide is a live Web Animation that outlives this call, and an
    // indicator that keeps travelling after the effect is torn down is writing to an element the
    // animator has already handed back. Tab switches also land faster than a 400ms slide finishes,
    // so more than one can be in the air at once.
    runs.track(
      engine.play(before, [node], {
        durationMs: effectDurationMs(params, 400),
        delayMs: effectDelayMs(params),
        easing,
        scale: true,
      }),
    )
  }

  // `move()` is fallible — a malformed `follow` selector reaches `querySelector` directly — so it
  // runs before `watchAttribute` subscribes, not after. A throw here must never leave a live
  // MutationObserver that this function has already stopped being able to hand back as cleanup.
  move()
  const unwatch = watchAttribute(ctx.doc.documentElement, params.text('attribute'), move)
  return () => {
    unwatch()
    runs.cancelAll()
  }
}

/**
 * Call `onChange` whenever the named attribute changes anywhere in the subtree.
 *
 * @complexity O(1) to install; callback cost is the caller's.
 * @overallScore 100
 */
function watchAttribute(root: Element, attribute: string, onChange: () => void): Cleanup {
  if (typeof MutationObserver === 'undefined' || !attribute) return () => {}
  const observer = new MutationObserver(onChange)
  observer.observe(root, { subtree: true, attributes: true, attributeFilter: [attribute] })
  return () => observer.disconnect()
}

export const LAYOUT_PRIMITIVES: Primitive[] = [
  layoutPrimitive(
    'flip-container',
    ['translate', 'scale'],
    {
      scale: {
        type: 'keyword',
        default: 'false',
        cssProperty: '--kui-flip-scale',
        values: ['true', 'false'],
      },
    },
    deferPrepare(prepareFlipContainer),
  ),

  layoutPrimitive(
    'auto-height',
    ['layout'],
    { attribute: { type: 'text', default: 'data-open', cssProperty: '--kui-attribute' } },
    deferPrepare(prepareAutoHeight),
  ),

  layoutPrimitive(
    'flip-indicator',
    ['translate', 'layout'],
    {
      follow: { type: 'text', default: '', cssProperty: '--kui-follow' },
      attribute: { type: 'text', default: 'aria-selected', cssProperty: '--kui-attribute' },
    },
    deferPrepare(prepareIndicator),
  ),
]
