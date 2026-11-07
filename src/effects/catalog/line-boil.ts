import { continuousSetup, deferPrepare } from '../../core/instances.js'
import { createStyleLedger } from '../../core/owned-styles.js'
import { CHANNEL } from '../../core/types.js'
import type { EffectParams, Primitive, PrepareContext } from '../../core/types.js'
import { withTimingContract } from '../shared.js'

/** A short ring of drawings, reused the way cel animation reuses them. */
const DRAWINGS = 6

function svgNode(doc: Document, tag: string, attrs: Record<string, string>, ...children: Element[]): Element {
  const node = doc.createElementNS('http://www.w3.org/2000/svg', tag)
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value)
  node.append(...children)
  return node
}

/** One filter and one clock per setting: every host repaints on the same tick, not on its own. */
function createBoil({ doc, win }: PrepareContext, id: string, amount: number, fps: number) {
  const noise = svgNode(doc, 'feTurbulence', { type: 'fractalNoise', baseFrequency: '0.02', numOctaves: '2', seed: '1', result: 'noise' })
  // The map centres on 0.5, so a line travels at most half the scale each way.
  const shift = svgNode(doc, 'feDisplacementMap', { in: 'SourceGraphic', in2: 'noise', scale: String(amount * 2), xChannelSelector: 'R', yChannelSelector: 'G' })
  const filter = svgNode(doc, 'filter', { id, 'color-interpolation-filters': 'sRGB' }, noise, shift)
  // Sized to nothing rather than display:none, which disables the filter in some engines.
  const svg = svgNode(doc, 'svg', { width: '0', height: '0', 'aria-hidden': 'true', style: 'position:fixed' }, filter)
  doc.body.append(svg)
  const visible = new Set<Element>()
  let users = 0
  let timer: number | undefined
  let seed = 1
  const tick = (): void => {
    if (doc.hidden) return
    seed = seed % DRAWINGS + 1
    noise.setAttribute('seed', String(seed))
  }
  const sync = (): void => {
    if (visible.size) timer ??= win.setInterval(tick, 1000 / fps)
    else { win.clearInterval(timer); timer = undefined }
  }
  const Observer = (win as Window & { IntersectionObserver?: typeof IntersectionObserver }).IntersectionObserver
  const observer = Observer && new Observer((entries) => {
    for (const { target, isIntersecting } of entries) visible[isIntersecting ? 'add' : 'delete'](target)
    sync()
  })
  return {
    add(host: Element): void {
      users++
      if (observer) observer.observe(host)
      else { visible.add(host); sync() }
    },
    /** Returns whether any host still uses this filter. */
    remove(host: Element): boolean {
      visible.delete(host)
      observer?.unobserve(host)
      sync()
      if (--users) return true
      svg.remove()
      return false
    },
  }
}

const BOILS = new WeakMap<Document, Map<string, ReturnType<typeof createBoil>>>()

function prepareLineBoil(el: Element, params: EffectParams, ctx: PrepareContext) {
  const amount = params.num('amount', 3)
  const fps = params.num('fps', 10)
  const id = `kui-line-boil-${amount}-${fps}`
  const boils = BOILS.get(ctx.doc) ?? new Map<string, ReturnType<typeof createBoil>>()
  BOILS.set(ctx.doc, boils)
  const boil = boils.get(id) ?? createBoil(ctx, id, amount, fps)
  boils.set(id, boil)
  const style = createStyleLedger(el)
  style.set('filter', `url(#${id})`)
  boil.add(el)
  return continuousSetup(() => {
    if (!boil.remove(el)) boils.delete(id)
    style.restore()
  })
}

export const LINE_BOIL_PRIMITIVE: Primitive = {
  id: 'line-boil',
  renderer: 'javascript',
  channels: [CHANNEL.filter],
  parameters: {
    amount: { type: 'number', default: '3', cssProperty: '', finite: true, minimum: 0, maximum: 40 },
    fps: { type: 'number', default: '10', cssProperty: '', finite: true, minimum: 1, maximum: 30 },
  },
  supportedTimelines: ['time'],
  supportedActivations: ['load', 'enter', 'manual'],
  defaultActivation: 'load',
  reducedMotion: 'disable',
  perfClass: 'continuous',
  prepare: withTimingContract('line-boil', {
    because: 'it loops at fps: while on screen, so it has no span, delay or curve to time',
  }, deferPrepare(prepareLineBoil)),
}
