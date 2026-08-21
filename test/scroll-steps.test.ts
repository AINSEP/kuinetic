import { beforeEach, describe, expect, it } from 'vitest'
import { build, el, reporter, scheduler, stubRect } from './support/scroll-mechanics-harness.js'

/**
 * `scroll-progress` and its `target:` step marking.
 *
 * Split out of scroll-mechanics.test.ts, which was over the 400-line cap — the same reason
 * scroll-scheduler-dom-roots.test.ts was split out of scroll-scheduler.test.ts. Shares the fake
 * scheduler and `build`/`stubRect`/`el` helpers from test/support/scroll-mechanics-harness.ts.
 */

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('scroll-progress', () => {
  it('publishes a discrete step index for scrollytelling', () => {
    const animator = build('<div data-kui="scrollytelling-step distance:400px steps:4"></div>')
    stubRect(el(), 0)
    animator.start()

    scheduler.emit(0)
    expect(el().getAttribute('data-kui-step')).toBe('0')

    stubRect(el(), -300)
    scheduler.emit(300, 1)
    expect(el().getAttribute('data-kui-step')).toBe('3')
  })

  it('clamps the final step rather than going one past the end', () => {
    const animator = build('<div data-kui="scrollytelling-step distance:400px steps:4"></div>')
    stubRect(el(), -400)
    animator.start()
    scheduler.emit(400)
    expect(el().getAttribute('data-kui-step')).toBe('3')
  })

  it('omits the step attribute when steps is 0', () => {
    const animator = build('<div data-kui="scroll-progress"></div>')
    stubRect(el(), 0)
    animator.start()
    scheduler.emit(0)
    expect(el().hasAttribute('data-kui-step')).toBe(false)
  })

  it('removes the step attribute on destroy', () => {
    const animator = build('<div data-kui="scrollytelling-step distance:400px steps:4"></div>')
    stubRect(el(), -300)
    animator.start()
    scheduler.emit(300)
    expect(el().hasAttribute('data-kui-step')).toBe(true)

    animator.destroy()
    expect(el().hasAttribute('data-kui-step')).toBe(false)
  })

  it('restores an authored step value rather than deleting it', () => {
    // Real markup authors `data-kui-step="0"` so the first step is styled before hydration.
    // Teardown used to `removeAttribute` it, destroying the consumer's own value.
    const animator = build(
      '<div data-kui="scrollytelling-step distance:400px steps:4" data-kui-step="0"></div>',
    )
    stubRect(el(), -300)
    animator.start()
    scheduler.emit(300)
    expect(el().getAttribute('data-kui-step')).toBe('3')

    animator.destroy()
    expect(el().getAttribute('data-kui-step')).toBe('0')
  })
})

describe('scroll-progress — target:', () => {
  const MARKUP =
    '<div data-kui="scrollytelling-step distance:400px steps:4 target:\'.lines > li\'">' +
    '<ol class="lines"><li></li><li></li><li></li><li></li></ol></div>'
  const states = (): string[] =>
    [...document.querySelectorAll('.lines li')].map(
      (node) => node.getAttribute('data-kui-step-state') ?? '',
    )

  it('marks each step element before, active or after the live index', () => {
    const animator = build(MARKUP)
    stubRect(el(), 0)
    animator.start()

    scheduler.emit(0)
    expect(states()).toEqual(['active', 'after', 'after', 'after'])

    stubRect(el(), -200)
    scheduler.emit(200, 1)
    expect(states()).toEqual(['before', 'before', 'active', 'after'])
  })

  it('numbers each parent group from zero, so parallel groups stay in step', () => {
    // The copy lines and the dots that track them are two sibling lists of the same length.
    // Document order would number them 0-3 then 4-7, leaving the dots permanently `after`.
    const animator = build(
      '<div data-kui="scrollytelling-step distance:400px steps:4 target:\'.lines > li, .dots > i\'">' +
        '<ol class="lines"><li></li><li></li><li></li><li></li></ol>' +
        '<p class="dots"><i></i><i></i><i></i><i></i></p></div>',
    )
    stubRect(el(), -200)
    animator.start()
    scheduler.emit(200)

    const dots = [...document.querySelectorAll('.dots i')].map((n) =>
      n.getAttribute('data-kui-step-state'),
    )
    expect(dots).toEqual(['before', 'before', 'active', 'after'])
  })

  it('publishes the live index as a unitless custom property for calc()', () => {
    // Selectors cannot do arithmetic, so a per-step transform is one rule per step without this.
    const animator = build('<div data-kui="scrollytelling-step distance:400px steps:4"></div>')
    stubRect(el(), -200)
    animator.start()
    scheduler.emit(200)
    expect(el().style.getPropertyValue('--kui-step')).toBe('2')
  })

  it('does no work on a frame where the index has not changed', () => {
    // Frames are continuous, the index is not. Without this guard every scroll frame re-ran
    // `querySelectorAll` over the whole target set and re-stamped every match — per-frame work
    // with no per-frame result. Observable by clearing a mark by hand: a frame at the same index
    // must not put it back.
    const animator = build(MARKUP)
    stubRect(el(), -200)
    animator.start()
    scheduler.emit(200)

    const first = document.querySelector('.lines li')!
    expect(first.getAttribute('data-kui-step-state')).toBe('before')
    first.removeAttribute('data-kui-step-state')

    scheduler.emit(210) // same step, still index 2
    expect(first.hasAttribute('data-kui-step-state')).toBe(false)

    stubRect(el(), -320)
    scheduler.emit(320, 1) // index moves to 3 — now it re-marks
    expect(first.getAttribute('data-kui-step-state')).toBe('before')
  })

  it('gives the step elements their original attribute back on destroy', () => {
    const animator = build(MARKUP)
    stubRect(el(), -200)
    animator.start()
    scheduler.emit(200)
    expect(states()).not.toContain('')

    animator.destroy()
    expect(states()).toEqual(['', '', '', ''])
  })

  it('ignores a document-wide target instead of stamping every element', () => {
    const animator = build(
      '<div data-kui="scrollytelling-step distance:400px steps:4 target:*"><li></li></div>',
    )
    stubRect(el(), -200)
    animator.start()
    scheduler.emit(200)

    expect(document.documentElement.hasAttribute('data-kui-step-state')).toBe(false)
    expect(reporter.messages.join()).toContain('matches the whole document')
  })
})


describe('media-scrub — target:', () => {
  const FRAMES =
    '<div class="stage" data-kui="sequence-scrub distance:400px target:\'.stage img\'">' +
    '<img src="a.jpg"><img src="b.jpg"><img src="c.jpg"><img src="d.jpg"></div>'
  const states = (): string[] =>
    [...document.querySelectorAll('.stage img')].map(
      (node) => node.getAttribute('data-kui-step-state') ?? '',
    )

  it('reveals one authored frame at a time instead of rewriting a src', () => {
    const animator = build(FRAMES)
    stubRect(el('.stage'), 0)
    animator.start()

    scheduler.emit(0)
    expect(states()).toEqual(['active', 'after', 'after', 'after'])

    stubRect(el('.stage'), -200)
    scheduler.emit(200, 1)
    expect(states()).toEqual(['before', 'before', 'active', 'after'])
  })

  it('never touches any frame\'s src, which is the whole point of the form', () => {
    // The `src:` form fetches each frame at the moment scrolling reaches it, so the first pass
    // through a scrub is always cold. Authored frames load with the page; if this form ever
    // started rewriting src it would have reintroduced exactly the problem it exists to solve.
    const animator = build(FRAMES)
    stubRect(el('.stage'), -400)
    animator.start()
    scheduler.emit(400)
    const sources = [...document.querySelectorAll('.stage img')].map((n) => n.getAttribute('src'))
    expect(sources).toEqual(['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg'])
  })

  it('takes the frame count from the match, ignoring a frames: that disagrees', () => {
    // Two sources of truth for one number can only ever drift. The frames are the tags you wrote.
    const animator = build(
      '<div class="stage" data-kui="sequence-scrub distance:400px frames:99 target:\'.stage img\'">' +
        '<img src="a.jpg"><img src="b.jpg"></div>',
    )
    stubRect(el('.stage'), -399)
    animator.start()
    scheduler.emit(399)
    // With frames:99 honoured this would still be on frame 0 of 99; with 2 it is the last one.
    expect(states()).toEqual(['before', 'active'])
  })

  it('marks the first frame at setup, so the stack is never briefly all-hidden', () => {
    // Every frame is `opacity: 0` until one is marked `active`, so waiting for the first scroll
    // callback would show an empty box on load.
    const animator = build(FRAMES)
    stubRect(el('.stage'), 0)
    animator.start()
    expect(states()[0]).toBe('active')
  })

  it('prefers target: over src: when an author writes both', () => {
    const animator = build(
      '<div class="stage" data-kui="sequence-scrub distance:400px frames:4 src:frame-{i}.jpg target:\'.stage img\'">' +
        '<img src="a.jpg"><img src="b.jpg"></div>',
    )
    stubRect(el('.stage'), 0)
    animator.start()
    scheduler.emit(0)
    expect(states()).toEqual(['active', 'after'])
    expect(el('.stage').getAttribute('src')).toBeNull()
  })

  it('warns and ignores a document-wide target rather than stamping every element', () => {
    const animator = build(
      '<div class="stage" data-kui="sequence-scrub distance:400px target:\'body\'">' +
        '<img src="a.jpg"></div>',
    )
    stubRect(el('.stage'), 0)
    animator.start()
    scheduler.emit(0)
    expect(reporter.messages.join()).toContain('matches the whole document')
    expect(document.body.getAttribute('data-kui-step-state')).toBeNull()
  })

  it('gives frames back their original step-state on teardown', () => {
    const animator = build(FRAMES)
    stubRect(el('.stage'), -200)
    animator.start()
    scheduler.emit(200)
    expect(states()).not.toEqual(['', '', '', ''])
    animator.destroy()
    expect(states()).toEqual(['', '', '', ''])
  })
})

describe('media-scrub — target: edge cases', () => {
  it('does no work on frames that do not change the index', () => {
    // The guard exists because frames are continuous and the index is not: re-stamping every
    // matched element on every scroll frame is the per-frame waste scroll-spy's note calls out.
    // Asserted by hand-editing a stamp and checking a same-index frame does not restore it.
    const animator = build(
      '<div class="stage" data-kui="sequence-scrub distance:400px target:\'.stage img\'">' +
        '<img src="a.jpg"><img src="b.jpg"></div>',
    )
    stubRect(el('.stage'), 0)
    animator.start()
    scheduler.emit(0)

    const first = document.querySelector('.stage img')!
    expect(first.getAttribute('data-kui-step-state')).toBe('active')
    first.setAttribute('data-kui-step-state', 'sentinel')

    // Same frame index, a slightly different scroll position.
    stubRect(el('.stage'), -10)
    scheduler.emit(10, 1)
    expect(first.getAttribute('data-kui-step-state')).toBe('sentinel')
  })

  it('survives a valid target that matches nothing, rather than dividing by zero', () => {
    // `resolveTarget` rejects the invalid and the over-broad, but ".stage .missing" is neither —
    // it is simply a selector for elements that are not there, which a typo produces easily.
    const animator = build(
      '<div class="stage" data-kui="sequence-scrub distance:400px target:\'.stage .missing\'">' +
        '<img src="a.jpg"></div>',
    )
    stubRect(el('.stage'), -200)
    animator.start()
    expect(() => scheduler.emit(200)).not.toThrow()
    expect(el('.stage').style.getPropertyValue('--kui-progress')).toBe('0.5000')
  })
})
