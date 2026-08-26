import { describe, expect, it } from 'vitest'
import {
  authorisingActivations,
  isKnownEventType,
  isNamedActivation,
  isOneShot,
  resolveActivationSpec,
  startKindOf,
  suggestActivation,
  validateActivation,
} from '../src/core/activation-vocabulary.js'

describe('resolveActivationSpec', () => {
  it('keeps the six original names bound to exactly what they always bound', () => {
    // LOCKED by the task brief: existing markup must behave identically. `hover` listening for
    // `focusin` as well as `pointerenter` is the part most easily lost in a rewrite, because it is
    // the one name whose expansion is not its own spelling.
    expect(resolveActivationSpec('load').start).toEqual({ kind: 'immediate' })
    expect(resolveActivationSpec('manual').start).toEqual({ kind: 'manual' })
    expect(resolveActivationSpec('enter').start).toEqual({ kind: 'observed', when: 'enter' })
    expect(resolveActivationSpec('hover').start).toEqual({
      kind: 'events',
      types: ['pointerenter', 'focusin'],
    })
    expect(resolveActivationSpec('focus').start).toEqual({ kind: 'events', types: ['focusin'] })
    expect(resolveActivationSpec('click').start).toEqual({ kind: 'events', types: ['click'] })
  })

  it('passes an unrecognised name straight through as an event type', () => {
    expect(resolveActivationSpec('input').start).toEqual({ kind: 'events', types: ['input'] })
    expect(resolveActivationSpec('cart:updated').start).toEqual({
      kind: 'events',
      types: ['cart:updated'],
    })
  })

  it('splits a slash pair into a start and an end', () => {
    const spec = resolveActivationSpec('pointerenter/pointerleave')
    expect(spec.names).toEqual(['pointerenter', 'pointerleave'])
    expect(spec.start).toEqual({ kind: 'events', types: ['pointerenter'] })
    expect(spec.end).toEqual({ kind: 'events', types: ['pointerleave'] })
  })

  it('gives enter an observed exit twin', () => {
    const spec = resolveActivationSpec('enter/leave')
    expect(spec.start).toEqual({ kind: 'observed', when: 'enter' })
    expect(spec.end).toEqual({ kind: 'observed', when: 'leave' })
  })

  it('expands the paired sugar to the same events an author could write by hand', () => {
    expect(resolveActivationSpec('hover/unhover').end).toEqual({
      kind: 'events',
      types: ['pointerleave', 'focusout'],
    })
    expect(resolveActivationSpec('focus/blur').end).toEqual({
      kind: 'events',
      types: ['focusout'],
    })
  })

  it('resolves a name that shadows Object.prototype as an ordinary event type', () => {
    // Same lesson as `parse.ts`'s `applyToken`: a truthiness test on the table lookup would find
    // an inherited value here and treat it as a trigger.
    expect(resolveActivationSpec('__proto__').start).toEqual({
      kind: 'events',
      types: ['__proto__'],
    })
    expect(resolveActivationSpec('constructor').start).toEqual({
      kind: 'events',
      types: ['constructor'],
    })
    expect(isNamedActivation('constructor')).toBe(false)
  })

  it('leaves end unset when no pair was authored', () => {
    expect(resolveActivationSpec('click').end).toBeUndefined()
  })
})

describe('validateActivation', () => {
  it('accepts every shape the open list is meant to allow', () => {
    for (const value of [
      'enter',
      'pointerleave',
      'cart:updated',
      'htmx-after-swap',
      'my.event',
      'enter/leave',
      'pointerenter/pointerleave',
      'input/change',
    ]) {
      expect(validateActivation(value), value).toEqual([])
    }
  })

  it('rejects more than one separator', () => {
    expect(validateActivation('a/b/c').join()).toContain('more than one "/"')
  })

  it('rejects text that cannot be an event type at all', () => {
    // This is the one place the open list still says no, and it exists because a value like
    // `"on click"` would otherwise bind a listener for an event named `on click`.
    expect(validateActivation('on click').join()).toContain('is not an event name')
    expect(validateActivation('enter/').join()).toContain('is not an event name')
    expect(validateActivation('/leave').join()).toContain('is not an event name')
    expect(validateActivation('2fast').join()).toContain('is not an event name')
  })

  it('rejects an exit half that could never fire', () => {
    expect(validateActivation('pointerenter/load').join()).toContain('cannot end on "load"')
    expect(validateActivation('click/manual').join()).toContain('cannot end on "manual"')
  })
})

describe('startKindOf', () => {
  it('reads through a pair to the half that actually starts the effect', () => {
    // The reason this function exists: `style-plan.ts` used to compare `activation === 'load'`,
    // which is false for `load/pointerleave` even though it still starts immediately.
    expect(startKindOf('load')).toBe('immediate')
    expect(startKindOf('load/pointerleave')).toBe('immediate')
    expect(startKindOf('manual')).toBe('manual')
    expect(startKindOf('enter/leave')).toBe('observed')
    expect(startKindOf('submit')).toBe('events')
  })
})

describe('isOneShot', () => {
  it('keeps bare enter one-shot and makes a pair persistent', () => {
    // LOCKED: one-shot `enter` stays the default, and the exit twin is what opts out.
    expect(isOneShot(resolveActivationSpec('enter'))).toBe(true)
    expect(isOneShot(resolveActivationSpec('leave'))).toBe(true)
    expect(isOneShot(resolveActivationSpec('enter/leave'))).toBe(false)
  })

  it('never treats a listener activation as one-shot', () => {
    // Releasing a `hover` or `click` binding on first use is what would stop a card flipping back.
    expect(isOneShot(resolveActivationSpec('hover'))).toBe(false)
    expect(isOneShot(resolveActivationSpec('click'))).toBe(false)
    expect(isOneShot(resolveActivationSpec('load'))).toBe(false)
  })
})

describe('authorisingActivations', () => {
  it('routes an exit twin through the declaration its machinery belongs to', () => {
    expect(authorisingActivations('leave')).toEqual(['enter'])
    expect(authorisingActivations('unhover')).toEqual(['hover'])
    expect(authorisingActivations('blur')).toEqual(['focus'])
  })

  it('treats a raw event name as any of the listener activations', () => {
    expect(authorisingActivations('pointerdown')).toEqual(['hover', 'focus', 'click'])
  })
})

describe('isKnownEventType', () => {
  it('vouches for common DOM events without asking a document', () => {
    expect(isKnownEventType('pointerleave')).toBe(true)
    expect(isKnownEventType('submit')).toBe(true)
  })

  it('always vouches for a namespaced custom event', () => {
    expect(isKnownEventType('cart:updated')).toBe(true)
    expect(isKnownEventType('htmx-after-swap')).toBe(true)
    expect(isKnownEventType('app.ready')).toBe(true)
  })

  it('does not vouch for a plain name it has never seen', () => {
    expect(isKnownEventType('clik')).toBe(false)
    expect(isKnownEventType('teleport')).toBe(false)
  })
})

describe('suggestActivation', () => {
  it('offers the near miss an author most likely meant', () => {
    expect(suggestActivation('clik')).toBe('click')
    expect(suggestActivation('hovr')).toBe('hover')
    expect(suggestActivation('pointerleav')).toBe('pointerleave')
  })

  it('offers nothing when nothing is close enough to be a correction', () => {
    expect(suggestActivation('teleport')).toBeUndefined()
    // Two edits away from `click`, but two edits is most of a four-letter word — a suggestion
    // there is a guess dressed up as help.
    expect(suggestActivation('xyzk')).toBeUndefined()
  })
})
