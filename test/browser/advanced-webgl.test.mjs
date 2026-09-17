import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { createChecker, loadChromium } from '../../scripts/browser-harness.mjs'

/**
 * Real-browser WebGL2 test suite for kUInetic Advanced Shaders.
 *
 * Verifies with a real WebGL2RenderingContext in Chromium:
 * 1. Context loss/restore: source hidden only after successful draw; becomes visible on context loss;
 *    texture upload count increases and draw happens before opacity returns to 0 on restore.
 * 2. Partially clipped element: UV crop uniforms ensure visible half shows the matching half of the
 *    image, not squeezed.
 * 3. Draw isolation: when one shader draw throws, the other still renders and the rAF loop survives.
 * 4. Author-written opacity: 0 persistence: host with authored opacity: 0 never has it mutated to ''
 *    on failed draw, context loss, or destroy.
 * 5. Double destroy: calling destroy twice on one instance leaves the surviving instance drawing
 *    without corrupted refCounts.
 * 6. Real shader compilation: the five production GLSL programs in `glsl.ts` actually link, with
 *    no leftover GL error — jsdom cannot check this at all (no real GL context).
 * 7. Real GLSL compile failure: `compileShader`/`createProgram` return null against genuinely
 *    invalid GLSL, not just a mock told to say so.
 * 8. Real canvas-2D color resolution: `parseColor`'s canvas fallback against a CSS color outside
 *    its hardcoded name table — unreachable in jsdom, which has no canvas 2D context either.
 * 9. Scroll -> shader progress bridge: a `scroll-progress` primitive on the shader's own element,
 *    and on an ancestor (relying on `--kui-progress` inheriting through `getComputedStyle`), both
 *    drive the real `u_progress` uniform as the page actually scrolls.
 * 10. Audio -> shader and audio -> camera bridge: a `--kui-audio-*` band on the consumer's own
 *    element and on an ancestor drives the real `u_audio` uniform and the camera's real
 *    `translate3d`, and a consumer with no `audio:` stays at 0 with every band at full scale.
 * 11. The same chain end to end with a real `audio-source`: a WAV built in the page, played
 *    through a real Web Audio graph, read back off the real uniform.
 */
export const name = 'advanced-webgl'

const FIXTURE_URL = `file://${fileURLToPath(new URL('./fixtures/advanced-webgl.html', import.meta.url))}`
const ENTRY_FILE = fileURLToPath(new URL('./fixtures/advanced-webgl-entry.ts', import.meta.url))
const BUNDLE_FILE = fileURLToPath(new URL('./fixtures/advanced-webgl.bundle.js', import.meta.url))

export async function run({ browser }) {
  const { check, results } = createChecker()

  // Ensure fresh bundle before opening page
  execFileSync('npx', ['esbuild', ENTRY_FILE, '--bundle', `--outfile=${BUNDLE_FILE}`])

  const context = await browser.newContext({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 1 })
  const page = await context.newPage()

  await page.goto(FIXTURE_URL)
  await page.waitForFunction(() => window.__kuiReady === true && window.kUIAdvanced !== undefined)

  // -------------------------------------------------------------------------
  // 1. Context loss / restore
  // -------------------------------------------------------------------------
  const lossRestore = await page.evaluate(async () => {
    const { prepareShaders, getSharedShaderRenderer, createEffectParams } = window.kUIAdvanced
    const img1 = document.getElementById('img1')
    if (!img1) return { error: 'img1 not found' }

    let textureUploadCount = 0
    let drawHappenedBeforeOpacityZeroOnRestore = false
    let drawCallCount = 0

    const initialOpacity = img1.style.opacity
    const inst = prepareShaders(img1, createEffectParams({ mode: 'displace' }))
    const opacityBeforeActivate = img1.style.opacity

    inst.activate()
    const renderer = getSharedShaderRenderer()
    const gl = renderer.gl
    if (!gl) return { error: 'No WebGL context initialized' }

    const origTexImage2D = gl.texImage2D
    gl.texImage2D = function (...args) {
      textureUploadCount++
      return origTexImage2D.apply(this, args)
    }

    const origDrawArrays = gl.drawArrays
    let isRestoring = false
    gl.drawArrays = function (...args) {
      drawCallCount++
      if (isRestoring && img1.style.opacity !== '0') {
        drawHappenedBeforeOpacityZeroOnRestore = true
      }
      return origDrawArrays.apply(this, args)
    }

    // Wait 2 rAFs for initial render
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))

    const initialDraws = drawCallCount
    const initialUploads = textureUploadCount
    const opacityAfterDraw = img1.style.opacity

    const ext = gl.getExtension('WEBGL_lose_context')
    if (!ext) return { error: 'WEBGL_lose_context extension not available' }

    ext.loseContext()
    await new Promise((resolve) => setTimeout(resolve, 50))

    const isContextLostAfterLose = renderer.isContextLost
    const opacityAfterLoss = img1.style.opacity

    // Trigger restore
    isRestoring = true
    ext.restoreContext()

    await new Promise((resolve) => setTimeout(resolve, 50))
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve))))

    const finalUploads = textureUploadCount
    const finalOpacity = img1.style.opacity

    // Sample pixel directly from restored WebGL canvas (img1 at top 10, left 10, width 100, height 100 is solid red)
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const glX = Math.round(20 * dpr)
    const glY = Math.round((window.innerHeight - 20) * dpr)
    const restoredPixel = new Uint8Array(4)
    gl.readPixels(glX, glY, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, restoredPixel)

    inst.destroy()

    return {
      initialOpacity,
      opacityBeforeActivate,
      initialDraws,
      initialUploads,
      opacityAfterDraw,
      isContextLostAfterLose,
      opacityAfterLoss,
      finalUploads,
      finalOpacity,
      drawHappenedBeforeOpacityZeroOnRestore,
      restoredRed: restoredPixel[0],
    }
  })

  check('context-loss: source img opacity initially empty', lossRestore.initialOpacity === '', `opacity=${lossRestore.initialOpacity}`)
  check('context-loss: source img opacity empty before activation', lossRestore.opacityBeforeActivate === '', `opacity=${lossRestore.opacityBeforeActivate}`)
  check('context-loss: draw call occurred after activate', lossRestore.initialDraws > 0, `draws=${lossRestore.initialDraws}`)
  check('context-loss: texture was uploaded', lossRestore.initialUploads > 0, `uploads=${lossRestore.initialUploads}`)
  check('context-loss: source hidden only after successful draw', lossRestore.opacityAfterDraw === '0', `opacity=${lossRestore.opacityAfterDraw}`)
  check('context-loss: isContextLost flag set on loseContext', lossRestore.isContextLostAfterLose === true, `lost=${lossRestore.isContextLostAfterLose}`)
  check('context-loss: source becomes visible again upon context loss', lossRestore.opacityAfterLoss === '', `opacity=${lossRestore.opacityAfterLoss}`)
  check('context-loss: texture upload count increased after restore', lossRestore.finalUploads > lossRestore.initialUploads, `initial=${lossRestore.initialUploads}, final=${lossRestore.finalUploads}`)
  check('context-loss: draw happened before opacity returned to 0 on restore', lossRestore.drawHappenedBeforeOpacityZeroOnRestore === true, `happened=${lossRestore.drawHappenedBeforeOpacityZeroOnRestore}`)
  check('context-loss: opacity returned to 0 after restored draw', lossRestore.finalOpacity === '0', `opacity=${lossRestore.finalOpacity}`)
  check('context-loss: canvas actively renders restored image pixels (red)', lossRestore.restoredRed > 200, `red=${lossRestore.restoredRed}`)

  // -------------------------------------------------------------------------
  // 2. Partially clipped element (UV crop pixel check)
  // -------------------------------------------------------------------------
  const clipResult = await page.evaluate(async () => {
    const { prepareShaders, getSharedShaderRenderer, createEffectParams } = window.kUIAdvanced
    const imgClipped = document.getElementById('img-clipped')
    if (!imgClipped) return { error: 'img-clipped not found' }

    // Strength 0 and speed 0 to avoid wave distortion displacing pixels
    const inst = prepareShaders(imgClipped, createEffectParams({ mode: 'displace', strength: 0, speed: 0 }))
    inst.activate()

    const renderer = getSharedShaderRenderer()
    const gl = renderer.gl
    if (!gl) return { error: 'No WebGL context' }

    // Wait 2 rAFs for render
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))

    // Read pixel inside requestAnimationFrame directly after draw
    return new Promise((resolve) => {
      requestAnimationFrame(() => {
        // img-clipped is at left: -50px, top: 150px, width: 100px, height: 100px.
        // Screen x=20 is inside the visible scissor rect (0 to 50px).
        // Screen y=200 is in the vertical center of the element (150 to 250px).
        // Element UV x=20 corresponds to image x = 70px (which is the green half: 50..100px).
        const dpr = Math.min(window.devicePixelRatio || 1, 2)
        const glX = Math.round(20 * dpr)
        const glY = Math.round((window.innerHeight - 200) * dpr)

        const pixel = new Uint8Array(4)
        gl.readPixels(glX, glY, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel)
        inst.destroy()

        resolve({
          r: pixel[0],
          g: pixel[1],
          b: pixel[2],
          a: pixel[3],
        })
      })
    })
  })

  check(
    'partially-clipped: visible half displays matching half of image (green), not squeezed (red)',
    clipResult.g > 200 && clipResult.r < 50,
    `RGBA=(${clipResult.r}, ${clipResult.g}, ${clipResult.b}, ${clipResult.a})`,
  )

  // -------------------------------------------------------------------------
  // 3. Draw isolation: two shader sources, one throws
  // -------------------------------------------------------------------------
  const isolation = await page.evaluate(async () => {
    const { prepareShaders, getSharedShaderRenderer, createEffectParams } = window.kUIAdvanced
    const img1 = document.getElementById('img1')
    const img2 = document.getElementById('img2')

    const inst1 = prepareShaders(img1, createEffectParams({ mode: 'displace' }))
    const inst2 = prepareShaders(img2, createEffectParams({ mode: 'fluid' }))

    inst1.activate()
    inst2.activate()

    const renderer = getSharedShaderRenderer()

    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))

    const img1OpacityBefore = img1.style.opacity
    const img2OpacityBefore = img2.style.opacity

    // Intercept inst1 drawCall and make it throw
    const keys = Array.from(renderer.drawCalls.keys())
    const inst1Key = keys[0]
    let throwCount = 0

    renderer.drawCalls.set(inst1Key, () => {
      throwCount++
      throw new Error('Simulated draw crash in instance 1')
    })

    // Execute render frame where error is thrown
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))

    const img1OpacityAfter = img1.style.opacity
    const img2OpacityAfter = img2.style.opacity
    const rafActive = renderer.rafId !== null
    const inst1StillRegistered = renderer.drawCalls.has(inst1Key)

    // Verify surviving instance 2 still receives draw calls
    let inst2Drew = false
    const keysAfter = Array.from(renderer.drawCalls.keys())
    const inst2Key = keysAfter[0]
    if (inst2Key) {
      const origDraw = renderer.drawCalls.get(inst2Key)
      renderer.drawCalls.set(inst2Key, (gl, time) => {
        inst2Drew = true
        origDraw(gl, time)
      })
    }

    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))

    inst1.destroy()
    inst2.destroy()

    return {
      img1OpacityBefore,
      img2OpacityBefore,
      throwCount,
      img1OpacityAfter,
      img2OpacityAfter,
      rafActive,
      inst1StillRegistered,
      inst2Drew,
    }
  })

  check('draw-isolation: both instances hidden during normal draw', isolation.img1OpacityBefore === '0' && isolation.img2OpacityBefore === '0', `img1=${isolation.img1OpacityBefore}, img2=${isolation.img2OpacityBefore}`)
  check('draw-isolation: throw occurred in instance 1', isolation.throwCount > 0, `throwCount=${isolation.throwCount}`)
  check('draw-isolation: instance 1 opacity restored to visible on throw', isolation.img1OpacityAfter === '', `img1=${isolation.img1OpacityAfter}`)
  check('draw-isolation: instance 2 remains hidden and drawing', isolation.img2OpacityAfter === '0', `img2=${isolation.img2OpacityAfter}`)
  check('draw-isolation: rAF loop survived the throw', isolation.rafActive === true, `rafActive=${isolation.rafActive}`)
  check('draw-isolation: throwing instance was unregistered', isolation.inst1StillRegistered === false, `registered=${isolation.inst1StillRegistered}`)
  check('draw-isolation: surviving instance continues to draw', isolation.inst2Drew === true, `inst2Drew=${isolation.inst2Drew}`)

  // -------------------------------------------------------------------------
  // 4. Author-written opacity: 0 persistence
  // -------------------------------------------------------------------------
  const authoredZero = await page.evaluate(async () => {
    const { prepareShaders, getSharedShaderRenderer, createEffectParams } = window.kUIAdvanced
    const el = document.getElementById('authored-zero')

    const initialStyleOpacity = el.style.opacity // authored '0'
    const inst = prepareShaders(el, createEffectParams({ mode: 'displace' }))
    inst.activate()

    const renderer = getSharedShaderRenderer()
    const gl = renderer.gl

    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    const opacityDuringDraw = el.style.opacity

    // 4a. Trigger failed draw
    const keys = Array.from(renderer.drawCalls.keys())
    const drawKey = keys[keys.length - 1]
    renderer.drawCalls.set(drawKey, () => {
      throw new Error('Failed draw')
    })

    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    const opacityAfterFailedDraw = el.style.opacity

    // 4b. Trigger context loss
    const ext = gl?.getExtension('WEBGL_lose_context')
    if (ext) {
      ext.loseContext()
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    const opacityAfterContextLoss = el.style.opacity

    if (ext) {
      ext.restoreContext()
      await new Promise((resolve) => setTimeout(resolve, 50))
    }

    // 4c. Destroy
    inst.destroy()
    const opacityAfterDestroy = el.style.opacity

    return {
      initialStyleOpacity,
      opacityDuringDraw,
      opacityAfterFailedDraw,
      opacityAfterContextLoss,
      opacityAfterDestroy,
    }
  })

  check('authored-zero: initial inline style is 0', authoredZero.initialStyleOpacity === '0', `opacity=${authoredZero.initialStyleOpacity}`)
  check('authored-zero: remains 0 during draw', authoredZero.opacityDuringDraw === '0', `opacity=${authoredZero.opacityDuringDraw}`)
  check('authored-zero: remains 0 after failed draw (never \'\')', authoredZero.opacityAfterFailedDraw === '0', `opacity=${authoredZero.opacityAfterFailedDraw}`)
  check('authored-zero: remains 0 after context loss (never \'\')', authoredZero.opacityAfterContextLoss === '0', `opacity=${authoredZero.opacityAfterContextLoss}`)
  check('authored-zero: remains 0 after destroy (never \'\')', authoredZero.opacityAfterDestroy === '0', `opacity=${authoredZero.opacityAfterDestroy}`)

  // -------------------------------------------------------------------------
  // 5. Double destroy with two instances sharing renderer
  // -------------------------------------------------------------------------
  const doubleDestroy = await page.evaluate(async () => {
    const { prepareShaders, getSharedShaderRenderer, createEffectParams } = window.kUIAdvanced
    const img1 = document.getElementById('img1')
    const img2 = document.getElementById('img2')

    const inst1 = prepareShaders(img1, createEffectParams({ mode: 'displace' }))
    const inst2 = prepareShaders(img2, createEffectParams({ mode: 'displace' }))

    inst1.activate()
    inst2.activate()

    const renderer = getSharedShaderRenderer()
    const initialRefCount = renderer.refCount

    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))

    // Destroy instance 1 ONCE
    inst1.destroy()
    const refCountAfterFirstDestroy = renderer.refCount
    const img1OpacityAfterFirstDestroy = img1.style.opacity

    // Destroy instance 1 A SECOND TIME
    inst1.destroy()
    const refCountAfterSecondDestroy = renderer.refCount

    let inst2Drew = false
    const keys = Array.from(renderer.drawCalls.keys())
    const inst2Key = keys[0]
    if (inst2Key) {
      const origDraw = renderer.drawCalls.get(inst2Key)
      renderer.drawCalls.set(inst2Key, (gl, time) => {
        inst2Drew = true
        origDraw(gl, time)
      })
    }

    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))

    const img2OpacityWhileSurvivor = img2.style.opacity
    const rendererStillHasGL = renderer.gl !== null
    const canvasInDOM = !!document.querySelector('canvas.kui-shader-canvas')

    // Clean up survivor
    inst2.destroy()
    const finalRefCount = renderer.refCount
    const canvasRemoved = !document.querySelector('canvas.kui-shader-canvas')

    return {
      initialRefCount,
      refCountAfterFirstDestroy,
      refCountAfterSecondDestroy,
      img1OpacityAfterFirstDestroy,
      img2OpacityWhileSurvivor,
      rendererStillHasGL,
      canvasInDOM,
      inst2Drew,
      finalRefCount,
      canvasRemoved,
    }
  })

  check('double-destroy: initial refCount is 2', doubleDestroy.initialRefCount === 2, `refCount=${doubleDestroy.initialRefCount}`)
  check('double-destroy: refCount decremented to 1 after first destroy', doubleDestroy.refCountAfterFirstDestroy === 1, `refCount=${doubleDestroy.refCountAfterFirstDestroy}`)
  check('double-destroy: second destroy is idempotent, refCount stays 1', doubleDestroy.refCountAfterSecondDestroy === 1, `refCount=${doubleDestroy.refCountAfterSecondDestroy}`)
  check('double-destroy: instance 1 opacity restored', doubleDestroy.img1OpacityAfterFirstDestroy === '', `opacity=${doubleDestroy.img1OpacityAfterFirstDestroy}`)
  check('double-destroy: instance 2 remains drawing at opacity 0', doubleDestroy.img2OpacityWhileSurvivor === '0', `opacity=${doubleDestroy.img2OpacityWhileSurvivor}`)
  check('double-destroy: renderer WebGL context preserved', doubleDestroy.rendererStillHasGL === true, `gl=${doubleDestroy.rendererStillHasGL}`)
  check('double-destroy: canvas remains mounted in DOM', doubleDestroy.canvasInDOM === true, `canvasInDOM=${doubleDestroy.canvasInDOM}`)
  check('double-destroy: survivor continues to receive draw calls', doubleDestroy.inst2Drew === true, `inst2Drew=${doubleDestroy.inst2Drew}`)
  check('double-destroy: refCount drops to 0 after survivor destroyed', doubleDestroy.finalRefCount === 0, `refCount=${doubleDestroy.finalRefCount}`)
  check('double-destroy: canvas unmounted when refCount reaches 0', doubleDestroy.canvasRemoved === true, `canvasRemoved=${doubleDestroy.canvasRemoved}`)

  // -------------------------------------------------------------------------
  // 6. Real WebGL2 shader compilation. jsdom has no real GL context at all (see the unit suite's
  //    "Not implemented: HTMLCanvasElement.prototype.getContext" logs) — a mocked `getContext`
  //    always reports success regardless of whether the actual GLSL in `glsl.ts` is valid. This is
  //    the one check that would catch a genuine syntax error in the shipped shader sources.
  // -------------------------------------------------------------------------
  const shaderCompile = await page.evaluate(() => {
    const { getSharedShaderRenderer } = window.kUIAdvanced
    const renderer = getSharedShaderRenderer()
    const acquired = renderer.acquire()
    const gl = renderer.gl
    const modes = ['displace', 'fluid', 'liquid', 'particles', 'morph']
    const missing = modes.filter((mode) => !renderer.programs[mode] || !renderer.programs[mode].program)
    const glError = gl ? gl.getError() : -1
    renderer.release()
    return { acquired, missing, glError }
  })

  check('shader-compile: renderer acquires a real WebGL2 context', shaderCompile.acquired === true, `acquired=${shaderCompile.acquired}`)
  check('shader-compile: all five production shader programs link in real WebGL2', shaderCompile.missing.length === 0, `missing=${shaderCompile.missing.join(',') || 'none'}`)
  check('shader-compile: no leftover GL error after compiling the real catalog', shaderCompile.glError === 0, `glError=${shaderCompile.glError}`)

  // -------------------------------------------------------------------------
  // 7. Real GLSL compile failure. A mocked `getShaderParameter` can be told to return whatever a
  //    test wants; only a real compiler proves `compileShader`/`createProgram` actually return
  //    null when given genuinely invalid GLSL, rather than merely reacting correctly to a stub.
  // -------------------------------------------------------------------------
  const invalidGlsl = await page.evaluate(() => {
    const { compileShader, createProgram } = window.kUIAdvanced
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl2')
    if (!gl) return { error: 'no webgl2' }
    const validVS = `#version 300 es
in vec2 a_position;
void main() { gl_Position = vec4(a_position, 0.0, 1.0); }
`
    const brokenFS = `#version 300 es
precision highp float;
out vec4 fragColor;
void main() { this is not valid glsl at all !! }
`
    const shader = compileShader(gl, gl.FRAGMENT_SHADER, brokenFS)
    const program = createProgram(gl, validVS, brokenFS)
    return { shaderIsNull: shader === null, programIsNull: program === null }
  })

  check('invalid-glsl: compileShader returns null on a real compile error', invalidGlsl.shaderIsNull === true, `shaderIsNull=${invalidGlsl.shaderIsNull}`)
  check('invalid-glsl: createProgram returns null when a real shader fails to compile', invalidGlsl.programIsNull === true, `programIsNull=${invalidGlsl.programIsNull}`)

  // -------------------------------------------------------------------------
  // 8. Real canvas-2D color resolution. jsdom cannot construct a 2D context at all (`parseColor`'s
  //    canvas fallback is unreachable in the unit suite), so this is the only tier that can prove
  //    it actually resolves a CSS color string the way a browser does.
  // -------------------------------------------------------------------------
  const realColor = await page.evaluate(() => {
    const { parseColor } = window.kUIAdvanced
    // Not in this module's small hardcoded NAMED_COLORS table, so a correct answer proves the
    // real canvas-2D fallback path ran rather than a lookup table hit.
    return parseColor('rebeccapurple')
  })

  const rebeccaPurpleMatches = Array.isArray(realColor)
    && Math.abs(realColor[0] - 0x66 / 255) < 0.01
    && Math.abs(realColor[1] - 0x33 / 255) < 0.01
    && Math.abs(realColor[2] - 0x99 / 255) < 0.01
  check('real-color: unlisted CSS named color resolves via real canvas 2D', rebeccaPurpleMatches, `rgba=${JSON.stringify(realColor)}`)

  await context.close()

  // -------------------------------------------------------------------------
  // 9. Scroll -> shader progress bridge, same element and through an ancestor. A separate page and
  //    fixture: this one needs the window to actually scroll, unlike the fixed-layout page above.
  // -------------------------------------------------------------------------
  const BRIDGE_FIXTURE_URL = `file://${fileURLToPath(new URL('./fixtures/advanced-progress-bridge.html', import.meta.url))}`
  const bridgeContext = await browser.newContext({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 1 })
  const bridgePage = await bridgeContext.newPage()
  await bridgePage.goto(BRIDGE_FIXTURE_URL)
  await bridgePage.waitForFunction(() => window.__kuiReady === true && window.kUIAdvanced !== undefined)

  const bridge = await bridgePage.evaluate(async () => {
    const { kuinetic, registerAdvanced, getSharedShaderRenderer } = window.kUIAdvanced
    const k = kuinetic()
    registerAdvanced(k)
    k.start()

    const settle = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    await settle()

    const renderer = getSharedShaderRenderer()
    const gl = renderer.gl
    if (!gl) return { error: 'no gl' }

    const sameEl = document.getElementById('progress-same')
    const childEl = document.getElementById('progress-child')
    const computedProgress = (el) => parseFloat(getComputedStyle(el).getPropertyValue('--kui-progress'))

    // The value actually uploaded to the GPU for this frame's draw of `mode` — real GPU state,
    // not an inference from an inline style. Only meaningful while the element is on screen: the
    // shader skips its draw (and therefore the upload) for a scissor-clipped-to-nothing element,
    // same as every other check in this suite that scrolls an element out of view.
    function readProgressUniform(mode) {
      const prog = renderer.programs[mode]
      if (!prog || !prog.program || !prog.u_progress) return null
      return gl.getUniform(prog.program, prog.u_progress)
    }

    async function scrollTo(top) {
      window.scrollTo({ top, behavior: 'instant' })
      await settle()
      return window.scrollY
    }

    const childInlineAtStart = childEl.style.getPropertyValue('--kui-progress')

    // #progress-same spans document y 300..1500 (a 300px spacer, then its own authored 1200px
    // height — `scroll-progress`'s default span with no `distance:` authored). Three points
    // across that range, read straight off the CSS custom property so the reading does not depend
    // on the shader's own visibility gating.
    const scrollYStart = await scrollTo(0)
    const sameProgressStart = computedProgress(sameEl)
    const scrollYSameEarly = await scrollTo(600)
    const sameProgressEarly = computedProgress(sameEl)
    const scrollYSameLate = await scrollTo(1400)
    const sameProgressLate = computedProgress(sameEl)
    // Read the GPU uniform while #progress-same is still comfortably on screen (top of viewport
    // at 1400 is inside its 300..1500 span), proving the shader draw itself — not just the CSS
    // custom property — carries the live value.
    const sameUniformLate = readProgressUniform('displace')

    // #ancestor-driver spans document y 2300..3500; #progress-child sits 400..600px into it
    // (y 2700..2900) and is only ever on screen (600px viewport) for scrollY roughly 2100..2900.
    const scrollYChildVisible = await scrollTo(2750)
    const childProgressVisible = computedProgress(childEl)
    const childUniformVisible = readProgressUniform('liquid')
    const scrollYChildLate = await scrollTo(3500)
    const childProgressLate = computedProgress(childEl)

    return {
      scrollYStart, scrollYSameEarly, scrollYSameLate, scrollYChildVisible, scrollYChildLate,
      sameProgressStart, sameProgressEarly, sameProgressLate, sameUniformLate,
      childInlineAtStart, childProgressVisible, childUniformVisible, childProgressLate,
    }
  })

  check('progress-bridge: scroll landed at 0 before scrolling (not clamped short)', bridge.scrollYStart === 0, `scrollY=${bridge.scrollYStart}`)
  check('progress-bridge: scroll landed at each intended target (no clamping)', bridge.scrollYSameEarly === 600 && bridge.scrollYSameLate === 1400 && bridge.scrollYChildVisible === 2750 && bridge.scrollYChildLate === 3500, `targets=${JSON.stringify([bridge.scrollYSameEarly, bridge.scrollYSameLate, bridge.scrollYChildVisible, bridge.scrollYChildLate])}`)

  check('progress-bridge: same-element progress starts at 0', bridge.sameProgressStart === 0, `progress=${bridge.sameProgressStart}`)
  check(
    'progress-bridge: same-element progress increases monotonically as the page scrolls',
    bridge.sameProgressStart <= bridge.sameProgressEarly && bridge.sameProgressEarly <= bridge.sameProgressLate && bridge.sameProgressStart < bridge.sameProgressLate,
    `start=${bridge.sameProgressStart}, early=${bridge.sameProgressEarly}, late=${bridge.sameProgressLate}`,
  )
  check(
    "progress-bridge: the shader's own uniform (real GPU state) matches the CSS custom property it read",
    bridge.sameUniformLate !== null && Math.abs(bridge.sameUniformLate - bridge.sameProgressLate) < 0.01,
    `uniform=${bridge.sameUniformLate}, cssProgress=${bridge.sameProgressLate}`,
  )

  check('progress-bridge: the shader element never writes --kui-progress on its own inline style', bridge.childInlineAtStart === '', `inline=${JSON.stringify(bridge.childInlineAtStart)}`)
  check(
    'progress-bridge: an element with no scroll-progress of its own inherits a real, non-trivial value from its ancestor',
    bridge.childProgressVisible > 0 && bridge.childProgressVisible < 1,
    `progress=${bridge.childProgressVisible}`,
  )
  check(
    "progress-bridge: the ancestor-driven shader's own uniform matches the inherited CSS value — proof the fix (not just the CSS cascade) reaches the draw",
    bridge.childUniformVisible !== null && Math.abs(bridge.childUniformVisible - bridge.childProgressVisible) < 0.01,
    `uniform=${bridge.childUniformVisible}, cssProgress=${bridge.childProgressVisible}`,
  )
  check(
    'progress-bridge: the inherited progress keeps advancing as the page scrolls further',
    bridge.childProgressLate > bridge.childProgressVisible,
    `visible=${bridge.childProgressVisible}, late=${bridge.childProgressLate}`,
  )

  await bridgeContext.close()

  // -------------------------------------------------------------------------
  // 10. Audio -> shader and audio -> camera, driven through the contract itself: the `--kui-audio-*`
  //     custom properties, written on the consumer's own element and on an ancestor of it. Written
  //     directly rather than through a real `audio-source` so the value under test is exact and the
  //     check is not waiting on an audio graph; check 11 does the real thing.
  // -------------------------------------------------------------------------
  const AUDIO_FIXTURE_URL = `file://${fileURLToPath(new URL('./fixtures/advanced-audio-bridge.html', import.meta.url))}`
  const audioContext = await browser.newContext({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 1 })
  const audioPage = await audioContext.newPage()
  await audioPage.goto(AUDIO_FIXTURE_URL)
  await audioPage.waitForFunction(() => window.__kuiReady === true && window.kUIAdvanced !== undefined)

  const audioBridge = await audioPage.evaluate(async () => {
    const { kuinetic, registerAdvanced, getSharedShaderRenderer } = window.kUIAdvanced
    const k = kuinetic()
    registerAdvanced(k)
    k.start()

    const settle = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    await settle()

    const renderer = getSharedShaderRenderer()
    const gl = renderer.gl
    if (!gl) return { error: 'no gl' }

    // Real GPU state for one mode's `u_audio`. Each element in this fixture uses a mode of its
    // own precisely because the programs are shared: `getUniform` answers with whatever the last
    // instance to draw with that program uploaded.
    function readAudioUniform(mode) {
      const prog = renderer.programs[mode]
      if (!prog || !prog.program || !prog.u_audio) return null
      return gl.getUniform(prog.program, prog.u_audio)
    }
    // The camera writes the push into the layer's `translate3d`; this is the z it landed on.
    function layerZ() {
      const match = /translate3d\([^,]+,[^,]+,\s*(-?[\d.]+)px\)/.exec(document.getElementById('cam-layer').style.transform)
      return match ? parseFloat(match[1]) : null
    }

    const same = document.getElementById('audio-same')
    const child = document.getElementById('audio-child')
    const driver = document.getElementById('audio-driver')
    const off = document.getElementById('audio-off')
    const cam = document.getElementById('cam')
    const camDriver = document.getElementById('cam-driver')

    const quiet = {
      same: readAudioUniform('liquid'),
      child: readAudioUniform('displace'),
      off: readAudioUniform('fluid'),
      z: layerZ(),
    }
    const childInlineAtStart = child.style.getPropertyValue('--kui-audio-mid')

    same.style.setProperty('--kui-audio-bass', '0.8')
    driver.style.setProperty('--kui-audio-mid', '0.6')
    // Every band at full scale on an element whose shader never asked for one.
    for (const prop of ['--kui-audio-bass', '--kui-audio-mid', '--kui-audio-treble', '--kui-audio-level']) {
      off.style.setProperty(prop, '1')
    }
    cam.style.setProperty('--kui-audio-bass', '1')
    await settle()
    const loud = {
      same: readAudioUniform('liquid'),
      child: readAudioUniform('displace'),
      off: readAudioUniform('fluid'),
      z: layerZ(),
      camPerspective: cam.style.perspective,
    }

    same.style.setProperty('--kui-audio-bass', '0')
    driver.style.setProperty('--kui-audio-mid', '0')
    cam.style.removeProperty('--kui-audio-bass')
    await settle()
    const backToQuiet = { same: readAudioUniform('liquid'), child: readAudioUniform('displace'), z: layerZ() }

    // The camera's own container now declares nothing; only inheritance can reach it.
    camDriver.style.setProperty('--kui-audio-bass', '1')
    await settle()
    const inheritedZ = layerZ()

    return { quiet, loud, backToQuiet, childInlineAtStart, inheritedZ }
  })

  check('audio-bridge: a shader with no audio: uniform starts at 0', audioBridge.quiet.same === 0 && audioBridge.quiet.child === 0, `same=${audioBridge.quiet.same}, child=${audioBridge.quiet.child}`)
  check(
    "audio-bridge: a band on the shader's own element reaches the real GPU uniform",
    Math.abs(audioBridge.loud.same - 0.8) < 0.01,
    `uniform=${audioBridge.loud.same}`,
  )
  check('audio-bridge: the shader element never writes --kui-audio-mid on its own inline style', audioBridge.childInlineAtStart === '', `inline=${JSON.stringify(audioBridge.childInlineAtStart)}`)
  check(
    'audio-bridge: a band on an ancestor reaches a shader that declares none of its own',
    Math.abs(audioBridge.loud.child - 0.6) < 0.01,
    `uniform=${audioBridge.loud.child}`,
  )
  check(
    'audio-bridge: a shader without audio: stays at 0 with every band at full scale on its own element',
    audioBridge.loud.off === 0,
    `uniform=${audioBridge.loud.off}`,
  )
  check(
    'audio-bridge: the uniform follows the band back down, not just up',
    audioBridge.backToQuiet.same === 0 && audioBridge.backToQuiet.child === 0,
    `same=${audioBridge.backToQuiet.same}, child=${audioBridge.backToQuiet.child}`,
  )

  check('audio-camera: the scene renders a real depth before any audio', audioBridge.quiet.z !== null && audioBridge.quiet.z > 0, `z=${audioBridge.quiet.z}`)
  check('audio-camera: perspective comes from the authored depth', audioBridge.loud.camPerspective === '1000px', `perspective=${audioBridge.loud.camPerspective}`)
  check(
    'audio-camera: a full-scale band on the container pushes the camera a tenth of depth (50px of layer z)',
    Math.abs((audioBridge.loud.z - audioBridge.quiet.z) - 50) < 0.5,
    `quiet=${audioBridge.quiet.z}, loud=${audioBridge.loud.z}`,
  )
  check(
    'audio-camera: removing the band puts the scene back exactly where it was',
    Math.abs(audioBridge.backToQuiet.z - audioBridge.quiet.z) < 0.5,
    `quiet=${audioBridge.quiet.z}, after=${audioBridge.backToQuiet.z}`,
  )
  check(
    'audio-camera: a band on an ancestor of the container drives it too',
    Math.abs((audioBridge.inheritedZ - audioBridge.quiet.z) - 50) < 0.5,
    `quiet=${audioBridge.quiet.z}, inherited=${audioBridge.inheritedZ}`,
  )

  await audioContext.close()

  // -------------------------------------------------------------------------
  // 11. The whole chain for real, in one page: a WAV built at runtime -> `<audio>` -> the
  //     `audio-source` primitive's Web Audio graph -> `--kui-audio-bass` on the host -> the
  //     shader's `u_audio`. Nothing here is written by the test.
  //
  //     Two environment facts make it work headless: a trusted click before anything starts
  //     (Chromium's autoplay policy needs user activation before an AudioContext will leave
  //     `suspended`), and a blob URL rather than a cross-origin source (a tainted media element
  //     feeds silence into `createMediaElementSource`). A failure here on a machine with no audio
  //     backend at all is the environment, not the bridge — check 10 covers the contract itself
  //     without any audio.
  // -------------------------------------------------------------------------
  const e2eContext = await browser.newContext({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 1 })
  const e2ePage = await e2eContext.newPage()
  await e2ePage.goto(AUDIO_FIXTURE_URL)
  await e2ePage.waitForFunction(() => window.__kuiReady === true && window.kUIAdvanced !== undefined)
  await e2ePage.mouse.click(700, 550)

  const realAudio = await e2ePage.evaluate(async () => {
    const { kuinetic, registerAdvanced, getSharedShaderRenderer } = window.kUIAdvanced

    /** A 120Hz sine — squarely inside the 20..250Hz the bass band averages — as a WAV blob. */
    function sineWav(freq, seconds, rate) {
      const samples = Math.floor(seconds * rate)
      const view = new DataView(new ArrayBuffer(44 + samples * 2))
      const str = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)) }
      str(0, 'RIFF'); view.setUint32(4, 36 + samples * 2, true); str(8, 'WAVEfmt ')
      view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true)
      view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true)
      view.setUint16(34, 16, true); str(36, 'data'); view.setUint32(40, samples * 2, true)
      for (let i = 0; i < samples; i++) {
        view.setInt16(44 + i * 2, Math.round(Math.sin((2 * Math.PI * freq * i) / rate) * 32000), true)
      }
      return new Blob([view.buffer], { type: 'audio/wav' })
    }

    const media = document.getElementById('e2e-audio')
    media.src = URL.createObjectURL(sineWav(120, 1, 48000))
    media.volume = 0.5
    let playError = ''
    try {
      await media.play()
    } catch (err) {
      playError = String(err && err.message)
    }

    const k = kuinetic()
    registerAdvanced(k)
    k.start()

    const el = document.getElementById('e2e')
    const renderer = getSharedShaderRenderer()
    const gl = renderer.gl
    if (!gl) return { error: 'no gl' }
    const readMorphAudio = () => {
      const prog = renderer.programs.morph
      if (!prog || !prog.program || !prog.u_audio) return null
      return gl.getUniform(prog.program, prog.u_audio)
    }

    // The driver's own write and the shader's upload are a frame apart by design (the renderer
    // reads every instance at the top of its own frame), so wait for both.
    let inline = ''
    let uniform = null
    const started = performance.now()
    while (performance.now() - started < 8000) {
      await new Promise((resolve) => requestAnimationFrame(resolve))
      inline = el.style.getPropertyValue('--kui-audio-bass')
      uniform = readMorphAudio()
      if (parseFloat(inline) > 0.3 && uniform > 0.3) break
    }

    return { playError, paused: media.paused, inline, uniform, waited: Math.round(performance.now() - started) }
  })

  check('real-audio: the WAV actually plays', realAudio.playError === '' && realAudio.paused === false, `error=${realAudio.playError}, paused=${realAudio.paused}`)
  check(
    'real-audio: audio-source turns a real 120Hz tone into a real --kui-audio-bass on its host',
    parseFloat(realAudio.inline) > 0.3,
    `inline=${JSON.stringify(realAudio.inline)}, waited=${realAudio.waited}ms`,
  )
  check(
    "real-audio: and the shader composed beside it uploads that band as its own uniform",
    realAudio.uniform !== null && realAudio.uniform > 0.3,
    `uniform=${realAudio.uniform}, inline=${realAudio.inline}`,
  )

  await e2eContext.close()

  await runOverlayFidelity({ browser, check })

  return results
}

/**
 * 12. Does the replica actually match the element it replaces?
 *
 * The overlay is one shared, full-viewport, fixed canvas standing in for an element the module
 * hides, so every probe here is asking the same question from a different angle: is what the GPU
 * drew what the page would have shown? A single `getBoundingClientRect` was the only geometry input
 * before this block existed, which made all five answers below "no".
 *
 * Deliberately the only context in the suite at `deviceScaleFactor: 2` — every other one runs at 1,
 * where `Math.min(devicePixelRatio, 2)`, the `* dpr` rounding in the scissor box and the canvas
 * sizing are all identity operations, so no DPR bug of any kind could show up. Here a wrong dpr
 * misses every probe.
 */
async function runOverlayFidelity({ browser, check }) {
  const url = `file://${fileURLToPath(new URL('./fixtures/advanced-overlay-fidelity.html', import.meta.url))}`
  const context = await browser.newContext({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 2 })
  const page = await context.newPage()
  await page.goto(url)
  await page.waitForFunction(() => window.__kuiReady === true && window.kUIAdvanced !== undefined)

  const fidelity = await page.evaluate(async () => {
    const { prepareShaders, getSharedShaderRenderer, createEffectParams } = window.kUIAdvanced
    // strength/speed 0 so `displace` samples the texture exactly, with no ripple offset: every
    // probe below is about *where* a pixel came from, not what the shader did to it.
    const flat = () => createEffectParams({ mode: 'displace', strength: 0, speed: 0 })
    const ids = ['cover', 'contain', 'round', 'clipped', 'under']
    const instances = ids.map((id) => prepareShaders(document.getElementById(id), flat()))
    for (const inst of instances) inst.activate()

    const renderer = getSharedShaderRenderer()
    const gl = renderer.gl
    if (!gl) return { error: 'no gl' }
    const canvas = renderer.canvas

    const settle = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    await settle()

    return new Promise((resolve) => {
      requestAnimationFrame(() => {
        // One CSS-pixel probe on the shared canvas. `devicePixelRatio` is the real thing here (2),
        // and the y flip is the canvas's own height rather than a re-derived number, so a probe
        // cannot silently agree with a wrong canvas size.
        const dpr = Math.min(window.devicePixelRatio || 1, 2)
        const px = (cssX, cssY) => {
          const out = new Uint8Array(4)
          gl.readPixels(Math.round(cssX * dpr), Math.round(canvas.height - cssY * dpr), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out)
          return [out[0], out[1], out[2], out[3]]
        }
        const barStyle = getComputedStyle(document.getElementById('bar'))
        const canvasStyle = getComputedStyle(canvas)
        const result = {
          dpr,
          canvasBacking: [canvas.width, canvas.height],
          canvasCssBox: [Math.round(canvas.getBoundingClientRect().width), Math.round(canvas.getBoundingClientRect().height)],
          viewport: [window.innerWidth, window.innerHeight],
          // cover, object-position: top — near the bottom edge of a box half the image's height
          coverLow: px(70, 143),
          // contain — the empty gutter, then the image's own left and right halves
          containGutter: px(220, 150),
          containLeft: px(270, 150),
          containRight: px(330, 150),
          // a 50px radius on a 100px box: a circle, so the box corner is outside it
          roundCorner: px(455, 105),
          roundCentre: px(500, 150),
          // a 100px image inside a 50px `overflow: hidden` box
          clipInside: px(40, 350),
          clipOutside: px(90, 350),
          // the documented stacking limit: drawn where a z-index:10 fixed bar covers the element
          underBar: px(650, 30),
          barZIndex: barStyle.zIndex,
          canvasZIndex: canvasStyle.zIndex,
          canvasPosition: canvasStyle.position,
        }
        for (const inst of instances) inst.destroy()
        resolve(result)
      })
    })
  })

  const opaque = (p) => p[3] > 200
  const clear = (p) => p[3] < 20
  const isRed = (p) => p[0] > 200 && p[1] < 60 && p[2] < 60
  const isBlue = (p) => p[2] > 200 && p[0] < 60
  const isGreen = (p) => p[1] > 200 && p[0] < 60
  const isYellow = (p) => p[0] > 200 && p[1] > 200 && p[2] < 60
  const show = (p) => `rgba(${p})`

  check('fidelity: the context really is at devicePixelRatio 2', fidelity.dpr === 2, `dpr=${fidelity.dpr}`)
  check(
    'fidelity: the canvas backing store is the viewport times dpr',
    fidelity.canvasBacking[0] === fidelity.viewport[0] * 2 && fidelity.canvasBacking[1] === fidelity.viewport[1] * 2,
    `backing=${fidelity.canvasBacking}, viewport=${fidelity.viewport}`,
  )
  check(
    'fidelity: the canvas CSS box measures the same viewport as its backing store (not 100vh)',
    fidelity.canvasCssBox[0] === fidelity.viewport[0] && fidelity.canvasCssBox[1] === fidelity.viewport[1],
    `cssBox=${fidelity.canvasCssBox}, viewport=${fidelity.viewport}`,
  )

  check(
    'fidelity: object-fit cover with object-position top crops to the image top, not squashed to fit',
    isRed(fidelity.coverLow),
    `bottom of a 100x50 box over a 100x100 image = ${show(fidelity.coverLow)} (blue means stretched)`,
  )
  check(
    "fidelity: object-fit contain leaves the letterbox gutter unpainted",
    clear(fidelity.containGutter),
    `gutter=${show(fidelity.containGutter)}`,
  )
  check(
    'fidelity: object-fit contain still maps the image across the box it does fill',
    isRed(fidelity.containLeft) && isBlue(fidelity.containRight),
    `left=${show(fidelity.containLeft)}, right=${show(fidelity.containRight)}`,
  )
  check(
    'fidelity: border-radius is masked — the corner of a circular element is not painted',
    clear(fidelity.roundCorner) && isRed(fidelity.roundCentre),
    `corner=${show(fidelity.roundCorner)}, centre=${show(fidelity.roundCentre)}`,
  )
  check(
    'fidelity: an overflow:hidden ancestor clips the replica',
    isGreen(fidelity.clipInside) && clear(fidelity.clipOutside),
    `inside=${show(fidelity.clipInside)}, outside=${show(fidelity.clipOutside)}`,
  )
  check(
    'fidelity: KNOWN LIMIT — the shared canvas stacks above the whole page, so it paints over a z-index:10 fixed bar',
    opaque(fidelity.underBar) && isYellow(fidelity.underBar)
      && fidelity.canvasZIndex === '9999' && fidelity.canvasPosition === 'fixed' && fidelity.barZIndex === '10',
    `drawnUnderBar=${show(fidelity.underBar)}, canvas=${fidelity.canvasPosition}/${fidelity.canvasZIndex}, bar=${fidelity.barZIndex}`,
  )

  await context.close()
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const chromium = await loadChromium()
  const browser = await chromium.launch({ headless: true })
  const results = await run({ browser, ARTIFACT_DIR: './.artifacts' })
  await browser.close()
  const failed = results.filter((r) => !r.passed)
  if (failed.length > 0) process.exit(1)
}
