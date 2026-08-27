import { beforeEach, describe, expect, it } from 'vitest'
import {
  build,
  el,
  scheduler,
  stubRect,
  stubRectWithSpacer,
} from './support/scroll-mechanics-harness.js'

/**
 * `horizontal-scroll`, both shapes of it.
 *
 * Split out of `scroll-mechanics.test.ts` once the managed-shape regression below pushed that file
 * over ESLint's per-file line cap — the same move `scroll-mechanics-readers.test.ts` and the two
 * spy files already made, and the one the parent file's own comment says to make.
 *
 * The two shapes are genuinely different mechanisms sharing a name: the bare form translates a row
 * the page has already positioned and pinned, while the managed form (`target:`) makes the host
 * itself the sticky, clipping, spacer-reserved window and translates the row it names.
 */

beforeEach(() => {
  document.body.innerHTML = ''
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

describe('horizontal-scroll — the managed shape reads progress from its spacer', () => {
  // The bare form translates a row the page already positioned; the managed form (`target:`) makes
  // the host itself the pinned window, and that is the one this covers. It used to track
  // `host.parentElement`, which is only correct when the host is the first thing in its parent —
  // and silently wrong by the height of anything above it, because progress then starts when the
  // *section* reaches the pin offset while the pin engages when the *host* does. On
  // `demo/index.html`'s reel the heading and the contract line sit above the stage, so the row
  // began travelling ~150px below the fold and the opening of the animation played off screen.
  //
  // Same defect `contentAnchor` closed for `pin` and `media-scrub`, and the numbers here are
  // chosen so the two readings cannot be confused: the section starts 150px above the host, so the
  // old behaviour reports 0.375 at the exact moment the correct answer is 0.
  const markup =
    '<section><div class="head"></div>' +
    '<div data-kui="horizontal-scroll distance:400px target:.track travel:1000px">' +
    '<div class="track"></div></div></section>'

  it('is 0 when the host reaches the pin offset, not when its section does', () => {
    const animator = build(markup)
    const stage = el()
    stubRect(stage, 0, 800)
    animator.start()
    stubRect(document.querySelector('section')!, -150, 950)
    stubRectWithSpacer(stage, 0, 800)
    scheduler.emit(0)

    expect(el('.track').style.translate).toBe('0px 0')
  })

  it('reaches half travel a full distance after the host pins, not after its section does', () => {
    const animator = build(markup)
    const stage = el()
    stubRect(stage, 0, 800)
    animator.start()
    stubRect(document.querySelector('section')!, -150, 950)
    stubRectWithSpacer(stage, 0, 800)
    scheduler.emit(0)

    // 200px further on, against distance:400px. Measured from the host that is 0.5; measured from
    // the section 150px above it, it would be 0.875.
    stubRect(document.querySelector('section')!, -350, 950)
    stubRectWithSpacer(stage, -200, 800)
    scheduler.emit(200, 1)

    expect(el('.track').style.translate).toBe('-500px 0')
  })
})
