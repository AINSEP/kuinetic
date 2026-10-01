// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createActivationBinder } from '../src/core/activation.js'
import { Animator } from '../src/core/animator.js'
import { ATTR } from '../src/core/attrs.js'
import { defaultCapabilities } from '../src/core/capabilities.js'
import { compile } from '../src/core/compile.js'
import { parse } from '../src/core/parse.js'
import { attributeChannel } from '../src/core/types.js'
import { swipeReaches } from '../src/effects/swipe-event.js'
import { catalogRegistry } from './support/registry.js'
import { fakeRoot, idleScheduler } from './support/js-effect-harness.js'

/**
 * Two stateful effects, one element, one comma.
 *
 * `swipe-y, carousel` used to compile to `swipe-y` alone. Nothing collided at runtime: the compiler
 * refused the pair because both primitives declared the bucket channel `'state'`, and two claims on
 * one channel drop everything after the first. But `swipeable` writes `data-kui-swipe` and the deck
 * writes `data-kui-step` — the bucket invented a fight between two attributes that never meet.
 * Channels now name the attribute (`attributeChannel` in `core/channels.ts`), so the pair composes
 * and a pair that really does share an attribute (`swipe-x, swipe-y`) is still refused.
 *
 * The compile half asserts the plan directly; the mount half runs the real animator over real
 * markup, the same harness `swipe-steps-carousel.test.ts` uses, because "both work" means a flick
 * on the element steps the deck on that same element, and "both torn down" means the element is
 * left exactly as authored.
 */

const SLIDES = '<div class="slide">1</div><div class="slide">2</div><div class="slide">3</div>'

function compiled(value: string) {
  return compile(parse(value), catalogRegistry(), 'time')
}

const dropWarning = (warnings: string[]): string | undefined => warnings.find((w) => w.startsWith('cannot compose'))

describe('stateful effects compose on one element', () => {
  it('keeps both halves of swipe-y, carousel — in either order', () => {
    for (const [value, names] of [
      ['swipe-y, carousel', ['swipe-y', 'carousel']],
      ['carousel, swipe-y', ['carousel', 'swipe-y']],
    ] as const) {
      const plan = compiled(value)
      expect(dropWarning(plan.warnings), value).toBeUndefined()
      expect(plan.fxNames).toEqual(names)
      expect(plan.jsEffects.map((e) => e.spec.name)).toEqual(names)
    }
  })

  it('keeps every attribute-writing pair that writes different attributes', () => {
    // One name per attribute-writing primitive: the swipe, the press, the deck, the submit stages,
    // the spy.
    const names = ['swipe-x', 'long-press', 'carousel', 'submit-to-spinner-to-check', 'scroll-spy']
    const plan = compiled(names.join(', '))
    expect(dropWarning(plan.warnings)).toBeUndefined()
    expect(plan.fxNames).toEqual(names)
  })

  it('still refuses two effects that write the same attribute, and names it', () => {
    const swipes = compiled('swipe-x, swipe-y')
    expect(dropWarning(swipes.warnings)).toContain('both animate attr:data-kui-swipe')
    expect(swipes.fxNames).toEqual(['swipe-x'])

    const decks = compiled('carousel, step-progress')
    expect(dropWarning(decks.warnings)).toContain('both animate attr:data-kui-step')
    expect(decks.fxNames).toEqual(['carousel'])
  })

  it('refuses scroll-progress beside a carousel: both publish the step index on the host', () => {
    // A scroll-driven step and a click-driven one writing one `data-kui-step` / `--kui-step` would
    // overwrite each other every frame. It used to compose: scroll-progress claimed only `progress`.
    const plan = compiled('scroll-progress steps:4, carousel')
    expect(dropWarning(plan.warnings)).toContain('"scroll-progress" and "carousel" both animate attr:data-kui-step')
    expect(plan.fxNames).toEqual(['scroll-progress'])
  })

  it('refuses every other step deck beside a carousel: the rings, the stack, the slideshow, the story', () => {
    // Each publishes `data-kui-step` on its own host (`carousel/deck.ts`, `step-index.ts` through
    // the slideshow, `scroll-story.ts`'s `applyStep`) and used to claim only its paint channels or
    // the `widget` bucket — none of which `carousel` claims, so every one of these composed.
    for (const name of ['carousel-3d', 'carousel-stack', 'carousel-fade', 'scroll-story']) {
      const plan = compiled(`${name}, carousel`)
      expect(dropWarning(plan.warnings), name).toContain(`"${name}" and "carousel" both animate attr:data-kui-step`)
      expect(plan.fxNames, name).toEqual([name])
    }
  })

  it('leaves no primitive on either old bucket channel', () => {
    // The buckets are what made unrelated effects collide. A primitive that writes an attribute
    // names it with `attributeChannel`, and a widget that builds inside its host claims
    // `SUBTREE_CHANNEL`; a bare `'state'` or `'widget'` claim would quietly bring the drop back.
    const registry = catalogRegistry()
    const bucketed = registry
      .names()
      .map((name) => registry.resolve(name)!.primitive)
      .filter((primitive) => primitive.channels.some((channel) => channel === 'state' || channel === 'widget'))
      .map((primitive) => primitive.id)
    expect([...new Set(bucketed)]).toEqual([])
  })
})

describe('showcase widgets claim what they write', () => {
  // Every widget used to claim the one bucket `'widget'`, so any two in a comma list were refused,
  // whatever each one did. A lightbox only listens on the links already in its host, so it now
  // composes with a widget that builds there; two widgets that both build inside the host still
  // collide, on `subtree`.
  it('keeps a lightbox beside every widget that builds inside its host', () => {
    for (const name of ['carousel-fade', 'carousel-slide', 'compare', 'hotspots', 'scroll-story', 'slow-mo', 'carousel']) {
      const plan = compiled(`${name}, lightbox`)
      expect(dropWarning(plan.warnings), name).toBeUndefined()
      expect(plan.fxNames, name).toEqual([name, 'lightbox'])
    }
  })

  it('refuses two widgets that both build inside the host, and names the subtree', () => {
    for (const [first, second] of [
      ['scroll-story', 'slow-mo'],
      ['hotspots', 'compare'],
      ['carousel-fade', 'hotspots'],
      ['compare', 'slow-mo'],
    ] as const) {
      const plan = compiled(`${first}, ${second}`)
      expect(dropWarning(plan.warnings), first).toContain(`"${first}" and "${second}" both animate subtree`)
      expect(plan.fxNames, first).toEqual([first])
    }
  })

  it('refuses a widget that builds inside a step deck: what it inserts would become a slide', () => {
    // A deck takes its host's children as its slides, so `slow-mo`'s prepended toggle was one.
    for (const [deck, widget] of [
      ['carousel', 'slow-mo'],
      ['step-progress', 'slow-mo'],
      ['carousel-3d', 'compare'],
      ['carousel-stack', 'hotspots'],
    ] as const) {
      const plan = compiled(`${deck}, ${widget}`)
      expect(dropWarning(plan.warnings), deck).toContain(`"${deck}" and "${widget}" both animate subtree`)
      expect(plan.fxNames, deck).toEqual([deck])
    }
  })

  it('keeps a clip-path entrance beside compare: compare clips its after layer, not the host', () => {
    const plan = compiled('compare, wipe-up')
    expect(dropWarning(plan.warnings)).toBeUndefined()
    expect(plan.fxNames).toEqual(['compare', 'wipe-up'])
  })

  it('refuses a backdrop beside a widget that builds inside the host: its layer is a child too', () => {
    // `background-media` appends its layer, which would become a deck's last slide,
    // `scroll-story`'s `:last-child` in place of its sections, or a snap point of `scroll-snap`
    // (which takes the host's children as its items when no `target:` names them).
    for (const other of ['carousel', 'scroll-story', 'scroll-snap-y']) {
      const plan = compiled(`bg src:/a.mp4, ${other}`)
      expect(dropWarning(plan.warnings), other).toContain(`"bg" and "${other}" both animate subtree`)
      expect(plan.fxNames, other).toEqual(['bg'])
    }
  })

  it('refuses two lightboxes on one host: both would open on one click', () => {
    const plan = compiled('lightbox, video-lightbox')
    expect(dropWarning(plan.warnings)).toContain('both animate lightbox:triggers')
    expect(plan.fxNames).toEqual(['lightbox'])
  })
})

function pointer(target: EventTarget, type: string, x: number, y: number): void {
  const event = new Event(type, { bubbles: true }) as PointerEvent & { clientX: number; clientY: number; pointerId: number }
  Object.assign(event, { clientX: x, clientY: y, pointerId: 1 })
  target.dispatchEvent(event)
}

/** A 1000px/s flick — well over `swipeable`'s 300px/s default — in four 25ms moves. */
function flick(el: Element, dx: number, dy: number): void {
  pointer(el, 'pointerdown', 200, 200)
  for (let step = 1; step <= 4; step++) {
    vi.advanceTimersByTime(25)
    pointer(el, 'pointermove', 200 + (dx * step) / 4, 200 + (dy * step) / 4)
  }
  pointer(el, 'pointerup', 200 + dx, 200 + dy)
}

const byId = (id: string): HTMLElement => document.getElementById(id)!

describe('two stateful effects mounted on one element', () => {
  let animator: Animator | undefined

  function start(html: string): Animator {
    document.body.innerHTML = html
    animator = new Animator({
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

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['performance', 'Date', 'setTimeout', 'clearTimeout'] })
  })

  afterEach(() => {
    animator?.destroy()
    animator = undefined
    vi.useRealTimers()
    document.body.replaceChildren()
  })

  it('mounts both: one element carries both names and the deck indexes its slides', () => {
    start(`<div id="deck" data-kui="swipe-y, carousel">${SLIDES}</div>`)
    const deck = byId('deck')
    expect(deck.getAttribute('data-kui-fx')).toBe('swipe-y carousel')
    expect(deck.getAttribute('data-kui-step')).toBe('0')
    expect(deck.querySelector('.slide')!.getAttribute('data-kui-step-state')).toBe('active')
  })

  it('a flick on the element steps the deck on that same element', () => {
    start(`<div id="deck" data-kui="swipe-y, carousel">${SLIDES}</div>`)
    const deck = byId('deck')

    flick(deck, 0, -100)
    expect(deck.getAttribute('data-kui-swipe')).toBe('up')
    expect(deck.getAttribute('data-kui-step')).toBe('1')

    flick(deck, 0, 100)
    expect(deck.getAttribute('data-kui-swipe')).toBe('down')
    expect(deck.getAttribute('data-kui-step')).toBe('0')
  })

  it('steps only the deck the swipe sits on, inside an outer deck', () => {
    start(
      `<div id="outer" data-kui="carousel">` +
        `<div id="inner" data-kui="swipe-y, carousel">${SLIDES}</div><div>b</div><div>c</div>` +
        `</div>`,
    )
    flick(byId('inner'), 0, -100)
    expect(byId('inner').getAttribute('data-kui-step')).toBe('1')
    expect(byId('outer').getAttribute('data-kui-step')).toBe('0')
  })

  it('tears both down and leaves the element as authored', () => {
    const authored = `<div id="deck" data-kui="swipe-y, carousel">${SLIDES}</div>`
    start(authored)
    flick(byId('deck'), 0, -100)

    animator!.destroy()
    animator = undefined
    expect(document.body.innerHTML).toBe(authored)
  })

  it('mounts a slideshow and a lightbox on one host: controls built, pictures made openable', () => {
    const pictures = '<ul><li><img src="a.jpg" alt="A"></li><li><img src="b.jpg" alt="B"></li></ul>'
    const authored = `<div id="show" aria-label="Pictures" data-kui="carousel-fade, lightbox">${pictures}</div>`
    start(authored)
    const show = byId('show')
    expect(show.getAttribute('data-kui-fx')).toBe('carousel-fade lightbox')
    expect(show.querySelector('.kui-slideshow-controls')).not.toBeNull()
    expect([...show.querySelectorAll('img')].map((img) => img.getAttribute('role'))).toEqual(['button', 'button'])

    animator!.destroy()
    animator = undefined
    expect(document.body.innerHTML).toBe(authored)
  })

  it('every attribute a widget writes on its host is one it claims', () => {
    // Derived, not listed: each widget is mounted and its host's new attributes are read back, so
    // a widget that starts writing another one fails here until it claims it. The `ATTR` namespace
    // (`data-kui-fx`, `-state`, `-rm`) is the animator's, and inline custom properties are each
    // widget's own names.
    const img = (name: string): string => `<img src="${name}.jpg" alt="${name}">`
    const widgets: Record<string, string> = {
      'carousel-fade': `<ul><li>${img('a')}</li><li>${img('b')}</li></ul>`,
      'scroll-story side:start': `<div>${img('a')}${img('b')}</div><ol><li>One</li><li>Two</li></ol>`,
      compare: img('a') + img('b') + img('c'),
      hotspots: `${img('a')}<ol><li style="--kui-x: 20%; --kui-y: 30%"><strong>A</strong> Note</li></ol>`,
      'slow-mo controls:none': '<p>Moving</p>',
      lightbox: `<a href="a.jpg">${img('a')}</a>`,
    }
    const registry = catalogRegistry()
    const authored = new Set<string>(['id', 'aria-label', 'style', ...Object.values(ATTR)])
    for (const [value, inner] of Object.entries(widgets)) {
      start(`<div id="host" aria-label="Widget" data-kui="${value}">${inner}</div>`)
      const host = byId('host')
      const written = host.getAttributeNames().filter((name) => !authored.has(name))
      const claimed = registry.resolve(value.split(' ')[0]!)!.primitive.channels
      expect(written.filter((name) => !claimed.includes(attributeChannel(name))), value).toEqual([])
      animator!.destroy()
      animator = undefined
    }
  })
})

describe('swipeReaches', () => {
  it('a swipe on the deck itself reaches it, whatever decks sit above', () => {
    document.body.innerHTML = '<div data-kui-step="0"><div id="self" data-kui-step="0"></div></div>'
    expect(swipeReaches(byId('self'), byId('self'))).toBe(true)
    document.body.replaceChildren()
  })
})

describe('the layout bucket, split into the properties each effect writes', () => {
  // `'layout'` was shared by `pin`, `scroll-snap`, `auto-height`, `flip-indicator`,
  // `header-shrink`, `background-media` and the gradient rings, so any two were refused: a sticky
  // header that shrinks (`header-shrink, pin-until`) among them. Each now claims what it writes.
  it('leaves no primitive on the layout bucket', () => {
    const registry = catalogRegistry()
    const bucketed = registry
      .names()
      .map((name) => registry.resolve(name)!.primitive)
      .filter((primitive) => primitive.channels.includes('layout'))
      .map((primitive) => primitive.id)
    expect([...new Set(bucketed)]).toEqual([])
  })

  it('composes pairs that write different properties', () => {
    for (const value of [
      'header-shrink, pin-until',
      'pin-section, scroll-snap-y',
      'accordion-height, pin-until',
      'bg src:/a.mp4, header-shrink',
    ]) {
      const plan = compiled(value)
      expect(dropWarning(plan.warnings), value).toBeUndefined()
      expect(plan.fxNames, value).toHaveLength(2)
    }
  })

  it('still refuses pairs that write one property, and names it', () => {
    for (const [value, property] of [
      ['gradient-border, pin-section', 'position'],
      ['bg src:/a.mp4, pin-section', 'position'],
      ['header-shrink, gradient-border', 'padding'],
      ['accordion-height, scroll-snap-y', 'overflow'],
    ] as const) {
      const plan = compiled(value)
      expect(dropWarning(plan.warnings), value).toContain(`both animate ${property}`)
      expect(plan.fxNames, value).toHaveLength(1)
    }
  })
})
