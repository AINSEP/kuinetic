import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  MODEL_3D_PARAMETERS,
  MODEL_3D_PRESETS,
  MODEL_3D_PRIMITIVE,
  MODEL_3D_PRIMITIVES,
  clamp,
  degreesOf,
  detectWebGL,
  prepareModel3D,
  register3D,
  registerInto,
  registerModel3D,
  resolveModelOptions,
  warnClippingAncestor,
} from '../src/3d/index.js'
import type { FlatteningContext, LightRig, ModelAxis, ModelOptions } from '../src/3d/index.js'
import { Registry } from '../src/core/registry.js'
import { kuinetic } from '../src/index.js'
import * as ThreeDBarrel from '../src/3d/index.js'
import * as RootBarrel from '../src/index.js'

/**
 * Guards the `kuinetic/3d` tier's public surface — **against the source barrel, not the package.**
 *
 * ⚠ **This is NOT the subpath test, and the subpath is NOT covered.** Do not read it as one.
 *
 * `test/advanced-subpath.test.ts` is the real article: it imports from `'kuinetic/advanced'`, which
 * resolves through `package.json`'s `exports` map into `dist/`, so it fails if the build stops
 * emitting the subpath, if `exports` stops naming it, or if the emitted `.d.ts` goes missing. None
 * of that can be asserted here yet, because none of it exists: there is no `./3d` entry in
 * `exports` and no `src/3d/index.ts` entry point in `build:dist`. A test written that way today
 * would be red by construction, and adding those two things is a `package.json` change that belongs
 * to the chunk that owns it.
 *
 * So the imports below are deliberately relative (`../src/3d/index.js`). Every assertion
 * `advanced-subpath` makes is reproduced against the source barrel — registrars, schema, the
 * hand-written id list both ways, round-trip registration, both isolation directions — except the
 * one that matters most about publishing, which is that a *consumer* can reach any of it.
 *
 * **What should replace this.** Once `./3d` is in `exports` and `src/3d/index.ts` is an esbuild
 * entry point, change the two `../src/3d/index.js` specifiers to `'kuinetic/3d'`, change
 * `../src/index.js` to `'kuinetic'`, `../src/core/registry.js` to `'kuinetic/core'`, and delete
 * this warning. Nothing else in the file needs to move. Until then, "the 3D tier's public surface
 * is tested" is true and "the 3D subpath ships" is unverified.
 *
 * The half that already works in full is the opposite promise: this tier is opt-in, and the default
 * entry must not grow by a byte because it exists.
 */

/**
 * Every primitive id this tier registers.
 *
 * Hand-written, and checked against the real exports in both directions below. The ids are the
 * authoring contract — a rename is a breaking change for every page that spells one in `data-kui`
 * — so they are named here deliberately rather than derived from the thing they are meant to check.
 */
const THREE_D_PRIMITIVE_IDS = ['model-3d']

function allPrimitiveIds(): string[] {
  return [MODEL_3D_PRIMITIVE, MODEL_3D_PRIMITIVES].flat().map((primitive) => primitive.id)
}

describe('kuinetic/3d public surface', () => {
  it('exports every registrar, preparer and helper a consumer reaches for', () => {
    for (const fn of [register3D, registerModel3D, registerInto]) {
      expect(typeof fn).toBe('function')
    }
    for (const fn of [prepareModel3D, resolveModelOptions]) {
      expect(typeof fn).toBe('function')
    }
    for (const fn of [degreesOf, clamp, detectWebGL, warnClippingAncestor]) {
      expect(typeof fn).toBe('function')
    }
  })

  it('exports the schema and presets, so an author can read parameters without reaching into src', () => {
    expect(Object.keys(MODEL_3D_PARAMETERS).length).toBeGreaterThan(0)
    expect([MODEL_3D_PRESETS].flat().length).toBeGreaterThan(0)
    // Both directions against the hand-written list: a new primitive that nobody named here fails,
    // and a renamed one fails too.
    expect(new Set(allPrimitiveIds())).toEqual(new Set(THREE_D_PRIMITIVE_IDS))
    expect(MODEL_3D_PRIMITIVES.map((p) => p.id)).toEqual(THREE_D_PRIMITIVE_IDS)
  })

  it('names every preset after a primitive it actually registers', () => {
    const ids = new Set(allPrimitiveIds())
    for (const preset of MODEL_3D_PRESETS) {
      expect(ids.has(preset.primitive), `preset "${preset.name}" names no registered primitive`).toBe(true)
    }
  })

  it('type-checks the authoring-contract tier', () => {
    // Compile-time guards: dropping one of these from the barrel fails `tsc --noEmit` on the import
    // above, before the assertion runs.
    expectTypeOf<ModelOptions>().not.toBeNever()
    expectTypeOf<ModelAxis>().not.toBeNever()
    expectTypeOf<LightRig>().not.toBeNever()
    expectTypeOf<FlatteningContext>().not.toBeNever()
  })
})

describe('kuinetic/3d registration', () => {
  it('registers onto a bare Registry from core', () => {
    const registry = new Registry()
    register3D(registry)
    for (const id of THREE_D_PRIMITIVE_IDS) {
      expect(registry.getPrimitive(id), `primitive "${id}" is missing`).toBeTruthy()
    }
    for (const preset of MODEL_3D_PRESETS) {
      expect(registry.resolve(preset.name), `effect "${preset.name}" is missing`).toBeDefined()
    }
  })

  it('registers onto an Animator built by the default entry, the documented opt-in', () => {
    const animator = kuinetic()
    expect(animator.registry.getPrimitive('model-3d')).toBeUndefined()
    register3D(animator)
    for (const id of THREE_D_PRIMITIVE_IDS) {
      expect(animator.registry.getPrimitive(id), `primitive "${id}" is missing`).toBeTruthy()
    }
  })
})

describe('the default entry does not carry the 3D tier', () => {
  it('publishes none of the 3D exports', () => {
    for (const name of Object.keys(ThreeDBarrel)) {
      expect(RootBarrel, `"${name}" leaked into the default entry`).not.toHaveProperty(name)
    }
  })

  it('ships a catalog that knows none of the 3D primitives', () => {
    const registry = kuinetic().registry
    for (const id of THREE_D_PRIMITIVE_IDS) {
      expect(registry.getPrimitive(id), `"${id}" is reachable without importing kuinetic/3d`).toBeUndefined()
    }
  })

  it('does not collide with the CSS-transform catalog that shares its name', () => {
    // `src/effects/three-d/` is the *other* 3D: `registerThreeD`, shipping `card-flip-x`,
    // `cube-rotate` and `fold-panel` into the default entry. The two are unrelated modules with
    // confusingly similar names, and the failure mode if they ever collided is an
    // "already registered" throw on any page that opts into this tier.
    const animator = kuinetic()
    const before = animator.registry.names()
    register3D(animator)
    const added = animator.registry.names().filter((name) => !before.includes(name))
    expect(added).toEqual(MODEL_3D_PRESETS.map((preset) => preset.name))
  })
})
