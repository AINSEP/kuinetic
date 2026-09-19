// @vitest-environment jsdom
// Created by Gemini 3.8 Flash
import { describe, expect, it, vi } from 'vitest'
import { Registry } from '../../core/registry.js'
import {
  PARTICLE_PRESETS,
  PARTICLE_PRIMITIVES,
  ParticleEmitter,
  prepareParticles,
  registerParticles,
  stepParticle,
} from '../particles.js'
import {
  FLUID_PRESETS,
  FLUID_PRIMITIVES,
  FluidTrail,
  getSharedFluidTrail,
  prepareFluidCursor,
  registerFluidCursor,
  setSharedFluidTrail,
  stepFluidDrop,
  syncCanvasSize,
} from '../fluid-cursor.js'
import type { EffectParams } from '../../core/types.js'
import { createRealPrepareContext } from './prepare-context-fixture.js'

describe('Advanced FX Modules: Particles and Fluid Cursor', () => {
  describe('Particles Module', () => {
    it('registers particle-dissolve primitive into registry', () => {
      const reg = new Registry()
      registerParticles(reg)
      const res = reg.resolve('particle-dissolve')
      expect(res).toBeDefined()
      expect(res?.primitive.id).toBe('particle-dissolve')
      expect(res?.primitive.channels).toEqual(['position'])

      for (const preset of PARTICLE_PRESETS) {
        expect(reg.resolve(preset.name)).toBeDefined()
      }
    })

    it('stepParticle calculates repulsion, spring return, and friction', () => {
      const p = { x: 50, y: 50, originX: 50, originY: 50, vx: 0, vy: 0, radius: 2, color: '#fff' }
      stepParticle(p, 52, 52, 20)
      expect(p.vx).toBeLessThan(0)
      expect(p.vy).toBeLessThan(0)
      expect(p.x).not.toBe(50)

      p.x = 80
      p.y = 80
      stepParticle(p, -999, -999, 20)
      expect(p.vx).toBeLessThan(0)
    })

    it('ParticleEmitter initializes particles and can be destroyed', () => {
      const target = document.createElement('div')
      const emitter = new ParticleEmitter(target, { count: 10, radius: 30 })

      emitter.spawnParticles(100, 100)
      expect(emitter.particles.length).toBe(10)
      expect(emitter.particles[0]).toHaveProperty('vx')
      expect(emitter.particles[0]).toHaveProperty('vy')

      emitter.destroy()
      expect(emitter.particles.length).toBe(0)
    })

    it('ParticleEmitter lifecycle with mock canvas, drawing, and events', () => {
      const target = document.createElement('div')
      target.getBoundingClientRect = () => ({ width: 300, height: 200 } as DOMRect)
      target.style.position = 'static'

      const mockCtx = {
        clearRect: vi.fn(),
        beginPath: vi.fn(),
        arc: vi.fn(),
        fill: vi.fn(),
        fillStyle: '',
      }
      const mockCanvas = document.createElement('canvas')
      mockCanvas.getContext = vi.fn().mockReturnValue(mockCtx)
      mockCanvas.getBoundingClientRect = () => ({ left: 20, top: 30, width: 300, height: 200 } as DOMRect)

      let rafCallback: FrameRequestCallback | null = null
      const fakeRaf = vi.fn((fn: FrameRequestCallback) => {
        rafCallback = fn
        return 101
      })
      const fakeCaf = vi.fn()

      const emitter = new ParticleEmitter(target, { count: 20, radius: 60 }, {
        createCanvas: () => mockCanvas,
        raf: fakeRaf,
        caf: fakeCaf,
      })

      const ok = emitter.init()
      expect(ok).toBe(true)
      expect(target.style.position).toBe('relative')

      emitter.onMouseMove({ clientX: 50, clientY: 70 })
      expect(emitter.mouse.x).toBe(30)
      expect(emitter.mouse.y).toBe(40)

      emitter.onMouseLeave()
      expect(emitter.mouse.x).toBe(-999)

      expect(rafCallback).not.toBeNull()
      rafCallback!(1000)

      expect(mockCtx.clearRect).toHaveBeenCalled()
      expect(mockCtx.arc).toHaveBeenCalled()
      expect(emitter.rafId).toBeNull()

      emitter.onMouseMove({ clientX: 50, clientY: 70 })
      expect(emitter.rafId).toBe(101)

      emitter.destroy()
      expect(fakeCaf).toHaveBeenCalledWith(101)
      expect(emitter.particles.length).toBe(0)
      expect(emitter.canvas).toBeNull()
    })

    it('ParticleEmitter handles failure branches and null environments', () => {
      const eNullDoc = new ParticleEmitter(document.createElement('div'), {}, { document: null })
      expect(eNullDoc.init()).toBe(false)
      expect(eNullDoc.createCanvas()).toBeNull()

      const eNoCanvas = new ParticleEmitter(document.createElement('div'), {}, { createCanvas: () => null })
      expect(eNoCanvas.init()).toBe(false)

      const canvasNoCtx = document.createElement('canvas')
      canvasNoCtx.getContext = vi.fn().mockReturnValue(null)
      const eNoCtx = new ParticleEmitter(document.createElement('div'), {}, { createCanvas: () => canvasNoCtx })
      expect(eNoCtx.init()).toBe(false)

      const canvasNoGetContext = { style: {} } as unknown as HTMLCanvasElement
      const eNoGetContext = new ParticleEmitter(document.createElement('div'), {}, { createCanvas: () => canvasNoGetContext })
      expect(eNoGetContext.init()).toBe(false)

      const eSafe = new ParticleEmitter(null as unknown as HTMLElement)
      eSafe.spawnParticles(100, 100)
      expect(eSafe.particles.length).toBe(60)
      eSafe.update()
      eSafe.onMouseMove({ clientX: 0, clientY: 0 })
      eSafe.draw()
      eSafe.destroy()
      expect(eSafe.createCanvas()).not.toBeNull()

      const eNullWin = new ParticleEmitter(document.createElement('div'), {}, { window: null })
      expect(eNullWin.raf(() => {})).toBeNull()
      expect(eNullWin.caf(1)).toBeNull()
    })

    it('prepareParticles initializes and manages lifecycle with mock canvas', () => {
      const el = document.createElement('div')
      el.getBoundingClientRect = () => ({ width: 100, height: 50 } as DOMRect)

      const mockCtx = { clearRect: vi.fn(), beginPath: vi.fn(), arc: vi.fn(), fill: vi.fn(), fillStyle: '' }
      const mockCanvas = document.createElement('canvas')
      mockCanvas.getContext = vi.fn().mockReturnValue(mockCtx)

      const params = {
        num: vi.fn().mockReturnValue(50),
        text: vi.fn().mockReturnValue('#ff0055'),
      } as unknown as EffectParams

      const inst = prepareParticles(el, params, createRealPrepareContext(el, {
        reducedMotion: false,
        createCanvas: () => mockCanvas,
      }))
      expect(inst).toBeDefined()
      inst.activate()
      inst.cancel()
      inst.finish()
      inst.destroy()
    })

    it('ParticleEmitter handles resize and motion updates', () => {
      const target = document.createElement('div')
      target.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 100 } as DOMRect)
      const mockCtx = { clearRect: vi.fn(), beginPath: vi.fn(), arc: vi.fn(), fill: vi.fn(), fillStyle: '' }
      const mockCanvas = document.createElement('canvas')
      mockCanvas.getContext = vi.fn().mockReturnValue(mockCtx)
      mockCanvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 100 } as DOMRect)

      let tickCb: FrameRequestCallback | null = null
      const fakeRaf = vi.fn((fn: FrameRequestCallback) => {
        tickCb = fn
        return 77
      })
      const emitter = new ParticleEmitter(target, { count: 5 }, {
        createCanvas: () => mockCanvas,
        raf: fakeRaf,
      })
      emitter.init()
      expect(emitter.isListening).toBe(true)

      // bindEvents called when already listening (early return)
      emitter.bindEvents()

      // onResize branch
      emitter.onResize()
      expect(mockCtx.clearRect).toHaveBeenCalled()

      // update() when particles move
      emitter.mouse.x = 20
      emitter.mouse.y = 20
      const moved = emitter.update()
      expect(moved).toBe(true)

      // startLoop tick when isListening is false
      emitter.isListening = false
      emitter.startLoop()
      expect(tickCb).not.toBeNull()
      tickCb!(1000)
      expect(emitter.rafId).toBeNull()

      // startLoop called when rafId already active
      emitter.rafId = 99
      emitter.startLoop()
      expect(emitter.rafId).toBe(99)
      emitter.rafId = null

      // draw with dpr = 0
      emitter.dpr = 0
      emitter.draw()

      // syncDimensions with null canvas
      const nullCanvasEmitter = new ParticleEmitter(document.createElement('div'))
      expect(nullCanvasEmitter.syncDimensions()).toBe(1)

      // zero dpr fallback in syncDimensions
      const eZeroDpr = new ParticleEmitter(target, {}, {
        createCanvas: () => mockCanvas,
        window: { devicePixelRatio: 0 } as any,
      })
      eZeroDpr.canvas = mockCanvas
      expect(eZeroDpr.syncDimensions()).toBe(0)

      // null window fallback in syncDimensions (line 98 : 1 branch)
      const eNullWinCanvas = new ParticleEmitter(target, {}, {
        createCanvas: () => mockCanvas,
        window: null,
      })
      eNullWinCanvas.canvas = mockCanvas
      expect(eNullWinCanvas.syncDimensions()).toBe(1)

      // prepareParticles with empty params and failed init
      const emptyParams = {} as EffectParams
      const failedPrep = prepareParticles(document.createElement('div'), emptyParams, createRealPrepareContext(null, {
        reducedMotion: false,
        createCanvas: () => null,
      }))
      failedPrep.activate()
      expect(failedPrep).toBeDefined()

      emitter.destroy()
    })

    it('registerParticles throws on invalid registry target', () => {
      expect(() => registerParticles(null)).toThrow('kuinetic: registerParticles requires a Registry or Animator instance')
    })
  })

  describe('Fluid Cursor Module', () => {
    it('registers fluid-trail primitive into registry', () => {
      const reg = new Registry()
      registerFluidCursor(reg)
      const res = reg.resolve('fluid-trail')
      expect(res).toBeDefined()
      expect(res?.primitive.id).toBe('fluid-trail')
      expect(res?.primitive.channels).toEqual([])

      for (const preset of FLUID_PRESETS) {
        expect(reg.resolve(preset.name)).toBeDefined()
      }
    })

    it('stepFluidDrop applies velocity, friction, alpha decay, and returns expired state', () => {
      const drop = { x: 10, y: 20, vx: 5, vy: 5, size: 20, alpha: 0.8, color: '#fff' }
      const expired = stepFluidDrop(drop, 0.9)
      expect(expired).toBe(false)
      expect(drop.x).toBe(15)
      expect(drop.vx).toBe(4.5)
      expect(drop.alpha).toBeLessThan(0.8)

      drop.alpha = 0.01
      expect(stepFluidDrop(drop, 0.9)).toBe(true)
    })

    it('FluidTrail handles drop spawning and cleans up', () => {
      const trail = new FluidTrail({ size: 24 })
      trail.spawnDrop(100, 200, 5, 5)
      expect(trail.drops.length).toBe(1)
      expect(trail.drops[0]?.x).toBe(100)

      trail.destroy()
      expect(trail.isListening).toBe(false)
      expect(trail.canvas).toBeNull()
    })

    it('FluidTrail full lifecycle with mock canvas, pointer movement, and drawing', () => {
      const mockCtx = {
        save: vi.fn(),
        restore: vi.fn(),
        clearRect: vi.fn(),
        beginPath: vi.fn(),
        arc: vi.fn(),
        fill: vi.fn(),
        fillStyle: '',
        globalAlpha: 1,
      }
      const mockCanvas = document.createElement('canvas')
      mockCanvas.getContext = vi.fn().mockReturnValue(mockCtx)

      let rafCallback: FrameRequestCallback | null = null
      const fakeRaf = vi.fn((fn: FrameRequestCallback) => {
        rafCallback = fn
        return 202
      })
      const fakeCaf = vi.fn()

      const trail = new FluidTrail({ size: 30, viscosity: 0.85 }, {
        createCanvas: () => mockCanvas,
        raf: fakeRaf,
        caf: fakeCaf,
        window: {
          innerWidth: 1200,
          innerHeight: 900,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        } as any,
      })

      const ok = trail.init()
      expect(ok).toBe(true)
      expect(trail.isListening).toBe(true)

      trail.onPointerMove?.({ clientX: 100, clientY: 100 } as PointerEvent)
      expect(trail.drops.length).toBe(1)

      trail.onPointerMove?.({ clientX: 101, clientY: 101 } as PointerEvent)
      expect(trail.drops.length).toBe(1)

      trail.onPointerMove?.({ clientX: 120, clientY: 120 } as PointerEvent)
      expect(trail.drops.length).toBe(2)

      trail.drops.push({ x: 0, y: 0, vx: 0, vy: 0, size: 10, alpha: 0.01, color: '#f00' })
      expect(trail.drops.length).toBe(3)

      expect(rafCallback).not.toBeNull()
      rafCallback!(1000)

      expect(trail.drops.length).toBe(2)
      expect(mockCtx.clearRect).toHaveBeenCalled()
      expect(mockCtx.arc).toHaveBeenCalled()

      trail.destroy()
      expect(fakeCaf).toHaveBeenCalledWith(202)
      expect(trail.drops.length).toBe(0)
      expect(trail.canvas).toBeNull()
    })

    it('syncCanvasSize pins the CSS box in px to the same innerWidth/innerHeight the backing store uses, so a clientY lands on-screen where the pointer actually is', () => {
      const canvas = document.createElement('canvas')
      // Seed a CSS box that disagrees with `innerHeight` below -- what the old hardcoded
      // `width:100vw;height:100vh` rule would leave standing on iOS Safari, where `100vh`
      // resolves against the large/visual viewport (address bar retracted) while
      // `window.innerHeight` reports the smaller layout viewport (address bar showing).
      canvas.style.width = '390px'
      canvas.style.height = '750px'

      const fakeWin = { innerWidth: 390, innerHeight: 650, devicePixelRatio: 1 } as unknown as Window
      const dpr = syncCanvasSize(canvas, fakeWin)

      expect(canvas.width).toBe(390 * dpr)
      expect(canvas.height).toBe(650 * dpr)
      // The stale, disagreeing box must be overwritten to match what the backing store used.
      expect(canvas.style.width).toBe('390px')
      expect(canvas.style.height).toBe('650px')

      // A drop is drawn at `clientY * dpr` in backing-store space (see `draw()`). The browser
      // stretches backing-store pixels to fill the CSS box to paint them on screen; when the box
      // disagreed with the backing store that stretch was non-uniform and the drop painted below
      // the finger. With the box pinned to the same numbers, the stretch is 1:1 and clientY comes
      // back out unchanged.
      const clientY = 645
      const drawnY = clientY * dpr
      const screenY = (drawnY / canvas.height) * parseFloat(canvas.style.height)
      expect(screenY).toBeCloseTo(clientY, 5)
    })

    it('FluidTrail handles failure branches and null environments', () => {
      const tNullDoc = new FluidTrail({}, { document: null })
      expect(tNullDoc.init()).toBe(false)
      expect(tNullDoc.createCanvas()).toBeNull()

      const tNoCanvas = new FluidTrail({}, { createCanvas: () => null })
      expect(tNoCanvas.init()).toBe(false)

      const canvasNoCtx = document.createElement('canvas')
      canvasNoCtx.getContext = vi.fn().mockReturnValue(null)
      const tNoCtx = new FluidTrail({}, { createCanvas: () => canvasNoCtx })
      expect(tNoCtx.init()).toBe(false)

      const canvasNoGetContext = { style: {} } as unknown as HTMLCanvasElement
      const tNoGetContext = new FluidTrail({}, { createCanvas: () => canvasNoGetContext })
      expect(tNoGetContext.init()).toBe(false)

      const mockCtx = { clearRect: vi.fn(), beginPath: vi.fn(), arc: vi.fn(), fill: vi.fn(), fillStyle: '', globalAlpha: 1 }
      const mockCanvas = document.createElement('canvas')
      mockCanvas.getContext = vi.fn().mockReturnValue(mockCtx)

      const tSafe = new FluidTrail()
      tSafe.spawnDrop(10, 10, 1, 1)
      expect(tSafe.drops.length).toBe(1)
      expect(tSafe.drops[0]?.size).toBe(28)
      expect(tSafe.drops[0]?.color).toBe('#e4f222')
      tSafe.update()
      tSafe.draw()
      tSafe.destroy()
      expect(tSafe.createCanvas()).not.toBeNull()

      const tNullWin = new FluidTrail({}, { window: null, createCanvas: () => mockCanvas })
      expect(tNullWin.init()).toBe(true)
      expect(tNullWin.raf(() => {})).toBeNull()
      expect(tNullWin.caf(1)).toBeNull()
      tNullWin.destroy()
    })

    it('prepareFluidCursor initializes and manages lifecycle with mock canvas', () => {
      const el = document.createElement('body')
      const mockCtx = { clearRect: vi.fn(), beginPath: vi.fn(), arc: vi.fn(), fill: vi.fn(), fillStyle: '', globalAlpha: 1 }
      const mockCanvas = document.createElement('canvas')
      mockCanvas.getContext = vi.fn().mockReturnValue(mockCtx)

      const params = {
        num: vi.fn().mockReturnValue(32),
        text: vi.fn().mockReturnValue('#00ffcc'),
      } as unknown as EffectParams

      const inst = prepareFluidCursor(el, params, createRealPrepareContext(el, {
        reducedMotion: false,
        createCanvas: () => mockCanvas,
      }))
      expect(inst).toBeDefined()
      inst.activate()
      inst.cancel()
      inst.finish()
      inst.destroy()

      const instNoDoc = prepareFluidCursor({} as any, params, createRealPrepareContext(null, { reducedMotion: false }))
      expect(instNoDoc).toBeDefined()
      instNoDoc.destroy()
    })

    it('FluidTrail handles acquire re-entry, empty drop loop exit, and setSharedFluidTrail', () => {
      const mockCtx = { clearRect: vi.fn(), beginPath: vi.fn(), arc: vi.fn(), fill: vi.fn(), fillStyle: '', globalAlpha: 1 }
      const mockCanvas = document.createElement('canvas')
      mockCanvas.getContext = vi.fn().mockReturnValue(mockCtx)

      let tickCb: FrameRequestCallback | null = null
      const fakeRaf = vi.fn((fn: FrameRequestCallback) => {
        tickCb = fn
        return 88
      })

      const trail = new FluidTrail({}, {
        createCanvas: () => mockCanvas,
        raf: fakeRaf,
      })

      // First acquire
      expect(trail.acquire()).toBe(true)
      // Second acquire when ctx already present (lines 59-61)
      expect(trail.acquire()).toBe(true)
      expect(trail.refCount).toBe(2)

      // Empty drop tick (lines 126-127: else rafId = null)
      trail.drops = []
      trail.startLoop()
      expect(tickCb).not.toBeNull()
      tickCb!(1000)
      expect(trail.rafId).toBeNull()

      // onResize invocation (line 85)
      trail.onResize?.()
      expect(syncCanvasSize(null, null)).toBe(1)

      // Draw with minimal ctx lacking save/restore (lines 156-162 branches)
      const minCtx = {
        clearRect: vi.fn(),
        beginPath: vi.fn(),
        arc: vi.fn(),
        fill: vi.fn(),
        fillStyle: '',
        globalAlpha: 1,
      } as unknown as CanvasRenderingContext2D
      const trailNoSave = new FluidTrail({}, {
        createCanvas: () => {
          const c = document.createElement('canvas')
          c.getContext = vi.fn().mockReturnValue(minCtx)
          return c
        },
      })
      trailNoSave.init()
      trailNoSave.spawnDrop(50, 50, 1, 1)
      trailNoSave.draw()
      trailNoSave.destroy()

      trail.release()
      trail.release()

      // setSharedFluidTrail (lines 191-192)
      setSharedFluidTrail(null)
      expect(setSharedFluidTrail(trail)).toBeUndefined()
      setSharedFluidTrail(null)
    })

    it('prepareFluidCursor handles failed acquisition and empty params', () => {
      const el = document.createElement('div')
      const failedInst = prepareFluidCursor(el, {} as EffectParams, createRealPrepareContext(el, {
        reducedMotion: false,
        doc: { body: null } as unknown as Document,
      }))
      expect(failedInst).toBeDefined()

      setSharedFluidTrail(null)
      const mockCtx = { clearRect: vi.fn(), beginPath: vi.fn(), arc: vi.fn(), fill: vi.fn(), fillStyle: '', globalAlpha: 1 }
      const mockCanvas = document.createElement('canvas')
      mockCanvas.getContext = vi.fn().mockReturnValue(mockCtx)

      const okInst = prepareFluidCursor(el, {} as EffectParams, createRealPrepareContext(el, {
        reducedMotion: false,
        createCanvas: () => mockCanvas,
      }))
      expect(okInst).toBeDefined()
      okInst.destroy()
      setSharedFluidTrail(null)
    })

    it('registerFluidCursor throws on invalid registry target', () => {
      expect(() => registerFluidCursor(null)).toThrow('kuinetic: registerFluidCursor requires a Registry or Animator instance')
    })
  })

  describe('Reduced Motion Handling', () => {
    it('particle prepare hook returns safe no-op under reduced motion', () => {
      const mockParams = {
        text: vi.fn().mockReturnValue('default'),
        num: vi.fn().mockReturnValue(1),
        keyword: vi.fn().mockReturnValue('default'),
      } as unknown as EffectParams
      const reducedCtx = createRealPrepareContext(null, { reducedMotion: true })

      const partInst = PARTICLE_PRIMITIVES[0]!.prepare!(document.createElement('div'), mockParams, reducedCtx)
      expect(partInst).toBeDefined()
      if (partInst.activate) partInst.activate()
      if (partInst.cancel) partInst.cancel()
      if (partInst.finish) partInst.finish()
      expect(() => partInst.destroy()).not.toThrow()
    })

    it('fluid prepare hook returns safe no-op under reduced motion', () => {
      const mockParams = {
        text: vi.fn().mockReturnValue('default'),
        num: vi.fn().mockReturnValue(1),
        keyword: vi.fn().mockReturnValue('default'),
      } as unknown as EffectParams
      const reducedCtx = createRealPrepareContext(null, { reducedMotion: true })

      const fluidInst = FLUID_PRIMITIVES[0]!.prepare!(document.createElement('div'), mockParams, reducedCtx)
      expect(fluidInst).toBeDefined()
      if (fluidInst.activate) fluidInst.activate()
      if (fluidInst.cancel) fluidInst.cancel()
      if (fluidInst.finish) fluidInst.finish()
      expect(() => fluidInst.destroy()).not.toThrow()
    })

    it('prepareFluidCursor returns inert instance when document has no body', () => {
      const el = document.createElement('div')
      const ctx = createRealPrepareContext(el, {
        reducedMotion: false,
        doc: { body: null } as unknown as Document,
      })
      const inst = prepareFluidCursor(el, { num: vi.fn(), text: vi.fn() } as any, ctx)
      expect(inst).toBeDefined()
      inst.destroy()
    })

    it('particle activate reconnects listeners and cancel unbinds observer', () => {
      const el = document.createElement('div')
      const mockCanvas = document.createElement('canvas')
      mockCanvas.getContext = vi.fn().mockReturnValue({
        clearRect: vi.fn(),
        beginPath: vi.fn(),
        arc: vi.fn(),
        fill: vi.fn(),
      })
      let disconnectCalled = false
      const fakeRO = vi.fn().mockImplementation(() => ({
        observe: vi.fn(),
        disconnect: vi.fn(() => { disconnectCalled = true }),
      }))
      vi.stubGlobal('ResizeObserver', fakeRO)

      const inst = PARTICLE_PRIMITIVES[0]!.prepare!(el, {
        num: vi.fn().mockReturnValue(10),
        text: vi.fn().mockReturnValue('#fff'),
      } as any, createRealPrepareContext(el, {
        reducedMotion: false,
        createCanvas: () => mockCanvas,
      }))

      inst.activate()
      inst.cancel()
      expect(disconnectCalled).toBe(true)

      // Reactivate already mounted instance
      inst.activate()
      inst.finish()
      inst.destroy()
      vi.unstubAllGlobals()
    })

    it('particle startLoop ticks and moves particles', () => {
      const el = document.createElement('div')
      const mockCanvas = document.createElement('canvas')
      mockCanvas.getContext = vi.fn().mockReturnValue({
        clearRect: vi.fn(),
        beginPath: vi.fn(),
        arc: vi.fn(),
        fill: vi.fn(),
      })
      let tickCb: FrameRequestCallback | null = null
      const fakeRaf = vi.fn((fn: FrameRequestCallback) => {
        tickCb = fn
        return 99
      })

      const emitter = new ParticleEmitter(el, { count: 5, radius: 50 }, {
        createCanvas: () => mockCanvas,
        raf: fakeRaf,
      })
      emitter.init()
      const originX = emitter.particles[0]!.x
      emitter.particles[0]!.vx = 5
      emitter.particles[0]!.vy = 5
      emitter.startLoop()
      expect(fakeRaf).toHaveBeenCalled()
      if (tickCb) (tickCb as any)(1000)
      expect(emitter.particles[0]!.x).not.toBe(originX)
      emitter.destroy()
    })

    it('FluidTrail routes pointermove to ancestor client, bounding rect, or suppresses drop when outside', () => {
      const mockCanvas = document.createElement('canvas')
      mockCanvas.getContext = vi.fn().mockReturnValue({
        clearRect: vi.fn(),
        beginPath: vi.fn(),
        arc: vi.fn(),
        fill: vi.fn(),
      })
      const trail = new FluidTrail({ size: 10 }, {
        createCanvas: () => mockCanvas,
        window: {
          innerWidth: 1000,
          innerHeight: 1000,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        } as any,
      })
      trail.init()

      const hostA = document.createElement('div')
      const childA = document.createElement('span')
      hostA.appendChild(childA)
      hostA.getBoundingClientRect = () => ({ left: 10, top: 10, right: 110, bottom: 110, width: 100, height: 100 } as DOMRect)

      const hostB = document.createElement('div')
      hostB.getBoundingClientRect = () => ({ left: 200, top: 200, right: 300, bottom: 300, width: 100, height: 100 } as DOMRect)

      const idA = trail.registerClient({ size: 15, color: '#f00' }, hostA)
      const idB = trail.registerClient({ size: 45, color: '#00f' }, hostB)
      trail.activateClient(idA)
      trail.activateClient(idB)

      // 1. Target is a descendant of hostA -> resolves hostA via ancestor walk
      trail.onPointerMove?.({ clientX: 50, clientY: 50, target: childA } as any)
      expect(trail.drops.length).toBe(1)
      expect(trail.drops[0]?.size).toBe(15)

      // 2. Target is null, but coordinates are inside hostB -> resolves hostB via bounding rect
      trail.onPointerMove?.({ clientX: 250, clientY: 250, target: null } as any)
      expect(trail.drops.length).toBe(2)
      expect(trail.drops[1]?.size).toBe(45)

      // 3. Coordinates outside all active hosts -> resolves null, no drops added
      const dropCountBefore = trail.drops.length
      trail.onPointerMove?.({ clientX: 800, clientY: 800, target: null } as any)
      expect(trail.drops.length).toBe(dropCountBefore)

      trail.destroy()
    })

    it('the last client to stand down wipes the overlay instead of freezing it mid-splash', () => {
      const clearRect = vi.fn()
      const mockCanvas = document.createElement('canvas')
      mockCanvas.getContext = vi.fn().mockReturnValue({
        clearRect,
        save: vi.fn(),
        restore: vi.fn(),
        beginPath: vi.fn(),
        arc: vi.fn(),
        fill: vi.fn(),
      }) as any
      const trail = new FluidTrail({ size: 10 }, {
        createCanvas: () => mockCanvas,
        window: {
          innerWidth: 1000,
          innerHeight: 1000,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        } as any,
      })
      trail.init()

      const host = document.createElement('div')
      host.getBoundingClientRect = () => ({ left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100 } as DOMRect)
      const id = trail.registerClient({ size: 15, color: '#f00' }, host)
      trail.activateClient(id)
      trail.onPointerMove?.({ clientX: 50, clientY: 50, target: host } as any)
      expect(trail.drops.length).toBeGreaterThan(0)

      clearRect.mockClear()
      // `cancel()`/`finish()` reach this, not `destroy()`. `draw()` clears at the *start* of a
      // frame, so stopping the loop left the drops in flight painted across a fixed, full-viewport,
      // z-index 9998 overlay until something reactivated it.
      trail.deactivateClient(id)
      expect(trail.drops).toEqual([])
      expect(clearRect).toHaveBeenCalled()
      // And the overlay itself is still there: the last *unregister* owns that teardown.
      expect(trail.canvas).toBe(mockCanvas)

      trail.unregisterClient(id)
    })

    it('getSharedFluidTrail isolates instances per document using WeakMap', () => {
      const docA = document.implementation.createHTMLDocument('FA')
      const docB = document.implementation.createHTMLDocument('FB')
      const tA = getSharedFluidTrail({ document: docA })
      const tB = getSharedFluidTrail({ document: docB })
      expect(tA).not.toBe(tB)
      tA.destroy()
      tB.destroy()

      // Fallback keys when document is null
      const fakeWin = {} as any
      const tWin = getSharedFluidTrail({ document: null, window: fakeWin })
      expect(tWin).toBeDefined()
      tWin.destroy()

      const tNullAll = getSharedFluidTrail({ document: null, window: null })
      expect(tNullAll).toBeDefined()
      setSharedFluidTrail(null, { document: null, window: null })
      tNullAll.destroy()
    })

    it('FluidTrail handles activateClient error branches and setupCanvas idempotency', () => {
      const trail = new FluidTrail({}, { createCanvas: () => null })
      expect(trail.activateClient(9999)).toBe(false)

      const clientHost = document.createElement('div')
      const clientId = trail.registerClient({ size: 20 }, clientHost)
      // setupCanvas fails because createCanvas returns null
      expect(trail.activateClient(clientId)).toBe(false)

      const mockCanvas = document.createElement('canvas')
      mockCanvas.getContext = vi.fn().mockReturnValue({
        clearRect: vi.fn(),
        beginPath: vi.fn(),
        arc: vi.fn(),
        fill: vi.fn(),
      })
      const trail2 = new FluidTrail({}, { createCanvas: () => mockCanvas })
      expect(trail2.setupCanvas()).toBe(true)
      // Calling setupCanvas a second time when canvas and ctx exist returns true immediately
      expect(trail2.setupCanvas()).toBe(true)

      // spawnDrop without options falls back to defaults
      trail2.spawnDrop(10, 20, 1, 1, {})
      expect(trail2.drops.length).toBe(1)
      expect(trail2.drops[0]?.size).toBe(28)
      expect(trail2.drops[0]?.color).toBe('#e4f222')
      expect(trail2.drops[0]?.viscosity).toBe(0.88)

      trail2.destroy()
      trail.destroy()
    })
  })
})
