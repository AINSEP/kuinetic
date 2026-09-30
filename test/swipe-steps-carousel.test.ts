// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createActivationBinder } from '../src/core/activation.js'
import { Animator } from '../src/core/animator.js'
import { defaultCapabilities } from '../src/core/capabilities.js'
import { SWIPE_EVENT, stepOnSwipe, swipeReaches, swipeStep } from '../src/effects/swipe-event.js'
import { catalogRegistry } from './support/registry.js'
import { fakeRoot, idleScheduler } from './support/js-effect-harness.js'

/**
 * A swipe on a deck's wrapper steps the `carousel` inside it, with no page script.
 *
 * The pair cannot share an element (both write element state), so the swipe sits on a wrapper and
 * announces `kui:swipe`; `step-progress` hears it from its document and steps. These run the real
 * animator over real markup — attribute, parse, compile, prepare — because the whole point is that
 * the two names, authored on two elements, find each other with nothing in between.
 *
 * Fake timers because a swipe is a velocity judgement read off `performance.now()` (see
 * `gesture-swipeable.test.ts`): every flick below is exactly 1000px/s.
 */

function start(html: string): Animator {
  document.body.innerHTML = html
  const animator = new Animator({
    root: document.body,
    registry: catalogRegistry(),
    capabilities: defaultCapabilities({ intersectionObserver: true }),
    binder: createActivationBinder({ createObserver: undefined }),
    scheduler: idleScheduler,
    rootResolver: () => fakeRoot,
  })
  animator.start()
  return animator
}

function pointer(target: EventTarget, type: string, x: number, y: number): void {
  const event = new Event(type, { bubbles: true }) as PointerEvent & { clientX: number; clientY: number; pointerId: number }
  Object.assign(event, { clientX: x, clientY: y, pointerId: 1 })
  target.dispatchEvent(event)
}

function flick(el: Element, dx: number, dy: number): void {
  pointer(el, 'pointerdown', 200, 200)
  for (let step = 1; step <= 4; step++) {
    vi.advanceTimersByTime(25)
    pointer(el, 'pointermove', 200 + (dx * step) / 4, 200 + (dy * step) / 4)
  }
  pointer(el, 'pointerup', 200 + dx, 200 + dy)
}

const byId = (id: string): HTMLElement => document.getElementById(id)!
const stepOf = (id: string): string | null => byId(id).getAttribute('data-kui-step')

const SLIDES = '<div class="slide">1</div><div class="slide">2</div><div class="slide">3</div>'

describe('a swipe steps the carousel inside it', () => {
  let animator: Animator | undefined

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['performance', 'Date', 'setTimeout', 'clearTimeout'] })
  })

  afterEach(() => {
    animator?.destroy()
    animator = undefined
    vi.useRealTimers()
    document.body.replaceChildren()
  })

  it('swipe-x: left is next, right is previous, and it wraps', () => {
    animator = start(`<section id="shell" data-kui="swipe-x"><div id="deck" data-kui="carousel">${SLIDES}</div></section>`)
    expect(stepOf('deck')).toBe('0')

    flick(byId('shell'), -100, 0)
    expect(byId('shell').getAttribute('data-kui-swipe')).toBe('left')
    expect(stepOf('deck')).toBe('1')

    flick(byId('shell'), -100, 0)
    expect(stepOf('deck')).toBe('2')

    flick(byId('shell'), 100, 0)
    expect(stepOf('deck')).toBe('1')

    flick(byId('shell'), 100, 0)
    flick(byId('shell'), 100, 0)
    expect(stepOf('deck')).toBe('2')
  })

  it('swipe-y: up is next, down is previous', () => {
    animator = start(`<section id="shell" data-kui="swipe-y"><div id="deck" data-kui="carousel">${SLIDES}</div></section>`)

    flick(byId('shell'), 0, -100)
    expect(stepOf('deck')).toBe('1')

    flick(byId('shell'), 0, 100)
    expect(stepOf('deck')).toBe('0')
  })

  it('a flick that starts on a slide still steps its deck (the swipe hears it bubble)', () => {
    animator = start(`<section id="shell" data-kui="swipe-x"><div id="deck" data-kui="carousel">${SLIDES}</div></section>`)
    flick(byId('deck').children[0]!, -100, 0)
    expect(stepOf('deck')).toBe('1')
  })

  it('steps only decks inside the swipe, and only the outermost of nested ones', () => {
    animator = start(`
      <section id="shell" data-kui="swipe-x">
        <div id="outer" data-kui="carousel target:.outer-slide">
          <div class="outer-slide"><div id="inner" data-kui="carousel">${SLIDES}</div></div>
          <div class="outer-slide">2</div>
        </div>
      </section>
      <div id="elsewhere" data-kui="carousel">${SLIDES}</div>`)

    flick(byId('shell'), -100, 0)
    expect(stepOf('outer')).toBe('1')
    expect(stepOf('inner')).toBe('0')
    expect(stepOf('elsewhere')).toBe('0')
  })

  it('stops listening when the deck is torn down', () => {
    animator = start(`<section id="shell" data-kui="swipe-x"><div id="deck" data-kui="carousel">${SLIDES}</div></section>`)
    animator.destroy()
    animator = undefined
    // Teardown gives the deck its markup back; a swipe announced afterwards must write nothing.
    byId('shell').dispatchEvent(new CustomEvent(SWIPE_EVENT, { bubbles: true, detail: { direction: 'left' } }))
    expect(stepOf('deck')).toBeNull()
  })
})

describe('the swipe event contract', () => {
  afterEach(() => {
    document.body.replaceChildren()
  })

  it('maps the four directions onto next and previous', () => {
    expect(swipeStep('left')).toBe(1)
    expect(swipeStep('up')).toBe(1)
    expect(swipeStep('right')).toBe(-1)
    expect(swipeStep('down')).toBe(-1)
  })

  it('reaches a contained deck unless another deck sits between them', () => {
    document.body.innerHTML = '<div id="s"><div id="a"><div id="mid" data-kui-step="0"><div id="b"></div></div></div></div><div id="c"></div>'
    expect(swipeReaches(byId('s'), byId('a'))).toBe(true)
    expect(swipeReaches(byId('s'), byId('mid'))).toBe(true)
    expect(swipeReaches(byId('s'), byId('b'))).toBe(false)
    expect(swipeReaches(byId('s'), byId('c'))).toBe(false)
  })

  it('ignores an event with no direction, an unknown one, or one fired at the document', () => {
    document.body.innerHTML = '<div id="s"><div id="d"></div></div>'
    const step = vi.fn()
    const release = stepOnSwipe(document, byId('d'), step)
    byId('s').dispatchEvent(new Event(SWIPE_EVENT, { bubbles: true }))
    byId('s').dispatchEvent(new CustomEvent(SWIPE_EVENT, { bubbles: true, detail: { direction: 'sideways' } }))
    document.dispatchEvent(new CustomEvent(SWIPE_EVENT, { detail: { direction: 'left' } }))
    expect(step).not.toHaveBeenCalled()

    byId('s').dispatchEvent(new CustomEvent(SWIPE_EVENT, { bubbles: true, detail: { direction: 'right' } }))
    expect(step).toHaveBeenCalledWith(-1)

    release()
    byId('s').dispatchEvent(new CustomEvent(SWIPE_EVENT, { bubbles: true, detail: { direction: 'left' } }))
    expect(step).toHaveBeenCalledTimes(1)
  })
})
