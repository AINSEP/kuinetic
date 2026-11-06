// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { Animator } from '../src/core/animator.js'
import { createActivationBinder } from '../src/core/activation.js'
import { collectingReporter } from '../src/core/reporter.js'
import type { ScrollSubscriber } from '../src/core/scroll-scheduler.js'
import { CAPS, fakeRoot } from './support/js-effect-harness.js'
import { catalogRegistry } from './support/registry.js'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); delete (document as any).hidden })

function rig(fine = true, reducedMotion = false, source = '<img class="source" src="photo.jpg" alt="Original">', value = "cursor-trail images:'.source' spacing:60px") {
  vi.stubGlobal('matchMedia', () => ({ matches: fine }))
  let frame!: FrameRequestCallback
  let invalidated!: ScrollSubscriber
  const unsubscribe = vi.fn()
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => { frame = callback; return 1 }))
  const cancel = vi.fn()
  vi.stubGlobal('cancelAnimationFrame', cancel)
  document.body.innerHTML = `<div style="position:static" data-kui="${value}"><h2>Title</h2>${source}</div>`
  const node = document.body.firstElementChild as HTMLElement
  const measure = vi.spyOn(node, 'getBoundingClientRect').mockReturnValue({ left: 20, top: 30 } as DOMRect)
  const reporter = collectingReporter()
  const animator = new Animator({ root: document.body, registry: catalogRegistry(),
    capabilities: { ...CAPS, reducedMotion }, reporter,
    binder: createActivationBinder({ createObserver: undefined }), rootResolver: () => fakeRoot,
    scheduler: { subscribe: (_root, callback) => { invalidated = callback; return unsubscribe },
      invalidate() {}, rootCount: () => 0, destroy() {} },
  }).start()
  const move = (x: number, y = 30, pointerType = 'mouse') => node.dispatchEvent(Object.assign(new Event('pointermove'), { clientX: x, clientY: y, pointerType }))
  return { node, animator, move, measure, reporter, cancel, unsubscribe,
    tick: () => frame(0), invalidate: () => invalidated({} as any),
    photos: () => [...node.querySelectorAll<HTMLImageElement>('[data-kui-trail-layer] img')],
  }
}

it('samples distance with remainders, coalesces events, caps emissions and keeps geometry cached', () => {
  const r = rig()
  expect(r.reporter.messages).toEqual([])
  expect(r.photos()).toHaveLength(24)
  expect(r.node.style.position).toBe('relative')
  expect(r.node.style.isolation).toBe('isolate')
  const computed = window.getComputedStyle.bind(window)
  const restarts: string[] = []
  vi.spyOn(window, 'getComputedStyle').mockImplementation((node, pseudo) => {
    if (node.tagName === 'IMG') restarts.push((node as HTMLElement).style.animationName)
    return computed(node, pseudo)
  })
  r.move(20)
  r.tick()
  expect(r.photos()[0]!.style.left).toBe('0px')
  r.move(170)
  r.tick()
  expect(r.photos()[1]!.style.left).toBe('60px')
  expect(r.photos()[2]!.style.left).toBe('120px')
  r.move(200)
  r.tick()
  expect(r.photos()[3]!.style.left).toBe('180px')
  r.move(5000)
  r.move(10000)
  r.tick()
  expect(r.photos().filter((p) => p.style.display === 'block')).toHaveLength(8)
  expect(r.measure).toHaveBeenCalledTimes(1)
  for (let i = 0; i < 12; i++) { r.move(10000 + i * 1000); r.tick() }
  expect(r.photos()).toHaveLength(24)
  const newest = r.photos().reduce((a, b) => Number.parseFloat(a.style.left) > Number.parseFloat(b.style.left) ? a : b, r.photos()[0]!)
  const order = r.photos().map((photo) => Number(photo.style.zIndex))
  expect(Number(newest.style.zIndex)).toBe(Math.max(...order))
  expect(Number(newest.style.zIndex)).toBeGreaterThan(24)
  expect(newest.style.animationName).toBe('kui-trail-photo')
  expect(restarts.length).toBeGreaterThan(24)
  expect(restarts.every((name) => name === 'none')).toBe(true)
  expect(r.node.querySelector('.source')!.getAttribute('alt')).toBe('Original')
  expect(r.node.querySelector('[data-kui-trail-layer]')!.getAttribute('aria-hidden')).toBe('true')
  r.animator.destroy()
  expect(r.photos()).toHaveLength(0)
  expect(r.node.style.position).toBe('static')
  expect(r.node.style.isolation).toBe('')
  expect(r.unsubscribe).toHaveBeenCalledOnce()
})

it('clears pointer history while photos fade across leave, scroll and hidden state', () => {
  const r = rig()
  r.move(30)
  r.tick()
  r.photos()[0]!.onanimationend!(new Event('animationend') as AnimationEvent)
  expect(r.photos()[0]!.style.display).toBe('none')
  r.photos()[1]!.dispatchEvent(new Event('error'))
  r.move(90)
  r.tick()
  expect(r.photos()[1]!.style.display).toBe('none')
  r.move(150)
  r.tick()
  const live = r.photos()[2]!
  r.node.dispatchEvent(new Event('pointerleave'))
  expect(live.style.display).toBe('block')
  r.move(200)
  r.tick()
  expect(r.measure).toHaveBeenCalledTimes(2)
  r.invalidate()
  expect(live.style.display).toBe('block')
  r.move(200)
  r.tick()
  expect(r.measure).toHaveBeenCalledTimes(3)
  const visible = () => r.photos().filter((photo) => photo.style.display === 'block').length
  const beforeHidden = visible()
  r.move(250)
  Object.defineProperty(document, 'hidden', { configurable: true, value: true })
  r.tick()
  expect(visible()).toBe(beforeHidden)
  document.dispatchEvent(new Event('visibilitychange'))
  r.move(300)
  r.tick()
  expect(visible()).toBe(beforeHidden)
  Object.defineProperty(document, 'hidden', { configurable: true, value: false })
  r.move(400, 30, 'touch')
  r.move(500)
  r.animator.destroy()
  expect(r.photos()).toHaveLength(0)
  expect(r.cancel).toHaveBeenCalled()
})

it('leaves coarse pointers, reduced motion and missing/invalid sources without a pool', () => {
  for (const [fine, reduced] of [[false, false], [true, true]]) {
    const r = rig(fine, reduced)
    expect(r.photos()).toHaveLength(0)
    r.animator.destroy()
  }
  for (const source of ['', '<span class="source">Text</span>', '<img class="source" alt="No source">']) {
    const r = rig(true, false, source)
    expect(r.photos()).toHaveLength(0)
    expect(r.reporter.messages.join()).toContain('must select source images')
    r.animator.destroy()
  }
  for (const value of ['cursor-trail', "cursor-trail images:'[['"]) {
    const r = rig(true, false, undefined, value)
    expect(r.photos()).toHaveLength(0)
    expect(r.reporter.messages.join()).toContain('must select source images')
    if (value.includes('[[')) expect(r.reporter.messages.join()).toContain('not a valid selector')
    r.animator.destroy()
  }
})

it('removes pointer listeners on cancellation even while the host signal remains live', () => {
  const r = rig()
  r.move(20)
  r.tick()
  r.animator.cancel(r.node)
  expect(r.photos()).toHaveLength(0)
  const frames = vi.mocked(window.requestAnimationFrame).mock.calls.length
  r.move(100)
  expect(window.requestAnimationFrame).toHaveBeenCalledTimes(frames)
  r.animator.activate(r.node)
  expect(r.photos()).toHaveLength(24)
  r.move(200)
  r.tick()
  expect(r.photos()[0]!.style.display).toBe('block')
  r.animator.destroy()
})
