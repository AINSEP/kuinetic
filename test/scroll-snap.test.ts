import { beforeEach, describe, expect, it } from 'vitest'
import { build, el } from './support/scroll-mechanics-harness.js'

/**
 * `scroll-snap-x` / `scroll-snap-y` — the native passthrough, and the one primitive here that
 * writes no animation at all.
 *
 * Split out of scroll-mechanics.test.ts for the reason its harness note gives: the shared rig
 * lives in test/support/scroll-mechanics-harness.ts so describe blocks can move into their own
 * files rather than pushing one past ESLint's per-file cap. `scroll-steps`,
 * `scroll-horizontal-managed` and `scroll-stacking-cards` are the existing precedent.
 */

beforeEach(() => {
  document.body.innerHTML = ''
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
