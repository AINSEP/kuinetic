// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createActivationBinder } from '../src/core/activation.js'
import { Animator } from '../src/core/animator.js'
import { collectingReporter } from '../src/core/reporter.js'
import { queryControls } from '../src/core/target.js'
import { CAPS, fakeRoot, idleScheduler } from './support/js-effect-harness.js'
import { catalogRegistry } from './support/registry.js'

/**
 * Controls (`next:`/`prev:`/`jump:`/`pause:`) no longer share `target:`'s `scope:`.
 *
 * A ring whose pause button sat in a band header outside it had to say `scope:page`, and that also
 * widened `target:'.ring-slot'` to every ring's slots on the page — the showcase wrote
 * `target:'#ring-landing > .ring-slot'` to get its own back. Controls now search inside the host
 * first and fall back to the page only when nothing inside matches (`core/target.ts`'s
 * `queryControls`); `scope:` is the steps' alone. Real animator, attribute to press, because the
 * coupling lived in the wiring between the two halves rather than in either.
 */

let animator: Animator | undefined
let reporter: ReturnType<typeof collectingReporter>

function start(html: string): void {
  document.body.innerHTML = html
  reporter = collectingReporter()
  animator = new Animator({
    root: document.body,
    registry: catalogRegistry(),
    capabilities: CAPS,
    binder: createActivationBinder({ createObserver: undefined }),
    scheduler: idleScheduler,
    rootResolver: () => fakeRoot,
    reporter,
  })
  animator.start()
}

const byId = (id: string): HTMLElement => document.getElementById(id)!
const stepOf = (id: string): string | null => byId(id).getAttribute('data-kui-step')
const click = (target: Element): void => {
  target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }))
}
const SLIDES = '<div class="slide">1</div><div class="slide">2</div><div class="slide">3</div>'
/** Which of a deck's slides the index marked, as their `data-kui-step-state`. */
const marks = (id: string): (string | null)[] =>
  [...byId(id).querySelectorAll('.slide')].map((slide) => slide.getAttribute('data-kui-step-state'))

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
})

afterEach(() => {
  animator?.destroy()
  animator = undefined
  vi.useRealTimers()
  document.body.replaceChildren()
})

describe('a control outside the deck, with scope: unset', () => {
  it('a page-level pause button pauses the deck and carries its aria-pressed', () => {
    start(`
      <header><button id="pp" class="band-pause">Pause</button></header>
      <div id="deck" data-kui="carousel autoplay:3s pause:.band-pause target:.slide">${SLIDES}</div>`)
    expect(reporter.messages.join()).not.toContain('matched nothing')
    expect(byId('pp').getAttribute('aria-pressed')).toBe('false')

    click(byId('pp'))
    expect(byId('pp').getAttribute('aria-pressed')).toBe('true')
    vi.advanceTimersByTime(30_000)
    expect(stepOf('deck')).toBe('0')
  })

  it('a page-level next arrow steps the deck', () => {
    start(`
      <button id="arrow" class="next">Next</button>
      <div id="deck" data-kui="carousel next:.next target:.slide">${SLIDES}</div>`)
    click(byId('arrow'))
    expect(stepOf('deck')).toBe('1')
    // A click whose target is not an element (fired at the document itself) is nobody's control.
    click(document as unknown as Element)
    expect(stepOf('deck')).toBe('1')
  })

  it('target: stays inside the deck: two decks, one shared arrow, each marks only its own slides', () => {
    start(`
      <button id="arrow" class="next">Next</button>
      <div id="a" data-kui="carousel next:.next target:.slide">${SLIDES}</div>
      <div id="b" data-kui="carousel next:.next target:.slide">${SLIDES}</div>`)
    expect(marks('a')).toEqual(['active', 'after', 'after'])
    expect(marks('b')).toEqual(['active', 'after', 'after'])

    click(byId('arrow'))
    // The shared page control drives both — the fallback's whole purpose — and each deck's index
    // moved only its own slides: three marks each, not six.
    expect([stepOf('a'), stepOf('b')]).toEqual(['1', '1'])
    expect(marks('a')).toEqual(['before', 'active', 'after'])
    expect(marks('b')).toEqual(['before', 'active', 'after'])
  })
})

describe('an inside match beats a page match', () => {
  it('drives the deck from its own arrow and ignores the page one', () => {
    start(`
      <button id="page-next" class="next">Page next</button>
      <div id="deck" data-kui="carousel next:.next target:.slide">${SLIDES}<button id="own-next" class="next">Next</button></div>`)
    click(byId('page-next'))
    expect(stepOf('deck')).toBe('0')
    click(byId('own-next'))
    expect(stepOf('deck')).toBe('1')
  })

  it('two decks each with their own arrows drive only themselves', () => {
    start(`
      <div id="a" data-kui="carousel next:.next target:.slide">${SLIDES}<button id="a-next" class="next">›</button></div>
      <div id="b" data-kui="carousel next:.next target:.slide">${SLIDES}<button id="b-next" class="next">›</button></div>`)
    click(byId('a-next'))
    expect([stepOf('a'), stepOf('b')]).toEqual(['1', '0'])
  })

  it('jump: numbers the inside dots, not every dot on the page', () => {
    start(`
      <nav><button class="dot"></button><button class="dot"></button></nav>
      <div id="deck" data-kui="carousel jump:.dot target:.slide">${SLIDES}
        <button class="dot"></button><button class="dot"></button><button id="third" class="dot"></button>
      </div>`)
    click(byId('third'))
    expect(stepOf('deck')).toBe('2')
  })

  it('a wrapper around the deck that matches next: does not turn every press inside into next', () => {
    start(`
      <div class="next" id="wrapper">
        <div id="deck" data-kui="carousel next:.next target:.slide">${SLIDES}</div>
      </div>`)
    click(byId('deck').querySelectorAll('.slide')[1]!)
    expect(stepOf('deck')).toBe('0')
    // The wrapper is a page match, so a press on the wrapper itself (outside the deck) is a press.
    click(byId('wrapper'))
    expect(stepOf('deck')).toBe('1')
  })
})

describe('scope:page', () => {
  it('still widens target: to the page, and controls still work under it', () => {
    start(`
      <div class="slide" id="far">far</div>
      <button id="arrow" class="next">Next</button>
      <div id="deck" data-kui="carousel next:.next target:.slide scope:page"></div>`)
    expect(byId('far').getAttribute('data-kui-step-state')).toBe('active')
    click(byId('arrow'))
    expect(stepOf('deck')).toBe('0') // one slide: next wraps to itself
    expect(reporter.messages.join()).not.toContain('matched nothing')
  })
})

describe('two rings on one page, one band pause button', () => {
  it('each ring takes only its own slots, and the one button pauses both', () => {
    const ring = (id: string): string =>
      `<div id="${id}" data-kui="carousel-3d target:.ring-slot spin:40s pause:.band-pause">` +
      '<div class="ring-slot"></div><div class="ring-slot"></div><div class="ring-slot"></div></div>'
    start(`<header><button id="pp" class="band-pause">Pause</button></header>${ring('r1')}${ring('r2')}`)
    for (const id of ['r1', 'r2']) {
      const offsets = [...byId(id).querySelectorAll('.ring-slot')].map((s) => s.getAttribute('data-kui-step-offset'))
      expect(offsets, id).toEqual(['0', '1', '-1'])
    }
    expect(reporter.messages.join()).not.toContain('matched nothing')
    click(byId('pp'))
    expect(byId('pp').getAttribute('aria-pressed')).toBe('true')
  })
})

describe('queryControls', () => {
  it('returns the inside matches when there are any, else the page matches', () => {
    document.body.innerHTML = '<i class="c" id="out"></i><div id="host"><i class="c" id="in"></i></div><div id="bare"></div>'
    expect(queryControls(byId('host'), { doc: document }, '.c').map((n) => n.id)).toEqual(['in'])
    expect(queryControls(byId('bare'), { doc: document }, '.c').map((n) => n.id)).toEqual(['out', 'in'])
  })
})
