import { describe, expect, it } from 'vitest'
import { readAttributes, resolveConfig } from '../src/core/element-config.js'
import { parse } from '../src/core/parse.js'

describe('readAttributes', () => {
  it('defaults source to an empty string when the attribute is absent', () => {
    const el = document.createElement('div')
    expect(readAttributes(el).source).toBe('')
  })
})

describe('resolveConfig', () => {
  const attrs = { source: '', on: null, timeline: null, threshold: null }

  it('falls back to time for an unrecognised timeline value', () => {
    const config = resolveConfig({ ...attrs, timeline: 'bogus' }, parse(''))
    expect(config.timeline).toBe('time')
  })

  it('accepts any event name in the longhand attribute, not a closed list of six', () => {
    for (const on of ['pointerleave', 'submit', 'cart:updated', 'pointerenter/pointerleave']) {
      const config = resolveConfig({ ...attrs, on }, parse(''))
      expect(config.activation, on).toBe(on)
      expect(config.activationAuthored, on).toBe(true)
    }
  })

  it('falls back to the default when the longhand holds something unbindable', () => {
    // No reporter here, so a dropped value is silent at this layer by design — `parse.ts` warns
    // for the inline `on:` spelling and `animator.ts` for an event no document recognises.
    const config = resolveConfig({ ...attrs, on: 'a/b/c' }, parse(''))
    expect(config.activation).toBe('enter')
    expect(config.activationAuthored).toBe(false)
  })
})
