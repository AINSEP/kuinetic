import { expect, it } from 'vitest'
import { projectDrum } from '../src/effects/carousel/shape-fit.js'
import type { HelixGeometry } from '../src/effects/carousel/shape-fit.js'

const base: HelixGeometry = { width: 300, height: 180, radius: 400, rise: 0, count: 12, arc: 360, tilt: 0, perspective: 1600, camera: false }

it('keeps the front card at its true width and fits the full, symmetric silhouette', () => {
  const front = projectDrum({ ...base, arc: 0 })
  expect(front.maxX - front.minX).toBeCloseTo(base.width, 3)

  const bounds = projectDrum(base)
  // A tilted corner reaches closer to the camera than the face-on card does.
  const depth = Math.hypot(base.radius, base.height / 2) - base.radius
  const halfWidth = (base.width / 2) * base.perspective / (base.perspective - depth)
  expect(bounds.maxX).toBeCloseTo(halfWidth, 3)
  expect(bounds.minX).toBeCloseTo(-halfWidth, 3)
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
