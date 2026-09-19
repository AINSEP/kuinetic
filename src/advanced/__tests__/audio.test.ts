import { describe, expect, it, vi, beforeEach } from 'vitest'
import { Registry } from '../../core/registry.js'
import { Animator } from '../../core/animator.js'
import {
  AudioSourceController,
  computeFrequencyBands,
  parseAudioBand,
  prepareAudioSource,
  readAudioBand,
  registerAudio,
  AUDIO_BANDS,
  AUDIO_BAND_PROPERTIES,
  AUDIO_CHANNELS,
  AUDIO_PARAMETERS,
  AUDIO_PRIMITIVES,
  AUDIO_PRESETS,
  snapFftSize,
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

    it('a band with no bins under it reads 0 rather than NaN', () => {
      // An 8kHz voice stream — a phone call, a speech codec — has a nyquist of 4000Hz, so the
      // treble band (4000..16000Hz) starts at the first bin past the end of the data and has
      // nothing at all to average. `sum / (count * 255)` is 0/0 there, and `NaN.toFixed(3)` is the
      // string `"NaN"`: every `calc()` and every colour reading `var(--kui-audio-treble)` would
      // become invalid at parse time, so the consumer does not fall back — it stops rendering.
      const data = new Uint8Array(128)
      data.fill(200)
      const bands = computeFrequencyBands(data, 8000)

      expect(bands.treble).toBe(0)
      expect(Number.isNaN(bands.treble)).toBe(false)
      // The bands that do have bins are unaffected: this is an absent band, not a broken reading.
      expect(bands.bass).toBeCloseTo(200 / 255)
      expect(bands.mid).toBeCloseTo(200 / 255)
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

    it('initializes audio with media element, writes CSS vars on frame, and restores on destroy', async () => {
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

      // This context starts suspended, so the loop waits for the resume rather than spinning at
      // 60fps over an analyser that can only report zeros.
      expect(rafCb).toBeNull()
      await Promise.resolve()

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
      // This instance's own edges go: the source is cut from *this* analyser, and the analyser is
      // cut from the muted sink. The context is not closed — see the media-element cases below.
      expect(mockSourceNode.disconnect).toHaveBeenCalledWith(mockAnalyser)
      expect(mockAnalyser.disconnect).toHaveBeenCalled()
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

    it('a microphone effect on an insecure page asks for nothing', () => {
      const container = document.createElement('div')
      // `navigator.mediaDevices` is undefined outside a secure context — every plain http:// page,
      // which is exactly where an author is most likely to first try `audio-mic`. There is no
      // prompt to raise and no stream to wait for, so the effect runs as a silent driver.
      const fakeWin = {
        AudioContext: vi.fn().mockImplementation(() => mockAudioCtx),
        navigator: {},
      } as unknown as Window

      const ctrl = new AudioSourceController(container, { source: 'mic' }, { window: fakeWin, document })
      expect(() => ctrl.start()).not.toThrow()
      expect(ctrl.stream).toBeNull()
      expect(ctrl.sourceNode).toBeNull()
      // The analyser is still built and still read: nothing is feeding it, which is the same
      // thing every other silent source looks like.
      expect(ctrl.analyser).not.toBeNull()

      ctrl.destroy()
    })

    it('gracefully handles missing AudioContext and missing media elements', async () => {
      const container = document.createElement('div')
      const ctrlNoAudio = new AudioSourceController(container, {}, { window: {} as any })
      expect(ctrlNoAudio.initAudio()).toBe(false)
      ctrlNoAudio.start()
      expect(ctrlNoAudio.rafId).toBeNull()
      ctrlNoAudio.updateFrame()
      ctrlNoAudio.destroy()

      // Web Audio present, media absent: the graph is joined and the analyser built, and nothing
      // is connected to it. One silent frame says "there is a driver here"; no loop runs behind
      // it, because a loop over a disconnected analyser writes the same `0.000` at 60fps for the
      // life of the page and nothing is ever coming to change that. `running`, not the fixture's
      // `suspended`: a suspended context withholds the loop on its own, and would hide a start
      // that ignored the missing source.
      mockAudioCtx.state = 'running'
      const fakeWin = { AudioContext: vi.fn().mockImplementation(() => mockAudioCtx), HTMLMediaElement: window.HTMLMediaElement } as unknown as Window
      const raf = vi.fn(() => 5)
      const noMedia = document.createElement('div')
      const ctrlNoMedia = new AudioSourceController(noMedia, { source: 'media' }, { window: fakeWin, document, raf, caf: vi.fn() })
      ctrlNoMedia.start()
      expect(ctrlNoMedia.isActive).toBe(true)
      expect(ctrlNoMedia.analyser).not.toBeNull()
      expect(ctrlNoMedia.sourceNode).toBeNull()
      // Exactly one frame was written through the analyser. This fixture's analyser reports 100 in
      // every bin whatever is connected to it, so the frame reads 100/255 — a real context would
      // say `0.000` here, and `faithfulContext` below is the double that says so.
      expect(noMedia.style.getPropertyValue('--kui-audio-level')).toBe((100 / 255).toFixed(3))
      expect(raf).not.toHaveBeenCalled()
      expect(ctrlNoMedia.rafId).toBeNull()
      ctrlNoMedia.destroy()

      // And the resume path reaches the same answer: a context that wakes up over an element with
      // no media has nothing more to read than it had asleep.
      mockAudioCtx.state = 'suspended'
      const rafAsleep = vi.fn(() => 6)
      const noMediaAsleep = document.createElement('div')
      const ctrlAsleep = new AudioSourceController(noMediaAsleep, { source: 'media' }, { window: fakeWin, document, raf: rafAsleep, caf: vi.fn() })
      ctrlAsleep.start()
      await Promise.resolve()
      expect(mockAudioCtx.resume).toHaveBeenCalled()
      expect(rafAsleep).not.toHaveBeenCalled()
      ctrlAsleep.destroy()
    })

    it('a microphone still being asked for, or refused, runs no loop; one granted starts it', async () => {
      mockAudioCtx.state = 'running'
      const container = document.createElement('div')
      let grant: ((stream: unknown) => void) | null = null
      let refuse: ((reason: unknown) => void) | null = null
      const fakeWin = {
        AudioContext: vi.fn().mockImplementation(() => mockAudioCtx),
        navigator: { mediaDevices: { getUserMedia: vi.fn(() => new Promise((resolve, reject) => { grant = resolve; refuse = reject })) } },
      } as unknown as Window

      // The prompt is open. `initAudio()` has already answered `true` — the analyser exists — and
      // that answer used to be enough to start the loop over a source that was not there yet.
      const raf = vi.fn(() => 5)
      const ctrl = new AudioSourceController(container, { source: 'mic' }, { window: fakeWin, document, raf, caf: vi.fn() })
      ctrl.start()
      expect(ctrl.isActive).toBe(true)
      expect(ctrl.sourceNode).toBeNull()
      // One frame, through this fixture's always-100 analyser (see the missing-media case above).
      expect(container.style.getPropertyValue('--kui-audio-level')).toBe((100 / 255).toFixed(3))
      expect(raf).not.toHaveBeenCalled()

      // Granted: the stream is what the loop was waiting for, and it starts exactly once.
      grant!({ getTracks: () => [] })
      await Promise.resolve()
      expect(ctrl.sourceNode).not.toBeNull()
      expect(raf).toHaveBeenCalledTimes(1)
      ctrl.destroy()

      // Refused: nothing arrives, so nothing starts, and the visitor's answer is not retried.
      const rafRefused = vi.fn(() => 6)
      const ctrlRefused = new AudioSourceController(container, { source: 'mic' }, { window: fakeWin, document, raf: rafRefused, caf: vi.fn() })
      ctrlRefused.start()
      refuse!(new DOMException('denied', 'NotAllowedError'))
      await Promise.resolve()
      await Promise.resolve()
      expect(ctrlRefused.sourceNode).toBeNull()
      expect(rafRefused).not.toHaveBeenCalled()
      expect(ctrlRefused.rafId).toBeNull()
      ctrlRefused.destroy()
    })

    it('a microphone granted while the context is still suspended leaves the loop to the resume', async () => {
      // The visitor answers the browser's prompt — which is not a gesture on the page — before any
      // gesture has resumed the context. The stream is connected, and the loop still waits: started
      // here, it would spin over a suspended analyser's zeros until a gesture that may never come.
      const container = document.createElement('div')
      let settleResume: (() => void) | null = null
      mockAudioCtx.resume = vi.fn(() => new Promise<void>((resolve) => { settleResume = resolve }))
      const fakeWin = {
        AudioContext: vi.fn().mockImplementation(() => mockAudioCtx),
        navigator: { mediaDevices: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [] }) } },
      } as unknown as Window
      const raf = vi.fn(() => 7)
      const ctrl = new AudioSourceController(container, { source: 'mic' }, { window: fakeWin, document, raf, caf: vi.fn() })
      ctrl.start()
      await Promise.resolve()
      expect(ctrl.sourceNode).not.toBeNull()
      expect(raf).not.toHaveBeenCalled()

      // The resume lands with the stream already connected, and that is what starts the loop.
      mockAudioCtx.state = 'running'
      settleResume!()
      await Promise.resolve()
      expect(raf).toHaveBeenCalledTimes(1)
      ctrl.destroy()
    })
  })

  /**
   * The media-element half of the lifecycle, against a context double that keeps the two rules the
   * real API keeps: `createMediaElementSource` re-routes the element's output irreversibly, and it
   * may be called once per element ever.
   *
   * The previous double returned a fresh node on every call and never threw, which is precisely
   * why the worst bug in this module was invisible to the suite: cancelling closed the context that
   * the visitor's own `<video>` now played through, and re-activating threw `InvalidStateError`
   * into a swallowing `catch`, after which the effect wrote `0.000` for the rest of the session.
   */
  describe('the page keeps its own sound', () => {
    function faithfulContext() {
      const attached = new Set<unknown>()
      const ctx: any = {
        state: 'running',
        sampleRate: 44100,
        destination: { id: 'destination' },
        createGain: vi.fn(() => ({ gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() })),
        createAnalyser: vi.fn(() => ({
          fftSize: 256,
          frequencyBinCount: 128,
          smoothingTimeConstant: 0.8,
          // A suspended context is not processing anything, so its analyser hands back zeros. The
          // double used to report a live signal in either state, which is exactly the lie that
          // makes "we started a frame loop over a context that cannot produce data" invisible.
          getByteFrequencyData: vi.fn((arr: Uint8Array) => { arr.fill(ctx.state === 'suspended' ? 0 : 100) }),
          connect: vi.fn(),
          disconnect: vi.fn(),
        })),
        createMediaElementSource: vi.fn((el: unknown) => {
          if (attached.has(el)) throw new DOMException('one source per element', 'InvalidStateError')
          attached.add(el)
          return { connect: vi.fn(), disconnect: vi.fn() }
        }),
        createMediaStreamSource: vi.fn(() => ({ connect: vi.fn(), disconnect: vi.fn() })),
        resume: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
      }
      const win = {
        AudioContext: vi.fn().mockImplementation(() => ctx),
        HTMLMediaElement: window.HTMLMediaElement,
      } as unknown as Window
      return {
        ctx,
        env: { window: win, document, raf: () => null, caf: () => null },
      }
    }

    function hostWithVideo() {
      const host = document.createElement('div')
      host.appendChild(document.createElement('video'))
      return host
    }

    const levelOf = (el: HTMLElement) => Number(el.style.getPropertyValue('--kui-audio-level'))

    it('survives cancel and re-activation with the bands live and the context open', () => {
      const host = hostWithVideo()
      const { ctx, env } = faithfulContext()
      const ctrl = new AudioSourceController(host, { source: 'media' }, env)

      ctrl.start()
      ctrl.updateFrame()
      expect(levelOf(host)).toBeGreaterThan(0)

      ctrl.stop()
      expect(ctx.close).not.toHaveBeenCalled()

      ctrl.start()
      // The shared node is reused, so this never reaches the second-call throw.
      expect(ctx.createMediaElementSource).toHaveBeenCalledTimes(1)
      ctrl.updateFrame()
      expect(levelOf(host)).toBeGreaterThan(0)

      ctrl.destroy()
      expect(ctx.close).not.toHaveBeenCalled()
    })

    it('two effects on one media element both read it, and the first teardown kills neither', () => {
      const host = hostWithVideo()
      const { ctx, env } = faithfulContext()
      const first = new AudioSourceController(host, { source: 'media' }, env)
      const second = new AudioSourceController(host, { source: 'media' }, env)

      first.start()
      second.start()
      expect(ctx.createMediaElementSource).toHaveBeenCalledTimes(1)

      first.updateFrame()
      expect(levelOf(host)).toBeGreaterThan(0)

      first.destroy()
      expect(ctx.close).not.toHaveBeenCalled()
      second.updateFrame()
      expect(levelOf(host)).toBeGreaterThan(0)
      second.destroy()
    })

    it('cancel holds the last frame\'s value; destroy is what gives the author theirs back', () => {
      const host = hostWithVideo()
      const { env } = faithfulContext()
      const ctrl = new AudioSourceController(host, { source: 'media' }, env)

      host.style.setProperty('--kui-audio-level', '0.5')
      ctrl.start()
      ctrl.updateFrame()
      const held = host.style.getPropertyValue('--kui-audio-level')
      expect(held).not.toBe('0.5')

      // `cancel` is "stop where it is": a rule reading `var(--kui-audio-level, 0)` must not snap
      // to its fallback because the effect paused.
      ctrl.stop()
      expect(host.style.getPropertyValue('--kui-audio-level')).toBe(held)

      ctrl.destroy()
      expect(host.style.getPropertyValue('--kui-audio-level')).toBe('0.5')
    })

    it('a microphone-only graph is closed on release, because no page audio runs through it', async () => {
      const host = document.createElement('div')
      const { ctx, env } = faithfulContext()
      const track = { stop: vi.fn() }
      const win = env.window as unknown as { navigator: unknown }
      win.navigator = { mediaDevices: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [track] }) } }

      const ctrl = new AudioSourceController(host, { source: 'mic' }, env)
      ctrl.start()
      await Promise.resolve()
      expect(ctx.createMediaStreamSource).toHaveBeenCalled()

      ctrl.stop()
      expect(track.stop).toHaveBeenCalled()
      expect(ctx.close).toHaveBeenCalled()
      ctrl.destroy()
    })

    it('an analyser that refuses to be built leaves no half-initialised instance behind', () => {
      const host = hostWithVideo()
      const { ctx, env } = faithfulContext()
      ctx.createAnalyser = vi.fn(() => { throw new DOMException('bad fftSize', 'IndexSizeError') })
      const ctrl = new AudioSourceController(host, { source: 'media' }, env)

      expect(ctrl.initAudio()).toBe(false)
      // Not an open context with no analyser behind it, writing 0.000 every frame forever.
      expect(ctrl.audioCtx).toBeNull()
      expect(ctrl.analyser).toBeNull()
      expect(ctx.close).toHaveBeenCalled()
    })

    it('snaps fft to a legal power of two instead of throwing IndexSizeError', () => {
      expect(snapFftSize(300)).toBe(256)
      expect(snapFftSize(700)).toBe(512)
      expect(snapFftSize(1500)).toBe(1024)
      expect(snapFftSize(32)).toBe(32)
      expect(snapFftSize(2048)).toBe(2048)
    })

    it('a context suspended by autoplay policy resumes on the visitor\'s first gesture', () => {
      const host = hostWithVideo()
      const { ctx, env } = faithfulContext()
      ctx.state = 'suspended'
      const listeners = new Map<string, EventListener>()
      const win = env.window as unknown as Record<string, unknown>
      win.addEventListener = vi.fn((type: string, fn: EventListener) => { listeners.set(type, fn) })
      win.removeEventListener = vi.fn((type: string) => { listeners.delete(type) })

      const ctrl = new AudioSourceController(host, { source: 'media' }, env)
      ctrl.start()
      // The immediate attempt is made, but outside a gesture WebKit refuses or defers it, and
      // there was no retry anywhere in the module — so `on:load` reactivity was all zeros.
      expect(ctx.resume).toHaveBeenCalledTimes(1)
      expect(listeners.has('pointerdown')).toBe(true)

      listeners.get('pointerdown')!(new Event('pointerdown'))
      expect(ctx.resume).toHaveBeenCalledTimes(2)
      // One-shot: the listeners come straight back off.
      expect(listeners.size).toBe(0)

      ctrl.destroy()
    })

    it('an unchanged frame writes nothing, and an author write is never skipped', () => {
      const host = hostWithVideo()
      const { env } = faithfulContext()
      const ctrl = new AudioSourceController(host, { source: 'media' }, env)
      ctrl.start()
      ctrl.updateFrame()
      const settled = host.style.getPropertyValue('--kui-audio-level')

      const setProperty = vi.spyOn(host.style, 'setProperty')
      ctrl.updateFrame()
      // Steady or silent audio: five inherited custom properties are not re-dirtied per frame.
      expect(setProperty).not.toHaveBeenCalled()

      // The author takes the property over mid-effect. The next frame has to win it back rather
      // than agree with a remembered value of its own and look dead.
      host.style.setProperty('--kui-audio-level', '0.9')
      setProperty.mockClear()
      ctrl.updateFrame()
      expect(host.style.getPropertyValue('--kui-audio-level')).toBe(settled)

      setProperty.mockRestore()
      ctrl.destroy()
    })

    it('a controller with no window builds no graph, and no loop behind it either', () => {
      const host = hostWithVideo()
      const raf = vi.fn(() => 5)
      // Server-rendered, or a worker: `resolveEnv` hands back a null window and there is no
      // `AudioContext` constructor to reach for in the first place.
      const ctrl = new AudioSourceController(host, { source: 'media' }, { window: null, document, raf, caf: vi.fn() })

      expect(ctrl.initAudio()).toBe(false)
      ctrl.start()

      // One frame of silence, and nothing scheduled behind it. `initAudio` is only ever called
      // from `start()`, and `start()` early-returns once active, so there is no retry this loop
      // could have been waiting for — it would have sampled nothing at 60fps for the life of the
      // page and never recovered.
      expect(raf).not.toHaveBeenCalled()
      expect(ctrl.rafId).toBeNull()
      expect(host.style.getPropertyValue('--kui-audio-level')).toBe('0.000')

      ctrl.destroy()
      expect(host.hasAttribute('style')).toBe(false)
    })

    it('a suspended context writes one silent frame and leaves the loop to the gesture', async () => {
      const host = hostWithVideo()
      const { ctx, env } = faithfulContext()
      ctx.state = 'suspended'
      // WebKit outside a user gesture: the promise is simply never settled.
      ctx.resume = vi.fn(() => new Promise<void>(() => {}))
      const listeners = new Map<string, EventListener>()
      const win = env.window as unknown as Record<string, unknown>
      win.addEventListener = vi.fn((type: string, fn: EventListener) => { listeners.set(type, fn) })
      win.removeEventListener = vi.fn((type: string) => { listeners.delete(type) })
      const raf = vi.fn(() => 9)

      const ctrl = new AudioSourceController(host, { source: 'media' }, { ...env, raf, caf: vi.fn() })
      ctrl.start()

      // `defaultActivation` is `load`, so this is the ordinary case rather than an edge one: the
      // context is built before the visitor has touched anything. And the three gesture events are
      // `pointerdown`/`keydown`/`touchend` — a reader who only ever scrolls with a wheel fires
      // none of them, so "until the gesture arrives" is otherwise the whole session at 60fps over
      // an analyser that can report nothing but zeros.
      expect(raf).not.toHaveBeenCalled()
      expect(host.style.getPropertyValue('--kui-audio-level')).toBe('0.000')
      expect(listeners.size).toBe(3)

      // The gesture lands and its resume succeeds, and starting the loop is that resume's job.
      ctx.resume = vi.fn(() => Promise.resolve())
      listeners.get('pointerdown')!(new Event('pointerdown'))
      await Promise.resolve()
      expect(raf).toHaveBeenCalledTimes(1)

      ctrl.destroy()
    })

    it('a resume that lands after the effect was cancelled starts no loop', async () => {
      const host = hostWithVideo()
      const { ctx, env } = faithfulContext()
      ctx.state = 'suspended'
      let settle: (() => void) | null = null
      ctx.resume = vi.fn(() => new Promise<void>((resolve) => { settle = () => resolve() }))
      const raf = vi.fn(() => 9)

      const ctrl = new AudioSourceController(host, { source: 'media' }, { ...env, raf, caf: vi.fn() })
      ctrl.start()
      expect(raf).not.toHaveBeenCalled()

      // The effect scrolled back out, or the page tore down, while the context was still waking.
      ctrl.stop()
      expect(settle).not.toBeNull()
      settle!()
      await Promise.resolve()
      await Promise.resolve()

      // The same race `micRequestToken` closes for `getUserMedia`, with the same consequence if it
      // were left open: a frame loop running on a stopped instance, with nothing left to stop it.
      expect(raf).not.toHaveBeenCalled()
      expect(ctrl.rafId).toBeNull()

      ctrl.destroy()
    })

    it('an AudioContext the browser refuses to build leaves no half-initialised instance', () => {
      const host = hostWithVideo()
      // Chrome caps a document at six live AudioContexts and throws on the next one; WebKit throws
      // when the audio hardware is unavailable. Either way the constructor is the thing that fails,
      // before there is any context to clean up.
      const win = {
        AudioContext: vi.fn(() => { throw new DOMException('too many contexts', 'NotSupportedError') }),
        HTMLMediaElement: window.HTMLMediaElement,
      } as unknown as Window

      const ctrl = new AudioSourceController(host, { source: 'media' }, { window: win, document })
      expect(ctrl.initAudio()).toBe(false)
      expect(ctrl.audioCtx).toBeNull()
      expect(ctrl.analyser).toBeNull()
    })

    it('a context that cannot build the muted sink still runs the analyser', () => {
      const host = hostWithVideo()
      const { ctx, env } = faithfulContext()
      ctx.createGain = vi.fn(() => { throw new DOMException('closing', 'InvalidStateError') })

      const ctrl = new AudioSourceController(host, { source: 'media' }, env)
      expect(ctrl.initAudio()).toBe(true)
      // No sink to chain onto, so the analyser is left a dead end rather than the whole effect
      // refusing to start. It loses only WebKit's guarantee of being pulled, not its readings.
      const analyser = ctrl.analyser as unknown as { connect: ReturnType<typeof vi.fn> }
      expect(analyser.connect).not.toHaveBeenCalled()

      ctrl.updateFrame()
      expect(Number(host.style.getPropertyValue('--kui-audio-level'))).toBeGreaterThan(0)
      ctrl.destroy()
    })

    it('a second start adds no second context, analyser or frame loop', () => {
      const host = hostWithVideo()
      const { ctx, env } = faithfulContext()
      const raf = vi.fn(() => 5)
      const ctrl = new AudioSourceController(host, { source: 'media' }, { ...env, raf, caf: vi.fn() })

      ctrl.start()
      // `on:enter` re-fires on every re-entry. Two analysers on one element would both write the
      // same five inherited custom properties every frame, last one wins.
      ctrl.start()
      expect(ctx.createAnalyser).toHaveBeenCalledTimes(1)
      expect(raf).toHaveBeenCalledTimes(1)

      // The same answer from each of the two re-entry paths on its own.
      expect(ctrl.initAudio()).toBe(true)
      expect(ctx.createAnalyser).toHaveBeenCalledTimes(1)
      ctrl.startLoop()
      expect(raf).toHaveBeenCalledTimes(1)

      ctrl.destroy()
    })

    it('a frame already in flight when the effect stops does not restart the loop', () => {
      const host = hostWithVideo()
      const { env } = faithfulContext()
      let tick: FrameRequestCallback | null = null
      const raf = vi.fn((fn: FrameRequestCallback) => { tick = fn; return 5 })
      const ctrl = new AudioSourceController(host, { source: 'media' }, { ...env, raf, caf: vi.fn() })

      ctrl.start()
      expect(tick).not.toBeNull()
      tick!(0)
      expect(raf).toHaveBeenCalledTimes(2)

      ctrl.stop()
      // `cancelAnimationFrame` cannot recall a callback the browser has already committed to this
      // frame, so the loop has to notice for itself that it was cancelled — otherwise a stopped
      // effect keeps re-arming and runs for the life of the page.
      tick!(16)
      expect(raf).toHaveBeenCalledTimes(2)
      expect(ctrl.rafId).toBeNull()

      ctrl.destroy()
    })

    it('an element that cannot carry inline style is written nothing', () => {
      const ctrl = new AudioSourceController({} as HTMLElement, { source: 'media' }, { window: null })
      expect(() => ctrl.updateFrame()).not.toThrow()
      expect(() => ctrl.destroy()).not.toThrow()
    })

    it('a stop before the visitor\'s first gesture takes the page-wide listeners back off', () => {
      const host = hostWithVideo()
      const { ctx, env } = faithfulContext()
      ctx.state = 'suspended'
      const listeners = new Map<string, EventListener>()
      const win = env.window as unknown as Record<string, unknown>
      win.addEventListener = vi.fn((type: string, fn: EventListener) => { listeners.set(type, fn) })
      win.removeEventListener = vi.fn((type: string) => { listeners.delete(type) })

      const ctrl = new AudioSourceController(host, { source: 'media' }, env)
      ctrl.start()
      expect(listeners.size).toBe(3)

      // The other half of the one-shot: the visitor never touched the page, the effect scrolled
      // back out, and three listeners on the window must not outlive it.
      ctrl.stop()
      expect(listeners.size).toBe(0)
      ctrl.destroy()
    })

    it('teardown survives nodes that refuse to be disconnected, and still gives the styles back', () => {
      const host = hostWithVideo()
      host.style.setProperty('--kui-audio-level', '0.5')
      const { ctx, env } = faithfulContext()
      // Web Audio throws `InvalidAccessError` for an edge that is not there, which is what a graph
      // the page has already torn down looks like from here.
      const refuse = () => { throw new DOMException('not connected', 'InvalidAccessError') }
      ctx.createAnalyser = vi.fn(() => ({
        fftSize: 256,
        frequencyBinCount: 128,
        smoothingTimeConstant: 0.8,
        getByteFrequencyData: vi.fn((arr: Uint8Array) => { arr.fill(100) }),
        connect: vi.fn(),
        disconnect: vi.fn(refuse),
      }))
      ctx.createMediaElementSource = vi.fn(() => ({ connect: vi.fn(), disconnect: vi.fn(refuse) }))

      const ctrl = new AudioSourceController(host, { source: 'media' }, env)
      ctrl.start()
      ctrl.updateFrame()

      expect(() => ctrl.destroy()).not.toThrow()
      // The author's own value, not the last frame's: a throw on the way out must not cost them it.
      expect(host.style.getPropertyValue('--kui-audio-level')).toBe('0.5')
    })

    it('a torn-down analyser never turns into a full disconnect of the shared media source', () => {
      const host = hostWithVideo()
      const { env } = faithfulContext()
      const ctrl = new AudioSourceController(host, { source: 'media' }, env)
      ctrl.start()
      const source = ctrl.sourceNode as unknown as { disconnect: ReturnType<typeof vi.fn> }

      // The analyser is gone but the shared source is not. A bare `disconnect()` here cuts *every*
      // one of that node's outputs, including the media element's only remaining path to the
      // speakers — the visitor's video goes silent for the rest of the session, irreversibly. So
      // with no edge to name, the right number of edges to cut is none.
      ctrl.analyser = null
      ctrl.stop()
      expect(source.disconnect).not.toHaveBeenCalled()

      ctrl.destroy()
    })
  })

  describe('which media element an effect binds to', () => {
    function contextDouble() {
      const ctx: any = {
        state: 'running',
        sampleRate: 44100,
        destination: {},
        createGain: vi.fn(() => ({ gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() })),
        createAnalyser: vi.fn(() => ({
          fftSize: 256,
          frequencyBinCount: 128,
          smoothingTimeConstant: 0.8,
          getByteFrequencyData: vi.fn(),
          connect: vi.fn(),
          disconnect: vi.fn(),
        })),
        createMediaElementSource: vi.fn(() => ({ connect: vi.fn(), disconnect: vi.fn() })),
        resume: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
      }
      return ctx
    }

    function envFor(ctx: any, withMediaCtor = true) {
      const win: Record<string, unknown> = { AudioContext: vi.fn().mockImplementation(() => ctx) }
      if (withMediaCtor) win.HTMLMediaElement = window.HTMLMediaElement
      return { window: win as unknown as Window, document, raf: () => null, caf: () => null }
    }

    it('the default selector never reaches outside the element\'s own subtree', () => {
      const stray = document.createElement('video')
      const host = document.createElement('div')
      document.body.append(stray, host)
      const ctx = contextDouble()

      const ctrl = new AudioSourceController(host, { source: 'media' }, envFor(ctx))
      ctrl.start()
      // An element containing no media used to bind to the first media element anywhere in the
      // document — a hero card reacting to a footer video nobody had played.
      expect(ctx.createMediaElementSource).not.toHaveBeenCalled()

      ctrl.destroy()
      host.remove()
      stray.remove()
    })

    it('an authored selector may still name an element elsewhere in the document', () => {
      const hero = document.createElement('video')
      hero.id = 'hero-media'
      const host = document.createElement('div')
      document.body.append(hero, host)
      const ctx = contextDouble()

      const ctrl = new AudioSourceController(host, { source: 'media', target: '#hero-media' }, envFor(ctx))
      ctrl.start()
      expect(ctx.createMediaElementSource).toHaveBeenCalledWith(hero)

      ctrl.destroy()
      host.remove()
      hero.remove()
    })

    it('a plain element is not its own media source, even with no HTMLMediaElement on the window', () => {
      const host = document.createElement('div')
      const ctx = contextDouble()

      const ctrl = new AudioSourceController(host, { source: 'media' }, envFor(ctx, false))
      ctrl.start()
      // `el instanceof (win.HTMLMediaElement ?? Object)` was true for every element.
      expect(ctx.createMediaElementSource).not.toHaveBeenCalled()

      ctrl.destroy()
    })

    it('a media element carrying the effect itself is its own source', () => {
      // `<video data-kui="audio-reactive">` — the shortest way to write this effect, and the one
      // the search has to answer before it looks at any descendant or any selector.
      const video = document.createElement('video')
      const ctx = contextDouble()

      const ctrl = new AudioSourceController(video, { source: 'media' }, envFor(ctx))
      ctrl.start()
      expect(ctx.createMediaElementSource).toHaveBeenCalledWith(video)

      ctrl.destroy()
    })

    it('an authored selector that matches nothing binds to nothing', () => {
      const host = document.createElement('div')
      document.body.append(host)
      const ctx = contextDouble()

      const ctrl = new AudioSourceController(host, { source: 'media', target: '#no-such-media' }, envFor(ctx))
      ctrl.start()
      // A typo in `target:` is silence, not a fallback to whatever media the document happens to
      // hold — the same rule the default selector follows one test above.
      expect(ctx.createMediaElementSource).not.toHaveBeenCalled()

      ctrl.destroy()
      host.remove()
    })

    it('a malformed target selector is survived rather than thrown out of', () => {
      const host = document.createElement('div')
      const ctx = contextDouble()

      // `querySelector` throws `SyntaxError` on this, and the throw happens during `activate()` —
      // inside the animator, on the author's page. One unbalanced bracket in a `data-kui`
      // attribute must cost that effect its audio, not the whole activation pass.
      const ctrl = new AudioSourceController(host, { source: 'media', target: 'video[' }, envFor(ctx))
      expect(() => ctrl.start()).not.toThrow()
      expect(ctx.createMediaElementSource).not.toHaveBeenCalled()

      ctrl.destroy()
    })

    it('with no HTMLMediaElement in the environment at all, nothing is treated as media', () => {
      // A document built outside a browser — jsdom-less SSR, a worker — has no such constructor to
      // test against. The check answers "no" rather than guessing, because the previous `?? Object`
      // guessed "yes" and handed a plain `<div>` to `createMediaElementSource`.
      vi.stubGlobal('HTMLMediaElement', undefined)
      try {
        const video = document.createElement('video')
        const ctx = contextDouble()

        const ctrl = new AudioSourceController(video, { source: 'media' }, envFor(ctx, false))
        ctrl.start()
        expect(ctx.createMediaElementSource).not.toHaveBeenCalled()
        ctrl.destroy()
      } finally {
        vi.unstubAllGlobals()
      }
    })

    it('a context with no createMediaElementSource leaves the bands silent instead of throwing', () => {
      const host = document.createElement('div')
      host.appendChild(document.createElement('video'))
      const ctx = contextDouble()
      delete ctx.createMediaElementSource

      const ctrl = new AudioSourceController(host, { source: 'media' }, envFor(ctx))
      expect(() => ctrl.start()).not.toThrow()
      ctrl.updateFrame()
      // Silence reads exactly as "no driver here" does — see `readAudioBand`'s 0.
      expect(host.style.getPropertyValue('--kui-audio-level')).toBe('0.000')

      ctrl.destroy()
    })

    it('a media element another script already routed is given up on, not crashed on', () => {
      const host = document.createElement('div')
      host.appendChild(document.createElement('video'))
      const ctx = contextDouble()
      // `createMediaElementSource` may be called once per element *ever*, across every context on
      // the page. If the site's own player claimed this `<video>` first, kUInetic's call throws
      // `InvalidStateError` and there is no way back — so the effect goes quiet and the page,
      // whose audio still runs through the other library's graph, keeps playing.
      ctx.createMediaElementSource = vi.fn(() => {
        throw new DOMException('one source per element', 'InvalidStateError')
      })

      const ctrl = new AudioSourceController(host, { source: 'media' }, envFor(ctx))
      expect(() => ctrl.start()).not.toThrow()
      ctrl.updateFrame()
      expect(host.style.getPropertyValue('--kui-audio-level')).toBe('0.000')

      ctrl.destroy()
    })
  })

  describe('prepareAudioSource and Registry Integration', () => {
    /** The smallest context that will let a controller reach the end of `initAudio`. */
    function audioContextDouble() {
      return {
        state: 'running',
        sampleRate: 44100,
        destination: {},
        createAnalyser: () => ({
          fftSize: 256,
          frequencyBinCount: 128,
          smoothingTimeConstant: 0.8,
          getByteFrequencyData: () => {},
          connect: () => {},
          disconnect: () => {},
        }),
        createMediaElementSource: vi.fn(() => ({ connect: () => {}, disconnect: () => {} })),
        resume: () => Promise.resolve(),
        close: () => Promise.resolve(),
      }
    }

    it('an accessor with no readers at all falls back to page media, never to the microphone', () => {
      const host = document.createElement('div')
      host.appendChild(document.createElement('video'))
      const ctx = audioContextDouble()
      const getUserMedia = vi.fn()
      const win = {
        AudioContext: vi.fn().mockImplementation(() => ctx),
        HTMLMediaElement: window.HTMLMediaElement,
        navigator: { mediaDevices: { getUserMedia } },
      } as unknown as Window

      // `{}` is what a caller with neither `text` nor `num` looks like, and every parameter here
      // has to come from its own literal default instead.
      const inst = prepareAudioSource(host, {} as EffectParams, createRealPrepareContext(host, { reducedMotion: false, win }))
      expect(inst.continuous).toBe(true)
      inst.activate()

      // `source` defaults to `media`. Of the four defaults this is the one with a permission
      // prompt behind it, so an accessor that answers nothing must not reach for the microphone.
      expect(getUserMedia).not.toHaveBeenCalled()
      expect(ctx.createMediaElementSource).toHaveBeenCalledOnce()

      inst.destroy()
    })

    it('under reduced motion the effect is fully inert: no context, no listeners, no writes', () => {
      const host = document.createElement('div')
      host.appendChild(document.createElement('video'))
      const AudioContextCtor = vi.fn()
      const addEventListener = vi.fn()
      const win = {
        AudioContext: AudioContextCtor,
        addEventListener,
        removeEventListener: vi.fn(),
        HTMLMediaElement: window.HTMLMediaElement,
      } as unknown as Window
      const params = {
        text: (_k: string, d: string) => d,
        num: (_k: string, d: number) => d,
      } as unknown as EffectParams

      const inst = prepareAudioSource(host, params, createRealPrepareContext(host, { reducedMotion: true, win }))
      inst.activate()
      inst.finish()

      // Deliberately *not* a still frame, unlike the rest of this tier. Five channels of `0.000` is
      // already what their absence means to `readAudioBand`, so writing them would buy nothing and
      // would override an author's own inline `--kui-audio-*`. Inertness here is the whole
      // behaviour, not an omission: no AudioContext, no frame loop, and no page-wide gesture
      // listeners for a visitor who asked for less.
      expect(AudioContextCtor).not.toHaveBeenCalled()
      expect(addEventListener).not.toHaveBeenCalled()
      expect(host.hasAttribute('style')).toBe(false)

      inst.destroy()
      expect(host.hasAttribute('style')).toBe(false)
    })

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
      // Declared exactly as every other primitive that names another element declares it, down to
      // the shared `--kui-target`. It is also load-bearing: `compile.ts`'s `liftTarget` relocates
      // the whole effect onto the match for any primitive that does *not* declare this key, which
      // would silently move the analyser onto the `<audio>` element itself.
      expect(AUDIO_PARAMETERS.target).toEqual({ type: 'text', default: '', cssProperty: '--kui-target' })
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

  describe('The band contract a consumer reads', () => {
    it('only ever names properties the driver actually writes', () => {
      for (const prop of Object.values(AUDIO_BAND_PROPERTIES)) {
        expect(AUDIO_CHANNELS).toContain(prop)
      }
      // `--kui-audio` is the one channel deliberately absent: it is a second spelling of `level`,
      // not a fifth band.
      expect(Object.values(AUDIO_BAND_PROPERTIES)).not.toContain('--kui-audio')
      expect(AUDIO_BANDS).toEqual(['bass', 'mid', 'treble', 'level'])
    })

    it('parses a band name and refuses everything else', () => {
      expect(parseAudioBand('bass')).toBe('bass')
      expect(parseAudioBand(' treble ')).toBe('treble')
      expect(parseAudioBand('off')).toBeNull()
      expect(parseAudioBand('')).toBeNull()
      expect(parseAudioBand(undefined)).toBeNull()
      expect(parseAudioBand('volume')).toBeNull()
      // Inherited keys are not bands, however much they look like own properties.
      expect(parseAudioBand('__proto__')).toBeNull()
      expect(parseAudioBand('constructor')).toBeNull()
    })

    it('reads the inline value the driver wrote, clamped to 0..1', () => {
      const el = document.createElement('div')
      el.style.setProperty('--kui-audio-bass', '0.625')
      expect(readAudioBand(el, 'bass')).toBe(0.625)

      el.style.setProperty('--kui-audio-mid', '4')
      expect(readAudioBand(el, 'mid')).toBe(1)
      el.style.setProperty('--kui-audio-treble', '-3')
      expect(readAudioBand(el, 'treble')).toBe(0)
      el.style.setProperty('--kui-audio-level', 'loud')
      expect(readAudioBand(el, 'level')).toBe(0)
    })

    it('falls back to the computed value, which is how an ancestor driver reaches a consumer', () => {
      const el = document.createElement('div')
      document.body.appendChild(el)
      const computed = vi.spyOn(window, 'getComputedStyle').mockReturnValue({
        getPropertyValue: (name: string) => (name === '--kui-audio-bass' ? '0.5' : ''),
      } as unknown as CSSStyleDeclaration)

      expect(readAudioBand(el, 'bass')).toBe(0.5)
      // Nothing declared it at all: a consumer sees the same 0 a silent driver writes.
      expect(readAudioBand(el, 'treble')).toBe(0)

      // The inline value wins without consulting the computed style at all.
      computed.mockClear()
      el.style.setProperty('--kui-audio-bass', '0.25')
      expect(readAudioBand(el, 'bass')).toBe(0.25)
      expect(computed).not.toHaveBeenCalled()

      computed.mockRestore()
      el.remove()
    })
  })
})
