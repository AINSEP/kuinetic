// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { createHelixFit, fitProjectedBounds, helixCentre, projectHelix } from '../src/effects/carousel/shape-fit.js'
import type { HelixGeometry } from '../src/effects/carousel/shape-fit.js'
import { createParams } from '../src/core/js-params.js'
import { createStyleLedger } from '../src/core/owned-styles.js'
import type { PrepareContext } from '../src/core/effect-context.js'

const base: HelixGeometry = { width: 100, height: 60, radius: 200, rise: 32, count: 12, arc: 540,
  tilt: 0, perspective: 1e12, camera: true }
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); document.body.replaceChildren() })

it('fits both axes against independent near-orthographic bounds', () => {
  const bounds = projectHelix(base)
  expect(bounds.minX).toBeCloseTo(-250, 1)
  expect(bounds.maxX).toBeCloseTo(250, 1)
  expect(bounds.minY).toBeCloseTo(-222)
  expect(bounds.maxY).toBeCloseTo(222)
  expect(fitProjectedBounds(bounds, { left: 390 / 2, right: 390 / 2, height: 800 })).toBeCloseTo(.78, 4)
  expect(fitProjectedBounds(bounds, { left: 1000, right: 1000, height: 300 })).toBeCloseTo(300 / 444)
})

it('keeps far-side radial corners and detects camera-plane crossings', () => {
  const radial = projectHelix({ ...base, camera: false, tilt: -18, perspective: 1600 })
  expect(radial.maxX).toBeGreaterThan(200)
  expect(radial.minY).toBeLessThan(-180)
  const impossible = projectHelix({ ...base, perspective: 100 })
  expect(fitProjectedBounds(impossible, { left: 195, right: 195, height: 800 })).toBe(0)
  expect(fitProjectedBounds(radial, { left: -10, right: 1000, height: 800 })).toBe(0)
})

it.each([5, 6, 11, 12])('centers both fade endpoints at the actual circular seam for %s cards', count => {
  const low = Math.floor(count / 2) - count + .5
  const high = Math.floor(count / 2) + .5
  const fade = (place: number): number => Math.max(0, Math.min(1, count / 2 - .5 - Math.abs(place - helixCentre(count))))
  expect(fade(low)).toBe(0)
  expect(fade(high)).toBe(0)
  expect(fade(Math.floor(count / 2))).toBe(0)
  expect(fade(Math.floor(count / 2) - count + 1)).toBe(0)
  expect(fade(0)).toBe(1)
})

it('observes cached geometry, honors clipping, resizes without a frame loop and cleans up', () => {
  vi.useFakeTimers()
  document.body.innerHTML = '<div id="clip"><div id="helix"><div></div><div></div><div></div></div></div>'
  const host = document.querySelector<HTMLElement>('#helix')!
  const clip = host.parentElement!
  const nodes = [...host.children] as HTMLElement[]
  for (const node of nodes) {
    Object.defineProperty(node, 'offsetWidth', { value: 100 })
    Object.defineProperty(node, 'offsetHeight', { value: 60 })
  }
  Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: 390 })
  const read = vi.fn(() => ({ left: 0, width: 390 }) as DOMRect)
  host.getBoundingClientRect = read
  const styles = createStyleLedger(host)
  const ctx = { doc: document, win: window, warn: vi.fn() } as unknown as PrepareContext
  const fit = createHelixFit({ el: host, ctx, styles, arc: 540, tilt: 0,
    params: createParams({ radius: '200px', rise: '32px', perspective: '1600px', facing: 'radial' }) })
  fit.render(nodes, 3)
  expect(Number(host.style.getPropertyValue('--kui-shape-fit'))).toBeLessThan(1)
  read.mockClear()
  fit.render(nodes, 3)
  vi.advanceTimersByTime(1000)
  expect(read).not.toHaveBeenCalled()
  clip.style.overflowX = 'clip'
  window.dispatchEvent(new Event('resize'))
  vi.advanceTimersByTime(20)
  expect(host.style.getPropertyValue('--kui-shape-fit')).toBe('1')
  clip.style.overflowX = 'visible'
  clip.style.overflowY = 'hidden'
  window.dispatchEvent(new Event('resize'))
  vi.advanceTimersByTime(20)
  expect(host.style.getPropertyValue('--kui-shape-fit')).toBe('1')
  fit.release()
  styles.restore()
  expect(host.hasAttribute('style')).toBe(false)
  expect(vi.getTimerCount()).toBe(0)
})

it.each([
  { radius: '', perspective: '1600px', width: 100, warning: false },
  { radius: '200px', perspective: '100px', width: 100, warning: true },
  { radius: 'var(--radius)', perspective: '1600px', width: 100, warning: false },
  { radius: '', perspective: '1600px', width: 0, warning: false },
])('handles derived, unmeasured and camera-crossing geometry: %j', ({ radius, perspective, width, warning }) => {
  document.body.innerHTML = '<div style="overflow-y:auto"><div id="helix"><div></div><div></div><div></div></div></div>'
  const host = document.querySelector<HTMLElement>('#helix')!
  Object.defineProperty(host.parentElement, 'clientHeight', { value: 300 })
  Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: 390 })
  host.getBoundingClientRect = () => ({ left: 0, width: 390 }) as DOMRect
  const nodes = [...host.children] as HTMLElement[]
  for (const node of nodes) {
    Object.defineProperty(node, 'offsetWidth', { value: width })
    Object.defineProperty(node, 'offsetHeight', { value: 60 })
    node.append(document.createElement('span'))
  }
  const warn = vi.fn()
  const styles = createStyleLedger(host)
  const ctx = { doc: document, win: window, warn } as unknown as PrepareContext
  const fit = createHelixFit({ el: host, ctx, styles, arc: 360, tilt: 0,
    params: createParams({ radius, gap: '24px', rise: '32px', perspective, facing: 'camera' }) })
  fit.render(nodes, 3)
  expect(warn.mock.calls.length > 0).toBe(warning)
  expect(Number.isFinite(Number(host.style.getPropertyValue('--kui-shape-fit')))).toBe(true)
  fit.render(nodes.slice(1), 2)
  fit.release()
})
