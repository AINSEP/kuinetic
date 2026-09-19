// @vitest-environment jsdom
/**
 * Advanced Modules Contracts & Invariants Verification Tests
 * Verifies all lifecycle, channels, activation, and fallback contracts.
 */

import { describe, expect, it, vi, afterEach } from 'vitest'
import { createEffectInstance, createInertInstance } from '../base.js'
import { AUDIO_CHANNELS, AUDIO_PRIMITIVES } from '../audio.js'
import { CAMERA_PRIMITIVES, prepareCameraScene } from '../camera-3d.js'
import { SCENE_PRIMITIVES, prepareScene } from '../scenes.js'
import { PARTICLE_PRIMITIVES, ParticleEmitter } from '../particles.js'
import {
  FLUID_PRIMITIVES,
  FluidTrail,
  prepareFluidCursor,
  setSharedFluidTrail,
} from '../fluid-cursor.js'
import {
  SHADERS_PRIMITIVE,
  SharedShaderRenderer,
  prepareShaders,
  setSharedShaderRenderer,
} from '../shaders.js'
import { extractShaderOptions, setupScissor } from '../shaders.js'
import type { EffectParams } from '../../core/types.js'
import { createRealPrepareContext } from './prepare-context-fixture.js'

function createMockGL() {
  return {
    VERTEX_SHADER: 35633,
    FRAGMENT_SHADER: 35632,
    ARRAY_BUFFER: 34962,
    STATIC_DRAW: 35044,
    TEXTURE_2D: 3553,
    TEXTURE0: 33984,
    TEXTURE1: 33985,
    TEXTURE_WRAP_S: 10242,
    TEXTURE_WRAP_T: 10243,
    TEXTURE_MIN_FILTER: 10241,
    TEXTURE_MAG_FILTER: 10240,
    CLAMP_TO_EDGE: 33071,
    LINEAR: 9729,
    RGBA: 6408,
    UNSIGNED_BYTE: 5121,
    FLOAT: 5126,
    COLOR_BUFFER_BIT: 16384,
    SCISSOR_TEST: 3089,
    TRIANGLES: 4,
    COMPILE_STATUS: 35713,
    LINK_STATUS: 35714,
    createShader: vi.fn(() => ({})),
    shaderSource: vi.fn(),
    compileShader: vi.fn(),
    getShaderParameter: vi.fn(() => true),
    deleteShader: vi.fn(),
    createProgram: vi.fn(() => ({})),
    attachShader: vi.fn(),
    linkProgram: vi.fn(),
    getProgramParameter: vi.fn(() => true),
    deleteProgram: vi.fn(),
    createBuffer: vi.fn(() => ({})),
    bindBuffer: vi.fn(),
    bufferData: vi.fn(),
    deleteBuffer: vi.fn(),
    createTexture: vi.fn(() => ({})),
    activeTexture: vi.fn(),
    bindTexture: vi.fn(),
    texParameteri: vi.fn(),
    texImage2D: vi.fn(),
    deleteTexture: vi.fn(),
    useProgram: vi.fn(),
    getAttribLocation: vi.fn(() => 0),
    enableVertexAttribArray: vi.fn(),
    vertexAttribPointer: vi.fn(),
    getUniformLocation: vi.fn((_p, name) => ({ name })),
    uniform1f: vi.fn(),
    uniform1i: vi.fn(),
    uniform2f: vi.fn(),
    uniform4fv: vi.fn(),
    enable: vi.fn(),
    disable: vi.fn(),
    clearColor: vi.fn(),
    clear: vi.fn(),
    viewport: vi.fn(),
    scissor: vi.fn(),
    drawArrays: vi.fn(),
  }
}

describe('Advanced Modules Contracts & Verification', () => {
  afterEach(() => {
    setSharedFluidTrail(null)
    setSharedShaderRenderer(null)
    vi.restoreAllMocks()
  })

  describe('Defect 1: Deferred shaders loop restart', () => {
    it('restarts the renderer loop when activated after being idle', () => {
      let rafCb: FrameRequestCallback | null = null
      const fakeRaf = vi.fn((fn: FrameRequestCallback) => {
        rafCb = fn
        return 501
      })
      const fakeCaf = vi.fn()
      const mockCanvas = document.createElement('canvas')
      mockCanvas.width = 1000
      mockCanvas.height = 800
      const mockGl = createMockGL()
      mockCanvas.getContext = vi.fn().mockReturnValue(mockGl)

      const renderer = new SharedShaderRenderer({
        createCanvas: () => mockCanvas,
        raf: fakeRaf,
        caf: fakeCaf,
      })
      renderer.init()
      setSharedShaderRenderer(renderer)

      // Simulate idle frame execution: with 0 draw calls, loop stops
      expect(rafCb).not.toBeNull()
      rafCb!(1000)
      expect(renderer.rafId).toBeNull()

      const img = document.createElement('img')
      img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
      Object.defineProperty(img, 'complete', { value: true })
      Object.defineProperty(img, 'naturalWidth', { value: 100 })
      Object.defineProperty(img, 'naturalHeight', { value: 100 })
      img.getBoundingClientRect = () => ({ left: 10, top: 10, right: 110, bottom: 110, width: 100, height: 100 } as DOMRect)

      const inst = prepareShaders(img, {
        keyword: vi.fn().mockReturnValue('displace'),
        num: vi.fn().mockReturnValue(0.5),
        text: vi.fn().mockReturnValue(''),
      } as unknown as EffectParams, createRealPrepareContext(img, {
        reducedMotion: false,
        createCanvas: () => mockCanvas,
      }))

      // Activate triggers startLoop()
      inst.activate()
      expect(renderer.rafId).toBe(501)
      expect(img.style.opacity).toBe('') // Golden rule: not hidden before draw!
      rafCb!(1050) // Frame tick executes draw pass
      expect(img.style.opacity).toBe('0')

      inst.destroy()
      expect(img.style.opacity).toBe('')
      renderer.destroy()
    })
  })

  describe('Defect 2 & Lifecycle: Completion contract & double-destroy idempotency', () => {
    it('continuous effect instance resolves finished immediately', async () => {
      let destroyCount = 0
      const inst = createEffectInstance({
        continuous: true,
        destroy() { destroyCount++ },
      })
      await expect(inst.finished).resolves.toBeUndefined()

      inst.destroy()
      inst.destroy()
      expect(destroyCount).toBe(1)
    })

    it('one-shot effect instance resolves finished on cancel, finish, or destroy', async () => {
      let destroyCount = 0
      const inst1 = createEffectInstance({
        continuous: false,
        destroy() { destroyCount++ },
      })
      inst1.cancel()
      await expect(inst1.finished).resolves.toBeUndefined()
      inst1.destroy()
      inst1.destroy()
      expect(destroyCount).toBe(1)

      const inst2 = createEffectInstance({ continuous: false })
      inst2.finish()
      await expect(inst2.finished).resolves.toBeUndefined()

      const inst3 = createEffectInstance({ continuous: false })
      inst3.destroy()
      await expect(inst3.finished).resolves.toBeUndefined()
    })

    it('settles finished even when the teardown it wraps throws', async () => {
      /*
       * `destroy()` is the one call the guard makes unrepeatable: it latches `isDestroyed` before
       * running `opts.destroy()`, on purpose — a teardown that threw partway must not be re-entered,
       * and a later `activate()` must not resurrect a destroyed effect through ledgers that rejoin
       * on write. So a throw used to cost the completion contract outright: the resolve sat after
       * the call, every later `destroy()` returned at the guard, and a non-continuous instance's
       * `finished` never settled for the life of the page.
       *
       * A real shape, not a hypothetical one: `createAdvancedLedgers.restore()` throws an
       * `AggregateError` for an element it genuinely could not give back, and `CameraController`
       * calls it from a `finally`.
       */
      const inst = createEffectInstance({
        continuous: false,
        destroy() { throw new Error('teardown blew up') },
      })

      // Watched rather than awaited, so a promise that never settles fails this in one microtask
      // turn instead of hanging the suite until the test timeout — the whole failure mode here is
      // "waits forever", and a test that reproduces it by waiting forever reports it badly.
      let settled = false
      void inst.finished.then(() => { settled = true })

      // Still reported — swallowing it here would hide the failure from the only caller that can
      // see it, and the animator's own `runQuietly` is where the decision to ignore it belongs.
      expect(() => inst.destroy()).toThrow('teardown blew up')
      await Promise.resolve()
      expect(settled).toBe(true)
      // And the latch is intact: the throw did not buy a second attempt.
      expect(() => inst.destroy()).not.toThrow()
    })

    it('inert instance resolves finished immediately and guards destroy', () => {
      let destroyCount = 0
      const inert = createInertInstance(() => { destroyCount++ })
      expect(inert.finished).toBeDefined()
      inert.destroy()
      inert.destroy()
      expect(destroyCount).toBe(1)
    })
  })

  describe('Defect 3: Fluid multi-client isolation & deferred activation', () => {
    it('does not install listeners before activation and isolates client options', () => {
      const mockCanvas = document.createElement('canvas')
      mockCanvas.getContext = vi.fn().mockReturnValue({
        save: vi.fn(),
        restore: vi.fn(),
        clearRect: vi.fn(),
        beginPath: vi.fn(),
        arc: vi.fn(),
        fill: vi.fn(),
      })

      const winEvents = new Map<string, EventListener>()
      const fakeWin = {
        innerWidth: 1000,
        innerHeight: 800,
        devicePixelRatio: 1,
        addEventListener: vi.fn((type: string, fn: EventListener) => winEvents.set(type, fn)),
        removeEventListener: vi.fn((type: string) => winEvents.delete(type)),
      }

      const trail = new FluidTrail({}, {
        createCanvas: () => mockCanvas,
        window: fakeWin as any,
      })
      setSharedFluidTrail(trail)

      const el1 = document.createElement('div')
      const el2 = document.createElement('div')

      const params1 = {
        num: vi.fn((k: string) => (k === 'size' ? 20 : 0.8)),
        text: vi.fn(() => '#ff0000'),
      } as unknown as EffectParams

      const params2 = {
        num: vi.fn((k: string) => (k === 'size' ? 60 : 0.95)),
        text: vi.fn(() => '#0000ff'),
      } as unknown as EffectParams

      const ctx = createRealPrepareContext(el1, {
        reducedMotion: false,
        createCanvas: () => mockCanvas,
        win: fakeWin,
      })

      const inst1 = prepareFluidCursor(el1, params1, ctx)
      const inst2 = prepareFluidCursor(el2, params2, ctx)

      // Before activation: no listeners attached!
      expect(trail.isListening).toBe(false)
      expect(winEvents.has('pointermove')).toBe(false)

      // Activate client 1
      inst1.activate()
      expect(trail.isListening).toBe(true)
      expect(winEvents.has('pointermove')).toBe(true)
      expect(trail.activeClients.size).toBe(1)

      // Activate client 2
      inst2.activate()
      expect(trail.activeClients.size).toBe(2)

      // Cancelling client 1 leaves client 2 active with listeners intact
      inst1.cancel()
      expect(trail.activeClients.size).toBe(1)
      expect(trail.isListening).toBe(true)
      expect(winEvents.has('pointermove')).toBe(true)

      // Cancelling client 2 detaches listeners
      inst2.cancel()
      expect(trail.activeClients.size).toBe(0)
      expect(trail.isListening).toBe(false)
      expect(winEvents.has('pointermove')).toBe(false)

      inst1.destroy()
      inst2.destroy()
      expect(trail.clients.size).toBe(0)
    })
  })

  describe('Defect 4: Particle idle loop termination & cancel unbind', () => {
    it('stops RAF loop when particles settle and unbinds pointer on cancel', () => {
      const target = document.createElement('div')
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
        return 777
      })
      const fakeCaf = vi.fn()

      const emitter = new ParticleEmitter(target, { count: 10, radius: 50 }, {
        createCanvas: () => mockCanvas,
        raf: fakeRaf,
        caf: fakeCaf,
      })
      emitter.init()

      emitter.onMouseMove({ clientX: 20, clientY: 20 })
      expect(emitter.rafId).toBe(777)

      emitter.onMouseLeave()
      expect(tickCb).not.toBeNull()
      tickCb!(1000)
      expect(emitter.rafId).toBeNull()

      emitter.unbindEvents()
      expect(emitter.isListening).toBe(false)
      emitter.destroy()
    })
  })

  describe('Defect 5: Shader morph to: parameter', () => {
    it('extracts to selector in shader options', () => {
      const params = {
        keyword: vi.fn().mockReturnValue('morph'),
        text: vi.fn((k: string) => (k === 'to' ? '#morph-target' : '')),
        num: vi.fn().mockReturnValue(0.5),
      } as unknown as EffectParams

      const options = extractShaderOptions(params)
      expect(options.mode).toBe('morph')
      expect(options.to).toBe('#morph-target')
    })
  })

  describe('Defect 6: Scissor coordinate clamping', () => {
    it('clamps scissor Y and height to prevent negative values when target overflows viewport', () => {
      const gl = {
        viewport: vi.fn(),
        scissor: vi.fn(),
        enable: vi.fn(),
        SCISSOR_TEST: 3089,
      } as unknown as WebGLRenderingContext

      const el = {
        getBoundingClientRect: () => ({ left: 0, top: 700, bottom: 900, width: 200, height: 200 } as DOMRect),
      } as HTMLElement
      const canvas = { width: 1000, height: 800 } as HTMLCanvasElement
      const win = { innerHeight: 800, devicePixelRatio: 1 } as unknown as Window

      setupScissor(gl, el, canvas, win)

      expect(gl.scissor).toHaveBeenCalled()
      const call = (gl.scissor as any).mock.calls[0]
      const [x, y, w, h] = call
      expect(x).toBe(0)
      expect(y).toBe(0)
      expect(w).toBe(200)
      expect(h).toBe(100)
    })
  })

  describe('Defect 7: Camera 3D pre-activation destroy preserves authored inline styles', () => {
    it('preserves authored perspective and transform-style when destroyed before activation', () => {
      const container = document.createElement('div')
      container.style.perspective = '1200px'
      container.style.transformStyle = 'preserve-3d'
      container.style.transform = 'translateZ(0px)'

      const inst = prepareCameraScene(container, {
        num: vi.fn().mockReturnValue(50),
      } as unknown as EffectParams)

      inst.destroy()

      expect(container.style.perspective).toBe('1200px')
      expect(container.style.transformStyle).toBe('preserve-3d')
      expect(container.style.transform).toBe('translateZ(0px)')
    })
  })

  describe('Defect 8: Scene time mode completion', () => {
    it('stops listening and resolves finished when progress reaches 1', async () => {
      const container = document.createElement('div')
      const step = document.createElement('div')
      step.setAttribute('data-kui', 'scene-step')
      step.setAttribute('data-kui-x', '100px')
      container.appendChild(step)

      let tickCb: FrameRequestCallback | null = null
      const fakeRaf = vi.fn((fn: FrameRequestCallback) => {
        tickCb = fn
        return 999
      })

      let currentTime = 1000
      const fakeWin = {
        performance: {
          now: () => currentTime,
        },
      }

      const inst = prepareScene(container, {
        text: vi.fn((k: string) => (k === 'progress' ? 'time' : 'my-scene')),
        num: vi.fn(() => 200),
      } as unknown as EffectParams, createRealPrepareContext(container, {
        reducedMotion: false,
        raf: fakeRaf,
        win: fakeWin,
      }))

      inst.activate()
      expect(tickCb).not.toBeNull()

      // Advance clock past 200ms duration
      currentTime = 1300
      tickCb!(1300)

      await expect(inst.finished).resolves.toBeUndefined()
      inst.destroy()
    })
  })

  describe('Channel Honest Declarations', () => {
    it('all primitive channels accurately reflect real DOM writes', () => {
      expect(SHADERS_PRIMITIVE.channels).toEqual(['opacity'])
      expect(PARTICLE_PRIMITIVES[0]!.channels).toEqual(['position'])
      expect(FLUID_PRIMITIVES[0]!.channels).toEqual([])
      expect(CAMERA_PRIMITIVES[0]!.channels).toEqual(['skew', 'perspective', 'transform-style'])
      expect(SCENE_PRIMITIVES[0]!.channels).toEqual(['opacity', 'skew'])
    })

    it('audio claims exactly the five custom properties it writes', () => {
      expect(AUDIO_PRIMITIVES[0]!.channels).toEqual([
        '--kui-audio-bass',
        '--kui-audio-mid',
        '--kui-audio-treble',
        '--kui-audio-level',
        '--kui-audio',
      ])
      // The declaration and the writes read from one list, so a sixth property cannot be added to
      // `updateFrame` without the registry being told about it.
      expect(AUDIO_PRIMITIVES[0]!.channels).toEqual([...AUDIO_CHANNELS])
    })
  })

  describe('Fallback Visibility & Robustness ("Never hide before you can draw")', () => {
    it('does not throw or hide element when an invalid "to" selector is provided', () => {
      const img = document.createElement('img')
      img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
      Object.defineProperty(img, 'complete', { value: true })
      Object.defineProperty(img, 'naturalWidth', { value: 100 })
      Object.defineProperty(img, 'naturalHeight', { value: 100 })
      img.getBoundingClientRect = () => ({ left: 10, top: 10, right: 110, bottom: 110, width: 100, height: 100 } as DOMRect)

      const mockCanvas = document.createElement('canvas')
      mockCanvas.getContext = vi.fn().mockReturnValue(createMockGL())

      const renderer = new SharedShaderRenderer({
        createCanvas: () => mockCanvas,
      })
      setSharedShaderRenderer(renderer)

      // Malformed CSS selector that would make querySelector throw
      const inst = prepareShaders(img, {
        keyword: vi.fn().mockReturnValue('morph'),
        text: vi.fn((k: string) => (k === 'to' ? '[:invalid[' : '')),
        num: vi.fn().mockReturnValue(0.5),
      } as unknown as EffectParams, createRealPrepareContext(img, {
        reducedMotion: false,
        createCanvas: () => mockCanvas,
      }))

      expect(() => inst.activate()).not.toThrow()
      inst.destroy()
      renderer.destroy()
    })

    it('does not hide host element if element has no image source texture', () => {
      const div = document.createElement('div')
      div.style.opacity = '1'

      const mockCanvas = document.createElement('canvas')
      mockCanvas.getContext = vi.fn().mockReturnValue(createMockGL())
      const renderer = new SharedShaderRenderer({
        createCanvas: () => mockCanvas,
      })
      setSharedShaderRenderer(renderer)

      const inst = prepareShaders(div, {
        keyword: vi.fn().mockReturnValue('displace'),
        num: vi.fn().mockReturnValue(0.5),
        text: vi.fn().mockReturnValue(''),
      } as unknown as EffectParams, createRealPrepareContext(div, {
        reducedMotion: false,
        createCanvas: () => mockCanvas,
      }))

      inst.activate()
      expect(div.style.opacity).not.toBe('0')

      inst.destroy()
      renderer.destroy()
    })

    it('restores original opacity if context is lost and does not hide on uncompiled restored context', () => {
      const img = document.createElement('img')
      img.style.opacity = '1'
      img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
      Object.defineProperty(img, 'complete', { value: true })
      Object.defineProperty(img, 'naturalWidth', { value: 100 })
      Object.defineProperty(img, 'naturalHeight', { value: 100 })
      img.getBoundingClientRect = () => ({ left: 10, top: 10, right: 110, bottom: 110, width: 100, height: 100 } as DOMRect)

      const mockCanvas = document.createElement('canvas')
      mockCanvas.width = 1000
      mockCanvas.height = 800
      let contextLostCb: ((e: Event) => void) | null = null
      mockCanvas.addEventListener = vi.fn((type: string, fn: any) => {
        if (type === 'webglcontextlost') contextLostCb = fn
      })

      mockCanvas.getContext = vi.fn().mockReturnValue(createMockGL())

      let rafCb: FrameRequestCallback | null = null
      const fakeRaf = vi.fn((fn: FrameRequestCallback) => {
        rafCb = fn
        return 888
      })
      const renderer = new SharedShaderRenderer({
        createCanvas: () => mockCanvas,
        raf: fakeRaf,
      })
      setSharedShaderRenderer(renderer)

      const inst = prepareShaders(img, {
        keyword: vi.fn().mockReturnValue('displace'),
        num: vi.fn().mockReturnValue(0.5),
        text: vi.fn().mockReturnValue(''),
      } as unknown as EffectParams, createRealPrepareContext(img, {
        reducedMotion: false,
        createCanvas: () => mockCanvas,
      }))

      inst.activate()
      // Golden rule: not hidden before draw pass
      expect(img.style.opacity).toBe('1')
      rafCb!(1000)
      expect(img.style.opacity).toBe('0')

      if (contextLostCb) {
        (contextLostCb as any)({ preventDefault: vi.fn() })
      }
      expect(img.style.opacity).toBe('1')

      inst.destroy()
      renderer.destroy()
    })
  })

  describe('Particle Resize & Multi-Client Fluid Contracts', () => {
    it('regenerates particle grid on container resize', () => {
      const container = document.createElement('div')
      let currentRect = { left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100 }
      container.getBoundingClientRect = () => currentRect as DOMRect

      const mockCanvas = document.createElement('canvas')
      mockCanvas.getContext = vi.fn().mockReturnValue({
        clearRect: vi.fn(),
        beginPath: vi.fn(),
        arc: vi.fn(),
        fill: vi.fn(),
      })

      const emitter = new ParticleEmitter(container, { count: 20, radius: 50 }, {
        createCanvas: () => mockCanvas,
      })
      emitter.init()
      expect(emitter.particles.length).toBe(20)

      currentRect = { left: 0, top: 0, right: 200, bottom: 200, width: 200, height: 200 }
      emitter.onResize()
      expect(emitter.particles.length).toBe(20)
      for (const p of emitter.particles) {
        expect(p.originX).toBeGreaterThanOrEqual(0)
        expect(p.originX).toBeLessThanOrEqual(200)
        expect(p.originY).toBeGreaterThanOrEqual(0)
        expect(p.originY).toBeLessThanOrEqual(200)
      }
      emitter.destroy()
    })

    it('fluid cursor selects active client options based on cursor coordinates', () => {
      const mockCanvas = document.createElement('canvas')
      mockCanvas.getContext = vi.fn().mockReturnValue({
        save: vi.fn(),
        restore: vi.fn(),
        clearRect: vi.fn(),
        beginPath: vi.fn(),
        arc: vi.fn(),
        fill: vi.fn(),
      })

      const trail = new FluidTrail({}, {
        createCanvas: () => mockCanvas,
      })

      const elA = document.createElement('div')
      elA.getBoundingClientRect = () => ({ left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100 } as DOMRect)
      const elB = document.createElement('div')
      elB.getBoundingClientRect = () => ({ left: 200, top: 0, right: 300, bottom: 100, width: 100, height: 100 } as DOMRect)

      const idA = trail.registerClient({ size: 10, viscosity: 0.2, color: '#aaa' }, elA)
      const idB = trail.registerClient({ size: 50, viscosity: 0.9, color: '#bbb' }, elB)

      trail.activateClient(idA)
      trail.activateClient(idB)

      const optsA = trail.getOptionsAt(50, 50)
      expect(optsA).not.toBeNull()
      expect(optsA?.size).toBe(10)
      expect(optsA?.viscosity).toBe(0.2)

      const optsB = trail.getOptionsAt(250, 50)
      expect(optsB).not.toBeNull()
      expect(optsB?.size).toBe(50)
      expect(optsB?.viscosity).toBe(0.9)

      expect(trail.getOptionsAt(500, 500)).toBeNull()
      const dropCountBefore = trail.drops.length
      trail.spawnDrop(500, 500, 1, 1)
      expect(trail.drops.length).toBe(dropCountBefore)

      trail.destroy()
    })
  })
})
