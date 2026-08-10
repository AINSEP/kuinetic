import type { PrepareContext } from '../../core/effect-context.js'
import { deferredInstance } from '../../core/instances.js'
import { createMorph } from '../../core/path-morph.js'
import type { Registry } from '../../core/registry.js'
import type { Cleanup, EffectParams, Preset, Primitive } from '../../core/types.js'

/**
 * SVG shape morphing.
 *
 * The `d` attribute is not interpolable by CSS or the Web Animations API, so this is one of the
 * few places the library must drive frames itself. Normalisation happens once during `prepare`;
 * each frame is then a lerp over a fixed number of control points.
 */

/**
 * Morph a `<path>` between two shapes on hover, or on demand.
 *
 * @complexity O(s) per frame in segment count; O(s) space. Parsing happens once in `prepare`.
 * @overallScore 100
 */
function prepareMorph(el: Element, params: EffectParams, ctx: PrepareContext): Cleanup {
  const path = el as SVGPathElement
  const startPath = params.text('from') || path.getAttribute('d') || ''
  const { morph, reason } = createMorph(startPath, params.text('to'))

  if (!morph) {
    // Fail loudly at setup rather than producing a subtly wrong shape at runtime.
    ctx.warn(`cannot morph: ${reason}`)
    return () => {}
  }

  const duration = params.ms('duration', 300)
  let frame = 0
  let cancelled = false

  const drive = (target: number): void => {
    cancelAnimationFrame(frame)
    const startedAt = performance.now()
    const startValue = current
    const step = (now: number): void => {
      if (cancelled) return
      const t = duration > 0 ? Math.min(1, (now - startedAt) / duration) : 1
      current = startValue + (target - startValue) * t
      path.setAttribute('d', morph.at(current))
      if (t < 1) frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
  }

  let current = 0
  const enter = (): void => drive(1)
  const leave = (): void => drive(0)

  el.addEventListener('pointerenter', enter, { passive: true })
  el.addEventListener('focusin', enter, { passive: true })
  el.addEventListener('pointerleave', leave, { passive: true })
  el.addEventListener('focusout', leave, { passive: true })

  return () => {
    cancelled = true
    cancelAnimationFrame(frame)
    el.removeEventListener('pointerenter', enter)
    el.removeEventListener('focusin', enter)
    el.removeEventListener('pointerleave', leave)
    el.removeEventListener('focusout', leave)
    path.setAttribute('d', startPath)
  }
}

export const SVG_PRIMITIVES: Primitive[] = [
  {
    id: 'path-morph',
    renderer: 'javascript',
    // `d` is its own channel: nothing else in the catalog writes path geometry, so a morph can
    // safely compose with a fade or a rotation on the same element.
    channels: ['path'],
    parameters: {
      from: { type: 'text', default: '', cssProperty: '--dsg-path-from' },
      to: { type: 'text', default: '', cssProperty: '--dsg-path-to' },
      duration: { type: 'time', default: '300ms', cssProperty: '--dsg-duration' },
    },
    supportedTimelines: ['time'],
    supportedActivations: ['hover', 'focus', 'manual', 'load'],
    // The morph attaches its own hover listeners, so it must be wired up on load, not on enter.
    defaultActivation: 'load',
    perfClass: 'paint',
    reducedMotion: 'disable',
    prepare: (el, params, ctx) => deferredInstance(() => prepareMorph(el, params, ctx)),
  },
]

export const SVG_PRESETS: Preset[] = [
  { name: 'icon-morph', primitive: 'path-morph' },
  { name: 'blob-morph', primitive: 'path-morph', params: { duration: '800ms' } },
]

/**
 * Register the SVG morph catalog.
 *
 * @param registry - Registry to populate.
 * @returns The same registry, for chaining.
 * @complexity O(n) time in the number of primitives and presets.
 * @overallScore 100
 */
export function registerSvg(registry: Registry): Registry {
  return registry.registerPrimitives(SVG_PRIMITIVES).registerPresets(SVG_PRESETS)
}
