import { Animator } from './core/animator.js'
import type { AnimatorOptions } from './core/animator.js'
import { describeAttribute, describeEffect, describeElementAttribute } from './core/describe.js'
import type { DescribedStep, EffectDescription, ElementDescription, ParamNotes } from './core/describe.js'
import type { Registry } from './core/registry.js'
import { createRegistry } from './effects/index.js'

export * from './core/index.js'
export { COMBOS, PRESETS, PRIMITIVES, createRegistry } from './effects/index.js'

/**
 * Create an animator with the bundled effect catalog registered.
 *
 * Importing this module has no side effects — nothing is scanned and the document is not
 * touched until `.start()` is called. That keeps SSR, hydration, and tests deterministic.
 *
 *   import { kuinetic } from 'kuinetic'
 *   import 'kuinetic/css'
 *   kuinetic({ observe: true }).start()
 */
export function kuinetic(options: AnimatorOptions = {}): Animator {
  return new Animator({ registry: createRegistry(), ...options })
}

export default kuinetic

/** Built on first use, so importing this module still does nothing. */
let catalog: Registry | undefined

export interface DescribeOptions {
  /** Defaults to the bundled catalog. Pass `window.__kuinetic.registry` to include tier effects. */
  registry?: Registry
  /** The plain-words table from the separate notes entry (`kuineticNotes.PARAM_NOTES`). */
  notes?: ParamNotes
}

/**
 * Every parameter a reader could write for one effect name — see `core/describe.ts`.
 *
 *   kuinetic.describe('hover-intent', { notes: kuineticNotes.PARAM_NOTES })
 *
 * @returns `undefined` when the name is not registered.
 */
export function describe(name: string, options: DescribeOptions = {}): EffectDescription | undefined {
  return describeEffect(options.registry ?? (catalog ??= createRegistry()), name, options.notes)
}

/**
 * {@link describe} for every step of a whole `data-kui` value, parsed exactly as the runtime
 * parses it: `describeSteps('fade-up 600ms, lift')`. Each step also says what it `written`.
 */
export function describeSteps(value: string, options: DescribeOptions = {}): DescribedStep[] {
  return describeAttribute(options.registry ?? (catalog ??= createRegistry()), value, options.notes)
}

/**
 * {@link describeSteps}, plus the reserved keys (`on:`, `timeline:`, `at:` …) and which of the
 * element-wide ones this value sets: `describeElement('fade-up on:click, lift')`.
 */
export function describeElement(value: string, options: DescribeOptions = {}): ElementDescription {
  return describeElementAttribute(options.registry ?? (catalog ??= createRegistry()), value, options.notes)
}
