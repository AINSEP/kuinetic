import { beforeEach, describe, expect, it } from 'vitest'
import { domPosition, progressFrom, trackProgress } from '../src/effects/scroll-mechanics/tracker.js'
import type { PrepareContext } from '../src/core/effect-context.js'
import { createParams } from '../src/core/js-params.js'
import { createStyleLedger } from '../src/core/owned-styles.js'
import { createRegistry } from '../src/effects/index.js'
import {
  build,
  el,
  fakeRoot,
  fakeScheduler,
  reporter,
  scheduler,
  stubRect,
} from './support/scroll-mechanics-harness.js'

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

describe('domPosition', () => {
  it('reads the resolved position through the element\'s own view', () => {
    const node = document.createElement('div')
    node.style.position = 'sticky'
    document.body.append(node)
    expect(domPosition(node)).toBe('sticky')
  })

  it('answers "static" for an element whose document has no view', () => {
    // A document from `createHTMLDocument`/`DOMParser` has `defaultView === null`, and so does any
    // element inside it. `getComputedStyle` is only reachable through a window, so without this
    // guard the sticky walk-up would throw on markup parsed but never attached — which is exactly
    // what `show-code.js` does to every demo page on load.
    const detached = document.implementation.createHTMLDocument('')
    expect(detached.defaultView).toBeNull()
    expect(domPosition(detached.createElement('div'))).toBe('static')
  })
})

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
    const registry = createRegistry()
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

describe('horizontal-scroll', () => {
  it('translates the track in proportion to progress', () => {
    const animator = build('<div data-kui="horizontal-scroll distance:400px travel:1000px"></div>')
    stubRect(el(), -200)
    animator.start()
    scheduler.emit(200)
    expect(el().style.translate).toBe('-500px 0')
  })

  it('clears the translation on destroy', () => {
    const animator = build('<div data-kui="horizontal-scroll travel:100px"></div>')
    stubRect(el(), 0)
    animator.start()
    scheduler.emit(0)
    animator.destroy()
    expect(el().style.translate).toBe('')
  })

  it('measures its own scrollWidth overflow when travel is left at "auto"', () => {
    const animator = build('<div data-kui="horizontal-scroll distance:400px"></div>')
    const track = el()
    stubRect(track, -200)
    Object.defineProperty(track, 'scrollWidth', { value: 1500, configurable: true })
    Object.defineProperty(track, 'clientWidth', { value: 500, configurable: true })
    animator.start()
    scheduler.emit(200)
    // travel = scrollWidth - clientWidth = 1000; progress 0.5 -> -500px.
    expect(track.style.translate).toBe('-500px 0')
  })

  it('falls back to the parent width when the track has no self-overflow', () => {
    const animator = build(
      '<div><div data-kui="horizontal-scroll distance:400px"></div></div>',
    )
    const track = el()
    stubRect(track, -200)
    // width: max-content shape — the track's own box always exactly fits its content, so
    // scrollWidth - clientWidth is permanently zero and travel must come from the parent instead.
    Object.defineProperty(track, 'scrollWidth', { value: 500, configurable: true })
    Object.defineProperty(track, 'clientWidth', { value: 500, configurable: true })
    Object.defineProperty(track.parentElement!, 'clientWidth', { value: 300, configurable: true })
    animator.start()
    scheduler.emit(200)
    // travel = parent clientWidth(300) subtracted from scrollWidth(500) = 200; progress 0.5 -> -100px.
    expect(track.style.translate).toBe('-100px 0')
  })

  it('falls back to the document element width when the parent has none to offer either', () => {
    const animator = build('<div data-kui="horizontal-scroll distance:400px"></div>')
    const track = el()
    stubRect(track, -200)
    // jsdom's default, un-stubbed clientWidth is 0 for every element, including the parent —
    // falsy, so `node.parentElement?.clientWidth || ...` must fall through to the document.
    Object.defineProperty(track, 'scrollWidth', { value: 500, configurable: true })
    Object.defineProperty(track, 'clientWidth', { value: 500, configurable: true })
    Object.defineProperty(document.documentElement, 'clientWidth', { value: 350, configurable: true })
    animator.start()
    scheduler.emit(200)
    // travel = documentElement clientWidth(350) subtracted from scrollWidth(500) = 150; -> -75px.
    expect(track.style.translate).toBe('-75px 0')
  })
})

describe('media-scrub', () => {
  it('writes the frame pattern to an <img> src, substituting {i}', () => {
    const animator = build(
      '<img data-kui="sequence-scrub distance:400px frames:4 src:frame-{i}.jpg">',
    )
    stubRect(el('img'), 0)
    animator.start()
    scheduler.emit(0)
    expect((el('img') as HTMLImageElement).src).toContain('frame-0.jpg')

    stubRect(el('img'), -400)
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
    scheduler.emit(10) // progress ~0.025 -> index 0

    const srcAfterFirst = img.src
    expect(srcAfterFirst).toContain('frame-0.jpg')

    stubRect(img, -50)
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

  // demo/scroll.html's real sequence-scrub markup, verified live: must keep cycling frames.
  it('keeps the showcase\'s ./assets/scenic_scrub_{i}.jpg pattern working', () => {
    const animator = build(
      '<img data-kui="sequence-scrub frames:5 src:./assets/scenic_scrub_{i}.jpg distance:220vh">',
    )
    stubRect(el('img'), 0)
    animator.start()
    scheduler.emit(0)
    // `./` is stripped by URL resolution, same as any browser normalizing a relative path.
    expect((el('img') as HTMLImageElement).src).toContain('assets/scenic_scrub_0.jpg')
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
})

describe('scroll-snap', () => {
  it('applies native snapping to the container and its children', () => {
    const animator = build('<ul data-kui="scroll-snap-x"><li></li><li></li></ul>')
    animator.start()

    expect(el('ul').style.scrollSnapType).toContain('x')
    const items = [...document.querySelectorAll('li')] as HTMLElement[]
    expect(items.every((item) => item.style.scrollSnapAlign === 'start')).toBe(true)
  })

  it('snaps along the y axis for scroll-snap-y', () => {
    const animator = build('<ul data-kui="scroll-snap-y"><li></li></ul>')
    animator.start()
    expect(el('ul').style.scrollSnapType).toContain('y')
  })

  it('restores each child\'s own scroll-snap-align on destroy, not just the container', () => {
    const animator = build(
      '<ul data-kui="scroll-snap-x"><li style="scroll-snap-align: end"></li><li></li></ul>',
    )
    animator.start()
    const items = [...document.querySelectorAll('li')] as HTMLElement[]
    expect(items[0]!.style.scrollSnapAlign).toBe('start')

    animator.destroy()
    expect(items[0]!.style.scrollSnapAlign).toBe('end')
    expect(items[1]!.style.scrollSnapAlign).toBe('')
  })
})

describe('registration and parameters', () => {
  it('registers every v2 scroll name', () => {
    const registry = createRegistry()
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
