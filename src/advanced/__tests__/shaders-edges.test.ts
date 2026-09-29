// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import {
  drawElementQuad,
  extractShaderOptions,
  measureElementGeometry,
  parseAngleRadians,
  parseColor,
  readElementProgress,
  resolveDrawBox,
  type ElementGeometry,
  type SharedShaderRenderer,
} from '../shaders.js'

/**
 * The seams of `shaders.ts` that the behavioural suite in `shaders.test.ts` steps over: hostile
 * inputs to the pure helpers, and the geometry maths with a hand-built computed style. Each test
 * asserts the value the branch decides, so a flipped condition changes an answer rather than only
 * a line count.
 */

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

function fakeWin(styleFor: (el: Element) => CSSStyleDeclaration): Window {
  return { innerWidth: 1000, innerHeight: 800, devicePixelRatio: 1, getComputedStyle: styleFor } as unknown as Window
}

function rectOf(left: number, top: number, size: [number, number]): DOMRect {
  return { left, top, width: size[0], height: size[1], right: left + size[0], bottom: top + size[1] } as DOMRect
}

function imgAt(left: number, top: number, size: [number, number], natural: [number, number]): HTMLImageElement {
  const el = document.createElement('img')
  Object.defineProperty(el, 'naturalWidth', { value: natural[0] })
  Object.defineProperty(el, 'naturalHeight', { value: natural[1] })
  el.getBoundingClientRect = () => rectOf(left, top, size)
  return el
}

function boxAt(left: number, top: number, size: [number, number]): HTMLElement {
  const el = document.createElement('div')
  el.getBoundingClientRect = () => rectOf(left, top, size)
  return el
}

describe('parsing edges', () => {
  it('answers opaque white, not a throw, when the colour canvas factory throws', () => {
    const factory = vi.fn(() => { throw new Error('no canvas here') })
    // `hsl()` is outside the hand-rolled parsers, so it is the canvas fallback's to answer.
    expect(parseColor('hsl(200 50% 50%)', factory)).toEqual([1, 1, 1, 1])
    expect(factory).toHaveBeenCalled()
  })

  it('answers zero for an angle too large to be a finite number', () => {
    // A 400-digit run matches the pattern and `parseFloat`s to Infinity; Infinity radians would
    // reach a uniform as-is.
    expect(parseAngleRadians('9'.repeat(400))).toBe(0)
    expect(parseAngleRadians('90DEG')).toBeCloseTo(Math.PI / 2, 6)
  })

  it('reads mask: only under logo, and falls back to alpha for a word it does not know', () => {
    const accessor = (mode: string, mask: string) => {
      const authored: Record<string, string> = { mode, mask }
      return {
        text: (k: string, def?: string) => authored[k] ?? def ?? '',
        num: (_k: string, def?: number) => def ?? 0,
      }
    }
    expect(extractShaderOptions(accessor('logo', 'luma')).maskMode).toBe(2)
    expect(extractShaderOptions(accessor('logo', 'luma-invert')).maskMode).toBe(3)
    expect(extractShaderOptions(accessor('logo', 'sepia')).maskMode).toBe(1)
    expect(extractShaderOptions(accessor('displace', 'luma')).maskMode).toBe(0)
  })

  it('treats a non-numeric --kui-progress as absent rather than as 0', () => {
    const el = document.createElement('div')
    el.style.setProperty('--kui-progress', 'soon')
    expect(readElementProgress(el)).toBe(-1)
    el.style.setProperty('--kui-progress', '0.5')
    expect(readElementProgress(el)).toBe(0.5)
  })
})

describe('measureElementGeometry edges', () => {
  it('falls back to the border box when getComputedStyle throws', () => {
    const img = imgAt(10, 20, [100, 50], [100, 100])
    const win = fakeWin(() => { throw new Error('detached') })

    const geom = measureElementGeometry(img, win)!
    expect(geom.paint).toEqual({ left: 10, top: 20, right: 110, bottom: 70 })
    expect(geom.radii).toEqual([0, 0, 0, 0, 0, 0, 0, 0])
    expect(geom.alpha).toBe(1)
  })

  it('skips an ancestor whose style cannot be read', () => {
    const parent = boxAt(0, 0, [50, 100])
    const child = imgAt(0, 0, [100, 100], [100, 100])
    parent.appendChild(child)
    const win = fakeWin((el) => {
      if (el === parent) throw new Error('cannot read')
      return styleMap()
    })
    // The parent would clip to 50px wide if it could be read.
    expect(measureElementGeometry(child, win)!.clip.right).toBe(100)
  })

  it('does not clip a fixed element by an overflow:hidden ancestor', () => {
    const parent = boxAt(0, 0, [50, 100])
    const child = imgAt(0, 0, [100, 100], [100, 100])
    parent.appendChild(child)
    const hidden = styleMap({ overflowX: 'hidden', overflowY: 'hidden' })
    const win = fakeWin((el) => (el === parent ? hidden : styleMap({ position: 'fixed' })))
    expect(measureElementGeometry(child, win)!.clip.right).toBe(100)
  })

  it('paints object-fit: none at the intrinsic size, centred', () => {
    const img = imgAt(0, 0, [200, 200], [100, 100])
    const geom = measureElementGeometry(img, fakeWin(() => styleMap({ objectFit: 'none' })))!
    expect(geom.paint).toEqual({ left: 50, top: 50, right: 150, bottom: 150 })
  })

  it('scale-down never enlarges past the intrinsic size but still shrinks to fit', () => {
    const win = fakeWin(() => styleMap({ objectFit: 'scale-down' }))
    const small = measureElementGeometry(imgAt(0, 0, [200, 200], [50, 50]), win)!
    expect(small.paint).toEqual({ left: 75, top: 75, right: 125, bottom: 125 })
    const big = measureElementGeometry(imgAt(0, 0, [200, 200], [400, 400]), win)!
    expect(big.paint).toEqual({ left: 0, top: 0, right: 200, bottom: 200 })
  })

  it('resolves keyword, percentage and length object-position tokens per axis', () => {
    const at = (objectPosition: string) => measureElementGeometry(
      imgAt(0, 0, [200, 200], [100, 100]),
      fakeWin(() => styleMap({ objectFit: 'none', objectPosition })),
    )!.paint
    // Free space is 100px on each axis.
    expect(at('left bottom')).toEqual({ left: 0, top: 100, right: 100, bottom: 200 })
    expect(at('25% 10px')).toEqual({ left: 25, top: 10, right: 125, bottom: 110 })
    // One token: the second axis falls back to the centre.
    expect(at('right')).toEqual({ left: 100, top: 50, right: 200, bottom: 150 })
  })

  it('returns the content box unchanged when border and padding leave no room', () => {
    const img = imgAt(0, 0, [10, 10], [100, 100])
    const win = fakeWin(() => styleMap({
      objectFit: 'cover', borderLeftWidth: '6px', borderRightWidth: '6px',
    }))
    const geom = measureElementGeometry(img, win)!
    // 10 - 6 - 6 is a negative width: nothing to fit an image into, so nothing is remapped.
    expect(geom.paint).toEqual({ left: 6, top: 0, right: 4, bottom: 10 })
  })
})

describe('draw box and quad refusals', () => {
  const box = (left: number, top: number, right: number, bottom: number) => ({ left, top, right, bottom })

  function geometryOf(paint: ElementGeometry['paint']): ElementGeometry {
    return { border: paint, paint, clip: box(-1000, -1000, 1000, 1000), radii: [0, 0, 0, 0, 0, 0, 0, 0], alpha: 1, hostAlpha: 1 }
  }

  it('refuses a box that rounds to zero device pixels at the canvas edge', () => {
    const canvas = document.createElement('canvas')
    canvas.width = 100
    canvas.height = 100
    // 0.1px of the paint box is inside the view, but its left edge rounds onto the canvas's edge
    // pixel, which leaves no width to scissor.
    expect(resolveDrawBox(geometryOf(box(99.9, 0, 150, 50)), canvas, 1)).toBeNull()
    expect(resolveDrawBox(geometryOf(box(50, 0, 99, 50)), canvas, 1)).not.toBeNull()
  })

  function rendererWith(programs: Record<string, unknown>) {
    const gl = new Proxy({} as Record<string, unknown>, {
      get(target, prop: string) {
        if (!(prop in target)) target[prop] = /^[A-Z_0-9]+$/.test(prop) ? 1 : vi.fn()
        return target[prop]
      },
    }) as unknown as WebGLRenderingContext
    const canvas = document.createElement('canvas')
    canvas.width = 800
    canvas.height = 800
    const renderer = {
      gl, canvas, quadBuffer: {}, programs, mouse: { x: 0, y: 0 },
      window: { innerHeight: 800, devicePixelRatio: 1 },
    } as unknown as SharedShaderRenderer
    return { renderer, gl }
  }

  const visible = () => boxAt(10, 10, [50, 50])

  it('does not draw a mode whose program was never built', () => {
    const { renderer, gl } = rendererWith({})
    expect(drawElementQuad(renderer, visible(), { mode: 'missing' })).toBe(false)
    expect(gl.useProgram).not.toHaveBeenCalled()
  })

  it('does not draw a mode whose program failed to link', () => {
    const { renderer, gl } = rendererWith({ displace: null })
    expect(drawElementQuad(renderer, visible(), { mode: 'displace' })).toBe(false)
    expect(gl.useProgram).not.toHaveBeenCalled()
  })

  it('does not draw when nothing of the element survives the clip', () => {
    const { renderer, gl } = rendererWith({ displace: {} })
    const empty = box(0, 0, 0, 0)
    const geometry = { border: empty, paint: empty, clip: empty, radii: [0, 0, 0, 0, 0, 0, 0, 0], alpha: 1, hostAlpha: 1 } as ElementGeometry
    expect(drawElementQuad(renderer, visible(), { mode: 'displace', geometry })).toBe(false)
    expect(gl.useProgram).not.toHaveBeenCalled()
    // The contrast: the same renderer draws once the geometry has area.
    expect(drawElementQuad(renderer, visible(), { mode: 'displace', geometry: geometryOf(box(0, 0, 50, 50)) })).toBe(true)
    expect(gl.drawArrays).toHaveBeenCalledTimes(1)
  })
})
