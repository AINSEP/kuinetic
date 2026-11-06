import type { PrepareContext } from '../../core/effect-context.js'
import { domMeasure } from '../../core/flip.js'
import type { Box, FlipSnapshot } from '../../core/flip.js'
import { createStyleLedger } from '../../core/owned-styles.js'
import type { StyleLedger } from '../../core/owned-styles.js'
import { timeScaleOf } from '../../core/time-scale.js'
import type { Cleanup } from '../../core/types.js'

export const LEAVING = 'data-kui-leaving'
const SIDES = ['top', 'right', 'bottom', 'left']
type DepartureTiming = { durationMs: number; delayMs: number; easing?: string }

interface Departure {
  node: HTMLElement
  style: StyleLedger
  inert: boolean
  box: Box
  animation?: Animation
  timer?: number
  done: boolean
}

/** A child host may release its own writes first; never resurrect those over its restored style. */
function departureStyle(node: HTMLElement): StyleLedger {
  const written = new Map<string, string>()
  const ledger = createStyleLedger(node, (property) => node.style.getPropertyValue(property) === written.get(property) && node.style.getPropertyPriority(property) === '')
  return {
    ...ledger,
    set(property, value) {
      ledger.set(property, value)
      written.set(property, node.style.getPropertyValue(property))
      if (property === 'margin') {
        for (const side of SIDES) written.set(`margin-${side}`, node.style.getPropertyValue(`margin-${side}`))
      }
    },
  }
}

function emit(node: Element, name: string): void {
  node.dispatchEvent(new CustomEvent(name, { bubbles: true }))
}

/** Read only the running FLIP offset; the cached destination itself is never exposed to exits. */
export function interruptedSnapshot(before: FlipSnapshot, win: Window): FlipSnapshot {
  const boxes = new Map<Element, Box>()
  for (const [node, box] of before.boxes) {
    const translate = win.getComputedStyle(node).translate.split(/\s+/).map(Number.parseFloat)
    boxes.set(node, { ...box, x: box.x + (translate[0] || 0), y: box.y + (translate[1] || 0) })
  }
  return { boxes }
}

function pin(exit: Departure, host: HTMLElement): void {
  const origin = host.getBoundingClientRect()
  exit.style.set('left', `${exit.box.x - origin.left - host.clientLeft + host.scrollLeft}px`)
  exit.style.set('top', `${exit.box.y - origin.top - host.clientTop + host.scrollTop}px`)
}

function takeOut(node: HTMLElement, box: Box): Departure {
  // Capture live geometry before taking the original out of flow, never FLIP's resting cache.
  const style = departureStyle(node)
  const exit: Departure = { node, box, style, inert: node.hasAttribute('inert'), done: false }
  node.setAttribute('inert', '')
  style.set('box-sizing', 'border-box')
  style.set('width', `${box.width}px`)
  style.set('height', `${box.height}px`)
  // Claim the shorthand too; longhand-only teardown leaves a synthesized zero margin in CSSOM.
  style.claim('margin')
  for (const side of SIDES) style.claim(`margin-${side}`)
  style.set('margin', '0px')
  style.set('position', 'absolute')
  style.set('right', 'auto')
  style.set('bottom', 'auto')
  return exit
}

/** Pin an owned character at its pre-update box while its renderer closes the gap. */
export function pinDeparture(node: HTMLElement, box: Box, host: HTMLElement): void {
  pin(takeOut(node, box), host)
}

function complete(exit: Departure, win: Window): void {
  if (exit.done) return
  exit.done = true
  win.clearTimeout(exit.timer)
  // The app removes the original after this event; keep it out of flow until then.
  exit.style.set('visibility', 'hidden')
  exit.animation?.cancel()
  emit(exit.node, 'kui:leave-end')
}

function restore(exit: Departure, win: Window): void {
  win.clearTimeout(exit.timer)
  exit.animation?.cancel()
  exit.style.restore()
  if (!exit.inert) exit.node.removeAttribute('inert')
}

function start(exit: Departure, ctx: PrepareContext, timing: DepartureTiming, exits: Map<Element, Departure>): void {
  const { durationMs: duration, delayMs: delay } = timing
  const opacity = ctx.win.getComputedStyle(exit.node).opacity || '1'
  exit.animation = exit.node.animate?.([{ opacity }, { opacity: 0 }], {
    duration, delay, easing: timing.easing, fill: 'both',
  })
  if (!exit.animation) { complete(exit, ctx.win); return }
  exit.animation.playbackRate = timeScaleOf(exit.node)
  exit.timer = ctx.win.setTimeout(() => complete(exit, ctx.win), (duration + delay) / timeScaleOf(exit.node) + 50)
  void exit.animation.finished.then(() => {
    if (exits.get(exit.node) === exit) complete(exit, ctx.win)
  }, () => {})
}

/** Original direct children only; the app retains ownership of removal and focus. */
export function departures(host: HTMLElement, ctx: PrepareContext, timing: DepartureTiming): {
  hold(): void
  update(): void
  excludes(node: Element): boolean
  destroy: Cleanup
} {
  const exits = new Map<Element, Departure>()
  const instant = new Set<Element>()
  const held = new Map<Element, Box>()
  const marked = (): HTMLElement[] => ([...host.children] as HTMLElement[]).filter(
    (node) => node.hasAttribute(LEAVING) && !exits.has(node) && !instant.has(node))
  const collect = (): Departure[] => {
    const nodes = marked()
    if (ctx.reducedMotion) {
      for (const node of nodes) { instant.add(node); emit(node, 'kui:leave-end') }
      return []
    }
    const boxes = nodes.map((node) => held.get(node) ?? domMeasure(node))
    held.clear()
    return nodes.map((node, i) => {
      const exit = takeOut(node, boxes[i]!)
      exits.set(node, exit)
      return exit
    })
  }
  if (['', 'static'].includes(ctx.win.getComputedStyle(host).position)) ctx.style.set('position', 'relative')

  const release = (exit: Departure): void => { restore(exit, ctx.win); exits.delete(exit.node) }
  const update = (): void => {
    for (const node of instant) if (!node.hasAttribute(LEAVING) || node.parentElement !== host) instant.delete(node)
    for (const exit of exits.values()) {
      if (exit.node.parentElement !== host || !exit.node.hasAttribute(LEAVING)) release(exit)
      else exit.box = domMeasure(exit.node)
    }
    const added = collect()
    // Pulling rows out can move a bottom-anchored host: pin against its new origin.
    for (const exit of exits.values()) pin(exit, host)
    for (const exit of added) start(exit, ctx, timing, exits)
  }
  const displaced = (): void => {
    for (const exit of exits.values()) complete(exit, ctx.win)
  }
  ctx.win.addEventListener('scroll', displaced, true)
  ctx.win.addEventListener('resize', displaced)
  return {
    hold() { for (const node of marked()) held.set(node, domMeasure(node)) },
    update,
    excludes: (node) => exits.has(node) || instant.has(node),
    destroy() {
      ctx.win.removeEventListener('scroll', displaced, true)
      ctx.win.removeEventListener('resize', displaced)
      for (const exit of exits.values()) release(exit)
      instant.clear()
    },
  }
}
