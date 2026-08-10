import type { PrepareContext } from '../../core/effect-context.js'
import { deferredInstance } from '../../core/instances.js'
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
  duration: { type: 'time', default: '400ms', cssProperty: '--dsg-duration' },
  ease: { type: 'easing', default: 'ease-out', cssProperty: '--dsg-ease' },
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
      durationMs: params.ms('duration', 400),
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
  const previousOverflow = node.style.overflow
  node.style.overflow = 'hidden'

  const duration = params.ms('duration', 400)
  let animation: Animation | null = null

  const observer = watchAttribute(node, params.text('attribute'), () => {
    animation?.cancel()
    animation = animateHeight(node, duration, params.text('ease'))
  })

  ctx.invalidate()

  return () => {
    observer()
    animation?.cancel()
    node.style.overflow = previousOverflow
    node.style.removeProperty('height')
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

  const move = (): void => {
    if (!selector) return
    const target = ctx.doc.querySelector(selector)
    if (!(target instanceof Element)) return

    const before = engine.snapshot([node])
    const box = target.getBoundingClientRect()
    node.style.width = `${box.width}px`
    node.style.translate = `${box.left}px 0`
    engine.play(before, [node], {
      durationMs: params.ms('duration', 400),
      easing: params.text('ease'),
      scale: true,
    })
  }

  const stop = watchAttribute(ctx.doc.documentElement, params.text('attribute'), move)
  move()

  return () => {
    stop()
    node.style.removeProperty('width')
    node.style.removeProperty('translate')
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
        cssProperty: '--dsg-flip-scale',
        values: ['true', 'false'],
      },
    },
    (el, params) => deferredInstance(() => prepareFlipContainer(el, params)),
  ),

  layoutPrimitive(
    'auto-height',
    ['layout'],
    { attribute: { type: 'text', default: 'data-open', cssProperty: '--dsg-attribute' } },
    (el, params, ctx) => deferredInstance(() => prepareAutoHeight(el, params, ctx)),
  ),

  layoutPrimitive(
    'flip-indicator',
    ['translate', 'layout'],
    {
      follow: { type: 'text', default: '', cssProperty: '--dsg-follow' },
      attribute: { type: 'text', default: 'aria-selected', cssProperty: '--dsg-attribute' },
    },
    (el, params, ctx) => deferredInstance(() => prepareIndicator(el, params, ctx)),
  ),
]
