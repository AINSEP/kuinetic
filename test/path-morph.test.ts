import { describe, expect, it } from 'vitest'
import {
  createMorph,
  normaliseCount,
  parsePath,
  splitCubic,
  toPathData,
} from '../src/core/path-morph.js'
import type { Cubic } from '../src/core/path-morph.js'

const SQUARE = 'M0,0 L10,0 L10,10 L0,10 Z'
const CURVE = 'M0,0 C5,0 10,5 10,10'

describe('parsePath', () => {
  it('converts a line-only path to cubic segments', () => {
    const { segments, reason } = parsePath('M0,0 L10,0')
    expect(reason).toBeUndefined()
    expect(segments).toHaveLength(1)
    expect(segments[0]?.from).toEqual({ x: 0, y: 0 })
    expect(segments[0]?.to).toEqual({ x: 10, y: 0 })
  })

  it('places converted line controls at the one-third points, so lines and curves interpolate', () => {
    const { segments } = parsePath('M0,0 L30,0')
    expect(segments[0]?.c1).toEqual({ x: 10, y: 0 })
    expect(segments[0]?.c2).toEqual({ x: 20, y: 0 })
  })

  it('reads a cubic command', () => {
    const { segments } = parsePath(CURVE)
    expect(segments).toHaveLength(1)
    expect(segments[0]?.c1).toEqual({ x: 5, y: 0 })
    expect(segments[0]?.c2).toEqual({ x: 10, y: 5 })
  })

  it('handles horizontal and vertical shorthands', () => {
    const { segments } = parsePath('M0,0 H10 V10')
    expect(segments).toHaveLength(2)
    expect(segments[0]?.to).toEqual({ x: 10, y: 0 })
    expect(segments[1]?.to).toEqual({ x: 10, y: 10 })
  })

  it('handles relative commands', () => {
    const { segments } = parsePath('M10,10 l5,0')
    expect(segments[0]?.to).toEqual({ x: 15, y: 10 })
  })

  it('treats repeated coordinates after moveto as linetos, per the spec', () => {
    const { segments } = parsePath('M0,0 5,0 10,0')
    expect(segments).toHaveLength(2)
    expect(segments[1]?.to).toEqual({ x: 10, y: 0 })
  })

  it('refuses arcs rather than approximating them', () => {
    // A wrong-but-plausible shape is worse than a warning; morphing an arc silently would
    // produce geometry the author never drew.
    expect(parsePath('M0,0 A5,5 0 0 1 10,10').reason).toContain('not supported')
  })

  it.each(['S', 'Q', 'T'])('refuses the %s shorthand', (command) => {
    expect(parsePath(`M0,0 ${command}5,5 10,10`).reason).toContain('not supported')
  })

  it('reports a path with no drawable segments', () => {
    expect(parsePath('M0,0').reason).toBe('no drawable segments')
  })
})

describe('splitCubic', () => {
  it('produces two segments that meet at the split point', () => {
    const segment: Cubic = {
      from: { x: 0, y: 0 },
      c1: { x: 0, y: 10 },
      c2: { x: 10, y: 10 },
      to: { x: 10, y: 0 },
    }
    const [a, b] = splitCubic(segment, 0.5)
    expect(a.to).toEqual(b.from)
    expect(a.from).toEqual(segment.from)
    expect(b.to).toEqual(segment.to)
  })

  it('preserves the curve: the midpoint lies on the original', () => {
    const segment: Cubic = {
      from: { x: 0, y: 0 },
      c1: { x: 0, y: 30 },
      c2: { x: 30, y: 30 },
      to: { x: 30, y: 0 },
    }
    const [a] = splitCubic(segment, 0.5)
    // Bezier value at t=0.5 for this symmetric curve is (15, 22.5).
    expect(a.to.x).toBeCloseTo(15)
    expect(a.to.y).toBeCloseTo(22.5)
  })
})

describe('normaliseCount', () => {
  it('grows a segment list to the requested count', () => {
    const { segments } = parsePath('M0,0 L10,0')
    expect(normaliseCount(segments, 4)).toHaveLength(4)
  })

  it('leaves a list that is already long enough alone', () => {
    const { segments } = parsePath(SQUARE)
    expect(normaliseCount(segments, 2)).toHaveLength(segments.length)
  })

  it('splits the longest segment first, keeping the shape evenly sampled', () => {
    const { segments } = parsePath('M0,0 L100,0 L110,0')
    const grown = normaliseCount(segments, 3)
    // The 100-unit segment is halved before the 10-unit one is touched.
    expect(grown.map((s) => Math.round(s.to.x))).toEqual([50, 100, 110])
  })

  it('terminates on an empty list rather than looping forever', () => {
    expect(normaliseCount([], 5)).toEqual([])
  })
})

describe('createMorph', () => {
  it('interpolates between two shapes with different command counts', () => {
    const { morph, reason } = createMorph(CURVE, SQUARE)
    expect(reason).toBeUndefined()
    expect(morph).toBeDefined()
    expect(morph!.segmentCount).toBe(4)
  })

  it('returns the start shape at t=0 and the end shape at t=1', () => {
    const { morph } = createMorph('M0,0 L10,0', 'M0,0 L20,0')
    expect(morph!.at(0)).toBe(toPathData(parsePath('M0,0 L10,0').segments))
    expect(morph!.at(1)).toBe(toPathData(parsePath('M0,0 L20,0').segments))
  })

  it('lands halfway at t=0.5', () => {
    const { morph } = createMorph('M0,0 L10,0', 'M0,0 L20,0')
    expect(morph!.at(0.5)).toContain('15')
  })

  it('clamps out-of-range t instead of extrapolating', () => {
    const { morph } = createMorph('M0,0 L10,0', 'M0,0 L20,0')
    expect(morph!.at(-1)).toBe(morph!.at(0))
    expect(morph!.at(2)).toBe(morph!.at(1))
  })

  it('reports which side of the morph is unsupported', () => {
    expect(createMorph('M0,0 A5,5 0 0 1 10,10', SQUARE).reason).toContain('start path')
    expect(createMorph(SQUARE, 'M0,0 A5,5 0 0 1 10,10').reason).toContain('end path')
  })
})

describe('toPathData', () => {
  it('emits an empty string for no segments', () => {
    expect(toPathData([])).toBe('')
  })

  it('round-trips through parsePath', () => {
    const first = parsePath(SQUARE).segments
    expect(parsePath(toPathData(first)).segments).toHaveLength(first.length)
  })
})
