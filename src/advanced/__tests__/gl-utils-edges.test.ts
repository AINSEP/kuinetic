import { describe, expect, it, vi } from 'vitest'
import { createGLTexture } from '../gl-utils.js'

/** `createGLTexture`'s guards against the ways an upload fails without throwing. */

function glWith(overrides: Record<string, unknown> = {}) {
  return {
    TEXTURE_2D: 3553, TEXTURE_WRAP_S: 1, TEXTURE_WRAP_T: 2, TEXTURE_MIN_FILTER: 3, TEXTURE_MAG_FILTER: 4,
    CLAMP_TO_EDGE: 5, LINEAR: 6, RGBA: 7, UNSIGNED_BYTE: 8, UNPACK_PREMULTIPLY_ALPHA_WEBGL: 37441,
    createTexture: vi.fn(() => ({})),
    bindTexture: vi.fn(),
    texParameteri: vi.fn(),
    texImage2D: vi.fn(),
    deleteTexture: vi.fn(),
    ...overrides,
  } as unknown as WebGL2RenderingContext
}

describe('createGLTexture', () => {
  it('uploads premultiplied when the context supports pixelStorei', () => {
    const pixelStorei = vi.fn()
    const gl = glWith({ pixelStorei })
    expect(createGLTexture(gl, { width: 4, height: 4 } as unknown as TexImageSource)).not.toBeNull()
    expect(pixelStorei).toHaveBeenCalledWith(37441, 1)
  })

  it('reads a source that reports no usable size as unmeasurable, not as oversized', () => {
    const gl = glWith({ MAX_TEXTURE_SIZE: 9, getParameter: vi.fn(() => 4096) })
    const source = { naturalWidth: 'wide', naturalHeight: 'tall' } as unknown as TexImageSource
    expect(createGLTexture(gl, source)).not.toBeNull()
    expect(gl.texImage2D).toHaveBeenCalled()
  })

  it('refuses a source over the texture limit before allocating anything', () => {
    const gl = glWith({ MAX_TEXTURE_SIZE: 9, getParameter: vi.fn(() => 4096) })
    expect(createGLTexture(gl, { naturalWidth: 5000, naturalHeight: 100 } as unknown as TexImageSource)).toBeNull()
    expect(gl.createTexture).not.toHaveBeenCalled()
  })

  it('stops draining a context that reports an error forever, and refuses the upload', () => {
    const getError = vi.fn(() => 1282)
    const gl = glWith({ getError })
    expect(createGLTexture(gl, { width: 4, height: 4 } as unknown as TexImageSource)).toBeNull()
    // Eight drain reads, then the one that checks the upload itself.
    expect(getError).toHaveBeenCalledTimes(9)
    expect(gl.deleteTexture).toHaveBeenCalledTimes(1)
  })
})
