export { createActivationBinder } from './activation.js'
export type { ActivationBinder, ActivationBinderOptions } from './activation.js'
export { Animator, createAnimator, ATTR } from './animator.js'
export type { AnimatorOptions } from './animator.js'
export { detect } from './capabilities.js'
export type { Capabilities } from './capabilities.js'
export { control } from './control.js'
export type { ControlHandle } from './control.js'
// `emitLifecycle` is deliberately absent, on the same rule that keeps `PlayRequest` off this
// barrel: dispatching a lifecycle event is the animator's job, and an element that reported
// "started" because a third party said so would make these events unreliable for everyone.
// `KUI_EVENT` and the detail types are here because a *listener* needs them.
export { KUI_EVENT } from './events.js'
export type {
  LifecycleDetail,
  LifecycleEvent,
  LifecycleEventType,
  LifecycleReason,
} from './events.js'
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
  InstanceControl,
  ParamSpec,
  ParameterSchema,
  PerfClass,
  PlaybackState,
  PrepareContext,
  Preset,
  Primitive,
  ReducedMotionPolicy,
  Timeline,
} from './types.js'
