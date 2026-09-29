// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SharedShaderRenderer, prepareShaders, setSharedShaderRenderer } from '../shaders.js'
import type { EffectParams } from '../../core/types.js'
import { createRealPrepareContext } from './prepare-context-fixture.js'

/**
 * Renderer and instance paths that only a *frame* reaches: the second frame of a hidden host, a
 * stale texture after a context generation bump, the `to:` texture's whole life, and the reduced
 * motion bake's refusals. Every test drives `renderFrame` against a recording GL and asserts what
 * the page or the GL ended up with.
 */

const NATURAL_GIF = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'

function createGL() {
  const gl = new Proxy({} as Record<string, unknown>, {
    get(target, prop: string) {
      if (!(prop in target)) target[prop] = /^[A-Z][A-Z_0-9]+$/.test(prop) ? 1 : vi.fn(() => ({}))
      return target[prop]
    },
  }) as unknown as WebGL2RenderingContext
  ;(gl as unknown as Record<string, unknown>).getShaderParameter = vi.fn(() => true)
  ;(gl as unknown as Record<string, unknown>).getProgramParameter = vi.fn(() => true)
  return gl
}

function createFixture(windowSize: [number, number] = [1000, 800]) {
  const gl = createGL()
  const canvas = document.createElement('canvas')
  canvas.getContext = vi.fn().mockReturnValue(gl)
  const renderer = new SharedShaderRenderer({
    createCanvas: () => canvas,
    raf: vi.fn(() => 1),
    caf: vi.fn(),
    window: { innerWidth: windowSize[0], innerHeight: windowSize[1], addEventListener: vi.fn(), removeEventListener: vi.fn() },
  })
  setSharedShaderRenderer(renderer)
  const overrides = { reducedMotion: false, createCanvas: () => canvas, raf: vi.fn(), caf: vi.fn() }
  return { gl, canvas, renderer, overrides }
}

function loadedImage(rect = { left: 10, top: 10, width: 100, height: 100 }): HTMLImageElement {
  const img = document.createElement('img')
  Object.defineProperty(img, 'complete', { value: true })
  Object.defineProperty(img, 'naturalWidth', { value: 100 })
  Object.defineProperty(img, 'naturalHeight', { value: 100 })
  img.getBoundingClientRect = () => ({ ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height } as DOMRect)
  return img
}

function paramsFor(values: Record<string, string>): EffectParams {
  return {
    text: (k: string, def: string) => values[k] ?? def,
    num: (_k: string, def: number) => def,
  } as unknown as EffectParams
}

afterEach(() => {
  setSharedShaderRenderer(null)
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('a filtered host across frames', () => {
  it('hides the host once, leaves it hidden on the next frame, and gives it back when the draw stops', () => {
    const { renderer, overrides } = createFixture()
    const img = loadedImage()
    const inst = prepareShaders(img, paramsFor({}), createRealPrepareContext(img, overrides))
    inst.activate()

    renderer.renderFrame(1)
    expect(img.style.opacity).toBe('0')

    // A second successful frame must not write again: the ledger already holds the author's value.
    const write = vi.spyOn(img.style, 'setProperty')
    renderer.renderFrame(2)
    expect(write).not.toHaveBeenCalled()
    expect(img.style.opacity).toBe('0')

    // Scrolled off the bottom: nothing to draw, so the real image has to come back.
    img.getBoundingClientRect = () => ({ left: 10, top: 5000, width: 100, height: 100, right: 110, bottom: 5100 } as DOMRect)
    renderer.renderFrame(3)
    expect(img.style.opacity).toBe('')
    inst.destroy()
  })

  it('still draws, and writes nothing, for a host that cannot carry inline style', () => {
    const { gl, renderer, overrides } = createFixture()
    const img = loadedImage()
    const inst = prepareShaders(img, paramsFor({}), createRealPrepareContext(img, overrides))
    Object.defineProperty(img, 'style', { value: undefined })
    inst.activate()

    expect(() => renderer.renderFrame(1)).not.toThrow()
    expect(gl.drawArrays).toHaveBeenCalled()
    inst.destroy()
  })

  it('re-uploads a texture whose context generation has moved on', () => {
    const { gl, renderer, overrides } = createFixture()
    const img = loadedImage()
    const inst = prepareShaders(img, paramsFor({}), createRealPrepareContext(img, overrides))
    inst.activate()

    renderer.renderFrame(1)
    expect(gl.createTexture).toHaveBeenCalledTimes(1)
    renderer.renderFrame(2)
    expect(gl.createTexture).toHaveBeenCalledTimes(1)

    // A context loss this instance was never told about (it was inactive): the handle is a live JS
    // object but dead on the GPU, and only the generation stamp says so.
    renderer.contextGeneration += 1
    renderer.renderFrame(3)
    expect(gl.createTexture).toHaveBeenCalledTimes(2)
    inst.destroy()
  })
})

describe('the to: texture', () => {
  function morphInto(selector: string) {
    const fixture = createFixture()
    const host = loadedImage()
    const inst = prepareShaders(host, paramsFor({ mode: 'morph', to: selector }), createRealPrepareContext(host, fixture.overrides))
    inst.activate()
    fixture.renderer.renderFrame(1)
    return { ...fixture, inst }
  }

  it('uploads the target image next to the host and deletes both on destroy', () => {
    const target = loadedImage()
    target.id = 'dest'
    target.src = NATURAL_GIF
    document.body.appendChild(target)

    const { gl, inst } = morphInto('#dest')
    expect(gl.createTexture).toHaveBeenCalledTimes(2)

    inst.destroy()
    expect(gl.deleteTexture).toHaveBeenCalledTimes(2)
  })

  it('uploads only the host when the target is not a loaded image', () => {
    const div = document.createElement('div')
    div.id = 'dest'
    document.body.appendChild(div)

    const { gl, inst } = morphInto('#dest')
    expect(gl.createTexture).toHaveBeenCalledTimes(1)
    inst.destroy()
    expect(gl.deleteTexture).toHaveBeenCalledTimes(1)
  })

  it('treats an invalid selector as no target instead of throwing into the frame', () => {
    const { gl, inst } = morphInto('a[')
    expect(gl.createTexture).toHaveBeenCalledTimes(1)
    expect(gl.drawArrays).toHaveBeenCalled()
    inst.destroy()
  })

  it('uploads no target texture when to: is empty', () => {
    const { gl, inst } = morphInto('')
    expect(gl.createTexture).toHaveBeenCalledTimes(1)
    inst.destroy()
  })
})

describe('renderer acquisition', () => {
  it('counts another reference on a canvas whose context is lost, without initialising again', () => {
    const { canvas, renderer } = createFixture()
    expect(renderer.acquire()).toBe(true)
    expect(renderer.refCount).toBe(1)

    renderer.isContextLost = true
    expect(renderer.acquire()).toBe(true)
    expect(renderer.refCount).toBe(2)
    expect(canvas.getContext).toHaveBeenCalledTimes(1)
  })

  it('leaves the program table empty when no program links', () => {
    const { gl, renderer } = createFixture()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    ;(gl as unknown as Record<string, unknown>).getProgramParameter = vi.fn(() => false)
    ;(gl as unknown as Record<string, unknown>).getShaderParameter = vi.fn(() => false)

    expect(renderer.acquire()).toBe(true)
    expect(renderer.programs).toEqual({})
  })

  it('fills the program table for every mode when programs link', () => {
    const { renderer } = createFixture()
    expect(renderer.acquire()).toBe(true)
    expect(Object.keys(renderer.programs)).toEqual(expect.arrayContaining(['displace', 'morph', 'gradient']))
  })
})

describe('the reduced-motion bake', () => {
  function bakeFixture(opts: { rect?: Partial<DOMRect>; window?: [number, number]; out2d?: boolean } = {}) {
    const fixture = createFixture(opts.window)
    const out = document.createElement('canvas')
    const drawImage = vi.fn()
    out.getContext = vi.fn().mockReturnValue(opts.out2d === false ? null : { drawImage })
    out.toDataURL = vi.fn().mockReturnValue('data:image/png;base64,BAKED')

    const el = document.createElement('div')
    const rect = { width: 200, height: 100, top: 0, left: 0, right: 200, bottom: 100, ...opts.rect } as DOMRect
    el.getBoundingClientRect = () => rect

    const ctx = createRealPrepareContext(el, { reducedMotion: true, createCanvas: () => out })
    const inst = prepareShaders(el, paramsFor({ mode: 'gradient' }), ctx)
    return { ...fixture, out, drawImage, el, inst }
  }

  it('bakes a large element at the capped size, keeping its aspect', () => {
    const { renderer, canvas, out, drawImage, el } = bakeFixture({ rect: { width: 2000, height: 1000, right: 2000, bottom: 1000 } })
    renderer.renderFrame(1)

    // Longest side 2000 -> capped at 640, so 2000x1000 becomes 640x320.
    expect(out.width).toBe(640)
    expect(out.height).toBe(320)
    expect(drawImage).toHaveBeenCalledWith(canvas, 0, 0, 640, 320, 0, 0, 640, 320)
    expect(el.style.backgroundImage).toBe('url("data:image/png;base64,BAKED")')
  })

  it('waits for a box with finite size', () => {
    const { renderer, drawImage, el } = bakeFixture({ rect: { width: Number.NaN } })
    renderer.renderFrame(1)
    expect(drawImage).not.toHaveBeenCalled()
    expect(el.style.backgroundImage).toBe('')
    expect(renderer.drawCalls.size).toBe(1)
  })

  it('waits when the canvas is too small to hold the bake', () => {
    const { renderer, drawImage, el } = bakeFixture({ window: [0, 0] })
    renderer.renderFrame(1)
    expect(drawImage).not.toHaveBeenCalled()
    expect(el.style.backgroundImage).toBe('')
    expect(renderer.drawCalls.size).toBe(1)
  })

  it('waits when the read-back canvas has no 2d context', () => {
    const { renderer, drawImage, el } = bakeFixture({ out2d: false })
    renderer.renderFrame(1)
    expect(drawImage).not.toHaveBeenCalled()
    expect(el.style.backgroundImage).toBe('')
    expect(renderer.drawCalls.size).toBe(1)
  })

  it('waits when the element cannot report a box', () => {
    const { renderer, drawImage, el } = bakeFixture()
    ;(el as unknown as { getBoundingClientRect: unknown }).getBoundingClientRect = undefined
    renderer.renderFrame(1)
    expect(drawImage).not.toHaveBeenCalled()
    expect(renderer.drawCalls.size).toBe(1)
  })

  it('waits when the generative program is not available to draw with', () => {
    const { renderer, drawImage, el } = bakeFixture()
    renderer.programs = {}
    renderer.renderFrame(1)
    expect(drawImage).not.toHaveBeenCalled()
    expect(el.style.backgroundImage).toBe('')
    expect(renderer.drawCalls.size).toBe(1)
  })

  it('bakes for a host that reports no owner document, taking the environment from the context', () => {
    const fixture = createFixture()
    const out = document.createElement('canvas')
    const drawImage = vi.fn()
    out.getContext = vi.fn().mockReturnValue({ drawImage })
    out.toDataURL = vi.fn().mockReturnValue('data:image/png;base64,BAKED')
    const host = { getBoundingClientRect: () => ({ width: 200, height: 100, top: 0, left: 0, right: 200, bottom: 100 }) } as unknown as HTMLElement

    const inst = prepareShaders(host, paramsFor({ mode: 'gradient' }), createRealPrepareContext(host, { reducedMotion: true, createCanvas: () => out }))
    expect(fixture.renderer.drawCalls.size).toBe(1)
    fixture.renderer.renderFrame(1)

    expect(drawImage).toHaveBeenCalled()
    expect(fixture.renderer.drawCalls.size).toBe(0)
    inst.destroy()
  })

  it('stays inert, registering nothing, when no renderer can start', () => {
    const badCanvas = document.createElement('canvas')
    badCanvas.getContext = vi.fn().mockReturnValue(null)
    const renderer = new SharedShaderRenderer({ createCanvas: () => badCanvas, raf: vi.fn(() => 1), caf: vi.fn() })
    setSharedShaderRenderer(renderer)
    const el = document.createElement('div')

    const inst = prepareShaders(el, paramsFor({ mode: 'gradient' }), createRealPrepareContext(el, { reducedMotion: true, createCanvas: () => badCanvas }))
    expect(renderer.drawCalls.size).toBe(0)
    expect(renderer.refCount).toBe(0)
    expect(() => inst.destroy()).not.toThrow()
  })
})
