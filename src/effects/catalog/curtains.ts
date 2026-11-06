import type { PrepareContext } from '../../core/effect-context.js'
import { watchElementSize } from '../../core/element-size.js'
import { deferPrepare } from '../../core/instances.js'
import { effectDurationMs } from '../../core/js-params.js'
import { createStyleLedger } from '../../core/owned-styles.js'
import type { Registry } from '../../core/registry.js'
import type { Cleanup, EffectParams, Primitive } from '../../core/types.js'
import { withTimingContract } from '../shared.js'
import { reserveSwap, swapOwners, resolveSwapAttribute, resolveSwapTarget, resolveSwapValues, VIEW_SWAP } from './view-transitions.js'

interface Request {
  owner: object
  attribute: string
  value: string | null
  color: string
  cover: string
  reveal: string
  scope: boolean
  x: number
  y: number
  duration: number
  committed: boolean
  onCommit: () => void
}

const coordinators = new WeakMap<Element, ReturnType<typeof coordinator>>()

function pixelGrid(panel: HTMLElement, rect: { width: number; height: number }, ctx: PrepareContext): void {
  const grid = panel.appendChild(ctx.doc.createElement('div'))
  grid.className = 'kui-curtain-pixels'
  const aspect = (rect.width || 1) / (rect.height || 1)
  const columns = Math.max(2, Math.min(24, Math.round(Math.sqrt(180 * aspect))))
  const rows = Math.max(2, Math.min(24, Math.round(columns / aspect)))
  grid.style.gridTemplateColumns = `repeat(${columns}, 1fr)`
  grid.style.gridTemplateRows = `repeat(${rows}, 1fr)`
  for (let i = 0; i < columns * rows; i++) {
    const tile = grid.appendChild(ctx.doc.createElement('span'))
    // Hash each tile independently so changing the row width cannot create a phase lattice.
    let hash = i + 1
    hash = Math.imul(hash ^ (hash >>> 16), 0x21f0aaad)
    hash = Math.imul(hash ^ (hash >>> 15), 0x735a2d97)
    const scatter = ((hash ^ (hash >>> 15)) >>> 0) / 2 ** 32
    const delay = Math.floor(i / columns) / (rows - 1) * .8 + scatter * .2
    tile.style.setProperty('--kui-pixel-delay', String(delay))
  }
}

// One panel per target; controls own registrations, never one another's requests.
// eslint-disable-next-line max-lines-per-function -- The phase callbacks share this target's owned node and cancellation state.
function coordinator(target: Element, ctx: PrepareContext) {
  const panel = ctx.doc.createElement('div')
  panel.className = 'kui-curtain-panel'
  panel.setAttribute('inert', '')
  panel.setAttribute('aria-hidden', 'true')
  for (let i = 0; i < 12; i++) {
    const piece = panel.appendChild(ctx.doc.createElement('i'))
    piece.style.setProperty('--kui-piece', String(i))
  }
  const styles = createStyleLedger(target)
  let active: Request | undefined
  let timer = 0
  let users = 0
  let stopSize: Cleanup | undefined
  const observer = new MutationObserver(() => cancel())
  const state = { version: 0, cancel }
  swapOwners.set(target, state)

  function cancel(): void {
    ctx.win.clearTimeout(timer)
    stopSize?.()
    stopSize = undefined
    panel.querySelector('.kui-curtain-pixels')?.remove()
    observer.disconnect()
    active = undefined
    panel.remove()
  }
  function commit(request: Request): void {
    if (request.committed) return
    request.committed = true
    if (request.value === null) target.removeAttribute(request.attribute)
    else target.setAttribute(request.attribute, request.value)
    request.onCommit()
    observer.takeRecords()
  }
  function finish(): void {
    if (active) commit(active)
    cancel()
  }
  function quiet(): void {
    if (ctx.doc.hidden) finish()
  }
  function geometry(request: Request): void {
    const rect = request.scope ? target.getBoundingClientRect() : { left: 0, top: 0, width: ctx.win.innerWidth, height: ctx.win.innerHeight }
    const x = request.x < 0 ? 0.5 : Math.max(0, Math.min(1, (request.x - rect.left) / (rect.width || 1)))
    const y = request.y < 0 ? 0.5 : Math.max(0, Math.min(1, (request.y - rect.top) / (rect.height || 1)))
    panel.style.setProperty('--kui-curtain-x', `${x * 100}%`)
    panel.style.setProperty('--kui-curtain-y', `${y * 100}%`)
    panel.style.setProperty('--kui-curtain-radius', `${Math.hypot(Math.max(x, 1 - x) * rect.width, Math.max(y, 1 - y) * rect.height) / (Math.hypot(rect.width, rect.height) || 1) * 141.43 + 1}%`)
    if (request.cover === 'pixels' || request.reveal === 'pixels') {
      pixelGrid(panel, rect, ctx)
      const size = () => request.scope ? [target.clientWidth, target.clientHeight] : [ctx.win.innerWidth, ctx.win.innerHeight]
      const [width, height] = size()
      const watch = watchElementSize(ctx.win, () => {
        const [nextWidth, nextHeight] = size()
        if (nextWidth !== width || nextHeight !== height) finish()
      })
      if (request.scope) watch.observe(target)
      stopSize = watch.disconnect
    }
  }
  function phase(request: Request, name: 'cover' | 'reveal'): void {
    panel.dataset.shape = request[name]
    panel.dataset.phase = name
    timer = ctx.win.setTimeout(() => {
      if (name === 'reveal') { cancel(); return }
      stopSize?.()
      commit(request)
      phase(request, 'reveal')
    }, request.duration + 34)
  }
  function mountPanel(scope: boolean): void {
    if (scope && ctx.win.getComputedStyle(target).position === 'static') styles.set('position', 'relative')
    panel.dataset.scope = String(scope)
    if (scope) panel.removeAttribute('popover')
    else panel.setAttribute('popover', 'manual')
    const container = scope ? target : ctx.doc.body
    container.appendChild(panel)
    if (!scope && typeof panel.showPopover === 'function') panel.showPopover()
  }
  function start(request: Request): void {
    active = request
    if (ctx.doc.hidden || ctx.reducedMotion || request.duration === 0) { finish(); return }
    mountPanel(request.scope)
    panel.style.setProperty('--kui-curtain-color', request.color)
    panel.style.setProperty('--kui-curtain-duration', `${request.duration}ms`)
    geometry(request)
    observer.observe(target, { attributes: true, attributeFilter: [request.attribute] })
    phase(request, 'cover')
  }
  ctx.doc.addEventListener('visibilitychange', quiet)
  return {
    pending: () => active,
    start,
    register() {
      users++
      const owner = {}
      return { owner, release() {
        if (active?.owner === owner) cancel()
        if (--users > 0) return
        cancel()
        styles.restore()
        ctx.doc.removeEventListener('visibilitychange', quiet)
        swapOwners.delete(target)
        coordinators.delete(target)
      } }
    },
  }
}

function prepareCurtain(el: Element, params: EffectParams, ctx: PrepareContext): Cleanup {
  const target = resolveSwapTarget(el, params, ctx)
  const attribute = resolveSwapAttribute(params, ctx)
  const keyed = resolveSwapValues(params, ctx, true)
  if (!target || !attribute || !keyed) return () => {}
  if (keyed.value === 'next' && keyed.values.length < 2) {
    ctx.warn('curtain value:next needs at least two values')
    return () => {}
  }
  const colors = new Map(params.text('colors', '').split(/\s+/).filter(Boolean).map(pair => {
    const at = pair.indexOf('=')
    return [pair.slice(0, at), pair.slice(at + 1)]
  }))
  let shared = coordinators.get(target)
  if (!shared) { shared = coordinator(target, ctx); coordinators.set(target, shared) }
  const control = shared.register()
  const onClick = (event: MouseEvent): void => {
    if (!target.isConnected) return
    const pending = shared.pending()
    const current = pending?.attribute === attribute ? pending.value : target.getAttribute(attribute)
    const value = destination(keyed, current)
    if (keyed.value && value === current) return
    reserveSwap(target)
    const point = params.is('origin', 'click') && event.detail > 0 ? event : { clientX: -1, clientY: -1 }
    shared.start({ owner: control.owner, attribute, value,
      onCommit: () => { if (!keyed.value && el.hasAttribute('aria-expanded')) el.setAttribute('aria-expanded', String(value !== null)) },
      color: colors.get(value ?? '') ?? params.text('color', 'var(--accent)'),
      cover: params.text('cover', 'wipe'), reveal: params.text('reveal', 'wipe'),
      scope: params.is('scope'), duration: effectDurationMs(params, 450), committed: false,
      x: point.clientX, y: point.clientY,
    })
  }
  el.addEventListener('click', onClick as EventListener)
  return () => { el.removeEventListener('click', onClick as EventListener); control.release() }
}

function destination(keyed: { value: string; values: string[] }, current: string | null): string | null {
  if (keyed.value === 'next') return keyed.values[(keyed.values.indexOf(current ?? '') + 1) % keyed.values.length]!
  return keyed.value || (current === null ? '' : null)
}

const shapes = ['wipe', 'clip-wipe', 'fade', 'iris', 'doors', 'blinds', 'stagger-wipe', 'shutter', 'pixels']
const text = (cssProperty: string) => ({ type: 'text' as const, default: '', cssProperty })
const CURTAIN: Primitive = {
  id: 'curtain', renderer: 'javascript', channels: ['view-transition-run'],
  parameters: {
    controls: VIEW_SWAP.parameters.controls!, attribute: VIEW_SWAP.parameters.attribute!,
    value: VIEW_SWAP.parameters.value!, values: VIEW_SWAP.parameters.values!,
    cover: { type: 'keyword', default: 'wipe', keywords: shapes, cssProperty: '--kui-curtain-cover' },
    reveal: { type: 'keyword', default: 'wipe', keywords: shapes, cssProperty: '--kui-curtain-reveal' },
    color: { type: 'color', default: 'var(--accent)', cssProperty: '--kui-curtain-color' },
    colors: text('--kui-curtain-colors'),
    origin: { type: 'keyword', default: 'center', keywords: ['center', 'click'], cssProperty: '--kui-curtain-origin' },
    scope: { type: 'keyword', default: 'false', keywords: ['true', 'false'], cssProperty: '--kui-curtain-scope' },
    duration: { type: 'time', default: '450ms', cssProperty: '--kui-curtain-duration' },
  },
  supportedTimelines: ['time'], supportedActivations: ['load', 'manual'], defaultActivation: 'load',
  perfClass: 'paint', reducedMotion: 'shorten',
  prepare: withTimingContract('curtain', { honours: ['duration'], because: 'each CSS cover and reveal phase uses duration' }, deferPrepare(prepareCurtain)),
}

export function registerCurtains(registry: Registry): Registry {
  return registry.registerPrimitive(CURTAIN).registerPreset({ name: 'curtain', primitive: 'curtain', phase: 'state' })
}
