// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { createParams } from '../src/core/js-params.js'
import { createStyleLedger } from '../src/core/owned-styles.js'
import type { PrepareContext } from '../src/core/effect-context.js'
import { ATTR } from '../src/core/attrs.js'
import { prepareFlipParts } from '../src/effects/three-d/flip-parts.js'

/** Same shape as `three-d-flip-trigger.test.ts`'s local double — `prepareFlipParts` only reads
 *  `doc` off the context, but the real type requires the rest. */
function fakeCtx(el: Element, overrides: Partial<PrepareContext> = {}): PrepareContext {
  return {
    win: window,
    doc: window.document,
    reducedMotion: false,
    warn: () => {},
    style: createStyleLedger(el),
    ...overrides,
  } as unknown as PrepareContext
}

const params = (trigger?: string) => createParams(trigger ? { trigger } : {})

function mount(el: Element): HTMLDivElement {
  const card = el as HTMLDivElement
  document.body.append(card)
  return card
}

afterEach(() => {
  document.body.replaceChildren()
})

describe('prepareFlipParts — faces', () => {
  it('stamps the first two non-button children front/back, and no others', () => {
    const card = mount(document.createElement('div'))
    card.innerHTML = '<div>one</div><div>two</div><div>three</div>'
    const [a, b, c] = Array.from(card.children)

    prepareFlipParts(card, params(), fakeCtx(card))

    expect(a!.getAttribute(ATTR.part)).toBe('front')
    expect(b!.getAttribute(ATTR.part)).toBe('back')
    expect(c!.hasAttribute(ATTR.part)).toBe(false)
  })

  it('skips a leading button — the first two non-button children are the faces', () => {
    const card = mount(document.createElement('div'))
    card.innerHTML = '<button type="button"></button><div>one</div><div>two</div>'
    const [, a, b] = Array.from(card.children)

    prepareFlipParts(card, params(), fakeCtx(card))

    expect(a!.getAttribute(ATTR.part)).toBe('front')
    expect(b!.getAttribute(ATTR.part)).toBe('back')
  })

  it('classes win: an authored .kui-face-front/-back is left unstamped', () => {
    // A card authored with only face classes still has no control, so this also injects one —
    // the assertion below is scoped to the faces, which is the behaviour under test here.
    const card = mount(document.createElement('div'))
    card.innerHTML = '<div class="kui-face-front"></div><div class="kui-face-back"></div>'
    const [front, back] = Array.from(card.children)

    prepareFlipParts(card, params(), fakeCtx(card))

    expect(front!.hasAttribute(ATTR.part)).toBe(false)
    expect(back!.hasAttribute(ATTR.part)).toBe(false)
  })

  it('cleanup restores the faces to their pre-effect markup', () => {
    const card = mount(document.createElement('div'))
    card.innerHTML = '<div>one</div><div>two</div>'
    const before = card.outerHTML

    const { cleanup } = prepareFlipParts(card, params(), fakeCtx(card))
    expect(card.outerHTML).not.toBe(before)

    cleanup()
    expect(card.outerHTML).toBe(before)
  })
})

describe('prepareFlipParts — control', () => {
  it('finds an authored .kui-flip-control and stamps nothing on it', () => {
    const card = mount(document.createElement('div'))
    card.innerHTML =
      '<div></div><div></div><button type="button" class="kui-flip-control" aria-pressed="false"></button>'
    const control = card.querySelector('.kui-flip-control')!
    const before = card.outerHTML

    const result = prepareFlipParts(card, params(), fakeCtx(card))
    expect(result.control).toBe(control)
    expect(control.hasAttribute(ATTR.part)).toBe(false)

    result.cleanup()
    expect(card.outerHTML).toBe(before)
  })

  it('stamps but does not wire an authored button[aria-pressed] with no class — the author owns it', () => {
    const card = mount(document.createElement('div'))
    card.innerHTML = '<div></div><div></div><button type="button" aria-pressed="false"></button>'
    const button = card.querySelector('button')!
    const before = card.outerHTML

    const { control, cleanup } = prepareFlipParts(card, params(), fakeCtx(card))
    expect(control).toBe(button)
    expect(button.getAttribute(ATTR.part)).toBe('control')

    button.dispatchEvent(new Event('click'))
    expect(button.getAttribute('aria-pressed')).toBe('false')

    cleanup()
    expect(card.outerHTML).toBe(before)
  })

  it('injects a control when the card authored none, and wires it to toggle aria-pressed', () => {
    const card = mount(document.createElement('div'))
    card.innerHTML = '<div></div><div></div>'
    const before = card.outerHTML

    const { control } = prepareFlipParts(card, params('click'), fakeCtx(card))
    const injected = card.querySelector('button')!
    expect(control).toBe(injected)
    expect(injected.type).toBe('button')
    expect(injected.className).toBe('kui-flip-control')
    expect(injected.getAttribute(ATTR.part)).toBe('control injected')
    expect(injected.getAttribute('aria-pressed')).toBe('false')
    expect(injected.textContent).toBe('Flip card')

    injected.dispatchEvent(new Event('click'))
    expect(injected.getAttribute('aria-pressed')).toBe('true')
    injected.dispatchEvent(new Event('click'))
    expect(injected.getAttribute('aria-pressed')).toBe('false')

    expect(card.outerHTML).not.toBe(before)
  })

  it('marks an injected control "quiet" for a hover trigger, not for click', () => {
    const clickCard = mount(document.createElement('div'))
    prepareFlipParts(clickCard, params('click'), fakeCtx(clickCard))
    expect(clickCard.querySelector('button')!.getAttribute(ATTR.part)).toBe('control injected')

    const hoverCard = mount(document.createElement('div'))
    prepareFlipParts(hoverCard, params('hover'), fakeCtx(hoverCard))
    expect(hoverCard.querySelector('button')!.getAttribute(ATTR.part)).toBe('control injected quiet')
  })

  it('cleanup removes the injected node and its listener, restoring the original markup', () => {
    const card = mount(document.createElement('div'))
    card.innerHTML = '<div></div><div></div>'
    const before = card.outerHTML

    const { cleanup } = prepareFlipParts(card, params(), fakeCtx(card))
    const injected = card.querySelector('button')!

    cleanup()
    expect(card.contains(injected)).toBe(false)
    expect(card.outerHTML).toBe(before)

    // Re-attach the orphaned node by hand: if cleanup only detached it without removing the
    // listener, this click would still flip `aria-pressed` and the assertion below would catch it.
    document.body.append(injected)
    injected.dispatchEvent(new Event('click'))
    expect(injected.getAttribute('aria-pressed')).toBe('false')
  })
})

describe('flip-card-parts.css', () => {
  const css = readFileSync('src/css/flip-card-parts.css', 'utf8')

  it('reaches every marker this module can stamp or inject', () => {
    expect(css).toContain("[data-kui-part='front']")
    expect(css).toContain("[data-kui-part='back']")
    expect(css).toContain("[data-kui-part~='control']")
    expect(css).toContain("[data-kui-part~='injected']")
    expect(css).toContain("[data-kui-part~='quiet']")
  })

  it('duplicates the reduced-motion shortening for the two part faces', () => {
    expect(css).toContain("[data-kui-rm][data-kui-fx~='flip-card'] > [data-kui-part='front']")
    expect(css).toContain("[data-kui-rm][data-kui-fx~='flip-card'] > [data-kui-part='back']")
    expect(css).toContain('transition-duration: 1ms !important')
  })
})
