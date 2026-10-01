// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createStyleLedger } from '../src/core/owned-styles.js'
import { readEffectParams } from '../src/core/js-params.js'
import type { PrepareContext } from '../src/core/effect-context.js'
import type { EffectInstance } from '../src/core/types.js'
import type { Animator } from '../src/core/animator.js'
import { SPATIAL_STACK_PRIMITIVE } from '../src/effects/carousel/stack.js'
import { build } from './support/js-effect-harness.js'

/**
 * "carousel-stack freezes sometimes": every way a pause reason in `effects/auto-motion.ts` could be
 * left set with nothing coming to clear it. Each test drives one realistic sequence through the real
 * stack and asserts the deck steps again afterwards.
 */

function fakeCtx(el: Element): PrepareContext {
  return {
    win: {
      setTimeout: (cb: () => void, ms: number) => setTimeout(cb, ms),
      clearTimeout: (handle: number) => clearTimeout(handle),
      getComputedStyle: (node: Element) => window.getComputedStyle(node),
    } as unknown as Window,
    doc: window.document,
    reducedMotion: false,
    warn: () => {},
    style: createStyleLedger(el),
  } as unknown as PrepareContext
}

function mount(params: Record<string, string> = {}): { host: HTMLElement; instance: EffectInstance } {
  document.body.innerHTML =
    '<div><div class="slide">1</div><div class="slide">2</div><div class="slide">3</div><div class="slide">4</div></div>'
  const host = document.body.firstElementChild as HTMLElement
  const instance = SPATIAL_STACK_PRIMITIVE.prepare!(
    host,
    readEffectParams({ target: '.slide', autoplay: '3s', ...params }, SPATIAL_STACK_PRIMITIVE.parameters, () => {}),
    fakeCtx(host),
  )
  instance.activate()
  return { host, instance }
}

const step = (host: HTMLElement): string | null => host.getAttribute('data-kui-step')

function pointer(target: EventTarget, type: string, clientX: number, pointerId = 1): void {
  const event = new Event(type, { bubbles: true }) as Event & Record<string, number>
  Object.assign(event, { clientX, clientY: 0, pointerId, button: 0, pointerType: 'touch' })
  target.dispatchEvent(event)
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] })
})

afterEach(() => {
  vi.useRealTimers()
  document.body.innerHTML = ''
})

describe('hover:', () => {
  const enter = (host: HTMLElement): boolean => host.dispatchEvent(new Event('pointerenter'))
  const leave = (host: HTMLElement): boolean => host.dispatchEvent(new Event('pointerleave'))

  it('pauses while the pointer rests on the deck by default, and resumes when it leaves', () => {
    const { host, instance } = mount()
    enter(host)
    vi.advanceTimersByTime(10_000)
    expect(step(host)).toBe('0')
    leave(host)
    vi.advanceTimersByTime(3_000)
    expect(step(host)).toBe('1')
    instance.destroy()
  })

  it('hover:none keeps the deck moving under the pointer', () => {
    const { host, instance } = mount({ hover: 'none' })
    enter(host)
    vi.advanceTimersByTime(3_000)
    expect(step(host)).toBe('1')
    instance.destroy()
  })

  it('hover:none still pauses for keyboard focus', () => {
    const { host, instance } = mount({ hover: 'none' })
    // jsdom has no keyboard modality, so `:focus-visible` is answered for it: this is a Tab.
    host.matches = (selector: string) => selector === ':focus-visible'
    host.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
    vi.advanceTimersByTime(10_000)
    expect(step(host)).toBe('0')
    instance.destroy()
  })

  it('hover:none still pauses for the pause control', () => {
    document.body.innerHTML = ''
    const { host, instance } = mount({ hover: 'none', pause: '.stop' })
    instance.destroy()
    host.insertAdjacentHTML('beforeend', '<button class="stop" type="button">Pause</button>')
    const again = SPATIAL_STACK_PRIMITIVE.prepare!(
      host,
      readEffectParams(
        { target: '.slide', autoplay: '3s', hover: 'none', pause: '.stop' },
        SPATIAL_STACK_PRIMITIVE.parameters,
        () => {},
      ),
      fakeCtx(host),
    )
    again.activate()
    host.querySelector('.stop')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(host.querySelector('.stop')!.getAttribute('aria-pressed')).toBe('true')
    vi.advanceTimersByTime(10_000)
    expect(step(host)).toBe('0')
    again.destroy()
  })
})

describe('closing the lightbox does not leave the deck paused', () => {
  const active: Animator[] = []
  const dialog = (): HTMLDialogElement => document.querySelector('dialog.kui-lightbox')!
  /** Whether the browser would draw a focus ring: after a mouse click no, after a key press yes. */
  let keyboardModality = false

  beforeEach(() => {
    keyboardModality = false
    let previous: HTMLElement | null = null
    // Native `<dialog>` focus handling, which jsdom lacks: `showModal` moves focus in, and
    // `close` puts it back on whatever had it, synchronously, before the `close` event.
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value(this: HTMLDialogElement) {
      previous = document.activeElement as HTMLElement | null
      this.setAttribute('open', '')
      this.tabIndex = -1
      this.focus()
    } })
    Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value(this: HTMLDialogElement) {
      this.removeAttribute('open')
      previous?.focus()
      this.dispatchEvent(new Event('close'))
    } })
    vi.spyOn(Element.prototype, 'matches').mockImplementation(function (this: Element, selector: string) {
      if (selector === ':focus-visible') return keyboardModality && document.activeElement === this
      return Element.prototype.closest.call(this, `:scope:is(${selector})`) === this
    })
  })

  afterEach(() => {
    for (const animator of active.splice(0).reverse()) animator.destroy()
    vi.restoreAllMocks()
  })

  function openThenEscape(): HTMLElement {
    const animator = build(
      `<div id="deck" data-kui="carousel-stack autoplay:3s lightbox:true">
        <figure><img src="/a.jpg" alt="A"></figure><figure><img src="/b.jpg" alt="B"></figure>
        <figure><img src="/c.jpg" alt="C"></figure><figure><img src="/d.jpg" alt="D"></figure>
      </div>`,
    )
    active.push(animator)
    animator.start()
    const host = document.getElementById('deck')!
    // A mouse click on a card: the focusable host takes focus, with no ring.
    host.focus()
    host.querySelector('img')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }))
    expect(dialog().open).toBe(true)
    // Escape: from here the browser draws focus rings, the restored one included.
    keyboardModality = true
    dialog().dispatchEvent(new Event('cancel', { cancelable: true }))
    vi.advanceTimersByTime(2_000)
    expect(dialog().open).toBe(false)
    expect(document.activeElement).toBe(host)
    return host
  }

  it('keeps a keyboard-focused card paused after Enter opens and Escape restores focus', () => {
    const animator = build(
      `<div id="deck" data-kui="carousel-stack spin:40s hover:none lightbox:true">
        <figure tabindex="0"><img src="/a.jpg" alt="A"></figure>
        <figure><img src="/b.jpg" alt="B"></figure>
      </div>`,
    )
    active.push(animator)
    animator.start()
    const host = document.getElementById('deck')!
    // Bare-image decks expose their live card through the focusable host.
    const card = host
    keyboardModality = true
    card.focus()
    expect(host.getAttribute('data-kui-ring-spinning')).toBe('false')
    card.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    expect(dialog().open).toBe(true)
    dialog().dispatchEvent(new Event('cancel', { cancelable: true }))
    vi.advanceTimersByTime(2_000)
    expect(dialog().open).toBe(false)
    expect(document.activeElement).toBe(card)
    const held = host.style.getPropertyValue('--kui-step-position')
    vi.advanceTimersByTime(4_000)
    expect(host.getAttribute('data-kui-ring-spinning')).toBe('false')
    expect(host.style.getPropertyValue('--kui-step-position')).toBe(held)
  })

  it('resumes after an Escape close, though focus came back to the deck with a ring', () => {
    const host = openThenEscape()
    const at = step(host)
    vi.advanceTimersByTime(4_000)
    expect(step(host)).not.toBe(at)
  })

  it('still pauses when the visitor then tabs into the deck for real', () => {
    const host = openThenEscape()
    host.blur()
    host.focus()
    const at = step(host)
    vi.advanceTimersByTime(10_000)
    expect(step(host)).toBe(at)
  })
})

describe('carousel-stack never stays frozen', () => {
  it('a second finger landing mid-drag does not leave the drag held forever', () => {
    const { host, instance } = mount()
    pointer(host, 'pointerdown', 300, 1)
    pointer(host, 'pointermove', 200, 1)
    expect(host.getAttribute('data-kui-ring-dragging')).toBe('true')
    pointer(host, 'pointerdown', 320, 2)
    pointer(host, 'pointerup', 200, 1)
    pointer(host, 'pointerup', 320, 2)
    expect(host.getAttribute('data-kui-ring-dragging')).toBe('false')
    const at = step(host)
    vi.advanceTimersByTime(10_000)
    expect(step(host)).not.toBe(at)
    instance.destroy()
  })

  /** Drag, end it however `end` says, then the deck must step again once settled. */
  function resumesAfter(end: (host: HTMLElement) => void, capture = false): void {
    const { host, instance } = mount()
    if (capture) {
      let held: number | null = null
      Object.assign(host, {
        setPointerCapture: (id: number) => { held = id },
        releasePointerCapture: () => { held = null },
        hasPointerCapture: (id: number) => held === id,
      })
    }
    pointer(host, 'pointerdown', 300)
    pointer(host, 'pointermove', 200)
    expect(host.getAttribute('data-kui-ring-dragging')).toBe('true')
    end(host)
    expect(host.getAttribute('data-kui-ring-dragging')).toBe('false')
    const at = step(host)
    vi.advanceTimersByTime(10_000)
    expect(step(host)).not.toBe(at)
    instance.destroy()
  }

  it('resumes after a release outside the deck (no capture: heard on the document)', () => {
    resumesAfter(() => pointer(document.body, 'pointerup', 50))
  })

  it('resumes after the browser cancels the drag', () => {
    resumesAfter((host) => pointer(host, 'pointercancel', 200))
  })

  it('resumes after the capture is taken away with no pointerup coming', () => {
    resumesAfter((host) => pointer(host, 'lostpointercapture', 200), true)
  })

  it('resumes after a release outside the deck while captured', () => {
    // Capture retargets the release at the host wherever the pointer is; that is what capture is.
    resumesAfter((host) => pointer(host, 'pointerup', -400), true)
  })
})
