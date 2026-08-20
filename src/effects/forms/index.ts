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

export const FORMS_PRESETS: Preset[] = [
  { name: 'label-float', primitive: 'native-state' },
  { name: 'input-underline-grow', primitive: 'native-state' },
  { name: 'focus-ring-grow', primitive: 'focus-ring', keyframes: 'kui-focus-ring-grow' },
  { name: 'validate-shake', primitive: 'validate-shake', keyframes: 'kui-validate-shake' },
  { name: 'validate-check', primitive: 'validate-check', keyframes: 'kui-validate-check' },
  { name: 'strength-meter', primitive: 'strength-meter' },
  { name: 'toggle-morph', primitive: 'toggle-morph' },
  { name: 'checkbox-draw', primitive: 'native-state' },
  { name: 'radio-fill', primitive: 'radio-fill' },
  { name: 'range-fill', primitive: 'range-fill' },
  { name: 'submit-to-spinner-to-check', primitive: 'submit-flow' },
  { name: 'step-progress', primitive: 'step-progress' },
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
