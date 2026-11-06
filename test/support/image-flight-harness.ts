import { vi } from 'vitest'

export function flightDom(): {
  calls: { node: HTMLElement; frames: Keyframe[]; options: KeyframeAnimationOptions; cancel: ReturnType<typeof vi.fn>; reverse: ReturnType<typeof vi.fn>; finish(): void; reject(): void }[]
} {
  const calls: ReturnType<typeof flightDom>['calls'] = []
  const computed = window.getComputedStyle.bind(window)
  vi.spyOn(window, 'getComputedStyle').mockImplementation((node) => {
    const css = computed(node)
    if (node instanceof HTMLImageElement) {
      if (!css.objectFit) css.objectFit = 'fill'
      if (!css.objectPosition) css.objectPosition = '50% 50%'
      if (!css.borderRadius) css.borderRadius = '0px'
    }
    return css
  })
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value(this: HTMLDialogElement) { this.setAttribute('open', '') } })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value(this: HTMLDialogElement) {
    this.removeAttribute('open')
    this.dispatchEvent(new Event('close'))
  } })
  vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(400)
  vi.spyOn(HTMLImageElement.prototype, 'naturalHeight', 'get').mockReturnValue(300)
  vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(true)
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    return this.closest('dialog') ? new DOMRect(300, 150, 400, 300) : new DOMRect(40, 50, 100, 75)
  })
  Object.defineProperty(Element.prototype, 'animate', { configurable: true, value: function (this: HTMLElement, frames: Keyframe[], options: KeyframeAnimationOptions) {
    let finish!: () => void
    let reject!: () => void
    const finished = new Promise<void>((resolve, fail) => { finish = resolve; reject = () => fail(new DOMException('cancelled', 'AbortError')) })
    const cancel = vi.fn(reject)
    const reverse = vi.fn()
    calls.push({ node: this, frames, options, cancel, reverse, finish, reject })
    return { finished, cancel, reverse }
  } })
  return { calls }
}

export const flushFlight = async (): Promise<void> => { for (let i = 0; i < 10; i++) await Promise.resolve() }
