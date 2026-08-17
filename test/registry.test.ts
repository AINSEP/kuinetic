import { describe, expect, it } from 'vitest'
import { Registry, suggest, timingProperty } from '../src/core/registry.js'
import type { Primitive } from '../src/core/types.js'

function primitive(id: string): Primitive {
  return {
    id,
    renderer: 'css-keyframes',
    channels: [],
    parameters: {},
    supportedTimelines: ['time'],
    supportedActivations: ['load'],
    perfClass: 'compositor',
    reducedMotion: 'shorten',
  }
}

describe('Registry.registerPrimitive', () => {
  it('throws when the same primitive id is registered twice', () => {
    const registry = new Registry()
    registry.registerPrimitive(primitive('a'))
    expect(() => registry.registerPrimitive(primitive('a'))).toThrow(/already registered/)
  })
})

describe('Registry.registerPreset', () => {
  it('throws when the same preset name is registered twice', () => {
    const registry = new Registry().registerPrimitive(primitive('a'))
    registry.registerPreset({ name: 'a-preset', primitive: 'a' })
    expect(() => registry.registerPreset({ name: 'a-preset', primitive: 'a' })).toThrow(
      /already registered/,
    )
  })

  it('throws when a preset references an unregistered primitive', () => {
    const registry = new Registry()
    expect(() => registry.registerPreset({ name: 'orphan', primitive: 'missing' })).toThrow(
      /references unknown primitive "missing"/,
    )
  })
})

describe('Registry.getPrimitive', () => {
  it('returns a registered primitive by id', () => {
    const registry = new Registry().registerPrimitive(primitive('a'))
    expect(registry.getPrimitive('a')?.id).toBe('a')
  })

  it('returns undefined for an unknown id', () => {
    expect(new Registry().getPrimitive('nope')).toBeUndefined()
  })
})

describe('Registry.findCombo', () => {
  it('resolves the preset a combo was registered against, regardless of name order', () => {
    const registry = new Registry().registerPrimitive(primitive('combo-primitive'))
    registry.registerPreset({ name: 'combo-preset', primitive: 'combo-primitive' })
    registry.registerCombo(['a', 'b'], 'combo-preset')

    const found = registry.findCombo(['b', 'a'])
    expect(found?.preset.name).toBe('combo-preset')
  })

  it('returns undefined when no combo was registered for the given names', () => {
    expect(new Registry().findCombo(['a', 'b'])).toBeUndefined()
  })
})

describe('timingProperty', () => {
  it('namespaces a timing property per primitive', () => {
    expect(timingProperty('reveal', 'duration')).toBe('--kui-reveal-duration')
  })
})

describe('suggest', () => {
  it('suggests the closest candidate within the distance budget', () => {
    expect(suggest('fade-upp', ['fade-up', 'blur-in'])).toBe('fade-up')
  })

  it('returns undefined when nothing is close enough', () => {
    expect(suggest('completely-unrelated', ['fade-up', 'blur-in'])).toBeUndefined()
  })
})
