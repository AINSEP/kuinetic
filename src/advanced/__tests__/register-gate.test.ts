import { describe, expect, it } from 'vitest'
import { Registry } from '../../core/registry.js'
import { Animator } from '../../core/animator.js'
import { registerInto } from '../base.js'
import { registerAdvanced } from '../index.js'
import { PARTICLE_PRESETS } from '../particles.js'

/**
 * The gate `registerInto` puts in front of every `registerX` in this tier.
 *
 * It used to be `target instanceof Registry` / `target instanceof Animator`, and that single line
 * is what made a `<script src="kuinetic.advanced.js">` tag impossible: two independently-built IIFE
 * bundles each inline their own copy of `src/core/registry.ts`, so the class this tier tests against
 * is a *different class object* from the one core built the animator's registry with. `instanceof`
 * is identity, so a perfectly valid animator was rejected. `asRegistry` in `base.ts` checks shape
 * instead.
 *
 * Shape is a weaker claim than identity on purpose, so the interesting cases here are the ones it
 * must still refuse. `scripts/verify-tiers.mjs` covers the other half — two real bundles, two real
 * script tags, one real animator — which no amount of unit testing in one module graph can reach,
 * because inside one module graph there is only ever one `Registry` class and the old gate passed.
 */
describe('registerInto shape gate', () => {
  const primitive = { id: 'gate-probe', channel: 'opacity', prepare: () => ({}) }
  const preset = { name: 'gate-probe-fx', primitive: 'gate-probe' }

  it('accepts a Registry, an Animator, and anything else carrying the same two methods', () => {
    const registry = new Registry()
    registerInto(registry, primitive, preset, 'Probe')
    expect(registry.resolve('gate-probe-fx')).toBeDefined()

    const animator = new Animator()
    registerInto(animator, { ...primitive, id: 'gate-probe-2' }, { ...preset, name: 'gate-probe-fx-2', primitive: 'gate-probe-2' }, 'Probe')
    expect(animator.registry.resolve('gate-probe-fx-2')).toBeDefined()

    // The case that matters: an object that is *not* an instance of this module graph's `Registry`,
    // standing in for the one a separately-bundled core would hand over. The old gate threw here.
    const seen: unknown[] = []
    const foreign = {
      registerPrimitives: (list: unknown[]) => seen.push(...list),
      registerPresets: (list: unknown[]) => seen.push(...list),
    }
    expect(foreign).not.toBeInstanceOf(Registry)
    registerInto(foreign, primitive, preset, 'Probe')
    expect(seen).toEqual([primitive, preset])

    // And the same shape one level down, which is how an `Animator` reaches its registry.
    const nested: unknown[] = []
    const foreignHost = {
      registry: {
        registerPrimitives: (list: unknown[]) => nested.push(...list),
        registerPresets: (list: unknown[]) => nested.push(...list),
      },
    }
    registerInto(foreignHost, primitive, preset, 'Probe')
    expect(nested).toEqual([primitive, preset])
  })

  it('still refuses anything that cannot actually register', () => {
    const message = /requires a Registry or Animator instance/
    expect(() => registerInto(null, primitive, preset, 'Probe')).toThrow(message)
    expect(() => registerInto(undefined, primitive, preset, 'Probe')).toThrow(message)
    expect(() => registerInto('registry', primitive, preset, 'Probe')).toThrow(message)
    expect(() => registerInto(42, primitive, preset, 'Probe')).toThrow(message)
    expect(() => registerInto({}, primitive, preset, 'Probe')).toThrow(message)
    expect(() => registerInto({ registry: {} }, primitive, preset, 'Probe')).toThrow(message)
    expect(() => registerInto({ registry: null }, primitive, preset, 'Probe')).toThrow(message)

    // Half the shape is not the shape. `registerPrimitive` singular is a real near-miss — it is a
    // method `Registry` genuinely has — and accepting it would mean throwing a TypeError from
    // inside `registerInto` instead of a sentence that says what was wrong.
    expect(() => registerInto({ registerPrimitive: () => undefined }, primitive, preset, 'Probe')).toThrow(message)
    expect(() => registerInto({ registerPrimitives: () => undefined }, primitive, preset, 'Probe')).toThrow(message)
    expect(() => registerInto({ registerPresets: () => undefined }, primitive, preset, 'Probe')).toThrow(message)

    // Present but not callable.
    expect(() => registerInto({ registerPrimitives: true, registerPresets: true }, primitive, preset, 'Probe')).toThrow(message)
  })

  it('names the module that was called, because that is the only clue in the message', () => {
    expect(() => registerInto(null, primitive, preset, 'Shaders')).toThrow(
      'kuinetic: registerShaders requires a Registry or Animator instance',
    )
    expect(() => registerInto(null, primitive, preset)).toThrow(
      'kuinetic: registermodule requires a Registry or Animator instance',
    )
  })

  it('registerAdvanced reaches the registry through the same gate', () => {
    const animator = new Animator()
    registerAdvanced(animator)
    for (const advancedPreset of PARTICLE_PRESETS) {
      expect(animator.registry.resolve(advancedPreset.name)).toBeDefined()
    }

    expect(() => registerAdvanced({})).toThrow(/requires a Registry or Animator instance/)
  })
})
