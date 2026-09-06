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
export const FORMS_PRESETS: Preset[] = [
  { name: 'label-float', primitive: 'native-state', requiresOwnSubtree: true },
  { name: 'input-underline-grow', primitive: 'native-state', requiresOwnSubtree: true },
  { name: 'focus-ring-grow', primitive: 'focus-ring', keyframes: 'kui-focus-ring-grow' },
  { name: 'validate-shake', primitive: 'validate-shake', keyframes: 'kui-validate-shake' },
  { name: 'validate-check', primitive: 'validate-check', keyframes: 'kui-validate-check' },
  { name: 'strength-meter', primitive: 'strength-meter', requiresOwnSubtree: true },
  { name: 'toggle-morph', primitive: 'toggle-morph', requiresOwnSubtree: true },
  { name: 'checkbox-draw', primitive: 'native-state', requiresOwnSubtree: true },
  { name: 'radio-fill', primitive: 'radio-fill', requiresOwnSubtree: true },
  { name: 'range-fill', primitive: 'range-fill' },
  { name: 'submit-to-spinner-to-check', primitive: 'submit-flow', requiresOwnSubtree: true },
  { name: 'step-progress', primitive: 'step-progress', requiresOwnSubtree: true },
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
  { name: 'carousel', primitive: 'step-progress', params: { scope: 'self' } },
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
