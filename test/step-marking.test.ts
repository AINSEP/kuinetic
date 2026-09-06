import { describe, expect, it, vi } from 'vitest'
import type { PrepareContext } from '../src/core/effect-context.js'
import { resolveTarget, selectorBreadth } from '../src/core/target.js'
import { STEP_OFFSET_ATTR, STEP_STATE_ATTR, circularOffset, createStepMarker, stepStateFor } from '../src/effects/step-marking.js'

/**
 * Direct tests for the step-marking units.
 *
 * `stepStateFor` and `selectorBreadth` are both pure and both claim in their doc comments to be
 * assertable on their own; every other test reaches them through a primitive and a fake scheduler,
 * which exercises one path each and says nothing about the edges. This file is the promise kept.
 */

const ctxFor = (warn = vi.fn()): PrepareContext =>
  ({ doc: document, warn }) as unknown as PrepareContext

describe('STEP_STATE_ATTR', () => {
  it('is the documented attribute name', () => {
    // A published styling contract: `demo/scroll.html`, `src/css/forms.css` and the catalog docs
    // all select on this exact string, and none of them can be type-checked against it.
    expect(STEP_STATE_ATTR).toBe('data-kui-step-state')
  })
})

/**
 * The ring arithmetic behind a carousel that loops instead of rewinding.
 *
 * `stepStateFor` says the last slide is "before" the first; it cannot say it is *one place*
 * behind it, and that distance is the whole difference between carrying on and snapping back.
 */
describe('STEP_OFFSET_ATTR', () => {
  it('is published as a selectable attribute, not only as a number', () => {
    // A number can be multiplied; it cannot be selected on. Hiding a slide that is off the visible
    // part of the ring needs `visibility`, which is a keyword — so a page needs a selector, and
    // `--kui-offset` alone cannot give it one. `opacity: 0` is not a substitute: it leaves the
    // element hit-testable, focusable and in the accessibility tree.
    expect(STEP_OFFSET_ATTR).toBe('data-kui-step-offset')
  })

  it('stamps the same ring place on the element that the custom property carries', () => {
    document.body.innerHTML = '<ol><li></li><li></li><li></li><li></li><li></li></ol>'
    const items = [...document.querySelectorAll('li')]
    const marker = createStepMarker(() => items)
    marker.mark(0)

    expect(items.map((n) => n.getAttribute(STEP_OFFSET_ATTR))).toEqual(['0', '1', '2', '-2', '-1'])
    expect(items.map((n) => n.style.getPropertyValue('--kui-offset'))).toEqual(['0', '1', '2', '-2', '-1'])

    marker.restore()
    expect(items.map((n) => n.hasAttribute(STEP_OFFSET_ATTR))).toEqual([false, false, false, false, false])
    document.body.replaceChildren()
  })
})

describe('circularOffset', () => {
  it('measures places from the live step, counting backwards round the short way', () => {
    // Five slides, the first one live: the last two are behind it, not three and four ahead.
    expect([0, 1, 2, 3, 4].map((p) => circularOffset(p, 0, 5))).toEqual([0, 1, 2, -2, -1])
  })

  it('keeps the live step at zero wherever it sits', () => {
    expect(circularOffset(3, 3, 5)).toBe(0)
    expect([0, 1, 2, 3, 4].map((p) => circularOffset(p, 3, 5))).toEqual([2, -2, -1, 0, 1])
  })

  it('never returns a value that would place a slide further than half the ring away', () => {
    for (let size = 1; size <= 9; size++) {
      for (let index = 0; index < size; index++) {
        for (let position = 0; position < size; position++) {
          expect(Math.abs(circularOffset(position, index, size))).toBeLessThanOrEqual(size / 2)
        }
      }
    }
  })

  it('sends the exact half of an even ring forwards, by convention', () => {
    expect(circularOffset(2, 0, 4)).toBe(2)
  })

  it('stays at zero for a degenerate size rather than dividing by it', () => {
    expect(circularOffset(0, 0, 0)).toBe(0)
    expect(circularOffset(3, 1, 0)).toBe(0)
  })
})

describe('stepStateFor', () => {
  it('splits three ways around the live index', () => {
    expect(stepStateFor(0, 2)).toBe('before')
    expect(stepStateFor(1, 2)).toBe('before')
    expect(stepStateFor(2, 2)).toBe('active')
    expect(stepStateFor(3, 2)).toBe('after')
  })

  it('marks the first element active at index 0, with nothing before it', () => {
    expect(stepStateFor(0, 0)).toBe('active')
    expect(stepStateFor(1, 0)).toBe('after')
  })
})

describe('selectorBreadth', () => {
  it('accepts an ordinary scoped selector', () => {
    expect(selectorBreadth('.lines > li', document)).toBe('ok')
  })

  it.each(['*', 'html', 'body', ':root', '*, a'])(
    'calls %s document-wide rather than letting it stamp everything',
    (selector) => {
      expect(selectorBreadth(selector, document)).toBe('document-wide')
    },
  )

  it('keeps a deliberately scoped wildcard usable', () => {
    // The point of testing breadth by matching rather than banning `*` syntactically.
    expect(selectorBreadth('.nav > *', document)).toBe('ok')
  })

  // Not `a::` — sonarjs reads a bare `::` as an IPv6 literal and fails the lint.
  it.each(['[', '<<<', 'li:nth-child(', '.a >'])('reports %s as invalid', (selector) => {
    expect(selectorBreadth(selector, document)).toBe('invalid')
  })
})

describe('resolveTarget', () => {
  it('passes an empty selector straight through as the no-op default', () => {
    const warn = vi.fn()
    expect(resolveTarget('', ctxFor(warn), 'scrollytelling-step')).toBe('')
    expect(warn).not.toHaveBeenCalled()
  })

  it('names the effect in its warning, so the author knows which attribute to fix', () => {
    const warn = vi.fn()
    expect(resolveTarget('*', ctxFor(warn), 'step-progress')).toBe('')
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('step-progress'))
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('matches the whole document'))
  })

  it('distinguishes an unparseable selector from an over-broad one', () => {
    const warn = vi.fn()
    expect(resolveTarget('[', ctxFor(warn), 'scroll-spy')).toBe('')
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('is not a valid selector'))
  })
})

describe('createStepMarker', () => {
  it('restores an attribute the consumer authored, rather than deleting it', () => {
    document.body.innerHTML = '<i data-kui-step-state="mine"></i><i></i>'
    const nodes = [...document.querySelectorAll('i')]
    const marker = createStepMarker(() => nodes)

    marker.mark(1)
    expect(nodes[0]!.getAttribute(STEP_STATE_ATTR)).toBe('before')

    marker.restore()
    expect(nodes[0]!.getAttribute(STEP_STATE_ATTR)).toBe('mine')
    expect(nodes[1]!.hasAttribute(STEP_STATE_ATTR)).toBe(false)
  })

  it('re-resolves on every mark, so elements added after setup are picked up', () => {
    document.body.innerHTML = '<i></i>'
    const marker = createStepMarker(() => document.querySelectorAll('i'))
    marker.mark(0)

    document.body.insertAdjacentHTML('beforeend', '<i></i>')
    marker.mark(1)

    const states = [...document.querySelectorAll('i')].map((n) => n.getAttribute(STEP_STATE_ATTR))
    expect(states).toEqual(['before', 'active'])
  })

  it('is safe to restore twice', () => {
    document.body.innerHTML = '<i></i>'
    const marker = createStepMarker(() => document.querySelectorAll('i'))
    marker.mark(0)
    marker.restore()
    expect(() => marker.restore()).not.toThrow()
    expect(document.querySelector('i')!.hasAttribute(STEP_STATE_ATTR)).toBe(false)
  })
})

/**
 * Groups of different sizes under one `target:`.
 *
 * `target:` routinely names two parallel groups — the slides and the dots that track them — and
 * nothing makes an author write the same number of each. When the counts differ, the two facts a
 * marker publishes about the same element used to disagree: `--kui-offset` has always been
 * computed on the group's own ring (it has to be, or the last slide would not sit one place
 * *behind* the first), while `data-kui-step-state` was read off the raw index. Both are now
 * derived from the same per-group number, so the invariant below holds for any markup at all.
 */
describe('createStepMarker with mismatched groups', () => {
  const marked = (selector: string): { state: string | null; offset: string | null }[] =>
    [...document.querySelectorAll(selector)].map((n) => ({
      state: n.getAttribute(STEP_STATE_ATTR),
      offset: n.getAttribute(STEP_OFFSET_ATTR),
    }))

  it('never leaves a group with an offset of 0 and no active element', () => {
    // Five slides, four dots, index 4. `stepStateFor(position, 4)` marked all four dots `before`
    // while `circularOffset(0, 4, 4)` gave dot 0 an offset of 0 — the ring's live place. A page
    // hiding `[data-kui-step-offset]:not([data-kui-step-offset='0'])` showed a dot the page's own
    // `[data-kui-step-state='active']` rule refused to light, and at that index no dot was active
    // at all.
    document.body.innerHTML =
      '<ol class="slides"><li></li><li></li><li></li><li></li><li></li></ol>' +
      '<nav class="dots"><b></b><b></b><b></b><b></b></nav>'
    const marker = createStepMarker(() => document.querySelectorAll('li, b'))

    marker.mark(4)

    expect(marked('.slides li')[4]).toEqual({ state: 'active', offset: '0' })
    const dots = marked('.dots b')
    expect(dots.filter((d) => d.offset === '0')).toEqual(dots.filter((d) => d.state === 'active'))
    expect(dots.filter((d) => d.state === 'active')).toHaveLength(1)

    marker.restore()
    document.body.replaceChildren()
  })

  it('says so, once, rather than only picking an answer', () => {
    // Whatever the marker does with four dots and five slides is arbitrary — there is no correct
    // dot for slide five. Consistency is the most it can offer; naming the markup mistake is the
    // rest of the answer. Once per marker, because the condition is a property of the markup and a
    // deck flips as fast as a visitor can press an arrow.
    document.body.innerHTML = '<ol><li></li><li></li><li></li></ol><nav><b></b><b></b></nav>'
    const warn = vi.fn()
    const marker = createStepMarker(() => document.querySelectorAll('li, b'), warn)

    marker.mark(0)
    marker.mark(1)
    marker.mark(2)

    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('groups of different sizes (3, 2)'))

    marker.restore()
    document.body.replaceChildren()
  })

  it('stays silent when the groups agree, which is every deck that is authored right', () => {
    document.body.innerHTML = '<ol><li></li><li></li></ol><nav><b></b><b></b></nav>'
    const warn = vi.fn()
    const marker = createStepMarker(() => document.querySelectorAll('li, b'), warn)

    marker.mark(1)

    expect(warn).not.toHaveBeenCalled()
    // `+1`, not `-1`: an even count has no midpoint to split, and `circularOffset` sends the exact
    // half forwards by convention. See its own test above.
    expect(marked('li')).toEqual([
      { state: 'before', offset: '1' },
      { state: 'active', offset: '0' },
    ])
    expect(marked('b')).toEqual(marked('li'))

    marker.restore()
    document.body.replaceChildren()
  })
})
