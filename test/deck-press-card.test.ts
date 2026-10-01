// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Animator } from '../src/core/animator.js'
import { build } from './support/js-effect-harness.js'

/**
 * `lightbox:true` opens the card that was under the pointer when it was PRESSED.
 *
 * Two real-browser failures, stood in here with a mocked `elementsFromPoint` (jsdom has no hit
 * testing): a concave ring's cards sit behind its host's plane, so the host wins the hit test and
 * every click arrives at the host; and a deck still moving under a slow press (`hover:none`, touch)
 * carries the pressed card away, so the click lands on a neighbour. The browser tier
 * (`test/browser/deck-drag-direction.test.mjs`) does both with a real mouse.
 */

const active: Animator[] = []
const start = (html: string): HTMLElement => {
  const animator = build(html)
  active.push(animator)
  animator.start()
  return document.querySelector('[data-kui]') as HTMLElement
}
const dialog = (): HTMLDialogElement | null => document.querySelector('dialog.kui-lightbox')
const isOpen = (): boolean => dialog()?.open === true
const shownAlt = (): string | undefined => dialog()?.querySelector('figure img')?.getAttribute('alt') ?? undefined

/** What `elementsFromPoint` answers, top first; set per test. */
let underPoint: () => Element[] = () => []

function press(target: Element, button = 0): void {
  const event = new Event('pointerdown', { bubbles: true }) as Event & Record<string, number>
  Object.assign(event, { clientX: 100, clientY: 50, pointerId: 1, button })
  target.dispatchEvent(event)
}
function click(target: Element, detail = 1): MouseEvent {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, detail })
  target.dispatchEvent(event)
  return event
}

const CARDS = `
  <figure id="c0"><img src="/a.jpg" alt="Alpha"></figure>
  <figure id="c1"><img src="/b.jpg" alt="Bravo"><button id="buy" type="button">Buy</button></figure>
  <figure id="c2"><img src="/c.jpg" alt="Charlie"></figure>
  <figure id="c3"><img src="/d.jpg" alt="Delta"></figure>
  <figure id="c4"><img src="/e.jpg" alt="Echo"></figure>
  <figure id="c5"><img src="/f.jpg" alt="Foxtrot"></figure>
`
// Six cards round a full ring: c1 and c5 are the live card's neighbours (60 degrees, facing the
// viewer); c2, c3 and c4 are turned away.

beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value(this: HTMLDialogElement) {
    this.setAttribute('open', '')
  } })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value(this: HTMLDialogElement) {
    this.removeAttribute('open')
    this.dispatchEvent(new Event('close'))
  } })
  underPoint = () => []
  Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: () => underPoint() })
})

afterEach(() => {
  for (const animator of active.splice(0).reverse()) animator.destroy()
  delete (document as unknown as Record<string, unknown>).elementsFromPoint
  vi.useRealTimers()
  document.body.replaceChildren()
})

describe('lightbox:true opens the pressed card', () => {
  it('when the host wins the hit test (a concave ring), the card behind it still opens', () => {
    const host = start(`<div id="ring" data-kui="carousel-3d-inside lightbox:true">${CARDS}</div>`)
    const card = document.getElementById('c2')!
    underPoint = () => [host, card.querySelector('img')!, card, document.body]
    press(host)
    click(host)
    expect(isOpen()).toBe(true)
    expect(shownAlt()).toBe('Charlie')
  })

  it('a spinning deck that slides a neighbour under a slow press opens the card pressed', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'Date'] })
    const host = start(`<div id="ring" data-kui="carousel-3d autoplay:2s hover:none lightbox:true">${CARDS}</div>`)
    const live = (): Element => host.querySelector('[data-kui-step-state="active"]')!
    underPoint = () => [live().querySelector('img')!, live(), host]
    const pressedAlt = live().querySelector('img')!.getAttribute('alt')
    press(live().querySelector('img')!)
    // A slow press: the deck steps on while it is held, and the release lands on the new card.
    vi.advanceTimersByTime(2_000)
    expect(live().querySelector('img')!.getAttribute('alt')).not.toBe(pressedAlt)
    click(live().querySelector('img')!)
    expect(isOpen()).toBe(true)
    expect(shownAlt()).toBe(pressedAlt)
  })

  it('a press held so long the pressed card has turned away still opens that card', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'Date'] })
    const host = start(`<div id="ring" data-kui="carousel-3d autoplay:2s hover:none lightbox:true">${CARDS}</div>`)
    const card = document.getElementById('c0')!
    underPoint = () => [card.querySelector('img')!, card, host]
    press(host)
    vi.advanceTimersByTime(4_000)
    expect(card.getAttribute('data-kui-ring-face')).toBe('back')
    click(host)
    expect(shownAlt()).toBe('Alpha')
  })

  it('a press on a button inside a card leaves it its own click, even when the host took the hit', () => {
    const host = start(`<div id="ring" data-kui="carousel-3d lightbox:true">${CARDS}</div>`)
    const card = document.getElementById('c1')!
    underPoint = () => [host, document.getElementById('buy')!, card]
    press(host)
    click(host)
    expect(dialog()?.open ?? false).toBe(false)
  })

  it('a keyboard click (no pointer) is about its own target, not a stale press', () => {
    const host = start(`<div id="ring" data-kui="carousel-3d lightbox:true">${CARDS}</div>`)
    underPoint = () => [document.getElementById('c1')!]
    press(host)
    // A press that never clicked (released elsewhere), then Enter on another card's image.
    click(document.getElementById('c0')!.querySelector('img')!, 0)
    expect(shownAlt()).toBe('Alpha')
  })

  it('a press is spent by its click: the next click without a press uses its own target', () => {
    const host = start(`<div id="ring" data-kui="carousel-3d lightbox:true">${CARDS}</div>`)
    underPoint = () => [document.getElementById('c1')!]
    press(host)
    click(document.getElementById('c1')!)
    expect(shownAlt()).toBe('Bravo')
    dialog()!.close()
    click(document.getElementById('c0')!.querySelector('img')!)
    expect(shownAlt()).toBe('Alpha')
  })

  it('a secondary-button press records nothing', () => {
    const host = start(`<div id="ring" data-kui="carousel-3d lightbox:true">${CARDS}</div>`)
    underPoint = () => [document.getElementById('c1')!]
    press(host, 2)
    click(document.getElementById('c0')!.querySelector('img')!)
    expect(shownAlt()).toBe('Alpha')
  })

  it('falls back to the press target in a realm with no elementsFromPoint', () => {
    delete (document as unknown as Record<string, unknown>).elementsFromPoint
    const host = start(`<div id="ring" data-kui="carousel-3d lightbox:true">${CARDS}</div>`)
    press(document.getElementById('c5')!.querySelector('img')!)
    click(host)
    expect(shownAlt()).toBe('Foxtrot')
  })

  it('a card already turned away at the press opens nothing', () => {
    const host = start(`<div id="ring" data-kui="carousel-3d lightbox:true">${CARDS}</div>`)
    const away = document.getElementById('c3')!
    expect(away.getAttribute('data-kui-ring-face')).toBe('back')
    underPoint = () => [host, away]
    press(host)
    click(host)
    expect(dialog()?.open ?? false).toBe(false)
  })

  it('stops listening for presses on teardown', () => {
    const host = start(`<div id="ring" data-kui="carousel-3d lightbox:true">${CARDS}</div>`)
    const asked = vi.fn(() => [] as Element[])
    underPoint = asked
    press(host)
    expect(asked).toHaveBeenCalledOnce()
    for (const animator of active.splice(0)) animator.destroy()
    press(host)
    expect(asked).toHaveBeenCalledOnce()
  })
})
