import { describe, expect, it } from 'vitest'
import { readAttributes, resolveConfig, toThresholdRatio } from '../src/core/element-config.js'
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
})

describe('toThresholdRatio', () => {
  it('returns 0 for an unparseable value instead of NaN', () => {
    expect(toThresholdRatio('not-a-number')).toBe(0)
  })
})
