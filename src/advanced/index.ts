/**
 * kUInetic Advanced Modules
 *
 * Modular extensions outside of kUInetic core:
 * - Shared WebGL2 Shader System
 * - Interactive Particle Dissolve & Mesh Emitters
 * - Interactive Liquid Cursor Trails
 * - 3D Virtual Camera & Depth Projection
 * - Cinematic Scene & Timeline Choreography
 */

import type { Registry } from '../core/registry.js'
import type { Animator } from '../core/animator.js'

// Intentional consumer registration entrypoints & schemas
export {
  registerShaders,
  prepareShaders,
  SHADER_PARAMETERS,
  SHADERS_PRIMITIVE,
  SHADERS_PRESETS,
} from './shaders.js'

export {
  registerScenes,
  prepareScene,
  SCENE_PARAMETERS,
  SCENE_PRIMITIVES,
  SCENE_PRESETS,
  type SceneOptions,
  type StepConfig,
  type StepRecord,
  type TransitionValue,
} from './scenes.js'

export {
  registerCamera,
  prepareCameraScene,
  CAMERA_PARAMETERS,
  CAMERA_PRIMITIVES,
  CAMERA_PRESETS,
  type CameraOptions,
  type CameraLayer,
} from './camera-3d.js'

export {
  registerParticles,
  prepareParticles,
  PARTICLE_PARAMETERS,
  PARTICLE_PRIMITIVES,
  PARTICLE_PRESETS,
  type ParticleOptions,
} from './particles.js'

export {
  registerFluidCursor,
  prepareFluidCursor,
  FLUID_PARAMETERS,
  FLUID_PRIMITIVES,
  FLUID_PRESETS,
  type FluidTrailOptions,
} from './fluid-cursor.js'

export {
  registerAudio,
  prepareAudioSource,
  AUDIO_PARAMETERS,
  AUDIO_PRIMITIVES,
  AUDIO_PRESETS,
  AudioSourceController,
  type AudioBands,
  type AudioSourceOptions,
} from './audio.js'

export {
  type AdvancedEnv,
  type ResolvedEnv,
  type EffectInstanceOptions,
} from './base.js'

import { registerShaders } from './shaders.js'
import { registerScenes } from './scenes.js'
import { registerCamera } from './camera-3d.js'
import { registerParticles } from './particles.js'
import { registerFluidCursor } from './fluid-cursor.js'
import { registerAudio } from './audio.js'

/**
 * Register all advanced modules into a kUInetic Registry or Animator instance.
 */
export function registerAdvanced(target: unknown): Registry | Animator {
  registerShaders(target)
  registerScenes(target)
  registerCamera(target)
  registerParticles(target)
  registerFluidCursor(target)
  registerAudio(target)
  const t = target as { registry?: Registry | Animator } | null
  return (t?.registry || target) as Registry | Animator
}
