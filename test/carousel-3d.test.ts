// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createStyleLedger } from '../src/core/owned-styles.js'
import { readEffectParams } from '../src/core/js-params.js'
import type { PrepareContext } from '../src/core/effect-context.js'
import type { EffectInstance } from '../src/core/types.js'
import {
  CAROUSEL_PRESETS,
  SPATIAL_RING_PRIMITIVE,
  degreesOf,
  faceAt,
  normaliseDegrees,
  snapPosition,
} from '../src/effects/carousel/index.js'
import { catalogRegistry } from './support/registry.js'

/**
 * The spatial carousel: geometry, published tokens, and teardown.
 *
 * Split from the pointer half (`carousel-3d-drag.test.ts`) on size rather than on topic — together
 * they are past the 400-line cap `eslint.config.js` enforces — and the seam is the one that costs
 * least: nothing here dispatches a pointer event, and nothing there reads a token.
 *
 * These call `prepare` directly rather than driving a real `Animator`, because every question below
 * is about what the primitive publishes onto its own elements, and the animator adds a parse, a
 * compile and a gate between the attribute and that answer without changing it. The registry
 * assertions further down use the shared read-only `catalogRegistry()` — the carousel is part of the
 * default catalog, so registering it onto a second registry here would throw `already registered`
 * rather than isolate anything.
 */

function fakeCtx(el: Element, warn: (message: string) => void = () => {}): PrepareContext {
  return {
    win: window,
    doc: window.document,
    reducedMotion: false,
    warn,
    style: createStyleLedger(el),
  } as unknown as PrepareContext
}

/**
 * Prepare a ring over `html` and activate it.
 *
 * `prepare` is deferred (`deferPrepare`), so nothing runs until `activate()` — which is the whole
 * point of the wrapper and is easy to forget in a test, where the symptom is an element with no
 * tokens on it and no error to explain why.
 */
function mount(
  html: string,
  params: Record<string, string> = {},
  warn: (message: string) => void = () => {},
): { host: HTMLElement; instance: EffectInstance } {
  document.body.innerHTML = html
  const host = document.body.firstElementChild as HTMLElement
  const instance = SPATIAL_RING_PRIMITIVE.prepare!(
    host,
    readEffectParams(params, SPATIAL_RING_PRIMITIVE.parameters, warn),
    fakeCtx(host, warn),
  )
  instance.activate()
  return { host, instance }
}

const DECK = `
  <div>
    <div class="slide">one</div>
    <div class="slide">two</div>
    <div class="slide">three</div>
    <div class="slide">four</div>
  </div>
`

afterEach(() => {
  document.body.innerHTML = ''
})

/**
 * The ring maths, asserted without a DOM.
 *
 * Every one of these decides where a card is drawn, and all three are cheap to get subtly wrong in
 * a way that only shows up at one position on one ring size — which is precisely the class of bug a
 * browser check finds late and a pure test finds immediately.
 */
describe('ring geometry', () => {
  it('brings an angle onto the half-turn either side of the camera', () => {
    expect(normaliseDegrees(0)).toBe(0)
    expect(normaliseDegrees(190)).toBe(-170)
    expect(normaliseDegrees(-190)).toBe(170)
    // The case the whole function exists for: 350 degrees round is ten degrees short, not 350 away.
    expect(normaliseDegrees(350)).toBe(-10)
    expect(normaliseDegrees(720)).toBe(0)
  })

  it('calls a slot turned a quarter turn or more away from the camera a back face', () => {
    expect(faceAt(0)).toBe('front')
    expect(faceAt(-45)).toBe('front')
    expect(faceAt(89.9)).toBe('front')
    expect(faceAt(90)).toBe('back')
    expect(faceAt(180)).toBe('back')
    // Through the wrap: a card at 350 degrees is ten degrees from front, not behind the ring.
    expect(faceAt(350)).toBe('front')
  })

  it('splits a continuous position into a wrapped step and a remainder inside half a place', () => {
    expect(snapPosition(0, 4)).toEqual({ step: 0, drift: 0 })
    expect(snapPosition(2.2, 4)).toEqual({ step: 2, drift: expect.closeTo(0.2, 10) })
    // Past the half-way point the *step* moves, so the remainder stays small and the ring never has
    // to travel back across every card to wrap.
    expect(snapPosition(2.7, 4).step).toBe(3)
    expect(Math.abs(snapPosition(2.7, 4).drift)).toBeLessThanOrEqual(0.5)
    // Wrapped in both directions: a ring has no ends.
    expect(snapPosition(4, 4).step).toBe(0)
    expect(snapPosition(-1, 4).step).toBe(3)
    // A count of zero is a deck with nothing in it, not a division by zero.
    expect(snapPosition(3, 0)).toEqual({ step: 0, drift: 0 })
  })

  it('converts every angle unit params.ts accepts into degrees', () => {
    expect(degreesOf('18deg', 0)).toBe(18)
    expect(degreesOf('-18', 0)).toBe(-18)
    expect(degreesOf('0.05turn', 0)).toBeCloseTo(18, 10)
    expect(degreesOf('1rad', 0)).toBeCloseTo(57.2957795, 5)
    expect(degreesOf('100grad', 0)).toBeCloseTo(90, 10)
    // Behind `params.ts`, so an unfamiliar spelling means a fallback rather than a throw during
    // `prepare` — a ring on the default arc beats no ring at all.
    expect(degreesOf('sideways', 360)).toBe(360)
  })
})

describe('registration and parameters', () => {
  const registry = catalogRegistry()

  it.each(CAROUSEL_PRESETS.map((preset) => preset.name))('%s resolves to the ring primitive', (name) => {
    const resolved = registry.resolve(name)
    expect(resolved?.primitive.id).toBe('spatial-ring')
  })

  it('declares every reaching name as requiring its own subtree', () => {
    // Every rule in `carousel.css` past the host rule selects the slots, so a `target:` that
    // relocated `data-kui-fx` onto one of them would leave those selectors hunting for
    // grandchildren nobody authored. `css-requires-own-subtree.test.ts` re-derives this from the
    // stylesheet; asserting it here too keeps the fact next to the presets that carry it.
    expect(CAROUSEL_PRESETS.filter((preset) => preset.requiresOwnSubtree !== true)).toEqual([])
  })

  it('takes a real CSS angle for tilt, in any unit, and refuses a scalar', () => {
    const warn = vi.fn()
    const read = (tilt: string): string =>
      readEffectParams({ tilt }, SPATIAL_RING_PRIMITIVE.parameters, warn).text('tilt')
    expect(read('18deg')).toBe('18deg')
    expect(read('0.05turn')).toBe('0.05turn')
    // `params.ts` normalises the bare and `d`-suffixed spellings onto `deg` rather than rejecting
    // them, which is what keeps `tilt:18` from being a silent no-op.
    expect(read('18')).toBe('18deg')
    // The rejected case is the one this parameter exists to rule out: a normalised -1..1 scalar is
    // not an angle, and accepting it would have meant a hidden maximum nobody could see.
    expect(read('0.375%')).toBe('0deg')
    expect(warn).toHaveBeenCalled()
  })

  it('closes the facing word list', () => {
    const warn = vi.fn()
    const read = (facing: string): string =>
      readEffectParams({ facing }, SPATIAL_RING_PRIMITIVE.parameters, warn).text('facing')
    expect(read('camera')).toBe('camera')
    expect(read('radial')).toBe('radial')
    expect(read('billboard')).toBe('radial')
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('radial'))
  })

  it('leaves radius unset by default, so the stylesheet derives one', () => {
    // An empty default is how "the author said nothing" is told from "the author said 320px":
    // `readParams` fills every declared default in unconditionally, so any non-empty default would
    // be indistinguishable from an authored value and the derived-radius branch unreachable.
    expect(SPATIAL_RING_PRIMITIVE.parameters.radius?.default).toBe('')
  })

  it('shortens rather than disables under reduced motion', () => {
    /*
     * The difference is the whole widget, and it is the same note `step-progress` carries. Under
     * `disable` the animator never activates the instance, so the deferred setup never runs: no
     * index is published, no slot is marked, and the arrows do nothing. A visitor who asked for
     * less motion would get a dead deck rather than a calm one.
     */
    expect(SPATIAL_RING_PRIMITIVE.reducedMotion).toBe('shorten')
  })

  it('installs at load rather than on entering the viewport', () => {
    // A carousel that only wires its arrows once scrolled into view is broken, not lazy.
    expect(SPATIAL_RING_PRIMITIVE.defaultActivation).toBe('load')
  })
})

describe('published tokens', () => {
  it('publishes the live place as both an integer and a real number', () => {
    const { host, instance } = mount(DECK, { target: '.slide' })
    expect(host.getAttribute('data-kui-step')).toBe('0')
    expect(host.style.getPropertyValue('--kui-step')).toBe('0')
    expect(host.style.getPropertyValue('--kui-step-position')).toBe('0.0000')
    instance.destroy()
  })

  it('never writes --kui-progress, which means something else entirely', () => {
    /*
     * The regression this test exists for. `--kui-progress` is a 0-1 scroll fraction
     * (`effects/scroll-mechanics/primitives.ts`) that `core/declarations.ts`'s `pinnedDelays` reads
     * as the seek position of every pinned animation on the element:
     *
     *   animation-delay: calc(<delay> - var(--kui-progress, 0) * (<head>))
     *
     * Custom properties inherit, so a ring publishing a place index into that name would hand every
     * scrubbed descendant a delay several heads long and pin it past its own end — and a carousel
     * inside a pinned scroll section is the ordinary case, not a corner.
     */
    const { host, instance } = mount(DECK, { target: '.slide' })
    expect(host.style.getPropertyValue('--kui-progress')).toBe('')
    instance.destroy()
  })

  it('publishes the ring size beside each slot own place', () => {
    const { host, instance } = mount(DECK, { target: '.slide' })
    const slots = [...host.querySelectorAll<HTMLElement>('.slide')]
    // An offset is a place; a place needs a spacing; the spacing is `arc / count`. Publishing one
    // without the other leaves the stylesheet unable to turn a place into a position at all.
    expect(slots.map((slot) => slot.style.getPropertyValue('--kui-item-count'))).toEqual([
      '4',
      '4',
      '4',
      '4',
    ])
    expect(slots.map((slot) => slot.getAttribute('data-kui-step-offset'))).toEqual([
      '0',
      '1',
      '2',
      '-1',
    ])
    instance.destroy()
  })

  it('marks which slots have their face turned away from the camera', () => {
    const { host, instance } = mount(DECK, { target: '.slide' })
    // Four slots over a full ring is 90 degrees apart, and the two at +/- a quarter turn are
    // edge-on: `faceAt` calls those back, so only the live one and its opposite are left, and the
    // opposite is a half turn away.
    expect([...host.querySelectorAll('.slide')].map((slot) => slot.getAttribute('data-kui-ring-face')))
      .toEqual(['front', 'back', 'back', 'back'])
    instance.destroy()
  })

  it('publishes facing as an attribute, because CSS cannot select on a custom property value', () => {
    const { host, instance } = mount(DECK, { target: '.slide', facing: 'camera' })
    expect(host.getAttribute('data-kui-ring-facing')).toBe('camera')
    instance.destroy()
  })

  it('measures a card only while the radius is derived', () => {
    const derived = mount(DECK, { target: '.slide' })
    // jsdom reports every `offsetWidth` as 0, so the property is legitimately absent here — what is
    // being asserted is the branch, not the number: an authored radius must not force a layout read
    // for a value nothing will consume.
    derived.instance.destroy()

    const { host, instance } = mount(DECK, { target: '.slide', radius: '320px' })
    expect(host.style.getPropertyValue('--kui-item-width')).toBe('')
    instance.destroy()
  })
})

describe('teardown', () => {
  it('gives every element back exactly what it had', () => {
    const { host, instance } = mount(DECK, { target: '.slide', facing: 'camera' })
    instance.destroy()

    expect(host.getAttribute('data-kui-step')).toBeNull()
    expect(host.getAttribute('data-kui-ring-facing')).toBeNull()
    expect(host.style.getPropertyValue('--kui-step-position')).toBe('')
    for (const slot of host.querySelectorAll('.slide')) {
      expect(slot.getAttribute('data-kui-ring-face')).toBeNull()
      expect(slot.getAttribute('data-kui-step-offset')).toBeNull()
      expect((slot as HTMLElement).style.getPropertyValue('--kui-item-count')).toBe('')
    }
  })

  it('restores an author attribute rather than removing it', () => {
    // The ledger discipline `core/owned-styles.ts` exists for: a `data-kui-step` the page set
    // itself must come back, not vanish, because this library was never its owner.
    document.body.innerHTML = `<div data-kui-step="9"><div class="slide">one</div></div>`
    const host = document.body.firstElementChild as HTMLElement
    const instance = SPATIAL_RING_PRIMITIVE.prepare!(
      host,
      readEffectParams({ target: '.slide' }, SPATIAL_RING_PRIMITIVE.parameters, () => {}),
      fakeCtx(host),
    )
    instance.activate()
    expect(host.getAttribute('data-kui-step')).toBe('0')
    instance.destroy()
    expect(host.getAttribute('data-kui-step')).toBe('9')
  })
})

/**
 * The ancestor trap, which is the bug report this effect will generate most often.
 *
 * `transform-style: preserve-3d` is silently defeated by an ancestor with `overflow` other than
 * `visible`, a `clip-path`, `opacity` below 1, a `filter`, or a `backdrop-filter`. The ring goes
 * flat, nothing errors, and the symptom points at this effect while the cause is three levels up —
 * inside the modal, drawer, or clipped grid card somebody put the deck in.
 */
describe('flattening ancestors', () => {
  it('names the ancestor and the property that flattened the ring', () => {
    const warn = vi.fn()
    document.body.innerHTML = `
      <section style="overflow: hidden">
        <div><div class="slide">one</div></div>
      </section>
    `
    const host = document.body.querySelector('div') as HTMLElement
    const instance = SPATIAL_RING_PRIMITIVE.prepare!(
      host,
      readEffectParams({ target: '.slide' }, SPATIAL_RING_PRIMITIVE.parameters, warn),
      fakeCtx(host, warn),
    )
    instance.activate()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('overflow'))
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('section'))
    instance.destroy()
  })

  it('says nothing about a clean tree', () => {
    const warn = vi.fn()
    const { instance } = mount(DECK, { target: '.slide' }, warn)
    // The whole value of the diagnostic is that it is rare. A warning on every ring — which is what
    // walking past `<body>` into a page-level `overflow-x: hidden` would produce — trains people to
    // ignore it, and then it is worth less than nothing.
    expect(warn).not.toHaveBeenCalled()
    instance.destroy()
  })
})
