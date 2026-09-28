import type { Channel, ParameterSchema, PerfClass, Primitive } from '../core/types.js'

/**
 * The one shape every showcase widget shares.
 *
 * `src/showcase/` builds UI components the effect catalog deliberately stays out of (a dialog, an
 * ARIA carousel, a native popover) — see `docs/design.md` §14's amendment. Every one of them is
 * built the same way for the same reasons, so this bakes the shared answers in once rather than
 * repeating them per widget:
 *
 * - `renderer: 'javascript'` — nothing here compiles to a `@keyframes` block; the DOM the widget
 *   builds and the states it toggles are the whole effect.
 * - `supportedTimelines: ['time']` — a widget runs on a clock, never on scroll/view/pointer
 *   progress. Narrower than `TIMELINE_AGNOSTIC` (`effects/shared.ts`), which abstains for
 *   primitives that never read a `Timeline` at all; a widget primitive *could* be asked for one and
 *   the honest answer is "only time makes sense here".
 * - `supportedActivations: ['load']`, `defaultActivation: 'load'` — a widget must be wired up
 *   before a keyboard user tabs to it or a crawler indexes it, not when it happens to scroll into
 *   view. `on:enter`'s lazy-install story is right for a decorative reveal and wrong for a control.
 * - `reducedMotion: 'shorten'`, never `'disable'` — `'disable'` means the animator never calls
 *   `activate()` at all (`src/effects/forms/primitives.ts`'s doc on the same trap), which would
 *   leave the widget entirely unbuilt for a reduced-motion visitor. Motion is removed in CSS
 *   instead; the widget itself still has to exist.
 * - `perfClass` is the one field every widget answers differently (a dialog's `backdrop-filter`
 *   is `'paint'`, a native-popover positioning read is `'layout'`, a synchronous attribute stamp is
 *   `'layout'` too), so it is a parameter rather than baked in.
 *
 * `prepare` is taken pre-built — already run through `deferPrepare` and, where the widget has
 * nothing to time, `withTimingContract` — rather than assembled here, because the timing contract
 * (which of `duration`/`delay`/`ease` a widget honours, and why not the rest) genuinely differs per
 * widget and baking one reason in would misdescribe the others. Same division of labour
 * `src/effects/navigation/index.ts`'s `navPrimitive` already uses for its own small family.
 *
 * @param id - Primitive id, also the preset name for every showcase widget shipped so far.
 * @param spec - The three fields every widget answers differently: `channels` (CSS property
 *   groups this widget's CSS claims, see `core/channels.ts`), `parameters` (the widget's parameter
 *   schema), and `perfClass` (this widget's honest performance-budget class). Grouped into one
 *   object rather than three positional params so this factory stays under the four-parameter
 *   lint ceiling (`eslint.config.js`'s `max-params`) alongside `prepare`.
 * @param prepare - Fully wrapped setup: `withTimingContract(...)`-and/or-`deferPrepare(...)`.
 * @returns A complete `Primitive`.
 * @complexity O(1) time and space.
 */
export function widgetPrimitive(
  id: string,
  spec: { channels: Channel[]; parameters: ParameterSchema; perfClass: PerfClass },
  prepare: NonNullable<Primitive['prepare']>,
): Primitive {
  return {
    id,
    renderer: 'javascript',
    channels: spec.channels,
    parameters: spec.parameters,
    supportedTimelines: ['time'],
    supportedActivations: ['load'],
    defaultActivation: 'load',
    perfClass: spec.perfClass,
    reducedMotion: 'shorten',
    prepare,
  }
}
