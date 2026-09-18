import { describe, expect, it } from 'vitest'
import { Registry } from '../src/core/registry.js'
import { Animator } from '../src/core/animator.js'
import { registerInto } from '../src/3d/register.js'
import { MODEL_3D_PRESETS, MODEL_3D_PRIMITIVES, registerModel3D } from '../src/3d/model-3d.js'
import { register3D } from '../src/3d/index.js'

/**
 * The gate `registerInto` puts in front of every `registerX` in this tier.
 *
 * `src/3d/register.ts` is a deliberate copy of `src/advanced/base.ts`'s gate, because a tier that
 * ships as its own `<script>` bundle must not depend on a sibling tier. This file is a deliberate
 * copy of `src/advanced/__tests__/register-gate.test.ts` for the matching reason: two
 * implementations of one rule drift silently unless both are held to the same cases.
 *
 * The rule itself is that the gate checks *shape*, not `instanceof`. Two independently-built IIFE
 * bundles each inline their own copy of `src/core/registry.ts`, so the `Registry` class this tier
 * tests against is a different class object from the one core built the page's animator with, and
 * an identity check rejects a perfectly valid animator. Shape is the weaker claim on purpose, so
 * the interesting cases are the ones it must still refuse.
 */
describe('registerInto shape gate', () => {
  it('accepts a Registry, an Animator, and anything else carrying the same two methods', () => {
    const registry = new Registry()
    registerInto(registry, MODEL_3D_PRIMITIVES, MODEL_3D_PRESETS, 'Probe')
    expect(registry.resolve('model-3d')).toBeDefined()

    const animator = new Animator()
    registerInto(animator, MODEL_3D_PRIMITIVES, MODEL_3D_PRESETS, 'Probe')
    expect(animator.registry.resolve('model-3d')).toBeDefined()

    // The case that matters: an object that is *not* an instance of this module graph's `Registry`,
    // standing in for the one a separately-bundled core would hand over. An `instanceof` gate
    // throws here.
    const seen: unknown[] = []
    const foreign = {
      registerPrimitives: (list: unknown[]) => seen.push(...list),
      registerPresets: (list: unknown[]) => seen.push(...list),
    }
    expect(foreign).not.toBeInstanceOf(Registry)
    registerInto(foreign, MODEL_3D_PRIMITIVES, MODEL_3D_PRESETS, 'Probe')
    expect(seen).toEqual([...MODEL_3D_PRIMITIVES, ...MODEL_3D_PRESETS])

    // And the same shape one level down, which is how an `Animator` reaches its registry.
    const nested: unknown[] = []
    const foreignHost = {
      registry: {
        registerPrimitives: (list: unknown[]) => nested.push(...list),
        registerPresets: (list: unknown[]) => nested.push(...list),
      },
    }
    registerInto(foreignHost, MODEL_3D_PRIMITIVES, MODEL_3D_PRESETS, 'Probe')
    expect(nested).toEqual([...MODEL_3D_PRIMITIVES, ...MODEL_3D_PRESETS])
  })

  it('takes a single primitive and preset as readily as a list', () => {
    const registry = new Registry()
    registerInto(registry, MODEL_3D_PRIMITIVES[0]!, MODEL_3D_PRESETS[0]!, 'Probe')
    expect(registry.resolve('model-3d')).toBeDefined()
  })

  it('still refuses anything that cannot actually register', () => {
    const message = /requires a Registry or Animator instance/
    const p = MODEL_3D_PRIMITIVES
    const s = MODEL_3D_PRESETS
    expect(() => registerInto(null, p, s, 'Probe')).toThrow(message)
    expect(() => registerInto(undefined, p, s, 'Probe')).toThrow(message)
    expect(() => registerInto('registry', p, s, 'Probe')).toThrow(message)
    expect(() => registerInto(42, p, s, 'Probe')).toThrow(message)
    expect(() => registerInto({}, p, s, 'Probe')).toThrow(message)
    expect(() => registerInto({ registry: {} }, p, s, 'Probe')).toThrow(message)
    expect(() => registerInto({ registry: null }, p, s, 'Probe')).toThrow(message)

    // Half the shape is not the shape. `registerPrimitive` singular is a real near-miss — it is a
    // method `Registry` genuinely has — and accepting it would mean throwing a TypeError from
    // inside `registerInto` instead of a sentence that says what was wrong.
    expect(() => registerInto({ registerPrimitive: () => undefined }, p, s, 'Probe')).toThrow(message)
    expect(() => registerInto({ registerPrimitives: () => undefined }, p, s, 'Probe')).toThrow(message)
    expect(() => registerInto({ registerPresets: () => undefined }, p, s, 'Probe')).toThrow(message)

    // Present but not callable.
    expect(() => registerInto({ registerPrimitives: true, registerPresets: true }, p, s, 'Probe')).toThrow(message)
  })

  it('names the module that was called, because that is the only clue in the message', () => {
    expect(() => registerInto(null, MODEL_3D_PRIMITIVES, MODEL_3D_PRESETS, 'Model3D')).toThrow(
      'kuinetic: registerModel3D requires a Registry or Animator instance',
    )
    expect(() => registerInto(null, MODEL_3D_PRIMITIVES, MODEL_3D_PRESETS)).toThrow(
      'kuinetic: registermodule requires a Registry or Animator instance',
    )
  })

  it('registerModel3D and register3D both reach the registry through that same gate', () => {
    expect(() => registerModel3D({})).toThrow(
      'kuinetic: registerModel3D requires a Registry or Animator instance',
    )
    expect(() => register3D({})).toThrow(/requires a Registry or Animator instance/)
    expect(() => register3D(null)).toThrow(/requires a Registry or Animator instance/)
  })

  it('hands back the registry that was written to, whichever way it was reached', () => {
    // Two arms, because `register3D` is handed an `Animator` as often as a bare `Registry` and the
    // documented return is "the registry", not "whatever you passed".
    const registry = new Registry()
    expect(register3D(registry)).toBe(registry)

    const animator = new Animator()
    expect(register3D(animator)).toBe(animator.registry)
  })
})
