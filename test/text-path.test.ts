// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { build, el, scheduler, reporter, stubRect } from './support/scroll-mechanics-harness.js'
import type { Animator } from '../src/core/animator.js'
import { TEXT_PATH_PRIMITIVE } from '../src/effects/svg/text-path.js'
import { createParams } from '../src/core/js-params.js'
import { createStyleLedger } from '../src/core/owned-styles.js'
import type { PrepareContext } from '../src/core/effect-context.js'

let animator: Animator | undefined
let begin: ReturnType<typeof vi.fn>
const nativeCreate = document.createElementNS.bind(document)
function mount(effect: string): SVGTextPathElement {
  animator = build(`<svg viewBox="0 0 600 200"><path id="curve" d="M0 100 Q300 0 600 100"/><text><textPath href="#curve" startOffset="7%" data-kui="${effect}">Café along a curve</textPath></text></svg>`)
  stubRect(document.querySelector('svg')!, 0, 200)
  animator.start()
  return el() as unknown as SVGTextPathElement
}
beforeEach(() => {
  begin = vi.fn()
  vi.spyOn(document, 'createElementNS').mockImplementation((namespace, name) => {
    const node = nativeCreate(namespace, name)
    if (name === 'animate') Object.assign(node, { beginElementAt: begin })
    return node
  })
})
afterEach(() => {
  animator?.destroy()
  animator = undefined
  vi.restoreAllMocks()
  document.body.replaceChildren()
})

it('drives reversed scroll offsets on the native textPath and restores the author offset', () => {
  const node = mount('text-path from:100% to:0% timeline:scroll distance:800px')
  scheduler.emit(0)
  expect(node.getAttribute('startOffset')).toBe('100%')
  scheduler.emit(400)
  expect(node.getAttribute('startOffset')).toBe('50%')
  scheduler.emit(800)
  expect(node.getAttribute('startOffset')).toBe('0%')
  expect(node.querySelector('animate')).toBeNull()
  expect(reporter.messages).toEqual([])
  animator!.destroy()
  animator = undefined
  expect(node.getAttribute('startOffset')).toBe('7%')
  expect(scheduler.subscriberCount()).toBe(0)
})

it('owns a native timer with positional duration/delay/ease and a finish endpoint', () => {
  const node = mount('text-path from:0% to:100% 2s 300ms ease-in-out')
  const animation = node.querySelector('animate')!
  expect(animation.getAttribute('dur')).toBe('2000ms')
  expect(animation.getAttribute('repeatCount')).toBe('1')
  expect(animation.getAttribute('values')!.split(';')).toHaveLength(33)
  expect(begin).toHaveBeenCalledWith(.3)
  expect(scheduler.subscriberCount()).toBe(0)
  animation.dispatchEvent(new Event('endEvent'))
  expect(node.getAttribute('startOffset')).toBe('100%')
  expect(node.querySelector('animate')).toBeNull()
  expect(reporter.messages).toEqual([])
})

it('loops only when requested and removes the owned animation on teardown', () => {
  const node = mount('text-path from:0% to:100% 8s loop:true')
  expect(node.querySelector('animate')!.getAttribute('repeatCount')).toBe('indefinite')
  animator!.destroy()
  animator = undefined
  expect(node.querySelector('animate')).toBeNull()
  expect(node.getAttribute('startOffset')).toBe('7%')
  expect(reporter.messages).toEqual([])
})

it.each(['text-path from:0% to:100% timeline:scroll', 'text-path from:0% to:100% 8s loop:true'])('compiles the exact lab declaration without warnings: %s', source => {
  mount(source)
  expect(reporter.messages).toEqual([])
})

it.each(['text-path from:0% to:20px', 'text-path from:var(--start) to:100%', 'text-path from:0% to:var(--end)'])('rejects offsets that cannot interpolate: %s', effect => {
  mount(effect)
  expect(reporter.messages.join()).toContain('same unit')
})

it('reports unsupported native timers and restores after a native failure', () => {
  vi.mocked(document.createElementNS).mockImplementation(nativeCreate)
  const node = mount('text-path')
  expect(reporter.messages.join()).toContain('native SVG animation')
  expect(node.getAttribute('startOffset')).toBe('100%')
})

it('uses a raw final offset under reduced motion and restores an absent attribute', () => {
  const node = nativeCreate('http://www.w3.org/2000/svg', 'textPath')
  const ctx = { reducedMotion: true, doc: document, win: window, warn: vi.fn(), style: createStyleLedger(node) } as unknown as PrepareContext
  const instance = TEXT_PATH_PRIMITIVE.prepare!(node, createParams({ from: '0%', to: '100%' }), ctx)
  instance.activate()
  expect(node.getAttribute('startOffset')).toBe('100%')
  instance.destroy()
  expect(node.hasAttribute('startOffset')).toBe(false)
})

it('reports a wrong host without changing its content', () => {
  animator = build('<div data-kui="text-path">Keep me</div>')
  animator.start()
  expect(reporter.messages.join()).toContain('SVG textPath')
  expect(el().textContent).toBe('Keep me')
})

it('finishes zero-duration travel without adding a native animation', () => {
  const node = mount('text-path 0ms')
  expect(node.getAttribute('startOffset')).toBe('100%')
  expect(node.querySelector('animate')).toBeNull()
  expect(reporter.messages).toEqual([])
})

it('finishes a timed instance through the normal lifecycle', () => {
  const node = mount('text-path 2s')
  animator!.stateOf(node)!.instances[0]!.finish()
  expect(node.getAttribute('startOffset')).toBe('100%')
  expect(node.querySelector('animate')).toBeNull()
})

it('rolls back a native start failure before the animator reports it once', () => {
  begin.mockImplementation(() => { throw new Error('native start failed') })
  const node = mount('text-path')
  expect(node.querySelector('animate')).toBeNull()
  expect(node.getAttribute('startOffset')).toBe('7%')
  expect(reporter.messages.filter(message => message.includes('native start failed'))).toHaveLength(1)
})
