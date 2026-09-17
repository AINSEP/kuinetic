import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  AUDIO_PARAMETERS,
  AUDIO_PRESETS,
  AUDIO_PRIMITIVES,
  AudioSourceController,
  CAMERA_PARAMETERS,
  CAMERA_PRESETS,
  CAMERA_PRIMITIVES,
  FLUID_PARAMETERS,
  FLUID_PRESETS,
  FLUID_PRIMITIVES,
  PARTICLE_PARAMETERS,
  PARTICLE_PRESETS,
  PARTICLE_PRIMITIVES,
  SCENE_PARAMETERS,
  SCENE_PRESETS,
  SCENE_PRIMITIVES,
  SHADERS_PRESETS,
  SHADERS_PRIMITIVE,
  SHADER_PARAMETERS,
  prepareAudioSource,
  prepareCameraScene,
  prepareFluidCursor,
  prepareParticles,
  prepareScene,
  prepareShaders,
  registerAdvanced,
  registerAudio,
  registerCamera,
  registerFluidCursor,
  registerParticles,
  registerScenes,
  registerShaders,
} from 'kuinetic/advanced'
import type {
  AdvancedEnv,
  AudioBands,
  AudioSourceOptions,
  CameraLayer,
  CameraOptions,
  EffectInstanceOptions,
  FluidTrailOptions,
  ParticleOptions,
  ResolvedEnv,
  SceneOptions,
  StepConfig,
  StepRecord,
  TransitionValue,
} from 'kuinetic/advanced'
import { Registry } from 'kuinetic/core'
import { kuinetic } from 'kuinetic'
import * as AdvancedBarrel from 'kuinetic/advanced'
import * as RootBarrel from 'kuinetic'

/**
 * Guards the `kuinetic/advanced` subpath.
 *
 * Like `public-api.test.ts`, these imports go through `package.json`'s `exports` map into `dist/`
 * — not through a relative `../src/` path — so the test fails if the build stops emitting the
 * subpath, if `exports` stops naming it, or if the emitted `.d.ts` goes missing. That is the whole
 * point: `src/advanced/` is only reachable to a consumer through what `npm publish` ships.
 *
 * The other half is the opposite promise: the advanced modules are opt-in, and the default entry
 * must not grow by a byte because they exist. `src/index.ts` never imports them, so the only way
 * to get them is to ask for them by subpath — asserted below against the built artifact rather
 * than against the source's import list.
 */

const ADVANCED_PRIMITIVE_IDS = [
  'shaders',
  'scene',
  'camera-scene',
  'particle-dissolve',
  'fluid-trail',
  'audio-source',
]

function allPrimitiveIds(): string[] {
  return [
    SHADERS_PRIMITIVE,
    SCENE_PRIMITIVES,
    CAMERA_PRIMITIVES,
    PARTICLE_PRIMITIVES,
    FLUID_PRIMITIVES,
    AUDIO_PRIMITIVES,
  ]
    .flat()
    .map((primitive) => primitive.id)
}

describe('kuinetic/advanced public surface', () => {
  it('exports every module registrar and preparer', () => {
    for (const fn of [registerShaders, registerScenes, registerCamera, registerParticles, registerFluidCursor, registerAudio]) {
      expect(typeof fn).toBe('function')
    }
    for (const fn of [prepareShaders, prepareScene, prepareCameraScene, prepareParticles, prepareFluidCursor, prepareAudioSource]) {
      expect(typeof fn).toBe('function')
    }
    expect(typeof registerAdvanced).toBe('function')
    expect(typeof AudioSourceController).toBe('function')
  })

  it('exports each module schema, so an author can read parameters without reaching into src', () => {
    for (const schema of [SHADER_PARAMETERS, SCENE_PARAMETERS, CAMERA_PARAMETERS, PARTICLE_PARAMETERS, FLUID_PARAMETERS, AUDIO_PARAMETERS]) {
      expect(Object.keys(schema).length).toBeGreaterThan(0)
    }
    for (const presets of [SHADERS_PRESETS, SCENE_PRESETS, CAMERA_PRESETS, PARTICLE_PRESETS, FLUID_PRESETS, AUDIO_PRESETS]) {
      expect([presets].flat().length).toBeGreaterThan(0)
    }
    // The ids are the authoring contract — a rename is a breaking change for every page that
    // spells one in `data-kui`, so name them here rather than deriving the list from itself.
    expect(allPrimitiveIds()).toEqual(ADVANCED_PRIMITIVE_IDS)
  })

  it('type-checks the authoring-contract tier', () => {
    // Compile-time guards: dropping one of these from the barrel fails `tsc --noEmit` on the
    // import above, before the assertion runs.
    expectTypeOf<AdvancedEnv>().not.toBeNever()
    expectTypeOf<ResolvedEnv>().not.toBeNever()
    expectTypeOf<EffectInstanceOptions>().not.toBeNever()
    expectTypeOf<SceneOptions>().not.toBeNever()
    expectTypeOf<StepConfig>().not.toBeNever()
    expectTypeOf<StepRecord>().not.toBeNever()
    expectTypeOf<TransitionValue>().not.toBeNever()
    expectTypeOf<CameraOptions>().not.toBeNever()
    expectTypeOf<CameraLayer>().not.toBeNever()
    expectTypeOf<ParticleOptions>().not.toBeNever()
    expectTypeOf<FluidTrailOptions>().not.toBeNever()
    expectTypeOf<AudioBands>().not.toBeNever()
    expectTypeOf<AudioSourceOptions>().not.toBeNever()
  })
})

describe('kuinetic/advanced registration', () => {
  it('registers all six primitives onto a bare Registry from kuinetic/core', () => {
    const registry = new Registry()
    // `registerInto` gates on `target instanceof Registry`. Two subpaths of one package each
    // carrying their own copy of the class would make this throw — so this line is also the
    // assertion that the split build shares one core chunk between `./core` and `./advanced`.
    registerAdvanced(registry)
    for (const id of ADVANCED_PRIMITIVE_IDS) {
      expect(registry.getPrimitive(id), `primitive "${id}" is missing`).toBeTruthy()
    }
    expect(registry.names().length).toBeGreaterThan(ADVANCED_PRIMITIVE_IDS.length)
  })

  it('registers onto an Animator built by the default entry, the documented opt-in', () => {
    const animator = kuinetic()
    expect(animator.registry.getPrimitive('shaders')).toBeUndefined()
    registerAdvanced(animator)
    for (const id of ADVANCED_PRIMITIVE_IDS) {
      expect(animator.registry.getPrimitive(id), `primitive "${id}" is missing`).toBeTruthy()
    }
  })
})

describe('the default entry does not carry the advanced modules', () => {
  it('publishes none of the advanced exports', () => {
    for (const name of Object.keys(AdvancedBarrel)) {
      expect(RootBarrel, `"${name}" leaked into the default entry`).not.toHaveProperty(name)
    }
  })

  it('ships a catalog that knows none of the advanced primitives', () => {
    const registry = kuinetic().registry
    for (const id of ADVANCED_PRIMITIVE_IDS) {
      expect(registry.getPrimitive(id), `"${id}" is reachable without importing kuinetic/advanced`).toBeUndefined()
    }
  })
})
