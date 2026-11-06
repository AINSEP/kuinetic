// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { compile } from '../src/core/compile.js'
import { parse } from '../src/core/parse.js'
import { createParams } from '../src/core/js-params.js'
import { defaultCapabilities } from '../src/core/capabilities.js'
import { createStyleLedger } from '../src/core/owned-styles.js'
import type { PrepareContext } from '../src/core/effect-context.js'
import type { EffectInstance } from '../src/core/types.js'
import { catalogRegistry } from './support/registry.js'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ruleBodies } from './support/css-scan.js'

const registry = catalogRegistry()
const examples = [
  'curtain attribute:data-scene value:two values:"one two three" cover:blinds reveal:blinds',
  'curtain attribute:data-scene value:two values:"one two three" cover:clip-wipe reveal:clip-wipe',
  'curtain attribute:data-scene value:two values:"one two three" cover:doors reveal:doors',
  'curtain attribute:data-scene value:two values:"one two three" cover:fade reveal:fade',
  'curtain attribute:data-scene value:two values:"one two three" cover:iris reveal:iris',
  'curtain attribute:data-scene value:next values:"one two three" cover:iris reveal:iris origin:click colors:"one=var(--accent) two=var(--secondary) three=var(--accent)"',
  'curtain attribute:data-scene value:two values:"one two three" cover:wipe reveal:iris',
  'curtain attribute:data-scene value:two values:"one two three" scope:true',
  'curtain attribute:data-scene value:two values:"one two three" cover:stagger-wipe reveal:stagger-wipe',
  'curtain attribute:data-scene value:two values:"one two three"',
  'curtain attribute:data-scene value:two values:"one two three" cover:shutter reveal:shutter',
  'curtain, fade-up on:enter',
  'curtain attribute:data-scene value:next values:"one two three" cover:pixels reveal:pixels scope:true',
  'curtain controls:#scene attribute:data-scene value:two cover:pixels reveal:pixels',
  'curtain cover:wipe reveal:pixels, fade-up on:enter',
  'curtain cover:pixels reveal:iris',
]
let instances: EffectInstance[] = []
let reduced = false
const panel = () => document.querySelector<HTMLElement>('.kui-curtain-panel')!
const target = () => document.querySelector<HTMLElement>('#scene')!
function mount(values: Record<string, string> = {}, name = 'curtain', reduce = false) {
  const button = document.body.appendChild(document.createElement('button'))
  button.setAttribute('aria-controls', 'scene')
  const warn = vi.fn()
  const ctx = { win: window, doc: document, warn, reducedMotion: reduce,
    capabilities: defaultCapabilities({ viewTransitions: true }), signal: new AbortController().signal,
    style: createStyleLedger(button),
  } as unknown as PrepareContext
  const instance = registry.resolve(name)!.primitive.prepare!(button, createParams({ attribute: 'data-scene', value: 'two', values: 'one two three', duration: '100ms', ...values }), ctx)
  instances.push(instance)
  instance.activate()
  return { button, instance, warn, ctx }
}
beforeEach(() => {
  vi.useFakeTimers()
  document.body.innerHTML = '<section id="scene" data-scene="one" style="position:relative;border-radius:12px"></section>'
  reduced = false
  vi.stubGlobal('matchMedia', () => ({ get matches() { return reduced }, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
})
afterEach(() => {
  instances.forEach(instance => instance.destroy())
  instances = []
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  delete (document as { startViewTransition?: unknown }).startViewTransition
  document.body.innerHTML = ''
})

describe('colour curtain lifecycle', () => {
  it.each([
    ['pixels', 'pixels'], ['wipe', 'pixels'], ['pixels', 'iris'],
  ])('keeps one lifecycle and one commit for %s to %s', (cover, reveal) => {
    const plan = compile(parse(`curtain cover:${cover} reveal:${reveal}`), registry, 'time')
    expect(plan.warnings).toEqual([])
    const { button } = mount(plan.jsEffects[0]!.spec.params)
    const write = vi.spyOn(target(), 'setAttribute')
    button.click()
    const grid = panel().querySelector('.kui-curtain-pixels')!
    expect(grid.children.length).toBeGreaterThan(100)
    expect(grid.children.length).toBeLessThanOrEqual(576)
    expect(panel().querySelectorAll(':scope > i')).toHaveLength(12)
    expect(panel().dataset.shape).toBe(cover)
    vi.advanceTimersByTime(134)
    expect(target().dataset.scene).toBe('two')
    expect(panel().dataset.shape).toBe(reveal)
    vi.advanceTimersByTime(134)
    expect(panel()).toBeNull()
    expect(write).toHaveBeenCalledOnce()
  })

  it('sizes portrait tiles once per request, ignores unchanged size, then finishes on resize', () => {
    let height = 360
    const rect = vi.spyOn(target(), 'getBoundingClientRect').mockImplementation(() => ({ width: 180, height, left: 0, top: 0 }) as DOMRect)
    vi.spyOn(target(), 'clientWidth', 'get').mockReturnValue(180)
    const layout = vi.spyOn(target(), 'clientHeight', 'get').mockImplementation(() => height)
    const { button, instance } = mount({ cover: 'pixels', reveal: 'pixels', scope: 'true' })
    button.click()
    const grid = panel().querySelector<HTMLElement>('.kui-curtain-pixels')!
    expect(grid.style.gridTemplateColumns).toBe('repeat(9, 1fr)')
    expect(grid.style.gridTemplateRows).toBe('repeat(18, 1fr)')
    expect(rect).toHaveBeenCalledOnce()
    window.dispatchEvent(new Event('resize'))
    expect(target().dataset.scene).toBe('one')
    height = 400
    window.dispatchEvent(new Event('resize'))
    expect(target().dataset.scene).toBe('two')
    expect(panel()).toBeNull()
    instance.destroy()
    layout.mockClear()
    window.dispatchEvent(new Event('resize'))
    expect(layout).not.toHaveBeenCalled()
  })

  it('ignores transformed box changes on the initial ResizeObserver notification', () => {
    const notifications: Array<() => void> = []
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { notifications.push(callback) }
      observe = vi.fn()
      disconnect = vi.fn()
    })
    const rect = vi.spyOn(target(), 'getBoundingClientRect').mockReturnValue({ width: 180, height: 360, left: 0, top: 0 } as DOMRect)
    vi.spyOn(target(), 'clientWidth', 'get').mockReturnValue(180)
    const height = vi.spyOn(target(), 'clientHeight', 'get').mockReturnValue(360)
    mount({ cover: 'pixels', scope: 'true' }).button.click()
    rect.mockReturnValue({ width: 360, height: 720, left: 0, top: 0 } as DOMRect)
    notifications[0]!()
    expect(panel().dataset.phase).toBe('cover')
    expect(target().dataset.scene).toBe('one')
    expect(rect).toHaveBeenCalledOnce()
    height.mockReturnValue(400)
    notifications[0]!()
    expect(target().dataset.scene).toBe('two')
    expect(panel()).toBeNull()
  })

  it('preserves reveal when the committed scene resizes the scope', () => {
    vi.spyOn(target(), 'getBoundingClientRect').mockReturnValue({ width: 180, height: 360, left: 0, top: 0 } as DOMRect)
    vi.spyOn(target(), 'clientWidth', 'get').mockReturnValue(180)
    vi.spyOn(target(), 'clientHeight', 'get').mockImplementation(() => target().dataset.scene === 'one' ? 360 : 400)
    mount({ cover: 'pixels', reveal: 'pixels', scope: 'true' }).button.click()
    const node = panel()
    vi.advanceTimersByTime(134)
    expect(target().dataset.scene).toBe('two')
    window.dispatchEvent(new Event('resize'))
    expect(panel()).toBe(node)
    expect(node.dataset.phase).toBe('reveal')
    vi.advanceTimersByTime(134)
    expect(panel()).toBeNull()
  })

  it('caps a very tall scope at two columns and twenty-four rows', () => {
    vi.spyOn(target(), 'getBoundingClientRect').mockReturnValue({ width: 10, height: 4000, left: 0, top: 0 } as DOMRect)
    mount({ cover: 'pixels', scope: 'true' }).button.click()
    const grid = panel().querySelector<HTMLElement>('.kui-curtain-pixels')!
    expect(grid.style.gridTemplateColumns).toBe('repeat(2, 1fr)')
    expect(grid.style.gridTemplateRows).toBe('repeat(24, 1fr)')
    expect(grid.children).toHaveLength(48)
  })

  it.each(Array.from({ length: 23 }, (_, index) => index + 2))('sweeps down with nonuniform bounded scatter at %s columns in both phases', columns => {
    vi.spyOn(target(), 'getBoundingClientRect').mockReturnValue({ width: columns ** 2 * 100, height: 18000, left: 0, top: 0 } as DOMRect)
    mount({ cover: 'pixels', reveal: 'pixels', scope: 'true' }).button.click()
    const grid = panel().querySelector<HTMLElement>('.kui-curtain-pixels')!
    expect(grid.style.gridTemplateColumns).toBe(`repeat(${columns}, 1fr)`)
    const delays = [...grid.children].map(tile => Number((tile as HTMLElement).style.getPropertyValue('--kui-pixel-delay')))
    const rows = delays.length / columns
    const average = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length
    expect(average(delays.slice(0, columns)) + .5).toBeLessThan(average(delays.slice(-columns)))
    expect(delays.every(delay => delay >= 0 && delay < 1)).toBe(true)
    expect(delays.every(delay => .65 + delay * .35 <= 1)).toBe(true)
    const neighbourDifferences = new Set<number>()
    for (let row = 0; row < rows; row++) {
      const values = delays.slice(row * columns, (row + 1) * columns)
      expect(new Set(values).size).toBe(columns)
      neighbourDifferences.add(Math.round((values[1]! - values[0]!) * 1e6))
    }
    expect(neighbourDifferences.size).toBeGreaterThan(3)
    vi.advanceTimersByTime(134)
    expect(panel().dataset.phase).toBe('reveal')
    expect([...grid.children].map(tile => Number((tile as HTMLElement).style.getPropertyValue('--kui-pixel-delay')))).toEqual(delays)
  })

  it('keeps the pixel grid visible, strips hidden, and both staggered fades inside the phase', () => {
    const css = readFileSync('src/css/curtains.css', 'utf8')
    const grid = ruleBodies(css, ".kui-curtain-panel[data-shape='pixels'] > .kui-curtain-pixels").join(' ')
    expect(ruleBodies(css, '.kui-curtain-pixels').join(' ')).toContain('display: none;')
    expect(grid).toContain('display: grid;')
    expect(grid).toContain('position: absolute;')
    expect(grid).toContain('inset: 0;')
    expect(ruleBodies(css, ".kui-curtain-panel[data-shape='pixels'] > i").join(' ')).toContain('display: none;')
    const tiles = ruleBodies(css, '.kui-curtain-pixels > span').join(' ')
    expect(tiles).toContain('background: currentColor;')
    expect(tiles).toContain('animation: kui-page-fade calc(var(--kui-curtain-duration) * .65) linear both;')
    expect(tiles).toContain('animation-delay: calc(var(--kui-pixel-delay) * var(--kui-curtain-duration) * .35);')
    expect(ruleBodies(css, ".kui-curtain-panel[data-phase='reveal'] > .kui-curtain-pixels > span").join(' ')).toContain('animation-name: kui-panel-fade-out;')
  })

  it('cancels pixel requests, replays deterministic tiles and keeps plain strips free of pixel work', () => {
    const a = mount({ cover: 'pixels', reveal: 'pixels' })
    a.button.click()
    const delays = [...panel().querySelectorAll<HTMLElement>('.kui-curtain-pixels > span')].map(tile => tile.style.cssText)
    a.instance.destroy()
    vi.advanceTimersByTime(1000)
    expect(target().dataset.scene).toBe('one')
    mount({ cover: 'pixels' }).button.click()
    expect([...panel().querySelectorAll<HTMLElement>('.kui-curtain-pixels > span')].map(tile => tile.style.cssText)).toEqual(delays)
    const plain = mount({ value: 'three' })
    plain.button.click()
    expect(panel().children).toHaveLength(12)
    expect(panel().style.cssText).not.toContain('--kui-pixel')
    window.dispatchEvent(new Event('resize'))
    expect(target().dataset.scene).toBe('one')
    vi.advanceTimersByTime(268)
    expect(target().dataset.scene).toBe('three')
  })

  it('bounds empty pixel scopes and finishes fullscreen resize and reduced motion', () => {
    vi.spyOn(target(), 'getBoundingClientRect').mockReturnValue({ width: 0, height: 0, left: 0, top: 0 } as DOMRect)
    const a = mount({ cover: 'pixels', scope: 'true' })
    a.button.click()
    expect(panel().innerHTML).not.toMatch(/NaN|Infinity/)
    a.instance.destroy()
    const b = mount({ cover: 'pixels' })
    b.button.click()
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(390)
    window.dispatchEvent(new Event('resize'))
    expect(target().dataset.scene).toBe('two')
    expect(panel()).toBeNull()
    b.instance.destroy()
    mount({ cover: 'pixels', value: 'three' }, 'curtain', true).button.click()
    expect(target().dataset.scene).toBe('three')
    expect(panel()).toBeNull()
  })

  it.each(examples)('compiles and prepares without warnings: %s', source => {
    const plan = compile(parse(source), registry, 'time')
    expect(plan.warnings).toEqual([])
    const { warn } = mount(plan.jsEffects[0]!.spec.params)
    expect(warn).not.toHaveBeenCalled()
  })
  it('keeps state until full cover, commits once, then reveals; ignores child events', () => {
    const { button } = mount()
    const write = vi.spyOn(target(), 'setAttribute')
    button.click()
    const node = panel()
    expect(node.hasAttribute('inert')).toBe(true)
    node.firstElementChild!.dispatchEvent(new Event('animationend', { bubbles: true }))
    vi.advanceTimersByTime(133)
    expect(target().dataset.scene).toBe('one')
    vi.advanceTimersByTime(1)
    expect(target().dataset.scene).toBe('two')
    expect(node.dataset.phase).toBe('reveal')
    vi.advanceTimersByTime(134)
    expect(node.isConnected).toBe(false)
    expect(write.mock.calls.filter(call => call[0] === 'data-scene')).toHaveLength(1)
  })
  it('shares pieces, latest cover wins, sibling teardown leaves the active owner intact', () => {
    const first = mount()
    const second = mount({ value: 'three' })
    first.button.click()
    const pieces = [...panel().children]
    vi.advanceTimersByTime(50)
    second.button.click()
    first.instance.destroy()
    expect(document.querySelectorAll('.kui-curtain-panel')).toHaveLength(1)
    expect([...panel().children]).toEqual(pieces)
    vi.advanceTimersByTime(134)
    expect(target().dataset.scene).toBe('three')
  })
  it('restarts during reveal without rolling the committed state back', () => {
    const a = mount()
    const b = mount({ value: 'three' })
    a.button.click()
    vi.advanceTimersByTime(134)
    b.button.click()
    expect(target().dataset.scene).toBe('two')
    vi.advanceTimersByTime(134)
    expect(target().dataset.scene).toBe('three')
  })
  it('advances the pending destination and snapshots the mapped colour', () => {
    const { button } = mount({ value: 'next', colors: 'two=var(--secondary) three=var(--accent)' })
    button.click()
    expect(panel().style.getPropertyValue('--kui-curtain-color')).toBe('var(--secondary)')
    button.click()
    expect(panel().style.getPropertyValue('--kui-curtain-color')).toBe('var(--accent)')
    vi.advanceTimersByTime(134)
    expect(target().dataset.scene).toBe('three')
    button.click()
    vi.advanceTimersByTime(134)
    expect(target().dataset.scene).toBe('one')
  })
  it('cancels owned pending writes, retains foreign nodes, and supports replay', () => {
    const foreign = target().appendChild(document.createElement('b'))
    const a = mount()
    a.button.click()
    a.instance.destroy()
    vi.advanceTimersByTime(1000)
    expect(target().dataset.scene).toBe('one')
    expect(foreign.isConnected).toBe(true)
    expect(panel()).toBeNull()
    mount().button.click()
    vi.advanceTimersByTime(134)
    expect(target().dataset.scene).toBe('two')
  })
  it('uses the effective reduced-motion policy rather than overriding it with matchMedia', () => {
    reduced = false
    const a = mount({}, 'curtain', true)
    a.button.click()
    expect(target().dataset.scene).toBe('two')
    a.instance.destroy()
    reduced = true
    const b = mount({ value: 'three' })
    b.button.click()
    expect(target().dataset.scene).toBe('two')
    vi.advanceTimersByTime(134)
    expect(target().dataset.scene).toBe('three')
    vi.advanceTimersByTime(1000)
    expect(panel()).toBeNull()
  })
  it('commits hidden-tab finish states without a frame or timer', () => {
    const { button } = mount()
    button.click()
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    document.dispatchEvent(new Event('visibilitychange'))
    expect(target().dataset.scene).toBe('two')
    expect(panel()).toBeNull()
    hidden.mockRestore()
  })
  it('keeps scope local and uses centre for keyboard clicks and clamped pointer origins', () => {
    vi.spyOn(target(), 'getBoundingClientRect').mockReturnValue({ left: 10, top: 20, width: 100, height: 80 } as DOMRect)
    const { button } = mount({ value: 'next', scope: 'true', origin: 'click', cover: 'iris' })
    button.click()
    expect(panel().parentElement).toBe(target())
    expect(panel().hasAttribute('popover')).toBe(false)
    expect(panel().style.getPropertyValue('--kui-curtain-x')).toBe('50%')
    button.dispatchEvent(new MouseEvent('click', { detail: 1, clientX: 500, clientY: 0 }))
    expect(panel().style.getPropertyValue('--kui-curtain-x')).toBe('100%')
    expect(panel().style.getPropertyValue('--kui-curtain-y')).toBe('0%')
  })
  it('lets view-swap interrupt cover and guards deferred VT callbacks against a later curtain', () => {
    let update: () => void = () => {}
    ;(document as { startViewTransition?: unknown }).startViewTransition = (cb: () => void) => { update = cb; return {} }
    const a = mount()
    const b = mount({ value: 'three' }, 'view-swap')
    a.button.click()
    b.button.click()
    expect(panel()).toBeNull()
    a.button.click()
    update()
    expect(target().dataset.scene).toBe('one')
    vi.advanceTimersByTime(134)
    expect(target().dataset.scene).toBe('two')
  })
  it('external writes cancel a pending commit', async () => {
    mount().button.click()
    target().setAttribute('data-scene', 'three')
    await Promise.resolve()
    vi.advanceTimersByTime(1000)
    expect(target().dataset.scene).toBe('three')
    expect(panel()).toBeNull()
  })
  it('a view-swap selecting the already committed value still cancels a pending curtain', () => {
    const a = mount()
    const b = mount({ value: 'one' }, 'view-swap')
    a.button.click()
    b.button.click()
    vi.advanceTimersByTime(1000)
    expect(target().dataset.scene).toBe('one')
    expect(panel()).toBeNull()
  })
})

describe('review regressions and lifecycle boundaries', () => {
  it('does nothing for the committed tab and does not restart an identical pending cover', () => {
    const write = vi.spyOn(target(), 'setAttribute')
    mount({ value: 'one' }).button.click()
    expect(panel()).toBeNull()
    expect(write).not.toHaveBeenCalled()
    const a = mount()
    a.button.click()
    const pieces = [...panel().children]
    vi.advanceTimersByTime(50)
    a.button.click()
    vi.advanceTimersByTime(84)
    expect(target().dataset.scene).toBe('two')
    expect([...panel().children]).toEqual(pieces)
    expect(write.mock.calls.filter(([key]) => key === 'data-scene')).toHaveLength(1)
  })

  it.each(['hide', 'teardown'])('retains a deferred view-swap update on curtain %s with no active curtain', action => {
    let update = () => {}
    ;(document as { startViewTransition?: unknown }).startViewTransition = (cb: () => void) => { update = cb; return {} }
    const a = mount()
    mount({}, 'view-swap').button.click()
    if (action === 'hide') {
      vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
      document.dispatchEvent(new Event('visibilitychange'))
    } else a.instance.destroy()
    update()
    expect(target().dataset.scene).toBe('two')
  })

  it('keeps its reveal alive after its own mutation and never commits twice when hidden during reveal', async () => {
    const write = vi.spyOn(target(), 'setAttribute')
    mount().button.click()
    const node = panel()
    vi.advanceTimersByTime(134)
    await Promise.resolve()
    expect(node.isConnected).toBe(true)
    expect(node.dataset.phase).toBe('reveal')
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    document.dispatchEvent(new Event('visibilitychange'))
    expect(write.mock.calls.filter(([key]) => key === 'data-scene')).toHaveLength(1)
    expect(panel()).toBeNull()
  })

  it('restores a static scope, removes only its own children, and unregisters visibility cleanup', () => {
    target().style.position = 'static'
    const foreign = target().appendChild(document.createElement('b'))
    const add = vi.spyOn(document, 'addEventListener')
    const remove = vi.spyOn(document, 'removeEventListener')
    const a = mount({ scope: 'true' })
    a.button.click()
    expect(target().style.position).toBe('relative')
    vi.advanceTimersByTime(268)
    expect([...target().children]).toEqual([foreign])
    a.instance.destroy()
    expect(target().style.position).toBe('static')
    const listener = add.mock.calls.find(([type]) => type === 'visibilitychange')![1]
    expect(remove).toHaveBeenCalledWith('visibilitychange', listener)
    const write = vi.spyOn(target(), 'setAttribute')
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    document.dispatchEvent(new Event('visibilitychange'))
    vi.advanceTimersByTime(1000)
    expect(write).not.toHaveBeenCalled()
  })

  it.each(['hidden', 'zero duration', 'reduced motion'])('commits exactly once for %s, then permits a normal replay with no idle node', mode => {
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(mode === 'hidden')
    const a = mount({ duration: mode === 'zero duration' ? '0ms' : '100ms' }, 'curtain', mode === 'reduced motion')
    const write = vi.spyOn(target(), 'setAttribute')
    a.button.click()
    expect(target().dataset.scene).toBe('two')
    expect(panel()).toBeNull()
    vi.advanceTimersByTime(1000)
    expect(write).toHaveBeenCalledOnce()
    a.instance.destroy()
    hidden.mockReturnValue(false)
    mount({ value: 'three' }).button.click()
    vi.advanceTimersByTime(268)
    expect(target().dataset.scene).toBe('three')
    expect(panel()).toBeNull()
  })

  it.each([
    { controls: 'body' }, { controls: '#missing' }, { controls: '[' },
    { attribute: 'bad name' }, { value: 'absent' }, { value: 'next', values: 'one' },
  ] as Record<string, string>[])('rejects invalid configuration without poisoning later valid setup: %j', config => {
    const a = mount(config)
    a.button.click()
    expect(a.warn).toHaveBeenCalledOnce()
    expect(target().dataset.scene).toBe('one')
    expect(panel()).toBeNull()
    a.instance.destroy()
    mount().button.click()
    vi.advanceTimersByTime(268)
    expect(target().dataset.scene).toBe('two')
    expect(panel()).toBeNull()
  })

  it('toggles the target and existing aria-expanded together, without inventing aria state', () => {
    const a = mount({ attribute: 'data-open', value: '', values: '' })
    a.button.setAttribute('aria-expanded', 'false')
    a.button.click()
    vi.advanceTimersByTime(134)
    expect(target().hasAttribute('data-open')).toBe(true)
    expect(a.button.getAttribute('aria-expanded')).toBe('true')
    vi.advanceTimersByTime(134)
    a.button.click()
    vi.advanceTimersByTime(268)
    expect(target().hasAttribute('data-open')).toBe(false)
    expect(a.button.getAttribute('aria-expanded')).toBe('false')
    const b = mount({ attribute: 'data-open', value: '', values: '' })
    b.button.click()
    vi.advanceTimersByTime(268)
    expect(b.button.hasAttribute('aria-expanded')).toBe(false)
    expect(panel()).toBeNull()
  })

  it('starts next at the first listed value when no state attribute exists', () => {
    target().removeAttribute('data-scene')
    mount({ value: 'next' }).button.click()
    vi.advanceTimersByTime(268)
    expect(target().dataset.scene).toBe('one')
    expect(panel()).toBeNull()
  })

  it('ignores activation after the controlled target has been removed', () => {
    const a = mount()
    const node = target()
    node.remove()
    const write = vi.spyOn(node, 'setAttribute')
    a.button.click()
    vi.advanceTimersByTime(1000)
    expect(panel()).toBeNull()
    expect(write).not.toHaveBeenCalled()
  })

  it('keeps the scoped iris radius and click origin invariant under uniform scale', () => {
    const rect = vi.spyOn(target(), 'getBoundingClientRect')
    const a = mount({ value: 'next', scope: 'true', origin: 'click', cover: 'iris', reveal: 'iris' })
    rect.mockReturnValue({ left: 10, top: 20, width: 200, height: 100 } as DOMRect)
    a.button.dispatchEvent(new MouseEvent('click', { detail: 1, clientX: 210, clientY: 20 }))
    const radius = panel().style.getPropertyValue('--kui-curtain-radius')
    expect(panel().style.getPropertyValue('--kui-curtain-x')).toBe('100%')
    expect(panel().style.getPropertyValue('--kui-curtain-y')).toBe('0%')
    expect(Number.parseFloat(radius)).toBeGreaterThan(141.42)
    rect.mockReturnValue({ left: 10, top: 20, width: 100, height: 50 } as DOMRect)
    a.button.dispatchEvent(new MouseEvent('click', { detail: 1, clientX: 110, clientY: 20 }))
    expect(panel().style.getPropertyValue('--kui-curtain-radius')).toBe(radius)
  })

  it('mounts fullscreen decoration in the popover top layer and removes it after reveal', () => {
    const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'showPopover')
    const show = vi.fn()
    Object.defineProperty(HTMLElement.prototype, 'showPopover', { configurable: true, value: show })
    try {
      mount().button.click()
      expect(show).toHaveBeenCalledOnce()
      expect(panel().getAttribute('popover')).toBe('manual')
      expect(panel().getAttribute('inert')).toBe('')
      vi.advanceTimersByTime(268)
      expect(panel()).toBeNull()
    } finally {
      if (original) Object.defineProperty(HTMLElement.prototype, 'showPopover', original)
      else delete (HTMLElement.prototype as Partial<HTMLElement>).showPopover
    }
  })

  it('handles an empty scoped box without invalid origin values or a lost completion', () => {
    vi.spyOn(target(), 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 0, height: 0 } as DOMRect)
    const a = mount({ scope: 'true', origin: 'click', cover: 'iris' })
    a.button.dispatchEvent(new MouseEvent('click', { detail: 1, clientX: 0, clientY: 0 }))
    expect(panel().style.cssText).not.toMatch(/NaN|Infinity/)
    vi.advanceTimersByTime(268)
    expect(target().dataset.scene).toBe('two')
    expect(panel()).toBeNull()
  })

  it('reuses the twelve existing pieces for alternating shutter columns and existing fade keyframes', () => {
    const source = 'curtain attribute:data-scene value:two values:"one two three" cover:shutter reveal:shutter'
    const plan = compile(parse(source), registry, 'time')
    expect(plan.warnings).toEqual([])
    mount(plan.jsEffects[0]!.spec.params).button.click()
    expect(panel().children).toHaveLength(12)
    expect(panel().dataset.shape).toBe('shutter')
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/css/curtains.css'), 'utf8')
    expect(css).toContain("[data-shape='shutter'] > i:nth-child(even)")
    expect(css).toContain('--kui-door: 0 -101%')
    expect(css).toContain('--kui-door: 0 101%')
    expect(css).toContain('--kui-cover: kui-page-fade;')
    expect(css).not.toContain('@keyframes kui-panel-fade-in')
  })

  it('composes curtains with entrance motion and refuses two swap lifecycles on one control', () => {
    expect(compile(parse('curtain, fade-up on:enter'), registry, 'time').warnings).toEqual([])
    expect(compile(parse('curtain, view-swap'), registry, 'time').warnings.join()).toContain('view-transition-run')
  })
})
