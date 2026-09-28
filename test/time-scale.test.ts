import { describe, expect, it } from 'vitest'
import { TIME_SCALE_ATTR, timeScaleOf } from '../src/core/time-scale.js'

function beneath(value: string | null): Element {
  const host = value === null ? null : { getAttribute: () => value }
  return { closest: () => host } as unknown as Element
}

describe('timeScaleOf', () => {
  it('uses one when there is no marker or a non-finite or empty value', () => {
    expect(timeScaleOf(beneath(null))).toBe(1)
    expect(timeScaleOf(beneath(''))).toBe(1)
    expect(timeScaleOf(beneath('NaN'))).toBe(1)
    expect(timeScaleOf(beneath('Infinity'))).toBe(1)
    expect(timeScaleOf(beneath('0.25junk'))).toBe(1)
  })

  it('parses the nearest marker and clamps to 0.05 through 4', () => {
    expect(TIME_SCALE_ATTR).toBe('data-kui-time-scale')
    expect(timeScaleOf(beneath('0.25'))).toBe(0.25)
    expect(timeScaleOf(beneath('-1'))).toBe(0.05)
    expect(timeScaleOf(beneath('8'))).toBe(4)
  })
})
