export { createActivationBinder, resolveActivationSpec } from './activation.js'
export type {
  ActivationBinder,
  ActivationBinderOptions,
  ActivationRequest,
  ActivationSpec,
  ActivationTrigger,
} from './activation.js'
export { Animator, createAnimator, ATTR } from './animator.js'
export type { AnimatorOptions } from './animator.js'
export { detect } from './capabilities.js'
export type { Capabilities } from './capabilities.js'
export { play, resolveTargets, toAttributeValue } from './play.js'
export type { PlaybackHandle, PlayOptions, Target } from './play.js'
export { Registry } from './registry.js'
export type { ResolvedEffect } from './registry.js'
export { collectingReporter, consoleReporter, silentReporter } from './reporter.js'
export type { CollectingReporter, Reporter } from './reporter.js'
export { CHANNEL, inertInstance } from './types.js'
export type {
  Activation,
  Channel,
  Cleanup,
  EffectInstance,
  EffectParams,
  NamedActivation,
  ParamSpec,
  ParameterSchema,
  PerfClass,
  PrepareContext,
  Preset,
  Primitive,
  ReducedMotionPolicy,
  Timeline,
} from './types.js'
