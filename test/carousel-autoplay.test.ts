// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createActivationBinder } from '../src/core/activation.js'
import { Animator } from '../src/core/animator.js'
import { collectingReporter } from '../src/core/reporter.js'
import { SWIPE_EVENT } from '../src/effects/swipe-event.js'
import { CAPS, fakeRoot, idleScheduler } from './support/js-effect-harness.js'
import { catalogRegistry } from './support/registry.js'

/**
 * `autoplay:` on the `carousel` step deck (and `step-progress`, its other name).
 *
 * The scheduler is the spatial decks' (`effects/auto-motion.ts`), whose pause rules
 * `carousel-spin.test.ts` already covers one by one; these prove the flat deck is wired to it —
 * through the real animator, attribute to timer — and that the wiring is the right way round: its
 * own timer is not a "person", a press on its controls is, and a pause button inside it does not
 * also advance it.
 *
 * Fake timers only for `setTimeout`: autoplay is a timer pressing "next", and the stylesheet's
 * transition does the travel, so there is no frame to fake.
 */

let animator: Animator | undefined
let reporter: ReturnType<typeof collectingReporter>

function start(html: string, reducedMotion = false): void {
  document.body.innerHTML = html
  reporter = collectingReporter()
  animator = new Animator({
    root: document.body,
    registry: catalogRegistry(),
    capabilities: { ...CAPS, reducedMotion },
    binder: createActivationBinder({ createObserver: undefined }),
    scheduler: idleScheduler,
    rootResolver: () => fakeRoot,
    reporter,
  })
  animator.start()
}

const deck = (): HTMLElement => document.getElementById('deck')!
const step = (): string | null => deck().getAttribute('data-kui-step')
const SLIDES = '<div class="slide">1</div><div class="slide">2</div><div class="slide">3</div>'
const click = (target: Element): void => {
  target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }))
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
})

afterEach(() => {
  animator?.destroy()
  animator = undefined
  vi.useRealTimers()
  document.body.replaceChildren()
})

describe('carousel autoplay:', () => {
  it('steps the deck on its own, every period, and wraps', () => {
    start(`<div id="deck" data-kui="carousel autoplay:3s">${SLIDES}</div>`)
    expect(step()).toBe('0')
    vi.advanceTimersByTime(2999)
    expect(step()).toBe('0')
    vi.advanceTimersByTime(1)
    expect(step()).toBe('1')
    // Its own step is not a person taking over: the next one is a full period later, not a
    // settle period plus a period.
    vi.advanceTimersByTime(3000)
    expect(step()).toBe('2')
    vi.advanceTimersByTime(3000)
    expect(step()).toBe('0')
  })

  it('does not move without the parameter', () => {
    start(`<div id="deck" data-kui="carousel">${SLIDES}</div>`)
    vi.advanceTimersByTime(60_000)
    expect(step()).toBe('0')
  })

  it('steps backwards when negative, and step-progress takes it too', () => {
    start(`<div id="deck" data-kui="step-progress autoplay:-2s">${SLIDES}</div>`)
    vi.advanceTimersByTime(2000)
    expect(step()).toBe('2')
  })

  it('floors the period at two seconds, and says so', () => {
    start(`<div id="deck" data-kui="carousel autoplay:500ms">${SLIDES}</div>`)
    expect(reporter.messages).toContain('step-progress autoplay: minimum is 2s; clamped to 2s')
    vi.advanceTimersByTime(1999)
    expect(step()).toBe('0')
    vi.advanceTimersByTime(1)
    expect(step()).toBe('1')
  })

  it('yields to a press on its controls, then resumes a settle period later', () => {
    start(`<div id="deck" data-kui="carousel autoplay:3s next:.next">${SLIDES}<button class="next">›</button></div>`)
    vi.advanceTimersByTime(2000)
    click(document.querySelector('.next')!)
    expect(step()).toBe('1')
    // The pending step was cancelled: nothing lands at the old 3s mark.
    vi.advanceTimersByTime(1000)
    expect(step()).toBe('1')
    // 400ms to settle (the deck's own duration), then a full period.
    vi.advanceTimersByTime(2399)
    expect(step()).toBe('1')
    vi.advanceTimersByTime(1)
    expect(step()).toBe('2')
  })

  it('yields to the container click and to a swipe the same way', () => {
    start(`<section id="shell"><div id="deck" data-kui="carousel autoplay:3s">${SLIDES}</div></section>`)
    vi.advanceTimersByTime(2000)
    click(deck().firstElementChild!)
    expect(step()).toBe('1')
    vi.advanceTimersByTime(2000)
    expect(step()).toBe('1')
    document.getElementById('shell')!.dispatchEvent(
      new CustomEvent(SWIPE_EVENT, { bubbles: true, detail: { direction: 'left' } }),
    )
    expect(step()).toBe('2')
    vi.advanceTimersByTime(3399)
    expect(step()).toBe('2')
    vi.advanceTimersByTime(1)
    expect(step()).toBe('0')
  })

  it('pauses while hovered and resumes on leaving', () => {
    start(`<div id="deck" data-kui="carousel autoplay:3s">${SLIDES}</div>`)
    deck().dispatchEvent(new Event('pointerenter'))
    vi.advanceTimersByTime(10_000)
    expect(step()).toBe('0')
    deck().dispatchEvent(new Event('pointerleave'))
    vi.advanceTimersByTime(3000)
    expect(step()).toBe('1')
  })

  it('keeps stepping under the pointer with hover:none', () => {
    start(`<div id="deck" data-kui="carousel autoplay:3s hover:none">${SLIDES}</div>`)
    deck().dispatchEvent(new Event('pointerenter'))
    vi.advanceTimersByTime(3000)
    expect(step()).toBe('1')
  })

  it('starts paused under reduced motion, until the visitor presses play', () => {
    start(`<div id="deck" data-kui="carousel autoplay:3s pause:.pp">${SLIDES}<button class="pp">Pause</button></div>`, true)
    const control = document.querySelector('.pp')!
    expect(control.getAttribute('aria-pressed')).toBe('true')
    vi.advanceTimersByTime(10_000)
    expect(step()).toBe('0')
    click(control)
    expect(control.getAttribute('aria-pressed')).toBe('false')
    vi.advanceTimersByTime(3000)
    expect(step()).toBe('1')
  })
})

describe('carousel pause:', () => {
  it('toggles the motion, mirrors it on aria-pressed, and never advances the deck itself', () => {
    start(`<div id="deck" data-kui="carousel autoplay:3s pause:.pp">${SLIDES}<button class="pp"><span>Pause</span></button></div>`)
    const control = document.querySelector('.pp')!
    expect(control.getAttribute('aria-pressed')).toBe('false')
    click(control.querySelector('span')!)
    expect(control.getAttribute('aria-pressed')).toBe('true')
    // Naming a control retires the click-the-container fallback, so the press did not step.
    expect(step()).toBe('0')
    vi.advanceTimersByTime(10_000)
    expect(step()).toBe('0')
    click(control)
    expect(control.getAttribute('aria-pressed')).toBe('false')
    vi.advanceTimersByTime(3000)
    expect(step()).toBe('1')
  })

  it('warns when there is nothing to pause, or nothing it names', () => {
    start(`<div id="deck" data-kui="carousel pause:.pp">${SLIDES}<button class="pp">Pause</button></div>`)
    expect(reporter.messages).toContain('step-progress pause: has nothing to pause without autoplay:')
    expect(document.querySelector('.pp')!.hasAttribute('aria-pressed')).toBe(false)
    animator!.destroy()
    start(`<div id="deck" data-kui="carousel autoplay:3s pause:.nope">${SLIDES}</div>`)
    expect(reporter.messages).toContain('step-progress pause ".nope" matched nothing')
  })

  it('gives the control back and stops the timer on teardown', () => {
    start(`<div id="deck" data-kui="carousel autoplay:3s pause:.pp">${SLIDES}<button class="pp">Pause</button></div>`)
    const control = document.querySelector('.pp')!
    const slides = [...deck().children]
    animator!.destroy()
    animator = undefined
    expect(control.hasAttribute('aria-pressed')).toBe(false)
    vi.advanceTimersByTime(10_000)
    expect(slides[0]!.hasAttribute('data-kui-step-state')).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })
})
