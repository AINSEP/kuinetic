import { CHANNEL } from '../../core/types.js'
import type {
  Cleanup,
  EffectParams,
  ParameterSchema,
  Preset,
  Primitive,
  TransitionSegment,
} from '../../core/types.js'
import type { PrepareContext } from '../../core/effect-context.js'
import { deferPrepare } from '../../core/instances.js'
import type { Registry } from '../../core/registry.js'
import { cssPrimitive, withTimingContract } from '../shared.js'
import { createAttributeLedger } from '../../core/owned-styles.js'

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

/**
 * These three read `scrollTop` on every frame and publish a progress number or a boolean
 * attribute from it. There is no clock anywhere in that: a header is shrunk by *where the page
 * is*, so it has no start moment for a delay to be measured from, no span for a duration to set,
 * and no curve for an easing to bend. The transition an author actually sees is theirs, declared
 * in their own stylesheet against `[data-kui-shrunk]`/`[data-kui-hidden]`/`[data-kui-visible]` —
 * which is exactly where they should write the timing they want.
 */
const NAV_SCROLL_TIMING_REASON =
  'it reacts to scroll position rather than a clock, so style the state attribute it publishes ' +
  'and put your timing there'

function navPrimitive(
  id: string,
  channels: string[],
  parameters: ParameterSchema,
  prepare: NonNullable<Primitive['prepare']>,
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
    prepare: withTimingContract(id, { because: NAV_SCROLL_TIMING_REASON }, prepare),
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
  // Through a ledger, like `pin`'s `data-kui-pinned`: a raw `setAttribute` has no teardown, so
  // the state the library stamped stayed in the author's markup after `reset()` forever.
  const state = createAttributeLedger(el)
  const unsubscribe = subscribeScrollTop(el, ctx, (top) => {
    const progress = offset > 0 ? Math.min(1, Math.max(0, top / offset)) : 1
    ctx.style.set('--kui-shrink', progress.toFixed(4))
    state.set('data-kui-shrunk', String(progress >= 1))
  })
  return () => {
    unsubscribe()
    state.restore()
  }
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
  const state = createAttributeLedger(el)
  const unsubscribe = subscribeScrollTop(el, ctx, (top) => {
    const delta = top - last
    if (Math.abs(delta) < minDelta) return
    state.set('data-kui-hidden', String(delta > 0 && top > minDelta))
    last = top
  })
  return () => {
    unsubscribe()
    state.restore()
  }
}

/**
 * Show a "back to top" control once the page has scrolled past an offset.
 *
 * @complexity O(1) per scroll frame; O(1) space.
 * @overallScore 100
 */
function prepareBackToTop(el: Element, params: EffectParams, ctx: PrepareContext): Cleanup {
  const offset = params.num('offset', 400)
  const state = createAttributeLedger(el)
  const unsubscribe = subscribeScrollTop(el, ctx, (top) => {
    state.set('data-kui-visible', String(top > offset))
  })
  return () => {
    unsubscribe()
    state.restore()
  }
}

export const NAV_JS_PRIMITIVES: Primitive[] = [
  navPrimitive(
    'header-shrink',
    // `'shadow'` alongside `'layout'`: `header-shrink`'s host rule also transitions `box-shadow`
    // (navigation.css), which `layout` alone does not cover — see `header-shrink`'s own
    // `Preset.transitions` below and `channel-properties.ts`'s `layout` entry for why the two
    // interpolated properties (`padding-block`/`font-size`) stay on `layout` while this one moves
    // to the channel that already owns every other box-shadow writer (`lift-shadow`,
    // `border-glow`). Composing `header-shrink` with either of those is now a refused conflict
    // instead of a silent clobber on the same property — the self-consistency bug this closes.
    ['layout', 'shadow'],
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

/** Every literal transition timing pinned here is transcribed from navigation.css's own bare
 * `transition:` declarations, none of which read a `--kui-<id>-duration` var the way the hover
 * family does — these three react to scroll position, not a clock, so there is no generated
 * per-primitive duration to defer to (see `NAV_SCROLL_TIMING_REASON` above). */
const HEADER_SHRINK_TRANSITIONS: TransitionSegment[] = [
  { property: 'padding-block', duration: '200ms', easing: 'ease-out' },
  { property: 'font-size', duration: '200ms', easing: 'ease-out' },
  { property: 'box-shadow', duration: '200ms', easing: 'ease-out' },
]

export const NAV_JS_PRESETS: Preset[] = [
  { name: 'header-shrink', primitive: 'header-shrink', transitions: HEADER_SHRINK_TRANSITIONS },
  {
    name: 'header-hide-on-scroll',
    primitive: 'header-hide-on-scroll',
    transitions: [{ property: 'translate', duration: '220ms', easing: 'ease-out' }],
  },
  {
    name: 'back-to-top-fade',
    primitive: 'back-to-top-fade',
    transitions: [
      { property: 'opacity', duration: '200ms', easing: 'ease-out' },
      { property: 'translate', duration: '200ms', easing: 'ease-out' },
    ],
  },
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
