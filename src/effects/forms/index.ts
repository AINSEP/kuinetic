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
