// Created by Gemini 3.8 Flash
/**
 * Low-level WebGL helper utilities for kUInetic Shaders
 */

export interface ProgramLocations {
  program?: WebGLProgram
  a_position?: number
  u_image?: WebGLUniformLocation | null
  u_image_to?: WebGLUniformLocation | null
  u_uvOrigin?: WebGLUniformLocation | null
  u_uvScale?: WebGLUniformLocation | null
  u_time?: WebGLUniformLocation | null
  u_strength?: WebGLUniformLocation | null
  u_frequency?: WebGLUniformLocation | null
  u_chromatic?: WebGLUniformLocation | null
  u_iridescence?: WebGLUniformLocation | null
  u_mouse?: WebGLUniformLocation | null
  u_tint?: WebGLUniformLocation | null
  u_color1?: WebGLUniformLocation | null
  u_color2?: WebGLUniformLocation | null
  u_duotone?: WebGLUniformLocation | null
  u_blend?: WebGLUniformLocation | null
  u_progress?: WebGLUniformLocation | null
}

export function compileShader(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader | null {
  const shader = gl.createShader(type)
  if (!shader) return null
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader)
    return null
  }
  return shader
}

export function createProgram(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  vsSource: string,
  fsSource: string,
): WebGLProgram | null {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vsSource)
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSource)
  if (!vs || !fs) {
    if (vs) gl.deleteShader(vs)
    if (fs) gl.deleteShader(fs)
    return null
  }
  const program = gl.createProgram()
  if (!program) {
    gl.deleteShader(vs)
    gl.deleteShader(fs)
    return null
  }
  gl.attachShader(program, vs)
  gl.attachShader(program, fs)
  gl.linkProgram(program)
  gl.deleteShader(vs)
  gl.deleteShader(fs)
  if (typeof gl.getProgramParameter === 'function' && !gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program)
    return null
  }
  return program
}

export function extractLocations(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  program: WebGLProgram | null,
): ProgramLocations | null {
  if (!program) return null
  return {
    program,
    a_position: gl.getAttribLocation(program, 'a_position'),
    u_image: gl.getUniformLocation(program, 'u_image'),
    u_image_to: gl.getUniformLocation(program, 'u_image_to'),
    u_uvOrigin: gl.getUniformLocation(program, 'u_uvOrigin'),
    u_uvScale: gl.getUniformLocation(program, 'u_uvScale'),
    u_time: gl.getUniformLocation(program, 'u_time'),
    u_strength: gl.getUniformLocation(program, 'u_strength'),
    u_frequency: gl.getUniformLocation(program, 'u_frequency'),
    u_chromatic: gl.getUniformLocation(program, 'u_chromatic'),
    u_iridescence: gl.getUniformLocation(program, 'u_iridescence'),
    u_mouse: gl.getUniformLocation(program, 'u_mouse'),
    u_tint: gl.getUniformLocation(program, 'u_tint'),
    u_color1: gl.getUniformLocation(program, 'u_color1'),
    u_color2: gl.getUniformLocation(program, 'u_color2'),
    u_duotone: gl.getUniformLocation(program, 'u_duotone'),
    u_blend: gl.getUniformLocation(program, 'u_blend'),
    u_progress: gl.getUniformLocation(program, 'u_progress'),
  }
}

export function disposeGLResources(
  gl: WebGLRenderingContext | WebGL2RenderingContext | null,
  quadBuffer: WebGLBuffer | null,
  programs: Record<string, ProgramLocations | WebGLProgram | null | undefined>,
): void {
  if (!gl) return
  if (quadBuffer && gl.deleteBuffer) gl.deleteBuffer(quadBuffer)
  for (const info of Object.values(programs)) {
    const prog = info && typeof info === 'object' && 'program' in info ? info.program : (info as WebGLProgram)
    if (prog && gl.deleteProgram) gl.deleteProgram(prog)
  }
}

export function createGLTexture(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  source: TexImageSource,
): WebGLTexture | null {
  const tex = gl.createTexture()
  if (!tex) return null
  try {
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source)
    return tex
  } catch {
    if (gl.deleteTexture) gl.deleteTexture(tex)
    return null
  }
}
