import { describe, expect, it, vi } from 'vitest'
import type { PrepareContext } from '../src/core/effect-context.js'
import { resolveTarget, selectorBreadth } from '../src/core/target.js'
import { STEP_STATE_ATTR, createStepMarker, stepStateFor } from '../src/effects/step-marking.js'

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
