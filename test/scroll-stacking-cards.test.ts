import { beforeEach, describe, expect, it } from 'vitest'
import { build, scheduler, stubRect } from './support/scroll-mechanics-harness.js'

/**
 * `stacking-cards` — the `pin` primitive with its spacer turned off, applied once per card.
 *
 * Split out of scroll-mechanics.test.ts for the reason that file's harness note gives: the shared
 * rig lives in test/support/scroll-mechanics-harness.ts precisely so describe blocks can grow into
 * their own files instead of pushing one file past ESLint's per-file cap. `scroll-steps` and
 * `scroll-horizontal-managed` are the existing precedent.
 *
 * The preset had no behavioural test at all before this — only its name appeared, inside a flat
 * registration list, which proves the name resolves and nothing about what it does.
 */

beforeEach(() => {
  document.body.innerHTML = ''
})

// A pin tracks its containing block rather than itself, because sticky stops the element moving
// relative to the viewport. Same one-liner the `pin` block in scroll-mechanics.test.ts uses.
const stubContainer = (top: number, height = 400): void => stubRect(document.body, top, height)

// `stacking-cards` is `pin` with `spacer:'false'`, applied once per card — see presets.ts. It has
// no primitive of its own, so its only coverage until now was a name check in the registration
// list below; nothing exercised what the preset actually does.
describe('stacking-cards', () => {
  it('makes each sibling card sticky at its own offset, with no spacer — unlike pin-section', () => {
    const animator = build(
      '<div class="stack">' +
        '<div class="stack-item"><div data-kui="stacking-cards offset-top:20px"></div></div>' +
        '<div class="stack-item"><div data-kui="stacking-cards offset-top:40px"></div></div>' +
        '<div class="stack-item"><div data-kui="stacking-cards offset-top:60px"></div></div>' +
        '</div>',
    )
    for (const item of document.querySelectorAll('.stack-item')) stubRect(item as HTMLElement, 0)
    animator.start()

    const cards = [...document.querySelectorAll('[data-kui]')] as HTMLElement[]
    expect(cards).toHaveLength(3)
    expect(cards.map((card) => card.style.position)).toEqual(['sticky', 'sticky', 'sticky'])
    // Each card pins at its own offset — what makes the deck stack rather than one card replacing
    // another.
    expect(cards.map((card) => card.style.top)).toEqual(['20px', '40px', '60px'])

    // `spacer:'false'` is the whole point of this preset: a stacking deck must not reserve extra
    // scroll room per card, or every card would gain a viewport-tall gap before the next one.
    expect(document.querySelectorAll('[data-kui-spacer]')).toHaveLength(0)

    // Contrast, in the same test, with the primitive that DOES ship a spacer by default — asserting
    // both here is what makes "no spacer" a real guard instead of a coincidence of this fixture.
    const pinAnimator = build('<div data-kui="pin-section"></div>')
    stubContainer(0)
    pinAnimator.start()
    expect(document.querySelector('[data-kui-spacer]')).not.toBeNull()
  })

  it('tracks each card against its own container, independently of its siblings', () => {
    const animator = build(
      '<div class="stack">' +
        '<div class="stack-item"><div data-kui="stacking-cards distance:300px"></div></div>' +
        '<div class="stack-item"><div data-kui="stacking-cards distance:300px"></div></div>' +
        '</div>',
    )
    const items = [...document.querySelectorAll('.stack-item')] as HTMLElement[]
    const cards = [...document.querySelectorAll('[data-kui]')] as HTMLElement[]
    // Card 1's own container is already half travelled; card 2's hasn't reached the pin point yet.
    // Same scheduler tick for both — if they shared one tracker instead of one each, they would
    // report the same number.
    stubRect(items[0]!, -150, 300)
    stubRect(items[1]!, 400, 300)
    animator.start()
    scheduler.emit(0)

    expect(Number(cards[0]!.style.getPropertyValue('--kui-progress'))).toBeCloseTo(0.5)
    expect(cards[0]!.getAttribute('data-kui-pinned')).toBe('true')
    expect(Number(cards[1]!.style.getPropertyValue('--kui-progress'))).toBe(0)
    expect(cards[1]!.getAttribute('data-kui-pinned')).toBe('false')
  })

  it('restores the deck completely on destroy — no attribute or spacer left behind', () => {
    const html =
      '<div class="stack">' +
      '<div class="stack-item"><div data-kui="stacking-cards distance:300px offset-top:20px"></div></div>' +
      '<div class="stack-item"><div data-kui="stacking-cards distance:300px offset-top:40px"></div></div>' +
      '</div>'
    const animator = build(html)
    const container = document.querySelector('.stack') as HTMLElement
    // Snapshotted before any effect runs, so teardown is checked against the author's own markup —
    // not against the handful of properties this test happened to think to name.
    const before = container.innerHTML

    for (const item of document.querySelectorAll('.stack-item')) stubRect(item as HTMLElement, -100, 300)
    animator.start()
    scheduler.emit(150) // exercise the progress and pinned-attribute writes before tearing down
    animator.destroy()

    expect(container.innerHTML).toBe(before)
    expect(scheduler.subscriberCount()).toBe(0)
  })
})
