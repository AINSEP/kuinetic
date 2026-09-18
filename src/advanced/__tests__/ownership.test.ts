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
import { CameraController, prepareCameraScene } from '../camera-3d.js'
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

    /**
     * The `peek()` resting branch, which is the whole reason `peek()` was added and had no test at
     * all. Both halves matter, and each falsifies a different plausible wrong implementation: one
     * fails if the module fabricates an identity transform, the other if it always removes.
     */
    it('a settled camera writes no transform of its own when the author had none inline', () => {
      const stage = document.createElement('div')
      const controller = new CameraController(stage, { depth: 800, mouseTilt: true }, { window: null })

      // `start()` renders straight away with the pointer at the synthetic centre, so the tilt is
      // exactly zero — the branch an author whose transform lives in a stylesheet always hits.
      controller.start()

      // An inline `rotateX(0deg) rotateY(0deg)` here would outrank `.hero { transform: ... }` and
      // switch the author's own transform off for as long as the effect is live.
      expect(stage.style.transform).toBe('')
      // The rest of the stage setup is still there; only `transform` was handed back.
      expect(stage.style.perspective).toBe('800px')
      controller.destroy()
    })

    it('a settled camera lands back on the author\'s own inline transform after a real tilt', () => {
      const stage = document.createElement('div')
      const controller = new CameraController(stage, { depth: 800, mouseTilt: true }, { window: null })
      stage.style.transform = 'translateY(-20px)'

      controller.start()
      expect(stage.style.transform).toBe('translateY(-20px)')

      controller.onMouseMove({ clientX: 900, clientY: 700 } as MouseEvent)
      controller.stepMouse()
      controller.render()
      expect(stage.style.transform).toContain('rotateX')

      controller.mouse = { x: 0, y: 0, targetX: 0, targetY: 0 }
      controller.render()
      expect(stage.style.transform).toBe('translateY(-20px)')

      controller.destroy()
      expect(stage.style.transform).toBe('translateY(-20px)')
    })

    it('a throwing teardown still gives the author\'s styles back', () => {
      const stage = document.createElement('div')
      const layer = document.createElement('div')
      stage.appendChild(layer)

      const controller = new CameraController(stage, { depth: 800, mouseTilt: false }, {
        window: {
          innerHeight: 800,
          addEventListener: vi.fn(),
          removeEventListener: () => { throw new Error('page code replaced removeEventListener') },
        } as unknown as Window,
      })
      controller.addLayer(layer, 40)
      layer.style.setProperty('transform', 'translateZ(5px)', 'important')

      controller.start()
      expect(layer.style.transform).not.toBe('translateZ(5px)')

      // The animator swallows a throwing `instance.destroy()`, and the layer is in no ledger core
      // will ever restore — so a throw on the way out used to leave this module's transform on it
      // permanently. The throw still surfaces; the restore just is not hostage to it.
      expect(() => controller.destroy()).toThrow()
      expect(layer.style.transform).toBe('translateZ(5px)')
      expect(layer.style.getPropertyPriority('transform')).toBe('important')
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
      // `to:0.5`, not the full window, and `from:` left to default. The subject here is ledger
      // ownership, but an identity window is a silent-pass trap: with `[0, 1]` the local progress
      // equals the global one, so the assertion below held whether or not the window was read at
      // all. Half a window makes the two differ — global 0.5 is local 1 — so a `from:`/`to:` that
      // stopped being honoured fails this case instead of sailing through it.
      step.setAttribute('data-kui', 'scene-step to:0.5 opacity:0->1')
      stage.appendChild(step)

      const controller = new SceneController(stage, { progress: 'scroll' }, { window: null })
      controller.addStep(step, parseChildStep(step))

      // Preparation is over; the author now sets their own resting state.
      step.style.setProperty('opacity', '0.3', 'important')

      controller.progress = 0.5
      controller.updateAll()
      // (0.5 - 0) / (0.5 - 0) = 1, so the step is at the end of its own transition while the
      // scene is only halfway. Ignoring the window would read '0.5'.
      expect(step.style.opacity).toBe('1')

      controller.destroy()
      expect(step.style.opacity).toBe('0.3')
      expect(step.style.getPropertyPriority('opacity')).toBe('important')
    })

    it('leaves no style attribute on a step that never had one', () => {
      const stage = document.createElement('div')
      const step = document.createElement('div')
      // The other half of the window, `from:`, for the reason the case above gives — and the
      // transform assertion is an exact value rather than `toBeTruthy()`, which accepted any
      // non-empty string and so could not tell a correct translate from a wrong one.
      step.setAttribute('data-kui', 'scene-step from:0.5 opacity:0->1 y:40px->0px')
      stage.appendChild(step)

      const controller = new SceneController(stage, { progress: 'scroll' }, { window: null })
      controller.addStep(step, parseChildStep(step))
      expect(step.hasAttribute('style')).toBe(false)

      controller.progress = 0.75
      controller.updateAll()
      // (0.75 - 0.5) / (1 - 0.5) = 0.5, so y is halfway from 40px to 0px. Ignoring `from:` would
      // make the local progress 0.75 and write translateY(10px).
      expect(step.style.transform).toBe('translateY(20px)')

      controller.destroy()
      expect(step.hasAttribute('style')).toBe(false)
    })
  })

  /**
   * `setupPosition` only writes when the *computed* position is `static`, so every case here keeps
   * the stub and the inline style consistent with each other. The single case this replaced stubbed
   * `getComputedStyle` to answer `static` while the author's inline style said
   * `position: relative !important` — a combination the real CSSOM cannot produce, so in a browser
   * the early return fired and the module wrote nothing at all.
   */
  describe('particles', () => {
    const emitterFor = (host: HTMLElement, computed: string) => new ParticleEmitter(host, {}, {
      window: { getComputedStyle: () => ({ position: computed }) } as unknown as Window,
      document,
    })

    it('restores an authored position with its priority', () => {
      const host = document.createElement('div')
      // Inline and computed agree: `static` is what the author declared and what resolves.
      host.style.setProperty('position', 'static', 'important')
      const emitter = emitterFor(host, 'static')

      emitter.setupPosition()
      expect(host.style.position).toBe('relative')

      emitter.destroy()
      expect(host.style.position).toBe('static')
      expect(host.style.getPropertyPriority('position')).toBe('important')
    })

    it('leaves no position and no style attribute on a host that had neither', () => {
      const host = document.createElement('div')
      const emitter = emitterFor(host, 'static')
      expect(host.hasAttribute('style')).toBe(false)

      emitter.setupPosition()
      expect(host.style.position).toBe('relative')

      emitter.destroy()
      expect(host.style.position).toBe('')
      expect(host.hasAttribute('style')).toBe(false)
    })

    it('never touches a host that is already positioned', () => {
      const host = document.createElement('div')
      host.style.setProperty('position', 'relative', 'important')
      const emitter = emitterFor(host, 'relative')

      emitter.setupPosition()
      emitter.destroy()
      expect(host.style.position).toBe('relative')
      expect(host.style.getPropertyPriority('position')).toBe('important')
    })
  })
})

/**
 * Two owners of one element.
 *
 * The invariant above is per module; this is the one *between* modules, and it is the one a private
 * `LedgerSet` per controller cannot hold. A step or a layer can genuinely belong to two controllers
 * at once, and then the second controller's own ledger captures the first controller's frame value
 * as "the author's".
 *
 * Every case below is ordered so the second owner writes *after* the first, which is exactly what a
 * per-controller ledger cannot survive: it would restore to the first owner's library value, without
 * its priority, and leave the element pinned there with nothing running.
 *
 * Two of the three cases are now **unit-level only**, and deliberately kept that way. Each wires its
 * controllers with `addStep`/`addLayer` rather than through `prepareScene`/`prepareCameraScene`, so
 * none of them goes anywhere near the descendant scan — which is why they were untouched when
 * `ownedDescendants` (`base.ts`) taught that scan to stop at a nested host of the same kind. After
 * that fix, markup can no longer produce a scene inside a scene sharing a step, or a camera inside a
 * camera sharing a layer: `__tests__/nested-ownership.test.ts` is what asserts it cannot. Direct
 * construction still can, and so can anything else that hands two controllers the same element, and
 * the ledger has to hold either way — so these stay as what they always were, unit tests of the
 * ledger's ref-counting.
 *
 * The third — 'an element that is both a scene step and a camera layer' — is not in that category.
 * Two owners of different *kinds* is a supported authoring shape that the scan still produces, and
 * `nested-ownership.test.ts` asserts the scan's half of it from real markup.
 */
describe('two controllers writing to one element share a single capture', () => {
  it('a nested scene does not pin its parent scene\'s step to a frame value', () => {
    const outerStage = document.createElement('div')
    const innerStage = document.createElement('div')
    const step = document.createElement('div')
    // The identity window is the point here, not an oversight: the two assertions below read the
    // two controllers' `progress` values back as written, which is what makes "the second owner
    // overwrote the first" legible. A partial window would put arithmetic between the input and
    // the assertion and obscure the actual subject. The window's own coverage is in
    // `staging.test.ts`; spelled `from:0 to:1` because `at:` is no longer this module's key.
    step.setAttribute('data-kui', 'scene-step from:0 to:1 opacity:0->1')
    outerStage.appendChild(innerStage)
    innerStage.appendChild(step)

    const outer = new SceneController(outerStage, { progress: 'scroll' }, { window: null })
    const inner = new SceneController(innerStage, { progress: 'scroll' }, { window: null })
    outer.addStep(step, parseChildStep(step))
    inner.addStep(step, parseChildStep(step))

    step.style.setProperty('opacity', '0.3', 'important')

    // Document order: the outer scene is scanned first, so its write is the one that captures.
    outer.progress = 0.5
    outer.updateAll()
    expect(step.style.opacity).toBe('0.5')
    inner.progress = 0.8
    inner.updateAll()
    expect(step.style.opacity).toBe('0.8')

    // The outer scene lets go first. The inner one is still driving the step, so nothing is
    // restored yet — restoring here would hand the author's value back under a live effect.
    outer.destroy()
    expect(step.style.opacity).toBe('0.8')

    inner.destroy()
    expect(step.style.opacity).toBe('0.3')
    expect(step.style.getPropertyPriority('opacity')).toBe('important')
  })

  it('a nested camera scene does not pin its parent\'s layer transform', () => {
    const outerStage = document.createElement('div')
    const innerStage = document.createElement('div')
    const layer = document.createElement('div')
    outerStage.appendChild(innerStage)
    innerStage.appendChild(layer)

    const outer = new CameraController(outerStage, { depth: 1000, mouseTilt: false }, { window: null })
    const inner = new CameraController(innerStage, { depth: 400, mouseTilt: false }, { window: null })
    outer.addLayer(layer, 40)
    inner.addLayer(layer, 90)

    layer.style.setProperty('transform', 'translateZ(5px)', 'important')

    outer.render()
    const afterOuter = layer.style.transform
    expect(afterOuter).toContain('translate3d(0, 0, 40px)')
    inner.render()
    expect(layer.style.transform).toContain('translate3d(0, 0, 90px)')

    outer.destroy()
    expect(layer.style.transform).not.toBe('translateZ(5px)')

    inner.destroy()
    expect(layer.style.transform).toBe('translateZ(5px)')
    expect(layer.style.getPropertyPriority('transform')).toBe('important')
  })

  it('an element that is both a scene step and a camera layer survives both owners', () => {
    const sceneStage = document.createElement('div')
    const cameraStage = document.createElement('div')
    const both = document.createElement('div')
    // Identity window for the reason the case above gives — the scene's write is read back
    // directly from its `progress`. `from:0 to:1`, since `at:` is no longer this module's key.
    both.setAttribute('data-kui', 'camera-layer z:-100, scene-step from:0 to:1 y:40px->0px')
    sceneStage.appendChild(cameraStage)
    cameraStage.appendChild(both)

    const scene = new SceneController(sceneStage, { progress: 'scroll' }, { window: null })
    const camera = new CameraController(cameraStage, { depth: 1000, mouseTilt: false }, { window: null })
    scene.addStep(both, parseChildStep(both))
    camera.addLayer(both, -100)

    both.style.transform = 'rotate(3deg)'

    scene.progress = 0.5
    scene.updateAll()
    // Named exactly, and asserted here rather than only after the camera writes. The scene's
    // transform is the *first* of the two writes and the camera overwrites it wholesale, so
    // without this line nothing in the case ever checked that the scene wrote at all.
    expect(both.style.transform).toBe('translateY(20px)')

    camera.render()
    // Was `not.toBe('rotate(3deg)')` — a "something changed" check that any non-authored string
    // satisfied, including a wrong one. `cameraZ` is 0 (nothing drives it here) and the layer's
    // depth is -100, so `computeLayerTransform` gives exactly this.
    expect(both.style.transform).toBe('translate3d(0, 0, -100px)')

    scene.destroy()
    camera.destroy()
    expect(both.style.transform).toBe('rotate(3deg)')
  })

  it('two audio-source controllers on one element restore the author\'s custom property', () => {
    const host = document.createElement('div')
    host.appendChild(document.createElement('audio'))
    // One frame queue per controller. Sharing one array silently let the *first* controller's
    // rescheduled tick be shifted off in place of the second's very first one, so the second never
    // wrote at all and the case passed without ever creating a second owner.
    const env = (level: number) => {
      const { ctx, analyser } = mockAudioContext()
      analyser.getByteFrequencyData = vi.fn((arr: Uint8Array) => { arr.fill(level) })
      return {
        window: {
          AudioContext: vi.fn().mockImplementation(() => ctx),
          HTMLMediaElement: window.HTMLMediaElement,
        } as unknown as Window,
        document,
        raf: () => null,
        caf: () => null,
      }
    }

    const first = new AudioSourceController(host, { source: 'media' }, env(100))
    const second = new AudioSourceController(host, { source: 'media' }, env(200))

    host.style.setProperty('--kui-audio-level', '0.5')

    first.start()
    first.updateFrame()
    const afterFirst = host.style.getPropertyValue('--kui-audio-level')
    expect(afterFirst).not.toBe('0.5')

    second.start()
    second.updateFrame()
    // Different band data, so the second controller demonstrably wrote over the first's value —
    // which is exactly the value a private ledger would have captured as the author's.
    expect(host.style.getPropertyValue('--kui-audio-level')).not.toBe(afterFirst)

    first.destroy()
    second.destroy()
    expect(host.style.getPropertyValue('--kui-audio-level')).toBe('0.5')
  })
})

/**
 * Where `restore()` lives once the animator hands a controller `ctx.style`.
 *
 * `ctx.style` is the host's entry in the animator's own `LedgerSet`, and the animator restores that
 * set itself — `release()` aborts the signal, runs every `instance.destroy()`, *then* calls
 * `state.ledgers.restore()`. A controller that also restored it would be unwinding core's writes
 * while the element is still live. Everything the controller reached on its own — a layer, a step —
 * is in no core set at all, so the controller must restore those itself.
 *
 * This case asserts both halves of that split, which is the only way to tell "I correctly left the
 * host alone" apart from "I forgot the host".
 */
describe('restore responsibility for a context-provided host ledger', () => {
  const cameraParams = {
    num: (name: string, fallback: number) => (name === 'depth' ? 800 : fallback),
    text: (_name: string, fallback: string) => fallback,
    is: (_name: string, value: string) => value === 'on',
  } as unknown as EffectParams

  it('activate, cancel, re-activate and destroy return the element to its authored value', () => {
    const host = document.createElement('div')
    const layer = document.createElement('div')
    layer.setAttribute('data-kui', 'camera-layer z:40')
    host.appendChild(layer)
    document.body.appendChild(host)

    const ctx = createRealPrepareContext(host, { win: null, reducedMotion: false })
    const inst = prepareCameraScene(host, cameraParams, ctx)

    // Authored after preparation, on both an element core knows about (the host) and one only this
    // module ever reaches (the layer).
    host.style.setProperty('perspective', '1500px', 'important')
    layer.style.setProperty('transform', 'translateZ(5px)', 'important')

    inst.activate()
    expect(host.style.perspective).toBe('800px')
    expect(layer.style.transform).toContain('translate3d')

    // `cancel` is "stop where it is, leaving the element mid-effect" — no restore.
    inst.cancel()
    expect(host.style.perspective).toBe('800px')

    // And it can come back: `start()` is not spent by a cancel.
    inst.activate()
    expect(host.style.perspective).toBe('800px')
    expect(layer.style.transform).toContain('translate3d')

    inst.destroy()
    // The layer is this module's own; destroy is the last thing that will ever touch it.
    expect(layer.style.transform).toBe('translateZ(5px)')
    expect(layer.style.getPropertyPriority('transform')).toBe('important')
    // The host is the animator's. Untouched by us, still carrying the library value.
    expect(host.style.perspective).toBe('800px')

    // What `Animator.release()` does after every `instance.destroy()`.
    ctx.style.restore()
    expect(host.style.perspective).toBe('1500px')
    expect(host.style.getPropertyPriority('perspective')).toBe('important')

    host.remove()
  })

  it('two controllers handed the same host ledger share it rather than capturing each other', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const ctx = createRealPrepareContext(host, { win: null, reducedMotion: false })

    const first = new CameraController(host, { depth: 800, mouseTilt: false }, { window: null }, ctx.style)
    const second = new CameraController(host, { depth: 400, mouseTilt: false }, { window: null }, ctx.style)

    host.style.setProperty('perspective', '1500px', 'important')

    first.start()
    expect(host.style.perspective).toBe('800px')
    second.start()
    expect(host.style.perspective).toBe('400px')

    first.destroy()
    second.destroy()
    // Neither controller owns this ledger, so neither restored it.
    expect(host.style.perspective).toBe('400px')

    ctx.style.restore()
    expect(host.style.perspective).toBe('1500px')
    expect(host.style.getPropertyPriority('perspective')).toBe('important')
    host.remove()
  })
})
