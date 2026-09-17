import * as advanced from '../../../src/advanced/index.js'
import { getSharedShaderRenderer, setSharedShaderRenderer, parseColor } from '../../../src/advanced/shaders.js'
import { compileShader, createProgram } from '../../../src/advanced/gl-utils.js'
import { kuinetic } from '../../../src/index.js'
import type { EffectParams } from '../../../src/core/types.js'

export function createEffectParams(record: Record<string, unknown> = {}): EffectParams {
  return {
    text: (name: string, fallback = '') => (record[name] !== undefined ? String(record[name]) : fallback),
    ms: (name: string, fallback = 0) => (record[name] !== undefined ? Number(record[name]) : fallback),
    num: (name: string, fallback = 0) => (record[name] !== undefined ? Number(record[name]) : fallback),
    is: (name: string, value = 'true') => String(record[name] ?? '') === value,
    timing: {} as EffectParams['timing'],
  }
}

declare global {
  interface Window {
    kUIAdvanced: typeof advanced & {
      getSharedShaderRenderer: typeof getSharedShaderRenderer
      setSharedShaderRenderer: typeof setSharedShaderRenderer
      createEffectParams: typeof createEffectParams
      // Exposed only so the real-browser suite can verify GL/canvas behavior a jsdom mock cannot
      // (real shader compilation, real canvas-2D color resolution) and wire the full compiled
      // pipeline (core + advanced) for the scroll->shader progress-bridge checks. Test-only surface
      // — none of this is part of the package's public exports.
      parseColor: typeof parseColor
      compileShader: typeof compileShader
      createProgram: typeof createProgram
      kuinetic: typeof kuinetic
    }
    __kuiReady?: boolean
  }
}

window.kUIAdvanced = {
  ...advanced,
  getSharedShaderRenderer,
  setSharedShaderRenderer,
  createEffectParams,
  parseColor,
  compileShader,
  createProgram,
  kuinetic,
}
window.__kuiReady = true
