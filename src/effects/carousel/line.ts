import type { PrepareContext } from '../../core/effect-context.js'
import { toPixels } from '../../core/js-params.js'
import type { EffectParams } from '../../core/types.js'

export interface LineGeometry { stride: number; cycle: number; width: number; height: number }

/** Far enough that no card ever fades: a line too short to loop never recycles. */
const NO_END = 1e6

const FLATTENING: readonly (readonly [string, string])[] = [
  ['overflow', 'visible'], ['filter', 'none'], ['opacity', '1'], ['clip-path', 'none'],
]

/** Geometry is read at row measurement boundaries, never while the row moves. */
export function createLine(host: HTMLElement, params: EffectParams, ctx: PrepareContext) {
  const warned = new Set<string>()
  const warnOnce = (message: string): void => {
    if (warned.has(message)) return
    warned.add(message)
    ctx.warn(message)
  }
  const basisOf = (geometry: LineGeometry, style: CSSStyleDeclaration) => ({
    viewportWidth: ctx.win.innerWidth, viewportHeight: ctx.win.innerHeight,
    percentBasis: geometry.width, fontSize: parseFloat(style.fontSize) || 16,
    rootFontSize: parseFloat(ctx.win.getComputedStyle(ctx.doc.documentElement).fontSize) || 16,
  })
  /** @returns How far from centre a card can still paint, or 0 when the line is too short to loop. */
  return (geometry: LineGeometry): number => {
    const style = ctx.win.getComputedStyle(host)
    const basis = basisOf(geometry, style)
    const length = (name: string, fallback: number): number => toPixels(params.text(name), basis, fallback)
    const stride = Math.max(1, geometry.stride)
    const perspective = Math.max(1, length('perspective', 1600))
    const rise = length('rise', -36) / stride
    const depth = length('depth', 70) / stride
    // Recycling happens half a cycle away, and one animated step can carry a card a stride towards it.
    const end = geometry.cycle / 2 - stride
    const loops = end >= 2 * stride
    // Doubled in size here: past it a card fades rather than reach the camera.
    const near = Math.min(end, perspective / (2 * Math.abs(depth)))
    const low = depth >= 0 ? -near : -end
    const high = depth >= 0 ? end : near
    ctx.style.set('--kui-line-rise-ratio', String(rise))
    ctx.style.set('--kui-line-depth-ratio', String(depth))
    ctx.style.set('--kui-line-low', `${loops ? low : -NO_END}px`)
    ctx.style.set('--kui-line-high', `${loops ? high : NO_END}px`)
    ctx.style.set('--kui-line-fade', `${Math.max(1, Math.min(stride, near))}px`)
    ctx.style.set('--kui-line-height', `${geometry.height + geometry.width * Math.abs(rise)}px`)
    const flattening = FLATTENING.find(([property, flat]) => {
      const value = style.getPropertyValue(property)
      return value !== '' && value !== flat
    })
    if (flattening) warnOnce(`shape:line ${flattening[0]} flattens the host; move it to a wrapper.`)
    if (!loops && geometry.width > 0) warnOnce('shape:line needs at least six cards to loop; add cards or copies:auto.')
    return loops ? end : 0
  }
}
