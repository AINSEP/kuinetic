import { describe, expect, it, vi, beforeEach } from 'vitest'
import { Registry } from '../../core/registry.js'
import { Animator } from '../../core/animator.js'
import {
  AudioSourceController,
  computeFrequencyBands,
  prepareAudioSource,
  registerAudio,
  AUDIO_PARAMETERS,
  AUDIO_PRIMITIVES,
  AUDIO_PRESETS,
} from '../audio.js'
import { registerAdvanced } from '../index.js'
import type { EffectParams } from '../../core/types.js'
import { createRealPrepareContext } from './prepare-context-fixture.js'

describe('Audio-Reactive Source Module', () => {
  describe('Frequency Bands Calculation', () => {
    it('returns zeroes on empty data array', () => {
      const bands = computeFrequencyBands(new Uint8Array(0), 44100)
      expect(bands).toEqual({ bass: 0, mid: 0, treble: 0, level: 0 })
    })

    it('computes bass, mid, treble and overall level accurately', () => {
      const data = new Uint8Array(128)
      // Nyquist = 22050, hzPerBin ≈ 172.26
      // Bass: bins 0..2 (up to ~344Hz)
      data[0] = 255
      data[1] = 255
      // Mid: bins 1..24 (250Hz..4000Hz)
      data[5] = 128
      // Treble: bins 23..93 (4000Hz..16000Hz)
      data[30] = 64

      const bands = computeFrequencyBands(data, 44100)
      expect(bands.bass).toBeGreaterThan(0.5)
      expect(bands.mid).toBeGreaterThan(0)
      expect(bands.treble).toBeGreaterThan(0)
      expect(bands.level).toBeGreaterThan(0)
    })

    it('falls back to default nyquist when sampleRate <= 0', () => {
      const data = new Uint8Array(64)
      data.fill(128)
      const bands = computeFrequencyBands(data, 0)
      expect(bands.level).toBeCloseTo(128 / 255)
    })
  })

  describe('AudioSourceController Lifecycle & DOM Writing', () => {
    let mockAudioCtx: any
    let mockAnalyser: any
    let mockSourceNode: any

    beforeEach(() => {
      mockSourceNode = {
        connect: vi.fn(),
        disconnect: vi.fn(),
      }
      mockAnalyser = {
        fftSize: 256,
        frequencyBinCount: 128,
        smoothingTimeConstant: 0.8,
        getByteFrequencyData: vi.fn((arr: Uint8Array) => {
          arr.fill(100)
        }),
        connect: vi.fn(),
        disconnect: vi.fn(),
      }
      mockAudioCtx = {
        state: 'suspended',
        sampleRate: 44100,
        createAnalyser: vi.fn().mockReturnValue(mockAnalyser),
        createMediaElementSource: vi.fn().mockReturnValue(mockSourceNode),
        createMediaStreamSource: vi.fn().mockReturnValue(mockSourceNode),
        destination: {},
        resume: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
      }
    })

    it('initializes audio with media element, writes CSS vars on frame, and restores on destroy', () => {
      const container = document.createElement('div')
      container.style.setProperty('--kui-audio-bass', '0.123')
      const media = document.createElement('audio')
      container.appendChild(media)

      let rafCb: FrameRequestCallback | null = null
      const fakeRaf = vi.fn((cb: FrameRequestCallback) => {
        rafCb = cb
        return 777
      })
      const fakeCaf = vi.fn()

      const fakeWin = {
        AudioContext: vi.fn().mockImplementation(() => mockAudioCtx),
        HTMLMediaElement: window.HTMLMediaElement,
      } as unknown as Window

      const ctrl = new AudioSourceController(container, { source: 'media', smoothing: 0.75, fftSize: 128 }, {
        window: fakeWin,
        document,
        raf: fakeRaf,
        caf: fakeCaf,
      })

      ctrl.start()
      expect(ctrl.isActive).toBe(true)
      expect(mockAudioCtx.resume).toHaveBeenCalled()
      expect(mockAudioCtx.createMediaElementSource).toHaveBeenCalledWith(media)
      expect(mockSourceNode.connect).toHaveBeenCalledWith(mockAnalyser)

      // Loop execution
      expect(rafCb).not.toBeNull()
      rafCb!(16)
      expect(container.style.getPropertyValue('--kui-audio-bass')).not.toBe('0.123')
      expect(container.style.getPropertyValue('--kui-audio-mid')).toBeTruthy()
      expect(container.style.getPropertyValue('--kui-audio-treble')).toBeTruthy()
      expect(container.style.getPropertyValue('--kui-audio-level')).toBeTruthy()

      // Stop & Destroy
      ctrl.stop()
      expect(ctrl.isActive).toBe(false)
      expect(fakeCaf).toHaveBeenCalledWith(777)

      ctrl.destroy()
      expect(mockSourceNode.disconnect).toHaveBeenCalled()
      expect(mockAnalyser.disconnect).toHaveBeenCalled()
      expect(mockAudioCtx.close).toHaveBeenCalled()
      // Restored original value
      expect(container.style.getPropertyValue('--kui-audio-bass')).toBe('0.123')
    })

    it('handles mic source opt-in with MediaStream', async () => {
      const container = document.createElement('div')
      const mockTrack = { stop: vi.fn() }
      const mockStream = { getTracks: vi.fn().mockReturnValue([mockTrack]) }

      const fakeWin = {
        AudioContext: vi.fn().mockImplementation(() => mockAudioCtx),
        navigator: {
          mediaDevices: {
            getUserMedia: vi.fn().mockResolvedValue(mockStream),
          },
        },
      } as unknown as Window

      const ctrl = new AudioSourceController(container, { source: 'mic' }, {
        window: fakeWin,
        document,
      })

      ctrl.start()
      await Promise.resolve() // Wait for getUserMedia promise tick

      expect(fakeWin.navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({ audio: true })
      ctrl.destroy()
      expect(mockTrack.stop).toHaveBeenCalled()
    })

    it('gracefully handles missing AudioContext and missing media elements', () => {
      const container = document.createElement('div')
      const ctrlNoAudio = new AudioSourceController(container, {}, { window: {} as any })
      expect(ctrlNoAudio.initAudio()).toBe(false)
      ctrlNoAudio.start()
      ctrlNoAudio.updateFrame()
      ctrlNoAudio.destroy()
    })
  })

  describe('prepareAudioSource and Registry Integration', () => {
    it('returns inert instance under reduced motion', () => {
      const el = document.createElement('div')
      const params = {
        text: vi.fn().mockReturnValue('media'),
        num: vi.fn().mockReturnValue(1),
      } as unknown as EffectParams
      const ctx = createRealPrepareContext(el, { reducedMotion: true })

      const inst = prepareAudioSource(el, params, ctx)
      expect(inst).toBeDefined()
      expect(inst.continuous).toBe(false)
    })

    it('returns working effect instance with activate, cancel, finish, destroy', () => {
      const el = document.createElement('div')
      const params = {
        text: vi.fn((k, def) => (k === 'source' ? 'media' : def)),
        num: vi.fn((k, def) => def),
      } as unknown as EffectParams
      const ctx = createRealPrepareContext(el, { reducedMotion: false })

      const inst = prepareAudioSource(el, params, ctx)
      expect(inst).toBeDefined()
      expect(inst.continuous).toBe(true)

      inst.activate()
      inst.cancel()
      inst.finish()
      inst.destroy()
    })

    it('registers into Registry and Animator', () => {
      const reg = new Registry()
      registerAudio(reg)
      expect(reg.resolve('audio-source')).toBeDefined()
      expect(reg.resolve('audio-reactive')).toBeDefined()
      expect(reg.resolve('audio-mic')).toBeDefined()

      const anim = new Animator()
      registerAudio(anim)
      expect(anim.registry.resolve('audio-source')).toBeDefined()
      expect(AUDIO_PARAMETERS.source.default).toBe('media')
      expect(AUDIO_PRIMITIVES[0]?.id).toBe('audio-source')
      expect(AUDIO_PRESETS.length).toBeGreaterThan(0)
    })

    it('registerAudio throws on invalid target', () => {
      expect(() => registerAudio(null)).toThrow('kuinetic: registerAudioSource requires a Registry or Animator instance')
    })

    it('registerAdvanced registers audio along with all advanced modules', () => {
      const reg = new Registry()
      registerAdvanced(reg)
      expect(reg.resolve('audio-source')).toBeDefined()
      expect(reg.resolve('shaders')).toBeDefined()
      expect(reg.resolve('scene')).toBeDefined()
      expect(reg.resolve('camera-scene')).toBeDefined()
      expect(reg.resolve('particle-dissolve')).toBeDefined()
      expect(reg.resolve('fluid-trail')).toBeDefined()
    })
  })
})
