import { describe, expect, it, vi } from 'vitest'
import { Registry } from '../../core/registry.js'
import {
  getSharedShaderRenderer,
  prepareShaders,
  registerShaders,
  setSharedShaderRenderer,
  SHADER_PARAMETERS,
  SHADERS_PRESETS,
  SharedShaderRenderer,
  bindShaderTexture,
  drawElementQuad,
  extractShaderOptions,
  parseColor,
  createRendererRef,
  measureElementGeometry,
  resolveDrawBox,
  setupScissor,
  uploadColorUniforms,
  uploadUniforms,
  BLEND_MODES,
  DEFAULT_SHADER_Z_INDEX,
  GENERATIVE_MODES,
  PALETTE_SIZE,
  SHADER_MODES,
  SHADER_Z_PROPERTY,
  buildPalette,
  parseAngleRadians,
  readElementProgress,
  readShaderZIndex,
  type ElementGeometry,
} from '../shaders.js'
import {
  compileShader,
  createProgram,
  extractLocations,
  createGLTexture,
} from '../gl-utils.js'
import { createInertInstance as inertInstance } from '../base.js'
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
    getUniformLocation: vi.fn((prog, name) => ({ name })),
    uniform1f: vi.fn(),
    uniform1i: vi.fn(),
    uniform2f: vi.fn(),
    uniform4fv: vi.fn(),
    enable: vi.fn(),
    disable: vi.fn(),
    viewport: vi.fn(),
    scissor: vi.fn(),
    clearColor: vi.fn(),
    clear: vi.fn(),
    drawArrays: vi.fn(),
  } as unknown as WebGL2RenderingContext
}

/**
 * A loaded 100x100 `<img>` with a real box, which is the minimum a shader instance needs before
 * it will register a draw at all. Shared by the two per-frame-input blocks below (`audio:` and
 * `scrub:`) — they ask different questions of the same element.
 */
function shaderImg(): HTMLImageElement {
  const img = document.createElement('img')
  Object.defineProperty(img, 'complete', { value: true })
  Object.defineProperty(img, 'naturalWidth', { value: 100 })
  Object.defineProperty(img, 'naturalHeight', { value: 100 })
  img.getBoundingClientRect = () => ({ left: 10, top: 10, right: 110, bottom: 110, width: 100, height: 100 } as DOMRect)
  return img
}

describe('Advanced Shaders Labs Module', () => {
  it('parses colors and provides blend modes', () => {
    expect(BLEND_MODES.normal).toBe(0)
    expect(BLEND_MODES.screen).toBe(1)
    expect(BLEND_MODES.multiply).toBe(2)
    expect(BLEND_MODES.add).toBe(3)

    expect(parseColor('')).toEqual([1, 1, 1, 1])
    expect(parseColor('#f00')).toEqual([1, 0, 0, 1])
    expect(parseColor('#f00a')).toEqual([1, 0, 0, 10 / 15])
    expect(parseColor('#00ff00')).toEqual([0, 1, 0, 1])
    expect(parseColor('#00ff0080')).toEqual([0, 1, 0, 128 / 255])
    expect(parseColor('#12345')).toEqual([1, 1, 1, 1])
    expect(parseColor('rgb(255, 128, 0)')).toEqual([1, 128 / 255, 0, 1])
    expect(parseColor('rgba(100, 150, 200, 0.5)')).toEqual([100 / 255, 150 / 255, 200 / 255, 0.5])
    expect(parseColor('not-a-hex')).toEqual([1, 1, 1, 1])
    expect(parseColor('#xyz')).toEqual([1, 1, 1, 1])
    expect(parseColor('#12')).toEqual([1, 1, 1, 1])
    expect(parseColor('#123456789')).toEqual([1, 1, 1, 1])
  })

  it('compiles shaders and handles compilation failures', () => {
    const gl = createMockGL()
    const shader = compileShader(gl, gl.VERTEX_SHADER, 'void main(){}')
    expect(shader).toBeDefined()
    expect(gl.compileShader).toHaveBeenCalled()

    // Failed creation
    const glNullShader = createMockGL()
    glNullShader.createShader = vi.fn().mockReturnValue(null)
    expect(compileShader(glNullShader, gl.VERTEX_SHADER, '')).toBeNull()

    // Failed compile status
    const glBadShader = createMockGL()
    glBadShader.getShaderParameter = vi.fn().mockReturnValue(false)
    expect(compileShader(glBadShader, gl.VERTEX_SHADER, '')).toBeNull()
    expect(glBadShader.deleteShader).toHaveBeenCalled()
  })

  it('creates program and handles linking failures', () => {
    const gl = createMockGL()
    const prog = createProgram(gl, 'void main(){}', 'void main(){}')
    expect(prog).toBeDefined()
    expect(gl.linkProgram).toHaveBeenCalled()

    // Bad shader compilation (both vs and fs fail)
    const glBad = createMockGL()
    glBad.getShaderParameter = vi.fn().mockReturnValue(false)
    expect(createProgram(glBad, '', '')).toBeNull()

    // Partial shader compilation: vs succeeds, fs fails
    let compileCalls = 0
    const glPartial = createMockGL()
    glPartial.getShaderParameter = vi.fn(() => {
      compileCalls++
      return compileCalls === 1
    })
    expect(createProgram(glPartial, '', '')).toBeNull()
    expect(glPartial.deleteShader).toHaveBeenCalled()

    // Partial shader compilation: vs fails, fs succeeds
    let compileCalls2 = 0
    const glPartial2 = createMockGL()
    glPartial2.getShaderParameter = vi.fn(() => {
      compileCalls2++
      return compileCalls2 === 2
    })
    expect(createProgram(glPartial2, '', '')).toBeNull()
    expect(glPartial2.deleteShader).toHaveBeenCalled()

    // Bad createProgram
    const glNullProg = createMockGL()
    glNullProg.createProgram = vi.fn().mockReturnValue(null)
    expect(createProgram(glNullProg, '', '')).toBeNull()

    // Bad link status
    const glBadLink = createMockGL()
    glBadLink.getProgramParameter = vi.fn().mockReturnValue(false)
    expect(createProgram(glBadLink, '', '')).toBeNull()
    expect(glBadLink.deleteProgram).toHaveBeenCalled()

    // extractLocations with null program
    expect(extractLocations(gl, null)).toBeNull()
  })

  it('uploads uniforms and color parameters', () => {
    const gl = createMockGL()
    const prog = {} as WebGLProgram

    uploadUniforms(gl, prog, {
      time: 2,
      speed: 1.5,
      strength: 0.8,
      frequency: 12,
      chromatic: 0.05,
      iridescence: 0.4,
      localMouse: { x: 0.5, y: 0.5 },
    })
    expect(gl.uniform1f).toHaveBeenCalled()
    expect(gl.uniform2f).toHaveBeenCalled()

    uploadColorUniforms(gl, prog, {
      tintRgba: [1, 1, 1, 1],
      blendMode: 1,
      isDuotone: true,
      c1Rgba: [0, 0, 0, 1],
      c2Rgba: [1, 1, 1, 1],
    })
    expect(gl.uniform4fv).toHaveBeenCalled()
    expect(gl.uniform1i).toHaveBeenCalled()

    uploadColorUniforms(gl, prog, {
      tintRgba: [1, 1, 1, 1],
      blendMode: 0,
      isDuotone: false,
    })
  })

  it('manages viewport scissor testing and texture binding', () => {
    const gl = createMockGL()
    const canvas = document.createElement('canvas')
    canvas.height = 800

    const el = document.createElement('div')
    el.getBoundingClientRect = () => ({ left: 50, top: 100, bottom: 300, width: 200, height: 200 } as DOMRect)

    const rect = setupScissor(gl, el, canvas, { innerHeight: 800, devicePixelRatio: 1 } as unknown as Window)
    expect(rect).not.toBeNull()
    expect(gl.enable).toHaveBeenCalledWith(gl.SCISSOR_TEST)
    expect(gl.viewport).toHaveBeenCalled()
    expect(gl.scissor).toHaveBeenCalled()

    // Out of bounds / zero rects
    const elZero = document.createElement('div')
    elZero.getBoundingClientRect = () => ({ left: 0, top: 0, bottom: 0, width: 0, height: 0 } as DOMRect)
    expect(setupScissor(gl, elZero, canvas)).toBeNull()

    const elOffscreen = document.createElement('div')
    elOffscreen.getBoundingClientRect = () => ({ left: 0, top: 900, bottom: 1000, width: 100, height: 100 } as DOMRect)
    expect(setupScissor(gl, elOffscreen, canvas, { innerHeight: 800 } as unknown as Window)).toBeNull()

    // Texture binding
    bindShaderTexture(gl, {} as WebGLProgram, null) // no-op
    bindShaderTexture(gl, {} as WebGLProgram, {} as WebGLTexture)
    expect(gl.activeTexture).toHaveBeenCalled()
    expect(gl.bindTexture).toHaveBeenCalled()
  })

  it('drawElementQuad executes WebGL draw pass', () => {
    const gl = createMockGL()
    const canvas = document.createElement('canvas')
    canvas.height = 800

    const renderer = {
      gl,
      canvas,
      window: { innerHeight: 800, devicePixelRatio: 1 } as unknown as Window,
      programs: { displace: {} as WebGLProgram },
      quadBuffer: {},
      mouse: { x: 100, y: 150 },
    } as unknown as SharedShaderRenderer

    const el = document.createElement('div')
    el.getBoundingClientRect = () => ({ left: 50, top: 100, bottom: 300, width: 200, height: 200 } as DOMRect)

    drawElementQuad(renderer, el, { mode: 'displace' })
    expect(gl.useProgram).toHaveBeenCalled()
    expect(gl.drawArrays).toHaveBeenCalled()

    // When gl is null
    drawElementQuad({} as SharedShaderRenderer, el, {})
  })

  it('SharedShaderRenderer full lifecycle with mock GL and canvas', () => {
    const gl = createMockGL()
    const mockCanvas = document.createElement('canvas')
    mockCanvas.getContext = vi.fn().mockReturnValue(gl)

    let rafCallback: ((ts: number) => void) | null = null
    const fakeRaf = vi.fn((fn: (ts: number) => void) => {
      rafCallback = fn
      return 303
    })
    const fakeCaf = vi.fn()

    const renderer = new SharedShaderRenderer({
      createCanvas: () => mockCanvas,
      raf: fakeRaf,
      caf: fakeCaf,
      window: {
        innerWidth: 1000,
        innerHeight: 800,
        devicePixelRatio: 2,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    })

    expect(renderer.init()).toBe(true)
    expect(renderer.gl).toBe(gl)

    // Acquire and ref counting
    expect(renderer.acquire()).toBe(true)
    expect(renderer.refCount).toBe(1)

    // Event listener
    renderer.onPointer?.({ clientX: 250, clientY: 350 } as PointerEvent)
    expect(renderer.mouse.x).toBe(250)

    // Create texture
    const tex = renderer.createTexture({} as TexImageSource)
    expect(tex).toBeDefined()

    // Register draw call and run RAF tick
    const drawFn = vi.fn()
    renderer.register('quad-1', drawFn)
    expect(rafCallback).not.toBeNull()
    rafCallback!(1000)
    expect(drawFn).toHaveBeenCalled()

    // Context lost and restored events
    const mockLostEv = { preventDefault: vi.fn() } as unknown as Event
    renderer.onContextLost?.(mockLostEv)
    expect(mockLostEv.preventDefault).toHaveBeenCalled()
    expect(renderer.isContextLost).toBe(true)

    renderer.onContextRestored?.()
    expect(renderer.isContextLost).toBe(false)

    // Tick with drawCalls.size === 0
    renderer.drawCalls.clear()
    renderer.startLoop()
    expect(rafCallback).not.toBeNull()
    rafCallback!(2000)
    expect(renderer.rafId).toBeNull()

    // Stop loop and release
    renderer.unregister('quad-1')
    renderer.release()
    expect(renderer.refCount).toBe(0)
    expect(fakeCaf).toHaveBeenCalledWith(303)
  })

  it('SharedShaderRenderer handles null environments and failed initialization', () => {
    const rNoDoc = new SharedShaderRenderer({ document: null })
    expect(rNoDoc.init()).toBe(false)
    expect(rNoDoc.createCanvas()).toBeNull()

    const rNoCanvas = new SharedShaderRenderer({ createCanvas: () => null })
    expect(rNoCanvas.init()).toBe(false)

    const canvasNoCtx = document.createElement('canvas')
    canvasNoCtx.getContext = vi.fn().mockReturnValue(null)
    const rNoGL = new SharedShaderRenderer({ createCanvas: () => canvasNoCtx })
    expect(rNoGL.init()).toBe(false)

    const canvasNoGetContext = { style: {} } as unknown as HTMLCanvasElement
    const rNoGetCtx = new SharedShaderRenderer({ createCanvas: () => canvasNoGetContext })
    expect(rNoGetCtx.init()).toBe(false)

    const rSafe = new SharedShaderRenderer()
    expect(rSafe.createTexture({} as TexImageSource)).toBeNull()
    const id = rSafe.raf(() => {})
    rSafe.caf(id)
    expect(rSafe.createCanvas()).not.toBeNull()
    rSafe.renderFrame(1)
    rSafe.destroy()

    const rNullWin = new SharedShaderRenderer({ window: null })
    const gl = createMockGL()
    rNullWin.gl = gl
    rNullWin.canvas = null
    rNullWin.renderFrame(1)
    rNullWin.canvas = { width: 0, height: 0 } as HTMLCanvasElement
    rNullWin.renderFrame(1)
    rNullWin.renderFrame(2)
    expect(rNullWin.raf(() => {})).toBeNull()
    expect(rNullWin.caf(1)).toBeNull()
  })

  it('registers shaders primitive and presets into a Registry without touching core', () => {
    const registry = new Registry()
    registerShaders(registry)

    const resolved = registry.resolve('shaders')
    expect(resolved).toBeDefined()
    expect(resolved?.primitive.id).toBe('shaders')
    expect(resolved?.primitive.channels).toEqual(['opacity'])
    expect(resolved?.primitive.renderer).toBe('javascript')

    for (const preset of SHADERS_PRESETS) {
      const p = registry.resolve(preset.name)
      expect(p).toBeDefined()
      expect(p?.primitive.id).toBe('shaders')
    }
  })

  it('throws helpful error if registerShaders is called without valid target', () => {
    expect(() => registerShaders(null)).toThrow('kuinetic: registerShaders requires a Registry or Animator instance')
  })

  it('extractShaderOptions extracts options correctly and handles defaults', () => {
    const params = {
      text: vi.fn((k, def) => {
        if (k === 'color1') return '#ff0000'
        if (k === 'color2') return '#0000ff'
        return def
      }),
      num: vi.fn((k, def) => def),
    } as unknown as EffectParams

    const opt = extractShaderOptions(params)
    expect(opt.isDuotone).toBe(true)
    expect(opt.mode).toBe('displace')

    // Test with non-duotone and unknown blend mode (covers ?? 0 and || '#000000')
    const paramsDefault = {
      text: vi.fn((k) => (k === 'blend' ? 'unknown' : '')),
      num: vi.fn((k, def) => def),
    } as unknown as EffectParams
    const optDefault = extractShaderOptions(paramsDefault)
    expect(optDefault.blendMode).toBe(0)
    expect(optDefault.isDuotone).toBe(false)
  })

  it('tests sharedRenderer singleton reuse and release on zero', () => {
    setSharedShaderRenderer(null)
    const r1 = getSharedShaderRenderer()
    const r2 = getSharedShaderRenderer()
    expect(r1).toBe(r2)

    r1.release() // refCount is 0, release on 0 is a safe no-op
    expect(r1.refCount).toBe(0)
  })

  it('prepareShaders manages complete element lifecycle with mock renderer', () => {
    const gl = createMockGL()
    const mockCanvas = document.createElement('canvas')
    mockCanvas.getContext = vi.fn().mockReturnValue(gl)

    const customRenderer = new SharedShaderRenderer({
      createCanvas: () => mockCanvas,
      raf: vi.fn(),
      caf: vi.fn(),
      window: { innerWidth: 1000, innerHeight: 800, addEventListener: vi.fn(), removeEventListener: vi.fn() },
    })
    setSharedShaderRenderer(customRenderer)

    const img = document.createElement('img')
    Object.defineProperty(img, 'complete', { value: true })
    Object.defineProperty(img, 'naturalWidth', { value: 200 })

    const params = {
      text: vi.fn((k, def) => def),
      num: vi.fn((k, def) => def),
    } as unknown as EffectParams

    const inst = prepareShaders(img, params, createRealPrepareContext(img, { reducedMotion: false }))
    expect(inst).toBeDefined()
    inst.activate()
    inst.activate() // already active return
    // Call renderFrame on customRenderer to execute registered quad draw callback (drawCall)
    customRenderer.renderFrame(1)
    inst.cancel()
    inst.cancel() // already cancelled return
    inst.finish() // not active return
    inst.activate()
    inst.finish() // finish while active
    inst.activate()
    inst.destroy() // destroy while active

    // Test keyword parameter mode
    const kwParams = {
      keyword: vi.fn().mockReturnValue('displace'),
      num: vi.fn((k, def) => def),
      text: vi.fn((k, def) => def),
    } as unknown as EffectParams
    expect(extractShaderOptions(kwParams).mode).toBe('displace')

    // Test on uncompleted img with load event
    const uncompleteImg = document.createElement('img')
    Object.defineProperty(uncompleteImg, 'complete', { value: false })
    const instUncomplete = prepareShaders(uncompleteImg, params, createRealPrepareContext(uncompleteImg, { reducedMotion: false }))
    uncompleteImg.dispatchEvent(new Event('load'))
    instUncomplete.destroy()

    // Test on unknown mode (mode missing in programs)
    const unknownParams = {
      text: vi.fn((k, def) => (k === 'mode' ? 'unknown-mode' : def)),
      num: vi.fn((k, def) => def),
    } as unknown as EffectParams
    const instUnknown = prepareShaders(img, unknownParams, createRealPrepareContext(img, { reducedMotion: false }))
    expect(instUnknown).toBeDefined()
    instUnknown.destroy()

    // Test on a regular DIV (not an HTMLImageElement)
    const divEl = document.createElement('div')
    const instDiv = prepareShaders(divEl, params, createRealPrepareContext(divEl, { reducedMotion: false }))
    customRenderer.renderFrame(1)
    instDiv.destroy()

    // Reduced motion bail-out
    const instReduced = prepareShaders(img, params, createRealPrepareContext(img, { reducedMotion: true }))
    expect(instReduced).toBeDefined()
    instReduced.destroy()

    // Reset shared renderer
    setSharedShaderRenderer(null)
  })

  it('covers missing uniform locations, context loss, and setupScissor fallbacks', () => {
    const glNoUni = createMockGL()
    glNoUni.getUniformLocation = vi.fn().mockReturnValue(null)
    const prog = {} as WebGLProgram

    uploadUniforms(glNoUni, prog, { localMouse: { x: 0, y: 0 } })
    uploadColorUniforms(glNoUni, prog, { isDuotone: true })

    const canvas = document.createElement('canvas')
    const el = document.createElement('div')
    el.getBoundingClientRect = () => ({ left: 10, top: 10, bottom: 50, width: 50, height: 50 } as DOMRect)
    expect(setupScissor(glNoUni, el, canvas, null)).not.toBeNull()

    const rNoProg = {
      gl: glNoUni,
      canvas,
      window: { innerHeight: 800, devicePixelRatio: 1 },
      programs: {},
      mouse: { x: 0, y: 0 },
    } as unknown as SharedShaderRenderer
    drawElementQuad(rNoProg, el, { mode: 'missing' })

    const rWithPos = {
      gl: glNoUni,
      canvas,
      window: { innerHeight: 800, devicePixelRatio: 1 },
      programs: {
        displace: { program: prog, a_position: 0 },
      },
      mouse: { x: 0, y: 0 },
      quadBuffer: {},
    } as unknown as SharedShaderRenderer
    drawElementQuad(rWithPos, el, { mode: 'displace' })
    expect(glNoUni.enableVertexAttribArray).toHaveBeenCalledWith(0)

    // drawElementQuad with empty options (defaults to 'displace')
    drawElementQuad(rWithPos, el, {})

    const rContextLost = new SharedShaderRenderer()
    rContextLost.isContextLost = true
    rContextLost.renderFrame(1)
    rContextLost.startLoop()
    rContextLost.stopLoop()

    const rAcquireAgain = new SharedShaderRenderer()
    rAcquireAgain.gl = glNoUni
    expect(rAcquireAgain.acquire()).toBe(true)

    // uploadUniforms and uploadColorUniforms with null progInfo
    uploadUniforms(glNoUni, null as unknown as WebGLProgram, {} as any)
    uploadColorUniforms(glNoUni, null as unknown as WebGLProgram, {} as any)

    // setupScissor with default win
    expect(setupScissor(glNoUni, el, canvas)).not.toBeNull()

    // dispose raw WebGLProgram directly
    const rRawProg = new SharedShaderRenderer()
    rRawProg.gl = glNoUni
    rRawProg.programs = { raw: prog }
    rRawProg.destroy()
  })

  it('prepareShaders handles acquire failure', () => {
    const failRenderer = {
      acquire: vi.fn().mockReturnValue(false),
    } as unknown as SharedShaderRenderer
    setSharedShaderRenderer(failRenderer)

    const testImg = document.createElement('img')
    const inst = prepareShaders(testImg, {
      text: vi.fn((k, def) => (k === 'mode' || k === 'effect' ? 'displace' : def ?? '')),
      num: vi.fn().mockReturnValue(1),
    } as unknown as EffectParams, createRealPrepareContext(testImg, { reducedMotion: false }))

    expect(inst).toBeDefined()
    inst.activate()
    expect(failRenderer.acquire).toHaveBeenCalled()
    inst.destroy()

    setSharedShaderRenderer(null)
  })

  it('inertInstance methods are safe no-ops', () => {
    const onDestroy = vi.fn()
    const inst = inertInstance(onDestroy)
    inst.activate()
    inst.cancel()
    inst.finish()
    inst.destroy()
    expect(onDestroy).toHaveBeenCalled()
  })

  it('createGLTexture returns null when gl fails to create texture', () => {
    const gl = { createTexture: vi.fn().mockReturnValue(null) } as any
    expect(createGLTexture(gl, {} as any)).toBeNull()
  })

  // The success path this covered ("parseColor parses with canvas 2d context when available") is
  // now a real-browser check instead: jsdom has no canvas 2D context at all (see the
  // "Not implemented: HTMLCanvasElement.prototype.getContext" errors this suite logs), so a mocked
  // 2D context here was standing in for the entire subsystem, not exercising a branch of this
  // module's own logic. `test/browser/advanced-webgl.test.mjs`'s "real-color" check resolves an
  // unlisted CSS named color via a genuine canvas in real Chromium instead. This test keeps the
  // exception branch, which is this module's own code (the `catch` in `parseColorWithCanvas`) and
  // is exercised the same way whether the canvas underneath it is real or fake.
  it('parseColor handles getImageData exception gracefully', () => {
    const mock2dThrow = {
      clearRect: vi.fn(),
      fillStyle: '',
      fillRect: vi.fn(),
      getImageData: vi.fn().mockImplementation(() => { throw new Error('CORS') }),
    }
    const origCreate = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = origCreate(tag)
      if (tag === 'canvas') {
        (el as any).getContext = vi.fn().mockReturnValue(mock2dThrow)
      }
      return el
    })
    const c = parseColor('invalid-color-that-throws')
    expect(c).toEqual([1, 1, 1, 1])
    vi.restoreAllMocks()
  })

  it('restores original opacity when subsequent draw pass returns false', () => {
    const img = document.createElement('img')
    img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
    Object.defineProperty(img, 'complete', { value: true })
    Object.defineProperty(img, 'naturalWidth', { value: 100 })
    Object.defineProperty(img, 'naturalHeight', { value: 100 })
    let isVisible = true
    img.getBoundingClientRect = () => isVisible
      ? ({ left: 10, top: 10, right: 110, bottom: 110, width: 100, height: 100 } as DOMRect)
      : ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 } as DOMRect)

    const mockCanvas = document.createElement('canvas')
    mockCanvas.width = 1000
    mockCanvas.height = 800
    mockCanvas.getContext = vi.fn().mockReturnValue(createMockGL())

    let rafCb: FrameRequestCallback | null = null
    const renderer = new SharedShaderRenderer({
      createCanvas: () => mockCanvas,
      raf: (fn: FrameRequestCallback) => { rafCb = fn; return 55 },
    })
    setSharedShaderRenderer(renderer)

    const inst = prepareShaders(img, {
      keyword: vi.fn().mockReturnValue('displace'),
      num: vi.fn().mockReturnValue(0.5),
      text: vi.fn().mockReturnValue(''),
    } as any, createRealPrepareContext(img, { reducedMotion: false, createCanvas: () => mockCanvas }))

    inst.activate()
    // First frame: draws successfully, sets opacity: 0
    if (rafCb) (rafCb as any)(1000)
    expect(img.style.opacity).toBe('0')

    // Second frame: element becomes invisible / offscreen, drew = false, restores prevOpacity
    isVisible = false
    if (rafCb) (rafCb as any)(1016)
    expect(img.style.opacity).toBe('')

    inst.destroy()
    renderer.destroy()
  })

  it('createGLTexture catches texImage2D error and deletes texture', () => {
    const mockGL = createMockGL()
    mockGL.texImage2D = vi.fn().mockImplementation(() => {
      throw new Error('CORS / WebGL error')
    })
    const res = createGLTexture(mockGL as any, {} as any)
    expect(res).toBeNull()
    expect(mockGL.deleteTexture).toHaveBeenCalled()
  })

  describe('a texture upload that fails without throwing', () => {
    /** The mock GL plus the two entry points `createGLTexture`'s new guards read. */
    function glWithLimits(maxTextureSize: unknown, errors: unknown[]) {
      return {
        ...createMockGL(),
        MAX_TEXTURE_SIZE: 3379,
        getParameter: vi.fn(() => maxTextureSize),
        getError: vi.fn(() => (errors.length > 0 ? errors.shift() : 0)),
      }
    }

    it('refuses a source larger than MAX_TEXTURE_SIZE, before allocating anything', () => {
      const gl = glWithLimits(4096, [])
      // A 2x srcset hero. `texImage2D` would set INVALID_VALUE and leave the texture incomplete,
      // which WebGL2 samples as opaque black — and the caller reads a returned texture as "drew",
      // hides the element and paints the black over it.
      expect(createGLTexture(gl as any, { naturalWidth: 5120, naturalHeight: 2880 } as any)).toBeNull()
      expect(gl.texImage2D).not.toHaveBeenCalled()
      expect(gl.createTexture).not.toHaveBeenCalled()

      // The same image on a device that can take it.
      expect(createGLTexture(glWithLimits(8192, []) as any, { naturalWidth: 5120, naturalHeight: 2880 } as any)).not.toBeNull()
    })

    it('reads the extent from whichever pair the source carries, and lets an unmeasurable one through', () => {
      // `TexImageSource` is a union and each member names its size differently: `<video>`.
      expect(createGLTexture(glWithLimits(4096, []) as any, { videoWidth: 8000, videoHeight: 100 } as any)).toBeNull()
      // A canvas or an `ImageBitmap`.
      expect(createGLTexture(glWithLimits(4096, []) as any, { width: 100, height: 9000 } as any)).toBeNull()
      // An `<img>`, whose `width`/`height` are the *layout* box — the natural size is the one the
      // upload is measured against, and it is the larger of the two here.
      expect(createGLTexture(glWithLimits(4096, []) as any, { naturalWidth: 5120, naturalHeight: 2880, width: 400, height: 225 } as any)).toBeNull()
      // No dimensions at all is not evidence of an oversized source, so it must still upload.
      expect(createGLTexture(glWithLimits(4096, []) as any, {} as any)).not.toBeNull()
    })

    it('treats a GL error raised by the upload as a failed upload', () => {
      // 1285 is OUT_OF_MEMORY: texImage2D returns normally and the texture is incomplete.
      const gl = glWithLimits(8192, [0, 1285])
      expect(createGLTexture(gl as any, { width: 10, height: 10 } as any)).toBeNull()
      expect(gl.deleteTexture).toHaveBeenCalled()
    })

    it('drains errors left by an earlier caller rather than blaming the upload for them', () => {
      // A neighbouring instance's draw left 1282 (INVALID_OPERATION) queued. The drain clears it
      // before the upload, so the check afterwards reports only this upload's own result.
      const gl = glWithLimits(8192, [1282, 0, 0])
      expect(createGLTexture(gl as any, { width: 10, height: 10 } as any)).not.toBeNull()
      expect(gl.deleteTexture).not.toHaveBeenCalled()
    })

    it('stays inert against a context that reports neither a limit nor an error', () => {
      // Every GL double in these suites is this shape. A guard that read `undefined` as "oversized"
      // or as "errored" would turn every mocked upload into a dead effect.
      const bare = createMockGL()
      expect(createGLTexture(bare as any, { naturalWidth: 99999, naturalHeight: 99999 } as any)).not.toBeNull()
      const junk = glWithLimits(undefined, [undefined])
      expect(createGLTexture(junk as any, { naturalWidth: 99999, naturalHeight: 99999 } as any)).not.toBeNull()
    })
  })

  it('renderFrame catches individual draw errors and continues next callbacks without aborting RAF', () => {
    const mockCanvas = document.createElement('canvas')
    mockCanvas.getContext = vi.fn().mockReturnValue(createMockGL())
    const renderer = new SharedShaderRenderer({ createCanvas: () => mockCanvas })
    renderer.acquire()
    const badDraw = vi.fn().mockImplementation(() => { throw new Error('boom') })
    const goodDraw = vi.fn()
    renderer.register('bad', badDraw)
    renderer.register('good', goodDraw)
    renderer.renderFrame(1.0)
    expect(badDraw).toHaveBeenCalled()
    expect(goodDraw).toHaveBeenCalled()
    expect(renderer.drawCalls.has('bad')).toBe(false)
    expect(renderer.drawCalls.has('good')).toBe(true)
    renderer.destroy()
  })

  it('drawCall catches exception in drawElementQuad, restores opacity, and unregisters', () => {
    const img = document.createElement('img')
    img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
    Object.defineProperty(img, 'complete', { value: true })
    img.style.opacity = '1'
    Object.defineProperty(img, 'naturalWidth', { value: 100 })
    Object.defineProperty(img, 'naturalHeight', { value: 100 })
    img.getBoundingClientRect = () => ({ left: 10, top: 10, right: 110, bottom: 110, width: 100, height: 100 } as DOMRect)
    const mockGL = createMockGL()
    mockGL.drawArrays = vi.fn().mockImplementation(() => { throw new Error('GL draw failure') })
    const mockCanvas = document.createElement('canvas')
    mockCanvas.getContext = vi.fn().mockReturnValue(mockGL)
    let rafCb: FrameRequestCallback | null = null
    const renderer = new SharedShaderRenderer({
      createCanvas: () => mockCanvas,
      raf: (fn) => { rafCb = fn; return 1 },
    })
    setSharedShaderRenderer(renderer)
    const inst = prepareShaders(img, {
      keyword: vi.fn().mockReturnValue('displace'),
      num: vi.fn().mockReturnValue(0.5),
      text: vi.fn().mockReturnValue(''),
    } as any, createRealPrepareContext(img, { reducedMotion: false, createCanvas: () => mockCanvas }))
    inst.activate()
    expect(rafCb).not.toBeNull()
    if (rafCb) (rafCb as any)(1000)
    expect(img.style.opacity).toBe('1')
    inst.destroy()
    renderer.destroy()
    setSharedShaderRenderer(null)
  })

  it('preserves authored opacity: 0 across false draw, context loss, and destruction', () => {
    const img = document.createElement('img')
    img.style.opacity = '0'
    Object.defineProperty(img, 'naturalWidth', { value: 100 })
    Object.defineProperty(img, 'naturalHeight', { value: 100 })
    img.getBoundingClientRect = () => ({ left: 10, top: 10, right: 110, bottom: 110, width: 100, height: 100 } as DOMRect)
    const mockCanvas = document.createElement('canvas')
    mockCanvas.getContext = vi.fn().mockReturnValue(createMockGL())
    const renderer = new SharedShaderRenderer({ createCanvas: () => mockCanvas })
    const inst = prepareShaders(img, {
      keyword: vi.fn().mockReturnValue('displace'),
      num: vi.fn().mockReturnValue(0.5),
      text: vi.fn().mockReturnValue(''),
    } as any, createRealPrepareContext(img, { reducedMotion: false, createCanvas: () => mockCanvas }))
    inst.activate()
    inst.cancel()
    expect(img.style.opacity).toBe('0')
    inst.destroy()
    expect(img.style.opacity).toBe('0')
    renderer.destroy()
  })

  it('handles webglcontextrestored and calls callbacks on shader instance', () => {
    const img = document.createElement('img')
    img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
    Object.defineProperty(img, 'complete', { value: true })
    Object.defineProperty(img, 'naturalWidth', { value: 100 })
    Object.defineProperty(img, 'naturalHeight', { value: 100 })
    img.getBoundingClientRect = () => ({ left: 10, top: 10, right: 110, bottom: 110, width: 100, height: 100 } as DOMRect)
    const mockCanvas = document.createElement('canvas')
    const mockGL = createMockGL()
    mockCanvas.getContext = vi.fn().mockReturnValue(mockGL)
    const renderer = new SharedShaderRenderer({ createCanvas: () => mockCanvas })
    setSharedShaderRenderer(renderer)
    const inst = prepareShaders(img, {
      keyword: vi.fn().mockReturnValue('displace'),
      num: vi.fn().mockReturnValue(0.5),
      text: vi.fn().mockReturnValue(''),
    } as any, createRealPrepareContext(img, { reducedMotion: false, createCanvas: () => mockCanvas }))
    inst.activate()
    mockCanvas.dispatchEvent(new Event('webglcontextlost'))
    expect(renderer.isContextLost).toBe(true)
    mockCanvas.dispatchEvent(new Event('webglcontextrestored'))
    expect(renderer.isContextLost).toBe(false)
    inst.destroy()
    renderer.destroy()
    setSharedShaderRenderer(null)
  })

  /**
   * An initialised renderer over a mock canvas and GL, with a `raf` that never fires.
   *
   * jsdom's `getContext('webgl2')` is null, so `init()` fails and `renderFrame` returns at its
   * first guard — every check below would pass on any implementation. The stubbed `raf` keeps
   * `register()`'s `startLoop()` from queueing a frame the test did not ask for, so the only
   * `renderFrame` that runs is the one the test calls.
   */
  function liveRenderer(): { renderer: SharedShaderRenderer; gl: ReturnType<typeof createMockGL> } {
    const gl = createMockGL()
    const mockCanvas = document.createElement('canvas')
    mockCanvas.getContext = vi.fn().mockReturnValue(gl)
    const renderer = new SharedShaderRenderer({
      createCanvas: () => mockCanvas,
      raf: vi.fn(() => 1),
      caf: vi.fn(),
      window: {
        innerWidth: 100, innerHeight: 100, devicePixelRatio: 1,
        addEventListener: vi.fn(), removeEventListener: vi.fn(),
      },
    })
    expect(renderer.init()).toBe(true)
    expect(renderer.gl).toBe(gl)
    return { renderer, gl }
  }

  describe('renderer revival', () => {
    it('never brings a destroyed renderer back, and never evicts the live one', () => {
      const doc = document.implementation.createHTMLDocument('revival')
      const env = { document: doc }
      const first = getSharedShaderRenderer(env)

      first.destroy()
      expect(first.isDestroyed).toBe(true)
      // The object a prepared-but-never-activated instance is still holding. `init()` here built a
      // second full-viewport canvas and WebGL2 context on a renderer no longer in the map.
      expect(first.acquire()).toBe(false)
      expect(first.gl).toBeNull()
      expect(first.canvas).toBeNull()

      const second = getSharedShaderRenderer(env)
      expect(second).not.toBe(first)

      // A late second teardown of the dead one must not delete the *live* one's map entry, which
      // is what let the count keep climbing on a page that cycles shader elements.
      first.destroy()
      expect(getSharedShaderRenderer(env)).toBe(second)

      second.destroy()
      expect(getSharedShaderRenderer(env)).not.toBe(second)
    })

    it('puts an orphaned reference back onto the live renderer', () => {
      const doc = document.implementation.createHTMLDocument('ref')
      const ref = createRendererRef({ document: doc })
      const first = ref.get()

      expect(ref.get()).toBe(first)
      first.destroy()

      const live = ref.get()
      expect(live).not.toBe(first)
      expect(live.isDestroyed).toBe(false)
      // Memoised again, so a per-frame caller is not re-resolving through the map.
      expect(ref.get()).toBe(live)
      live.destroy()
    })

    it('stops the frame when a draw call disposes the context under it', () => {
      const control = liveRenderer()
      const ranBoth: string[] = []
      control.renderer.register('a', () => { ranBoth.push('a') })
      control.renderer.register('b', () => { ranBoth.push('b') })
      control.renderer.renderFrame(0)
      // The control. Without it a loop that never ran anything would pass the real check below.
      expect(ranBoth).toEqual(['a', 'b'])
      control.renderer.destroy()

      const { renderer, gl } = liveRenderer()
      expect(renderer.acquire()).toBe(true)
      const sawContext: Array<WebGLRenderingContext | WebGL2RenderingContext> = []
      // `release()` from the last holder is `destroy()`: `gl` is nulled and the programs are gone.
      // The second entry is still in the iterator's snapshot, and used to be handed the `gl` the
      // frame captured before the loop — a disposed context, on a renderer already `isDestroyed`.
      renderer.register('a', () => { renderer.release() })
      renderer.register('b', (passed) => { sawContext.push(passed) })

      renderer.renderFrame(0)

      expect(renderer.isDestroyed).toBe(true)
      expect(renderer.gl).toBeNull()
      expect(sawContext).toEqual([])
      // Specifically: not the dead handle. Distinguishes "did not run" from "ran with a live one".
      expect(sawContext).not.toContain(gl)
    })

    it('stops the frame when a draw call loses the context under it', () => {
      const { renderer } = liveRenderer()
      expect(renderer.acquire()).toBe(true)
      const ran: string[] = []
      renderer.register('a', () => {
        ran.push('a')
        renderer.onContextLost?.({ preventDefault: () => {} } as unknown as Event)
      })
      renderer.register('b', () => { ran.push('b') })

      renderer.renderFrame(0)

      expect(renderer.isContextLost).toBe(true)
      // `gl` is still non-null here — only the lost flag says the programs and buffers are gone.
      expect(ran).toEqual(['a'])
      renderer.destroy()
    })
  })

  it('isolates SharedShaderRenderer across documents using WeakMap', () => {
    const docA = document.implementation.createHTMLDocument('A')
    const docB = document.implementation.createHTMLDocument('B')
    const rA = getSharedShaderRenderer({ document: docA })
    const rB = getSharedShaderRenderer({ document: docB })
    expect(rA).not.toBe(rB)
    rA.destroy()
    rB.destroy()
  })

  it('setupScissor computes UV crop and returns null when fully clipped horizontally', () => {
    const mockGL = createMockGL()
    const mockCanvas = document.createElement('canvas')
    mockCanvas.width = 500
    mockCanvas.height = 500
    const elClipped = document.createElement('div')
    elClipped.getBoundingClientRect = () => ({ left: -100, top: 50, right: -50, bottom: 100, width: 50, height: 50 } as DOMRect)
    const resClipped = setupScissor(mockGL as any, elClipped, mockCanvas)
    expect(resClipped).toBeNull()

    const elPartial = document.createElement('div')
    elPartial.getBoundingClientRect = () => ({ left: -50, top: 0, right: 50, bottom: 100, width: 100, height: 100 } as DOMRect)
    const resPartial = setupScissor(mockGL as any, elPartial, mockCanvas, { innerHeight: 500, devicePixelRatio: 1 } as any)
    expect(resPartial).not.toBeNull()
    expect(resPartial?.uvOrigin[0]).toBeCloseTo(0.5, 2)
    expect(resPartial?.uvScale[0]).toBeCloseTo(0.5, 2)

    // Window with undefined dimensions fallback
    const resPartialFallback = setupScissor(mockGL as any, elPartial, mockCanvas, {} as any)
    expect(resPartialFallback).not.toBeNull()
  })

  it('parseColor handles hex, named colors, and unrecognized color fallback', () => {
    expect(parseColor('#ff0000')).toEqual([1, 0, 0, 1])
    expect(parseColor('magenta')).toEqual([1, 0, 1, 1])
    expect(parseColor('nonexistent-color')).toEqual([1, 1, 1, 1])
  })

  it('uploadUniforms handles speed undefined fallback', () => {
    const mockGL = createMockGL()
    const prog = createProgram(mockGL as any, 'void main(){}', 'void main(){}')
    const locs = extractLocations(mockGL as any, prog!)
    uploadUniforms(mockGL as any, locs, { time: 2.0 })
    expect(mockGL.uniform1f).toHaveBeenCalled()
  })

  it('SharedShaderRenderer handles null gl in initQuad and initPrograms, and WeakMap key fallbacks', () => {
    const renderer = new SharedShaderRenderer()
    renderer.gl = null
    expect(() => renderer.initQuad()).not.toThrow()
    expect(() => renderer.initPrograms()).not.toThrow()

    const fakeWin = {} as any
    const rWin = getSharedShaderRenderer({ document: null, window: fakeWin })
    expect(rWin).toBeDefined()
    rWin.destroy()

    const rNullAll = getSharedShaderRenderer({ document: null, window: null })
    expect(rNullAll).toBeDefined()
    setSharedShaderRenderer(null, { document: null, window: null })
    rNullAll.destroy()
  })

  it('prepareShaders handles el with no ownerDocument and cleans up morph toTexture', () => {
    const mockGL = createMockGL()
    const mockCanvas = document.createElement('canvas')
    mockCanvas.getContext = vi.fn().mockReturnValue(mockGL)
    const renderer = new SharedShaderRenderer({ createCanvas: () => mockCanvas })
    setSharedShaderRenderer(renderer)

    const img1 = document.createElement('img')
    img1.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
    Object.defineProperty(img1, 'complete', { value: true })
    Object.defineProperty(img1, 'naturalWidth', { value: 100 })
    Object.defineProperty(img1, 'naturalHeight', { value: 100 })

    const img2 = document.createElement('img')
    img2.id = 'target-morph'
    img2.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
    Object.defineProperty(img2, 'complete', { value: true })
    Object.defineProperty(img2, 'naturalWidth', { value: 100 })
    Object.defineProperty(img2, 'naturalHeight', { value: 100 })
    document.body.appendChild(img2)

    const elNoDoc = {} as HTMLElement
    const instNoDoc = prepareShaders(elNoDoc, {
      text: (n: string) => {
        if (n === 'mode') return 'morph'
        if (n === 'to') return '#target-morph'
        return ''
      },
      num: () => 1,
    } as any, createRealPrepareContext(elNoDoc, { reducedMotion: false, createCanvas: () => mockCanvas }))
    expect(instNoDoc).toBeDefined()
    instNoDoc.activate()
    instNoDoc.destroy()

    img2.remove()

    // to target that is a div, not an image
    const divTarget = document.createElement('div')
    divTarget.id = 'target-div'
    document.body.appendChild(divTarget)
    const instDiv = prepareShaders(img1, {
      text: (n: string) => {
        if (n === 'mode') return 'morph'
        if (n === 'to') return '#target-div'
        return ''
      },
      num: () => 1,
    } as any, createRealPrepareContext(img1, { reducedMotion: false, createCanvas: () => mockCanvas }))
    instDiv.activate()
    instDiv.destroy()
    divTarget.remove()

    renderer.destroy()
    setSharedShaderRenderer(null)

    // activate() when acquire() fails
    const badCanvas = document.createElement('canvas')
    badCanvas.getContext = vi.fn().mockReturnValue(null)
    const rBad = new SharedShaderRenderer({ createCanvas: () => badCanvas })
    setSharedShaderRenderer(rBad)
    const instBad = prepareShaders(img1, {
      text: (n: string) => n === 'mode' ? 'displace' : '',
      num: () => 1,
    } as any, createRealPrepareContext(img1, { reducedMotion: false, createCanvas: () => badCanvas }))
    instBad.activate()
    instBad.destroy()
    rBad.destroy()
    setSharedShaderRenderer(null)
  })

  it('a throwing onLost does not abort the frame or starve the loop', () => {
    const mockCanvas = document.createElement('canvas')
    mockCanvas.getContext = vi.fn().mockReturnValue(createMockGL())
    let scheduled = 0
    const renderer = new SharedShaderRenderer({
      createCanvas: () => mockCanvas,
      raf: () => { scheduled += 1; return 9 },
    })
    renderer.acquire()

    const badDraw = vi.fn().mockImplementation(() => { throw new Error('draw boom') })
    const badOnLost = vi.fn().mockImplementation(() => { throw new Error('cleanup boom') })
    const goodDraw = vi.fn()
    renderer.register('bad', badDraw, { onLost: badOnLost, onRestored: () => {} })
    renderer.register('good', goodDraw)

    expect(() => renderer.renderFrame(1.0)).not.toThrow()
    expect(badOnLost).toHaveBeenCalled()
    // The failing instance is gone; the one behind it in the map still drew this frame.
    expect(renderer.drawCalls.has('bad')).toBe(false)
    expect(goodDraw).toHaveBeenCalled()

    scheduled = 0
    renderer.rafId = null
    renderer.startLoop()
    expect(scheduled).toBe(1)
    renderer.destroy()
  })

  it('a throwing onLost does not stop the context-loss fan-out', () => {
    const mockCanvas = document.createElement('canvas')
    mockCanvas.getContext = vi.fn().mockReturnValue(createMockGL())
    const renderer = new SharedShaderRenderer({ createCanvas: () => mockCanvas })
    renderer.acquire()

    const secondOnLost = vi.fn()
    renderer.register('first', vi.fn(), {
      onLost: () => { throw new Error('cleanup boom') },
      onRestored: () => {},
    })
    renderer.register('second', vi.fn(), { onLost: secondOnLost, onRestored: () => {} })

    expect(() => renderer.onContextLost?.(new Event('webglcontextlost'))).not.toThrow()
    expect(secondOnLost).toHaveBeenCalled()
    expect(renderer.isContextLost).toBe(true)

    const secondOnRestored = vi.fn()
    renderer.contextCallbacks.set('first', {
      onLost: () => {},
      onRestored: () => { throw new Error('restore boom') },
    })
    renderer.contextCallbacks.set('second', { onLost: () => {}, onRestored: secondOnRestored })
    expect(() => renderer.onContextRestored?.()).not.toThrow()
    expect(secondOnRestored).toHaveBeenCalled()
    expect(renderer.isContextLost).toBe(false)
    renderer.destroy()
  })

  it('setSharedShaderRenderer stores under the key the instance own destroy() deletes', () => {
    const otherDoc = document.implementation.createHTMLDocument('other')
    const foreign = new SharedShaderRenderer({ document: otherDoc, window: null })
    expect(foreign.mapKey).toBe(otherDoc)

    // Installed with *this* document's env, but it belongs to `otherDoc`.
    setSharedShaderRenderer(foreign)

    // This document must not be handed a renderer whose destroy() will never clear this key.
    const here = getSharedShaderRenderer()
    expect(here).not.toBe(foreign)
    // Its own document still finds it.
    expect(getSharedShaderRenderer({ document: otherDoc, window: null })).toBe(foreign)

    // And destroying it really does empty the map entry it was stored under.
    foreign.destroy()
    expect(getSharedShaderRenderer({ document: otherDoc, window: null })).not.toBe(foreign)

    here.destroy()
    setSharedShaderRenderer(null)
    setSharedShaderRenderer(null, { document: otherDoc, window: null })
  })

  it('restores an authored opacity with its priority and leaves no empty style attribute', () => {
    const authored = document.createElement('img')
    authored.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
    Object.defineProperty(authored, 'complete', { value: true })
    Object.defineProperty(authored, 'naturalWidth', { value: 100 })
    Object.defineProperty(authored, 'naturalHeight', { value: 100 })
    authored.getBoundingClientRect = () => ({ left: 10, top: 10, right: 110, bottom: 110, width: 100, height: 100 } as DOMRect)
    authored.style.setProperty('opacity', '0.4', 'important')

    const bare = document.createElement('img')
    bare.src = authored.src
    Object.defineProperty(bare, 'complete', { value: true })
    Object.defineProperty(bare, 'naturalWidth', { value: 100 })
    Object.defineProperty(bare, 'naturalHeight', { value: 100 })
    bare.getBoundingClientRect = () => ({ left: 10, top: 10, right: 110, bottom: 110, width: 100, height: 100 } as DOMRect)
    expect(bare.hasAttribute('style')).toBe(false)

    const mockCanvas = document.createElement('canvas')
    mockCanvas.width = 1000
    mockCanvas.height = 800
    mockCanvas.getContext = vi.fn().mockReturnValue(createMockGL())

    const frames: FrameRequestCallback[] = []
    const renderer = new SharedShaderRenderer({
      createCanvas: () => mockCanvas,
      raf: (fn: FrameRequestCallback) => { frames.push(fn); return frames.length },
    })
    setSharedShaderRenderer(renderer)

    const params = {
      keyword: vi.fn().mockReturnValue('displace'),
      num: vi.fn().mockReturnValue(0.5),
      text: vi.fn().mockReturnValue(''),
    } as any
    const ctxA = createRealPrepareContext(authored, { reducedMotion: false, createCanvas: () => mockCanvas })
    const ctxB = createRealPrepareContext(bare, { reducedMotion: false, createCanvas: () => mockCanvas })
    const instA = prepareShaders(authored, params, ctxA)
    const instB = prepareShaders(bare, params, ctxB)
    instA.activate()
    instB.activate()
    frames[0]?.(1000)

    expect(authored.style.opacity).toBe('0')
    expect(bare.style.opacity).toBe('0')

    // Release, in the animator's order (`animator.ts` `release()`): every `instance.destroy()`
    // first, then the host's ledger. The instance now writes to `ctx.style` rather than a private
    // ledger of its own, so `ctx.style.restore()` is not test scaffolding — it is the second half
    // of the teardown, and the half that owns the author's value. Skipping it here would assert a
    // sequence production never runs.
    instA.destroy()
    instB.destroy()
    ctxA.style.restore()
    ctxB.style.restore()

    // The author wrote `!important`; a plain setProperty on the way back would silently drop it.
    expect(authored.style.opacity).toBe('0.4')
    expect(authored.style.getPropertyPriority('opacity')).toBe('important')
    // And an element that had no `style` attribute must not be left carrying an empty one.
    expect(bare.style.opacity).toBe('')
    expect(bare.hasAttribute('style')).toBe(false)

    renderer.destroy()
    setSharedShaderRenderer(null)
  })

  it('shares one capture with the other writers on the element, and gives back only opacity', () => {
    const el = document.createElement('img')
    el.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
    Object.defineProperty(el, 'complete', { value: true })
    Object.defineProperty(el, 'naturalWidth', { value: 100 })
    Object.defineProperty(el, 'naturalHeight', { value: 100 })
    el.getBoundingClientRect = () => ({ left: 10, top: 10, right: 110, bottom: 110, width: 100, height: 100 } as DOMRect)
    el.style.opacity = '0.4'

    const mockCanvas = document.createElement('canvas')
    mockCanvas.width = 1000
    mockCanvas.height = 800
    mockCanvas.getContext = vi.fn().mockReturnValue(createMockGL())
    const frames: FrameRequestCallback[] = []
    const renderer = new SharedShaderRenderer({
      createCanvas: () => mockCanvas,
      raf: (fn: FrameRequestCallback) => { frames.push(fn); return frames.length },
    })
    setSharedShaderRenderer(renderer)

    const ctx = createRealPrepareContext(el, { reducedMotion: false, createCanvas: () => mockCanvas })
    const inst = prepareShaders(el, {
      keyword: vi.fn().mockReturnValue('displace'),
      num: vi.fn().mockReturnValue(0.5),
      text: vi.fn().mockReturnValue(''),
    } as any, ctx)

    // A CSS-rendered effect on the same element, through the animator's ledger, already mid-run:
    // one writer on `opacity`, one on a property the shader never touches.
    ctx.style.set('opacity', '0.9')
    ctx.style.set('transform', 'scale(2)')

    inst.activate()
    frames[0]?.(1000)
    expect(el.style.opacity).toBe('0')

    // Mid-life give-back — a cancelled effect, not a teardown. The animator has not released the
    // element and the co-writer is still running.
    inst.cancel()

    // One capture between the two writers: what comes back is the *author's* value. With a ledger
    // of its own the shader would have captured `0.9` at its first write — the co-writer's frame
    // value, read as the author's — and pinned the element to it.
    expect(el.style.opacity).toBe('0.4')
    // And only `opacity`: whole-ledger `restore()` over a shared ledger would have unwound the
    // co-writer's transform at the same time, while it is still running.
    expect(el.style.transform).toBe('scale(2)')

    inst.destroy()
    ctx.style.restore()
    expect(el.style.opacity).toBe('0.4')
    expect(el.style.transform).toBe('')

    renderer.destroy()
    setSharedShaderRenderer(null)
  })

  describe('the audio band a shader can follow', () => {
    /** Params as the animator hands them over: every schema key present, `audio` chosen. */
    function audioParams(audio: string): EffectParams {
      return {
        text: (name: string, fallback = '') => (name === 'audio' ? audio : fallback),
        num: (_name: string, fallback = 0) => fallback,
      } as unknown as EffectParams
    }

    /** Every value uploaded to `u_audio` across the frames this mock GL saw. */
    function audioUploads(gl: WebGL2RenderingContext): unknown[] {
      const calls = (gl.uniform1f as unknown as { mock: { calls: unknown[][] } }).mock.calls
      return calls.filter((c) => (c[0] as { name?: string })?.name === 'u_audio').map((c) => c[1])
    }

    function drawOneFrame(el: HTMLElement, params: EffectParams) {
      const gl = createMockGL()
      const mockCanvas = document.createElement('canvas')
      mockCanvas.width = 1000
      mockCanvas.height = 800
      mockCanvas.getContext = vi.fn().mockReturnValue(gl)
      const frames: FrameRequestCallback[] = []
      const renderer = new SharedShaderRenderer({
        createCanvas: () => mockCanvas,
        raf: (fn: FrameRequestCallback) => { frames.push(fn); return frames.length },
      })
      setSharedShaderRenderer(renderer)
      const inst = prepareShaders(el, params, createRealPrepareContext(el, { reducedMotion: false, createCanvas: () => mockCanvas }))
      inst.activate()
      frames[0]?.(1000)
      const uploads = audioUploads(gl)
      inst.destroy()
      renderer.destroy()
      setSharedShaderRenderer(null)
      return uploads
    }

    it('declares one closed, off-by-default keyword list', () => {
      expect(SHADER_PARAMETERS.audio.type).toBe('keyword')
      expect(SHADER_PARAMETERS.audio.default).toBe('off')
      expect(SHADER_PARAMETERS.audio.keywords).toEqual(['off', 'bass', 'mid', 'treble', 'level'])
    })

    it('takes the band from the authored parameters and refuses anything else as one', () => {
      expect(extractShaderOptions(audioParams('bass')).audioBand).toBe('bass')
      expect(extractShaderOptions(audioParams('level')).audioBand).toBe('level')
      expect(extractShaderOptions(audioParams('off')).audioBand).toBeNull()
      expect(extractShaderOptions(audioParams('')).audioBand).toBeNull()
      expect(extractShaderOptions(audioParams('loudness')).audioBand).toBeNull()
    })

    it('uploads the band it read from the element', () => {
      const img = shaderImg()
      img.style.setProperty('--kui-audio-bass', '0.5')
      expect(drawOneFrame(img, audioParams('bass'))).toEqual([0.5])
    })

    it('uploads 0 for an element whose driver is silent, and clamps a value above 1', () => {
      const silent = shaderImg()
      silent.style.setProperty('--kui-audio-mid', '0.000')
      expect(drawOneFrame(silent, audioParams('mid'))).toEqual([0])

      const shouting = shaderImg()
      shouting.style.setProperty('--kui-audio-treble', '9')
      expect(drawOneFrame(shouting, audioParams('treble'))).toEqual([1])
    })

    it('uploads 0 with no band selected, even when the properties are right there', () => {
      const img = shaderImg()
      // Every band at full scale, and an `audio-source` on this very element: without `audio:`
      // the shader must still draw exactly as it did before the parameter existed.
      for (const prop of ['--kui-audio-bass', '--kui-audio-mid', '--kui-audio-treble', '--kui-audio-level']) {
        img.style.setProperty(prop, '1')
      }
      expect(drawOneFrame(img, audioParams('off'))).toEqual([0])
    })

    it('reads the computed value when the element has none of its own, which is the ancestor case', () => {
      const img = shaderImg()
      document.body.appendChild(img)
      const computed = vi.spyOn(window, 'getComputedStyle').mockReturnValue({
        getPropertyValue: (name: string) => (name === '--kui-audio-level' ? '0.75' : ''),
      } as unknown as CSSStyleDeclaration)

      expect(drawOneFrame(img, audioParams('level'))).toEqual([0.75])

      computed.mockRestore()
      img.remove()
    })
  })

  /**
   * The scroll bridge, and the parameter that gates it.
   *
   * `--kui-progress` is what `scroll-progress` and the rest of the scroll family publish, and it
   * is an ordinary inheriting custom property. This module used to read it unconditionally, so
   * every shader anywhere inside a scrollytelling section was scrubbed by an ancestor it had
   * never heard of — and because the published value at the top of a range is `0`, and every
   * program multiplies its effect by it, the shader drew a pixel-faithful copy of its own source
   * and looked dead. The pickup is now `scrub: scroll`, opt-in, mirroring `audio:` above.
   *
   * Both directions are asserted here, and the ancestor case twice over: the value a shader that
   * did not opt in must ignore is exactly the value that used to kill it.
   */
  describe('the scroll progress a shader can follow', () => {
    /** Params as the animator hands them over: every schema key present, `scrub`/`progress` chosen. */
    function scrubParams(scrub: string, progress = -1): EffectParams {
      return {
        text: (name: string, fallback = '') => (name === 'scrub' ? scrub : fallback),
        num: (name: string, fallback = 0) => (name === 'progress' ? progress : fallback),
      } as unknown as EffectParams
    }

    /** Every value uploaded to `u_progress` across the frames this mock GL saw. */
    function progressUploads(gl: WebGL2RenderingContext): unknown[] {
      const calls = (gl.uniform1f as unknown as { mock: { calls: unknown[][] } }).mock.calls
      return calls.filter((c) => (c[0] as { name?: string })?.name === 'u_progress').map((c) => c[1])
    }

    function drawOneFrame(el: HTMLElement, params: EffectParams) {
      const gl = createMockGL()
      const mockCanvas = document.createElement('canvas')
      mockCanvas.width = 1000
      mockCanvas.height = 800
      mockCanvas.getContext = vi.fn().mockReturnValue(gl)
      const frames: FrameRequestCallback[] = []
      const renderer = new SharedShaderRenderer({
        createCanvas: () => mockCanvas,
        raf: (fn: FrameRequestCallback) => { frames.push(fn); return frames.length },
      })
      setSharedShaderRenderer(renderer)
      const inst = prepareShaders(el, params, createRealPrepareContext(el, { reducedMotion: false, createCanvas: () => mockCanvas }))
      inst.activate()
      frames[0]?.(1000)
      const uploads = progressUploads(gl)
      inst.destroy()
      renderer.destroy()
      setSharedShaderRenderer(null)
      return uploads
    }

    it('declares one closed, off-by-default keyword list', () => {
      expect(SHADER_PARAMETERS.scrub.type).toBe('keyword')
      expect(SHADER_PARAMETERS.scrub.default).toBe('off')
      expect(SHADER_PARAMETERS.scrub.keywords).toEqual(['off', 'scroll'])
    })

    it('takes the opt-in from the authored parameters and refuses anything else as one', () => {
      expect(extractShaderOptions(scrubParams('scroll')).scrubsFromScroll).toBe(true)
      expect(extractShaderOptions(scrubParams('off')).scrubsFromScroll).toBe(false)
      expect(extractShaderOptions(scrubParams('')).scrubsFromScroll).toBe(false)
      // A typo must not land on the enabling branch; the closed keyword list warns about it.
      expect(extractShaderOptions(scrubParams('scrol')).scrubsFromScroll).toBe(false)
    })

    it('publishes its fixed progress under its own name, never the scroll family\'s', () => {
      // `core/compile.ts`'s `buildPlan` runs `resolveParams` over JS-rendered entries too, so this
      // string is what an authored `progress: 0.4` writes to `element.style`. Pointed at
      // `--kui-progress` it raced `scroll-progress` on the same element and inherited down to
      // every descendant — see `test/carousel-3d.test.ts` for the same rule on another primitive.
      expect(SHADER_PARAMETERS.progress.cssProperty).toBe('--kui-shader-progress')
    })

    it('uploads the progress it read from the element once the author opted in', () => {
      const img = shaderImg()
      img.style.setProperty('--kui-progress', '0.5')
      expect(drawOneFrame(img, scrubParams('scroll'))).toEqual([0.5])
    })

    it('uploads -1 with no scrub authored, even when the property is right there', () => {
      const img = shaderImg()
      // A `scroll-progress` on this very element, parked at the top of its range. Without
      // `scrub:` the shader must draw exactly as it did before any scroll primitive existed —
      // `-1`, the sentinel every program reads as "not scrubbed", and not the `0` that cancels it.
      img.style.setProperty('--kui-progress', '0')
      expect(drawOneFrame(img, scrubParams('off'))).toEqual([-1])
    })

    it('ignores an ancestor\'s progress when it did not opt in, which is the whole bug', () => {
      const img = shaderImg()
      document.body.appendChild(img)
      // No inline property of its own: `0` reaches this element only by inheriting from a
      // `scroll-progress` somewhere above it, which is precisely what `getComputedStyle` sees.
      const computed = vi.spyOn(window, 'getComputedStyle').mockReturnValue({
        getPropertyValue: (name: string) => (name === '--kui-progress' ? '0' : ''),
      } as unknown as CSSStyleDeclaration)

      expect(drawOneFrame(img, scrubParams('off'))).toEqual([-1])

      computed.mockRestore()
      img.remove()
    })

    it('reads an ancestor\'s progress once it did opt in', () => {
      const img = shaderImg()
      document.body.appendChild(img)
      const computed = vi.spyOn(window, 'getComputedStyle').mockReturnValue({
        getPropertyValue: (name: string) => (name === '--kui-progress' ? '0.75' : ''),
      } as unknown as CSSStyleDeclaration)

      expect(drawOneFrame(img, scrubParams('scroll'))).toEqual([0.75])

      computed.mockRestore()
      img.remove()
    })

    it('lets an authored number win over the bridge it opted into', () => {
      const img = shaderImg()
      img.style.setProperty('--kui-progress', '0.9')
      expect(drawOneFrame(img, scrubParams('scroll', 0.25))).toEqual([0.25])
      // And an authored number needs no opt-in at all: `scrub:` gates the *bridge*, not the knob.
      expect(drawOneFrame(img, scrubParams('off', 0.25))).toEqual([0.25])
    })

    it('still reads inline before computed, and answers -1 for an element with neither', () => {
      // The reader itself is unchanged and stays exported; what changed is who calls it.
      const bare = shaderImg()
      expect(readElementProgress(bare)).toBe(-1)
      bare.style.setProperty('--kui-progress', '1.4')
      expect(readElementProgress(bare)).toBe(1)
    })
  })

  /**
   * The overlay draws on one shared full-viewport canvas standing in for an element that has been
   * hidden, so anything the page does to that element has to be reproduced or it is lost. These
   * drive the maths with a hand-built computed style rather than jsdom's: the real CSS semantics
   * are `test/browser/advanced-webgl.test.mjs`'s overlay-fidelity block, in a real engine with
   * real pixels; what belongs here is that the crop, the clip and the mask are computed from the
   * values the engine reports.
   */
  describe('overlay geometry', () => {
    function styleMap(overrides: Record<string, string> = {}): CSSStyleDeclaration {
      return {
        position: 'static', objectFit: 'fill', objectPosition: '50% 50%', opacity: '1',
        overflowX: 'visible', overflowY: 'visible', transform: 'none', filter: 'none', perspective: 'none',
        borderLeftWidth: '0px', borderTopWidth: '0px', borderRightWidth: '0px', borderBottomWidth: '0px',
        paddingLeft: '0px', paddingTop: '0px', paddingRight: '0px', paddingBottom: '0px',
        borderTopLeftRadius: '0px', borderTopRightRadius: '0px',
        borderBottomRightRadius: '0px', borderBottomLeftRadius: '0px',
        ...overrides,
      } as unknown as CSSStyleDeclaration
    }

    function fakeWin(styles: Map<Element, CSSStyleDeclaration>, dpr = 1): Window {
      return {
        innerWidth: 1000,
        innerHeight: 800,
        devicePixelRatio: dpr,
        getComputedStyle: (el: Element) => styles.get(el) ?? styleMap(),
      } as unknown as Window
    }

    function imgAt(left: number, top: number, size: [number, number], natural: [number, number]): HTMLImageElement {
      const el = document.createElement('img')
      Object.defineProperty(el, 'naturalWidth', { value: natural[0] })
      Object.defineProperty(el, 'naturalHeight', { value: natural[1] })
      el.getBoundingClientRect = () => ({
        left, top, width: size[0], height: size[1], right: left + size[0], bottom: top + size[1],
      } as DOMRect)
      return el
    }

    function boxAt(left: number, top: number, size: [number, number]): HTMLElement {
      const el = document.createElement('div')
      el.getBoundingClientRect = () => ({
        left, top, width: size[0], height: size[1], right: left + size[0], bottom: top + size[1],
      } as DOMRect)
      return el
    }

    it('maps object-fit: cover with object-position: top onto the image top, not the whole image', () => {
      const img = imgAt(20, 100, [100, 50], [100, 100])
      const styles = new Map([[img as Element, styleMap({ objectFit: 'cover', objectPosition: '50% 0%' })]])

      const geom = measureElementGeometry(img, fakeWin(styles))!
      // A 100x100 image covering a 100x50 box is painted 100x100 and anchored at the top, so the
      // box only ever shows its upper half. Stretching it to the box would paint all 100 rows.
      expect(geom.paint).toEqual({ left: 20, top: 100, right: 120, bottom: 200 })
      expect(geom.clip).toEqual({ left: 20, top: 100, right: 120, bottom: 150 })
    })

    it('letterboxes object-fit: contain, leaving the gutters outside the paint box', () => {
      const img = imgAt(200, 100, [200, 100], [100, 100])
      const styles = new Map([[img as Element, styleMap({ objectFit: 'contain' })]])

      const geom = measureElementGeometry(img, fakeWin(styles))!
      expect(geom.paint).toEqual({ left: 250, top: 100, right: 350, bottom: 200 })
    })

    it('takes border and padding off the content box, and resolves a percentage radius elliptically', () => {
      const img = imgAt(0, 0, [100, 40], [100, 40])
      const styles = new Map([[img as Element, styleMap({
        borderLeftWidth: '5px', paddingLeft: '5px', borderTopWidth: '2px',
        borderTopLeftRadius: '50%', borderTopRightRadius: '10px 4px',
      })]])

      const geom = measureElementGeometry(img, fakeWin(styles))!
      expect(geom.clip).toEqual({ left: 10, top: 2, right: 100, bottom: 40 })
      // Border-box basis, x against the width and y against the height — the ellipse CSS draws.
      expect(geom.radii.slice(0, 4)).toEqual([50, 20, 10, 4])
    })

    it('lets a static overflow:hidden ancestor clip an in-flow element but not an absolute one', () => {
      const parent = boxAt(0, 0, [50, 100])
      const child = imgAt(0, 0, [100, 100], [100, 100])
      parent.appendChild(child)
      const hidden = styleMap({ overflowX: 'hidden', overflowY: 'hidden' })

      const inFlow = measureElementGeometry(child, fakeWin(new Map([[parent as Element, hidden]])))!
      expect(inFlow.clip.right).toBe(50)

      // `overflow` only clips a descendant whose containing block it is. A static parent is not an
      // absolute child's containing block, and treating it as one clipped every element in the GL
      // fixture to a zero-height `body` and drew nothing at all.
      const escaped = measureElementGeometry(child, fakeWin(new Map<Element, CSSStyleDeclaration>([
        [parent, hidden],
        [child, styleMap({ position: 'absolute' })],
      ])))!
      expect(escaped.clip.right).toBe(100)

      const contained = measureElementGeometry(child, fakeWin(new Map<Element, CSSStyleDeclaration>([
        [parent, styleMap({ overflowX: 'hidden', overflowY: 'hidden', position: 'relative' })],
        [child, styleMap({ position: 'absolute' })],
      ])))!
      expect(contained.clip.right).toBe(50)
    })

    it('multiplies the ancestors\' opacity into the alpha the draw is masked with', () => {
      const outer = boxAt(0, 0, [200, 200])
      const inner = boxAt(0, 0, [200, 200])
      const child = imgAt(0, 0, [100, 100], [100, 100])
      outer.appendChild(inner)
      inner.appendChild(child)

      const geom = measureElementGeometry(child, fakeWin(new Map<Element, CSSStyleDeclaration>([
        [outer, styleMap({ opacity: '0.5' })],
        [inner, styleMap({ opacity: '0.4' })],
      ])))!
      expect(geom.alpha).toBeCloseTo(0.2, 5)
    })

    it('answers null for an element below the fold', () => {
      const img = imgAt(0, 900, [100, 100], [100, 100])
      expect(measureElementGeometry(img, fakeWin(new Map()))).toBeNull()
    })

    function geometry(over: Partial<ElementGeometry> = {}): ElementGeometry {
      return {
        border: { left: 0, top: 0, right: 100, bottom: 100 },
        paint: { left: 0, top: 0, right: 100, bottom: 200 },
        clip: { left: 0, top: 0, right: 100, bottom: 100 },
        radii: [0, 0, 0, 0, 0, 0, 0, 0],
        alpha: 1,
        ...over,
      }
    }

    it('turns a cropped paint box into a UV window, a scissor rect and mask uniforms in device px', () => {
      const canvas = { width: 200, height: 200 } as HTMLCanvasElement
      const box = resolveDrawBox(geometry({ radii: [10, 10, 0, 0, 0, 0, 5, 5] }), canvas, 2)!

      // The bottom half of the painted image is clipped away, so the quad samples the top half.
      expect(box.uvOrigin).toEqual([0, 0])
      expect(box.uvScale).toEqual([1, 0.5])
      expect([box.sx, box.sy, box.sw, box.sh]).toEqual([0, 0, 200, 200])
      // Centre and half-extents of the *border* box, y up from the canvas bottom, times dpr.
      expect(box.maskBox).toEqual([100, 100, 100, 100])
      expect(box.maskRx).toEqual([20, 0, 0, 10])
      expect(box.maskRy).toEqual([20, 0, 0, 10])
    })

    it('samples the visible part of a half-off-screen element rather than squeezing the whole image', () => {
      const canvas = { width: 500, height: 500 } as HTMLCanvasElement
      const box = resolveDrawBox(geometry({
        border: { left: -50, top: 0, right: 50, bottom: 100 },
        paint: { left: -50, top: 0, right: 50, bottom: 100 },
        clip: { left: -50, top: 0, right: 50, bottom: 100 },
      }), canvas, 1)!

      expect(box.uvOrigin[0]).toBeCloseTo(0.5, 5)
      expect(box.uvScale[0]).toBeCloseTo(0.5, 5)
    })

    it('answers null when nothing of the paint box survives the clip, and for a degenerate box', () => {
      const canvas = { width: 500, height: 500 } as HTMLCanvasElement
      expect(resolveDrawBox(geometry({ clip: { left: 200, top: 0, right: 300, bottom: 100 } }), canvas, 1)).toBeNull()
      expect(resolveDrawBox(geometry({ paint: { left: 10, top: 10, right: 10, bottom: 10 } }), canvas, 1)).toBeNull()
    })

    it('leaves the mask uniforms at their no-box value for a caller that measured nothing', () => {
      const gl = createMockGL()
      const prog = createProgram(gl, 'void main(){}', 'void main(){}')
      const locs = extractLocations(gl, prog!)!
      uploadUniforms(gl, locs, {})
      // Always uploaded, never left to the last instance that drew with this shared program.
      expect(gl.uniform4fv).toHaveBeenCalledWith(locs.u_maskBox, [0, 0, 0, 0])
      expect(gl.uniform1f).toHaveBeenCalledWith(locs.u_maskAlpha, 1)
    })

    it('measures a generator against the border box and a filter against the content box', () => {
      // Padding on purpose: without it the two boxes are the same rectangle and the assertion
      // below is true whichever branch ran.
      const el = boxAt(10, 10, [100, 100])
      const styles = new Map([[el as Element, styleMap({
        paddingLeft: '10px', paddingTop: '10px', paddingRight: '10px', paddingBottom: '10px',
      })]])
      const win = fakeWin(styles)

      // A generator has no texture and therefore no `object-fit` to resolve, so its field should
      // fill the element the way a `background` would — padding included.
      const generative = measureElementGeometry(el, win, true)
      expect(generative?.paint).toEqual({ left: 10, top: 10, right: 110, bottom: 110 })

      // A filter stands in for replaced content, which CSS lays out inside the content box.
      const filtered = measureElementGeometry(el, win, false)
      expect(filtered?.paint).toEqual({ left: 20, top: 20, right: 100, bottom: 100 })
    })
  })

  /*
   * The generative field's own surface, under jsdom — so: control flow, parameter handling and the
   * two per-mode guards, and nothing about a pixel. Whether `GRADIENT_FS` links, whether the
   * palette reaches `u_colors` and whether `detail` changes structure without changing brightness
   * are all questions only `test/browser/advanced-webgl.test.mjs` can answer; the mock GL here
   * reports success for every one of them regardless.
   */
  describe('the generative field', () => {
    it('keeps one list of modes rather than two that can drift apart', () => {
      expect(SHADER_MODES).toContain('gradient')
      expect(SHADER_PARAMETERS.mode.keywords).toEqual([...SHADER_MODES])
      // Every generative mode has to be a mode, or `prepareShaders` gates out something its own
      // keyword list accepts.
      for (const mode of GENERATIVE_MODES) expect(SHADER_MODES).toContain(mode)
    })

    it('falls back to the default pair below two colours, and clips above five', () => {
      expect(buildPalette([]).colorCount).toBe(2)
      // One authored colour is not a ramp. Honouring it alone would render a flat fill and read as
      // a broken effect rather than as an unfinished parameter.
      expect(buildPalette(['#ff0000']).colorCount).toBe(2)
      expect(buildPalette(['#ff0000', '#0000ff']).colorCount).toBe(2)
      expect(buildPalette(['#f00', '#0f0', '#00f', '#ff0', '#0ff']).colorCount).toBe(PALETTE_SIZE)
      expect(buildPalette(['#f00', '#0f0', '#00f', '#ff0', '#0ff', '#f0f']).colorCount).toBe(PALETTE_SIZE)
      // The unset tail carries the last real stop, not zero: a driver that clamps an out-of-range
      // index differently than expected lands on a colour rather than on black.
      const { palette } = buildPalette(['#ff0000', '#0000ff'])
      expect(palette.length).toBe(PALETTE_SIZE * 4)
      expect([...palette.slice(16, 20)]).toEqual([...palette.slice(4, 8)])
    })

    it('reads every CSS angle unit, and answers zero rather than NaN for junk', () => {
      expect(parseAngleRadians('0deg')).toBe(0)
      expect(parseAngleRadians('180deg')).toBeCloseTo(Math.PI, 6)
      expect(parseAngleRadians('0.25turn')).toBeCloseTo(Math.PI / 2, 6)
      expect(parseAngleRadians('1rad')).toBeCloseTo(1, 6)
      expect(parseAngleRadians('200grad')).toBeCloseTo(Math.PI, 6)
      // `core/params.ts` normalises a bare number to degrees before this ever sees it; accepting
      // one here too means a hand-built accessor cannot silently land on 0.
      expect(parseAngleRadians('30')).toBeCloseTo(Math.PI / 6, 6)
      expect(parseAngleRadians('sideways')).toBe(0)
      expect(parseAngleRadians('')).toBe(0)
      expect(parseAngleRadians(undefined)).toBe(0)
    })

    it('registers a draw for a generator on an element with no image, and leaves the host visible', () => {
      const gl = createMockGL()
      const mockCanvas = document.createElement('canvas')
      mockCanvas.getContext = vi.fn().mockReturnValue(gl)
      const renderer = new SharedShaderRenderer({
        createCanvas: () => mockCanvas,
        raf: vi.fn(),
        caf: vi.fn(),
        window: { innerWidth: 1000, innerHeight: 800, addEventListener: vi.fn(), removeEventListener: vi.fn() },
      })
      setSharedShaderRenderer(renderer)

      const params = (mode: string) => ({
        text: vi.fn((k: string, def: string) => (k === 'mode' ? mode : def)),
        num: vi.fn((_k: string, def: number) => def),
      } as unknown as EffectParams)

      const div = document.createElement('div')
      const gradient = prepareShaders(div, params('gradient'), createRealPrepareContext(div, { reducedMotion: false }))
      gradient.activate()
      // The per-mode texture guard. Before it, `!!texture &&` meant a mode with no sampler could
      // never draw at all, whatever else was right.
      expect(renderer.drawCalls.size).toBe(1)
      renderer.renderFrame(1)
      // And the per-mode hide guard: hiding an element the author may have put content inside is
      // destructive, where hiding a filtered `<img>` is the entire mechanism.
      expect(div.style.opacity).toBe('')
      gradient.destroy()

      // The contrast case, on the same renderer: a filter on an element with no texture registers
      // its draw too, but the draw itself refuses — so the host is still never hidden.
      const img = document.createElement('img')
      Object.defineProperty(img, 'complete', { value: true })
      Object.defineProperty(img, 'naturalWidth', { value: 0 })
      const filter = prepareShaders(img, params('displace'), createRealPrepareContext(img, { reducedMotion: false }))
      filter.activate()
      renderer.renderFrame(1)
      expect(img.style.opacity).toBe('')
      filter.destroy()

      setSharedShaderRenderer(null)
    })
  })

  /*
   * `--kui-shader-z`. One fixed canvas carries every replica on the page, so where it sits in the
   * stacking order is a page-wide decision and lives on `:root` rather than in `SHADER_PARAMETERS`.
   * Whether the canvas actually *moves* is a browser question; these are about the read.
   */
  describe('the shared canvas stacking order', () => {
    /** The read, against a root element carrying `inline` and a stylesheet carrying `computed`. */
    const zFor = (inline: string, computed: string): number => {
      const pick = (want: string) => ({ getPropertyValue: (p: string) => (p === SHADER_Z_PROPERTY ? want : '') })
      const doc = { documentElement: { style: pick(inline) } } as unknown as Document
      const win = { getComputedStyle: () => pick(computed) } as unknown as Window
      return readShaderZIndex(doc, win)
    }

    it('answers the documented default when the author has said nothing', () => {
      expect(zFor('', '')).toBe(DEFAULT_SHADER_Z_INDEX)
      // A document too minimal to have a root element is the unit tier's own envs; the default has
      // to hold there rather than throw.
      expect(readShaderZIndex({} as Document, null)).toBe(DEFAULT_SHADER_Z_INDEX)
      expect(readShaderZIndex(null, null)).toBe(DEFAULT_SHADER_Z_INDEX)
    })

    it('prefers an inline value and falls back to the stylesheet', () => {
      expect(zFor('42', '7')).toBe(42)
      // The ordinary case: written in a stylesheet, not on the element.
      expect(zFor('', '7')).toBe(7)
      // A page that wants the canvas below everything is allowed to say so.
      expect(zFor('', '-1')).toBe(-1)
    })

    it('refuses a value that is not a number rather than writing a broken z-index', () => {
      // `auto` is a real `z-index` keyword and a meaningless one for a fixed full-page overlay.
      expect(zFor('', 'auto')).toBe(DEFAULT_SHADER_Z_INDEX)
      // An unresolved `var()` arrives as whitespace, which must not become 0 — 0 would be a
      // silent, page-wide stacking change from a typo.
      expect(zFor('', '  ')).toBe(DEFAULT_SHADER_Z_INDEX)
      expect(zFor('', 'calc(1 + 1)')).toBe(DEFAULT_SHADER_Z_INDEX)
      // `z-index` is an integer property; a fractional custom property is truncated, not rejected.
      expect(zFor('', '12.7')).toBe(12)
    })
  })
})
