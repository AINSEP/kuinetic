import type { PrepareContext } from '../../core/effect-context.js'
import { frameScheduler, watchElementSize } from '../../core/element-size.js'
import { toPixels } from '../../core/js-params.js'
import type { StyleLedger } from '../../core/owned-styles.js'
import type { EffectParams } from '../../core/types.js'
import { fitBounds, reachableAngles } from './fit.js'

export interface ProjectedBounds { minX: number; maxX: number; minY: number; maxY: number }
export interface HelixGeometry {
  width: number
  height: number
  radius: number
  rise: number
  count: number
  arc: number
  tilt: number
  perspective: number
  camera: boolean
}
const RAD = Math.PI / 180

/** The fade seam is centered half a place away from zero for an even circular numbering. */
export function helixCentre(count: number): number { return count % 2 === 0 ? .5 : 0 }

interface Placement { sinA: number; cosA: number; sinT: number; cosT: number; y0: number }

function projectCorner(g: HelixGeometry, p: Placement, x: number, y: number): [number, number] | undefined {
  const { sinA, cosA, sinT, cosT, y0 } = p
  const z1 = -x * sinA + g.radius * cosA
  const z = g.camera ? y0 * sinT + g.radius * cosA * cosT : (y0 + y) * sinT + z1 * cosT
  if (z >= g.perspective - 1) return undefined
  const factor = g.perspective / (g.perspective - z)
  const px = g.camera ? g.radius * sinA + x : x * cosA + g.radius * sinA
  const py = g.camera ? y0 * cosT - g.radius * cosA * sinT + y : (y0 + y) * cosT - z1 * sinT
  return [px * factor, py * factor]
}

/** Project the CSS helix's card corners across its reachable places, once per geometry change. */
export function projectHelix(g: HelixGeometry): ProjectedBounds {
  const bounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity }
  const count = Math.max(1, g.count)
  const low = Math.floor(count / 2) - count + .5
  const samples = Math.min(4096, Math.max(count * 8, Math.ceil(Math.abs(g.arc) * 4), 1))
  const sinT = Math.sin(g.tilt * RAD)
  const cosT = Math.cos(g.tilt * RAD)
  for (let i = 0; i <= samples; i++) {
    const place = low + count * i / samples
    const angle = place * g.arc / count * RAD
    const placement = { sinA: Math.sin(angle), cosA: Math.cos(angle), sinT, cosT,
      y0: (place - helixCentre(count)) * g.rise }
    for (const [cx, cy] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
      const point = projectCorner(g, placement, cx! * g.width / 2, cy! * g.height / 2)
      if (!point) return { minX: -Infinity, maxX: Infinity, minY: -Infinity, maxY: Infinity }
      bounds.minX = Math.min(bounds.minX, point[0])
      bounds.maxX = Math.max(bounds.maxX, point[0])
      bounds.minY = Math.min(bounds.minY, point[1])
      bounds.maxY = Math.max(bounds.maxY, point[1])
    }
  }
  return bounds
}

/** A shared two-dimensional scale bound; old rings retain their radius-only solver. */
export function fitProjectedBounds(bounds: ProjectedBounds, room: { left: number; right: number; height: number }): number {
  const scale = Math.min(1, room.left / Math.max(1, -bounds.minX), room.right / Math.max(1, bounds.maxX),
    room.height / (2 * Math.max(1, -bounds.minY, bounds.maxY)))
  return Math.max(0, scale)
}

function verticalRoom(el: Element, ctx: PrepareContext): number | null {
  let height = ctx.doc.documentElement.clientHeight || ctx.win.innerHeight
  for (let node = el.parentElement; node && node !== ctx.doc.body; node = node.parentElement) {
    const overflow = ctx.win.getComputedStyle(node).overflowY
    if (overflow === 'clip' || overflow === 'hidden') return null
    if (overflow === 'auto' || overflow === 'scroll') height = Math.min(height, node.clientHeight)
  }
  return height
}

export interface ShapeFitRequest { el: Element; ctx: PrepareContext; styles: StyleLedger; params: EffectParams; arc: number; tilt: number; sphere?: boolean; drum?: boolean }

/**
 * A drum's silhouette: `translateZ(-r) rotateY(t) rotateX(a) translateZ(r)` applied to each corner.
 *
 * Only the front half is sampled, because `backface-visibility: hidden` hides the rest, so the
 * reach is the cards that can actually be seen. The host's own `rotateY(t)` is the ring tilt.
 */
export function projectDrum(g: HelixGeometry): ProjectedBounds {
  const bounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity }
  const { fromDeg, toDeg } = reachableAngles(g.arc, g.count)
  const from = Math.max(-90, fromDeg), to = Math.min(90, toDeg)
  const steps = Math.max(1, Math.ceil((to - from) / .5))
  for (let i = 0; i <= steps; i++) {
    const angle = (from + (to - from) * i / steps) * RAD
    for (const [sx, sy] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
      const point = drumCorner(g, angle, sx! * g.width / 2, sy! * g.height / 2)
      if (!point) return { minX: -Infinity, maxX: Infinity, minY: -Infinity, maxY: Infinity }
      bounds.minX = Math.min(bounds.minX, point[0])
      bounds.maxX = Math.max(bounds.maxX, point[0])
      bounds.minY = Math.min(bounds.minY, point[1])
      bounds.maxY = Math.max(bounds.maxY, point[1])
    }
  }
  return bounds
}

/** A point on the card plane through rotateX(a), rotateY(t) and the pull back by the radius. */
function drumPoint(g: HelixGeometry, [x, y]: readonly [number, number], angle: number): [number, number, number] {
  const sinA = Math.sin(angle), cosA = Math.cos(angle)
  const sinT = Math.sin(g.tilt * RAD), cosT = Math.cos(g.tilt * RAD)
  const y1 = y * cosA - g.radius * sinA, z1 = y * sinA + g.radius * cosA
  return [x * cosT + z1 * sinT, y1, -x * sinT + z1 * cosT - g.radius]
}

/** One corner's projected position, or `undefined` when it reaches the camera plane. */
function drumCorner(g: HelixGeometry, angle: number, x: number, y: number): [number, number] | undefined {
  // A camera-facing card keeps only its centre on the drum; its corners are laid flat.
  const [cx, cy, cz] = drumPoint(g, [g.camera ? 0 : x, g.camera ? 0 : y], angle)
  const [px, py, pz] = g.camera ? [cx + x, cy + y, cz] : [cx, cy, cz]
  if (pz >= g.perspective - 1) return undefined
  const factor = g.perspective / (g.perspective - pz)
  return [px! * factor, py! * factor]
}

/** A sphere's silhouette is a circle at any rotation, so it needs no sampling and stays right under a second axis. */
export function projectSphere(g: HelixGeometry): ProjectedBounds {
  const reach = Math.hypot(g.radius, g.width / 2, g.height / 2)
  if (reach >= g.perspective - 1) return { minX: -Infinity, maxX: Infinity, minY: -Infinity, maxY: Infinity }
  const edge = reach * g.perspective / Math.sqrt(g.perspective ** 2 - reach ** 2)
  return { minX: -edge, maxX: edge, minY: -edge, maxY: edge }
}

/** Share of the sphere's surface the cards cover by default; more than this reads as a solid clump. */
const SPHERE_COVERAGE = .3

function derivedRadius(request: ShapeFitRequest, count: number, { width, height, gap }: { width: number; height: number; gap: number }): number {
  if (request.sphere) return Math.sqrt(count * (width + gap) * (height + gap) / (4 * Math.PI * SPHERE_COVERAGE))
  const spacing = Math.min(60, Math.max(.5, request.arc / count / 2))
  // A drum's cards stack along their height; a helix's along their width.
  return ((request.drum ? height : width) + gap) / (2 * Math.tan(spacing * RAD))
}

function helixGeometry(request: ShapeFitRequest, nodes: readonly Element[]): HelixGeometry | undefined {
  const { ctx, el, params } = request
  const boxes = nodes as readonly HTMLElement[]
  const width = Math.max(...boxes.map(node => node.offsetWidth))
  const height = Math.max(...boxes.map(node => node.offsetHeight))
  if (!(width > 0 && height > 0)) return undefined
  const basis = { viewportWidth: ctx.win.innerWidth, viewportHeight: ctx.win.innerHeight,
    percentBasis: (el as HTMLElement).offsetWidth, fontSize: parseFloat(ctx.win.getComputedStyle(el).fontSize) || 16,
    rootFontSize: parseFloat(ctx.win.getComputedStyle(ctx.doc.documentElement).fontSize) || 16 }
  const length = (name: string): number => toPixels(params.text(name), basis, NaN)
  const radius = params.text('radius') ? length('radius') : derivedRadius(request, nodes.length, { width, height, gap: length('gap') })
  const geometry = { width, height, radius, rise: length('rise'), count: nodes.length, arc: request.arc,
    tilt: -Math.min(80, Math.max(-80, request.tilt)), perspective: length('perspective'),
    camera: params.is('facing', 'camera') && nodes.every(node => !!node.firstElementChild) }
  return Object.values(geometry).some(value => typeof value === 'number' && !Number.isFinite(value)) ? undefined : geometry
}

function projectorOf(request: ShapeFitRequest): (g: HelixGeometry) => ProjectedBounds {
  if (request.sphere) return projectSphere
  return request.drum ? projectDrum : projectHelix
}

function shapeName(request: ShapeFitRequest): string {
  if (request.sphere) return 'sphere'
  return request.drum ? 'drum' : 'helix'
}

/**
 * The room a shape is scaled into, or `null` when it is left alone.
 *
 * A helix or sphere under a clipping ancestor is a composition the author cut on purpose, so it keeps
 * its size and its CSS fallback height. A drum still reserves its height there: it overflows up and
 * down, onto the page's own content, and a sideways clip on a wrapper says nothing about that. An
 * axis that is clipped is simply not fitted (unbounded room on it).
 */
function fitRoom(request: ShapeFitRequest, el: Element, horizontal: { left: number; right: number } | null,
  height: number | null): { left: number; right: number; height: number } | null {
  if (!request.drum && (!horizontal || height === null)) return null
  const box = el.getBoundingClientRect()
  const centre = box.left + box.width / 2
  return {
    left: horizontal ? centre - horizontal.left - 1 : Infinity,
    right: horizontal ? horizontal.right - centre - 1 : Infinity,
    height: height === null ? Infinity : height - 2,
  }
}

/** Observe geometry only; the moving deck never asks this solver for a frame. */
export function createHelixFit(request: ShapeFitRequest) {
  const { el, ctx, styles } = request
  let nodes: readonly Element[] = []
  let warned = false
  const publish = (geometry: HelixGeometry | undefined): void => {
    if (geometry) {
      styles.set('--kui-item-width', `${geometry.width}px`)
      styles.set('--kui-item-height', `${geometry.height}px`)
      if (request.sphere) styles.set('--kui-sphere-radius', `${geometry.radius}px`)
    }
    if (!request.sphere && !request.drum) styles.set('--kui-helix-centre', String(helixCentre(nodes.length)))
  }
  const solve = (): void => {
    const horizontal = fitBounds(el, ctx.win)
    const height = verticalRoom(el, ctx)
    const geometry = helixGeometry(request, nodes)
    publish(geometry)
    styles.set('--kui-shape-fit', '1')
    styles.set('--kui-shape-height', '')
    const room = fitRoom(request, el, horizontal, height)
    if (!room || !geometry) return
    const bounds = projectorOf(request)(geometry)
    const scale = fitProjectedBounds(bounds, room)
    if (scale === 0) {
      if (!warned) ctx.warn(`${shapeName(request)} reaches the camera plane; increase perspective or reduce radius and rise.`)
      warned = true
      return
    }
    styles.set('--kui-shape-fit', String(scale))
    styles.set('--kui-shape-height', `${2 * Math.max(-bounds.minY, bounds.maxY) * scale}px`)
  }
  const frame = frameScheduler(ctx.win, solve)
  const watch = watchElementSize(ctx.win, frame.request)
  watch.observe(el)
  watch.observe(ctx.doc.documentElement)
  return {
    render(elements: readonly Element[], count: number): void {
      if (count === nodes.length && elements.every((node, i) => node === nodes[i])) return
      for (const node of nodes) watch.unobserve(node)
      nodes = elements
      for (const node of nodes) watch.observe(node)
      solve()
    },
    release(): void { watch.disconnect(); frame.cancel() },
  }
}
