import { describe, expect, it } from 'vitest'
import { build, el, reporter } from './support/scroll-mechanics-harness.js'

/*
 * `scroll-snap-type` does nothing at all without an `overflow` on the same element — the two are
 * one mechanism, and the library only ever wrote half of it. Every page using `scroll-snap-x` had
 * to know to add `overflow-x: auto` itself, and got silence rather than an error when it forgot.
 * `scroll-snap-align` was likewise hardcoded to direct children, so an author whose cards were one
 * level deeper got a container that scrolled and never snapped.
 *
 * `target:` opts into the library owning both, the same contract `horizontal-scroll` uses.
 * Without it, behaviour is exactly what it has always been.
 */
describe('scroll-snap, managed by target:', () => {
  it('writes the overflow that makes snapping work at all', () => {
    const animator = build(
      '<div data-kui="scroll-snap-x target:figure"><figure>a</figure><figure>b</figure></div>',
    )
    animator.start()
    const host = el()
    expect(host.style.getPropertyValue('scroll-snap-type')).toBe('x mandatory')
    expect(host.style.overflowX).toBe('auto')
    // A row of block children in an `overflow-x` box does not lay out as a row on its own.
    expect(host.style.display).toBe('flex')
  })

  it('scrolls the other way for the y axis, and does not force a row layout', () => {
    const animator = build(
      '<div data-kui="scroll-snap-y target:figure"><figure>a</figure><figure>b</figure></div>',
    )
    animator.start()
    const host = el()
    expect(host.style.getPropertyValue('scroll-snap-type')).toBe('y mandatory')
    expect(host.style.overflowY).toBe('auto')
    expect(host.style.display).toBe('')
  })

  it('aligns the elements target: names, not merely the direct children', () => {
    const animator = build(
      '<div data-kui="scroll-snap-x target:figure">' +
        '<div class="wrap"><figure>a</figure><figure>b</figure></div></div>',
    )
    animator.start()
    const figures = [...el().querySelectorAll('figure')]
    expect(figures).toHaveLength(2)
    for (const figure of figures) {
      expect((figure as HTMLElement).style.getPropertyValue('scroll-snap-align')).toBe('start')
    }
    // The intermediate wrapper is not a snap item and must not be marked as one.
    const inner = el().querySelector('.wrap') as HTMLElement
    expect(inner.style.getPropertyValue('scroll-snap-align')).toBe('')
  })

  it('hands every element back untouched on destroy', () => {
    const animator = build(
      '<div data-kui="scroll-snap-x target:figure"><figure>a</figure><figure>b</figure></div>',
    )
    const host = el()
    const authored = host.innerHTML
    animator.start()
    animator.destroy()

    expect(host.innerHTML).toBe(authored)
    expect(host.style.overflowX).toBe('')
    expect(host.style.display).toBe('')
  })

  it('warns rather than silently snapping nothing when target: matches nothing', () => {
    const animator = build('<div data-kui="scroll-snap-x target:.missing"><figure>a</figure></div>')
    animator.start()
    expect(reporter.messages.join(' ')).toContain('matched nothing')
  })

  it('without target:, behaves exactly as it always has — direct children, no overflow written', () => {
    const animator = build('<div data-kui="scroll-snap-x"><figure>a</figure></div>')
    animator.start()
    const host = el()
    expect(host.style.getPropertyValue('scroll-snap-type')).toBe('x mandatory')
    expect(host.style.overflowX).toBe('')
    const figure = host.querySelector('figure') as HTMLElement
    expect(figure.style.getPropertyValue('scroll-snap-align')).toBe('start')
  })
})
