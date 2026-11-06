import { frameScheduler, watchElementSize } from '../../core/element-size.js'
import { createJsInstance } from '../../core/instances.js'
import type { Primitive } from '../../core/types.js'

const COUNTS: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7 }
const NUMBER = /[+-]?(?:\d+(?:\.\d*)?|\.\d+)/
const EXPONENT = /(?:e[+-]?\d+)?/
const TOKEN = new RegExp(`[a-df-z]|${NUMBER.source}${EXPONENT.source}`, 'gi')

function xCoordinate(command: string, slot: number): boolean {
  if (command === 'V') return false
  if (command === 'H') return true
  if (command === 'A') return slot === 5
  return slot % 2 === 0
}

function translated(command: string, index: number, firstMove: boolean): boolean {
  const upper = command.toUpperCase()
  if (upper === 'A' && (index - 1) % 7 < 2) return false
  return command === upper || (command === 'm' && firstMove && index <= 2)
}

function arcFlag(command: string, slot: number): boolean {
  return command === 'A' && slot >= 2 && slot <= 4
}

/** Uniform scaling preserves smooth controls and arc rotations/flags as authored. */
export function transformPath(path: string, scale: number, dx: number, dy: number): string {
  let command = 'M'
  let index = 0
  let firstMove = true
  const transformToken = (token: string): string => {
    if (/^[a-z]$/i.test(token)) {
      command = token
      index = 0
      return token
    }
    const upper = command.toUpperCase()
    const slot = index++ % COUNTS[upper]!
    if (arcFlag(upper, slot)) {
      if (slot > 2 && token.length > 1) return `${token[0]} ${transformToken(token.slice(1))}`
      return token
    }
    const shift = xCoordinate(upper, slot) ? dx : dy
    const value = Number(token) * scale + (translated(command, index, firstMove) ? shift : 0)
    if (upper === 'M' && index === 2) firstMove = false
    return ` ${Number(value.toFixed(5))} `
  }
  return path.replace(TOKEN, transformToken)
}

function viewBox(value: string): number[] | undefined {
  const values = value.trim().split(/[\s,]+/).map(Number)
  if (values.length === 4 && values.every(Number.isFinite) && values[2]! > 0 && values[3]! > 0) return values
  return undefined
}

function layoutOffset(node: HTMLElement): [number, number] {
  let x = 0
  let y = 0
  let current: HTMLElement | null = node
  while (current) {
    x += current.offsetLeft
    y += current.offsetTop
    current = current.offsetParent as HTMLElement | null
  }
  return [x, y]
}

const ANCHORS: Record<string, [number, number]> = {
  '0 0': [0, 0], 'top left': [0, 0], 'top right': [1, 0],
  'bottom left': [0, 1], 'bottom right': [1, 1],
  top: [0.5, 0], bottom: [0.5, 1], left: [0, 0.5], right: [1, 0.5],
  center: [0.5, 0.5], auto: [0.5, 0.5],
}

export const preparePathFit: NonNullable<Primitive['prepare']> = (el, params, ctx) => {
  const box = viewBox(params.text('viewbox'))
  const node = el as HTMLElement
  const parent = node.parentElement
  const HTMLElementCtor = (ctx.win as Window & { HTMLElement: typeof HTMLElement }).HTMLElement
  if (!box || !parent || !(el instanceof HTMLElementCtor)) {
    ctx.warn('motion-path viewbox expects four finite numbers with positive width and height and an HTML traveller with a containing element')
    return { ...createJsInstance({ activate() {}, destroy() {} }), setupOnly: true }
  }
  const path = params.text('path').replace(/^"|"$/g, '')
  const [vx, vy, vw, vh] = box as [number, number, number, number]
  const [ax, ay] = ANCHORS[params.text('anchor', '0 0')]!
  const measure = (): void => {
    const width = Math.max(0, parent.clientWidth - node.offsetWidth)
    const height = Math.max(0, parent.clientHeight - node.offsetHeight)
    const scale = Math.min(width / vw, height / vh)
    const [nx, ny] = layoutOffset(node)
    const [px, py] = layoutOffset(parent)
    const dx = (width - vw * scale) / 2 - vx * scale - (nx - px) + node.offsetWidth * ax
    const dy = (height - vh * scale) / 2 - vy * scale - (ny - py) + node.offsetHeight * ay
    ctx.style.set('--kui-motion-path', `"${transformPath(path, scale, dx, dy)}"`)
  }
  measure()
  const frame = frameScheduler(ctx.win, measure)
  const watch = watchElementSize(ctx.win, frame.request)
  watch.observe(parent)
  watch.observe(node)
  return { ...createJsInstance({
    activate() {},
    destroy() { frame.cancel(); watch.disconnect() },
  }), setupOnly: true }
}
