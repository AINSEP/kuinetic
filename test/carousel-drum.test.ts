import { expect, it } from 'vitest'
import { projectDrum } from '../src/effects/carousel/shape-fit.js'
import type { HelixGeometry } from '../src/effects/carousel/shape-fit.js'

const base: HelixGeometry = { width: 300, height: 180, radius: 400, rise: 0, count: 12, arc: 360, tilt: 0, perspective: 1600, camera: false }

it('keeps the front card at its true width and the drum symmetric about the middle', () => {
  const bounds = projectDrum(base)
  expect(bounds.maxX).toBeCloseTo(base.width / 2, 3)
  expect(bounds.minX).toBeCloseTo(-base.width / 2, 3)
  expect(bounds.minY).toBeCloseTo(-bounds.maxY, 3)
})

it('grows taller as the radius grows', () => {
  const near = projectDrum({ ...base, radius: 300 })
  const far = projectDrum({ ...base, radius: 600 })
  expect(far.maxY).toBeGreaterThan(near.maxY)
})

// The pull-back keeps the front card at z = 0, so only a card taller than the camera is far reaches it.
it('reports infinite bounds when a card edge reaches the camera plane', () => {
  const bounds = projectDrum({ ...base, height: 4000, radius: 400, perspective: 1600 })
  expect(bounds.maxX).toBe(Infinity)
  expect(bounds.minY).toBe(-Infinity)
})
