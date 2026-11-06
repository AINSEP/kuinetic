// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flightImageReady, flyImage } from '../src/core/image-flight.js'
import { flightDom, flushFlight } from './support/image-flight-harness.js'

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); delete (Element.prototype as any).animate; document.body.replaceChildren() })

describe('shared fresh-image flight', () => {
  it.each([true, false])('removes the inert flyer on native completion or cancellation (%s)', async (landed) => {
    const { calls } = flightDom()
    const image = document.createElement('img')
    image.src = '/a.jpg'
    const flight = flyImage({ image, parent: document.body, from: new DOMRect(0, 0, 100, 100), to: new DOMRect(200, 100, 40, 50), duration: 500, easing: 'linear', lift: 60 })
    const flyer = document.querySelector('.kui-image-flight')!
    expect(flyer.hasAttribute('inert')).toBe(true)
    expect(flyer.getAttribute('aria-hidden')).toBe('true')
    expect(calls[0]!.frames[0]).toEqual({ translate: '-200px -100px', scale: '2.5 2' })
    expect(calls[1]!.options.composite).toBe('add')
    expect(calls[1]!.frames[1]!.translate).toBe('0px -60px')
    expect(flight.reverse()).toBe(true)
    expect(calls[1]!.reverse).toHaveBeenCalledOnce()
    if (landed) calls[0]!.finish()
    else flight.cancel()
    await expect(flight.finished).resolves.toBe(landed)
    expect(document.querySelector('.kui-image-flight')).toBeNull()
    expect(calls.every((call) => call.cancel.mock.calls.length === 1)).toBe(true)
    flight.cancel()
    expect(flight.reverse()).toBe(false)
  })

  it('reverses a live animation and supports finish and missing WAAPI', async () => {
    const { calls } = flightDom()
    const image = document.createElement('img')
    const options = { image, parent: document.body, from: new DOMRect(0, 0, 1, 1), to: new DOMRect(0, 0, 2, 2), duration: 100, easing: 'linear' }
    const flight = flyImage(options)
    expect(flight.reverse()).toBe(true)
    expect(calls[0]!.reverse).toHaveBeenCalledOnce()
    flight.finish()
    await expect(flight.finished).resolves.toBe(true)
    delete (Element.prototype as any).animate
    const instant = flyImage(options)
    await expect(instant.finished).resolves.toBe(true)
    expect(instant.reverse()).toBe(false)
  })

  it('silently cleans a rejected native animation', async () => {
    const { calls } = flightDom()
    const flight = flyImage({ image: document.createElement('img'), parent: document.body,
      from: new DOMRect(0, 0, 1, 1), to: new DOMRect(0, 0, 2, 2), duration: 100, easing: 'linear' })
    calls[0]!.reject()
    await expect(flight.finished).resolves.toBe(false)
    expect(document.querySelector('img')).toBeNull()
  })

  it('cancels an already-created main animation if the additive lift throws', async () => {
    const { calls } = flightDom()
    const animate = Element.prototype.animate
    Object.defineProperty(Element.prototype, 'animate', { configurable: true, value: function (
      this: Element, frames: Keyframe[] | PropertyIndexedKeyframes | null, timing?: number | KeyframeAnimationOptions,
    ) {
      if ((timing as KeyframeAnimationOptions).composite === 'add') throw new Error('lift failed')
      return animate.call(this, frames, timing)
    } })
    expect(() => flyImage({ image: document.createElement('img'), parent: document.body,
      from: new DOMRect(0, 0, 1, 1), to: new DOMRect(0, 0, 2, 2), duration: 100, easing: 'linear', lift: 20 })).toThrow('lift failed')
    await flushFlight()
    expect(calls[0]!.cancel).toHaveBeenCalledOnce()
    expect(document.querySelector('.kui-image-flight')).toBeNull()
  })

  it.each(['loaded', 'decoded', 'failed', 'timeout', 'abort', 'already-aborted', 'unavailable'])('bounds %s image readiness', async (state) => {
    vi.useFakeTimers()
    flightDom()
    const image = document.createElement('img')
    const controller = new AbortController()
    Object.defineProperty(image, 'complete', { value: state === 'loaded' })
    if (state !== 'unavailable') image.decode = () => {
      if (state === 'decoded') return Promise.resolve()
      if (state === 'failed') return Promise.reject(new Error('decode failed'))
      return new Promise(() => {})
    }
    if (state === 'already-aborted') controller.abort()
    const ready = flightImageReady(image, controller.signal)
    if (state === 'abort') controller.abort()
    if (state === 'timeout') vi.advanceTimersByTime(150)
    await flushFlight()
    await expect(ready).resolves.toBe(['loaded', 'decoded'].includes(state))
    expect(vi.getTimerCount()).toBe(0)
  })
})
