import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  ATTR,
  Animator,
  CHANNEL,
  Registry,
  KEY_NOTE_OWNER,
  KUI_EVENT,
  SUBTREE_CHANNEL,
  attributeChannel,
  collectingReporter,
  consoleReporter,
  control,
  createActivationBinder,
  createAnimator,
  describeAttribute,
  describeEffect,
  describeElementAttribute,
  describeKeys,
  detect,
  inertInstance,
  play,
  resolveTargets,
  silentReporter,
  spellingsFor,
  timingContractOf,
  toAttributeValue,
} from 'kuinetic/core'
import type {
  Activation,
  ActivationBinder,
  ActivationBinderOptions,
  AnimatorOptions,
  Capabilities,
  Channel,
  Cleanup,
  CollectingReporter,
  ControlHandle,
  DescribedStep,
  EffectDescription,
  EffectInstance,
  ElementDescription,
  KeyDescription,
  KeyScope,
  ParamDescription,
  ParamNote,
  ParamNoteDetail,
  ParamNotes,
  PositionalSlot,
  StepWritten,
  TimingContract,
  TimingToken,
  UnknownEffect,
  EffectParams,
  EffectVariant,
  InstanceControl,
  LifecycleDetail,
  LifecycleEvent,
  LifecycleEventType,
  LifecycleReason,
  ParamSpec,
  ParameterSchema,
  PerfClass,
  PlaybackHandle,
  PlaybackState,
  PlayOptions,
  PrepareContext,
  Preset,
  Primitive,
  ReducedMotionPolicy,
  Reporter,
  ResolvedEffect,
  Target,
  Timeline,
} from 'kuinetic/core'
import * as CoreBarrel from 'kuinetic/core'
// `describe` renamed on import: the bare name is vitest's.
import { describe as describeByName, describeElement, describeSteps } from 'kuinetic'
import type { DescribeOptions } from 'kuinetic'
import { PARAM_NOTES } from 'kuinetic/notes'

/**
 * Guards `kuinetic/core`'s published export list.
 *
 * `src/core/index.ts` is a versioned public subpath (see `package.json` `exports`), not an
 * internal convenience barrel — everything it re-exports is a contract a third-party primitive
 * author or `createAnimator()` consumer can depend on. This test names the intended surface
 * directly, so a later `export *` creeping back in, or a compiler-internal export landing on the
 * barrel, fails here instead of silently widening the published contract (REF-005).
 */
describe('kuinetic/core public surface', () => {
  it('exports the runtime tier', () => {
    expect(typeof Animator).toBe('function')
    expect(typeof createAnimator).toBe('function')
    expect(ATTR).toMatchObject({ source: 'data-kui' })
    expect(typeof Registry).toBe('function')
    expect(typeof detect).toBe('function')
    expect(typeof play).toBe('function')
    expect(typeof control).toBe('function')
    // Every event name, not a sample: these strings are the listener-side contract, so a rename or
    // a dropped member is a breaking change that has to fail here rather than in an author's page.
    expect(KUI_EVENT).toEqual({
      start: 'kui:start',
      finish: 'kui:finish',
      reverseFinish: 'kui:reverse-finish',
      cancel: 'kui:cancel',
    })
    expect(typeof resolveTargets).toBe('function')
    expect(typeof toAttributeValue).toBe('function')
    expect(typeof consoleReporter).toBe('function')
    expect(typeof silentReporter).toBe('function')
    expect(typeof collectingReporter).toBe('function')
    expect(typeof createActivationBinder).toBe('function')
    expect(typeof inertInstance).toBe('function')
    expect(CHANNEL.opacity).toBe('opacity')
    // The two channel names a third-party primitive needs that `CHANNEL` cannot list: an attribute
    // it writes on its host, and the host's children when it builds inside them.
    expect(attributeChannel('data-x')).toBe('attr:data-x')
    expect(SUBTREE_CHANNEL).toBe('subtree')
  })

  it('exports the describe tier', () => {
    // What a documentation page or a third-party tool reads an effect's parameters through. The
    // registry-taking forms are the contract; `kuinetic`'s own `describe*` below are conveniences.
    expect(typeof describeEffect).toBe('function')
    expect(typeof describeAttribute).toBe('function')
    expect(typeof describeElementAttribute).toBe('function')
    expect(typeof describeKeys).toBe('function')
    expect(typeof spellingsFor).toBe('function')
    expect(typeof timingContractOf).toBe('function')
    // The owner a note table keys the reserved `data-kui` words under (`'data-kui.on'`), so a
    // hand-written table outside this package has to agree with it.
    expect(KEY_NOTE_OWNER).toBe('data-kui')
    expectTypeOf<EffectDescription>().not.toBeNever()
    expectTypeOf<ParamDescription>().not.toBeNever()
    expectTypeOf<PositionalSlot>().not.toBeNever()
    expectTypeOf<DescribedStep>().not.toBeNever()
    expectTypeOf<StepWritten>().not.toBeNever()
    expectTypeOf<UnknownEffect>().not.toBeNever()
    expectTypeOf<ElementDescription>().not.toBeNever()
    expectTypeOf<KeyDescription>().not.toBeNever()
    expectTypeOf<KeyScope>().not.toBeNever()
    expectTypeOf<ParamNotes>().not.toBeNever()
    expectTypeOf<ParamNote>().not.toBeNever()
    expectTypeOf<ParamNoteDetail>().not.toBeNever()
    expectTypeOf<TimingContract>().not.toBeNever()
    expectTypeOf<TimingToken>().not.toBeNever()
  })

  it('type-checks the authoring-contract tier', () => {
    // Each assertion is a compile-time guard: if the named type were dropped from the barrel,
    // `tsc --noEmit` fails on this file's imports before the assertion itself even runs.
    expectTypeOf<Primitive>().not.toBeNever()
    expectTypeOf<Preset>().not.toBeNever()
    expectTypeOf<ParameterSchema>().not.toBeNever()
    expectTypeOf<ParamSpec>().not.toBeNever()
    expectTypeOf<EffectParams>().not.toBeNever()
    expectTypeOf<EffectVariant>().not.toBeNever()
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
    expectTypeOf<PlaybackState>().not.toBeNever()
    expectTypeOf<ControlHandle>().not.toBeNever()
    expectTypeOf<InstanceControl>().not.toBeNever()
    expectTypeOf<LifecycleDetail>().not.toBeNever()
    expectTypeOf<LifecycleEvent>().not.toBeNever()
    expectTypeOf<LifecycleEventType>().not.toBeNever()
    expectTypeOf<LifecycleReason>().not.toBeNever()
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
      'createCssControl',
      'emitLifecycle',
      'indexStaggerGroup',
      'isSafeCssValue',
      'parseStaggerAttribute',
      'resolveStaggerConfig',
      'staggerRanks',
      'suggest',
      'resetCapabilities',
    ]
    for (const name of dropped) {
      expect(CoreBarrel).not.toHaveProperty(name)
    }
  })
})

/**
 * The `kuinetic` entry's own describe conveniences, and the separate notes entry they read.
 *
 * Called rather than only type-checked: their whole job is to default the registry to the bundled
 * catalog, and a `typeof` check would pass for a function that never reached it.
 */
describe('kuinetic describe entry points', () => {
  it('describes a bundled effect without being handed a registry', () => {
    expectTypeOf<DescribeOptions>().not.toBeNever()
    expect(describeByName('fade-up')?.name).toBe('fade-up')
    expect(describeByName('no-such-effect')).toBeUndefined()
    expect(describeSteps('fade-up 600ms, lift').map((step: DescribedStep) => step.name)).toEqual(['fade-up', 'lift'])
    expect(typeof describeElement).toBe('function')
  })

  it('publishes the notes table as its own subpath', () => {
    expect(typeof PARAM_NOTES['*.duration']).toBe('string')
  })
})
