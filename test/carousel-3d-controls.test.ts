import { afterEach, describe, expect, it, vi } from 'vitest'
import { createStyleLedger } from '../src/core/owned-styles.js'
import { readEffectParams } from '../src/core/js-params.js'
import type { PrepareContext } from '../src/core/effect-context.js'
import type { EffectInstance } from '../src/core/types.js'
import { SPATIAL_RING_PRIMITIVE, degreesOf } from '../src/effects/carousel/index.js'

/**
 * The spatial carousel's *index* half: the controls that move it, the default slot set, the
 * measurement that feeds the derived radius, and the ancestor diagnostic's walk.
 *
 * Third file on this primitive, after `carousel-3d.test.ts` (geometry and published tokens) and
 * `carousel-3d-drag.test.ts` (the pointer). The seam is the same one those two were split on: this
 * file presses things and reads `data-kui-step`, and neither of the others does.
 *
 * Every subject here was reachable and completely untested. `next:`/`prev:`/`jump:` had no test at
 * all — `bindControl` returned before pushing a single group in every existing suite, so the whole
 * control surface of a carousel was unexercised. So was the *default* slot set: every other test
 * passes `target:`, so `el.children` — the documented behaviour of a ring authored without one,
 * which is the shape the demo pages use — was never the thing under test.
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

function mount(
  html: string,
  params: Record<string, string> = {},
  warn: (message: string) => void = () => {},
  ctx?: PrepareContext,
): { host: HTMLElement; instance: EffectInstance } {
  document.body.innerHTML = html
  const host = document.body.firstElementChild as HTMLElement
  const instance = SPATIAL_RING_PRIMITIVE.prepare!(
    host,
    readEffectParams(params, SPATIAL_RING_PRIMITIVE.parameters, warn),
    ctx ?? fakeCtx(host, warn),
  )
  instance.activate()
  return { host, instance }
}

const press = (node: Element): void => {
  node.dispatchEvent(new Event('click', { bubbles: true }))
}

afterEach(() => {
  document.body.innerHTML = ''
})

const DECK_WITH_CONTROLS = `
  <div>
    <div class="slide">one</div>
    <div class="slide">two</div>
    <div class="slide">three</div>
    <button class="prev"><span class="icon">‹</span></button>
    <button class="next"><span class="icon">›</span></button>
  </div>
`

describe('the ring’s controls', () => {
  it('advances, wraps, and goes back, publishing the step on the host both ways', () => {
    const { host, instance } = mount(DECK_WITH_CONTROLS, {
      target: '.slide',
      next: '.next',
      prev: '.prev',
    })
    const next = host.querySelector('.next')!
    const prev = host.querySelector('.prev')!

    expect(host.getAttribute('data-kui-step')).toBe('0')
    press(next)
    expect(host.getAttribute('data-kui-step')).toBe('1')
    press(next)
    expect(host.getAttribute('data-kui-step')).toBe('2')
    // A ring wraps — that is the whole difference between it and a row.
    press(next)
    expect(host.getAttribute('data-kui-step')).toBe('0')
    press(prev)
    expect(host.getAttribute('data-kui-step')).toBe('2')

    instance.destroy()
  })

  /**
   * The press lands on the icon inside the button, which is what a press on a real control does.
   * Delegation has to walk up to the matched control rather than compare the pressed node against
   * it — the per-node listeners this replaced got that for free by sitting on the button.
   */
  it('counts a press that landed on a child of the control', () => {
    const { host, instance } = mount(DECK_WITH_CONTROLS, { target: '.slide', next: '.next' })

    press(host.querySelector('.next .icon')!)
    expect(host.getAttribute('data-kui-step')).toBe('1')

    instance.destroy()
  })

  it('ignores a press that merely bubbles through on its way out of the deck', () => {
    const { host, instance } = mount(DECK_WITH_CONTROLS, { target: '.slide', next: '.next' })

    press(host.querySelector('.slide')!)
    expect(host.getAttribute('data-kui-step')).toBe('0')

    instance.destroy()
  })

  /**
   * `jump:` is the one control that carries a number: the index of the pressed control within its
   * own matched set, not the index of a slide. Asserted at a position that is neither the first nor
   * a neighbour of the live one, because an off-by-one or a "step forward" reading both survive a
   * jump to index 1.
   */
  it('jumps straight to the pressed control’s own position in its set', () => {
    const { host, instance } = mount(
      `<div>
         <div class="slide">one</div>
         <div class="slide">two</div>
         <div class="slide">three</div>
         <div class="slide">four</div>
         <nav><button class="dot">1</button><button class="dot">2</button>
              <button class="dot">3</button><button class="dot">4</button></nav>
       </div>`,
      { target: '.slide', jump: '.dot' },
    )

    press(host.querySelectorAll('.dot')[3]!)
    expect(host.getAttribute('data-kui-step')).toBe('3')
    press(host.querySelectorAll('.dot')[1]!)
    expect(host.getAttribute('data-kui-step')).toBe('1')

    instance.destroy()
  })

  /**
   * A control selector that matches nothing is the commonest authoring mistake here and is
   * completely silent otherwise — the ring installs, looks fine, and the arrows do nothing.
   * Warned at setup rather than discovered on the first press.
   */
  it('names a control selector that matched nothing, rather than binding a dead arrow', () => {
    const warn = vi.fn()
    const { instance } = mount(DECK_WITH_CONTROLS, { target: '.slide', next: '.nope' }, warn)

    expect(warn).toHaveBeenCalledWith('carousel next ".nope" matched nothing')

    instance.destroy()
  })

  it('stops listening once torn down, so a press after destroy moves nothing', () => {
    const { host, instance } = mount(DECK_WITH_CONTROLS, { target: '.slide', next: '.next' })
    press(host.querySelector('.next')!)
    expect(host.getAttribute('data-kui-step')).toBe('1')

    instance.destroy()
    press(host.querySelector('.next')!)
    // Back to the authored markup, and staying there.
    expect(host.hasAttribute('data-kui-step')).toBe(false)
  })
})

describe('the ring’s slots when no target: was authored', () => {
  /**
   * The documented default — "Unset means this element's own children" — and the shape every demo
   * page uses. Every other suite on this primitive passes `target:`, so the fallback branch had
   * never run: a regression there would have made an unadorned `data-kui="carousel-3d"` place
   * nothing at all while every test stayed green.
   */
  it('puts the host’s own children on the ring', () => {
    const { host, instance } = mount(
      `<div><div>one</div><div>two</div><div>three</div></div>`,
      { next: '' },
    )

    const slots = [...host.children]
    expect(slots.map((slot) => slot.getAttribute('data-kui-step-offset'))).toEqual(['0', '1', '-1'])
    expect(slots.map((slot) => slot.getAttribute('data-kui-ring-face'))).toEqual([
      'front',
      'back',
      'back',
    ])

    instance.destroy()
    for (const slot of slots) expect(slot.hasAttribute('data-kui-step-offset')).toBe(false)
  })

  /**
   * A ring whose `target:` matches nothing still has to install: it publishes step 0, spreads over
   * the whole arc rather than dividing by a count of zero, and measures nothing. A `NaN` spacing
   * here would reach `carousel.css` as an invalid `rotateY()` and take the whole deck's geometry
   * with it.
   */
  it('installs over an empty ring without dividing the arc by nothing', () => {
    const { host, instance } = mount(`<div><p>no slots here</p></div>`, { target: '.slide' })

    expect(host.getAttribute('data-kui-step')).toBe('0')
    expect(host.style.getPropertyValue('--kui-step-position')).toBe('0.0000')
    // Nothing measured, because there was no first slot to measure.
    expect(host.style.getPropertyValue('--kui-item-width')).toBe('')

    instance.destroy()
  })
})

describe('the measured slot width behind an unset radius:', () => {
  /** jsdom reports `offsetWidth: 0` for everything, so the width has to be stubbed to exist. */
  const withWidth = (node: Element, width: number): void => {
    Object.defineProperty(node, 'offsetWidth', { value: width, configurable: true })
  }

  it('publishes the first slot’s width so carousel.css can derive the circumradius', () => {
    document.body.innerHTML = `<div><div class="slide">one</div><div class="slide">two</div></div>`
    const host = document.body.firstElementChild as HTMLElement
    withWidth(host.children[0]!, 320)
    withWidth(host.children[1]!, 999)

    const instance = SPATIAL_RING_PRIMITIVE.prepare!(
      host,
      readEffectParams({ target: '.slide' }, SPATIAL_RING_PRIMITIVE.parameters, () => {}),
      fakeCtx(host),
    )
    instance.activate()

    // The *first* slot, not the widest: a ring of differently-sized cards has no single side
    // length, and the number is only ever an input to a default an explicit `radius:` overrides.
    expect(host.style.getPropertyValue('--kui-item-width')).toBe('320px')

    instance.destroy()
    expect(host.style.getPropertyValue('--kui-item-width')).toBe('')
  })

  it('publishes nothing for a slot that has not been laid out yet', () => {
    const { host, instance } = mount(
      `<div><div class="slide">one</div></div>`,
      { target: '.slide' },
    )

    // Width 0 is jsdom's answer and a real browser's answer for a `display: none` deck. Writing
    // `--kui-item-width: 0px` would collapse the derived radius to zero and stack every card.
    expect(host.style.getPropertyValue('--kui-item-width')).toBe('')

    instance.destroy()
  })

  it('does not measure at all when the author set radius: themselves', () => {
    document.body.innerHTML = `<div><div class="slide">one</div></div>`
    const host = document.body.firstElementChild as HTMLElement
    withWidth(host.children[0]!, 320)

    const instance = SPATIAL_RING_PRIMITIVE.prepare!(
      host,
      readEffectParams({ target: '.slide', radius: '400px' }, SPATIAL_RING_PRIMITIVE.parameters, () => {}),
      fakeCtx(host),
    )
    instance.activate()

    // Nothing reads the property when a radius was authored, and measuring forces a layout flush.
    expect(host.style.getPropertyValue('--kui-item-width')).toBe('')

    instance.destroy()
  })
})

describe('the flattening-ancestor walk', () => {
  it('keeps climbing past an innocent ancestor to reach the guilty one', () => {
    const warn = vi.fn()
    document.body.innerHTML = `
      <section style="clip-path: inset(0)">
        <div class="wrapper">
          <div><div class="slide">one</div></div>
        </div>
      </section>
    `
    const host = document.body.querySelector('.wrapper > div') as HTMLElement
    const instance = SPATIAL_RING_PRIMITIVE.prepare!(
      host,
      readEffectParams({ target: '.slide' }, SPATIAL_RING_PRIMITIVE.parameters, warn),
      fakeCtx(host, warn),
    )
    instance.activate()

    // `.wrapper` is clean and had to be walked *through*; `clip-path` is the third of the five
    // properties checked, so both the walk and the per-property predicates are being exercised.
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('clip-path'))
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('<section>'))

    instance.destroy()
  })

  it('stops at the first offender rather than listing the consequences below it', () => {
    const warn = vi.fn()
    document.body.innerHTML = `
      <section style="overflow: hidden">
        <div class="wrapper" style="overflow: hidden">
          <div><div class="slide">one</div></div>
        </div>
      </section>
    `
    const host = document.body.querySelector('.wrapper > div') as HTMLElement
    const instance = SPATIAL_RING_PRIMITIVE.prepare!(
      host,
      readEffectParams({ target: '.slide' }, SPATIAL_RING_PRIMITIVE.parameters, warn),
      fakeCtx(host, warn),
    )
    instance.activate()

    // One warning, and it names the nearest one — everything above it is already flattened by it.
    const flattening = warn.mock.calls
      .map((call) => String(call[0]))
      .filter((message) => message.includes('flattens'))
    expect(flattening).toHaveLength(1)
    expect(flattening[0]!).toContain('<div>')

    instance.destroy()
  })

  /**
   * All five flattening properties, driven through a fake `getComputedStyle` — which is exactly
   * what `flatteningDeclaration` was split out of the walk to allow, and the only way to reach two
   * of them at all: jsdom's `getComputedStyle` reports nothing for `backdrop-filter`, so a fixture
   * can never make that predicate run. The three predicates genuinely differ ("anything but
   * visible", "a number below 1", "anything but none"), which is why each is written per property
   * and why each needs its own case.
   */
  it.each([
    ['overflow', 'hidden'],
    ['clip-path', 'inset(0 0 0 0)'],
    ['opacity', '0.5'],
    ['filter', 'blur(4px)'],
    ['backdrop-filter', 'blur(4px)'],
  ])('names %s: %s on an ancestor as the thing that flattened the ring', (property, value) => {
    const warn = vi.fn()
    document.body.innerHTML = `<section><div><div class="slide">one</div></div></section>`
    const host = document.body.querySelector('section > div') as HTMLElement
    const guilty = document.body.querySelector('section')!
    const win = {
      getComputedStyle: (node: Element) => ({
        getPropertyValue: (name: string) => (node === guilty && name === property ? value : ''),
      }),
    }

    const instance = SPATIAL_RING_PRIMITIVE.prepare!(
      host,
      readEffectParams({ target: '.slide', grab: 'false' }, SPATIAL_RING_PRIMITIVE.parameters, warn),
      { ...fakeCtx(host, warn), win: win as unknown as Window } as PrepareContext,
    )
    instance.activate()

    expect(warn).toHaveBeenCalledWith(expect.stringContaining(`${property}: ${value}`))
    instance.destroy()
  })

  it.each([
    ['overflow', 'visible'],
    ['opacity', '1'],
    ['filter', 'none'],
    ['clip-path', 'none'],
    ['backdrop-filter', 'none'],
  ])('says nothing about an ancestor whose %s is the harmless %s', (property, value) => {
    const warn = vi.fn()
    document.body.innerHTML = `<section><div><div class="slide">one</div></div></section>`
    const host = document.body.querySelector('section > div') as HTMLElement
    const win = {
      getComputedStyle: () => ({
        getPropertyValue: (name: string) => (name === property ? value : ''),
      }),
    }

    const instance = SPATIAL_RING_PRIMITIVE.prepare!(
      host,
      readEffectParams({ target: '.slide', grab: 'false' }, SPATIAL_RING_PRIMITIVE.parameters, warn),
      { ...fakeCtx(host, warn), win: win as unknown as Window } as PrepareContext,
    )
    instance.activate()

    expect(warn).not.toHaveBeenCalled()
    instance.destroy()
  })

  /**
   * A diagnostic must never be the thing that throws. A primitive can be prepared against a realm
   * with no layout at all — `test/three-d.test.ts` prepares with no element — so the
   * `getComputedStyle` call is optional-chained, and this is what says the ring still installs when
   * it resolves to nothing.
   */
  it('installs silently in a realm with no getComputedStyle at all', () => {
    const warn = vi.fn()
    document.body.innerHTML = `
      <section style="overflow: hidden">
        <div><div class="slide">one</div></div>
      </section>
    `
    const host = document.body.querySelector('section > div') as HTMLElement
    const instance = SPATIAL_RING_PRIMITIVE.prepare!(
      host,
      readEffectParams({ target: '.slide', grab: 'false' }, SPATIAL_RING_PRIMITIVE.parameters, warn),
      { ...fakeCtx(host, warn), win: {} as Window } as PrepareContext,
    )
    instance.activate()

    // The ancestor really is guilty — it is only the *reading* of it that is unavailable — so a
    // silent install here is the contract, not a coincidence of a clean fixture.
    expect(warn).not.toHaveBeenCalled()
    expect(host.getAttribute('data-kui-step')).toBe('0')

    instance.destroy()
  })
})

describe('degreesOf on a value that parses but is not a number', () => {
  /**
   * The regex accepts `-?[\d.]+`, which matches plenty of strings `Number()` then turns into `NaN`
   * — a stray second decimal point is the realistic one. A `NaN` here does not throw; it propagates
   * silently into every slot's angle and lands in `carousel.css` as an invalid transform, so every
   * card stacks in one place with no error anywhere.
   */
  it('falls back rather than letting a NaN reach the geometry', () => {
    expect(degreesOf('1.2.3deg', 360)).toBe(360)
    expect(degreesOf('.', 360)).toBe(360)
    expect(degreesOf('..', 45)).toBe(45)
  })
})
