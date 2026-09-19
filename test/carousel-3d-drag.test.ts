// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createStyleLedger } from '../src/core/owned-styles.js'
import { readEffectParams } from '../src/core/js-params.js'
import type { PrepareContext } from '../src/core/effect-context.js'
import type { EffectInstance } from '../src/core/types.js'
import { projectRelease, snapTo, wrapPlace } from '../src/effects/carousel/drag.js'
import { SPATIAL_RING_PRIMITIVE } from '../src/effects/carousel/index.js'

/**
 * Grabbing the ring: pointer, keyboard, and the click that must not follow a drag.
 *
 * Split from `carousel-3d.test.ts` on size — together they pass the 400-line cap — along the seam
 * that costs least: nothing here reads a published token, and nothing there dispatches an event.
 *
 * The projection and snap functions are asserted directly rather than through a synthesised
 * gesture, which is the only honest way to cover them: `core/gesture.ts` estimates velocity from a
 * time-windowed sample buffer against the wall clock, and every event a test dispatches lands in
 * the same tick — so the measured release speed is whatever fraction of a millisecond happened to
 * elapse between two synchronous statements, which is zero on one run and enormous on the next.
 * Asserting a throw through that path would be asserting the clock. So the gesture path is covered
 * for what it can prove deterministically — capture, the threshold, click suppression, the axis
 * lock — and the physics is covered where it is a pure function.
 */

/**
 * `PointerEvent` does not exist in jsdom, and a `MouseEvent` carries no `pointerId`.
 *
 * `recognise` calls `setPointerCapture`/`releasePointerCapture` optionally (`?.`), so their absence
 * is already handled — but the *coordinates* are what the drag reads, and a bare `new Event()` has
 * none. This builds the smallest thing that is indistinguishable from a real pointer to the code
 * under test.
 */
function pointer(type: string, clientX: number): Event {
  const event = new Event(type, { bubbles: true }) as Event & {
    clientX: number
    clientY: number
    pointerId: number
  }
  event.clientX = clientX
  event.clientY = 0
  event.pointerId = 1
  return event
}

function fakeCtx(el: Element): PrepareContext {
  return {
    win: window,
    doc: window.document,
    reducedMotion: false,
    warn: () => {},
    style: createStyleLedger(el),
  } as unknown as PrepareContext
}

const DECK = `
  <div>
    <a class="slide" href="#one">one</a>
    <a class="slide" href="#two">two</a>
    <a class="slide" href="#three">three</a>
    <a class="slide" href="#four">four</a>
  </div>
`

function mount(
  params: Record<string, string> = {},
  html = DECK,
): { host: HTMLElement; instance: EffectInstance } {
  document.body.innerHTML = html
  const host = document.body.firstElementChild as HTMLElement
  const instance = SPATIAL_RING_PRIMITIVE.prepare!(
    host,
    readEffectParams(params, SPATIAL_RING_PRIMITIVE.parameters, () => {}),
    fakeCtx(host),
  )
  instance.activate()
  return { host, instance }
}

function press(host: Element, key: string, modifiers: Record<string, boolean> = {}): Event {
  const event = new Event('keydown', { bubbles: true, cancelable: true }) as Event & {
    key: string
  }
  event.key = key
  Object.assign(event, modifiers)
  host.dispatchEvent(event)
  return event
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('release physics', () => {
  it('converts pointer velocity into places, in the unit the index uses', () => {
    // 220px per place and 220px/s for 0.28s is 0.28 of a place — and negative, because dragging
    // left (negative velocity) brings the *next* card to the front.
    expect(projectRelease(0, -220, 220)).toBeCloseTo(0.28, 10)
    expect(projectRelease(2, 220, 220)).toBeCloseTo(1.72, 10)
    // A slower deck, same flick: half the pixels per place is twice the travel.
    expect(projectRelease(0, -220, 110)).toBeCloseTo(0.56, 10)
  })

  it('caps a hard flick, so a throw stays a control rather than a slot machine', () => {
    /*
     * Velocities of several thousand pixels a second are ordinary on a phone. Uncapped, one flick
     * projects a dozen places, so the visitor cannot predict where the ring lands, so they cannot
     * aim, so they flick again. Four places is far enough that a deliberate throw clearly differs
     * from a nudge and close enough that the destination stays legible.
     */
    expect(projectRelease(0, -8000, 220)).toBe(4)
    expect(projectRelease(0, 8000, 220)).toBe(-4)
  })

  it('stands still rather than dividing by zero when travel is degenerate', () => {
    expect(projectRelease(3.5, -900, 0)).toBe(3.5)
  })

  it('always settles facing a card', () => {
    expect(snapTo(2.2)).toBe(2)
    expect(snapTo(2.5)).toBe(3)
    expect(snapTo(-0.4)).toBe(0)
  })

  it('brings a settled place back onto the ring', () => {
    expect(wrapPlace(4, 4)).toBe(0)
    expect(wrapPlace(-1, 4)).toBe(3)
    expect(wrapPlace(9, 4)).toBe(1)
    expect(wrapPlace(2, 0)).toBe(0)
  })
})

describe('dragging', () => {
  it('moves the ring between two places while the pointer is down', () => {
    const { host, instance } = mount({ target: '.slide', travel: '200' })
    host.dispatchEvent(pointer('pointerdown', 0))
    host.dispatchEvent(pointer('pointermove', -100))

    // Half a travel distance is half a place, and the ring is genuinely *between* two cards — which
    // is the entire reason the continuous position is published beside the integer one. A naive
    // binding to `--kui-step` alone can only ever be at 0 or 1 here.
    expect(Number(host.style.getPropertyValue('--kui-step-position'))).toBeCloseTo(0.5, 4)
    expect(host.getAttribute('data-kui-ring-dragging')).toBe('true')
    instance.destroy()
  })

  it('suspends the travel transition for the duration of the grab', () => {
    // The attribute `carousel.css` hangs `transition: none` on. A transition on top of a
    // direct-manipulation gesture is a lag between the card and the finger holding it.
    const { host, instance } = mount({ target: '.slide' })
    host.dispatchEvent(pointer('pointerdown', 0))
    host.dispatchEvent(pointer('pointermove', -80))
    expect(host.getAttribute('data-kui-ring-dragging')).toBe('true')
    host.dispatchEvent(pointer('pointerup', -80))
    expect(host.getAttribute('data-kui-ring-dragging')).toBe('false')
    instance.destroy()
  })

  it('lands on a whole place when the pointer lifts', () => {
    const { host, instance } = mount({ target: '.slide', travel: '200' })
    host.dispatchEvent(pointer('pointerdown', 0))
    host.dispatchEvent(pointer('pointermove', -140))
    host.dispatchEvent(pointer('pointerup', -140))

    /*
     * Asserted as "the continuous position and the integer agree" rather than as a literal place,
     * and the difference is not fussiness. Every event above is dispatched in the same tick, so the
     * release velocity `core/gesture.ts` measures is whatever the wall clock happened to do between
     * two synchronous statements — zero if no millisecond elapsed, enormous if a fraction of one
     * did. Pinning a number here would be pinning that. What the ring actually promises is that it
     * never comes to rest between two cards, and that holds under either reading.
     */
    const settled = host.style.getPropertyValue('--kui-step-position')
    expect(Number(settled) % 1).toBe(0)
    expect(Number(settled)).toBe(Number(host.getAttribute('data-kui-step')))
    expect(host.getAttribute('data-kui-ring-dragging')).toBe('false')
    instance.destroy()
  })

  it('swallows the click that ends a drag, so spinning by a card does not follow it', () => {
    /*
     * The browser fires a `click` at the end of every drag, aimed at whatever was under the pointer
     * when it went down. On a deck of cards that is a link, so without this, spinning the ring by
     * grabbing a card navigates away from the page — and the visitor never sees the deck they were
     * trying to browse.
     */
    const { host, instance } = mount({ target: '.slide' })
    const followed = vi.fn()
    const card = host.querySelector('.slide') as HTMLElement
    card.addEventListener('click', followed)

    host.dispatchEvent(pointer('pointerdown', 0))
    host.dispatchEvent(pointer('pointermove', -120))
    host.dispatchEvent(pointer('pointerup', -120))
    card.dispatchEvent(new Event('click', { bubbles: true, cancelable: true }))
    expect(followed).not.toHaveBeenCalled()

    // Exactly one click is swallowed. A flag that latched would make every later press on the deck
    // dead, which is a worse bug than the one it fixed.
    card.dispatchEvent(new Event('click', { bubbles: true, cancelable: true }))
    expect(followed).toHaveBeenCalledTimes(1)
    instance.destroy()
  })

  it('lets a press through untouched when it never became a drag', () => {
    const { host, instance } = mount({ target: '.slide' })
    const followed = vi.fn()
    const card = host.querySelector('.slide') as HTMLElement
    card.addEventListener('click', followed)

    // Two pixels is under the threshold, so this is a tap on a link and must behave like one.
    host.dispatchEvent(pointer('pointerdown', 0))
    host.dispatchEvent(pointer('pointermove', -2))
    host.dispatchEvent(pointer('pointerup', -2))
    card.dispatchEvent(new Event('click', { bubbles: true, cancelable: true }))
    expect(followed).toHaveBeenCalledTimes(1)
    instance.destroy()
  })

  it('locks the gesture to one axis, so the page can still be scrolled through the deck', () => {
    /*
     * Vertical pointer movement is the visitor scrolling past a full-width deck, and it has to keep
     * working — the single most common way a carousel traps a phone is by claiming both axes.
     *
     * The other half of that split is `touch-action: pan-y`, written by `createRingDrag`, which
     * cannot be asserted here: jsdom's `CSSStyleDeclaration` does not implement the property and
     * silently drops the write, so a passing assertion would be asserting jsdom rather than the
     * library. The browser tier is where that one is real. This covers the half that is: a purely
     * vertical drag moves the ring nowhere at all.
     */
    const { host, instance } = mount({ target: '.slide', travel: '200' })
    host.dispatchEvent(pointer('pointerdown', 0))
    const vertical = pointer('pointermove', 0) as Event & { clientY: number }
    vertical.clientY = -300
    host.dispatchEvent(vertical)
    expect(host.style.getPropertyValue('--kui-step-position')).toBe('0.0000')
    instance.destroy()
  })

  it('installs no pointer handling at all under grab:false', () => {
    const { host, instance } = mount({ target: '.slide', grab: 'false' })
    host.dispatchEvent(pointer('pointerdown', 0))
    host.dispatchEvent(pointer('pointermove', -300))
    expect(host.style.getPropertyValue('--kui-step-position')).toBe('0.0000')
    instance.destroy()
  })
})

describe('keyboard', () => {
  it('steps the ring on both axes, and wraps in both directions', () => {
    const { host, instance } = mount({ target: '.slide' })
    press(host, 'ArrowRight')
    expect(host.getAttribute('data-kui-step')).toBe('1')
    press(host, 'ArrowDown')
    expect(host.getAttribute('data-kui-step')).toBe('2')
    press(host, 'ArrowLeft')
    press(host, 'ArrowUp')
    press(host, 'ArrowUp')
    // Past the start of a ring is the end of it. There are no ends.
    expect(host.getAttribute('data-kui-step')).toBe('3')
    instance.destroy()
  })

  it('resolves Home and End against the live count, which the key table cannot know', () => {
    const { host, instance } = mount({ target: '.slide' })
    press(host, 'End')
    expect(host.getAttribute('data-kui-step')).toBe('3')
    press(host, 'Home')
    expect(host.getAttribute('data-kui-step')).toBe('0')
    instance.destroy()
  })

  it('leaves a modified press to the browser', () => {
    // Cmd/Ctrl-Home is "top of document" and stealing it would be worse than not binding the key.
    const { host, instance } = mount({ target: '.slide' })
    press(host, 'End', { metaKey: true })
    expect(host.getAttribute('data-kui-step')).toBe('0')
    instance.destroy()
  })

  it('ignores a key it does not bind, without consuming it', () => {
    const { host, instance } = mount({ target: '.slide' })
    const event = press(host, 'Tab')
    expect(event.defaultPrevented).toBe(false)
    expect(host.getAttribute('data-kui-step')).toBe('0')
    instance.destroy()
  })

  it('stays operable by keyboard even when the ring cannot be grabbed', () => {
    // `grab:false` is a request to turn off a *gesture*, not to remove the only remaining way in
    // for anyone who does not use a pointer.
    const { host, instance } = mount({ target: '.slide', grab: 'false' })
    press(host, 'ArrowRight')
    expect(host.getAttribute('data-kui-step')).toBe('1')
    instance.destroy()
  })
})

describe('focusability', () => {
  it('makes the ring focusable, and takes it back on teardown', () => {
    const { host, instance } = mount({ target: '.slide' })
    expect(host.getAttribute('tabindex')).toBe('0')
    instance.destroy()
    expect(host.getAttribute('tabindex')).toBeNull()
  })

  it('leaves an authored tabindex alone in both directions', () => {
    /*
     * A `-1` the author set deliberately to keep the deck out of the tab order is a decision this
     * library cannot see the reason for, and overruling it would be worse than not helping. Writing
     * the attribute only when it is absent leaves that decision where it belongs — and, just as
     * importantly, teardown must not remove an attribute this instance never added.
     */
    const { host, instance } = mount(
      { target: '.slide' },
      `<div tabindex="-1"><span class="slide">one</span></div>`,
    )
    expect(host.getAttribute('tabindex')).toBe('-1')
    instance.destroy()
    expect(host.getAttribute('tabindex')).toBe('-1')
  })
})
