import type { PrepareContext } from '../../core/effect-context.js'
import { deferPrepare } from '../../core/instances.js'
import { effectDurationMs } from '../../core/js-params.js'
import { timeScaleOf } from '../../core/time-scale.js'
import { frameScheduler, watchElementSize } from '../../core/element-size.js'
import { createFlipEngine, measureWithin, mutationWatcher, observeLayout, trackFlipRuns } from '../../core/flip.js'
import { waapiEasingValue } from '../../core/easing.js'
import { SUBTREE_CHANNEL } from '../../core/types.js'
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
 * The host's own box moves in nested mode, so it needs its parent as the frame. A fixed host has no
 * offsetParent: scrolling moves its parent but not it, so viewport boxes are the stable ones.
 */
function flipFrame(el: Element, nested: boolean): Element | null {
  if (!nested) return el
  return (el as HTMLElement).offsetParent ? el.parentElement : null
}

function hostSizeWatcher(el: Element, win: Window): (refresh: () => void) => Cleanup {
  return (refresh) => {
    const size = watchElementSize(win, refresh)
    size.observe(el)
    return size.disconnect
  }
}

/**
 * FLIP a container's children whenever its child list or their visibility changes.
 *
 * @complexity O(n) per mutation batch in the number of children; O(n) space for the snapshot.
 * @overallScore 100
 */
function prepareFlipContainer(el: Element, params: EffectParams, ctx: PrepareContext): Cleanup {
  const attribute = params.text('attribute')
  const nested = params.is('nested')
  const stateDriven = nested || attribute !== ''
  const engine = createFlipEngine({ measure: measureWithin(flipFrame(el, nested)) })
  return observeLayout(
    el,
    engine,
    {
      durationMs: effectDurationMs(params, 400),
      delayMs: effectDelayMs(params),
      easing: waapiEasingValue(effectEasing(params), el, ctx.warn),
      scale: params.is('scale'),
      nested,
      attribute,
      ...(stateDriven && { watchRest: hostSizeWatcher(el, ctx.win) }),
    },
    mutationWatcher(el, attribute),
  )
}

/**
 * Animate a measured dimension when the author's watched attribute changes.
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
  const axis = params.is('axis', 'width') ? 'width' : 'height'
  ctx.style.set('overflow', 'hidden')
  if (axis === 'width') ctx.style.set('white-space', 'nowrap')
  // Claim the dimension before clearing it to measure the stylesheet's destination.
  ctx.style.claim(axis)

  const duration = effectDurationMs(params, 400)
  const delay = effectDelayMs(params)
  // Resolved once, here, rather than per toggle: `waapiEasingValue` reads a custom property off
  // the element, and the answer cannot change between toggles without the stylesheet changing.
  const easing = waapiEasingValue(effectEasing(params), el, ctx.warn)
  let animation: Animation | null = null

  // Without a live animation the mutation has already changed layout; retain the old endpoint.
  let previous: number = node.getBoundingClientRect()[axis]

  const observer = watchAttribute(node, params.text('attribute'), () => {
    const from = animation && ['running', 'paused'].includes(animation.playState) ? node.getBoundingClientRect()[axis] : previous
    animation?.cancel()
    const endpoints = sizeEndpoints(node, from, axis)
    previous = endpoints.to
    animation = animateSize(node, endpoints, { duration, delay, easing }, axis)
  })

  ctx.invalidate()

  return () => {
    observer()
    animation?.cancel()
  }
}

/**
 * Measure the stylesheet's destination on the selected axis after cancelling the old animation.
 * The caller supplies the displayed size captured before cancellation when interrupted,
 * otherwise the previous destination, since the attribute mutation already changed layout.
 *
 * @returns The `from` and `to` dimensions in pixels.
 * @complexity O(1) time; forces one layout read.
 * @overallScore 100
 */
function sizeEndpoints(node: HTMLElement, previous: number, axis: 'width' | 'height'): { from: number; to: number } {
  // Removed rather than written, so the dimension reports what the stylesheet actually wants
  // rather than a stale inline value. `prepareAutoHeight` claims the property, which makes this
  // removal restorable.
  node.style.removeProperty(axis)
  const to = node.getBoundingClientRect()[axis]
  return { from: previous, to }
}

/**
 * Animate the selected dimension between two measured endpoints.
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
function animateSize(
  node: HTMLElement,
  endpoints: { from: number; to: number },
  timing: { duration: number; delay: number; easing: string | undefined },
  axis: 'width' | 'height',
): Animation | null {
  const animate = (node as HTMLElement & { animate?: Element['animate'] }).animate
  if (typeof animate !== 'function') return null
  const animation = animate.call(
    node,
    [{ [axis]: `${endpoints.from}px` }, { [axis]: `${endpoints.to}px` }],
    // `fill: 'backwards'` only when there is a delay to fill, so the undelayed path stays exactly
    // as it was. It has to be there when there is one: by the time this runs the stylesheet has
    // already repainted at the destination size (see `sizeEndpoints`), so an unfilled delay
    // would show the panel already open for the wait and then snap shut to animate.
    { ...timing, fill: timing.delay > 0 ? 'backwards' : 'none' },
  )
  const scale = timeScaleOf(node)
  if (scale !== 1) animation.playbackRate = scale
  return animation
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
  let followed: Element | null = null

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
    followed = target
  }

  // `move()` is fallible — a malformed `follow` selector reaches `querySelector` directly — so it
  // runs before `watchAttribute` subscribes, not after. A throw here must never leave a live
  // MutationObserver that this function has already stopped being able to hand back as cleanup.
  move()
  const update = (): void => {
    const previous = followed
    move()
    if (previous === followed) return
    if (previous) sizeWatch.unobserve(previous)
    if (followed) sizeWatch.observe(followed)
  }
  const frame = frameScheduler(ctx.win, update)
  const sizeWatch = watchElementSize(ctx.win, frame.request)
  sizeWatch.observe(el.parentElement ?? el)
  if (followed) sizeWatch.observe(followed)
  const unwatch = watchAttribute(ctx.doc.documentElement, params.text('attribute'), update)
  return () => {
    unwatch()
    sizeWatch.disconnect()
    frame.cancel()
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
  { ...layoutPrimitive(
    'flip-container',
    ['translate', 'scale'],
    {
      attribute: { type: 'text', default: '', cssProperty: '--kui-flip-attribute' },
      nested: { type: 'keyword', default: 'false', keywords: ['true', 'false'], cssProperty: '--kui-flip-nested' },
      scale: {
        type: 'keyword',
        default: 'false',
        cssProperty: '--kui-flip-scale',
        keywords: ['true', 'false'],
      },
    },
    deferPrepare(prepareFlipContainer),
  ), variantFor: (spec) => spec.params.nested === 'true'
    ? { channels: ['transform-origin', SUBTREE_CHANNEL] }
    : {} },

  { ...layoutPrimitive(
    'auto-height',
    // Only width hosts claim white-space and prevent text reflow while the box changes.
    ['overflow'],
    {
      attribute: { type: 'text', default: 'data-open', cssProperty: '--kui-attribute' },
      axis: { type: 'keyword', default: 'height', keywords: ['height', 'width'], cssProperty: '--kui-size-axis' },
    },
    deferPrepare(prepareAutoHeight),
  ), variantFor: (spec) => spec.params.axis === 'width'
    ? { channels: ['width', 'white-space'], params: { ...spec.params, 'closed[width]': 'auto' },
      schema: { 'closed[width]': { type: 'keyword', default: '0', keywords: ['0', 'auto'], cssProperty: '--kui-auto-height-closed' } } }
    : { channels: ['height'] } },

  layoutPrimitive(
    'flip-indicator',
    // The bar's landing spot (`translate`) and its `width`, matched to the selected tab.
    ['translate', 'width'],
    {
      follow: { type: 'text', default: '', cssProperty: '--kui-follow' },
      attribute: { type: 'text', default: 'aria-selected', cssProperty: '--kui-attribute' },
    },
    deferPrepare(prepareIndicator),
  ),
]
