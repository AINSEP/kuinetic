// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { collectingReporter } from '../src/core/reporter.js'
import { projectDrum } from '../src/effects/carousel/shape-fit.js'
import type { HelixGeometry } from '../src/effects/carousel/shape-fit.js'
import { build, el } from './support/js-effect-harness.js'

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

afterEach(() => document.body.replaceChildren())

function mountDrum(params: string, wrapperStyle = '') {
  const reporter = collectingReporter()
  const cards = '<div><span>Card</span></div>'.repeat(3)
  const animator = build(
    `<section style="${wrapperStyle}"><div data-kui="carousel-3d axis:x ${params}">${cards}</div></section>`,
    reporter,
  )
  const host = el()
  host.getBoundingClientRect = () => ({ left: 0, width: 300 }) as DOMRect
  Object.defineProperty(host.parentElement, 'clientWidth', { value: 300 })
  for (const card of host.children) {
    Object.defineProperty(card, 'offsetWidth', { value: 100 })
    Object.defineProperty(card, 'offsetHeight', { value: 130 })
  }
  animator.start()
  return { animator, host, reporter }
}

it.each(['overflow-x:clip', 'overflow-x:auto;overflow-y:hidden'])(
  'reserves height for a camera-facing drum under %s',
  overflow => {
    const { animator, host } = mountDrum('facing:camera', overflow)
    expect(host.getAttribute('data-kui-ring-axis')).toBe('x')
    expect(Number.parseFloat(host.style.getPropertyValue('--kui-shape-height'))).toBeGreaterThan(130)
    animator.destroy()
  },
)

it('warns when a drum reaches the camera plane', () => {
  const { animator, host, reporter } = mountDrum('radius:100px perspective:10px', 'overflow-x:auto')
  expect(reporter.messages.join()).toContain('drum reaches the camera plane')
  expect(host.style.getPropertyValue('--kui-shape-height')).toBe('')
  animator.destroy()
})
