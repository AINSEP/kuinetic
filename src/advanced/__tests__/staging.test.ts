// Created by Gemini 3.8 Flash
import { describe, expect, it, vi } from 'vitest'
import { Registry } from '../../core/registry.js'
import { Animator } from '../../core/animator.js'
import { compile } from '../../core/compile.js'
import { parse } from '../../core/parse.js'
import {
  clamp,
  lerp,
  parseChildStep,
  parseTransitionValue,
  parseWindow,
  registerScenes,
  SCENE_PRESETS,
  SCENE_PRIMITIVES,
  SCENE_STEP_PARAMETERS,
  SceneController,
} from '../scenes.js'
import {
  CAMERA_PARAMETERS,
  CAMERA_PRESETS,
  CAMERA_PRIMITIVES,
  CameraController,
  computeLayerTransform,
  parseDepth,
  registerCamera,
} from '../camera-3d.js'
import { registerAdvanced } from '../index.js'
import { createEffectInstance, createInertInstance, isReducedMotion, registerInto, resolveEnv } from '../base.js'
import type { EffectParams } from '../../core/types.js'
import { createRealPrepareContext } from './prepare-context-fixture.js'

describe('Advanced Staging Modules: Scenes and Camera 3D', () => {
  describe('Unified registerAdvanced', () => {
    it('registers all advanced modules at once into registry', () => {
      const reg = new Registry()
      registerAdvanced(reg)
      expect(reg.resolve('shaders')).toBeDefined()
      expect(reg.resolve('scene')).toBeDefined()
      expect(reg.resolve('camera-scene')).toBeDefined()
      expect(reg.resolve('particle-dissolve')).toBeDefined()
      expect(reg.resolve('fluid-trail')).toBeDefined()
    })
  })

  describe('Scenes Module', () => {
    it('registers scene primitive and presets into registry', () => {
      const reg = new Registry()
      registerScenes(reg)
      const res = reg.resolve('scene')
      expect(res).toBeDefined()
      expect(res?.primitive.id).toBe('scene')
      expect(res?.primitive.channels).toEqual(['opacity', 'skew'])

      for (const preset of SCENE_PRESETS) {
        expect(reg.resolve(preset.name)).toBeDefined()
      }
    })

    /*
     * The regression test for the bug this module shipped with: `prepareScene` scanned for
     * `[data-kui*="scene-step"]` while nothing ever registered that name, so every step element
     * compiled as an unrecognised effect and warned "unknown effect" once per step — the scene
     * still animated correctly, which is what kept it hidden.
     *
     * The `SCENE_PRESETS` loop above could not have caught it, and no loop over the module's own
     * declarations ever can: it asks the registry about the names the module declares, so a name
     * the module *forgot* to declare is precisely the name it never asks about. That is why
     * `'scene-step'` is spelled here as a literal, the way an author spells it.
     */
    it('resolves scene-step as a registered primitive, not merely as a string the DOM scan finds', () => {
      const reg = new Registry()
      registerScenes(reg)

      const res = reg.resolve('scene-step')
      expect(res).toBeDefined()
      expect(res?.primitive.id).toBe('scene-step')
      // The parent's pair, because `updateElement` writes `opacity` and the `transform` shorthand.
      expect(res?.primitive.channels).toEqual(['opacity', 'skew'])
    })

    /*
     * Registration alone was never the whole fix, and this is the half that would have caught the
     * trap: a `scene-step` that kept spelling its window `at:0..0.4` resolves as a primitive and
     * still warns, because `core/parse.ts`'s `applyLifted` claims `at:` unconditionally — before
     * any schema is consulted, with no registry in scope — and hands it to `core/sequence.ts`,
     * which answers `at:"0..0.4" is not a position`. Asserting an empty warning list, rather than
     * just "it resolved", is what pins both halves.
     */
    it('compiles a fully authored step with no warnings at all', () => {
      const reg = new Registry()
      registerScenes(reg)
      const plan = compile(
        parse('scene-step from:0.1 to:0.9 opacity:0->1 x:0px->50px y:-20px->20px scale:0.5->1.5'),
        reg,
        'time',
      )
      expect(plan.warnings).toEqual([])
    })

    /*
     * Why the window is no longer spelled `at:`, pinned so nobody restores it as a convenience.
     *
     * Registering the name does not make `at:0.1..0.9` work — it makes it *fail differently*.
     * `core/parse.ts` lifts `at:` onto the spec for every segment, and once the name resolves the
     * entry reaches `core/sequence.ts`, which reads it as a relative time position and refuses it.
     * Before registration the same attribute was silent here, because an unknown effect never
     * becomes a sequence member at all.
     */
    it('does not accept the old at: window, and says so as a position error', () => {
      const reg = new Registry()
      registerScenes(reg)
      const plan = compile(parse('scene-step at:0.1..0.9 opacity:0->1'), reg, 'time')

      expect(plan.warnings).toHaveLength(1)
      expect(plan.warnings[0]).toContain('scene-step')
      expect(plan.warnings[0]).toContain('is not a position')
    })

    /*
     * What the `from:`/`to:` split bought beyond silencing a warning. `0..0.4` is none of the ten
     * `ScalarParamType`s, so a single range parameter could only ever have been declared `text`,
     * which `core/params.ts` accepts unconditionally — a typo'd window would have been silently
     * the whole timeline. Two bounded `number`s are checked by the core before `prepare` runs,
     * which matters because `PrepareContext` carries no diagnostic sink for `prepare` to use.
     */
    it('bound-checks the window the core can now see, instead of taking it silently', () => {
      const reg = new Registry()
      registerScenes(reg)

      const tooHigh = compile(parse('scene-step from:5'), reg, 'time')
      expect(tooHigh.warnings).toHaveLength(1)
      expect(tooHigh.warnings[0]).toContain('parameter "from"')
      expect(tooHigh.warnings[0]).toContain('expected at most 1')

      const notANumber = compile(parse('scene-step to:banana'), reg, 'time')
      expect(notANumber.warnings).toHaveLength(1)
      expect(notANumber.warnings[0]).toContain('parameter "to"')

      // And the window still lands on its declared default rather than NaN.
      const el = document.createElement('div')
      el.setAttribute('data-kui', 'scene-step from:5 to:banana')
      expect(parseChildStep(el).range).toEqual([0, 1])
    })

    it('parses range and transition strings correctly', () => {
      expect(clamp(5, 0, 1)).toBe(1)
      expect(clamp(-1, 0, 1)).toBe(0)
      expect(clamp(0.5, 0, 1)).toBe(0.5)
      expect(lerp(10, 20, 0.5)).toBe(15)

      // Each end defaults on its own, which is the point of the `from:`/`to:` split — the old
      // single-string form could not express "until 40%" without also writing the start.
      expect(parseWindow('')).toEqual([0, 1])
      expect(parseWindow('scene-step')).toEqual([0, 1])
      expect(parseWindow('scene-step from:0.2 to:0.8')).toEqual([0.2, 0.8])
      expect(parseWindow('scene-step to:0.4')).toEqual([0, 0.4])
      expect(parseWindow('scene-step from:0.6')).toEqual([0.6, 1])
      expect(parseWindow('scene-step from:.25 to:.75')).toEqual([0.25, 0.75])

      // Unreadable text leaves that end at its default rather than producing NaN. The core has
      // already rejected it with a diagnostic by the time an authored attribute reaches here;
      // this is the direct-caller path.
      expect(parseWindow('scene-step from:nan to:nan')).toEqual([0, 1])
      expect(parseWindow('scene-step from: to:')).toEqual([0, 1])

      // Out of range falls back to the declared default rather than clamping — the core rejects
      // rather than clamps, and the two readings of one attribute have to agree.
      expect(parseWindow('scene-step from:5 to:9')).toEqual([0, 1])
      expect(parseWindow('scene-step from:-2')).toEqual([0, 1])

      // The old `at:0.1..0.9` spelling is dead, not tolerated: `at:` belongs to `core/parse.ts`.
      expect(parseWindow('scene-step at:0.1..0.9')).toEqual([0, 1])

      // `\b` must not let a longer key end in `from`/`to` and be misread as one.
      expect(parseWindow('scene-step into:0.3')).toEqual([0, 1])

      expect(parseTransitionValue()).toBeNull()
      expect(parseTransitionValue('')).toBeNull()
      const trans = parseTransitionValue('40px->0px')
      expect(trans).toEqual({ from: 40, to: 0, unit: 'px' })
      expect(parseTransitionValue('0->1')).toEqual({ from: 0, to: 1, unit: '' })
      expect(parseTransitionValue('0%->100%')).toEqual({ from: 0, to: 100, unit: '%' })
      expect(parseTransitionValue('0VH->100VH')).toEqual({ from: 0, to: 100, unit: 'VH' })
      expect(parseTransitionValue('0->')).toBeNull()
      expect(parseTransitionValue('none')).toBeNull()
      expect(parseTransitionValue('bad->nan')).toBeNull()
    })

    it('exercises default raf and caf without injected env', () => {
      const container = document.createElement('div')
      const controller = new SceneController(container)
      const id = controller.raf(() => {})
      controller.caf(id)

      const cNull = new SceneController(container, {}, { window: null })
      expect(cNull.raf(() => {})).toBeNull()
      expect(cNull.caf(1)).toBeNull()
    })

    it('parses child step attributes comprehensively', () => {
      const el = document.createElement('div')
      el.setAttribute('data-kui', 'scene-step from:0.1 to:0.9 opacity:0->1 x:0px->50px y:-20px->20px scale:0.5->1.5')
      const step = parseChildStep(el)
      expect(step.range).toEqual([0.1, 0.9])
      expect(step.opacity).toEqual({ from: 0, to: 1, unit: '' })
      expect(step.x).toEqual({ from: 0, to: 50, unit: 'px' })
      expect(step.y).toEqual({ from: -20, to: 20, unit: 'px' })
      expect(step.scale).toEqual({ from: 0.5, to: 1.5, unit: '' })

      const emptyEl = document.createElement('div')
      const emptyStep = parseChildStep(emptyEl)
      expect(emptyStep.range).toEqual([0, 1])
      expect(emptyStep.opacity).toBeNull()

      expect(parseChildStep(null as unknown as HTMLElement).opacity).toBeNull()
      expect(parseChildStep({} as HTMLElement).opacity).toBeNull()
      expect(parseChildStep({ getAttribute: () => null } as unknown as HTMLElement).opacity).toBeNull()
    })

    it('SceneController tracks steps, updates styles, and handles all branches', () => {
      const container = document.createElement('div')
      container.getBoundingClientRect = () => ({ top: 400, height: 200 } as DOMRect)

      let rafCallback: FrameRequestCallback | null = null
      const fakeRaf = vi.fn((fn: FrameRequestCallback) => {
        rafCallback = fn
        return 42
      })
      const fakeCaf = vi.fn()

      const controller = new SceneController(container, {}, {
        window: {
          innerHeight: 600,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        } as any,
        raf: fakeRaf,
        caf: fakeCaf,
      })

      const stepEl = document.createElement('div')
      controller.addStep(stepEl, {
        range: [0.2, 0.8],
        opacity: { from: 0, to: 1, unit: '' },
        x: { from: 0, to: 100, unit: 'px' },
        y: { from: 10, to: 50, unit: 'px' },
        scale: { from: 1, to: 2, unit: '' },
      })

      const opOnlyEl = document.createElement('div')
      controller.addStep(opOnlyEl, {
        range: [0, 1],
        opacity: { from: 0, to: 1, unit: '' },
      })

      const invalidEl = document.createElement('div')
      controller.addStep(invalidEl, {
        range: [0.8, 0.2],
        opacity: { from: 0, to: 1, unit: '' },
      })

      controller.start()
      controller.start()
      expect(controller.isListening).toBe(true)

      controller.onScroll()
      controller.onScroll()
      expect(rafCallback).not.toBeNull()
      rafCallback!(1000)

      expect(controller.progress).toBeGreaterThan(0)
      expect(stepEl.style.opacity).not.toBe('')
      expect(stepEl.style.transform).toContain('translateX')

      controller.onScroll()
      expect(controller.rafId).toBe(42)
      controller.stop()
      controller.stop()
      expect(controller.isListening).toBe(false)
      expect(fakeCaf).toHaveBeenCalledWith(42)

      // updateElement with element lacking style
      controller.updateElement({} as any, { range: [0, 1] }, 0.5)

      controller.destroy()
      expect(controller.steps.length).toBe(0)
      expect(stepEl.style.opacity).toBe('')
      expect(stepEl.style.transform).toBe('')
    })

    it('SceneController handles null environment and edge bounding boxes', () => {
      const c1 = new SceneController(null as unknown as HTMLElement, {}, { window: null })
      c1.start()
      expect(c1.isListening).toBe(false)
      c1.calculateProgress()
      expect(c1.progress).toBe(0)

      const container = document.createElement('div')
      container.getBoundingClientRect = () => ({ top: 1000, height: -1000 } as DOMRect)
      const c2 = new SceneController(container, {}, { window: { innerHeight: 0 } as any })
      c2.calculateProgress()
      expect(c2.progress).toBe(0)

      const validContainer = document.createElement('div')
      validContainer.getBoundingClientRect = () => ({ top: 100, height: 200 } as DOMRect)
      const c3 = new SceneController(validContainer, {}, { window: null })
      c3.calculateProgress()
      expect(c3.progress).toBeGreaterThan(0)
    })

    it('prepareScene binds children and returns active lifecycle instance', () => {
      const root = document.createElement('section')
      const child = document.createElement('h1')
      child.setAttribute('data-kui', 'scene-step from:0 to:1 opacity:0->1')
      root.appendChild(child)

      const params = {
        text: vi.fn().mockReturnValue('hero'),
      } as unknown as EffectParams

      const inst = SCENE_PRIMITIVES[0]!.prepare!(root, params, createRealPrepareContext(root, { reducedMotion: false }))
      expect(inst).toBeDefined()
      inst.activate()
      inst.cancel()
      inst.finish()
      inst.destroy()
    })

    it('SceneController coordinates time-based progression and handles empty prepare params', () => {
      let now = 1000
      let rafCb: FrameRequestCallback | null = null
      const fakeRaf = vi.fn((cb: FrameRequestCallback) => {
        rafCb = cb
        return 555
      })

      const root = document.createElement('div')
      const controller = new SceneController(root, { progress: 'time', duration: 200 }, {
        window: {
          performance: { now: () => now },
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        } as any,
        raf: fakeRaf,
      })

      const child = document.createElement('div')
      controller.addStep(child, {
        range: [0, 1],
        opacity: { from: 0, to: 1, unit: '' },
      })

      controller.start()
      expect(controller.isListening).toBe(true)
      expect(rafCb).not.toBeNull()

      // Mid-progression tick
      now = 1100
      rafCb!(now)
      expect(controller.progress).toBeCloseTo(0.5)

      // Completion tick
      now = 1250
      rafCb!(now)
      expect(controller.progress).toBe(1)
      expect(controller.rafId).toBeNull()

      controller.stop()

      // Time progression without window.performance and default duration
      const cTimeNoPerf = new SceneController(root, { progress: 'time' }, { window: {} as any })
      cTimeNoPerf.start()
      expect(cTimeNoPerf.isListening).toBe(true)
      cTimeNoPerf.stop()

      // Empty params prepare test
      const emptyInst = SCENE_PRIMITIVES[0]!.prepare!(root, {} as EffectParams, createRealPrepareContext(root, { reducedMotion: false }))
      expect(emptyInst).toBeDefined()

      // prepareScene with time progression mode and root lacking querySelectorAll
      const timeParams = {
        text: vi.fn((k) => (k === 'progress' ? 'time' : 'default')),
        num: vi.fn((k, def) => def),
      } as unknown as EffectParams
      const timeInst = SCENE_PRIMITIVES[0]!.prepare!({} as HTMLElement, timeParams, createRealPrepareContext(null, { reducedMotion: false }))
      expect(timeInst).toBeDefined()
      timeInst.destroy()
    })

    it('registerScenes throws on invalid registry target', () => {
      expect(() => registerScenes(null)).toThrow('kuinetic: registerScenes requires a Registry or Animator instance')
    })
  })

  describe('Camera 3D Module', () => {
    it('registers camera-scene primitive into registry', () => {
      const reg = new Registry()
      registerCamera(reg)
      const res = reg.resolve('camera-scene')
      expect(res).toBeDefined()
      expect(res?.primitive.id).toBe('camera-scene')
      expect(res?.primitive.channels).toEqual(['skew', 'perspective', 'transform-style'])

      for (const preset of CAMERA_PRESETS) {
        expect(reg.resolve(preset.name)).toBeDefined()
      }
    })

    it('tests clamp, parseDepth, and computeLayerTransform', () => {
      expect(parseDepth()).toBe(0)
      expect(parseDepth('invalid')).toBe(0)
      expect(parseDepth('250px')).toBe(250)

      const t = computeLayerTransform(100, 50, 4, -4)
      expect(t).toContain('translate3d(0, 0, 125px)')
      expect(t).toContain('rotateX(4deg)')
    })

    it('CameraController handles mouse tilt, scroll, rendering, and lifecycle', () => {
      const stage = document.createElement('div')
      stage.getBoundingClientRect = () => ({ top: 300, height: 400 } as DOMRect)
      const layerEl = document.createElement('div')

      let rafCallback: FrameRequestCallback | null = null
      const fakeRaf = vi.fn((fn: FrameRequestCallback) => {
        rafCallback = fn
        return 99
      })
      const fakeCaf = vi.fn()

      const controller = new CameraController(stage, { depth: 1500, mouseTilt: true }, {
        window: {
          innerWidth: 1000,
          innerHeight: 800,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        } as any,
        raf: fakeRaf,
        caf: fakeCaf,
      })

      controller.addLayer(layerEl, 200)
      expect(controller.layers.length).toBe(1)

      controller.start()
      controller.start()
      expect(controller.isListening).toBe(true)

      controller.onScroll()
      expect(controller.cameraZ).toBeGreaterThan(0)

      controller.onMouseMove({ clientX: 400, clientY: 300 } as MouseEvent)
      expect(controller.mouse.targetX).not.toBe(0)

      expect(rafCallback).not.toBeNull()
      rafCallback!(1000)

      expect(layerEl.style.transform).toContain('translate3d')

      controller.stop()
      controller.stop()
      expect(controller.isListening).toBe(false)
      expect(fakeCaf).toHaveBeenCalledWith(99)

      controller.destroy()
      expect(stage.style.perspective).toBe('')
      expect(layerEl.style.transform).toBe('')
      expect(controller.layers.length).toBe(0)
    })

    it('CameraController handles edge cases with null environment and missing bounding rect', () => {
      const stage = document.createElement('div')
      stage.getBoundingClientRect = () => ({ top: 100, height: 200 } as DOMRect)

      const cNullContainer = new CameraController(stage, {}, { window: null })
      cNullContainer.onScroll()
      expect(cNullContainer.cameraZ).toBeGreaterThan(0)

      const zeroStage = document.createElement('div')
      zeroStage.getBoundingClientRect = () => ({ top: 800, height: -800 } as DOMRect)
      const cZero = new CameraController(zeroStage, {}, { window: { innerHeight: 0 } as any })
      cZero.onScroll()
      expect(cZero.cameraZ).toBe(0)

      const cNull = new CameraController(null as unknown as HTMLElement, {}, { window: null })
      cNull.start()
      expect(cNull.isListening).toBe(false)
      cNull.onScroll()
      expect(cNull.cameraZ).toBe(0)
      cNull.onMouseMove({ clientX: 100, clientY: 100 } as MouseEvent)
      expect(cNull.raf(() => {})).toBeNull()
      expect(cNull.caf(1)).toBeNull()
      cNull.destroy()

      const cDefault = new CameraController(stage)
      cDefault.start()
      expect(cDefault.isListening).toBe(true)
      const id = cDefault.raf(() => {})
      cDefault.caf(id)
      cDefault.stop()
      cDefault.destroy()
    })

    it('prepareCameraScene parses layers and manages full lifecycle', () => {
      const root = document.createElement('div')
      const layer1 = document.createElement('div')
      layer1.setAttribute('data-kui', 'camera-layer z:150px')
      const layer2 = document.createElement('div')
      layer2.setAttribute('data-kui', 'camera-layer z:none')
      const layer3 = document.createElement('div')
      root.appendChild(layer1)
      root.appendChild(layer2)
      root.appendChild(layer3)

      const params = {
        num: vi.fn().mockReturnValue(1200),
        text: vi.fn().mockReturnValue('on'),
      } as unknown as EffectParams

      const inst = CAMERA_PRIMITIVES[0]!.prepare!(root, params, createRealPrepareContext(root, { reducedMotion: false }))
      expect(inst).toBeDefined()
      inst.activate()
      inst.cancel()
      inst.finish()
      inst.destroy()

      // Empty params prepare test
      const emptyEl = {} as HTMLElement
      const emptyInst = CAMERA_PRIMITIVES[0]!.prepare!(emptyEl, {} as EffectParams, createRealPrepareContext(null, { reducedMotion: false }))
      expect(emptyInst).toBeDefined()

      // Layer without data-kui (getAttribute returns null)
      const mockLayerRoot = {
        style: {},
        querySelectorAll: () => [{ getAttribute: () => null }],
      } as unknown as HTMLElement
      const nullKuiInst = CAMERA_PRIMITIVES[0]!.prepare!(mockLayerRoot, params, createRealPrepareContext(null, { reducedMotion: false }))
      expect(nullKuiInst).toBeDefined()
      nullKuiInst.destroy()
    })

    it('CameraController handles mouseTilt false, loop re-entry, and window-null bindEvents', () => {
      const stage = document.createElement('div')
      const controller = new CameraController(stage, { mouseTilt: false }, { window: null })
      controller.start()
      expect(controller.isListening).toBe(true)
      controller.render()

      // Loop re-entry when rafId already active
      controller.rafId = 123
      controller.startLoop()
      expect(controller.rafId).toBe(123)
      controller.destroy()
    })

    it('CameraController captures authored baseline once and preserves it across reactivations', () => {
      const stage = document.createElement('div')
      stage.style.perspective = '1500px'
      stage.style.transformStyle = 'preserve-3d'
      stage.style.transform = 'scale(1.2)'
      const layer = document.createElement('div')
      layer.style.transform = 'translateZ(10px)'
      layer.style.transformStyle = 'flat'
      stage.appendChild(layer)

      const unstarted = new CameraController(stage)
      unstarted.destroy()
      expect(stage.style.perspective).toBe('1500px')

      const c = new CameraController(stage, { depth: 1000, mouseTilt: true })
      c.addLayer(layer, 50)

      c.start()
      c.onMouseMove({ clientX: 200, clientY: 300 } as any)
      c.stepMouse()
      c.render()
      expect(stage.style.transform).not.toBe('scale(1.2)')

      c.stop()
      c.start()
      c.onMouseMove({ clientX: 400, clientY: 500 } as any)
      c.stepMouse()
      c.render()

      c.destroy()
      expect(stage.style.perspective).toBe('1500px')
      expect(stage.style.transformStyle).toBe('preserve-3d')
      expect(stage.style.transform).toBe('scale(1.2)')
      expect(layer.style.transform).toBe('translateZ(10px)')
      expect(layer.style.transformStyle).toBe('flat')
    })

    it('CameraController handles onScroll RAF coalescing and cancellation', () => {
      const stage = document.createElement('div')
      stage.getBoundingClientRect = () => ({ top: 100, height: 200 } as DOMRect)
      const c = new CameraController(stage, { depth: 1000 }, {
        raf: () => 77,
        caf: vi.fn(),
      })
      c.start()
      c.onScroll()
      expect(c.scrollRafId).toBe(77)
      c.onScroll()
      expect(c.scrollRafId).toBe(77)
      c.stop()
      expect(c.scrollRafId).toBeNull()
      c.destroy()
    })

    it('parseMouseTilt parses text fallback when is() is not provided', () => {
      const stage = document.createElement('div')
      const paramsWithTextOnly = {
        num: () => 1000,
        text: (name: string) => name === 'mouse-tilt' ? 'off' : '',
      } as any
      const noCtx = createRealPrepareContext(stage, { reducedMotion: false })
      const inst = CAMERA_PRIMITIVES[0]!.prepare!(stage, paramsWithTextOnly, noCtx)
      expect(inst).toBeDefined()
      inst.destroy()

      const paramsIsFalse = { num: () => 1000, is: () => false } as any
      const inst2 = CAMERA_PRIMITIVES[0]!.prepare!(stage, paramsIsFalse, noCtx)
      expect(inst2).toBeDefined()
      inst2.destroy()

      const inst3 = CAMERA_PRIMITIVES[0]!.prepare!(stage, {} as any, noCtx)
      expect(inst3).toBeDefined()
      inst3.destroy()
    })

    describe('the audio band a camera scene can follow', () => {
      /** A scene parked at scroll progress 0, so every z offset below is the audio push alone. */
      function parkedScene(options: { audio?: 'bass' | 'mid' | 'treble' | 'level' | null; mouseTilt?: boolean } = {}) {
        const stage = document.createElement('div')
        // `top` at the fallback window height means `dist` is 0: no scroll contribution at all.
        stage.getBoundingClientRect = () => ({ top: 800, height: 400 } as DOMRect)
        const layer = document.createElement('div')
        stage.appendChild(layer)
        let tick: (() => void) | null = null
        const raf = vi.fn((fn: FrameRequestCallback) => { tick = fn as unknown as () => void; return 42 })
        const caf = vi.fn()
        const controller = new CameraController(
          stage,
          { depth: 1000, mouseTilt: Boolean(options.mouseTilt), audio: options.audio ?? null },
          { window: null, raf, caf },
        )
        controller.addLayer(layer, 0)
        return { controller, stage, layer, raf, caf, runFrame: () => tick?.() }
      }

      it('pushes the camera forward by a tenth of the scene depth at full scale', () => {
        const scene = parkedScene({ audio: 'bass' })
        scene.stage.style.setProperty('--kui-audio-bass', '0.5')
        scene.controller.start()

        // 0.5 * depth(1000) * 0.1 = 50 of camera travel, which `computeLayerTransform` halves.
        expect(scene.layer.style.transform).toBe('translate3d(0, 0, 25px)')

        scene.stage.style.setProperty('--kui-audio-bass', '1')
        scene.runFrame()
        expect(scene.layer.style.transform).toBe('translate3d(0, 0, 50px)')

        scene.controller.destroy()
      })

      it('clamps a band above 1 instead of pushing the scene through the viewer', () => {
        const scene = parkedScene({ audio: 'treble' })
        scene.stage.style.setProperty('--kui-audio-treble', '9')
        scene.controller.start()
        expect(scene.layer.style.transform).toBe('translate3d(0, 0, 50px)')
        scene.controller.destroy()
      })

      it('leaves the scene exactly where it was with no band selected', () => {
        const scene = parkedScene()
        // A driver on the container writing at full scale, and no `audio:` asking for it.
        for (const prop of ['--kui-audio-bass', '--kui-audio-mid', '--kui-audio-treble', '--kui-audio-level']) {
          scene.stage.style.setProperty(prop, '1')
        }
        scene.controller.start()

        expect(scene.layer.style.transform).toBe('translate3d(0, 0, 0px)')
        expect(scene.controller.audioLevel).toBe(0)
        // No band, no loop: `start()` scheduled nothing, so nothing reads or writes per frame.
        expect(scene.controller.audioRafId).toBeNull()
        expect(scene.raf).not.toHaveBeenCalled()

        scene.controller.destroy()
      })

      it('is the scene\'s only frame loop while it runs', () => {
        const scene = parkedScene({ audio: 'bass', mouseTilt: true })
        scene.controller.start()

        expect(scene.controller.audioRafId).toBe(42)
        // The pointer loop and the scroll handler both stand down: one pass per frame reads
        // geometry and style, then writes.
        expect(scene.controller.rafId).toBeNull()
        scene.controller.onMouseMove({ clientX: 900, clientY: 700 } as MouseEvent)
        expect(scene.controller.rafId).toBeNull()
        scene.controller.onScroll()
        expect(scene.controller.scrollRafId).toBeNull()
        // And it is not restartable into a second copy of itself.
        scene.controller.startAudioLoop()
        expect(scene.raf).toHaveBeenCalledTimes(1)

        // The frame steps the pointer spring itself, which the pointer loop would have done.
        scene.runFrame()
        expect(scene.stage.style.transform).toContain('rotateX')
        expect(scene.controller.audioRafId).toBe(42)

        scene.controller.stop()
        expect(scene.caf).toHaveBeenCalledWith(42)
        expect(scene.controller.audioRafId).toBeNull()
        // A frame already queued when the effect was cancelled does not reschedule.
        scene.runFrame()
        expect(scene.controller.audioRafId).toBeNull()

        scene.controller.destroy()
      })

      it('reaches the controller from the authored keyword, and only for a real band', () => {
        const drive = (authored: string) => {
          const stage = document.createElement('div')
          stage.getBoundingClientRect = () => ({ top: 10000, height: 400 } as DOMRect)
          const layer = document.createElement('div')
          layer.setAttribute('data-kui', 'camera-layer z:0')
          stage.appendChild(layer)
          stage.style.setProperty('--kui-audio-level', '1')
          const params = {
            num: (_name: string, fallback = 0) => fallback,
            text: (name: string, fallback = '') => (name === 'audio' ? authored : fallback),
            is: () => false,
          } as unknown as EffectParams
          const ctx = createRealPrepareContext(stage, { reducedMotion: false, raf: () => 1, caf: () => undefined })
          const inst = CAMERA_PRIMITIVES[0]!.prepare!(stage, params, ctx)
          inst.activate()
          const transform = layer.style.transform
          inst.destroy()
          return transform
        }

        expect(drive('level')).toBe('translate3d(0, 0, 50px)')
        expect(drive('off')).toBe('translate3d(0, 0, 0px)')
        expect(drive('rumble')).toBe('translate3d(0, 0, 0px)')
      })

      it('declares one closed, off-by-default keyword list, the same words as the shaders', () => {
        expect(CAMERA_PARAMETERS.audio.type).toBe('keyword')
        expect(CAMERA_PARAMETERS.audio.default).toBe('off')
        expect(CAMERA_PARAMETERS.audio.keywords).toEqual(['off', 'bass', 'mid', 'treble', 'level'])
      })
    })

    it('registerCamera throws on invalid registry target', () => {
      expect(() => registerCamera(null)).toThrow('kuinetic: registerCamera requires a Registry or Animator instance')
    })
  })

  describe('Base Runtime Utilities', () => {
    it('createEffectInstance handles finish, destroy, and promise resolution for non-continuous instances', async () => {
      let finishCalled = false
      let destroyCalled = false
      const inst = createEffectInstance({
        continuous: false,
        finish: () => { finishCalled = true },
        destroy: () => { destroyCalled = true },
      })

      inst.finish()
      expect(finishCalled).toBe(true)
      await expect(inst.finished).resolves.toBeUndefined()

      inst.destroy()
      expect(destroyCalled).toBe(true)

      const inert = createInertInstance(() => {})
      expect(inert).toBeDefined()
    })

    // Renamed from "requires real Registry or Animator instance": the gate checks shape, not class
    // (see `asRegistry` in `base.ts` — `instanceof` across two bundles was the bug). Every
    // assertion below is unchanged and still correct, including the duck carrying the *singular*
    // `registerPrimitive`, which a shape check has to keep refusing.
    it('registerInto requires the two registrar methods it calls, and registers items', () => {
      expect(() => {
        registerInto({} as any, [], [], 'Test')
      }).toThrow(/requires a Registry or Animator instance/)

      expect(() => {
        const duck = {
          registeredItems: [] as unknown[],
          registerPrimitive(p: unknown) { this.registeredItems.push(p) },
        }
        registerInto(duck as any, [], [], 'Test')
      }).toThrow(/requires a Registry or Animator instance/)

      const reg = new Registry()
      registerInto(reg, [{ id: 'p1', channel: 'opacity', prepare: () => ({}) }] as any, [{ name: 'pr1', primitive: 'p1', params: {} }] as any, 'Test')
      expect(reg.resolve('pr1')).toBeDefined()

      const anim = new Animator()
      registerInto(anim, [{ id: 'p2', channel: 'opacity', prepare: () => ({}) }] as any, [{ name: 'pr2', primitive: 'p2', params: {} }] as any, 'Generic')
      expect(anim.registry.resolve('pr2')).toBeDefined()
    })

    it('resolveEnv and isReducedMotion handle all configuration permutations', () => {
      expect(resolveEnv({ win: window, doc: document }).window).toBe(window)
      expect(resolveEnv({}, { window: null, document: null }).window).toBeNull()
      expect(resolveEnv().window).toBeDefined()

      vi.stubGlobal('window', undefined)
      vi.stubGlobal('document', undefined)
      expect(resolveEnv().window).toBeNull()
      expect(resolveEnv().document).toBeNull()
      vi.unstubAllGlobals()

      expect(isReducedMotion(null)).toBe(false)
      expect(isReducedMotion({ reducedMotion: true } as any)).toBe(true)
      expect(isReducedMotion({ reducedMotion: false } as any)).toBe(false)
      expect(isReducedMotion({ reducedMotion: { enabled: true } } as any)).toBe(true)
      expect(isReducedMotion({ reducedMotion: { enabled: false } } as any)).toBe(false)
    })
  })

  describe('Reduced Motion Handling', () => {
    it('scene prepare hook stays safe under reduced motion with nothing to hold', () => {
      const mockParams = {
        text: vi.fn().mockReturnValue('default'),
        num: vi.fn().mockReturnValue(1),
        keyword: vi.fn().mockReturnValue('default'),
      } as unknown as EffectParams
      const reducedCtx = createRealPrepareContext(null, { reducedMotion: true })

      const sceneInst = SCENE_PRIMITIVES[0]!.prepare!(document.createElement('div'), mockParams, reducedCtx)
      expect(sceneInst).toBeDefined()
      if (sceneInst.activate) sceneInst.activate()
      if (sceneInst.cancel) sceneInst.cancel()
      if (sceneInst.finish) sceneInst.finish()
      expect(() => sceneInst.destroy()).not.toThrow()
    })

    it('scene holds its last keyframe under reduced motion and gives the steps back', () => {
      const root = document.createElement('div')
      const step = document.createElement('div')
      step.setAttribute('data-kui', 'scene-step to:0.5 opacity:0->1 y:40px->0')
      root.appendChild(step)

      const params = {
        text: vi.fn((_k: string, def: string) => def),
        num: vi.fn((_k: string, def: number) => def),
      } as unknown as EffectParams
      const inst = SCENE_PRIMITIVES[0]!.prepare!(
        root,
        params,
        createRealPrepareContext(root, { reducedMotion: true }),
      )

      // The end state, not nothing. A step the author styled `opacity: 0` in a stylesheet and
      // expected this effect to fade in stayed invisible for the whole visit before this.
      expect(step.style.opacity).toBe('1')
      expect(step.style.transform).toBe('translateY(0px)')

      // Nothing is activated under this policy; the instance is inert and the frame is already up.
      expect(inst.continuous).toBe(false)
      inst.activate()
      expect(step.style.opacity).toBe('1')

      inst.destroy()
      expect(step.hasAttribute('style')).toBe(false)
    })

    it('camera prepare hook stays safe under reduced motion with no layers', () => {
      const mockParams = {
        text: vi.fn().mockReturnValue('default'),
        num: vi.fn().mockReturnValue(1),
        keyword: vi.fn().mockReturnValue('default'),
      } as unknown as EffectParams
      const reducedCtx = createRealPrepareContext(null, { reducedMotion: true })

      const camInst = CAMERA_PRIMITIVES[0]!.prepare!(document.createElement('div'), mockParams, reducedCtx)
      expect(camInst).toBeDefined()
      if (camInst.activate) camInst.activate()
      if (camInst.cancel) camInst.cancel()
      if (camInst.finish) camInst.finish()
      expect(() => camInst.destroy()).not.toThrow()
    })

    it('camera-scene composes its layers at rest under reduced motion', () => {
      const stage = document.createElement('div')
      const layer = document.createElement('div')
      layer.setAttribute('data-kui', 'camera-layer z:-400')
      stage.appendChild(layer)

      const params = {
        text: vi.fn((_k: string, def: string) => def),
        num: vi.fn((_k: string, def: number) => def),
      } as unknown as EffectParams
      const inst = CAMERA_PRIMITIVES[0]!.prepare!(
        stage,
        params,
        createRealPrepareContext(stage, { reducedMotion: true }),
      )

      // The 3D space and every layer at its authored depth — the composition, minus the travel.
      expect(stage.style.perspective).toBe('1000px')
      expect(layer.style.transform).toBe('translate3d(0, 0, -400px)')
      expect(layer.style.getPropertyValue('transform-style')).toBe('preserve-3d')
      // `mouse-tilt` defaults to `on`, and a still frame does not tilt.
      expect(stage.style.transform).toBe('')

      // Only the layer: the stage's ledger is `ctx.style`, which the animator restores itself.
      inst.destroy()
      expect(layer.hasAttribute('style')).toBe(false)
    })

    it('resolveEnv resolves custom caf from context', () => {
      const customCaf = vi.fn()
      expect(resolveEnv({ caf: customCaf }).caf).toBe(customCaf)
    })

    it('createEffectInstance guards against activate, cancel, finish after destroy', () => {
      let act = 0; let can = 0; let fin = 0; let des = 0
      const inst = createEffectInstance({
        activate: () => act++,
        cancel: () => can++,
        finish: () => fin++,
        destroy: () => des++,
      })
      inst.destroy()
      expect(des).toBe(1)
      inst.activate()
      inst.cancel()
      inst.finish()
      inst.destroy()
      expect(act).toBe(0)
      expect(can).toBe(0)
      expect(fin).toBe(0)
      expect(des).toBe(1)
    })

    it('camera-3d loops and updates transform on mouse tilt', () => {
      const container = document.createElement('div')
      let tickCb: FrameRequestCallback | null = null
      const fakeRaf = vi.fn((fn: FrameRequestCallback) => {
        tickCb = fn
        return 123
      })
      const cam = new CameraController(container, { mouseTilt: true }, { raf: fakeRaf })
      cam.start()
      cam.onMouseMove({ clientX: 300, clientY: 400 })
      expect(fakeRaf).toHaveBeenCalled()
      if (tickCb) (tickCb as any)(1000)
      expect(container.style.transform).toContain('rotate')
      cam.destroy()
    })
  })
})
