import type { ParameterSchema, Preset, Primitive, Renderer, TransitionSegment } from '../../core/types.js'
import type { Registry } from '../../core/registry.js'
import { ALL_TIMING_TOKENS, stylesheetTimingPrepare, TRIGGER_DELAY_PARAM } from '../shared.js'

/**
 * `@starting-style` discrete-open family (catalog section J).
 *
 * Six names that animate an element *into and out of the DOM* — `display: none`, a closed
 * `<dialog>`, or a non-open popover — which nothing else in the catalog can do. Every CSS-rendered
 * entrance in `core.ts` needs the element already laid out and visible-but-hidden (opacity 0,
 * scaled down, ...) for `on:enter`'s IntersectionObserver to ever measure it; an element that is
 * actually removed from layout never intersects and the animation is stranded
 * (`docs/implementation-outline-gsap-remainder.md`'s six-preset trap). `@starting-style` plus
 * `transition-behavior: allow-discrete` sidesteps the observer entirely: the transition fires the
 * instant the browser resolves the element's style, and `allow-discrete` keeps `display`/`overlay`
 * in the transitioned property list so the element stays rendered until the transition finishes.
 *
 * Same shape as `interaction.ts`'s hover family and for the same reason: this is a static
 * stylesheet transition, not a compiled `animation-*` track, so a near-no-op JS primitive exists
 * purely to parse the name, channel-conflict it, and mirror positional timing onto the namespaced
 * `--kui-<id>-duration/-delay/-ease` properties the stylesheet reads (`stylesheetTimingPrepare`,
 * see `effects/shared.ts`). `pushTrack` only runs for `css-keyframes` primitives
 * (`core/compile.ts`), so this renderer choice is what keeps these six from emitting any
 * `animation-*` declaration at all.
 *
 * **Cannot be deferred to an activation.** There is no `transition-play-state` to hold a
 * `@starting-style` transition paused behind `on:enter`/`on:click` the way `style-plan.ts` holds
 * every `css-keyframes` entrance behind `animation-play-state: paused`. So every primitive here
 * declares `supportedActivations: ['manual']` and `defaultActivation: 'manual'` — an author who
 * writes `on:enter` anyway gets a named warning (`animator.ts`'s `resolveActivation` ->
 * `activation.ts`'s `warnAboutActivation`) instead of a silent no-op, and the transition still
 * fires on its own the moment the element's `display`/`[data-open]`/`:popover-open`/`[open]` state
 * changes — "never a silent no-op" is the rule the rest of the grammar keeps
 * (`breakpoints.ts`'s gate rejection, `parse.ts`'s unknown-parameter warning).
 *
 * **No cloak needed.** `Preset.cloak` exists because a JS-installed from-state paints at the rest
 * state for one frame before `start()` runs. These declare their from-state in CSS
 * (`@starting-style`), so there is nothing for the runtime to install and nothing to flash.
 *
 * Channels: the visible properties (`opacity`/`scale`/`translate`) exactly as the rest of the
 * catalog, plus a new `discrete` channel for `display`/`overlay` — nothing else in the catalog
 * writes either property, and `channels.ts`'s `discrete` entry (`test/support/channel-properties.ts`)
 * is what keeps `Preset.transitions` declaring them from tripping the "transitions a property
 * outside its own channels" self-consistency check (`css-composition-invariants.test.ts`).
 *
 * `discrete.css` supplies the three rules per name: the open/rest state (plus the compiled
 * `--kui-transition` merge and `transition-behavior: allow-discrete`, a longhand the shared
 * `transition:` shorthand rule in `base.css` cannot see because it has lower specificity — see that
 * rule's own comment), the `@starting-style` from-state, and the closed state
 * (`:not(:popover-open):not([open]):not([data-open])`, deliberately unguarded — see that file's
 * header for why the closed rule must never sit behind `@supports`).
 */

const discreteTiming: ParameterSchema = {
  duration: { type: 'time', default: '240ms', cssProperty: '--kui-duration' },
  ...TRIGGER_DELAY_PARAM,
  ease: { type: 'easing', default: 'ease-out', cssProperty: '--kui-ease' },
}

/** Every primitive here honours all three timing tokens, so this reason is never actually shown. */
const PINNED_REASON = 'discrete.css pins that value on this effect'

/** `scale`, namespaced per primitive so `pop-open scale:0.5` never leaks into `scale-open`. */
function scaleParam(cssProperty: string): ParameterSchema {
  return { scale: { type: 'number', default: '0.92', cssProperty, finite: true, minimum: 0 } }
}

/** `distance`, namespaced the same way, for the translate-carrying members. */
function distanceParam(cssProperty: string, defaultValue: string): ParameterSchema {
  return { distance: { type: 'length', default: defaultValue, cssProperty } }
}

function discretePrimitive(id: string, channels: string[], extraParams: ParameterSchema = {}): Primitive {
  return {
    id,
    renderer: 'javascript' as Renderer,
    channels,
    parameters: { ...discreteTiming, ...extraParams },
    supportedTimelines: ['time'],
    supportedActivations: ['manual'],
    defaultActivation: 'manual',
    perfClass: 'compositor',
    // Not 'disable': an open/close transition on a menu or panel is a brief, functional state
    // change, not a vestibular trigger the way parallax or an infinite ambient loop is — same
    // reasoning `hoverPrimitive` gives interaction.ts's family.
    reducedMotion: 'shorten',
    prepare: stylesheetTimingPrepare(id, { honours: ALL_TIMING_TOKENS, because: PINNED_REASON }),
  }
}

const DISCRETE_BASE: TransitionSegment[] = [{ property: 'display' }, { property: 'overlay' }]

export const DISCRETE_PRIMITIVES: Primitive[] = [
  discretePrimitive('fade-open', ['opacity', 'discrete']),
  // Opacity + scale together, matching the real-world "popover/toast" pop-in — the plan's own
  // worked example. `scale-open` below is the scale-only sibling for an element that should grow
  // into place without also fading, the same split `core.ts` draws between `fade-in` and `zoom-in`.
  discretePrimitive('pop-open', ['opacity', 'scale', 'discrete'], scaleParam('--kui-pop-open-scale')),
  discretePrimitive('scale-open', ['scale', 'discrete'], scaleParam('--kui-scale-open-scale')),
  // A small upward-then-settle drop, the conventional dropdown-menu entrance (Radix/Headless UI
  // both default to roughly this distance). Deliberately smaller than the slide pair below.
  discretePrimitive(
    'drop-open',
    ['opacity', 'translate', 'discrete'],
    distanceParam('--kui-drop-open-distance', '8px'),
  ),
  // "-up"/"-down" name the direction of travel, the same convention `core.ts`'s `fade-up`/
  // `fade-down` use: `slide-open-up` starts below rest and arrives travelling upward.
  discretePrimitive(
    'slide-open-up',
    ['opacity', 'translate', 'discrete'],
    distanceParam('--kui-slide-open-up-distance', '16px'),
  ),
  discretePrimitive(
    'slide-open-down',
    ['opacity', 'translate', 'discrete'],
    distanceParam('--kui-slide-open-down-distance', '16px'),
  ),
]

export const DISCRETE_PRESETS: Preset[] = [
  { name: 'fade-open', primitive: 'fade-open', transitions: [{ property: 'opacity' }, ...DISCRETE_BASE] },
  {
    name: 'pop-open',
    primitive: 'pop-open',
    transitions: [{ property: 'opacity' }, { property: 'scale' }, ...DISCRETE_BASE],
  },
  { name: 'scale-open', primitive: 'scale-open', transitions: [{ property: 'scale' }, ...DISCRETE_BASE] },
  {
    name: 'drop-open',
    primitive: 'drop-open',
    transitions: [{ property: 'opacity' }, { property: 'translate' }, ...DISCRETE_BASE],
  },
  {
    name: 'slide-open-up',
    primitive: 'slide-open-up',
    transitions: [{ property: 'opacity' }, { property: 'translate' }, ...DISCRETE_BASE],
  },
  {
    name: 'slide-open-down',
    primitive: 'slide-open-down',
    transitions: [{ property: 'opacity' }, { property: 'translate' }, ...DISCRETE_BASE],
  },
]

/**
 * Register the `@starting-style` discrete-open catalog (section J).
 *
 * @param registry - Registry to populate.
 * @returns The same registry, for chaining.
 * @complexity O(n) time in registered primitives and presets.
 * @overallScore 100
 */
export function registerDiscrete(registry: Registry): Registry {
  return registry.registerPrimitives(DISCRETE_PRIMITIVES).registerPresets(DISCRETE_PRESETS)
}
