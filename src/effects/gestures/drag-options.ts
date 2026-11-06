import type { PrepareContext } from '../../core/effect-context.js'
import { rubberBand } from '../../core/gesture.js'
import type { EffectParams } from '../../core/types.js'
import { watchElementSize } from '../../core/element-size.js'

type Axis = 'x' | 'y'
type Point = Record<Axis, number>
const axes: Axis[] = ['x', 'y']
const clamp = (value: number, range: number[]) => Math.max(range[0]!, Math.min(range[1]!, value))

function publishesDrag(params: EffectParams, publish: boolean): boolean {
  return publish || params.text('detents', '') !== ''
}

function nearestStop(stops: number[], value: number): number {
  return stops.reduce((best, stop) => {
    return Math.abs(stop - value) < Math.abs(best - value) ? stop : best
  }, stops[0] ?? value)
}

function periods(value: string, ctx: PrepareContext): Point {
  if (!value) return { x: 0, y: 0 }
  const parts = value.trim().split(/\s+/).map(Number)
  if (parts.length > 2 || parts.some(part => !Number.isFinite(part) || part <= 0)) {
    ctx.warn('draggable wrap needs one or two positive pixel periods, such as wrap:"320 240"')
    return { x: 0, y: 0 }
  }
  return { x: parts[0]!, y: parts[1] ?? parts[0]! }
}

function limitBox(el: Element, selector: string, ctx: PrepareContext): Element | null {
  if (!selector) return null
  if (selector === 'parent') return el.parentElement
  try { return ctx.doc.querySelector(selector) }
  catch { return null }
}

function settings(el: Element, params: EffectParams, ctx: PrepareContext) {
  const selector = params.text('limits', '')
  const box = limitBox(el, selector, ctx)
  if (selector && !box) ctx.warn('draggable limits must name an existing box selector or parent')
  const wrap = periods(params.text('wrap', ''), ctx)
  const dominant = params.is('lock', 'dominant')
  const edge = params.is('return', 'edge')
  if (edge && !box) ctx.warn('draggable return:edge needs limits')
  const enabled = !!box || dominant || wrap.x > 0 || wrap.y > 0 || edge
  return { box, wrap, dominant, enabled }
}

/** Extra reads/listeners exist only on a host opting into the round-2 drag options. */
export function dragOptions(el: Element, params: EffectParams, ctx: PrepareContext) {
  const { box, wrap, dominant, enabled } = settings(el, params, ctx)
  const publish = params.is('publish')
  const axis = params.text('axis', 'both')
  const detents = params.text('detents', '').trim().split(/\s+/).filter(Boolean).map(Number)
  const validDetents = detents.every(Number.isFinite)
  if (!validDetents) ctx.warn('draggable detents needs space-separated pixel numbers')
  const pan = axis === 'x' ? 'pan-y' : 'pan-x'
  if (enabled) ctx.style.set('touch-action', axis === 'both' ? 'pinch-zoom' : `${pan} pinch-zoom`)
  if (publishesDrag(params, publish) && axis !== 'both') ctx.style.set('touch-action', `${pan} pinch-zoom`)
  const range = { x: [-Infinity, Infinity], y: [-Infinity, Infinity] }
  const displayed = { x: 0, y: 0 }
  const reach = params.num('bounds', 0) || 80
  const resistance = params.num('resistance', 0.55)
  let changed: () => void

  function measure(): void {
    if (!box) return
    const outer = box.getBoundingClientRect()
    const host = el.getBoundingClientRect()
    const node = box as HTMLElement
    const scale = outer.width / node.offsetWidth || 1
    const scaleY = outer.height / node.offsetHeight || 1
    const left = outer.left + node.clientLeft * scale
    const top = outer.top + node.clientTop * scaleY
    const x = [(left - host.left) / scale + displayed.x, (left + node.clientWidth * scale - host.right) / scale + displayed.x]
    const y = [(top - host.top) / scaleY + displayed.y, (top + node.clientHeight * scaleY - host.bottom) / scaleY + displayed.y]
    x.sort((a, b) => a - b)
    y.sort((a, b) => a - b)
    if (axis !== 'y') range.x = x
    if (axis !== 'x') range.y = y
  }
  function project(key: Axis, value: number): number {
    if (box) {
      const boundary = clamp(value, range[key])
      return boundary + rubberBand(value - boundary, reach, resistance)
    }
    const period = wrap[key]
    return period > 0 ? ((value % period) + period) % period : value
  }
  function render(point: Point): Point {
    for (const key of axes) displayed[key] = project(key, point[key])
    return displayed
  }
  const watch = box ? watchElementSize(ctx.win, () => { measure(); changed() }) : undefined
  if (box) {
    watch!.observe(box)
    watch!.observe(el)
    measure()
  }
  return {
    publish, enabled, dominant, bounded: !!box, render, pickup: measure,
    onResize(callback: () => void) { changed = callback },
    target: (key: Axis, value: number) => {
      const stops = validDetents && (axis === 'both' || axis === key) ? detents : []
      return clamp(nearestStop(stops, value), range[key])
    },
    destroy: () => watch?.disconnect(),
  }
}
