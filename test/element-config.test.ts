// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { readAttributes, resolveConfig, resolveGroupConfig, resolveTimelineHead } from '../src/core/element-config.js'
import { parse } from '../src/core/parse.js'
import { parseToggleActions } from '../src/core/toggle-actions.js'
import type { SegmentHoists } from '../src/core/types.js'

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

  it('carries a longhand from: selector beside its activation', () => {
    const config = resolveConfig({ ...attrs, on: 'submit from:"#signup form"' }, parse(''))
    expect(config.activation).toBe('submit')
    expect(config.activationAuthored).toBe(true)
    expect(config.activationSource).toBe('#signup form')
  })

  it('falls back to the default when the longhand holds something unbindable', () => {
    // No reporter here, so a dropped value is silent at this layer by design — `parse.ts` warns
    // for the inline `on:` spelling and `animator.ts` for an event no document recognises.
    const config = resolveConfig({ ...attrs, on: 'a/b/c' }, parse(''))
    expect(config.activation).toBe('enter')
    expect(config.activationAuthored).toBe(false)
  })
})

describe('resolveGroupConfig', () => {
  const attrs = { source: '', on: null, timeline: null, threshold: null }
  const base = resolveConfig(attrs, parse(''))

  it('returns the base config unchanged when the group scoped no hoists at all', () => {
    expect(resolveGroupConfig(base, undefined)).toBe(base)
  })

  it('splits a recognised scoped timeline into its head and range', () => {
    const config = resolveGroupConfig(base, { timeline: 'view 300px' } as SegmentHoists)
    expect(config.timeline).toBe('view')
    expect(config.range).toBe('300px')
  })

  it('falls back to the base timeline for an unrecognised scoped timeline head', () => {
    const config = resolveGroupConfig(base, { timeline: 'bogus' } as SegmentHoists)
    expect(config.timeline).toBe(base.timeline)
    expect(config.range).toBe('')
  })

  it('parses a scoped actions hoist the same way the longhand attribute does', () => {
    const config = resolveGroupConfig(base, { actions: 'play/pause' } as SegmentHoists)
    expect(config.actions).toEqual(parseToggleActions('play/pause'))
  })
})

describe('resolveTimelineHead', () => {
  it('recognises a valid head', () => {
    expect(resolveTimelineHead('view', 'time')).toBe('view')
  })

  it('falls back to the given default for an unrecognised head', () => {
    expect(resolveTimelineHead('bogus', 'time')).toBe('time')
  })
})
