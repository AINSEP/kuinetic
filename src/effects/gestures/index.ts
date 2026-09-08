import type { Preset } from '../../core/types.js'
import type { Registry } from '../../core/registry.js'
import { GESTURE_PRIMITIVES } from './primitives.js'

/**
 * Gesture names. Twelve names over four primitives.
 *
 * The drag family differs only in where a release goes: back to origin (elastic), onward with
 * momentum (throwable), or nowhere (plain drag). That is one primitive with two booleans.
 *
 * All thirteen declare `phase: 'state'`, and none declares `transitions` (nothing here renders
 * through CSS transitions to derive it from — every primitive in this file is `renderer:
 * 'javascript'`), so this is the whole story rather than a shortcut around it. `compile.ts`'s
 * `phaseOf` treats an undeclared phase as a fact nothing is known about, which conflicts with
 * everything including itself — before this, `data-kui="fade-up on:enter, drag"` hit that wall:
 * both segments claim `translate`, `draggable`'s renderer disqualifies the additive rescue (only
 * `css-keyframes` tracks qualify), no combo is registered for the pair, and the compiler silently
 * kept only `fade-up` — an entrance plus a drag on one element, an entirely ordinary request,
 * did nothing. Interaction-reveal's four presets (`masked-label-swap*`, `hover-intent`) shipped
 * the identical gap hours earlier; this is the same bug in its second family, not a new one.
 *
 * The test throughout is *when does this effect hold the channel it claims*, not *is this a
 * press*: `'state'` means "governed by a condition the visitor changes, released — or resting at
 * a value it holds until changed again — once that condition is gone," which is exactly
 * `entrance`'s counterpart (an entrance plays once and hands the channel to whatever the cascade
 * says next; see `EffectPhase`'s doc comment). Every one of these primitives writes an inline
 * style or attribute imperatively rather than through a CSS animation track, so there is no
 * `to`-only or `from`-only keyframe to inspect — the fact instead is about *when the gesture
 * runs*:
 *
 * - `draggable` (`drag`, `drag-x`, `drag-y`, `drag-inertia`, `throwable`, `elastic-pull`,
 *   `rubber-band`, `snap-back`) writes `translate` only from `pointerdown` through however long
 *   the release takes to resolve — instantly for the plain three, a spring settle for the
 *   inertia pair, a spring return to zero for the elastic three (see `primitives.ts`'s `settle`).
 *   The inertia pair is the one worth pausing on, because it keeps moving *after* the pointer
 *   lifts: `drag-inertia`/`throwable` are not "done interacting" the instant `onEnd` fires, but
 *   they are also not `idle` — `idle` in this catalog means an unbounded loop that never yields
 *   the channel (`--kui-fx-<name>-iterations: infinite`), and a decelerating throw is bounded and
 *   does stop. It is the same one continuous gesture instance settling on its own terms, not a
 *   second trigger, so it is still `state` and not a fourth thing this enum has no room for.
 *   Every member rests at whatever `translate` it ends on — dropped in place for the plain three,
 *   carried by momentum for the inertia pair, snapped to zero for the elastic three — and holds
 *   there via the same inline style until the next drag picks it up again. None of that is an
 *   `entrance`: there is no hidden from-state and no `cloak`, just an idle rest value between
 *   gestures.
 * - `swipeable` (`swipe`, `swipe-x`) and `pressable` (`long-press`) claim the primitive-level
 *   `'state'` *channel* (a bucket for "writes an attribute, not a CSS property" — see
 *   `gestures/primitives.ts`'s `channels: ['state']` — a name that collides with this same-named
 *   `EffectPhase` value only in spelling, not in meaning). `long-press` is the clean case: it
 *   flips `data-kui-pressed` on the hold and back off on release, precisely the `:active`-shaped
 *   "held only while the visitor is doing something" case the `state` phase doc describes.
 *   `swipe`/`swipe-x` are a discrete, already-over gesture by the time `data-kui-swipe` is
 *   written (`onSwipe` fires once, at recognition) rather than a continuous hold — but the same
 *   family precedent already covers a discrete, dwell-triggered write: `hover-intent` (
 *   `interaction-reveal.ts`) sets its class once, on a timer firing during a hover, and keeps it
 *   until the pointer actually leaves, and that shipped `phase: 'state'`. A swipe's attribute is
 *   the same shape — written once by an interaction, held until the same primitive changes it
 *   again — and not an `entrance`, `exit`, or unbounded `idle`.
 * - `magnetic` (`magnetic`, `magnetic-snap`) writes `translate` continuously while the pointer is
 *   within `radius`, and springs back toward zero the moment it leaves — proximity rather than a
 *   press, but still a condition the visitor's own movement drives and un-drives, the same
 *   `state` shape as a `:hover` rule with a transition.
 */
export const GESTURE_PRESETS: Preset[] = [
  { name: 'drag', primitive: 'draggable', phase: 'state' },
  { name: 'drag-x', primitive: 'draggable', params: { axis: 'x' }, phase: 'state' },
  { name: 'drag-y', primitive: 'draggable', params: { axis: 'y' }, phase: 'state' },
  { name: 'drag-inertia', primitive: 'draggable', params: { inertia: 'true' }, phase: 'state' },
  {
    name: 'throwable',
    primitive: 'draggable',
    params: { inertia: 'true', damping: '18' },
    phase: 'state',
  },
  {
    name: 'elastic-pull',
    primitive: 'draggable',
    params: { return: 'true', bounds: '80' },
    phase: 'state',
  },
  {
    name: 'rubber-band',
    primitive: 'draggable',
    params: { return: 'true', bounds: '120' },
    phase: 'state',
  },
  {
    name: 'snap-back',
    primitive: 'draggable',
    params: { return: 'true', stiffness: '260' },
    phase: 'state',
  },

  { name: 'swipe', primitive: 'swipeable', phase: 'state' },
  { name: 'swipe-x', primitive: 'swipeable', params: { axis: 'x' }, phase: 'state' },

  { name: 'long-press', primitive: 'pressable', phase: 'state' },

  { name: 'magnetic', primitive: 'magnetic', phase: 'state' },
  {
    name: 'magnetic-snap',
    primitive: 'magnetic',
    params: { strength: '0.6', radius: '160' },
    phase: 'state',
  },
]

/**
 * Register the gesture catalog.
 *
 * @param registry - Registry to populate.
 * @returns The same registry, for chaining.
 * @complexity O(n) time in the number of primitives and presets.
 * @overallScore 100
 */
export function registerGestures(registry: Registry): Registry {
  return registry.registerPrimitives(GESTURE_PRIMITIVES).registerPresets(GESTURE_PRESETS)
}
