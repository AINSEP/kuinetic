// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createStyleLedger } from '../src/core/owned-styles.js'
import { readEffectParams, readParams } from '../src/core/js-params.js'
import type { PrepareContext } from '../src/core/effect-context.js'
import type { EffectInstance } from '../src/core/types.js'
import { SPATIAL_RING_PRIMITIVE } from '../src/effects/carousel/index.js'
import { offsetWrapped, SPINNING_ATTR, WRAP_ATTR } from '../src/effects/carousel/deck.js'
import { clampPeriod, createAutoMotion, cyclesFor, MAX_FRAME_MS, MIN_PERIOD_MS } from '../src/effects/auto-motion.js'

/**
 * `spin:` and `autoplay:` — the deck moving on its own, and yielding to a person.
 *
 * The clock is vitest's fake one, frames included, handed to the deck through a stand-in `win` —
 * the same injection `prepare` already uses for `getComputedStyle` — so "a quarter of a 40-second
 * period" is a quarter of 40 seconds exactly, not whatever the machine managed. The observer is a
 * stub the test drives, because jsdom has none and "offscreen" is otherwise unreachable.
 *
 * Jsdom never renders a frame, so what is asserted is the number the stylesheet turns into
 * geometry (`--kui-step-position`) and the attributes it keys the transition off. That the ring
 * visibly turns is the browser tier's (`test/browser/carousel-motion.test.mjs`).
 */

/** The most recently constructed stub observer — the one the deck under test is watching with. */
const observers: { last: FakeObserver | null } = { last: null }

class FakeObserver {
  constructor(readonly callback: (entries: { isIntersecting: boolean }[]) => void) {
    observers.last = this
  }
  observe(): void {}
  disconnect(): void {}
  report(isIntersecting: boolean): void {
    this.callback([{ isIntersecting }])
  }
}

function fakeWin(): Window {
  return {
    requestAnimationFrame: (cb: FrameRequestCallback) => requestAnimationFrame(cb),
    cancelAnimationFrame: (handle: number) => cancelAnimationFrame(handle),
    setTimeout: (cb: () => void, ms: number) => setTimeout(cb, ms),
    clearTimeout: (handle: number) => clearTimeout(handle),
    getComputedStyle: (node: Element) => window.getComputedStyle(node),
    IntersectionObserver: FakeObserver,
  } as unknown as Window
}

interface MountOptions {
  reducedMotion?: boolean
  warn?: (m: string) => void
  /** A realm with no `requestAnimationFrame`, so the timer fallback drives the spin. */
  noFrames?: boolean
}

function frameless(): Window {
  const win = fakeWin() as unknown as Record<string, unknown>
  delete win.requestAnimationFrame
  delete win.cancelAnimationFrame
  return win as unknown as Window
}

function fakeCtx(el: Element, options: MountOptions = {}): PrepareContext {
  return {
    win: options.noFrames ? frameless() : fakeWin(),
    doc: window.document,
    reducedMotion: options.reducedMotion ?? false,
    warn: options.warn ?? (() => {}),
    style: createStyleLedger(el),
  } as unknown as PrepareContext
}

const DECK = `
  <div>
    <div class="slide">one</div>
    <div class="slide">two</div>
    <div class="slide">three</div>
    <div class="slide">four</div>
    <button class="toggle" type="button">Pause</button>
    <button class="fwd" type="button">Next</button>
  </div>
`

function mount(
  params: Record<string, string>,
  options: MountOptions = {},
): { host: HTMLElement; instance: EffectInstance } {
  document.body.innerHTML = DECK
  const host = document.body.firstElementChild as HTMLElement
  const instance = SPATIAL_RING_PRIMITIVE.prepare!(
    host,
    readEffectParams({ target: '.slide', ...params }, SPATIAL_RING_PRIMITIVE.parameters, () => {}),
    fakeCtx(host, options),
  )
  instance.activate()
  return { host, instance }
}

/** Where the ring is, in places, modulo the deck — the one number the geometry reads. */
function placeOf(host: HTMLElement): number {
  return Number(host.style.getPropertyValue('--kui-step-position'))
}

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'Date'],
  })
  observers.last = null
})

afterEach(() => {
  vi.useRealTimers()
  document.body.innerHTML = ''
})

describe('the motion arithmetic', () => {
  it('floors a period at two seconds either way, keeps its sign, and leaves off as off', () => {
    expect(clampPeriod(0)).toBe(0)
    expect(clampPeriod(40_000)).toBe(40_000)
    expect(clampPeriod(-40_000)).toBe(-40_000)
    expect(clampPeriod(500)).toBe(MIN_PERIOD_MS)
    expect(clampPeriod(-500)).toBe(-MIN_PERIOD_MS)
    expect(clampPeriod(Number.NaN)).toBe(0)
  })

  it('advances by the frame over the period, and a long frame only as far as the cap', () => {
    expect(cyclesFor(16, 40_000)).toBeCloseTo(16 / 40_000)
    expect(cyclesFor(16, -40_000)).toBeCloseTo(-16 / 40_000)
    expect(cyclesFor(5_000, 40_000)).toBeCloseTo(MAX_FRAME_MS / 40_000)
    expect(cyclesFor(-3, 40_000)).toBe(0)
  })

  it('calls a jump of more than half the deck a wrap, and a real step not one', () => {
    expect(offsetWrapped(-2, -3, 6)).toBe(false)
    expect(offsetWrapped(-3, 2, 6)).toBe(true)
    expect(offsetWrapped(0, 2, 4)).toBe(false)
  })
})

describe('spin: and autoplay: as parameters', () => {
  const schema = SPATIAL_RING_PRIMITIVE.parameters

  it('are off by default, so every existing ring is unchanged', () => {
    const values = readParams({}, schema, () => {})
    expect(values.spin).toBe('0s')
    expect(values.autoplay).toBe('0s')
  })

  it('take a signed time, and refuse a word', () => {
    const warnings: string[] = []
    expect(readParams({ spin: '-40s' }, schema, (m) => warnings.push(m)).spin).toBe('-40s')
    expect(readParams({ spin: '1200ms' }, schema, (m) => warnings.push(m)).spin).toBe('1200ms')
    expect(warnings).toEqual([])
    readParams({ spin: 'fast' }, schema, (m) => warnings.push(m))
    expect(warnings).toHaveLength(1)
  })
})

describe('continuous spin', () => {
  it('turns the ring by one cycle per period, continuously', () => {
    const { host, instance } = mount({ spin: '40s' })
    expect(host.getAttribute(SPINNING_ATTR)).toBe('true')

    // Four slides, 40s a cycle: ten seconds is one place. The first frame only reads the clock.
    vi.advanceTimersByTime(10_000)
    expect(placeOf(host)).toBeCloseTo(1, 1)
    // Between two places, not snapped to one — that is the difference from stepping.
    vi.advanceTimersByTime(5_000)
    expect(placeOf(host)).toBeCloseTo(1.5, 1)
    instance.destroy()
  })

  it('runs the other way for a negative period', () => {
    const { host, instance } = mount({ spin: '-40s' })
    vi.advanceTimersByTime(10_000)
    // One place backwards from 0 is the last slide, 3, of four.
    expect(host.getAttribute('data-kui-step')).toBe('3')
    expect(placeOf(host)).toBeCloseTo(3, 1)
    instance.destroy()
  })

  it('warns and clamps a period under the floor', () => {
    const warnings: string[] = []
    const { instance } = mount({ spin: '500ms' }, { warn: (m) => warnings.push(m) })
    expect(warnings.some((m) => m.includes('spin: minimum is 2s'))).toBe(true)
    instance.destroy()
  })

  it('stops under the pointer and resumes exactly where it stopped', () => {
    const { host, instance } = mount({ spin: '40s' })
    vi.advanceTimersByTime(4_000)
    host.dispatchEvent(new Event('pointerenter'))
    expect(host.getAttribute(SPINNING_ATTR)).toBe('false')
    const held = placeOf(host)
    vi.advanceTimersByTime(20_000)
    expect(placeOf(host)).toBe(held)

    host.dispatchEvent(new Event('pointerleave'))
    // One frame after resuming, the ring has not leapt by the 20 seconds it was paused for.
    vi.advanceTimersByTime(32)
    expect(placeOf(host) - held).toBeLessThan(0.01)
    expect(placeOf(host)).toBeGreaterThan(held)
    instance.destroy()
  })

  it('stops while the tab is hidden', () => {
    const { host, instance } = mount({ spin: '40s' })
    Object.defineProperty(document, 'hidden', { value: true, configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
    const held = placeOf(host)
    vi.advanceTimersByTime(10_000)
    expect(placeOf(host)).toBe(held)
    Object.defineProperty(document, 'hidden', { value: false, configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
    vi.advanceTimersByTime(10_000)
    expect(placeOf(host)).toBeGreaterThan(held)
    instance.destroy()
  })

  it('stops while scrolled out of view', () => {
    const { host, instance } = mount({ spin: '40s' })
    observers.last!.report(false)
    const held = placeOf(host)
    vi.advanceTimersByTime(10_000)
    expect(placeOf(host)).toBe(held)
    observers.last!.report(true)
    vi.advanceTimersByTime(10_000)
    expect(placeOf(host)).toBeGreaterThan(held)
    instance.destroy()
  })

  it('does not start under reduced motion, until the visitor presses play', () => {
    const { host, instance } = mount({ spin: '40s', pause: '.toggle' }, { reducedMotion: true })
    const toggle = host.querySelector('.toggle')!
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    vi.advanceTimersByTime(10_000)
    expect(placeOf(host)).toBe(0)

    toggle.dispatchEvent(new Event('click', { bubbles: true }))
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    vi.advanceTimersByTime(10_000)
    expect(placeOf(host)).toBeGreaterThan(0.5)
    instance.destroy()
    expect(toggle.hasAttribute('aria-pressed')).toBe(false)
  })

  it('pauses and resumes from the author’s pause control', () => {
    const { host, instance } = mount({ spin: '40s', pause: '.toggle' })
    const toggle = host.querySelector('.toggle')!
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    vi.advanceTimersByTime(5_000)
    toggle.dispatchEvent(new Event('click', { bubbles: true }))
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    const held = placeOf(host)
    vi.advanceTimersByTime(10_000)
    expect(placeOf(host)).toBe(held)
    instance.destroy()
  })

  it('warns about a pause control with nothing to pause', () => {
    const warnings: string[] = []
    const { instance } = mount({ pause: '.toggle' }, { warn: (m) => warnings.push(m) })
    expect(warnings.some((m) => m.includes('nothing to pause'))).toBe(true)
    instance.destroy()
  })

  it('yields to a control, lets it travel, then carries on from where it landed', () => {
    const { host, instance } = mount({ spin: '40s', next: '.fwd', duration: '600ms' })
    vi.advanceTimersByTime(4_000)
    host.querySelector('.fwd')!.dispatchEvent(new Event('click', { bubbles: true }))
    // The transition is handed back in the same task as the move, so the click travels.
    expect(host.getAttribute(SPINNING_ATTR)).toBe('false')
    expect(host.getAttribute('data-kui-step')).toBe('1')
    expect(placeOf(host)).toBe(1)

    // Held while the 600ms travel plays out...
    vi.advanceTimersByTime(500)
    expect(placeOf(host)).toBe(1)
    // ...then spinning again from place 1, not from where the spin would have been.
    vi.advanceTimersByTime(4_000)
    expect(host.getAttribute(SPINNING_ATTR)).toBe('true')
    expect(placeOf(host)).toBeGreaterThan(1)
    expect(placeOf(host)).toBeLessThan(1.5)
    instance.destroy()
  })

  it('holds for as long as a drag is in progress, however still the finger is', () => {
    const { host, instance } = mount({ spin: '40s' })
    const pointer = (type: string, clientX: number): Event => {
      const event = new Event(type, { bubbles: true }) as Event & Record<string, number>
      Object.assign(event, { clientX, clientY: 0, pointerId: 1, button: 0 })
      return event
    }
    host.dispatchEvent(pointer('pointerdown', 300))
    host.dispatchEvent(pointer('pointermove', 250))
    expect(host.getAttribute('data-kui-ring-dragging')).toBe('true')
    const held = placeOf(host)
    vi.advanceTimersByTime(5_000)
    expect(placeOf(host)).toBe(held)
    host.dispatchEvent(pointer('pointerup', 250))
    vi.advanceTimersByTime(5_000)
    expect(host.getAttribute(SPINNING_ATTR)).toBe('true')
    instance.destroy()
  })

  it('stops scheduling frames and gives every attribute back on destroy', () => {
    const { host, instance } = mount({ spin: '40s' })
    vi.advanceTimersByTime(3_000)
    instance.destroy()
    expect(host.hasAttribute(SPINNING_ATTR)).toBe(false)
    expect(host.style.getPropertyValue('--kui-step-position')).toBe('')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('never leaves the wrap flag behind on any slot', () => {
    const { host, instance } = mount({ spin: '40s' })
    vi.advanceTimersByTime(40_000)
    expect(host.querySelectorAll(`[${WRAP_ATTR}]`)).toHaveLength(0)
    instance.destroy()
  })
})

describe('stepped autoplay', () => {
  it('rests on each slide for the dwell, then steps, both ways', () => {
    const forward = mount({ autoplay: '3s' })
    expect(forward.host.getAttribute('data-kui-step')).toBe('0')
    vi.advanceTimersByTime(2_999)
    expect(forward.host.getAttribute('data-kui-step')).toBe('0')
    vi.advanceTimersByTime(1)
    expect(forward.host.getAttribute('data-kui-step')).toBe('1')
    // Stepped, not spun: the stylesheet's transition does the travel.
    expect(forward.host.getAttribute(SPINNING_ATTR)).toBeNull()
    forward.instance.destroy()

    const backward = mount({ autoplay: '-3s' })
    vi.advanceTimersByTime(3_000)
    expect(backward.host.getAttribute('data-kui-step')).toBe('3')
    backward.instance.destroy()
  })

  it('lets spin: win when both are set, and says so', () => {
    const warnings: string[] = []
    const { host, instance } = mount({ spin: '40s', autoplay: '3s' }, { warn: (m) => warnings.push(m) })
    expect(warnings.some((m) => m.includes('spin: wins'))).toBe(true)
    expect(host.getAttribute(SPINNING_ATTR)).toBe('true')
    instance.destroy()
  })
})

describe('keyboard focus', () => {
  const focusIn = (target: Element): void => {
    target.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
  }
  const focusOut = (target: Element, relatedTarget: EventTarget | null): void => {
    target.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget }))
  }
  /** Answer `:focus-visible` for one node the way a browser would for the given kind of focus. */
  const focusVisible = (node: Element, visible: boolean): void => {
    Object.defineProperty(node, 'matches', { value: (selector: string) => selector === ':focus-visible' && visible, configurable: true })
  }

  it('pauses on keyboard focus inside the deck and resumes when focus leaves it', () => {
    const { host, instance } = mount({ spin: '40s' })
    const button = host.querySelector('.fwd')!
    focusVisible(button, true)
    focusIn(button)
    expect(host.getAttribute(SPINNING_ATTR)).toBe('false')
    const held = placeOf(host)
    vi.advanceTimersByTime(10_000)
    expect(placeOf(host)).toBe(held)

    // Tabbing to another control inside the deck keeps it paused...
    const other = host.querySelector('.toggle')!
    focusVisible(other, true)
    focusOut(button, other)
    expect(host.getAttribute(SPINNING_ATTR)).toBe('false')
    // ...and leaving the deck altogether (or the window: no related target) resumes it.
    focusOut(other, document.body)
    expect(host.getAttribute(SPINNING_ATTR)).toBe('true')
    focusIn(other)
    focusOut(other, null)
    expect(host.getAttribute(SPINNING_ATTR)).toBe('true')
    instance.destroy()
  })

  it('does not pause on the focus a mouse press gives the host', () => {
    const { host, instance } = mount({ spin: '40s' })
    focusVisible(host, false)
    focusIn(host)
    expect(host.getAttribute(SPINNING_ATTR)).toBe('true')
    instance.destroy()
  })

  it('reads focus it cannot classify as keyboard focus, and pauses', () => {
    const { host, instance } = mount({ spin: '40s' })
    // A realm that cannot parse `:focus-visible` throws from `matches`.
    const slide = host.querySelector('.slide')!
    Object.defineProperty(slide, 'matches', { value: () => { throw new SyntaxError('unsupported') }, configurable: true })
    focusIn(slide)
    expect(host.getAttribute(SPINNING_ATTR)).toBe('false')
    // A node with no `matches` at all (a text node as the related target) is treated the same way.
    focusOut(slide, host.querySelector('.slide')!.firstChild)
    expect(host.getAttribute(SPINNING_ATTR)).toBe('false')
    instance.destroy()
  })
})

describe('the scheduler’s edges', () => {
  it('pauses and resumes autoplay under the pointer, without a second timer', () => {
    const { host, instance } = mount({ autoplay: '3s' })
    vi.advanceTimersByTime(2_000)
    host.dispatchEvent(new Event('pointerenter'))
    // A second reason to stop while already stopped has no timer to clear.
    host.dispatchEvent(new Event('pointerenter'))
    expect(vi.getTimerCount()).toBe(0)
    vi.advanceTimersByTime(10_000)
    expect(host.getAttribute('data-kui-step')).toBe('0')
    host.dispatchEvent(new Event('pointerleave'))
    // A second resume while already running must not arm a second timer.
    host.dispatchEvent(new Event('pointerleave'))
    expect(vi.getTimerCount()).toBe(1)
    vi.advanceTimersByTime(3_000)
    expect(host.getAttribute('data-kui-step')).toBe('1')
    instance.destroy()
  })

  it('does not start a second frame loop when asked to run while already running', () => {
    const { host, instance } = mount({ spin: '40s' })
    host.dispatchEvent(new Event('pointerleave'))
    expect(vi.getTimerCount()).toBe(1)
    instance.destroy()
  })

  it('drops a frame that arrives after the deck stopped being allowed to move', () => {
    const { host, instance } = mount({ spin: '40s' })
    vi.advanceTimersByTime(1_000)
    // Hidden with no visibilitychange yet: the next frame sees it first and stops the loop.
    Object.defineProperty(document, 'hidden', { value: true, configurable: true })
    const held = placeOf(host)
    vi.advanceTimersByTime(5_000)
    expect(placeOf(host)).toBe(held)
    expect(vi.getTimerCount()).toBe(0)
    Object.defineProperty(document, 'hidden', { value: false, configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
    vi.advanceTimersByTime(5_000)
    expect(placeOf(host)).toBeGreaterThan(held)
    instance.destroy()
  })

  it('restarts the settle hold on a second press, and clears it on destroy', () => {
    const { host, instance } = mount({ spin: '40s', next: '.fwd', duration: '600ms' })
    const next = host.querySelector('.fwd')!
    next.dispatchEvent(new Event('click', { bubbles: true }))
    vi.advanceTimersByTime(400)
    next.dispatchEvent(new Event('click', { bubbles: true }))
    // 800ms after the first press but only 400ms after the second: still held.
    vi.advanceTimersByTime(400)
    expect(host.getAttribute(SPINNING_ATTR)).toBe('false')
    expect(placeOf(host)).toBe(2)
    instance.destroy()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('spins on timers in a realm with no requestAnimationFrame, and cancels them on destroy', () => {
    const { host, instance } = mount({ spin: '40s' }, { noFrames: true })
    vi.advanceTimersByTime(10_000)
    expect(placeOf(host)).toBeCloseTo(1, 1)
    instance.destroy()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('warns and clamps an autoplay dwell under the floor', () => {
    const warnings: string[] = []
    const { instance } = mount({ autoplay: '500ms' }, { warn: (m) => warnings.push(m) })
    expect(warnings.some((m) => m.includes('autoplay: minimum is 2s'))).toBe(true)
    instance.destroy()
  })

  it('is inert when neither motion is configured', () => {
    document.body.innerHTML = DECK
    const host = document.body.firstElementChild as HTMLElement
    const calls: string[] = []
    const motion = createAutoMotion({
      el: host,
      ctx: fakeCtx(host),
      spinMs: 0,
      autoplayMs: 0,
      settleMs: 600,
      advance: () => calls.push('advance'),
      step: () => calls.push('step'),
      setSpinning: () => calls.push('setSpinning'),
      onPausedChange: () => calls.push('onPausedChange'),
    })
    expect(motion.enabled).toBe(false)
    motion.interrupt()
    motion.hold(true)
    motion.toggle()
    motion.release()
    vi.advanceTimersByTime(10_000)
    expect(calls).toEqual([])
    expect(vi.getTimerCount()).toBe(0)
  })
})
