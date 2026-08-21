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

