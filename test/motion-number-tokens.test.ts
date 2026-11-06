// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Animator } from '../src/core/animator.js'
import { createActivationBinder } from '../src/core/activation.js'
import { collectingReporter } from '../src/core/reporter.js'
import { CAPS, build, el, fakeRoot, idleScheduler } from './support/js-effect-harness.js'
import { catalogRegistry } from './support/registry.js'

const flush = async (): Promise<void> => { for (let i = 0; i < 8; i++) await Promise.resolve() }
afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = '' })
const display = (): HTMLElement => el().querySelector('.kui-count-decorative')!
const tokens = (): HTMLElement[] => [...display().querySelectorAll<HTMLElement>('.kui-number-token')].filter((node) => node.style.position !== 'absolute')

function nativeAnimations(): { calls: { node: Element; frames: Keyframe[]; timing: KeyframeAnimationOptions; cancel: ReturnType<typeof vi.fn>; finish(): void; reject(): void }[] } {
  const calls: ReturnType<typeof nativeAnimations>['calls'] = []
  // jsdom has no layout or WAAPI. Model proportional characters and a stable left origin.
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const active = [...this.parentElement?.children ?? []].filter((node) => (node as HTMLElement).style.position !== 'absolute')
    const characterWidth = this.textContent === '1' ? 6 : 10
    const width = this.classList.contains('kui-number-token') ? characterWidth : this.textContent!.length * 10
    const left = Math.max(0, active.indexOf(this)) * 10
    return { left, top: 0, width, height: 20 } as DOMRect
  })
  Object.defineProperty(Element.prototype, 'animate', { configurable: true, value: function (this: Element, frames: Keyframe[], timing: KeyframeAnimationOptions) {
    let finish = (): void => {}
    let reject = (): void => {}
    const finished = new Promise<void>((resolve, fail) => { finish = resolve; reject = () => fail(new DOMException('cancelled', 'AbortError')) })
    const cancel = vi.fn(reject)
    calls.push({ node: this, frames, timing, cancel, finish, reject })
    return { finished, cancel }
  } })
  return { calls }
}

describe('app-written number characters', () => {
  afterEach(() => { delete (Element.prototype as any).animate })

  it('uses the authored string for absent and removed attributes, including the accessible copy', async () => {
    const app = build('<span data-kui="number-formatting">$12.50</span>')
    app.start()
    expect(display().textContent).toBe('$12.50')
    expect(el().querySelector('.kui-sr-only')!.textContent).toBe('$12.50')
    el().setAttribute('data-value', '$9')
    await flush()
    el().removeAttribute('data-value')
    await flush()
    expect(display().textContent).toBe('$12.50')
    expect(el().querySelector('.kui-sr-only')!.textContent).toBe('$12.50')
    app.destroy()
  })

  it('preserves survivors while currency and compact strings change without recompiling the effect', async () => {
    const { calls } = nativeAnimations()
    const reporter = collectingReporter()
    const app = build('<span data-kui="number-formatting attribute:data-value 400ms" data-value="123.49">123.49</span>', reporter)
    app.start()
    const initial = tokens()
    expect(initial.map((node) => node.textContent).join('')).toBe('123.49')
    expect(calls).toHaveLength(0)
    el().setAttribute('data-value', '$123.49')
    await flush()
    expect(tokens().slice(1)).toEqual(initial)
    const inserted = calls.find((call) => call.node.textContent === '$')!
    expect(inserted.frames).toEqual([{ opacity: 0 }, { opacity: 1 }])
    expect(inserted.timing.duration).toBe(400)
    expect(el().querySelector('.kui-sr-only')!.textContent).toBe('$123.49')
    el().setAttribute('data-value', '$123')
    await flush()
    expect(tokens().slice(1)).toEqual(initial.slice(0, 3))
    const removed = calls.filter((call) => call.frames[1]?.opacity === 0)
    expect(removed.map((call) => call.node.textContent)).toEqual(['.', '4', '9'])
    removed.forEach((call) => call.finish())
    await flush()
    expect(display().textContent).toBe('$123')
    const previous = calls.length
    el().setAttribute('data-value', '$123')
    await flush()
    expect(calls).toHaveLength(previous)
    expect(reporter.messages).toEqual([])
    app.destroy()
    expect(el().textContent).toBe('123.49')
  })

  it('reads displayed width and positions before cancelling, and bounds repeated updates', async () => {
    const { calls } = nativeAnimations()
    const app = build('<span data-kui="number-formatting 700ms 30ms ease:linear" data-value="111">fallback</span>')
    app.start()
    el().setAttribute('data-value', '1111')
    await flush()
    const first = tokens()
    let cancelled = false
    for (const call of calls) {
      const abort = call.cancel.getMockImplementation()!
      call.cancel.mockImplementation(() => { cancelled = true; abort() })
    }
    display().getBoundingClientRect = () => ({ left: 0, top: 0, width: cancelled ? 60 : 37, height: 20 }) as DOMRect
    for (const [index, node] of first.entries()) node.getBoundingClientRect = () => ({ left: cancelled ? tokens().indexOf(node) * 10 : index * 10 + 7, top: 0, width: 10, height: 20 }) as DOMRect
    el().setAttribute('data-value', '11')
    await flush()
    expect(tokens()).toEqual(first.slice(2))
    const width = calls.filter((call) => call.node === display()).at(-1)!
    expect(width.frames[0]).toEqual({ width: '37px' })
    expect(width.timing).toMatchObject({ duration: 700, delay: 30, easing: 'linear' })
    const survivor = tokens()[0]!
    expect(calls.filter((call) => call.node === survivor).at(-1)!.frames[0]!.translate).toBe('27px 0px')
    el().setAttribute('data-value', '1111')
    await flush()
    expect(tokens()).toHaveLength(4)
    expect(display().children).toHaveLength(4)
    expect(width.cancel).toHaveBeenCalled()
    el().removeAttribute('data-value')
    await flush()
    calls.forEach((call) => call.reject())
    await flush()
    expect(display().textContent).toBe('fallback')
    app.destroy()
    expect(el().textContent).toBe('fallback')
  })

  it('starts the centred width tween before pinning removed characters', async () => {
    const { calls } = nativeAnimations()
    let animatedWidth: number | undefined
    vi.mocked(Element.prototype.getBoundingClientRect).mockImplementation(function (this: HTMLElement) {
      const host = this.classList.contains('kui-number-tokens') ? this : this.parentElement!
      const active = [...host.children].filter((node) => (node as HTMLElement).style.position !== 'absolute')
      const width = animatedWidth ?? active.length * 10
      const left = 200 - width / 2
      return { left: this === host ? left : left + active.indexOf(this) * 10, top: 0, width: this === host ? width : 10, height: 20 } as DOMRect
    })
    const animate = Element.prototype.animate
    Object.defineProperty(Element.prototype, 'animate', { configurable: true, value: function (this: Element, frames: Keyframe[], timing: KeyframeAnimationOptions) {
      if (frames[0]!.width) animatedWidth = Number.parseFloat(String(frames[0]!.width))
      return animate.call(this, frames, timing)
    } })
    const app = build('<div><span data-kui="number-formatting" data-value="$123.49">$123.49</span></div>')
    app.start()
    el().setAttribute('data-value', '$123')
    await flush()
    const exits = [...display().children] as HTMLElement[]
    expect(exits.filter((node) => node.style.position === 'absolute').map((node) => node.style.left)).toEqual(['40px', '50px', '60px'])
    expect(calls.find((call) => call.node === display())!.frames).toEqual([{ width: '70px' }, { width: '40px' }])
    app.destroy()
  })

  it.each([false, true])('updates instantly without WAAPI or with reduced motion (%s)', async (reducedMotion) => {
    document.body.innerHTML = '<span data-kui="number-formatting attribute:data-value 400ms" data-value="123.49">123.49</span>'
    const calls = reducedMotion ? nativeAnimations().calls : []
    const app = new Animator({ root: document.body, registry: catalogRegistry(), capabilities: { ...CAPS, reducedMotion },
      binder: createActivationBinder({ createObserver: undefined }), scheduler: idleScheduler, rootResolver: () => fakeRoot })
    app.start()
    el().setAttribute('data-value', '$123')
    await flush()
    expect(display().textContent).toBe('$123')
    expect(calls).toEqual([])
    app.destroy()
  })

  it('refuses interactive children without destroying the app button', () => {
    const reporter = collectingReporter()
    const app = build('<span data-kui="number-formatting"><button>Buy</button></span>', reporter)
    const button = el().firstElementChild
    app.start()
    expect(el().firstElementChild).toBe(button)
    expect(reporter.messages).toHaveLength(1)
    app.destroy()
  })
})
