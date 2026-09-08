import type { Preset, Primitive } from '../../core/types.js'
import type { Registry } from '../../core/registry.js'
import {
  FOCUS_RING_PRIMITIVE,
  NATIVE_STATE_PRIMITIVE,
  RADIO_FILL_PRIMITIVE,
  RANGE_FILL_PRIMITIVE,
  STEP_PROGRESS_PRIMITIVE,
  STRENGTH_METER_PRIMITIVE,
  SUBMIT_FLOW_PRIMITIVE,
  TOGGLE_MORPH_PRIMITIVE,
  VALIDATE_CHECK_PRIMITIVE,
  VALIDATE_SHAKE_PRIMITIVE,
} from './primitives.js'

export * from './primitives.js'

export const FORMS_PRIMITIVES: Primitive[] = [
  NATIVE_STATE_PRIMITIVE,
  FOCUS_RING_PRIMITIVE,
  VALIDATE_SHAKE_PRIMITIVE,
  VALIDATE_CHECK_PRIMITIVE,
  STRENGTH_METER_PRIMITIVE,
  TOGGLE_MORPH_PRIMITIVE,
  RADIO_FILL_PRIMITIVE,
  RANGE_FILL_PRIMITIVE,
  STEP_PROGRESS_PRIMITIVE,
  SUBMIT_FLOW_PRIMITIVE,
]

// `requiresOwnSubtree: true` on eight of these twelve — every one of `forms.css`'s 44 reaching
// selectors, per the plan's own count, sits behind one of these names. Each keys on a sibling
// `<label>`/`<input>` or a `.kui-*` child the CSS assumes exists beside or under the fx element;
// `target:` relocating just the fx stamp would compile those rules to silence. `focus-ring-grow`,
// `validate-shake`, `validate-check` and `range-fill` are not on the list — their CSS only ever
// touches the fx element's own box.
//
// Phase (see `EffectPhase`, `core/channels.ts`): nine of these twelve hold their channels only
// while a native control state is true, which is `state` — the textbook case the value exists for.
// Nine, not the seven whose primitive is literally named `native-state`, because the fact is "held
// by a condition the visitor drives, changing only when they act again," and `strength-meter`/
// `range-fill`/`submit-to-spinner-to-check`/`step-progress`/`carousel` fit that exactly even though
// their condition is JS-published (an attribute or stage) rather than a browser pseudo-class:
// - `label-float`, `input-underline-grow`, `checkbox-draw`, `radio-fill`, `toggle-morph` transition
//   between two normal declarations scoped to `:focus`/`:checked`/`:not(:placeholder-shown)`
//   (forms.css) — released the instant the visitor blurs/unchecks, same shape as `lift`.
// - `strength-meter` re-derives `data-kui-strength-level` on every `input` event and forms.css
//   transitions opacity/background off it — the attribute is the condition, typed keystrokes are
//   what changes it.
// - `range-fill` republishes `--kui-fill` on every `input` event the same way; the gradient is
//   `background`, held at whatever the slider currently reads.
// - `submit-to-spinner-to-check`/`step-progress`/`carousel` swap children via `data-kui-stage`/
//   `data-kui-step(-state)`, held at the current stage/index until the next click moves it — the
//   same "rests at a value until changed again" shape `gestures/index.ts` established for
//   `draggable`'s rest position, just driven by a click-state-machine instead of a spring.
//
// `focus-ring-grow` and `validate-check` are deliberately **not** `entrance` despite looking like
// one (a CSS-keyframes draw from a start to an end): both keyframe blocks close with an explicit
// `to` (`box-shadow` at full ring width; `stroke-dashoffset: 0`, forms.css), so — per `EffectPhase`'s
// own doc and `compile.ts`'s `phaseOf` — they pin the channel via `animation-fill-mode: both`
// instead of releasing it, and neither is authored with an un-fire (no `focus/blur` pairing, no
// second click). `test/composition-phase.test.ts` asserts, catalog-wide, that every `phase:
// 'entrance'` preset's keyframe block has no closing step — declaring either of these `entrance`
// would fail that invariant, correctly, since it would silently clobber a composed hover rather
// than the loud drop an unphased claim still produces today. `validate-shake` is the same shape one
// level plainer: its keyframe returns `translate` to identity and holds it there, a transient pulse
// with no persisted value at all — the architecture notes name `shake` and `focus-ring` by name as
// feedback primitives that "match none of the four phases," and that holds at preset granularity
// too. All three are left unphased on purpose; this is not an oversight.
export const FORMS_PRESETS: Preset[] = [
  { name: 'label-float', primitive: 'native-state', requiresOwnSubtree: true, phase: 'state' },
  {
    name: 'input-underline-grow',
    primitive: 'native-state',
    requiresOwnSubtree: true,
    phase: 'state',
  },
  { name: 'focus-ring-grow', primitive: 'focus-ring', keyframes: 'kui-focus-ring-grow' },
  { name: 'validate-shake', primitive: 'validate-shake', keyframes: 'kui-validate-shake' },
  { name: 'validate-check', primitive: 'validate-check', keyframes: 'kui-validate-check' },
  { name: 'strength-meter', primitive: 'strength-meter', requiresOwnSubtree: true, phase: 'state' },
  { name: 'toggle-morph', primitive: 'toggle-morph', requiresOwnSubtree: true, phase: 'state' },
  { name: 'checkbox-draw', primitive: 'native-state', requiresOwnSubtree: true, phase: 'state' },
  { name: 'radio-fill', primitive: 'radio-fill', requiresOwnSubtree: true, phase: 'state' },
  { name: 'range-fill', primitive: 'range-fill', phase: 'state' },
  {
    name: 'submit-to-spinner-to-check',
    primitive: 'submit-flow',
    requiresOwnSubtree: true,
    phase: 'state',
  },
  { name: 'step-progress', primitive: 'step-progress', requiresOwnSubtree: true, phase: 'state' },
  /*
   * Same primitive, second name — an index that wraps is a progress bar when its steps are
   * segments of a bar and a carousel when they are slides, and the only thing separating those
   * two readings is the stylesheet. `step-progress` was the wrong word to type on a deck of
   * slides, which is the only reason this alias exists; nothing behaves differently under it.
   *
   * It is still an *index*, not a carousel component: no ARIA, no roving focus, no autoplay. That
   * boundary is the one section H states — the library animates elements you control and does not
   * own the widget — and naming this `carousel` does not move it.
   *
   * No `requiresOwnSubtree` here, unlike `step-progress` beside it. That flag means "this name's
   * shipped CSS reaches past the element into its descendants, so the universal `target:` must
   * refuse to relocate it" — and `forms.css` keys its stepper rules on
   * `[data-kui-fx~='step-progress']`, which is the *name*, not the primitive. Under this name the
   * library ships no CSS at all: the page styles its own slides off `data-kui-step-state`. Carrying
   * the flag anyway would silently refuse a `target:` that would have worked fine.
   */
  /*
   * `scope:self` is the one thing that does differ, and it is a default rather than a behaviour:
   * `step-progress` resolves `target:`/`next:`/`prev:`/`jump:` page-wide, which is right for a bar
   * whose segments are deliberately elsewhere (a legend beside it) and wrong for a deck. Two decks
   * on one page are the ordinary case, not an edge one, and page-wide resolution makes them share
   * everything: each instance binds *both* decks' arrows and marks *both* decks' slides, so
   * clicking next on one advances the other. A deck's slides and its controls live inside it, so
   * searching inside it is both correct and the only reading that scales past one.
   *
   * A default, so `scope:page` still spells the old behaviour for a deck whose arrows genuinely
   * sit outside it, and `step-progress` — which is what the shipped stepper form is authored as —
   * is untouched.
   */
  { name: 'carousel', primitive: 'step-progress', params: { scope: 'self' }, phase: 'state' },
]

/**
 * Register the forms catalog.
 *
 * @param registry - Registry to populate.
 * @returns The same registry, for chaining.
 * @complexity O(n) time in the number of primitives and presets.
 * @overallScore 100
 */
export function registerForms(registry: Registry): Registry {
  return registry.registerPrimitives(FORMS_PRIMITIVES).registerPresets(FORMS_PRESETS)
}
