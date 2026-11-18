// @vitest-environment jsdom
// `Primitive.cycle` hooks (`every:` demonstration steps): flip-container reorders its children,
// auto-height toggles its attribute, the `*-open` family toggles open state. Cycles are state
// changes the author asked for; nothing here is restored.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DISCRETE_PRIMITIVES } from '../src/effects/catalog/discrete.js'
import { LAYOUT_PRIMITIVES } from '../src/effects/layout/primitives.js'
import type { CycleContext, EffectParams, Primitive } from '../src/core/types.js'

const ctx: CycleContext = { win: window, doc: document, warn: () => {} }
const params = (values: Record<string, string> = {}): EffectParams =>
  ({ text: (name: string, fallback = '') => values[name] ?? fallback }) as unknown as EffectParams
const primitive = (list: Primitive[], id: string): Primitive => {
  const found = list.find((p) => p.id === id)
  if (!found) throw new Error(id)
  return found
}
const html = (markup: string): Element => {
  document.body.innerHTML = markup
  return document.body.firstElementChild as Element
}

afterEach(() => vi.restoreAllMocks())

describe('flip-container cycle', () => {
  const cycle = primitive(LAYOUT_PRIMITIVES, 'flip-container').cycle!
  const ids = (el: Element) => Array.from(el.children).map((c) => c.id).join('')

  it('re-appends the same children in a new order', () => {
    const el = html('<ul><li id="a"></li><li id="b"></li><li id="c"></li></ul>')
    vi.spyOn(Math, 'random').mockReturnValue(0)
    cycle(el, params(), ctx)
    expect(ids(el)).not.toBe('abc')
    expect(ids(el).split('').sort((x, y) => x.localeCompare(y)).join('')).toBe('abc')
  })

  it('never leaves the order unchanged when the shuffle is the identity', () => {
    const el = html('<ul><li id="a"></li><li id="b"></li></ul>')
    vi.spyOn(Math, 'random').mockReturnValue(0.99)
    cycle(el, params(), ctx)
    expect(ids(el)).toBe('ba')
  })

  it('leaves a single child alone', () => {
    const el = html('<ul><li id="a"></li></ul>')
    cycle(el, params(), ctx)
    expect(ids(el)).toBe('a')
  })
})

describe('auto-height cycle', () => {
  const cycle = primitive(LAYOUT_PRIMITIVES, 'auto-height').cycle!

  it('toggles data-open by default and a custom attribute when given', () => {
    const el = html('<div></div>')
    cycle(el, params({ attribute: 'data-open' }), ctx)
    expect(el.hasAttribute('data-open')).toBe(true)
    cycle(el, params({ attribute: 'data-open' }), ctx)
    expect(el.hasAttribute('data-open')).toBe(false)
    cycle(el, params({ attribute: 'aria-expanded' }), ctx)
    expect(el.hasAttribute('aria-expanded')).toBe(true)
  })
})

describe('*-open cycle', () => {
  it('every member of the family declares the shared hook', () => {
    for (const p of DISCRETE_PRIMITIVES) expect(typeof p.cycle, p.id).toBe('function')
  })

  const cycle = primitive(DISCRETE_PRIMITIVES, 'pop-open').cycle!

  it('toggles data-open on a plain element', () => {
    const el = html('<div></div>')
    cycle(el, params(), ctx)
    expect(el.hasAttribute('data-open')).toBe(true)
    cycle(el, params(), ctx)
    expect(el.hasAttribute('data-open')).toBe(false)
  })

  it('toggles open on <details>', () => {
    const el = html('<details></details>')
    cycle(el, params(), ctx)
    expect((el as HTMLDetailsElement).open).toBe(true)
  })

  it('shows then closes a <dialog>', () => {
    const el = html('<dialog></dialog>') as HTMLDialogElement
    cycle(el, params(), ctx)
    expect(el.hasAttribute('open')).toBe(true)
    cycle(el, params(), ctx)
    expect(el.hasAttribute('open')).toBe(false)
  })

  it('calls togglePopover on a [popover]', () => {
    const el = html('<div popover></div>') as HTMLElement
    const toggle = vi.fn()
    el.togglePopover = toggle
    cycle(el, params(), ctx)
    expect(toggle).toHaveBeenCalledTimes(1)
  })
})
