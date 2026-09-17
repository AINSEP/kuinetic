import * as advanced from '../../../src/advanced/index.js'
import { getSharedShaderRenderer, setSharedShaderRenderer, parseColor } from '../../../src/advanced/shaders.js'
import { compileShader, createProgram } from '../../../src/advanced/gl-utils.js'
import { kuinetic } from '../../../src/index.js'
import type { EffectParams } from '../../../src/core/types.js'

/**
 * A hand-built `EffectParams` for the blocks that call `prepareShaders` directly.
 *
 * It satisfies the interface and nothing more. `resolveParams` is what a real activation puts in
 * front of a primitive, and this is not it: no schema lookup, no `ParamSpec` default, no clamping
 * to a `minimum`/`maximum`, no keyword validation — `num()` is a bare `Number()` over whatever the
 * caller passed, so a value the real pipeline would have rejected or clamped arrives untouched.
 * Whatever these blocks prove about the shader modules, they prove nothing about the parameter
 * layer above them; block 9 is the only one here that drives the real `data-kui` → compile →
 * prepare path, and it is worth saying so rather than reading eight green blocks as end-to-end.
 *
 * `keyword` is absent because `EffectParams` has no such member (`src/core/types.ts`). That makes
 * `extractShaderOptions`'s `'keyword' in params` branch unreachable from both tiers — it is
 * reachable only from the unit suite's own doubles, which do declare one.
 */
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
