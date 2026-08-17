import { CHANNEL } from '../../core/types.js'
import type { Cleanup, EffectParams, ParameterSchema, Preset, Primitive } from '../../core/types.js'
import type { PrepareContext } from '../../core/effect-context.js'
import { deferPrepare } from '../../core/instances.js'
import type { Registry } from '../../core/registry.js'
import { cssPrimitive } from '../catalog/shared.js'

/**
 * Navigation effects (catalog section M).
 *
 * Boundary, same as section H's FLIP group: these animate a menu, header, or drawer *you*
 * control. None of them own `aria-expanded`, focus trapping, roving tabindex, or Escape-to-close
 * — that is an accessible-menu-component's job, not an animation primitive's. An author wires the
 * open/closed state (a class, an attribute, a framework) and triggers playback; this module only
 * ever supplies the motion.
 *
 * Three of the eight names — `header-shrink`, `header-hide-on-scroll`, `back-to-top-fade` — react
 * to raw scroll position rather than a trigger, so they share one small helper over the same
 * `ctx.scheduler`/`ctx.rootFor` primitives every scroll-mechanics effect already uses.
 */

// --- CSS-tier: menu-stagger-open, menu-fullscreen, dropdown-open, mega-menu-drop, drawer-slide ---

export const NAV_CSS_PRIMITIVES: Primitive[] = [
  cssPrimitive('nav-reveal', [CHANNEL.opacity, CHANNEL.translate]),
  cssPrimitive('menu-fullscreen', [CHANNEL.clip, CHANNEL.opacity]),
  cssPrimitive('panel-reveal', [CHANNEL.opacity, CHANNEL.translate]),
  cssPrimitive('drawer-slide', [CHANNEL.translate], {
    defaultActivation: 'click',
  }),
]

export const NAV_CSS_PRESETS: Preset[] = [
  { name: 'menu-stagger-open', primitive: 'nav-reveal', keyframes: 'kui-nav-reveal' },
  { name: 'menu-fullscreen', primitive: 'menu-fullscreen', keyframes: 'kui-menu-fullscreen' },
  { name: 'dropdown-open', primitive: 'panel-reveal', keyframes: 'kui-panel-reveal' },
  {
    name: 'mega-menu-drop',
    primitive: 'panel-reveal',
    keyframes: 'kui-panel-reveal',
    params: { duration: '550ms' },
  },
  {
    name: 'drawer-slide',
    primitive: 'drawer-slide',
    keyframes: 'kui-drawer-slide-right',
  },
]

// --- JS-tier: header-shrink, header-hide-on-scroll, back-to-top-fade — raw scroll position ---

function navPrimitive(
  id: string,
  channels: string[],
  parameters: ParameterSchema,
  prepare: Primitive['prepare'],
): Primitive {
  return {
    id,
    renderer: 'javascript',
    channels,
    parameters,
    supportedTimelines: ['time'],
    supportedActivations: ['load'],
    defaultActivation: 'load',
    perfClass: 'compositor',
    // A scroll-position reaction, like the scroll-mechanics category: shortening its "duration"
    // is meaningless because the position, not a clock, drives it.
    reducedMotion: 'disable',
    prepare,
  }
}

/**
 * Subscribe to raw scroll-top position, not element-relative progress — `header-shrink` measures
 * distance from the page's own top, which `scroll-mechanics/tracker.ts`'s `trackProgress` does not
 * model (it tracks an element's position through the scrollport, not the root's scrollTop).
 *
 * @complexity O(1) per scroll frame; O(1) space.
 * @overallScore 100
 */
function subscribeScrollTop(el: Element, ctx: PrepareContext, onScrollTop: (top: number) => void): Cleanup {
  return ctx.scheduler.subscribe(ctx.rootFor(el), (frame) => onScrollTop(frame.metrics.scrollTop))
}

/**
 * Shrink a header past a scroll offset by publishing progress as a custom property; the CSS side
 * interpolates padding/font-size from it, so the browser — not this callback — animates the
 * transition smoothly on every frame.
 *
 * The parameter is named `offset`, not `threshold` — `threshold:` is a reserved element-scoped
 * keyword in `parse.ts` (the `IntersectionObserver` threshold for `on:enter`), hoisted out of
 * `spec.params` before a primitive ever sees it. An authored `threshold:120` here would silently
 * vanish and this primitive would always see its own default instead.
 *
 * @complexity O(1) per scroll frame; O(1) space.
 * @overallScore 100
 */
function prepareHeaderShrink(el: Element, params: EffectParams, ctx: PrepareContext): Cleanup {
  const offset = params.num('offset', 120)
  return subscribeScrollTop(el, ctx, (top) => {
    const progress = offset > 0 ? Math.min(1, Math.max(0, top / offset)) : 1
    ctx.style.set('--kui-shrink', progress.toFixed(4))
    el.setAttribute('data-kui-shrunk', String(progress >= 1))
  })
}

/**
 * Hide a header on scroll-down, reveal it on scroll-up — the two-directional case
 * `header-shrink`'s one-directional progress cannot express.
 *
 * @complexity O(1) per scroll frame; O(1) space.
 * @overallScore 100
 */
function prepareHeaderHide(el: Element, params: EffectParams, ctx: PrepareContext): Cleanup {
  const minDelta = params.num('offset', 8)
  let last = 0
  return subscribeScrollTop(el, ctx, (top) => {
    const delta = top - last
    if (Math.abs(delta) < minDelta) return
    el.setAttribute('data-kui-hidden', String(delta > 0 && top > minDelta))
    last = top
  })
}

/**
 * Show a "back to top" control once the page has scrolled past an offset.
 *
 * @complexity O(1) per scroll frame; O(1) space.
 * @overallScore 100
 */
function prepareBackToTop(el: Element, params: EffectParams, ctx: PrepareContext): Cleanup {
  const offset = params.num('offset', 400)
  return subscribeScrollTop(el, ctx, (top) => {
    el.setAttribute('data-kui-visible', String(top > offset))
  })
}

export const NAV_JS_PRIMITIVES: Primitive[] = [
  navPrimitive(
    'header-shrink',
    ['layout'],
    { offset: { type: 'number', default: '120', cssProperty: '--kui-offset' } },
    deferPrepare(prepareHeaderShrink),
  ),
  navPrimitive(
    'header-hide-on-scroll',
    [CHANNEL.translate],
    { offset: { type: 'number', default: '8', cssProperty: '--kui-offset' } },
    deferPrepare(prepareHeaderHide),
  ),
  navPrimitive(
    'back-to-top-fade',
    [CHANNEL.opacity, CHANNEL.translate],
    { offset: { type: 'number', default: '400', cssProperty: '--kui-offset' } },
    deferPrepare(prepareBackToTop),
  ),
]

export const NAV_JS_PRESETS: Preset[] = [
  { name: 'header-shrink', primitive: 'header-shrink' },
  { name: 'header-hide-on-scroll', primitive: 'header-hide-on-scroll' },
  { name: 'back-to-top-fade', primitive: 'back-to-top-fade' },
]

export const NAVIGATION_PRIMITIVES: Primitive[] = [...NAV_CSS_PRIMITIVES, ...NAV_JS_PRIMITIVES]
export const NAVIGATION_PRESETS: Preset[] = [...NAV_CSS_PRESETS, ...NAV_JS_PRESETS]

/**
 * Register the navigation catalog.
 *
 * @param registry - Registry to populate.
 * @returns The same registry, for chaining.
 * @complexity O(n) time in the number of primitives and presets.
 * @overallScore 100
 */
export function registerNavigation(registry: Registry): Registry {
  return registry.registerPrimitives(NAVIGATION_PRIMITIVES).registerPresets(NAVIGATION_PRESETS)
}
