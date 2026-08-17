import type { PrepareContext } from '../../core/effect-context.js'
import { deferPrepare } from '../../core/instances.js'
import { effectDurationMs } from '../../core/js-params.js'
import { createFlipEngine, mutationWatcher, observeLayout } from '../../core/flip.js'
import type { Cleanup, EffectParams, ParameterSchema, Primitive } from '../../core/types.js'

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
function prepareFlipContainer(el: Element, params: EffectParams): Cleanup {
  const engine = createFlipEngine()
  return observeLayout(
    el,
    engine,
    {
      durationMs: effectDurationMs(params, 400),
      easing: params.text('ease'),
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
 * @complexity O(1) per toggle, but forces layout to read `scrollHeight`.
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
  let animation: Animation | null = null

  const observer = watchAttribute(node, params.text('attribute'), () => {
    animation?.cancel()
    animation = animateHeight(node, duration, params.text('ease'))
  })

  ctx.invalidate()

  return () => {
    observer()
    animation?.cancel()
  }
}

/**
 * Animate from the element's current rendered height to its natural height.
 *
 * @returns The running animation, or `null` where the Web Animations API is unavailable.
 * @complexity O(1) time; forces one layout read.
 * @overallScore 100
 */
function animateHeight(node: HTMLElement, duration: number, easing: string): Animation | null {
  const from = `${node.getBoundingClientRect().height}px`
  // Removed rather than written, so `scrollHeight` reports the unconstrained height.
  // `prepareAutoHeight` claims the property, which is what makes this removal restorable.
  node.style.removeProperty('height')
  const to = `${node.scrollHeight}px`

  const animate = (node as HTMLElement & { animate?: Element['animate'] }).animate
  if (typeof animate !== 'function') return null
  return animate.call(node, [{ height: from }, { height: to }], { duration, easing, fill: 'none' })
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
  const selector = params.text('follow')
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
    engine.play(before, [node], {
      durationMs: effectDurationMs(params, 400),
      easing: params.text('ease'),
      scale: true,
    })
  }

  // `move()` is fallible — a malformed `follow` selector reaches `querySelector` directly — so it
  // runs before `watchAttribute` subscribes, not after. A throw here must never leave a live
  // MutationObserver that this function has already stopped being able to hand back as cleanup.
  move()
  return watchAttribute(ctx.doc.documentElement, params.text('attribute'), move)
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
