// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import {
  FluidTrail,
  getSharedFluidTrail,
  setSharedFluidTrail,
  syncCanvasSize,
} from '../fluid-cursor.js'

/** Edges of `fluid-cursor.ts` the main suite in `fx.test.ts` does not reach. */

describe('syncCanvasSize on a canvas double', () => {
  it('sizes the backing store and answers the dpr for a canvas that has no style object', () => {
    const canvas = { width: 0, height: 0 } as unknown as HTMLCanvasElement
    const dpr = syncCanvasSize(canvas, { innerWidth: 300, innerHeight: 200, devicePixelRatio: 2 } as unknown as Window)
    expect(dpr).toBe(2)
    expect(canvas.width).toBe(600)
    expect(canvas.height).toBe(400)
  })
})

describe('re-entering a host', () => {
  function trailOver(host: HTMLElement) {
    const canvas = document.createElement('canvas')
    canvas.getContext = vi.fn().mockReturnValue({ clearRect: vi.fn(), beginPath: vi.fn(), arc: vi.fn(), fill: vi.fn() })
    const trail = new FluidTrail({ size: 10 }, {
      createCanvas: () => canvas,
      raf: vi.fn(() => 1),
      caf: vi.fn(),
      window: { innerWidth: 1000, innerHeight: 1000, addEventListener: vi.fn(), removeEventListener: vi.fn() } as never,
    })
    trail.init()
    const id = trail.registerClient({ size: 10 }, host)
    trail.activateClient(id)
    return trail
  }

  const hostBox = () => {
    const host = document.createElement('div')
    host.getBoundingClientRect = () => ({ left: 0, top: 0, right: 500, bottom: 500, width: 500, height: 500 } as DOMRect)
    return host
  }
  const move = (trail: FluidTrail, x: number, y: number) =>
    trail.onPointerMove?.({ clientX: x, clientY: y, target: null } as unknown as PointerEvent)

  it('spawns the first drop after coming back in with no velocity, however far the pointer jumped', () => {
    const trail = trailOver(hostBox())

    move(trail, 100, 100)
    // Left the host: the jump back in is not a stroke, so it must not fling a drop across it.
    move(trail, 900, 900)
    expect(trail.drops.length).toBe(1)
    move(trail, 400, 400)

    expect(trail.drops.length).toBe(2)
    expect(trail.drops[1]).toMatchObject({ x: 400, y: 400, vx: 0, vy: 0 })

    // The contrast: a move that stays inside the host carries the stroke's velocity.
    move(trail, 450, 400)
    expect(trail.drops[2]!.vx).toBeGreaterThan(0)
    trail.destroy()
  })
})

describe('the shared trail registry', () => {
  const envFor = () => ({
    document: document.implementation.createHTMLDocument('fluid'),
    window: { innerWidth: 100, innerHeight: 100, addEventListener: vi.fn(), removeEventListener: vi.fn() } as never,
  })

  it('forgets a trail when it is cleared, so the next lookup builds a fresh one', () => {
    const env = envFor()
    const first = getSharedFluidTrail(env)
    expect(getSharedFluidTrail(env)).toBe(first)

    setSharedFluidTrail(null, env)
    expect(getSharedFluidTrail(env)).not.toBe(first)
  })

  it('files a trail under its own document and clears the mismatched key it was installed under', () => {
    const envA = envFor()
    const envB = envFor()
    const trailA = new FluidTrail({}, envA)
    const strayB = getSharedFluidTrail(envB)

    setSharedFluidTrail(trailA, envB)

    expect(getSharedFluidTrail(envA)).toBe(trailA)
    // Not left dangling under B: B's lookup builds its own rather than returning A's trail or the stray.
    const freshB = getSharedFluidTrail(envB)
    expect(freshB).not.toBe(trailA)
    expect(freshB).not.toBe(strayB)
  })
})

describe('the shared trail registry with a stand-in trail', () => {
  it('files an instance that carries no mapKey under the key the caller named', () => {
    const env = {
      document: document.implementation.createHTMLDocument('fluid'),
      window: { innerWidth: 100, innerHeight: 100, addEventListener: vi.fn(), removeEventListener: vi.fn() } as never,
    }
    const standIn = {} as FluidTrail

    setSharedFluidTrail(standIn, env)

    expect(getSharedFluidTrail(env)).toBe(standIn)
  })
})
