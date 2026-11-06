// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Animator } from '../src/core/animator.js'
import { createActivationBinder } from '../src/core/activation.js'
import { collectingReporter } from '../src/core/reporter.js'
import { CAPS, build, fakeRoot, idleScheduler } from './support/js-effect-harness.js'
import { catalogRegistry } from './support/registry.js'
import { flightDom, flushFlight } from './support/image-flight-harness.js'

let app: Animator | undefined
afterEach(() => { app?.destroy(); app = undefined; vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); delete (Element.prototype as any).animate; delete (HTMLImageElement.prototype as any).decode; document.body.replaceChildren() })

const markup = `<div data-kui-flight-source><img class="product" src="/first.jpg" alt="First"><button class="add-to-basket" data-kui="image-flight image:.product destination:#basket lift:60px 700ms 30ms ease:linear on:click">Add first</button></div>
<div data-kui-flight-source><img class="product" src="/second.jpg" alt="Second"><button class="add-to-basket" data-kui="image-flight image:.product destination:#basket lift:60px on:click">Add second</button></div>
<span id="basket" data-kui="ripple extent:2 startScale:1 450ms" data-kui-on="kui:finish from:.add-to-basket">Basket</span>`
const button = (index = 0): HTMLButtonElement => document.querySelectorAll<HTMLButtonElement>('.add-to-basket')[index]!
const basket = (): HTMLElement => document.getElementById('basket')!

describe('button-triggered image flights and app-owned basket state', () => {
  it('does nothing on load, finds each card image locally, and triggers the ring only at landing', async () => {
    const { calls } = flightDom()
    const reporter = collectingReporter()
    app = build(markup, reporter)
    let purchases = 0
    button().addEventListener('click', () => purchases++)
    const arrived = vi.fn()
    const ring = vi.fn()
    button().addEventListener('kui:finish', arrived)
    basket().addEventListener('kui:start', ring)
    basket().getBoundingClientRect = () => new DOMRect(800, 30, 32, 32)
    app.start()
    expect(calls).toHaveLength(0)
    button().click()
    await flushFlight()
    expect(purchases).toBe(1)
    expect(calls).toHaveLength(2)
    expect(calls[0]!.node.getAttribute('src')).toContain('/first.jpg')
    expect(calls[0]!.frames[0]).toEqual({ translate: '-760px 20px', scale: '3.125 2.34375' })
    expect(calls[0]!.options).toMatchObject({ duration: 700, delay: 30, easing: 'linear' })
    expect(calls[1]!.options.composite).toBe('add')
    expect(calls[1]!.frames[1]!.translate).toBe('0px -60px')
    expect(calls[0]!.node.style.zIndex).toBe('2147483647')
    const source = document.querySelector('.product')! as HTMLElement
    expect(source.style.opacity).toBe('0')
    expect(source.style.visibility).toBe('')
    expect(source.style.display).toBe('')
    expect(arrived).not.toHaveBeenCalled()
    expect(ring).not.toHaveBeenCalled()
    expect(document.querySelector('.product')!.hasAttribute('aria-hidden')).toBe(false)
    calls[0]!.finish()
    await flushFlight()
    expect(source.style.opacity).toBe('')
    expect(arrived).toHaveBeenCalledOnce()
    expect(ring).toHaveBeenCalledOnce()
    button(1).click()
    await flushFlight()
    expect(calls[2]!.node.getAttribute('src')).toContain('/second.jpg')
    expect(reporter.messages).toEqual([])
  })

  it('replaces the previous flight on repeated taps without prematurely finishing the replacement', async () => {
    const { calls } = flightDom()
    app = build(markup)
    const arrived = vi.fn()
    const cancelled = vi.fn()
    button().addEventListener('kui:finish', arrived)
    button().addEventListener('kui:cancel', cancelled)
    app.start()
    button().click()
    await flushFlight()
    expect((document.querySelector('.product')! as HTMLElement).style.opacity).toBe('0')
    button().click()
    await flushFlight()
    expect(calls).toHaveLength(4)
    expect((document.querySelector('.product')! as HTMLElement).style.opacity).toBe('0')
    expect(calls[0]!.cancel).toHaveBeenCalledOnce()
    expect(cancelled).toHaveBeenCalledOnce()
    expect(arrived).not.toHaveBeenCalled()
    expect(document.querySelectorAll('.kui-image-flight')).toHaveLength(1)
    calls[2]!.finish()
    await flushFlight()
    expect(arrived).toHaveBeenCalledOnce()
    expect(document.querySelectorAll('.kui-image-flight')).toHaveLength(0)
    expect(button().getAttribute('data-kui-state')).toBe('finished')
    expect((document.querySelector('.product')! as HTMLElement).style.opacity).toBe('')
  })

  it.each(['scroll', 'resize', 'source', 'destination', 'trigger', 'destroy', 'rejected'])('cancels on %s without firing arrival or the ring', async (exit) => {
    const { calls } = flightDom()
    app = build(markup)
    const arrived = vi.fn()
    const cancelled = vi.fn()
    const ring = vi.fn()
    button().addEventListener('kui:finish', arrived)
    button().addEventListener('kui:cancel', cancelled)
    basket().addEventListener('kui:start', ring)
    app.start()
    const source = document.querySelector('.product')! as HTMLElement
    source.style.opacity = '0.7'
    button().click()
    await flushFlight()
    if (exit === 'scroll' || exit === 'resize') window.dispatchEvent(new Event(exit))
    if (exit === 'source') document.querySelector('.product')!.remove()
    if (exit === 'destination') basket().remove()
    if (exit === 'trigger') button().remove()
    if (exit === 'destroy') app.destroy()
    if (exit === 'rejected') calls[0]!.reject()
    await flushFlight()
    expect(arrived).not.toHaveBeenCalled()
    expect(ring).not.toHaveBeenCalled()
    expect(cancelled).toHaveBeenCalledOnce()
    expect(document.querySelector('.kui-image-flight')).toBeNull()
    expect(source.style.opacity).toBe('0.7')
  })

  it('cancels on visual viewport resize and restores the source without arrival', async () => {
    const viewport = new EventTarget()
    vi.stubGlobal('visualViewport', viewport)
    flightDom()
    app = build(markup)
    const done = vi.fn()
    const cancelled = vi.fn()
    button().addEventListener('kui:finish', done)
    button().addEventListener('kui:cancel', cancelled)
    app.start()
    button().click()
    await flushFlight()
    viewport.dispatchEvent(new Event('resize'))
    await flushFlight()
    expect(cancelled).toHaveBeenCalledOnce()
    expect(done).not.toHaveBeenCalled()
    expect((document.querySelector('.product')! as HTMLElement).style.opacity).toBe('')
    viewport.dispatchEvent(new Event('resize'))
    expect(cancelled).toHaveBeenCalledOnce()
  })

  it('honors zero lift through the parser without creating an additive animation', async () => {
    const { calls } = flightDom()
    app = build(markup)
    button().setAttribute('data-kui', 'image-flight image:.product destination:#basket lift:0px on:click')
    app.start()
    button().click()
    await flushFlight()
    expect(calls).toHaveLength(1)
  })

  it.each(['missing', 'zero', 'failed', 'timeout', 'invalid', 'throw'])('cleans a %s source/flight without inventing an arrival', async (failure) => {
    vi.useFakeTimers()
    const { calls } = flightDom()
    const reporter = collectingReporter()
    app = build(markup, reporter)
    if (failure === 'missing') document.querySelector('.product')!.remove()
    if (failure === 'zero') document.querySelector('.product')!.getBoundingClientRect = () => new DOMRect()
    if (failure === 'invalid') button().setAttribute('data-kui', 'image-flight image:.bad..image destination:#basket on:click')
    if (failure === 'throw') Object.defineProperty(Element.prototype, 'animate', { configurable: true, value: () => { throw new Error('native failure') } })
    if (failure === 'failed' || failure === 'timeout') {
      vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(false)
      HTMLImageElement.prototype.decode = () => failure === 'failed' ? Promise.reject(new Error('decode')) : new Promise(() => {})
    }
    const arrived = vi.fn()
    button().addEventListener('kui:finish', arrived)
    app.start()
    button().click()
    vi.advanceTimersByTime(150)
    await flushFlight()
    expect(arrived).not.toHaveBeenCalled()
    expect(calls).toHaveLength(0)
    expect(document.querySelector('.kui-image-flight')).toBeNull()
    expect(reporter.messages).toHaveLength(['missing', 'invalid', 'throw'].includes(failure) ? 1 : 0)
  })

  it('replaces an in-flight decode and never resurrects it after cancellation', async () => {
    const { calls } = flightDom()
    vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(false)
    const decoded: (() => void)[] = []
    HTMLImageElement.prototype.decode = () => new Promise<void>((resolve) => decoded.push(resolve))
    app = build(markup)
    const arrived = vi.fn()
    button().addEventListener('kui:finish', arrived)
    app.start()
    button().click()
    button().click()
    decoded[0]!()
    await flushFlight()
    expect(calls).toHaveLength(0)
    expect(arrived).not.toHaveBeenCalled()
    decoded[1]!()
    await flushFlight()
    expect(calls).toHaveLength(2)
    expect(arrived).not.toHaveBeenCalled()
    app!.stateOf(button())!.instances.at(-1)!.finish()
    await flushFlight()
    expect(arrived).toHaveBeenCalledOnce()
  })

  it('skips reduced-motion decoration while app click state continues independently', async () => {
    const { calls } = flightDom()
    document.body.innerHTML = markup
    let purchases = 0
    button().addEventListener('click', () => purchases++)
    app = new Animator({ root: document.body, registry: catalogRegistry(), capabilities: { ...CAPS, reducedMotion: true },
      binder: createActivationBinder({ createObserver: undefined }), scheduler: idleScheduler, rootResolver: () => fakeRoot })
    app.start()
    button().click()
    await flushFlight()
    expect(purchases).toBe(1)
    expect(calls).toHaveLength(0)
  })

  it('lands immediately without WAAPI', async () => {
    flightDom()
    delete (Element.prototype as any).animate
    app = build(markup)
    const arrived = vi.fn()
    button().addEventListener('kui:finish', arrived)
    app.start()
    button().click()
    await flushFlight()
    expect(arrived).toHaveBeenCalledOnce()
  })
})
