import { beforeEach, describe, expect, it } from 'vitest'
import { progressFrom, trackProgress } from '../src/effects/scroll-mechanics/tracker.js'
import type { PrepareContext } from '../src/core/effect-context.js'
import { createParams } from '../src/core/js-params.js'
import { createStyleLedger } from '../src/core/owned-styles.js'
import {
  build,
  el,
  fakeRoot,
  fakeScheduler,
  reporter,
  scheduler,
  stubRect,
  stubRectWithSpacer,
} from './support/scroll-mechanics-harness.js'
import { catalogRegistry } from './support/registry.js'

// Fake scheduler, fake measurer, `build`/`stubRect`/`el` helpers, and the `scheduler`/`reporter`
// state `build` populates all live in test/support/scroll-mechanics-harness.ts — every describe
// block below depends on them. See that file's doc comment for why it isn't `*.test.ts`.

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('progressFrom', () => {
  it('is 0 before the element reaches the top of the scrollport', () => {
    expect(progressFrom(100, 400)).toBe(0)
  })

  it('is a ratio while travelling', () => {
    expect(progressFrom(-200, 400)).toBeCloseTo(0.5)
  })

  it('clamps to 1 past the end', () => {
    expect(progressFrom(-900, 400)).toBe(1)
  })

  it('returns 0 for a degenerate span rather than dividing by zero', () => {
    // An element measured before layout settles reports height 0; Infinity here would poison
    // every downstream style write.
    expect(progressFrom(-100, 0)).toBe(0)
    expect(progressFrom(-100, -5)).toBe(0)
  })
})

describe('trackProgress — default distance', () => {
  it('defaults the span to the element\'s own height when no distance is authored', () => {
    const target = document.createElement('div')
    stubRect(target, 0, 200)
    const sched = fakeScheduler()
    const seen: number[] = []
    const ctx = { scheduler: sched, rootFor: () => fakeRoot } as unknown as PrepareContext

    trackProgress(target, ctx, {}, (progress) => seen.push(progress))
    sched.emit(0) // first frame establishes the epoch-cached measurement baseline

    stubRect(target, -100, 200)
    sched.emit(100, 1) // epoch bump forces a re-measure at the new position

    expect(seen.at(-1)).toBeCloseTo(0.5)
  })
})

// `domPosition`/`domOffsetTop` — the two view-dependent readers `trackProgress` injects by
// default — have their own file, `scroll-mechanics-readers.test.ts`: this file crossed its own
// line cap the same way `scroll-spy.ts` once crossed the source cap that split it from
// `primitives.ts`, and a category that outgrows one file gets a file of its own.

describe('trackProgress — inside a position: sticky subtree', () => {
  // The `horizontal-scroll` shape: a tall stage, a sticky viewport inside it, and the tracked
  // element inside that. Once the viewport is stuck, the track's own rect stops describing where
  // it lives in the document, so a re-measure taken at that moment used to cache a `contentTop`
  // of roughly the current scroll position — pinning progress to 0 for the rest of the stage.
  // Numbers below are the measured demo case scaled down; see docs/live-testing-backlog.md D4.
  it('measures the scrolling ancestor, not the element frozen by the sticky', () => {
    document.body.innerHTML =
      '<div class="stage"><div class="viewport"><div class="track"></div></div></div>'
    const stage = document.querySelector('.stage') as HTMLElement
    const viewport = document.querySelector('.viewport') as HTMLElement
    const track = document.querySelector('.track') as HTMLElement
    viewport.style.position = 'sticky'

    const sched = fakeScheduler()
    const seen: number[] = []
    const ctx = { scheduler: sched, rootFor: () => fakeRoot } as unknown as PrepareContext
    trackProgress(track, ctx, { distance: '600px' }, (progress) => seen.push(progress))

    // Off screen, nothing is stuck and every rect agrees about where the stage is.
    stubRect(stage, 900, 1600)
    stubRect(viewport, 900, 800)
    stubRect(track, 900, 300)
    sched.emit(0)
    expect(seen.at(-1)).toBe(0)

    // 1200px in. The viewport is stuck at the top, so `track.top` reads 250 — where it is parked,
    // not how far down the document it sits. `stage.top` still tells the truth.
    stubRect(stage, -300, 1600)
    stubRect(viewport, 0, 800)
    stubRect(track, 250, 300)
    sched.emit(1200, 1) // epoch bump: the re-measure that used to poison the cache

    expect(seen.at(-1)).toBeCloseTo(0.5)
  })

  it('leaves an element outside any sticky subtree measuring itself', () => {
    document.body.innerHTML = '<div class="stage"><div class="track"></div></div>'
    const stage = document.querySelector('.stage') as HTMLElement
    const track = document.querySelector('.track') as HTMLElement

    const sched = fakeScheduler()
    const seen: number[] = []
    const ctx = { scheduler: sched, rootFor: () => fakeRoot } as unknown as PrepareContext
    trackProgress(track, ctx, { distance: '600px' }, (progress) => seen.push(progress))

    // The stage is deliberately somewhere else entirely: if the walk-up fired here, progress
    // would come out of these numbers instead of the track's own.
    stubRect(stage, -5000, 1600)
    stubRect(track, -300, 300)
    sched.emit(0)

    expect(seen.at(-1)).toBeCloseTo(0.5)
  })
})

describe('trackProgress — sticky offset', () => {
  // `stubRect(tracked, flowTop - scrollTop, height)` is what a real, unmoving element in the
  // document reports as the page scrolls: its flow position (0, here) never changes, only its
  // viewport-relative rect does. `stickyEl`'s offset is injected rather than read from a real
  // computed style, because jsdom cannot resolve `var(--kui-pin-offset, 0px)` — the showcase's
  // actual default — through `getComputedStyle`; the `pin` describe block below covers a literal
  // px value through the real primitive instead.
  it('reads progress from the moment sticky engages, not from the tracked element\'s untouched flow top', () => {
    const stickyEl = document.createElement('div')
    const tracked = document.createElement('div')
    const sched = fakeScheduler()
    const seen: number[] = []
    const ctx = { scheduler: sched, rootFor: () => fakeRoot } as unknown as PrepareContext
    trackProgress(tracked, ctx, { distance: '400px', stickyEl, offsetOf: () => 40 }, (progress) => seen.push(progress))

    // Pin start is scrollTop -40 (flowTop 0, minus the 40px offset), so scrollTop 0 is already
    // 40 / 400 of the way through — the pre-fix code answered 0 here.
    stubRect(tracked, 0, 300)
    sched.emit(0)
    expect(seen.at(-1)).toBeCloseTo(0.1)

    stubRect(tracked, -320, 300)
    sched.emit(320, 1)
    expect(seen.at(-1)).toBeCloseTo(0.9)
  })
  // No "stays at the pre-fix answer without stickyEl" case needed: every other describe block
  // above never passes it, and all of them are unchanged by this diff — that is the regression
  // coverage for primitives that don't call `installSticky` themselves.
})

/** Pin measures its containing block, so that is what the stub must describe. */
const stubContainer = (top: number, height = 400): void => stubRect(document.body, top, height)

describe('pin', () => {
  it('makes the element sticky and subscribes to the scheduler', () => {
    const animator = build('<div data-kui="pin-section"></div>')
    stubContainer(0)
    animator.start()

    expect(el().style.position).toBe('sticky')
    expect(scheduler.subscriberCount()).toBe(1)
  })

  it('publishes progress as a custom property', () => {
    const animator = build('<div data-kui="pin-until distance:400px"></div>')
    stubContainer(0)
    animator.start()

    scheduler.emit(0)
    expect(el().style.getPropertyValue('--kui-progress')).toBe('0.0000')

    stubContainer(-200)
    scheduler.emit(200, 1)
    expect(Number(el().style.getPropertyValue('--kui-progress'))).toBeCloseTo(0.5)
  })

  it('subtracts a real offset-top so progress reads correctly from the moment it actually pins', () => {
    // A literal px value, not the `var(--kui-pin-offset, 0px)` default: jsdom cannot resolve a
    // custom property through `getComputedStyle`, so this is the one shape that can be observed
    // going through the real `pin` primitive rather than `trackProgress` directly.
    const animator = build('<div data-kui="pin-until distance:400px offset-top:40px"></div>')
    // The container's flow top is pinned at 0 throughout: `stubContainer(flowTop - scrollTop)` is
    // what an unmoving element in the document reports as the page scrolls past it.
    stubContainer(0)
    animator.start()

    scheduler.emit(0)
    // Sticky engages once the flow top reaches `offset-top` (40px), 40px of scroll before
    // scrollTop reaches the container's own flow position — so 40 / 400 of the pin is already
    // behind it here. The pre-fix answer was '0.0000': the first 40px of every pin with a non-zero
    // offset silently reported no progress at all. (The offset's exact slope-preserving effect
    // across a full pin is covered precisely in "trackProgress — sticky offset" above; this proves
    // only that `preparePin` actually wires `offset-top` into it.)
    expect(el().style.getPropertyValue('--kui-progress')).toBe('0.1000')
  })

  it('marks the pinned window with an attribute', () => {
    const animator = build('<div data-kui="pin-until distance:400px"></div>')
    stubContainer(-200)
    animator.start()
    scheduler.emit(200)
    expect(el().getAttribute('data-kui-pinned')).toBe('true')
  })

  it('marks the window unpinned once progress reaches the end', () => {
    const animator = build('<div data-kui="pin-until distance:400px"></div>')
    stubContainer(-500)
    animator.start()
    scheduler.emit(500)
    expect(el().getAttribute('data-kui-pinned')).toBe('false')
  })

  it('tracks the pin element itself when it has no parent to track instead', () => {
    const registry = catalogRegistry()
    const resolved = registry.resolve('pin-section')!
    const detached = document.createElement('div')
    // Never appended to the document, so parentElement is null — preparePin must fall back to
    // tracking the element itself rather than throwing on a null tracked target.
    expect(detached.parentElement).toBeNull()
    const sched = fakeScheduler()
    const ctx = {
      win: window,
      doc: document,
      scheduler: sched,
      rootFor: () => fakeRoot,
      invalidate: () => {},
      warn: () => {},
      style: createStyleLedger(detached),
    } as unknown as PrepareContext
    const instance = resolved.primitive.prepare!(detached, createParams({}), ctx)
    expect(() => instance.activate()).not.toThrow()
    instance.destroy()
  })

  it('adds a spacer so a pin longer than its container still holds', () => {
    // Sticky silently does nothing once its containing block scrolls away; the spacer is the fix.
    const animator = build('<div data-kui="pin-section distance:600px"></div>')
    stubContainer(0)
    animator.start()

    const spacer = document.querySelector('[data-kui-spacer]') as HTMLElement
    expect(spacer).not.toBeNull()
    expect(spacer.style.height).toBe('600px')
    expect(spacer.getAttribute('aria-hidden')).toBe('true')
  })

  it('omits the spacer when not requested', () => {
    const animator = build('<div data-kui="pin-until"></div>')
    stubContainer(0)
    animator.start()
    expect(document.querySelector('[data-kui-spacer]')).toBeNull()
  })

  it('restores the element and removes the spacer on destroy', () => {
    const animator = build('<div data-kui="pin-section"></div>')
    stubContainer(0)
    animator.start()
    animator.destroy()

    expect(el().style.position).toBe('')
    expect(document.querySelector('[data-kui-spacer]')).toBeNull()
    expect(el().hasAttribute('data-kui-pinned')).toBe(false)
    expect(scheduler.subscriberCount()).toBe(0)
  })
})

describe('media-scrub', () => {
  it('writes the frame pattern to an <img> src, substituting {i}', () => {
    const animator = build(
      '<img data-kui="sequence-scrub distance:400px frames:4 src:frame-{i}.jpg">',
    )
    stubRect(el('img'), 0)
    animator.start()
    // Re-stub now the spacer exists: `sequence-scrub` reserves its own scroll room, and progress
    // is read from that spacer rather than from the image sticky has parked.
    stubRectWithSpacer(el('img'), 0)
    scheduler.emit(0)
    expect((el('img') as HTMLImageElement).src).toContain('frame-0.jpg')

    stubRectWithSpacer(el('img'), -400)
    scheduler.emit(400, 1)
    expect((el('img') as HTMLImageElement).src).toContain('frame-3.jpg')
  })

  it('scrubs currentTime for a <video>, never touching src', () => {
    const animator = build('<video data-kui="video-scrub distance:400px"></video>')
    const video = el('video') as HTMLVideoElement
    Object.defineProperty(video, 'duration', { value: 10, configurable: true })
    let currentTime = 0
    Object.defineProperty(video, 'currentTime', {
      get: () => currentTime,
      set: (v) => {
        currentTime = v
      },
      configurable: true,
    })
    stubRect(video, -200)
    animator.start()
    scheduler.emit(200)
    expect(currentTime).toBeCloseTo(5)
    expect(video.getAttribute('src')).toBeNull()
  })

  it('leaves currentTime untouched while a video\'s duration is not yet known (NaN)', () => {
    const animator = build('<video data-kui="video-scrub distance:400px"></video>')
    const video = el('video') as HTMLVideoElement
    // jsdom's own default for an unloaded <video> — no metadata means no known duration.
    expect(Number.isNaN(video.duration)).toBe(true)
    let currentTimeSet = false
    Object.defineProperty(video, 'currentTime', {
      get: () => 0,
      set: () => {
        currentTimeSet = true
      },
      configurable: true,
    })
    stubRect(video, -200)
    animator.start()
    scheduler.emit(200)
    expect(currentTimeSet).toBe(false)
  })

  it('skips redundant frame writes when progress advances within the same frame index', () => {
    const animator = build(
      '<img data-kui="sequence-scrub distance:400px frames:4 src:frame-{i}.jpg">',
    )
    const img = el('img') as HTMLImageElement
    stubRect(img, -10)
    animator.start()
    stubRectWithSpacer(img, -10)
    scheduler.emit(10) // progress ~0.025 -> index 0

    const srcAfterFirst = img.src
    expect(srcAfterFirst).toContain('frame-0.jpg')

    stubRectWithSpacer(img, -50)
    scheduler.emit(50, 1) // progress ~0.125 -> still index 0, the `index === lastIndex` guard fires
    expect(img.src).toBe(srcAfterFirst)
  })

  it('never writes src on a non-<img> element, closing the javascript: URL vector', () => {
    const animator = build(
      '<iframe data-kui="sequence-scrub distance:400px frames:1 src:javascript:window.pwned=true"></iframe>',
    )
    const iframe = el('iframe') as HTMLIFrameElement
    stubRect(iframe, 0)
    animator.start()
    scheduler.emit(0)
    expect(iframe.getAttribute('src')).toBeNull()
  })

  // The test above already proves a same-origin `frame-{i}.jpg` pattern keeps substituting once
  // this gate is in place — that regression coverage isn't duplicated here. Exhaustive shape
  // coverage (root-relative, protocol-relative, cross-origin, non-http(s) schemes) lives in
  // test/params.test.ts's `isSameOriginPath` suite; this proves the gate is wired into the
  // primitive end to end, not just correct in isolation.
  it('blocks and warns on a cross-origin src instead of issuing the request', () => {
    const animator = build(
      '<img data-kui="sequence-scrub distance:400px frames:1 src:https://evil.test/beacon.gif">',
    )
    const img = el('img') as HTMLImageElement
    stubRect(img, 0)
    animator.start()
    scheduler.emit(0)
    expect(img.getAttribute('src')).toBeNull()
    expect(reporter.messages.join()).toContain('must be a same-origin path')
  })

  // A relative same-origin `{i}` pattern must keep cycling frames end to end.
  it('keeps a relative ./assets/frame-{i}.jpg pattern working', () => {
    const animator = build(
      '<img data-kui="sequence-scrub frames:5 src:./assets/frame-{i}.jpg distance:220vh">',
    )
    stubRect(el('img'), 0)
    animator.start()
    stubRectWithSpacer(el('img'), 0)
    scheduler.emit(0)
    // `./` is stripped by URL resolution, same as any browser normalizing a relative path.
    expect((el('img') as HTMLImageElement).src).toContain('assets/frame-0.jpg')
    expect(reporter.messages.join()).not.toContain('same-origin')
  })
})

// The preset name is `smooth-scroll-to`; `smooth-scroll` is the primitive behind it.
describe('smooth-scroll-to', () => {
  // Registered, shipped, and documented in the catalog, but with no test at all until now —
  // `prepareSmoothScroll` was the one uncovered function in the whole category.
  it('sets scroll-behavior on the element it is applied to', () => {
    const animator = build('<div data-kui="smooth-scroll-to"></div>')
    animator.start()
    expect(el().style.scrollBehavior).toBe('smooth')
  })

  it('takes an authored behavior', () => {
    const animator = build('<div data-kui="smooth-scroll-to behavior:auto"></div>')
    animator.start()
    expect(el().style.scrollBehavior).toBe('auto')
  })

  it('restores the original scroll-behavior on destroy', () => {
    const animator = build('<div data-kui="smooth-scroll-to" style="scroll-behavior: auto"></div>')
    animator.start()
    expect(el().style.scrollBehavior).toBe('smooth')

    animator.destroy()
    expect(el().style.scrollBehavior).toBe('auto')
  })

  it('composes with scroll-snap — the pairing the narrowed channel exists to allow', () => {
    // `smooth-scroll` used to claim `'layout'`, which `scroll-snap` also claims, so this list was
    // refused as a collision and only the first effect compiled. Both have to sit on the same
    // element to do anything (neither property propagates to the viewport from `<body>`), so the
    // conflict message's "apply them to nested elements" had no valid nesting to offer. The two
    // write disjoint properties, so `smooth-scroll` now owns `'scroll-behavior'` alone.
    const animator = build(
      '<div data-kui="smooth-scroll-to, scroll-snap-y"><section>a</section></div>',
    )
    animator.start()

    expect(reporter.messages.join()).not.toContain('cannot compose')
    expect(el().style.scrollBehavior).toBe('smooth')
    expect(el().style.getPropertyValue('scroll-snap-type')).toBe('y mandatory')
  })
})

describe('registration and parameters', () => {
  it('registers every v2 scroll name', () => {
    const registry = catalogRegistry()
    for (const name of [
      'pin-section',
      'pin-until',
      'pin-spacer',
      'stacking-cards',
      'scroll-progress',
      'scrollytelling-step',
      'horizontal-scroll',
      'sequence-scrub',
      'video-scrub',
      'scroll-spy',
      'scroll-snap-x',
      'scroll-snap-y',
    ]) {
      expect(registry.has(name), name).toBe(true)
    }
  })

  it('rejects a dangerous parameter before it reaches the primitive', () => {
    const animator = build('<div data-kui="pin-until distance:url(http://evil.test)"></div>')
    stubRect(el(), 0)
    animator.start()
    expect(reporter.messages.join()).toContain('disallowed CSS syntax')
  })

  it('never writes a text parameter into the element style', () => {
    const animator = build('<div data-kui="scroll-spy target:nav a"></div>')
    stubRect(el(), 0)
    animator.start()
    expect(el().style.getPropertyValue('--kui-target')).toBe('')
  })
})
