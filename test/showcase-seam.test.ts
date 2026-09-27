import { describe, expect, it } from 'vitest'
import { Registry } from '../src/core/registry.js'
import { Animator } from '../src/core/animator.js'
import { registerShowcase, SHOWCASE_PRESETS, SHOWCASE_PRIMITIVES } from '../src/showcase/index.js'
import { catalogRegistry } from './support/registry.js'

/**
 * The registration seam `src/showcase/index.ts` puts in front of every showcase widget, and the
 * rules `widgetPrimitive` bakes into all of them.
 *
 * `registerInto`'s own shape-vs-`instanceof` argument is proven exhaustively by
 * `test/3d-register-gate.test.ts` against its first copy; this file does not repeat every case,
 * only the ones specific to the showcase wiring — that a bare `Registry`, an `Animator`, and a
 * non-registrar all behave the way `registerInto`'s contract promises, that `createRegistry()`
 * already carries the showcase catalog, and that no showcase primitive can quietly drift off the
 * activation/reduced-motion rules every later phase's widget also has to honour.
 */
describe('registerShowcase', () => {
  it('registers exactly SHOWCASE_PRESETS onto a bare Registry', () => {
    const registry = new Registry()
    registerShowcase(registry)

    const sortNames = (names: string[]): string[] => [...names].sort((a, b) => a.localeCompare(b))
    expect(sortNames(registry.names())).toEqual(sortNames(SHOWCASE_PRESETS.map((preset) => preset.name)))
    for (const preset of SHOWCASE_PRESETS) {
      expect(registry.resolve(preset.name), preset.name).toBeDefined()
    }
  })

  it('registers through an Animator, reaching its own .registry', () => {
    const animator = new Animator()
    registerShowcase(animator)

    for (const preset of SHOWCASE_PRESETS) {
      expect(animator.registry.resolve(preset.name), preset.name).toBeDefined()
    }
  })

  it('throws, naming itself, on anything that cannot register', () => {
    const message = /registerShowcase requires a Registry or Animator instance/
    expect(() => registerShowcase(null)).toThrow(message)
    expect(() => registerShowcase({})).toThrow(message)
    expect(() => registerShowcase({ registerPrimitive: () => undefined })).toThrow(message)
  })

  it("createRegistry() already carries every one of the module's names", () => {
    const registry = catalogRegistry()
    expect(SHOWCASE_PRESETS.length).toBeGreaterThan(0)
    for (const preset of SHOWCASE_PRESETS) {
      expect(registry.resolve(preset.name), preset.name).toBeDefined()
    }
  })

  it('holds every showcase primitive to the rules widgetPrimitive bakes in for all of them', () => {
    // A guard against this suite passing vacuously the day a widget is added by hand instead of
    // through `widgetPrimitive` — every one of these facts is a promise later phases lean on.
    expect(SHOWCASE_PRIMITIVES.length).toBeGreaterThan(0)
    for (const primitive of SHOWCASE_PRIMITIVES) {
      expect(primitive.renderer, primitive.id).toBe('javascript')
      expect(primitive.supportedTimelines, primitive.id).toEqual(['time'])
      expect(primitive.supportedActivations, primitive.id).toEqual(['load'])
      expect(primitive.defaultActivation, primitive.id).toBe('load')
      // Never 'disable': that policy means the animator never calls activate() at all, which would
      // leave the widget entirely unbuilt for a reduced-motion visitor rather than merely stiller.
      expect(primitive.reducedMotion, primitive.id).not.toBe('disable')
    }
  })
})
