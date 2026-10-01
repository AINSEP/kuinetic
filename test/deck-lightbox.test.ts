// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Animator } from '../src/core/animator.js'
import { collectingReporter } from '../src/core/reporter.js'
import { build } from './support/js-effect-harness.js'

/**
 * `lightbox:true` on a deck: a click on a card opens every card of that deck in the shared lightbox
 * gallery, at the card clicked.
 *
 * Through the full animator — attribute, parse, compile, prepare — because the feature is two
 * modules finding each other through `core/deck-viewer.ts`, and only the real catalog registration
 * (`registerShowcase` providing the viewer) proves they do. The "showcase not loaded" half needs a
 * registry without the showcase and a module graph where nothing ever provided it, so it lives in
 * `deck-lightbox-missing.test.ts`.
 */

const active: Animator[] = []
const start = (html: string, reporter?: ReturnType<typeof collectingReporter>): Animator => {
  const animator = build(html, reporter)
  active.push(animator)
  animator.start()
  return animator
}
const dialog = (): HTMLDialogElement | null => document.querySelector('dialog.kui-lightbox')
const isOpen = (): boolean => dialog()?.open === true
const click = (target: Element, init: MouseEventInit = {}): MouseEvent => {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init })
  target.dispatchEvent(event)
  return event
}
const key = (target: Element, name: string): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true })
  target.dispatchEvent(event)
  return event
}
const counter = (): string | undefined => dialog()?.querySelector('.kui-lightbox-counter')?.textContent ?? undefined
const shownAlt = (): string | undefined => dialog()?.querySelector('figure img')?.getAttribute('alt') ?? undefined
const byId = (id: string): HTMLElement => document.getElementById(id)!

/** `PointerEvent` is missing from jsdom; the drag reads only coordinates and the id. */
function pointer(target: Element, type: string, clientX: number): void {
  const event = new Event(type, { bubbles: true }) as Event & { clientX: number; clientY: number; pointerId: number }
  Object.assign(event, { clientX, clientY: 0, pointerId: 1 })
  target.dispatchEvent(event)
}

/**
 * Six cards, every kind the gallery reads: a linked image, bare images (one with a button), and a
 * clip. Six because on a full ring of six the live card and its two neighbours face the viewer
 * (60 degrees either side) and the far three are turned away — `c0`, `c1` and `c5` are clickable.
 */
const CARDS = `
  <figure id="c0"><a href="/full-a.jpg"><img src="/a.jpg" alt="Alpha"></a><figcaption>Alpha card</figcaption></figure>
  <figure id="c1"><img src="/b.jpg" alt="Bravo"><button id="buy" type="button">Buy</button></figure>
  <figure id="c2"><img src="/c.jpg" alt="Charlie"></figure>
  <figure id="c3"><img src="/d.jpg" alt="Delta"></figure>
  <figure id="c4"><img src="/e.jpg" alt="Echo"></figure>
  <a id="c5" href="https://example.com/clip.mp4"><img src="/f.jpg" alt="Foxtrot poster"></a>
`

beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value(this: HTMLDialogElement) {
    this.setAttribute('open', '')
  } })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value(this: HTMLDialogElement) {
    this.removeAttribute('open')
    this.dispatchEvent(new Event('close'))
  } })
})

afterEach(() => {
  for (const animator of active.splice(0).reverse()) animator.destroy()
  vi.useRealTimers()
  document.body.replaceChildren()
  document.documentElement.removeAttribute('style')
})

describe('lightbox:true on a spatial deck', () => {
  it('opens the gallery at the card clicked, with every card of the deck in it', () => {
    start(`<div id="ring" data-kui="carousel-3d lightbox:true">${CARDS}</div>`)
    const event = click(byId('c1').querySelector('img')!)
    expect(isOpen()).toBe(true)
    // The card's own link would have navigated; the viewer shows it in place instead.
    expect(event.defaultPrevented).toBe(true)
    expect(shownAlt()).toBe('Bravo')
    expect(counter()).toBe('2 of 6')
  })

  it('cycles the deck\'s cards in the viewer, linked image first', () => {
    start(`<div data-kui="carousel-3d lightbox:true">${CARDS}</div>`)
    click(byId('c0').querySelector('img')!)
    expect(counter()).toBe('1 of 6')
    // A linked card shows its link — the full-size picture — not the thumbnail.
    expect(dialog()!.querySelector('figure img')!.getAttribute('src')).toMatch(/\/full-a\.jpg$/)
    expect(dialog()!.querySelector('figcaption')!.textContent).toBe('Alpha card')
    ;(dialog()!.querySelector('.kui-lightbox-next') as HTMLButtonElement).click()
    expect(counter()).toBe('2 of 6')
    expect(shownAlt()).toBe('Bravo')
  })

  it('plays a card that links to a clip as a video', () => {
    start(`<div data-kui="carousel-3d lightbox:true">${CARDS}</div>`)
    click(byId('c5').querySelector('img')!)
    const video = dialog()!.querySelector('video')
    expect(video?.getAttribute('src')).toBe('https://example.com/clip.mp4')
    expect(dialog()!.getAttribute('aria-label')).toBe('Media viewer')
  })

  it('does nothing without the parameter: the card is just a card', () => {
    start(`<div data-kui="carousel-3d">${CARDS}</div>`)
    expect(click(byId('c1').querySelector('img')!).defaultPrevented).toBe(false)
    expect(dialog()).toBeNull()
  })

  it('does not open after a drag: the drag swallows its own click', () => {
    start(`<div id="ring" data-kui="carousel-3d lightbox:true">${CARDS}</div>`)
    const ring = byId('ring')
    pointer(ring, 'pointerdown', 0)
    pointer(ring, 'pointermove', -120)
    pointer(ring, 'pointerup', -120)
    expect(ring.getAttribute('data-kui-step')).not.toBe('0')
    // The card now in front, so a refusal cannot be the back-face rule answering instead.
    const live = document.querySelector('[data-kui-step-state="active"] img')!
    click(live)
    expect(isOpen()).toBe(false)
    // Exactly one click was the drag's. The next one is a click, and opens.
    click(live)
    expect(isOpen()).toBe(true)
  })

  it('opens on a press that never became a drag', () => {
    start(`<div id="ring" data-kui="carousel-3d lightbox:true">${CARDS}</div>`)
    const ring = byId('ring')
    pointer(ring, 'pointerdown', 0)
    pointer(ring, 'pointermove', -2)
    pointer(ring, 'pointerup', -2)
    click(byId('c0').querySelector('img')!)
    expect(isOpen()).toBe(true)
  })

  it('ignores a card turned away from the viewer', () => {
    start(`<div data-kui="carousel-3d lightbox:true">${CARDS}</div>`)
    const back = document.querySelector('[data-kui-ring-face="back"]')
    expect(back).not.toBeNull()
    expect(click(back!.querySelector('img')!).defaultPrevented).toBe(false)
    expect(dialog()?.open ?? false).toBe(false)
  })

  it('leaves a button inside a card its own click, and a modified click to the browser', () => {
    start(`<div data-kui="carousel-3d lightbox:true">${CARDS}</div>`)
    click(byId('buy'))
    expect(isOpen()).toBe(false)
    for (const init of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) {
      expect(click(byId('c1').querySelector('img')!, init).defaultPrevented).toBe(false)
    }
    expect(isOpen()).toBe(false)
  })

  it('leaves a click alone that something else already handled, and one on no card', () => {
    start(`<div id="ring" data-kui="carousel-3d lightbox:true">${CARDS}</div>`)
    byId('c1').addEventListener('click', (event) => event.preventDefault())
    click(byId('c1').querySelector('img')!)
    expect(isOpen()).toBe(false)
    click(byId('ring'))
    expect(isOpen()).toBe(false)
  })

  it('leaves a card with no picture and no clip alone', () => {
    start(`<div data-kui="carousel-3d lightbox:true"><p id="text">Words</p>${CARDS}</div>`)
    expect(click(byId('text')).defaultPrevented).toBe(false)
    expect(isOpen()).toBe(false)
  })

  it('opens the live card on Enter or Space at the deck itself, and leaves other keys alone', () => {
    start(`<div id="ring" data-kui="carousel-3d lightbox:true">${CARDS}</div>`)
    const ring = byId('ring')
    expect(key(ring, 'a').defaultPrevented).toBe(false)
    // A key on a card's own link is that link's: the browser turns Enter into the click above.
    expect(key(byId('c0').querySelector('a')!, 'Enter').defaultPrevented).toBe(false)
    expect(isOpen()).toBe(false)
    key(ring, 'ArrowRight')
    expect(key(ring, 'Enter').defaultPrevented).toBe(true)
    expect(counter()).toBe('2 of 6')
    dialog()!.close()
    expect(key(ring, ' ').defaultPrevented).toBe(true)
    expect(isOpen()).toBe(true)
  })

  it('stops opening, and gives the dialog back, on teardown', () => {
    const animator = start(`<div data-kui="carousel-3d lightbox:true">${CARDS}</div>`)
    click(byId('c1').querySelector('img')!)
    dialog()!.close()
    animator.destroy()
    active.length = 0
    expect(dialog()).toBeNull()
    expect(click(byId('c1').querySelector('img')!).defaultPrevented).toBe(false)
    expect(dialog()).toBeNull()
  })

  it.each(['carousel-3d-high', 'carousel-3d-low', 'carousel-3d-inside', 'carousel-orbit', 'carousel-stack'])(
    '%s takes the same parameter',
    (name) => {
      start(`<div data-kui="${name} lightbox:true">${CARDS}</div>`)
      click(byId('c0').querySelector('img')!)
      expect(isOpen()).toBe(true)
      expect(counter()).toBe('1 of 6')
    },
  )
})

describe('lightbox:true on the carousel step deck', () => {
  it('opens at the slide clicked and does not also advance the deck', () => {
    start(`<div id="deck" data-kui="carousel lightbox:true">${CARDS}</div>`)
    click(byId('c3').querySelector('img')!)
    expect(isOpen()).toBe(true)
    expect(counter()).toBe('4 of 6')
    expect(byId('deck').getAttribute('data-kui-step')).toBe('0')
  })

  it('still advances on a container click without it', () => {
    start(`<div id="deck" data-kui="carousel">${CARDS}</div>`)
    click(byId('c3').querySelector('img')!)
    expect(dialog()).toBeNull()
    expect(byId('deck').getAttribute('data-kui-step')).toBe('1')
  })

  it('stops opening on teardown', () => {
    const animator = start(`<div id="deck" data-kui="carousel lightbox:true">${CARDS}</div>`)
    animator.destroy()
    active.length = 0
    expect(click(byId('c3').querySelector('img')!).defaultPrevented).toBe(false)
    expect(dialog()).toBeNull()
  })

  it('leaves its dots and arrows to step the deck', () => {
    start(`<div id="deck" data-kui="carousel lightbox:true target:.slide next:.next">
      <figure class="slide"><img src="/a.jpg" alt="A"></figure>
      <figure class="slide"><img src="/b.jpg" alt="B"></figure>
      <button class="next" type="button">Next</button>
    </div>`)
    click(document.querySelector('.next')!)
    expect(isOpen()).toBe(false)
    expect(byId('deck').getAttribute('data-kui-step')).toBe('1')
  })
})
