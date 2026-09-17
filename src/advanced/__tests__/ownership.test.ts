/**
 * The ownership invariant, module by module.
 *
 * Five rounds of external review found the same defect wearing five faces: a module snapshots the
 * author's inline styles at construction or at preparation, writes over them much later, and puts
 * the *snapshot* back on teardown. Everything an author wrote in between is lost, `!important` is
 * dropped on the way back, and an element that never had a `style` attribute is left carrying an
 * empty one.
 *
 * Every case below is written so that it passes only when the value restored is the one that was
 * there immediately before the first write — which is what routing these modules through
 * `core/owned-styles.ts` buys. A test that merely activates and destroys without changing anything
 * in between cannot tell the two implementations apart, so none of them do that.
 */

import { describe, expect, it, vi } from 'vitest'
import { AudioSourceController, prepareAudioSource } from '../audio.js'
import { CameraController } from '../camera-3d.js'
import { SceneController, parseChildStep } from '../scenes.js'
import { ParticleEmitter } from '../particles.js'
import type { EffectParams } from '../../core/types.js'
import { createRealPrepareContext } from './prepare-context-fixture.js'

function mockAudioContext() {
  const analyser = {
    fftSize: 256,
    frequencyBinCount: 128,
    smoothingTimeConstant: 0.8,
    getByteFrequencyData: vi.fn((arr: Uint8Array) => { arr.fill(100) }),
    connect: vi.fn(),
    disconnect: vi.fn(),
  }
  return {
    analyser,
    ctx: {
      state: 'running',
      sampleRate: 44100,
      createAnalyser: vi.fn().mockReturnValue(analyser),
      createMediaElementSource: vi.fn().mockReturnValue({ connect: vi.fn(), disconnect: vi.fn() }),
      createMediaStreamSource: vi.fn().mockReturnValue({ connect: vi.fn(), disconnect: vi.fn() }),
      destination: {},
      resume: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    },
  }
}

describe('advanced modules restore what was there immediately before the first write', () => {
  describe('audio', () => {
    it('restores the value the author wrote after preparation, not the one from before it', () => {
      const host = document.createElement('div')
      host.appendChild(document.createElement('audio'))
      const { ctx } = mockAudioContext()
      const frames: FrameRequestCallback[] = []

      const controller = new AudioSourceController(host, { source: 'media' }, {
        window: { AudioContext: vi.fn().mockImplementation(() => ctx), HTMLMediaElement: window.HTMLMediaElement } as unknown as Window,
        document,
        raf: (fn: FrameRequestCallback) => { frames.push(fn); return frames.length },
        caf: () => null,
      })

      // The author's own write lands *after* the controller exists — the window a
      // construction-time snapshot cannot see.
      //
      // Value only, no `!important`: jsdom's CSSOM does not carry priority on custom properties
      // at all (`setProperty('--x', '1', 'important')` reads back with priority `''`), so the
      // priority half of this invariant is unobservable here. It is covered on real properties by
      // the camera, scene and particle cases below, and by the shader case in `shaders.test.ts`.
      host.style.setProperty('--kui-audio-bass', '0.5')

      controller.start()
      frames[0]?.(16)
      expect(host.style.getPropertyValue('--kui-audio-bass')).not.toBe('0.5')

      controller.destroy()
      expect(host.style.getPropertyValue('--kui-audio-bass')).toBe('0.5')
    })

    it('leaves no style attribute on a host that never had one', () => {
      const host = document.createElement('div')
      host.appendChild(document.createElement('audio'))
      const { ctx } = mockAudioContext()
      const frames: FrameRequestCallback[] = []

      const controller = new AudioSourceController(host, { source: 'media' }, {
        window: { AudioContext: vi.fn().mockImplementation(() => ctx), HTMLMediaElement: window.HTMLMediaElement } as unknown as Window,
        document,
        raf: (fn: FrameRequestCallback) => { frames.push(fn); return frames.length },
        caf: () => null,
      })

      expect(host.hasAttribute('style')).toBe(false)
      controller.start()
      frames[0]?.(16)
      controller.destroy()
      expect(host.hasAttribute('style')).toBe(false)
    })

    it('cancelling releases the microphone rather than waiting for destroy', async () => {
      const host = document.createElement('div')
      const { ctx } = mockAudioContext()
      const track = { stop: vi.fn() }
      const stream = { getTracks: vi.fn().mockReturnValue([track]) }

      const inst = prepareAudioSource(host, {
        text: vi.fn((k: string, d: string) => (k === 'source' ? 'mic' : d)),
        num: vi.fn((_k: string, d: number) => d),
      } as unknown as EffectParams, createRealPrepareContext(host, {
        reducedMotion: false,
        win: {
          AudioContext: vi.fn().mockImplementation(() => ctx),
          navigator: { mediaDevices: { getUserMedia: vi.fn().mockResolvedValue(stream) } },
        },
        raf: () => 1,
        caf: () => null,
      }))

      inst.activate()
      await Promise.resolve()
      expect(ctx.createMediaStreamSource).toHaveBeenCalled()

      inst.cancel()
      expect(track.stop).toHaveBeenCalled()
      expect(ctx.close).toHaveBeenCalled()
      inst.destroy()
    })

    it('a permission granted after cancel stops the stream instead of connecting it', async () => {
      const host = document.createElement('div')
      const { ctx } = mockAudioContext()
      const track = { stop: vi.fn() }
      const granted: ((s: unknown) => void)[] = []
      const pending = new Promise((resolve) => { granted.push(resolve) })

      const controller = new AudioSourceController(host, { source: 'mic' }, {
        window: {
          AudioContext: vi.fn().mockImplementation(() => ctx),
          navigator: { mediaDevices: { getUserMedia: vi.fn().mockReturnValue(pending) } },
        } as unknown as Window,
        document,
        raf: () => 1,
        caf: () => null,
      })

      controller.start()
      // The visitor is still looking at the permission prompt.
      controller.stop()
      granted[0]?.({ getTracks: () => [track] })
      await Promise.resolve()
      await Promise.resolve()

      expect(track.stop).toHaveBeenCalled()
      expect(ctx.createMediaStreamSource).not.toHaveBeenCalled()
      expect(controller.stream).toBeNull()
    })
  })

  describe('camera-3d', () => {
    it('restores the container transform and perspective with their priorities', () => {
      const stage = document.createElement('div')
      const layer = document.createElement('div')
      stage.appendChild(layer)

      const controller = new CameraController(stage, { depth: 800, mouseTilt: true }, { window: null })
      controller.addLayer(layer, 40)

      // Authored after construction — invisible to a constructor-time capture.
      stage.style.setProperty('perspective', '1500px', 'important')
      stage.style.transform = 'scale(1.2)'

      controller.start()
      controller.onMouseMove({ clientX: 900, clientY: 700 } as MouseEvent)
      controller.stepMouse()
      controller.render()
      expect(stage.style.transform).not.toBe('scale(1.2)')

      controller.destroy()
      expect(stage.style.perspective).toBe('1500px')
      expect(stage.style.getPropertyPriority('perspective')).toBe('important')
      expect(stage.style.transform).toBe('scale(1.2)')
      expect(layer.hasAttribute('style')).toBe(false)
    })

    it('renders the scene depth during start even with mouse-tilt off', () => {
      const stage = document.createElement('div')
      const layer = document.createElement('div')
      stage.appendChild(layer)
      stage.getBoundingClientRect = () => ({ top: 0, height: 400 } as DOMRect)

      const controller = new CameraController(stage, { depth: 1000, mouseTilt: false }, { window: null })
      controller.addLayer(layer, 60)
      controller.start()

      // `startLoop()` returns immediately with tilt off, so without a render in `start()` the
      // scene stays flat until the visitor's first scroll.
      expect(layer.style.transform).toContain('translate3d')
      controller.destroy()
    })
  })

  describe('scenes', () => {
    it('restores the step value the author wrote after preparation', () => {
      const stage = document.createElement('div')
      const step = document.createElement('div')
      step.setAttribute('data-kui', 'scene-step at:0..1 opacity:0->1')
      stage.appendChild(step)

      const controller = new SceneController(stage, { progress: 'scroll' }, { window: null })
      controller.addStep(step, parseChildStep(step))

      // Preparation is over; the author now sets their own resting state.
      step.style.setProperty('opacity', '0.3', 'important')

      controller.progress = 0.5
      controller.updateAll()
      expect(step.style.opacity).toBe('0.5')

      controller.destroy()
      expect(step.style.opacity).toBe('0.3')
      expect(step.style.getPropertyPriority('opacity')).toBe('important')
    })

    it('leaves no style attribute on a step that never had one', () => {
      const stage = document.createElement('div')
      const step = document.createElement('div')
      step.setAttribute('data-kui', 'scene-step at:0..1 opacity:0->1 y:40px->0px')
      stage.appendChild(step)

      const controller = new SceneController(stage, { progress: 'scroll' }, { window: null })
      controller.addStep(step, parseChildStep(step))
      expect(step.hasAttribute('style')).toBe(false)

      controller.progress = 0.5
      controller.updateAll()
      expect(step.style.transform).toBeTruthy()

      controller.destroy()
      expect(step.hasAttribute('style')).toBe(false)
    })
  })

  describe('particles', () => {
    it('restores an authored position with its priority', () => {
      const host = document.createElement('div')
      const emitter = new ParticleEmitter(host, {}, {
        window: { getComputedStyle: () => ({ position: 'static' }) } as unknown as Window,
        document,
      })

      host.style.setProperty('position', 'relative', 'important')
      emitter.setupPosition()
      emitter.destroy()

      expect(host.style.position).toBe('relative')
      expect(host.style.getPropertyPriority('position')).toBe('important')
    })
  })
})
