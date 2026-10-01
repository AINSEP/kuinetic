// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Animator } from '../src/core/animator.js'
import { announceViewer, VIEWER_EVENT } from '../src/core/deck-viewer.js'
import { SPINNING_ATTR } from '../src/effects/carousel/deck.js'
import { build } from './support/js-effect-harness.js'

/**
 * A deck that moves on its own holds still while its lightbox is open, and carries on when it
 * closes: `autoplay:` on the step deck, `spin:` on the spatial ones, opened by the deck's own
 * `lightbox:true` or by a `lightbox` effect composed on it.
 *
 * The seam is `kui:viewer` (`core/deck-viewer.ts`), announced by the shared modal shell from the
 * element that opened it and heard by the deck's scheduler (`effects/auto-motion.ts`) as one more
 * pause reason. Through the full animator, because the two halves only meet in a real registry.
 *
 * Fake timers include frames: a spin is `requestAnimationFrame`, autoplay is `setTimeout`, and
 * "teardown leaves nothing running" is `vi.getTimerCount()` being zero.
 */

const active: Animator[] = []
const start = (html: string): Animator => {
  const animator = build(html)
  active.push(animator)
  animator.start()
  return animator
}
const destroy = (animator: Animator): void => {
  animator.destroy()
  active.splice(active.indexOf(animator), 1)
}
const dialog = (): HTMLDialogElement | null => document.querySelector('dialog.kui-lightbox')
const isOpen = (): boolean => dialog()?.open === true
const click = (target: Element): void => {
  target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }))
}
const byId = (id: string): HTMLElement => document.getElementById(id)!
const deck = (): HTMLElement => byId('deck')
const step = (): string | null => deck().getAttribute('data-kui-step')
const place = (): number => Number(deck().style.getPropertyValue('--kui-step-position'))
const openCard = (id: string): void => {
  click(byId(id).querySelector('img')!)
  expect(isOpen()).toBe(true)
}
const closeViewer = (): void => {
  dialog()!.close()
  expect(isOpen()).toBe(false)
}

const CARDS = `
  <figure id="c0"><img src="/a.jpg" alt="Alpha"></figure>
  <figure id="c1"><img src="/b.jpg" alt="Bravo"></figure>
  <figure id="c2"><img src="/c.jpg" alt="Charlie"></figure>
  <figure id="c3"><img src="/d.jpg" alt="Delta"></figure>
`
const PAUSE = '<button id="toggle" class="toggle" type="button">Pause</button>'

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'Date'],
  })
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

describe('autoplay: on the carousel step deck, with lightbox:true', () => {
  const html = (extra = ''): string =>
    `<div id="deck" data-kui="carousel autoplay:3s lightbox:true target:figure ${extra}">${CARDS}${PAUSE}</div>`

  it('holds its slide while the viewer is open', () => {
    start(html())
    vi.advanceTimersByTime(2000)
    openCard('c2')
    // Under the four-slide period a full cycle would wrap back to 0, so stay short of one.
    vi.advanceTimersByTime(5000)
    expect(step()).toBe('0')
  })

  it('resumes on close from the slide it was on, a full period later', () => {
    start(html())
    vi.advanceTimersByTime(2000)
    openCard('c2')
    // Paging the gallery does not move the deck.
    click(dialog()!.querySelector('.kui-lightbox-next')!)
    vi.advanceTimersByTime(5000)
    closeViewer()
    expect(step()).toBe('0')
    // The step pending at open was cleared, not suspended: no catch-up, no short first period.
    vi.advanceTimersByTime(2999)
    expect(step()).toBe('0')
    vi.advanceTimersByTime(1)
    expect(step()).toBe('1')
  })

  it('stays paused after the viewer closes when the visitor paused it', () => {
    start(html('pause:.toggle'))
    click(byId('toggle'))
    expect(byId('toggle').getAttribute('aria-pressed')).toBe('true')
    openCard('c1')
    closeViewer()
    vi.advanceTimersByTime(5000)
    expect(step()).toBe('0')
    // Closing lifted only its own reason; the visitor's play still works.
    click(byId('toggle'))
    vi.advanceTimersByTime(3000)
    expect(step()).toBe('1')
  })

  it('leaves no timer running when torn down while the viewer is open', () => {
    const animator = start(html())
    openCard('c1')
    destroy(animator)
    expect(vi.getTimerCount()).toBe(0)
    // Its listener went with it: a later announcement starts nothing.
    announceViewer(document, document.body, false)
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('spin: on the spatial decks, with lightbox:true', () => {
  const html = (name: string, extra = ''): string =>
    `<div id="deck" data-kui="${name} spin:40s lightbox:true ${extra}">${CARDS}${PAUSE}</div>`

  it.each(['carousel-3d', 'carousel-orbit', 'carousel-stack'])('%s holds still while open, and resumes without a leap', (name) => {
    start(html(name))
    vi.advanceTimersByTime(4000)
    openCard('c0')
    expect(deck().getAttribute(SPINNING_ATTR)).toBe('false')
    const held = place()
    vi.advanceTimersByTime(20_000)
    expect(place()).toBe(held)

    closeViewer()
    expect(deck().getAttribute(SPINNING_ATTR)).toBe('true')
    // One frame after resuming it has not jumped by the 20 seconds it was open for.
    vi.advanceTimersByTime(32)
    expect(place()).toBeGreaterThan(held)
    expect(place() - held).toBeLessThan(0.01)
  })

  it('stays paused after the viewer closes when the visitor paused it', () => {
    start(html('carousel-3d', 'pause:.toggle'))
    vi.advanceTimersByTime(4000)
    click(byId('toggle'))
    const held = place()
    openCard('c0')
    closeViewer()
    vi.advanceTimersByTime(10_000)
    expect(place()).toBe(held)
    expect(deck().getAttribute(SPINNING_ATTR)).toBe('false')
  })

  it('leaves no frame running when torn down while the viewer is open', () => {
    const animator = start(html('carousel-stack'))
    openCard('c0')
    destroy(animator)
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('which viewer pauses which deck', () => {
  it('a lightbox effect composed on the deck pauses it too', () => {
    start(`<div id="deck" data-kui="carousel-3d spin:40s, lightbox">${CARDS}</div>`)
    vi.advanceTimersByTime(4000)
    openCard('c0')
    const held = place()
    vi.advanceTimersByTime(10_000)
    expect(place()).toBe(held)
    closeViewer()
    vi.advanceTimersByTime(10_000)
    expect(place()).toBeGreaterThan(held)
  })

  it('a viewer opened from outside the deck leaves it moving', () => {
    start(`<div id="deck" data-kui="carousel autoplay:3s target:figure">${CARDS}</div>` +
      `<div data-kui="lightbox"><figure id="out"><img src="/z.jpg" alt="Zulu"></figure></div>`)
    openCard('out')
    vi.advanceTimersByTime(3000)
    expect(step()).toBe('1')
  })

  it('a viewer replaced by one from outside the deck lets the deck go', () => {
    start(`<div id="deck" data-kui="carousel autoplay:3s lightbox:true target:figure">${CARDS}</div>` +
      `<div data-kui="lightbox"><figure id="out"><img src="/z.jpg" alt="Zulu"></figure></div>`)
    openCard('c1')
    openCard('out')
    vi.advanceTimersByTime(3000)
    expect(step()).toBe('1')
  })

  it('reads an announcement with no detail as a close', () => {
    start(`<div id="deck" data-kui="carousel autoplay:3s lightbox:true target:figure">${CARDS}</div>`)
    openCard('c1')
    byId('c1').dispatchEvent(new Event(VIEWER_EVENT, { bubbles: true }))
    vi.advanceTimersByTime(3000)
    expect(step()).toBe('1')
  })

  it('resumes when the card that opened the viewer was removed before it closed', () => {
    start(`<div id="deck" data-kui="carousel autoplay:3s lightbox:true target:figure">${CARDS}</div>`)
    openCard('c3')
    byId('c3').remove()
    closeViewer()
    vi.advanceTimersByTime(3000)
    expect(step()).toBe('1')
  })
})

describe('announceViewer', () => {
  it('announces from the opener, bubbling, with whether it opened', () => {
    const opener = document.body.appendChild(document.createElement('figure'))
    const heard: Array<{ target: EventTarget | null; open: boolean }> = []
    const listen = (event: Event): void => {
      heard.push({ target: event.target, open: (event as CustomEvent<{ open: boolean }>).detail.open })
    }
    document.addEventListener(VIEWER_EVENT, listen)
    announceViewer(document, opener, true)
    opener.remove()
    announceViewer(document, opener, false)
    document.removeEventListener(VIEWER_EVENT, listen)
    expect(heard).toEqual([{ target: opener, open: true }, { target: document, open: false }])
  })

  it('works in a document with no window', () => {
    const doc = document.implementation.createHTMLDocument('')
    const opener = doc.body.appendChild(doc.createElement('figure'))
    const seen = vi.fn()
    doc.addEventListener(VIEWER_EVENT, seen)
    announceViewer(doc, opener, true)
    expect(seen).toHaveBeenCalledTimes(1)
  })
})
