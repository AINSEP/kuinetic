import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  ATTR,
  Animator,
  CHANNEL,
  Registry,
  collectingReporter,
  consoleReporter,
  createActivationBinder,
  createAnimator,
  detect,
  inertInstance,
  play,
  resolveTargets,
  silentReporter,
  toAttributeValue,
} from 'designimation/core'
import type {
  Activation,
  ActivationBinder,
  ActivationBinderOptions,
  AnimatorOptions,
  Capabilities,
  Channel,
  Cleanup,
  CollectingReporter,
  EffectInstance,
  EffectParams,
  ParamSpec,
  ParameterSchema,
  PerfClass,
  PlaybackHandle,
  PlayOptions,
  PrepareContext,
  Preset,
  Primitive,
  ReducedMotionPolicy,
  Reporter,
  ResolvedEffect,
  Target,
  Timeline,
} from 'designimation/core'
import * as CoreBarrel from 'designimation/core'

/**
 * Guards `designimation/core`'s published export list.
 *
 * `src/core/index.ts` is a versioned public subpath (see `package.json` `exports`), not an
 * internal convenience barrel — everything it re-exports is a contract a third-party primitive
 * author or `createAnimator()` consumer can depend on. This test names the intended surface
 * directly, so a later `export *` creeping back in, or a compiler-internal export landing on the
 * barrel, fails here instead of silently widening the published contract (REF-005).
 */
describe('designimation/core public surface', () => {
  it('exports the runtime tier', () => {
    expect(typeof Animator).toBe('function')
    expect(typeof createAnimator).toBe('function')
    expect(ATTR).toMatchObject({ source: 'data-dsg' })
    expect(typeof Registry).toBe('function')
    expect(typeof detect).toBe('function')
    expect(typeof play).toBe('function')
    expect(typeof resolveTargets).toBe('function')
    expect(typeof toAttributeValue).toBe('function')
    expect(typeof consoleReporter).toBe('function')
    expect(typeof silentReporter).toBe('function')
    expect(typeof collectingReporter).toBe('function')
    expect(typeof createActivationBinder).toBe('function')
    expect(typeof inertInstance).toBe('function')
    expect(CHANNEL.opacity).toBe('opacity')
  })

  it('type-checks the authoring-contract tier', () => {
    // Each assertion is a compile-time guard: if the named type were dropped from the barrel,
    // `tsc --noEmit` fails on this file's imports before the assertion itself even runs.
    expectTypeOf<Primitive>().not.toBeNever()
    expectTypeOf<Preset>().not.toBeNever()
    expectTypeOf<ParameterSchema>().not.toBeNever()
    expectTypeOf<ParamSpec>().not.toBeNever()
    expectTypeOf<EffectParams>().not.toBeNever()
    expectTypeOf<PrepareContext>().not.toBeNever()
    expectTypeOf<Cleanup>().not.toBeNever()
    expectTypeOf<EffectInstance>().not.toBeNever()
    expectTypeOf<Channel>().not.toBeNever()
    expectTypeOf<Activation>().not.toBeNever()
    expectTypeOf<Timeline>().not.toBeNever()
    expectTypeOf<PerfClass>().not.toBeNever()
    expectTypeOf<ReducedMotionPolicy>().not.toBeNever()
    expectTypeOf<ActivationBinder>().not.toBeNever()
    expectTypeOf<ActivationBinderOptions>().not.toBeNever()
    expectTypeOf<AnimatorOptions>().not.toBeNever()
    expectTypeOf<Capabilities>().not.toBeNever()
    expectTypeOf<PlaybackHandle>().not.toBeNever()
    expectTypeOf<PlayOptions>().not.toBeNever()
    expectTypeOf<Target>().not.toBeNever()
    expectTypeOf<ResolvedEffect>().not.toBeNever()
    expectTypeOf<Reporter>().not.toBeNever()
    expectTypeOf<CollectingReporter>().not.toBeNever()
  })

  it('does not publish compiler-internal machinery', () => {
    const dropped = [
      'compile',
      'CompiledPlan',
      'applyStylePlan',
      'planStyles',
      'readAttributes',
      'resolveConfig',
      'toThresholdRatio',
      'parse',
      'splitTopLevel',
      'resolveParams',
      'validate',
      'claimedChannels',
      'describeConflicts',
      'findConflicts',
      'applyStagger',
      'indexStaggerGroup',
      'suggest',
      'resetCapabilities',
    ]
    for (const name of dropped) {
      expect(CoreBarrel).not.toHaveProperty(name)
    }
  })
})
