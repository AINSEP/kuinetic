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
 * 6. Real shader compilation: the six production GLSL programs in `glsl.ts` (seven modes —
 *    `gradient` and `logo` share one) actually link, with
 *    no leftover GL error — jsdom cannot check this at all (no real GL context).
 * 7. Real GLSL compile failure: `compileShader`/`createProgram` return null against genuinely
 *    invalid GLSL, not just a mock told to say so.
 * 8. Real canvas-2D color resolution: `parseColor`'s canvas fallback against a CSS color outside
 *    its hardcoded name table — unreachable in jsdom, which has no canvas 2D context either.
 * 9. Scroll -> shader progress bridge, and the `scrub: scroll` opt-in that gates it: a
 *    `scroll-progress` primitive on the shader's own element, and on an ancestor (relying on
 *    `--kui-progress` inheriting through `getComputedStyle`), both drive the real `u_progress`
 *    uniform as the page actually scrolls — and a third shader under the same ancestor, with no
 *    `scrub:` of its own, stays at the `-1` sentinel throughout.
 * 10. Audio -> shader and audio -> camera bridge: a `--kui-audio-*` band on the consumer's own
 *    element and on an ancestor drives the real `u_audio` uniform and the camera's real
 *    `translate3d`, and a consumer with no `audio:` stays at 0 with every band at full scale.
 * 11. The same chain end to end with a real `audio-source`: a WAV built in the page, played
 *    through a real Web Audio graph, read back off the real uniform.
 * 16. Four defects a WebGL mock cannot reach: `screen`/`add`/duotone inventing coverage a
 *    transparent source never had, the replica ignoring its host's own `opacity`, an inactive
 *    instance re-activating onto a texture from a lost context, and a `createBuffer` that returned
 *    null coming up as a working renderer. See `runShaderDefects`.
 */
export const name = 'advanced-webgl'

const FIXTURE_URL = `file://${fileURLToPath(new URL('./fixtures/advanced-webgl.html', import.meta.url))}`
const ENTRY_FILE = fileURLToPath(new URL('./fixtures/advanced-webgl-entry.ts', import.meta.url))
// Out of the repo's tracked tree and into its gitignored `.artifacts/`. Next to the fixtures this
// was an untracked file in `git status` after every run, which in this repo is how an agent ends up
// staging a build artifact — or reaching for a destructive command to clean one up. The four
// fixtures reach it back out through `../../../.artifacts/`.
const BUNDLE_FILE = fileURLToPath(new URL('../../.artifacts/browser-fixtures/advanced-webgl.bundle.js', import.meta.url))

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
  // Not "and drawing": img2 was already hidden before the injected throw, and the only thing that
  // clears that is a *failed* draw, so a completely frozen loop passes this. It is worth keeping as
  // the negative half — the throw next door did not un-hide it — but the evidence for "drawing" is
  // the `inst2Drew` check below, and this one must not be read as a second vote for it.
  check('draw-isolation: instance 2 was not un-hidden by its neighbour\'s throw', isolation.img2OpacityAfter === '0', `img2=${isolation.img2OpacityAfter}`)
  check('draw-isolation: rAF loop survived the throw', isolation.rafActive === true, `rafActive=${isolation.rafActive}`)
  check('draw-isolation: throwing instance was unregistered', isolation.inst1StillRegistered === false, `registered=${isolation.inst1StillRegistered}`)
  check('draw-isolation: surviving instance continues to draw', isolation.inst2Drew === true, `inst2Drew=${isolation.inst2Drew}`)

  // -------------------------------------------------------------------------
  // 4. Author-written `opacity: 0` persistence, once per teardown path.
  //
  //    This block used to run all three paths over one element and one instance, which made two
  //    of the three vacuous: the first step replaced the registered draw call with a thrower, and
  //    `renderFrame`'s catch unregisters the throwing id from `drawCalls` *and*
  //    `contextCallbacks`. By the time the context-loss step ran the fan-out had nothing to reach,
  //    and by the destroy step `hiddenByRenderer` was already false — so both were asserting that
  //    nothing had changed a value nothing read, and would have passed over a handler that
  //    clobbered the author's `0`.
  //
  //    So: one element and one instance per path, and each paired with a bare control element
  //    beside it. "Still 0" is also what a handler that never fired looks like; the control,
  //    which has no authored opacity and must come back as no declaration at all, is what
  //    distinguishes the two. Each path also records whether the instance was still registered
  //    going in, so a future refactor cannot quietly re-introduce the original vacuity.
  //
  //    The failed draw is now a real one: `gl.drawArrays` is the last call `drawElementQuad`
  //    makes, so throwing there runs the *module's own* catch (`shaders.ts`'s `drawCall`) rather
  //    than proving `renderFrame` isolates a foreign callback substituted for it.
  // -------------------------------------------------------------------------
  const authoredZero = await page.evaluate(async () => {
    const { prepareShaders, getSharedShaderRenderer, createEffectParams } = window.kUIAdvanced
    const twoFrames = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    const params = () => createEffectParams({ mode: 'displace' })
    const hide = async (authoredId, bareId) => {
      const authored = document.getElementById(authoredId)
      const bare = document.getElementById(bareId)
      const instances = [prepareShaders(authored, params()), prepareShaders(bare, params())]
      for (const inst of instances) inst.activate()
      await twoFrames()
      return { authored, bare, instances, renderer: getSharedShaderRenderer() }
    }

    // (a) a draw that genuinely fails, inside the instance's own try/catch.
    const fail = await hide('authored-zero', 'bare-fail')
    const initialStyleOpacity = fail.authored.style.opacity
    const opacityDuringDraw = fail.authored.style.opacity
    const bareHiddenDuringDraw = fail.bare.style.opacity
    const registeredAtFail = fail.renderer.drawCalls.size
    const realDrawArrays = fail.renderer.gl.drawArrays
    let drawArraysThrew = 0
    fail.renderer.gl.drawArrays = () => { drawArraysThrew += 1; throw new Error('GL draw failure') }
    await twoFrames()
    fail.renderer.gl.drawArrays = realDrawArrays
    const opacityAfterFailedDraw = fail.authored.style.opacity
    const bareAfterFailedDraw = fail.bare.style.opacity
    // The instance's own catch unregisters the draw; if it does not also clear `isActive`, the two
    // disagree forever and `activate()`'s re-entrancy guard swallows every later activation. An
    // `on:hover` element that threw once would be dead for good.
    for (const inst of fail.instances) inst.activate()
    await twoFrames()
    const bareAfterReactivate = fail.bare.style.opacity
    const registeredAfterReactivate = fail.renderer.drawCalls.size
    for (const inst of fail.instances) inst.destroy()

    // (b) a lost context, with both instances still registered for the fan-out to reach.
    const loss = await hide('authored-zero-loss', 'bare-loss')
    const registeredAtLoss = loss.renderer.contextCallbacks.size
    const bareHiddenAtLoss = loss.bare.style.opacity
    const ext = loss.renderer.gl?.getExtension('WEBGL_lose_context')
    if (ext) {
      ext.loseContext()
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    const contextWasLost = loss.renderer.isContextLost
    const opacityAfterContextLoss = loss.authored.style.opacity
    const bareAfterContextLoss = loss.bare.style.opacity
    if (ext) {
      ext.restoreContext()
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    for (const inst of loss.instances) inst.destroy()

    // (c) a destroy, with both instances still hidden.
    const gone = await hide('authored-zero-destroy', 'bare-destroy')
    const registeredAtDestroy = gone.renderer.drawCalls.size
    const bareHiddenAtDestroy = gone.bare.style.opacity
    for (const inst of gone.instances) inst.destroy()
    const opacityAfterDestroy = gone.authored.style.opacity
    const bareAfterDestroy = gone.bare.style.opacity

    return {
      initialStyleOpacity, opacityDuringDraw, bareHiddenDuringDraw,
      registeredAtFail, drawArraysThrew, opacityAfterFailedDraw, bareAfterFailedDraw,
      bareAfterReactivate, registeredAfterReactivate,
      registeredAtLoss, bareHiddenAtLoss, contextWasLost, opacityAfterContextLoss, bareAfterContextLoss,
      registeredAtDestroy, bareHiddenAtDestroy, opacityAfterDestroy, bareAfterDestroy,
    }
  })

  check('authored-zero: initial inline style is 0', authoredZero.initialStyleOpacity === '0', `opacity=${authoredZero.initialStyleOpacity}`)
  check('authored-zero: remains 0 during draw', authoredZero.opacityDuringDraw === '0', `opacity=${authoredZero.opacityDuringDraw}`)
  check('authored-zero: the bare control is hidden during draw', authoredZero.bareHiddenDuringDraw === '0', `bare=${authoredZero.bareHiddenDuringDraw}`)

  check('authored-zero: the failed-draw path had a registered instance to fail', authoredZero.registeredAtFail > 0 && authoredZero.drawArraysThrew > 0, `registered=${authoredZero.registeredAtFail}, threw=${authoredZero.drawArraysThrew}`)
  check('authored-zero: remains 0 after a real failed draw (never \'\')', authoredZero.opacityAfterFailedDraw === '0', `opacity=${authoredZero.opacityAfterFailedDraw}`)
  check('authored-zero: the bare control was given back on the same failed draw', authoredZero.bareAfterFailedDraw === '', `bare=${JSON.stringify(authoredZero.bareAfterFailedDraw)}`)
  check(
    'authored-zero: an instance that failed a draw can be activated again',
    authoredZero.registeredAfterReactivate === 2 && authoredZero.bareAfterReactivate === '0',
    `registered=${authoredZero.registeredAfterReactivate}, bare=${JSON.stringify(authoredZero.bareAfterReactivate)}`,
  )

  check('authored-zero: the context-loss fan-out had a registered instance to reach', authoredZero.registeredAtLoss > 0 && authoredZero.contextWasLost === true && authoredZero.bareHiddenAtLoss === '0', `callbacks=${authoredZero.registeredAtLoss}, lost=${authoredZero.contextWasLost}, bare=${authoredZero.bareHiddenAtLoss}`)
  check('authored-zero: remains 0 after context loss (never \'\')', authoredZero.opacityAfterContextLoss === '0', `opacity=${authoredZero.opacityAfterContextLoss}`)
  check('authored-zero: the bare control was given back on the same context loss', authoredZero.bareAfterContextLoss === '', `bare=${JSON.stringify(authoredZero.bareAfterContextLoss)}`)

  check('authored-zero: the destroy path had a registered, hidden instance', authoredZero.registeredAtDestroy > 0 && authoredZero.bareHiddenAtDestroy === '0', `registered=${authoredZero.registeredAtDestroy}, bare=${authoredZero.bareHiddenAtDestroy}`)
  check('authored-zero: remains 0 after destroy (never \'\')', authoredZero.opacityAfterDestroy === '0', `opacity=${authoredZero.opacityAfterDestroy}`)
  check('authored-zero: the bare control was given back on the same destroy', authoredZero.bareAfterDestroy === '', `bare=${JSON.stringify(authoredZero.bareAfterDestroy)}`)

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
  // 5b. The `inputReaders` pass exists for an *ordering*, and nothing asserted it.
  //
  //     `renderFrame` runs every registered instance's reads — scroll progress, an audio band,
  //     and the element geometry — in full before any instance's draw call, because a draw call
  //     writes `opacity` and all three reads can reach `getComputedStyle`/`getBoundingClientRect`.
  //     Interleaved, that is one forced style recalculation per instance instead of one per frame.
  //     Block 9 proves the progress *value* reaches `u_progress`, which is a different claim:
  //     swapping the two loops in `renderFrame` left every check in this tier green.
  //
  //     So: two shaders drawing in one frame, with `getComputedStyle`,
  //     `getBoundingClientRect` and the `opacity` setter instrumented to record a call order,
  //     captured per frame. The assertion is that no frame contains a read after a write — plus,
  //     because a frame with no writes satisfies that for free, that some captured frame did
  //     write. Several frames are captured rather than one: the writes land on the first frame
  //     that draws, and with the loops swapped the first frame has no geometry yet and draws
  //     nothing, so the violation only appears on the second.
  // -------------------------------------------------------------------------
  const readOrder = await page.evaluate(async () => {
    const { prepareShaders, getSharedShaderRenderer, createEffectParams } = window.kUIAdvanced
    const elA = document.getElementById('order-a')
    const elB = document.getElementById('order-b')
    const instances = [
      prepareShaders(elA, createEffectParams({ mode: 'displace' })),
      prepareShaders(elB, createEffectParams({ mode: 'liquid' })),
    ]

    const frames = []
    let current = null
    const realComputedStyle = window.getComputedStyle
    const realRect = Element.prototype.getBoundingClientRect
    const realSetProperty = CSSStyleDeclaration.prototype.setProperty
    window.getComputedStyle = function (...args) {
      if (current) current.push('read')
      return realComputedStyle.apply(window, args)
    }
    Element.prototype.getBoundingClientRect = function () {
      if (current) current.push('read')
      return realRect.call(this)
    }
    CSSStyleDeclaration.prototype.setProperty = function (prop, value, priority) {
      if (current && prop === 'opacity') current.push('write')
      return realSetProperty.call(this, prop, value, priority)
    }

    for (const inst of instances) inst.activate()
    const renderer = getSharedShaderRenderer()
    const realRenderFrame = renderer.renderFrame
    renderer.renderFrame = function (timeSeconds) {
      current = []
      try {
        return realRenderFrame.call(this, timeSeconds)
      } finally {
        frames.push(current)
        current = null
      }
    }

    for (let i = 0; i < 5; i += 1) {
      await new Promise((resolve) => requestAnimationFrame(resolve))
    }

    renderer.renderFrame = realRenderFrame
    window.getComputedStyle = realComputedStyle
    Element.prototype.getBoundingClientRect = realRect
    CSSStyleDeclaration.prototype.setProperty = realSetProperty
    for (const inst of instances) inst.destroy()

    const readAfterWrite = frames
      .map((order, i) => [i, order.indexOf('write')])
      .filter(([, firstWrite]) => firstWrite >= 0)
      .filter(([i, firstWrite]) => frames[i].indexOf('read', firstWrite) > firstWrite)
      .map(([i]) => i)

    return {
      capturedFrames: frames.length,
      framesWithWrites: frames.filter((order) => order.includes('write')).length,
      writeCount: frames.reduce((sum, order) => sum + order.filter((e) => e === 'write').length, 0),
      readAfterWrite,
      worstFrame: frames.find((order) => order.includes('write'))?.join(',') ?? '',
    }
  })

  check(
    'read-order: two shaders drew, and at least one captured frame actually wrote opacity',
    readOrder.capturedFrames > 1 && readOrder.framesWithWrites > 0 && readOrder.writeCount >= 2,
    `frames=${readOrder.capturedFrames}, withWrites=${readOrder.framesWithWrites}, writes=${readOrder.writeCount}`,
  )
  check(
    'read-order: no frame reads layout or computed style after an opacity write',
    readOrder.readAfterWrite.length === 0,
    `offendingFrames=${JSON.stringify(readOrder.readAfterWrite)}, firstWritingFrame=[${readOrder.worstFrame}]`,
  )

  // -------------------------------------------------------------------------
  // 5c. A texture the device cannot take must not hide the element.
  //
  //     `drew` used to mean "no JS exception": `drawElementQuad` returns true as soon as
  //     `gl.drawArrays` was called, and `createGLTexture` handed back the texture even when
  //     `texImage2D` had raised a GL error rather than thrown. An image over the device's
  //     `MAX_TEXTURE_SIZE` — 4096 on plenty of mid-range Android GPUs, and a 2× srcset asset
  //     reaches 3840-5120 routinely — leaves an incomplete texture, which WebGL2 samples as opaque
  //     black, so the element was hidden behind a black rectangle with nothing logged.
  //
  //     The limit is stubbed rather than the image grown: this needs a real GL context, real
  //     `texImage2D` and the real draw path, and headless Chromium's actual limit is far above
  //     anything an `<img>` here could reach. What is under test is the guard, not Chromium's cap.
  // -------------------------------------------------------------------------
  const oversized = await page.evaluate(async () => {
    const { prepareShaders, getSharedShaderRenderer, createEffectParams } = window.kUIAdvanced
    const twoFrames = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    const el = document.getElementById('order-a')

    const inst = prepareShaders(el, createEffectParams({ mode: 'displace' }))
    inst.activate()
    const renderer = getSharedShaderRenderer()
    const realGetParameter = renderer.gl.getParameter.bind(renderer.gl)
    renderer.gl.getParameter = (pname) => (pname === renderer.gl.MAX_TEXTURE_SIZE ? 16 : realGetParameter(pname))
    await twoFrames()
    const opacityUnderLimit = el.style.opacity
    const registeredWhileRefused = renderer.drawCalls.size

    // And back: the same element, the same instance, once the device will take the texture.
    renderer.gl.getParameter = realGetParameter
    await twoFrames()
    const opacityOnceAccepted = el.style.opacity

    inst.destroy()
    return { opacityUnderLimit, registeredWhileRefused, opacityOnceAccepted }
  })

  check(
    'texture-limit: a source over MAX_TEXTURE_SIZE leaves the element visible instead of hiding it behind black',
    oversized.opacityUnderLimit === '' && oversized.registeredWhileRefused > 0,
    `opacity=${JSON.stringify(oversized.opacityUnderLimit)}, registered=${oversized.registeredWhileRefused}`,
  )
  check(
    'texture-limit: the same element is hidden again once the texture fits — the refusal is the limit, not a dead instance',
    oversized.opacityOnceAccepted === '0',
    `opacity=${JSON.stringify(oversized.opacityOnceAccepted)}`,
  )

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
    // `gradient` is the one that most needs this check: it is the only program carrying the noise
    // core's integer hashing and its fbm loop, by some way the most complex GLSL in the tier, and
    // a link failure here is *silent* — `createProgram` answers null and `initPrograms` simply
    // omits the mode, so nothing draws and nothing reports an error anywhere.
    const modes = ['displace', 'fluid', 'liquid', 'particles', 'morph', 'gradient', 'logo']
    const missing = modes.filter((mode) => !renderer.programs[mode] || !renderer.programs[mode].program)
    // `gradient` and `logo` are deliberately one linked program under two names. Two separate
    // entries here would mean a second copy of the noise core got compiled.
    const shareOneProgram = renderer.programs.gradient?.program === renderer.programs.logo?.program
    const glError = gl ? gl.getError() : -1
    renderer.release()
    return { acquired, missing, glError, shareOneProgram }
  })

  check('shader-compile: renderer acquires a real WebGL2 context', shaderCompile.acquired === true, `acquired=${shaderCompile.acquired}`)
  check('shader-compile: all seven production shader modes link in real WebGL2', shaderCompile.missing.length === 0, `missing=${shaderCompile.missing.join(',') || 'none'}`)
  check(
    'shader-compile: gradient and logo are one linked program under two names, not two copies of the noise core',
    shaderCompile.shareOneProgram === true,
    `shareOneProgram=${shaderCompile.shareOneProgram}`,
  )
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
  // 9. Scroll -> shader progress bridge, same element and through an ancestor, plus the shader
  //    under that same ancestor that never asked for it. A separate page and fixture: this one
  //    needs the window to actually scroll, unlike the fixed-layout page above.
  //
  //    The bridge is opt-in — `scrub: scroll` — and the negative half is the reason the parameter
  //    exists. `--kui-progress` inherits, so before the opt-in every shader inside a
  //    scrollytelling section was scrubbed by a driver it had never heard of; at the top of a
  //    scroll range that driver publishes `0`, and `u_progress: 0` is how every program in
  //    `glsl.ts` spells "no effect", so the shader drew an untouched copy of its source and
  //    looked broken. `-1` is that same GLSL's sentinel for "not scrubbed, run at full effect",
  //    which is what a shader that did not opt in must upload no matter where it sits.
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
    const unoptedEl = document.getElementById('progress-unopted')
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
    // (y 2700..2900) and #progress-unopted directly below it (y 2900..3100), so at scrollY 2750
    // the 600px viewport (2750..3350) holds both of them at once and neither reading is taken
    // from an element the shader had scissored away.
    const scrollYChildVisible = await scrollTo(2750)
    const childProgressVisible = computedProgress(childEl)
    const childUniformVisible = readProgressUniform('liquid')
    // The same inherited value is sitting on this element too — `computedProgress(unoptedEl)`
    // proves that rather than assuming it — and its shader must be uploading -1 regardless.
    const unoptedProgressVisible = computedProgress(unoptedEl)
    const unoptedUniformVisible = readProgressUniform('particles')
    const scrollYChildLate = await scrollTo(3500)
    const childProgressLate = computedProgress(childEl)

    // The same read again, now that both elements have been scrolled through their whole span and
    // drawn many frames. `childInlineAtStart` on its own only proved the *compile* step wrote
    // nothing; the claim is that the shader never writes this property on the element it reads it
    // from, and only a reading taken after the reads have happened can say that.
    const childInlineAtEnd = childEl.style.getPropertyValue('--kui-progress')
    // The positive control, and it is a different element for a reason: `#progress-same` carries
    // `scroll-progress` itself, whose whole job is to write this property inline. It must read as
    // non-empty, or `childInlineAtEnd === ''` is only evidence that this measurement cannot see an
    // inline custom property on this page at all.
    const sameInlineAtEnd = sameEl.style.getPropertyValue('--kui-progress')

    return {
      scrollYStart, scrollYSameEarly, scrollYSameLate, scrollYChildVisible, scrollYChildLate,
      sameProgressStart, sameProgressEarly, sameProgressLate, sameUniformLate,
      childInlineAtStart, childInlineAtEnd, sameInlineAtEnd,
      childProgressVisible, childUniformVisible, childProgressLate,
      unoptedProgressVisible, unoptedUniformVisible,
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

  check(
    'progress-bridge: an ancestor-driven shader never writes --kui-progress on its own inline style, before or after a full scroll',
    bridge.childInlineAtStart === '' && bridge.childInlineAtEnd === '' && bridge.sameInlineAtEnd !== '',
    `atStart=${JSON.stringify(bridge.childInlineAtStart)}, childAtEnd=${JSON.stringify(bridge.childInlineAtEnd)}, control=${JSON.stringify(bridge.sameInlineAtEnd)}`,
  )
  check(
    'progress-bridge: an element with no scroll-progress of its own inherits a real, non-trivial value from its ancestor',
    bridge.childProgressVisible > 0 && bridge.childProgressVisible < 1,
    `progress=${bridge.childProgressVisible}`,
  )
  check(
    "progress-bridge: an opted-in shader's own uniform matches the inherited CSS value — proof the bridge (not just the CSS cascade) reaches the draw",
    bridge.childUniformVisible !== null && Math.abs(bridge.childUniformVisible - bridge.childProgressVisible) < 0.01,
    `uniform=${bridge.childUniformVisible}, cssProgress=${bridge.childProgressVisible}`,
  )
  check(
    'progress-bridge: the inherited progress keeps advancing as the page scrolls further',
    bridge.childProgressLate > bridge.childProgressVisible,
    `visible=${bridge.childProgressVisible}, late=${bridge.childProgressLate}`,
  )

  // The opt-in's negative half, and the whole reason `scrub:` exists. Its own control comes
  // first: if the inherited value were not there at all, `-1` would prove nothing.
  check(
    'progress-bridge: CONTROL — the shader that did not opt in has the same inherited value sitting on it',
    bridge.unoptedProgressVisible > 0 && bridge.unoptedProgressVisible < 1,
    `progress=${bridge.unoptedProgressVisible}`,
  )
  check(
    'progress-bridge: a shader with no scrub: uploads the -1 sentinel, ignoring the ancestor entirely',
    bridge.unoptedUniformVisible === -1,
    `uniform=${bridge.unoptedUniformVisible}, inherited cssProgress=${bridge.unoptedProgressVisible} `
      + '(the inherited value here means the implicit pickup is back; 0 means this element never drew)',
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

  // Both readings, every check. Nothing in this suite had ever run below 800px wide.
  await runGenerativeField({ browser, check, label: 'desktop', viewport: { width: 800, height: 600 }, deviceScaleFactor: 1 })
  await runGenerativeField({ browser, check, label: '390px', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })

  await runFilterNoise({ browser, check, label: 'desktop', viewport: { width: 800, height: 600 }, deviceScaleFactor: 1 })
  await runFilterNoise({ browser, check, label: '390px', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })

  await runGenerativeHover({ browser, check, label: 'desktop', viewport: { width: 800, height: 600 }, deviceScaleFactor: 1 })
  await runGenerativeHover({ browser, check, label: '390px', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })

  await runShaderDefects({ browser, check, label: 'desktop', viewport: { width: 800, height: 600 }, deviceScaleFactor: 1 })
  await runShaderDefects({ browser, check, label: '390px', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })

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
          // The inline declaration, not the resolved box. Headless Chromium has no retracting URL
          // bar, so `100vh` and `innerHeight` are the same number here and the measured box cannot
          // tell the fixed version from the broken one — which made the first version of the check
          // below unfalsifiable. The unit that was written is what is assertable: px, computed from
          // the same `innerWidth`/`innerHeight` the backing store uses, rather than viewport units
          // resolved against a different viewport than the one the draw was scissored into.
          canvasCssDecl: [canvas.style.width, canvas.style.height],
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
    'fidelity: the canvas CSS box is declared in px from the same viewport as its backing store, not in vw/vh',
    fidelity.canvasCssBox[0] === fidelity.viewport[0] && fidelity.canvasCssBox[1] === fidelity.viewport[1]
      && fidelity.canvasCssDecl[0] === `${fidelity.viewport[0]}px` && fidelity.canvasCssDecl[1] === `${fidelity.viewport[1]}px`,
    `cssBox=${fidelity.canvasCssBox}, decl=${JSON.stringify(fidelity.canvasCssDecl)}, viewport=${fidelity.viewport}`,
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
    'fidelity: the shared canvas defaults to z-index 1, so a z-index:10 fixed bar now paints OVER the replica',
    fidelity.canvasZIndex === '1' && fidelity.canvasPosition === 'fixed' && fidelity.barZIndex === '10',
    `canvas=${fidelity.canvasPosition}/${fidelity.canvasZIndex}, bar=${fidelity.barZIndex} `
      + '(9999 = the old default, which painted over the page\'s own modals and headers)',
  )
  check(
    'fidelity: KNOWN LIMIT — the replica is still DRAWN under that bar, it is only composited below it',
    opaque(fidelity.underBar) && isYellow(fidelity.underBar),
    `drawnUnderBar=${show(fidelity.underBar)} — the canvas has no idea anything covers it, `
      + 'which is why stacking is the one thing the replica cannot reproduce',
  )

  await context.close()
}

/**
 * 13. The generative field, and the two ways a shader renders a picture of nothing happening.
 *
 * Everything below is a `readPixels` off the shared canvas. Nothing here can be proved by a
 * screenshot that "looks right": the two failures this block exists for — a palette that never
 * uploaded, and a displacement multiplied by zero — both produce an image that looks entirely
 * plausible. Only a comparison between two readbacks that *must* differ can tell them apart.
 *
 * Run at 800x600 and at 390x844, because the tier had no reading below 800px at all and the
 * device-pixel maths genuinely differs: `getScissorEnv` clamps DPR to 2 and `syncCanvasDimensions`
 * sizes the backing store off `innerHeight`, neither of which is an identity operation on a phone.
 *
 * Two traps this block is written around. A readback taken before any frame has run is transparent
 * black and is indistinguishable from a dead effect, so every read happens inside a rAF after two
 * have already passed. And a comparison between two *frozen* images passes trivially if the whole
 * canvas is frozen, so `#grad` runs at `speed: 8` purely as the control that proves this harness
 * can see motion at all.
 */
async function runGenerativeField({ browser, check, label, viewport, deviceScaleFactor }) {
  const url = `file://${fileURLToPath(new URL('./fixtures/advanced-generative.html', import.meta.url))}`
  const context = await browser.newContext({ viewport, deviceScaleFactor })
  const page = await context.newPage()
  await page.goto(url)
  await page.waitForFunction(() => window.__kuiReady === true && window.kUIAdvanced !== undefined)

  // Serialised into the page once and shared by all three blocks below.
  const PROBES = `
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const settle = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    const nextFrame = () => new Promise((r) => requestAnimationFrame(r))
    // A 5x5 grid over the middle 70% of an element's box. Inset deliberately: the outermost
    // device pixel of a scissored draw straddles the box edge, so an edge probe reads a blend of
    // the field and the cleared canvas and drifts between DPRs for reasons that are not the shader.
    //
    // WARNING for whoever adds a mode here next: these fractions are exactly 6/40 and 7/40, so
    // every probe lands on a corner of any lattice the shader lays out at a multiple of 40 cells
    // — which is where \`particles\`' dot mask is zero. A lattice-based mode read through this grid
    // comes back with a clean 0.00 distance for every parameter and looks like a dead effect. The
    // answer is a full-block \`readPixels\` over the element instead; \`runFilterNoise\` in this file
    // is the worked example, including how to move the comparison into the page so the bridge is
    // not handed 58k numbers a reading. None of the modes below uses a lattice, so the grid is
    // correct as it stands — do not swap it speculatively, the \`pt\` helper's epicentre check
    // depends on point probes and every threshold here would need re-measuring against a mean.
    const grid = (gl, canvas, el) => {
      const r = el.getBoundingClientRect()
      const out = []
      for (let iy = 0; iy < 5; iy++) {
        for (let ix = 0; ix < 5; ix++) {
          const cssX = r.left + r.width * (0.15 + 0.175 * ix)
          const cssY = r.top + r.height * (0.15 + 0.175 * iy)
          const px = new Uint8Array(4)
          gl.readPixels(Math.round(cssX * dpr), Math.round(canvas.height - cssY * dpr), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px)
          out.push(px[0], px[1], px[2], px[3])
        }
      }
      return out
    }
    // One probe at a named fraction of an element's box, for a shape whose interesting points are
    // not on a grid.
    const pt = (gl, canvas, el, fx, fy) => {
      const r = el.getBoundingClientRect()
      const px = new Uint8Array(4)
      gl.readPixels(
        Math.round((r.left + r.width * fx) * dpr),
        Math.round(canvas.height - (r.top + r.height * fy) * dpr),
        1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px,
      )
      return [px[0], px[1], px[2], px[3]]
    }
  `

  // Hold one reference for the whole function. Without it the last `destroy()` in each block drops
  // `refCount` to zero, which tears the WebGL2 context and the canvas down, and the next block
  // builds both again — and headless Chromium's software GL crashes its renderer process on that
  // churn ("Execution context was destroyed", with every check up to that point green). The
  // create/destroy cycle itself is covered by the double-destroy and renderer-revival blocks; this
  // one is about pixels and has no business exercising it.
  // Set *before* anything builds a canvas: `readShaderZIndex` runs once, at canvas creation, so a
  // value written afterwards moves nothing. That is fine for the real case — a page declares this
  // in a stylesheet, which is in effect long before the first shader activates — but it is a trap
  // for a test, and it is why the override is armed up here rather than down in block C.
  await page.evaluate(() => document.documentElement.style.setProperty('--kui-shader-z', '42'))
  await page.evaluate(() => window.kUIAdvanced.getSharedShaderRenderer().acquire())

  // ---- Block A: the field itself -------------------------------------------------------------
  const field = await page.evaluate(`(async () => {
    ${PROBES}
    const { prepareShaders, getSharedShaderRenderer, createEffectParams } = window.kUIAdvanced
    const P = (o) => createEffectParams({ mode: 'gradient', ...o })
    const spec = {
      // The motion control. Also the "draws with no texture at all" case.
      grad:      { speed: 8, scale: 4, strength: 3 },
      // Same seed, different box; then a different seed. \`speed: 0\` pins u_time at 0, so any
      // difference between these is the seed and nothing else.
      'seed-a':  { seed: 7,  speed: 0, scale: 3, strength: 2 },
      'seed-c':  { seed: 7,  speed: 0, scale: 3, strength: 2 },
      'seed-b':  { seed: 42, speed: 0, scale: 3, strength: 2 },
      // One octave against six. Structure must change; average brightness must not — that is the
      // fbm \`/norm\` divisor, the "one knob secretly changes two things" bug.
      'det-1':   { seed: 3, detail: 1, speed: 0, scale: 3, strength: 2 },
      'det-6':   { seed: 3, detail: 6, speed: 0, scale: 3, strength: 2 },
      frozen:    { seed: 5, speed: 0, scale: 4, strength: 3 },
      // Two hues as far apart as the ramp allows, driven hard enough that the field clamps to both
      // ends of it. If \`u_colors\` never uploaded, every probe here is the default pair instead.
      palette:   { seed: 9, speed: 0, scale: 3, strength: 4, color1: '#ff0000', color2: '#0000ff' },
    }
    const ids = Object.keys(spec)
    const inst = {}
    for (const id of ids) inst[id] = prepareShaders(document.getElementById(id), P(spec[id]))
    for (const id of ids) inst[id].activate()

    const renderer = getSharedShaderRenderer()
    const gl = renderer.gl
    if (!gl) return { error: 'no gl' }
    const canvas = renderer.canvas
    await settle()

    const first = {}
    await new Promise((resolve) => requestAnimationFrame(() => {
      for (const id of ids) first[id] = grid(gl, canvas, document.getElementById(id))
      resolve()
    }))
    for (let i = 0; i < 10; i++) await nextFrame()
    const second = {}
    await new Promise((resolve) => requestAnimationFrame(() => {
      for (const id of ['grad', 'frozen']) second[id] = grid(gl, canvas, document.getElementById(id))
      resolve()
    }))

    const hostOpacity = document.getElementById('grad').style.opacity
    for (const id of ids) inst[id].destroy()
    return { first, second, hostOpacity, canvasZIndex: getComputedStyle(canvas).zIndex, dpr }
  })()`)

  const bytes = (a) => a.join(',')
  const alphaOf = (a) => { let n = 0; for (let i = 3; i < a.length; i += 4) n += a[i]; return n / (a.length / 4) }
  const lumaOf = (a) => {
    let n = 0
    for (let i = 0; i < a.length; i += 4) n += 0.299 * a[i] + 0.587 * a[i + 1] + 0.114 * a[i + 2]
    return n / (a.length / 4)
  }
  // "Different" means different beyond readback noise, not different in one channel of one probe.
  const distance = (a, b) => {
    let n = 0
    for (let i = 0; i < a.length; i++) n += Math.abs(a[i] - b[i])
    return n / a.length
  }
  const redderThanBlue = (a) => { for (let i = 0; i < a.length; i += 4) if (a[i] > 180 && a[i + 2] < 70) return true; return false }
  const bluerThanRed = (a) => { for (let i = 0; i < a.length; i += 4) if (a[i + 2] > 180 && a[i] < 70) return true; return false }
  const show = (p) => `rgba(${p})`

  const at = (name) => `${label}: ${name}`
  if (field.error) {
    check(at('generative: the fixture reached a real WebGL2 context'), false, field.error)
    await context.close()
    return
  }

  check(
    at('generative: a gradient on a plain div with no image in it paints opaque pixels'),
    alphaOf(field.first.grad) > 240,
    `mean alpha=${alphaOf(field.first.grad).toFixed(1)} over 25 probes (0 = nothing drew)`,
  )
  check(
    at('generative: the host div is NOT hidden — a generator adds to the page, it does not replace an element'),
    field.hostOpacity === '',
    `opacity=${JSON.stringify(field.hostOpacity)}`,
  )
  // The control. If this fails, every "identical" result below is meaningless.
  check(
    at('generative: HARNESS CONTROL — an animating field does change between two reads 10 frames apart'),
    distance(field.first.grad, field.second.grad) > 2,
    `distance=${distance(field.first.grad, field.second.grad).toFixed(2)}`,
  )
  check(
    at('generative: speed:0 is genuinely frozen — the same 25 probes 10 frames later are byte-identical'),
    bytes(field.first.frozen) === bytes(field.second.frozen),
    `distance=${distance(field.first.frozen, field.second.frozen).toFixed(2)}`,
  )
  // Not byte-identical, and that is the harness rather than the shader. The field is authored in
  // the element's own UV space, but two boxes at different page positions scissor onto different
  // device-pixel boundaries, so the quad rasterises at a different subpixel offset and a probe
  // lands a fraction of a texel away. Measured at 0.17/255 across 25 probes — under one LSB. The
  // assertion that matters is that this is two orders of magnitude below the distance a *different*
  // seed produces, which is checked immediately below.
  check(
    at('generative: the same seed in two different boxes gives the same field'),
    distance(field.first['seed-a'], field.first['seed-c']) < 2,
    `distance=${distance(field.first['seed-a'], field.first['seed-c']).toFixed(2)} `
      + `vs ${distance(field.first['seed-a'], field.first['seed-b']).toFixed(2)} for a different seed`,
  )
  check(
    at('generative: a different seed gives a different field'),
    distance(field.first['seed-a'], field.first['seed-b']) > 4,
    `distance=${distance(field.first['seed-a'], field.first['seed-b']).toFixed(2)}`,
  )
  check(
    at('generative: detail 1 vs 6 changes the structure'),
    distance(field.first['det-1'], field.first['det-6']) > 4,
    `distance=${distance(field.first['det-1'], field.first['det-6']).toFixed(2)}`,
  )
  check(
    at('generative: detail 1 vs 6 does NOT change mean brightness — the fbm /norm divisor holds'),
    Math.abs(lumaOf(field.first['det-1']) - lumaOf(field.first['det-6'])) < 20,
    `luma ${lumaOf(field.first['det-1']).toFixed(1)} vs ${lumaOf(field.first['det-6']).toFixed(1)} (a drift here means one knob moves two things)`,
  )
  check(
    at('generative: an authored palette reaches the pixels — both u_colors entries appear'),
    redderThanBlue(field.first.palette) && bluerThanRed(field.first.palette),
    `red found=${redderThanBlue(field.first.palette)}, blue found=${bluerThanRed(field.first.palette)} `
      + '(both false with the default pair means u_colors never uploaded)',
  )

  // ---- Block B: the two ways displace used to render a faithful copy --------------------------
  // Both of these produced a sharp, unshaded image that looks like a working shader over a working
  // texture, which is why neither was caught by looking at the page. Both are fixed; what is left
  // here is the guard, which in Cause A's case means the assertion has inverted.
  const displace = await page.evaluate(`(async () => {
    ${PROBES}
    const { prepareShaders, getSharedShaderRenderer, createEffectParams } = window.kUIAdvanced
    const renderer = getSharedShaderRenderer()
    // The pointer is never moved anywhere in this block: this is the state every page is in on
    // load, and on a phone it is the state it stays in.
    const read = async (id, strength, extra = {}) => {
      const el = document.getElementById(id)
      const inst = prepareShaders(el, createEffectParams({ mode: 'displace', speed: 0, frequency: 10, strength, ...extra }))
      inst.activate()
      const gl = renderer.gl
      await settle()
      const out = await new Promise((resolve) => requestAnimationFrame(() => resolve({
        all: grid(gl, renderer.canvas, el),
        // \`ripple\` is sin(d * 10), so it is *zero* at the epicentre itself and peaks a sixth of
        // the box away from it. These two probes sit at that peak distance from the box centre and
        // from the box corner respectively, which is what makes them an epicentre test rather than
        // a brightness test.
        nearCentre: pt(gl, renderer.canvas, el, 0.66, 0.5),
        nearCorner: pt(gl, renderer.canvas, el, 0.11, 0.11),
      })))
      inst.destroy()
      await settle()
      return out
    }
    const flat = await read('disp', 0)
    const weak = await read('disp', 0.3)
    const hard = await read('disp', 8)
    // \`#scrub\` is the same image at the same size, with --kui-progress: 0 set in the fixture's
    // stylesheet — exactly what scroll-progress writes at the top of its range. No \`scrub:\` and
    // no \`progress:\` is authored on it, so the property must not reach the shader at all. Both
    // readings are taken on that one element, so nothing but the strength differs between them.
    const scrubFlat = await read('scrub', 0)
    const scrubHard = await read('scrub', 8)
    // And the same element again with the opt-in authored, which must bring the cancellation
    // straight back: this is the half that proves the property is still wired up and that the
    // pair above is measuring the gate rather than a broken custom property.
    const optedFlat = await read('scrub', 0, { scrub: 'scroll' })
    const optedHard = await read('scrub', 8, { scrub: 'scroll' })
    return { flat, weak, hard, scrubFlat, scrubHard, optedFlat, optedHard }
  })()`)

  const moved = (a, b) => distance(a.all, b.all)
  const movedAt = (a, b, probe) => distance(a[probe], b[probe])

  // The control everything else in this block leans on.
  check(
    at('displace: HARNESS CONTROL — the probes do see strength:8 move the image'),
    moved(displace.hard, displace.flat) > 4,
    `distance=${moved(displace.hard, displace.flat).toFixed(2)}`,
  )
  // Cause B. `renderer.mouse` starts at the viewport origin, which clamps into the element's
  // top-left corner — so before this fix the ripple lived in the corner and `exp(-4d)` had killed
  // it by the middle of the box. This comparison inverts if that regresses.
  check(
    at('displace: with no pointer yet the ripple is centred on the element, not stuck in its corner'),
    movedAt(displace.hard, displace.flat, 'nearCentre') > movedAt(displace.hard, displace.flat, 'nearCorner'),
    `centre moved ${movedAt(displace.hard, displace.flat, 'nearCentre').toFixed(1)}, `
      + `corner moved ${movedAt(displace.hard, displace.flat, 'nearCorner').toFixed(1)} `
      + '(corner larger = the epicentre is back at the viewport origin)',
  )
  // Cause A, fixed. This check used to assert the bug — that an unauthored `--kui-progress: 0`
  // cancelled the displacement — because that is what the code did. The pickup is opt-in now, so
  // the same element with the same property must displace exactly as an element with no property
  // at all. Asserted as an inequality between two readings of the *same* element, so no
  // cross-element sampling difference can fake it.
  check(
    at('displace: an unauthored --kui-progress:0 no longer cancels the displacement'),
    moved(displace.scrubHard, displace.scrubFlat) > 4,
    `with --kui-progress:0 and no scrub: strength 8 moves ${moved(displace.scrubHard, displace.scrubFlat).toFixed(2)}, `
      + `the same element's control without the property ${moved(displace.hard, displace.flat).toFixed(2)} — `
      + 'a small number here means a scroll-linked primitive up the tree is still scrubbing it unasked',
  )
  // The other half of the same claim: `scrub: scroll` still reaches the uniform, so the check
  // above is measuring the gate and not a `--kui-progress` that stopped being read at all.
  check(
    at('displace: authoring scrub:scroll puts the same --kui-progress:0 back in charge'),
    moved(displace.optedHard, displace.optedFlat) < 2,
    `opted in, strength 8 moves ${moved(displace.optedHard, displace.optedFlat).toFixed(2)} `
      + `(must be ~0 — the property is 0), not opted in ${moved(displace.scrubHard, displace.scrubFlat).toFixed(2)}`,
  )
  // Recorded rather than diagnosed: `strength: 0.3` is genuinely subtle. `disp * 0.05` caps the
  // throw at 1.5% of the box, and `exp(-4d)` takes most of that back — under a device pixel on a
  // 100px element even with the epicentre in the right place.
  check(
    at('displace: strength:0.3 is a different order of magnitude from strength:8, not merely smaller'),
    moved(displace.weak, displace.flat) * 3 < moved(displace.hard, displace.flat),
    `0.3 moves ${moved(displace.weak, displace.flat).toFixed(2)}, 8 moves ${moved(displace.hard, displace.flat).toFixed(2)}`,
  )

  // ---- Block B2: the logo stencil ------------------------------------------------------------
  // The assertion that carries this mode: the field is opaque inside the mark and *nothing at all*
  // outside it. The second half is simultaneously the stencil proof and the transparency proof —
  // a canvas that cleared to opaque black, or a mask that painted the bounding box, fails it while
  // still looking like a logo in a screenshot.
  const logo = await page.evaluate(`(async () => {
    ${PROBES}
    const { prepareShaders, getSharedShaderRenderer, createEffectParams } = window.kUIAdvanced
    const renderer = getSharedShaderRenderer()
    // The mark is a square annulus: the ring spans 10..35% of the box, the hole 35..65%, and the
    // corner is outside the outer edge entirely.
    const read = async (id, mask) => {
      const el = document.getElementById(id)
      const inst = prepareShaders(el, createEffectParams({ mode: 'logo', mask, speed: 0, seed: 4, scale: 3, strength: 2 }))
      inst.activate()
      const gl = renderer.gl
      await settle()
      const out = await new Promise((resolve) => requestAnimationFrame(() => resolve({
        ring: pt(gl, renderer.canvas, el, 0.22, 0.5),
        hole: pt(gl, renderer.canvas, el, 0.5, 0.5),
        corner: pt(gl, renderer.canvas, el, 0.04, 0.04),
        hostOpacity: el.style.opacity,
      })))
      inst.destroy()
      await settle()
      return out
    }
    const alpha = await read('logo-alpha', 'alpha')
    const luma = await read('logo-luma', 'luma-invert')
    // The trap the luma keywords exist for, asserted rather than described: the same alpha-free
    // image read as an alpha stencil is opaque everywhere, so the field fills the whole rectangle.
    const wrong = await read('logo-luma', 'alpha')
    return { alpha, luma, wrong }
  })()`)

  const solid = (p) => p[3] > 200
  const empty = (p) => p[3] < 20

  check(
    at('logo: the generated field fills the mark'),
    solid(logo.alpha.ring),
    `ring=${show(logo.alpha.ring)}`,
  )
  check(
    at('logo: and nothing is painted outside it — the hole and the corner both leave the page showing'),
    empty(logo.alpha.hole) && empty(logo.alpha.corner),
    `hole=${show(logo.alpha.hole)}, corner=${show(logo.alpha.corner)} (opaque = the stencil painted the bounding box)`,
  )
  check(
    at('logo: the host image is hidden — a logo replaces its <img>, it does not sit over one'),
    logo.alpha.hostOpacity === '0',
    `opacity=${JSON.stringify(logo.alpha.hostOpacity)}`,
  )
  check(
    at('logo: mask:luma-invert reads black ink on an opaque white ground'),
    solid(logo.luma.ring) && empty(logo.luma.hole) && empty(logo.luma.corner),
    `ring=${show(logo.luma.ring)}, hole=${show(logo.luma.hole)}, corner=${show(logo.luma.corner)}`,
  )
  check(
    at('logo: mask:alpha on the same alpha-free image fills the rectangle — the trap luma exists for'),
    solid(logo.wrong.hole) && solid(logo.wrong.corner),
    `hole=${show(logo.wrong.hole)}, corner=${show(logo.wrong.corner)}`,
  )

  // ---- Block C: the z-index escape hatch ----------------------------------------------------
  // Last, because it needs a renderer that has not been built yet: `--kui-shader-z` is read once,
  // when the canvas is created. Everything above released its instances, so the shared renderer
  // has torn itself down and un-mapped.
  const stacking = await page.evaluate(() => ({
    // Read off a real computed style rather than off the exported constant, so a canvas built from
    // a stale `cssText` is still caught.
    z: getComputedStyle(window.kUIAdvanced.getSharedShaderRenderer().canvas).zIndex,
  }))

  check(
    at('stacking: --kui-shader-z moves the shared canvas off its default'),
    stacking.z === '42',
    `z-index=${stacking.z} (1 means the property was never read; the default itself is asserted `
      + 'in the overlay-fidelity block, where nothing authors one)',
  )

  await page.evaluate(() => window.kUIAdvanced.getSharedShaderRenderer().release())
  await context.close()
}

/**
 * 14. `noise:` — the four filter modes' adoption of the noise core.
 *
 * `fluid`, `liquid`, `particles` and `morph` each shipped with one trigonometric term standing in
 * for noise. `noise:` crossfades that term into the same `kuiFbm` field `mode: gradient` generates
 * from, and it is `0` by default because those four modes are already in use.
 *
 * **What this block has to prove, and what would fake it.** "The program still draws" proves
 * nothing at all here — every one of these modes drew perfectly well before the change, and a
 * `u_noise` that never reached the shader, a `kuiFilterField` multiplied by zero, and a `seed` that
 * resolves to a null location all leave an image that looks entirely correct. Only a comparison
 * between two readbacks off one element can separate them, which is why every reading below is the
 * *same* element prepared twice with one parameter changed: no cross-element sampling difference
 * exists to muddy a distance, the way it does between two boxes at different page positions.
 *
 * `speed: 0` throughout, which pins `u_time` at 0 — so a difference between two readings is the
 * parameter and not the frame they landed on. Two traps that costs: a readback before any frame has
 * run is transparent black and looks like a dead effect (so every read sits inside a rAF after two
 * have passed), and a frozen canvas makes any "identical" assertion pass for free (so each mode
 * reads the *same* parameters twice as its floor before any "differs" claim is believed).
 *
 * Per-mode strengths are chosen to isolate the term that changed:
 * - `fluid` at `strength: 0` kills the pointer force entirely, leaving the ambient drift — which is
 *   the only thing this change touches — as the whole of the offset.
 * - `morph` at `strength: 0` puts `progress` at 0, so the crossfade is pure source image displaced
 *   by the full noise term rather than half of two.
 * - `liquid` at 4 and `particles` at 1 simply drive their terms hard enough to read.
 */
async function runFilterNoise({ browser, check, label, viewport, deviceScaleFactor }) {
  const url = `file://${fileURLToPath(new URL('./fixtures/advanced-filter-noise.html', import.meta.url))}`
  const context = await browser.newContext({ viewport, deviceScaleFactor })
  const page = await context.newPage()
  await page.goto(url)
  await page.waitForFunction(() => window.__kuiReady === true && window.kUIAdvanced !== undefined)

  // Held for the whole function: the last `destroy()` would otherwise drop `refCount` to zero and
  // tear down the context between reads, which crashes headless Chromium's software GL renderer.
  await page.evaluate(() => window.kUIAdvanced.getSharedShaderRenderer().acquire())

  const readings = await page.evaluate(`(async () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const settle = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))

    /*
     * The middle 60% of the element, every device pixel of it, in one readPixels.
     *
     * Deliberately not the inset 5x5 grid of point probes the generative block uses, and the
     * reason is worth keeping: \`particles\` lays its dots on a \`fract(uv * 40.0)\` lattice, and
     * that grid's fractions — 0.15 + 0.175 * i — are 6/40 and 7/40 exactly. Every probe landed on
     * a lattice *corner*, where the dot mask is zero and the sparkle term is multiplied out
     * entirely. The result was a clean 0.00 distance for every parameter of that mode at DPR 2:
     * a perfect, entirely false "the noise core never reached the shader". Reading the whole
     * block cannot be aligned out of existence by any lattice the shader happens to use.
     *
     * Inset by 20% because the outermost device pixel of a scissored draw straddles the box edge
     * and blends with the cleared canvas.
     */
    const block = (gl, canvas, el) => {
      const r = el.getBoundingClientRect()
      const x = Math.round((r.left + r.width * 0.2) * dpr)
      const y = Math.round(canvas.height - (r.top + r.height * 0.8) * dpr)
      const w = Math.max(1, Math.round(r.width * 0.6 * dpr))
      const h = Math.max(1, Math.round(r.height * 0.6 * dpr))
      const px = new Uint8Array(w * h * 4)
      gl.readPixels(x, y, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px)
      return px
    }

    const { prepareShaders, getSharedShaderRenderer, createEffectParams } = window.kUIAdvanced
    const renderer = getSharedShaderRenderer()
    if (!renderer.gl) return { error: 'no gl' }

    const read = async (id, base, extra) => {
      const el = document.getElementById(id)
      const inst = prepareShaders(el, createEffectParams({ speed: 0, ...base, ...extra }))
      inst.activate()
      await settle()
      const out = await new Promise((resolve) => requestAnimationFrame(() => {
        resolve(block(renderer.gl, renderer.canvas, el))
      }))
      inst.destroy()
      await settle()
      return out
    }

    // A full block is ~58k bytes at DPR 2, and ten of them per mode is far too much to hand back
    // across the bridge. The comparison is reduced here; the thresholds stay in Node, where the
    // assertions are.
    const dist = (a, b) => {
      if (a.length !== b.length) return NaN
      let n = 0
      for (let i = 0; i < a.length; i++) n += Math.abs(a[i] - b[i])
      return n / a.length
    }
    const same = (a, b) => dist(a, b) === 0
    // Mean luminance and its spread. Across the noise crossfade these are the numbers that say
    // whether the swap kept the *character* of the mode or merely changed it: a field whose
    // amplitude does not match the term it replaced shows up here as a drift in spread — a larger
    // sample offset smears a striped source and flattens it — long before it shows up as a
    // different picture.
    const stats = (a) => {
      let sum = 0
      const lum = new Float32Array(a.length / 4)
      for (let i = 0, j = 0; i < a.length; i += 4, j++) {
        lum[j] = 0.299 * a[i] + 0.587 * a[i + 1] + 0.114 * a[i + 2]
        sum += lum[j]
      }
      const mean = sum / lum.length
      let v = 0
      for (let j = 0; j < lum.length; j++) v += (lum[j] - mean) ** 2
      return { mean, sd: Math.sqrt(v / lum.length) }
    }

    const MODES = {
      fluid:     { id: 'fluid',     base: { mode: 'fluid',     strength: 0 } },
      liquid:    { id: 'liquid',    base: { mode: 'liquid',    strength: 4 } },
      particles: { id: 'particles', base: { mode: 'particles', strength: 1 } },
      morph:     { id: 'morph',     base: { mode: 'morph',     strength: 0, to: '#morph-to' } },
    }

    const out = {}
    for (const [name, { id, base }] of Object.entries(MODES)) {
      const off = await read(id, base, { noise: 0 })
      // The same parameters again, and then a seed authored with noise still off: the first is the
      // floor every "differs" below is measured against, the second is the claim that the default
      // is genuinely inert rather than merely quiet.
      const offAgain = await read(id, base, { noise: 0 })
      const offSeed = await read(id, base, { noise: 0, seed: 42 })
      const on = await read(id, base, { noise: 1 })
      const onAgain = await read(id, base, { noise: 1 })
      const half = await read(id, base, { noise: 0.5 })
      const onSeed = await read(id, base, { noise: 1, seed: 42 })
      const onScale = await read(id, base, { noise: 1, scale: 4 })
      const onWarp = await read(id, base, { noise: 1, warp: 1.5 })
      // One octave against six, as the generative block does it. Not 3 against 6: the fbm is
      // normalised by its amplitude sum, so octaves 4-6 carry 1/8, 1/16 and 1/32 of the first and
      // the honest difference between them is under a level on two of these modes. A threshold
      // tuned to catch that would be measuring rounding.
      const det1 = await read(id, base, { noise: 1, detail: 1 })
      const det6 = await read(id, base, { noise: 1, detail: 6 })
      out[name] = {
        pixels: off.length / 4,
        statsOff: stats(off),
        statsOn: stats(on),
        exactOffRepeat: same(off, offAgain),
        exactOnRepeat: same(on, onAgain),
        exactOffSeed: same(off, offSeed),
        offRepeat: dist(off, offAgain),
        onRepeat: dist(on, onAgain),
        offSeed: dist(off, offSeed),
        offVsOn: dist(off, on),
        halfVsOff: dist(half, off),
        halfVsOn: dist(half, on),
        seed: dist(on, onSeed),
        scale: dist(on, onScale),
        warp: dist(on, onWarp),
        detail: dist(det1, det6),
      }
    }
    return out
  })()`)

  const at = (name) => `${label}: ${name}`
  if (readings.error) {
    check(at('noise: the fixture reached a real WebGL2 context'), false, readings.error)
    await context.close()
    return
  }

  /*
   * `particles` is the one mode whose term is not a sample offset. Its sparkle is mixed into the
   * colour at at most 0.3 of full scale, under a dot mask covering about half the box, so its
   * entire dynamic range is a fifth of what the three displacement modes have — the strongest
   * signal it can produce (`noise: 0` against `noise: 1`) measured 5.7 where `liquid`'s is 68.
   * Holding it to the others' floor would be a threshold tuned to the mode's amplitude rather
   * than to whether the parameter works.
   *
   * These are margins against a driver difference, not against readback noise: at `speed: 0`
   * every mode's repeat distance measured exactly 0, so there is no noise floor here to clear.
   */
  const FLOOR = { fluid: 2, liquid: 2, morph: 2, particles: 1 }

  for (const mode of ['fluid', 'liquid', 'particles', 'morph']) {
    const r = readings[mode]
    const n = (v) => v.toFixed(3)
    const floor = FLOOR[mode]

    // The floor. Everything below is a claim about a distance, and without this there is no
    // evidence that "identical" means anything or that a nonzero distance means the parameter.
    check(
      at(`noise/${mode}: HARNESS FLOOR — the same parameters read twice are byte-identical`),
      r.exactOffRepeat && r.exactOnRepeat,
      `${r.pixels} px read; off repeat=${n(r.offRepeat)}, on repeat=${n(r.onRepeat)}`,
    )

    // The headline claim: the noise core is genuinely in the program's output, not merely compiled
    // into it. A `u_noise` that never uploaded, a location that resolved to null, or a
    // `kuiFilterField` whose result is discarded all land here as ~0.
    check(
      at(`noise/${mode}: noise:1 renders a different field from the shipped trig term`),
      r.offVsOn > floor,
      `distance=${n(r.offVsOn)} (~0 means u_noise never reached the shader)`,
    )

    // The default is inert, and provably so rather than by inspection: a seed is the one parameter
    // that could only come from the noise path, so if it moves a pixel at `noise: 0` then the
    // field is being sampled on pages that never asked for it.
    check(
      at(`noise/${mode}: noise:0 is untouched — even an authored seed changes nothing`),
      r.exactOffSeed,
      `distance=${n(r.offSeed)} (nonzero means the noise path runs at the default)`,
    )

    // A crossfade rather than a rounded switch: the midpoint is its own picture, not one of the
    // two ends. Asserted as "differs from both" rather than as an ordering, because the sampled
    // colour is not linear in the sample offset and an interpolation claim would be false for the
    // wrong reason.
    check(
      at(`noise/${mode}: noise:0.5 is a real midpoint, not a rounded switch`),
      r.halfVsOff > floor / 2 && r.halfVsOn > floor / 2,
      `to off=${n(r.halfVsOff)}, to on=${n(r.halfVsOn)}`,
    )

    // The four knobs that meant nothing to these modes until now. Each is a separate upload path
    // and a separate use inside `kuiFilterField`, so one of them being dead is a live possibility
    // that a single combined check would hide.
    check(at(`noise/${mode}: seed reaches the filter field`), r.seed > floor, `distance=${n(r.seed)}`)
    check(at(`noise/${mode}: scale reaches the filter field`), r.scale > floor, `distance=${n(r.scale)}`)
    check(at(`noise/${mode}: warp reaches the filter field`), r.warp > floor, `distance=${n(r.warp)}`)
    check(
      at(`noise/${mode}: detail reaches the filter field`),
      r.detail > floor / 2,
      `octave 1 vs 6 distance=${n(r.detail)}`,
    )

    /*
     * The claim the whole design rests on: `noise: 1` is the same effect better textured, not a
     * different one. Each call site is handed the spatial and temporal frequency of the wave it
     * replaced, and the shared `KUI_FBM_SINE_RMS` brings amplitude-normalised fbm up to a sine's
     * RMS — get either wrong and the mode is visibly stronger or weaker, which is the outcome an
     * opt-in parameter is supposed to make impossible to arrive at by accident.
     *
     * Mean luminance and its spread, because "a different picture" and "a different amount" are
     * exactly the two things a distance cannot tell apart: a correctly re-textured mode and one
     * whose displacement doubled both read as a large distance from the original.
     */
    const dMean = Math.abs(r.statsOff.mean - r.statsOn.mean)
    const dSd = Math.abs(r.statsOff.sd - r.statsOn.sd)
    check(
      at(`noise/${mode}: noise:1 is the same effect re-textured, not a louder one`),
      dMean < 8 && dSd < 12,
      `mean ${r.statsOff.mean.toFixed(1)} -> ${r.statsOn.mean.toFixed(1)} (d=${dMean.toFixed(1)}), `
        + `spread ${r.statsOff.sd.toFixed(1)} -> ${r.statsOn.sd.toFixed(1)} (d=${dSd.toFixed(1)}) — `
        + 'a spread drift means the field amplitude does not match the term it replaced',
    )
  }

  await page.evaluate(() => window.kUIAdvanced.getSharedShaderRenderer().release())
  await context.close()
}

/**
 * 15. `hover`, `backdrop`, `angle`, `motion` — the generative program's pointer and its motion.
 *
 * Four parameters, and the hardest thing to prove about three of them is that they do *nothing*
 * when unauthored. Everything in this tier draws onto one shared canvas through one shared
 * program, so "inert" has to mean byte-identical output and not merely a small distance — and the
 * only honest way to say it is with an input that could not have reached a pixel through any older
 * path. For `noise` that was an authored `seed`; here it is **the pointer itself**, which
 * `GRADIENT_FS` did not declare a `u_mouse` for until `hover:` existed. Moving a real pointer
 * across the box at `hover: none` and getting the same bytes back is the whole proof.
 */
async function runGenerativeHover({ browser, check, label, viewport, deviceScaleFactor }) {
  const url = `file://${fileURLToPath(new URL('./fixtures/advanced-hover.html', import.meta.url))}`
  const context = await browser.newContext({ viewport, deviceScaleFactor })
  const page = await context.newPage()
  await page.goto(url)
  await page.waitForFunction(() => window.__kuiReady === true && window.kUIAdvanced !== undefined)

  // Held for the whole function: the last `destroy()` would otherwise drop `refCount` to zero and
  // tear the context down between reads, which crashes headless Chromium's software GL renderer.
  await page.evaluate(() => window.kUIAdvanced.getSharedShaderRenderer().acquire())

  const readings = await page.evaluate(`(async () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const settle = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    const { prepareShaders, getSharedShaderRenderer, createEffectParams } = window.kUIAdvanced
    const renderer = getSharedShaderRenderer()
    if (!renderer.gl) return { error: 'no gl' }
    const gl = renderer.gl
    const canvas = renderer.canvas

    // The middle 60% of the element, every device pixel of it — the same shape \`runFilterNoise\`
    // reads and for the same reason. See the note at its \`grid\` sibling in the generative block:
    // a sparse probe lattice can be aligned out of existence by whatever lattice the shader uses.
    const block = (el) => {
      const r = el.getBoundingClientRect()
      const x = Math.round((r.left + r.width * 0.2) * dpr)
      const y = Math.round(canvas.height - (r.top + r.height * 0.8) * dpr)
      const w = Math.max(1, Math.round(r.width * 0.6 * dpr))
      const h = Math.max(1, Math.round(r.height * 0.6 * dpr))
      const px = new Uint8Array(w * h * 4)
      gl.readPixels(x, y, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px)
      return px
    }

    // A 9x9 device-pixel patch centred on a named fraction of the box, for the questions that are
    // about *where* in the element something happened rather than whether it happened.
    const patch = (el, fx, fy) => {
      const r = el.getBoundingClientRect()
      const cx = Math.round((r.left + r.width * fx) * dpr)
      const cy = Math.round(canvas.height - (r.top + r.height * fy) * dpr)
      const px = new Uint8Array(9 * 9 * 4)
      gl.readPixels(cx - 4, cy - 4, 9, 9, gl.RGBA, gl.UNSIGNED_BYTE, px)
      return px
    }

    /*
     * The largest odd square of device pixels centred on the element's centre that fits inside it
     * with room to spare — the shape a *rotation* has to be read in.
     *
     * \`block\` reads a rectangle, which is the right shape for "did the picture change" and the
     * wrong one for "did it turn": a quarter turn of a 96x60 rectangle is a 60x96 rectangle and
     * there is nothing left to compare it to. A centred square turns onto itself, and with an odd
     * side the centre is one exact pixel, so the remap below is integer indexing with no
     * interpolation error for a real defect to hide in.
     */
    const squareRadius = (el) => {
      const r = el.getBoundingClientRect()
      return Math.floor(Math.min(r.width, r.height) * dpr * 0.35)
    }
    const square = (el, rad) => {
      const r = el.getBoundingClientRect()
      const cx = Math.round((r.left + r.width / 2) * dpr)
      const cy = Math.round(canvas.height - (r.top + r.height / 2) * dpr)
      const n = 2 * rad + 1
      const px = new Uint8Array(n * n * 4)
      gl.readPixels(cx - rad, cy - rad, n, n, gl.RGBA, gl.UNSIGNED_BYTE, px)
      return px
    }

    /** Turn a centred odd square a quarter turn about its middle pixel. \`sign\` picks which way. */
    const rot90 = (px, sign) => {
      const n = Math.round(Math.sqrt(px.length / 4))
      const c = (n - 1) / 2
      const out = new Uint8Array(px.length)
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          const sx = c + sign * (y - c)
          const sy = c - sign * (x - c)
          const si = (sy * n + sx) * 4
          const di = (y * n + x) * 4
          out[di] = px[si]; out[di + 1] = px[si + 1]; out[di + 2] = px[si + 2]; out[di + 3] = px[si + 3]
        }
      }
      return out
    }

    const dist = (a, b) => {
      if (a.length !== b.length) return NaN
      let n = 0
      for (let i = 0; i < a.length; i++) n += Math.abs(a[i] - b[i])
      return n / a.length
    }
    const same = (a, b) => dist(a, b) === 0
    const lum = (a) => {
      let n = 0
      for (let i = 0; i < a.length; i += 4) n += 0.299 * a[i] + 0.587 * a[i + 1] + 0.114 * a[i + 2]
      return n / (a.length / 4)
    }
    const alpha = (a) => { let n = 0; for (let i = 3; i < a.length; i += 4) n += a[i]; return n / (a.length / 4) }
    // Only the alpha channel, byte for byte. On \`mode: logo\` alpha *is* the stencil, so this is
    // the exact question "did the mark's shape move".
    const alphaBytes = (a) => { const o = new Uint8Array(a.length / 4); for (let i = 0, j = 0; i < a.length; i += 4, j++) o[j] = a[i + 3]; return o }

    // Put a real pointer somewhere inside an element. \`renderer.mouse\` is written by a
    // \`pointermove\` on the window and nothing else, and \`hasPointer\` latches on the first one —
    // which is why every read below sets it explicitly rather than relying on the resting centre.
    const point = (el, fx, fy) => {
      const r = el.getBoundingClientRect()
      window.dispatchEvent(new PointerEvent('pointermove', {
        clientX: r.left + r.width * fx,
        clientY: r.top + r.height * fy,
        bubbles: true,
      }))
    }

    /** Activate one instance on one element, read it on a single frame, tear it down. */
    const read = async (id, extra, mouse, probes, wantSquare) => {
      const el = document.getElementById(id)
      if (mouse) point(el, mouse[0], mouse[1])
      const inst = prepareShaders(el, createEffectParams({ mode: 'gradient', speed: 0, seed: 3, scale: 3, strength: 2, ...extra }))
      inst.activate()
      await settle()
      const out = await new Promise((resolve) => requestAnimationFrame(() => {
        const o = { block: block(el) }
        if (wantSquare) o.square = square(el, squareRadius(el))
        for (const [name, fx, fy] of (probes || [])) o[name] = patch(el, fx, fy)
        resolve(o)
      }))
      inst.destroy()
      await settle()
      return out
    }

    const out = {}

    // ---- hover: does the pointer reach a pixel, and only where it should? -------------------
    // Left and right of an 8:5 box. Both well inside it, and far enough apart that one pool of
    // light cannot cover both.
    const L = [0.2, 0.5]
    const R = [0.85, 0.5]
    const P = [['near', 0.2, 0.5], ['far', 0.85, 0.5]]
    const noneL = await read('hv', { hover: 'none' }, L, P)
    const noneR = await read('hv', { hover: 'none' }, R, P)
    const stirL = await read('hv', { hover: 'stir' }, L, P)
    const stirR = await read('hv', { hover: 'stir' }, R, P)
    const lightL = await read('hv', { hover: 'light' }, L, P)
    const lightR = await read('hv', { hover: 'light' }, R, P)
    const bothL = await read('hv', { hover: 'both' }, L, P)

    out.hover = {
      pixels: noneL.block.length / 4,
      // THE inertness proof. The pointer is the one input that could not reach this program at all
      // before \`hover:\` existed, so a single differing byte here means every gradient on the web
      // just started following the mouse.
      noneExact: same(noneL.block, noneR.block),
      noneMoved: dist(noneL.block, noneR.block),
      stirMoved: dist(stirL.block, stirR.block),
      lightMoved: dist(lightL.block, lightR.block),
      stirVsNone: dist(stirL.block, noneL.block),
      lightVsNone: dist(lightL.block, noneL.block),
      bothVsNone: dist(bothL.block, noneL.block),
      bothVsStir: dist(bothL.block, stirL.block),
      bothVsLight: dist(bothL.block, lightL.block),
      // Locality: with the pointer on the left, the right-hand end of the box must be left alone.
      // A gesture that moved the whole field would be a restyling wearing a pointer's clothes.
      stirNear: dist(stirL.near, noneL.near),
      stirFar: dist(stirL.far, noneL.far),
      lightNear: dist(lightL.near, noneL.near),
      lightFar: dist(lightL.far, noneL.far),
      unusedR: dist(stirR.block, lightR.block) >= 0,
    }

    // ---- hover: light — is the pool a circle on screen, on a box that is not square? --------
    // \`strength: 0\` flattens the field to the exact midpoint of the ramp, so the element is one
    // uniform colour and the only thing varying across it is the light. Without that the field's
    // own structure swamps a 40-pixel comparison.
    //
    // The two probes are the same number of *screen* pixels from the centre of a 160x100 box: 40px
    // right, and 40px down. Equal gains means the falloff was corrected for the box's aspect;
    // uncorrected, the vertical probe sits at 0.8 of a UV unit against the horizontal one's 0.5
    // and comes back nearly dark.
    const FLAT = { strength: 0, color1: '#303030', color2: '#6060a0' }
    const flatProbes = [['ctr', 0.5, 0.5], ['h', 0.75, 0.5], ['v', 0.5, 0.9], ['corner', 0.95, 0.95]]
    const flatNone = await read('hv', { ...FLAT, hover: 'none' }, [0.5, 0.5], flatProbes)
    const flatLight = await read('hv', { ...FLAT, hover: 'light' }, [0.5, 0.5], flatProbes)
    const gain = (k) => lum(flatLight[k]) / Math.max(lum(flatNone[k]), 1e-6)
    out.light = {
      flat: lum(flatNone.ctr),
      flatSpread: Math.abs(lum(flatNone.h) - lum(flatNone.v)),
      centre: gain('ctr'),
      h: gain('h'),
      v: gain('v'),
      corner: gain('corner'),
    }

    // ---- stir on a logo: the fill swirls, the stencil does not move ------------------------
    // The mark's edges live in the alpha channel, which \`glyphMask()\` writes from the undistorted
    // \`v_uv\`. If \`stir\` ever reached that sample the alpha would blur and a logo would dissolve.
    const LOGO = { mode: 'logo', mask: 'alpha', seed: 3, scale: 3, strength: 2, speed: 0 }
    const logoNone = await read('logo', { ...LOGO, hover: 'none' }, [0.25, 0.5], [])
    const logoStir = await read('logo', { ...LOGO, hover: 'stir' }, [0.25, 0.5], [])
    out.logo = {
      stencilExact: same(alphaBytes(logoNone.block), alphaBytes(logoStir.block)),
      stencilMoved: dist(alphaBytes(logoNone.block), alphaBytes(logoStir.block)),
      fillMoved: dist(logoNone.block, logoStir.block),
      coverage: alpha(logoNone.block),
    }

    // ---- backdrop -------------------------------------------------------------------------
    const bdNone = await read('logo', { ...LOGO }, [0.5, 0.5], [['hole', 0.5, 0.5], ['ring', 0.2, 0.5]])
    const bdRed = await read('logo', { ...LOGO, backdrop: '#ff0000' }, [0.5, 0.5], [['hole', 0.5, 0.5], ['ring', 0.2, 0.5]])
    // On a bare \`gradient\` the field is opaque, so there is nothing behind it to see. Asserted as
    // byte-identical rather than left undocumented: it is arithmetic, not an oversight, and the
    // way to make it visible there is a \`tint\` whose alpha is below 1.
    const gradNoBd = await read('hv', { hover: 'none' }, [0.5, 0.5], [])
    const gradBd = await read('hv', { hover: 'none', backdrop: '#ff0000' }, [0.5, 0.5], [])
    const gradFadeNoBd = await read('hv', { hover: 'none', tint: '#ffffff80' }, [0.5, 0.5], [])
    const gradFadeBd = await read('hv', { hover: 'none', tint: '#ffffff80', backdrop: '#ff0000' }, [0.5, 0.5], [])
    const red = (a) => { let r = 0, g = 0, b = 0; for (let i = 0; i < a.length; i += 4) { r += a[i]; g += a[i + 1]; b += a[i + 2] } const n = a.length / 4; return [r / n, g / n, b / n] }
    out.backdrop = {
      holeAlphaOff: alpha(bdNone.hole),
      holeAlphaOn: alpha(bdRed.hole),
      holeRgbOn: red(bdRed.hole),
      ringMoved: dist(bdNone.ring, bdRed.ring),
      opaqueGradientExact: same(gradNoBd.block, gradBd.block),
      opaqueGradientMoved: dist(gradNoBd.block, gradBd.block),
      translucentMoved: dist(gradFadeNoBd.block, gradFadeBd.block),
    }

    // ---- angle, on the same box so "unset" can be asserted byte-for-byte -------------------
    const angUnset = await read('hv', { hover: 'none' }, [0.5, 0.5], [])
    const ang0 = await read('hv', { hover: 'none', angle: '0deg' }, [0.5, 0.5], [])
    const ang90 = await read('hv', { hover: 'none', angle: '90deg' }, [0.5, 0.5], [])
    const angTurn = await read('hv', { hover: 'none', angle: '0.25turn' }, [0.5, 0.5], [])
    // \`motion: evolve\` is the shipped behaviour under an accurate name, so it must be the same
    // bytes as not authoring the parameter at all.
    const motUnset = await read('hv', { hover: 'none' }, [0.5, 0.5], [])
    const motEvolve = await read('hv', { hover: 'none', motion: 'evolve' }, [0.5, 0.5], [])
    out.angle = {
      unsetIsZeroExact: same(angUnset.block, ang0.block),
      unsetIsZeroMoved: dist(angUnset.block, ang0.block),
      rotated: dist(ang0.block, ang90.block),
      // Same angle, two spellings — the parameter really is going through \`parseAngleRadians\`
      // and not being read as a bare number.
      turnMatchesDeg: same(ang90.block, angTurn.block),
      evolveIsDefaultExact: same(motUnset.block, motEvolve.block),
    }

    /*
     * ---- angle turns RIGIDLY, on a box that is not square ---------------------------------
     *
     * The check above says \`90deg\` is a different picture from \`0deg\`. It cannot say whether it
     * is the *right* different picture, and for a year it was not: the rotation was applied to
     * \`(v_uv - 0.5)\`, a per-axis-normalised coordinate, so on a non-square box the field turned
     * **and sheared**. On this 160x100 box an authored \`angle: 45deg\` actually travelled at 32
     * degrees. A regression test on a square box could never have caught it — at 1:1 the shear is
     * the identity and the broken maths and the correct maths agree exactly.
     *
     * What makes it measurable: writing \`s\` for a screen offset from the box's centre and
     * \`A = diag(k, 1/k)\`, \`A · diag(W, H)⁻¹\` is \`(1 / sqrt(W*H)) · I\`, so the corrected field is
     *
     *     picture_theta(s) = f( (scale / sqrt(W*H)) · A⁻¹ · R(-theta) · s )
     *
     * and therefore **picture_theta(s) == picture_0(R(-theta) · s)** for a box of any shape: a
     * rigid turn of the same picture about the same centre. At theta = 90deg that remap is exact
     * integer pixel indexing, (dx, dy) -> (dy, -dx), so this compares device pixels with no
     * resampling at all.
     *
     * Under the old maths it does not hold and cannot be made to: picture_90 reads the field at
     * \`(sy/H, -sx/W)\` where the remapped picture_0 reads it at \`(sy/W, -sx/H)\` — the two axes
     * scaled apart by the aspect ratio, which on 8:5 is a different crop of the noise and scores
     * like an unrelated picture.
     *
     * The bar is a ratio rather than an absolute, because the absolute depends on the seed: the
     * remapped distance must be a small fraction of the un-remapped one. Both signs of the quarter
     * turn are tried, so the check does not rest on which way round GL's bottom-up readback puts
     * y — the wrong sign is the 270-degree turn and is wrong under either maths.
     */
    const sqUnrot = await read('hv', { hover: 'none', angle: '0deg' }, [0.5, 0.5], [], true)
    const sq90 = await read('hv', { hover: 'none', angle: '90deg' }, [0.5, 0.5], [], true)
    // The control, and the whole point of it: the same comparison on an 80x80 box passes under
    // BOTH the old maths and the new. It proves the remap and the probe geometry, not the fix.
    const sqSqUnrot = await read('m-a', { hover: 'none', angle: '0deg' }, [0.5, 0.5], [], true)
    const sqSq90 = await read('m-a', { hover: 'none', angle: '90deg' }, [0.5, 0.5], [], true)
    const rigidity = (zero, turned) => Math.min(
      dist(turned.square, rot90(zero.square, 1)),
      dist(turned.square, rot90(zero.square, -1)),
    )
    out.rigid = {
      nonSquare: rigidity(sqUnrot, sq90),
      // The scale the number above is small *relative to*: what 90deg costs when it is not
      // un-turned first. If angle were silently ignored this would be 0 and the ratio bar would
      // fail, so the check cannot be passed by doing nothing.
      nonSquareTurned: dist(sq90.square, sqUnrot.square),
      square: rigidity(sqSqUnrot, sqSq90),
      squareTurned: dist(sqSq90.square, sqSqUnrot.square),
      px: sqUnrot.square.length / 4,
    }

    // ---- motion, which needs a clock, so: several boxes read on ONE frame ------------------
    // \`speed: 0\` freezes \`u_time\` and with it \`drift\` and \`swirl\`, which are both functions of
    // it — so the sequential same-box reads above cannot ask this question at all. Seven identical
    // boxes activated together and read on the same frame share one \`u_time\`; the only difference
    // between two of them is where they sit, and the control pair measures exactly that.
    const BASE = { mode: 'gradient', seed: 3, scale: 3, strength: 2, speed: 4 }
    const spec = {
      'm-a': {}, 'm-b': {},
      'm-drift': { motion: 'drift' },
      'm-drift180': { motion: 'drift', angle: '180deg' },
      'm-swirl': { motion: 'swirl' },
      'a-0': { angle: '0deg' }, 'a-90': { angle: '90deg' },
    }
    const ids = Object.keys(spec)
    const inst = {}
    for (const id of ids) inst[id] = prepareShaders(document.getElementById(id), createEffectParams({ ...BASE, ...spec[id] }))
    for (const id of ids) inst[id].activate()
    await settle()
    /*
     * Read on a frame whose swirl phase is chosen, not whichever one the page happened to reach.
     *
     * \`u_time\` is \`performance.now() / 1000\` — a page-lifetime clock (\`startLoop\` in
     * \`shaders.ts\`) — so \`swirl\`'s rotation is \`clock * speed * 0.2\` radians and **the distance
     * between a swirling field and a still one is periodic in it**: at a whole number of turns the
     * rotation is the identity and the two are the same picture. Measured across 5.3 periods, the
     * distance means 10-17 through the middle of a turn and drops to 4.2 in the bins either side of
     * 2pi, with a floor of 0.50.
     *
     * That is not a weak effect, it is a comparison of a thing against itself, and which one a run
     * lands on is decided by how fast the page happens to be: at 800x600 DPR 1 a frame here costs
     * 24ms and the block arrives at ~2.5s of page clock; at 390x844 DPR 2 it costs 65ms and the
     * block arrives near 10s, a completely different phase. Waiting a fixed ten frames measured
     * whichever phase the machine dealt.
     *
     * So the loop below advances until the phase is at least a radian away from a whole turn at
     * both ends, and reads on that frame. Every rAF callback in one frame is handed the same
     * timestamp and the renderer's own tick is registered ahead of this one, so the \`ts\` seen here
     * is exactly the \`u_time\` that drew the pixels being read. \`drift\` needs none of this — its
     * travel is unbounded rather than periodic, which is why it measured a flat 12.5-15.9 across
     * every one of those same bins.
     */
    const TAU = Math.PI * 2
    const spinAt = (ts) => (ts / 1000) * BASE.speed * 0.2
    const frame = await new Promise((resolve) => {
      let tries = 0
      const tick = (ts) => {
        const phase = ((spinAt(ts) % TAU) + TAU) % TAU
        // The bound is a safety net, not the mechanism: at speed 4 a full turn is 7.9s of page
        // clock, so the window opens within about 80 frames even on the slowest of these runs.
        if ((phase > 1 && phase < TAU - 1) || tries++ > 400) {
          const o = { spin: spinAt(ts), phase }
          for (const id of ids) o[id] = block(document.getElementById(id))
          resolve(o)
        } else requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
    for (const id of ids) inst[id].destroy()
    out.motion = {
      control: dist(frame['m-a'], frame['m-b']),
      drift: dist(frame['m-a'], frame['m-drift']),
      swirl: dist(frame['m-a'], frame['m-swirl']),
      driftDirection: dist(frame['m-drift'], frame['m-drift180']),
      driftVsSwirl: dist(frame['m-drift'], frame['m-swirl']),
      angleSameFrame: dist(frame['a-0'], frame['a-90']),
      spin: frame.spin, phase: frame.phase,
    }
    return out
  })()`)

  const at = (name) => `${label}: ${name}`
  if (readings.error) {
    check(at('hover: the fixture reached a real WebGL2 context'), false, readings.error)
    await context.close()
    return
  }
  const n = (v) => (typeof v === 'number' ? v.toFixed(3) : String(v))
  const h = readings.hover

  // ---- hover ---------------------------------------------------------------------------------
  check(
    at('hover: INERTNESS — at hover:none a real pointer moved across the box changes nothing, byte for byte'),
    h.noneExact,
    `${h.pixels} px read; distance=${n(h.noneMoved)} between a pointer at 20% and at 85% `
      + '(nonzero means every gradient already on the web now follows the mouse)',
  )
  check(
    at('hover: stir — moving the pointer moves the field'),
    h.stirMoved > 2 && h.stirVsNone > 2,
    `pointer L vs R=${n(h.stirMoved)}, vs hover:none=${n(h.stirVsNone)} (~0 means u_mouse never reached the shader)`,
  )
  check(
    at('hover: light — moving the pointer moves the highlight'),
    h.lightMoved > 2 && h.lightVsNone > 2,
    `pointer L vs R=${n(h.lightMoved)}, vs hover:none=${n(h.lightVsNone)}`,
  )
  check(
    at('hover: both is genuinely both — its own picture, not either half'),
    h.bothVsNone > 2 && h.bothVsStir > 1 && h.bothVsLight > 1,
    `vs none=${n(h.bothVsNone)}, vs stir=${n(h.bothVsStir)}, vs light=${n(h.bothVsLight)} `
      + '(a zero against stir or light would mean one gesture is being dropped)',
  )
  // The gesture is local, which is what makes it a *pointer* response rather than a restyling.
  check(
    at('hover: stir is local — the far end of the box is left where it was'),
    h.stirNear > h.stirFar * 3 && h.stirNear > 2,
    `near the pointer=${n(h.stirNear)}, far from it=${n(h.stirFar)}`,
  )
  check(
    at('hover: light is local — the far end of the box keeps its own brightness'),
    h.lightNear > h.lightFar * 3 && h.lightNear > 2,
    `near the pointer=${n(h.lightNear)}, far from it=${n(h.lightFar)}`,
  )

  // ---- the shape of the pool -----------------------------------------------------------------
  const li = readings.light
  check(
    at('hover: HARNESS CONTROL — strength:0 really is a flat field, so the light is all that varies'),
    li.flatSpread < 1.5 && li.flat > 20,
    `luma=${n(li.flat)}, spread between two probes=${n(li.flatSpread)}`,
  )
  check(
    at('hover: light brightens under the pointer and leaves the far corner alone'),
    li.centre > 1.5 && li.corner < 1.05,
    `gain at the pointer=${n(li.centre)}x, at the far corner=${n(li.corner)}x`,
  )
  // The aspect correction. Both probes are 40 screen pixels from the pointer on a 160x100 box —
  // one horizontally, one vertically. Uncorrected they sit at 0.5 and 0.8 of a UV unit and the
  // vertical one comes back at about 1.01x against the horizontal one's 1.15x.
  check(
    at('hover: the pool is a circle on screen, not an ellipse stretched by the box'),
    Math.abs(li.h - li.v) < 0.06 && li.h > 1.15,
    `40px right=${n(li.h)}x, 40px down=${n(li.v)}x on an 8:5 box `
      + '(a gap here means the falloff was measured in UV and not corrected for the aspect)',
  )

  // ---- the logo edge finding ------------------------------------------------------------------
  const lg = readings.logo
  check(
    at('logo: HARNESS CONTROL — the stencil really is cutting the field'),
    lg.coverage > 20 && lg.coverage < 250,
    `mean alpha=${n(lg.coverage)} (0 or 255 means there is no mark to smudge)`,
  )
  check(
    at('logo: stir swirls the fill and does NOT move the mark — the alpha channel is byte-identical'),
    lg.stencilExact && lg.fillMoved > 2,
    `stencil distance=${n(lg.stencilMoved)} (must be exactly 0), fill distance=${n(lg.fillMoved)} `
      + '(glyphMask samples the undistorted v_uv; if it ever samples the stirred coordinate, logos dissolve)',
  )

  // ---- backdrop -------------------------------------------------------------------------------
  const bd = readings.backdrop
  check(
    at('backdrop: fills the hole in a logo — the plate a mark sits on'),
    bd.holeAlphaOff < 20 && bd.holeAlphaOn > 240
      && bd.holeRgbOn[0] > 200 && bd.holeRgbOn[1] < 60 && bd.holeRgbOn[2] < 60,
    `hole alpha ${n(bd.holeAlphaOff)} -> ${n(bd.holeAlphaOn)}, rgb=${bd.holeRgbOn.map(n).join(',')}`,
  )
  check(
    at('backdrop: does not touch the mark itself — it is behind the field, not mixed into it'),
    bd.ringMoved < 2,
    `distance inside the mark=${n(bd.ringMoved)}`,
  )
  // Stated as a tested fact rather than left for someone to discover: on an opaque field there is
  // nothing behind it to see, and the way through is a tint alpha.
  check(
    at('backdrop: invisible on an opaque gradient, byte for byte — arithmetic, not an oversight'),
    bd.opaqueGradientExact,
    `distance=${n(bd.opaqueGradientMoved)} on an opaque field`,
  )
  check(
    at('backdrop: visible on a gradient once the tint is translucent'),
    bd.translucentMoved > 4,
    `distance=${n(bd.translucentMoved)} at tint alpha 0.5 (~0 means the composite path is dead)`,
  )

  // ---- angle ----------------------------------------------------------------------------------
  const an = readings.angle
  check(
    at('angle: 0deg is the same bytes as not authoring it at all'),
    an.unsetIsZeroExact,
    `distance=${n(an.unsetIsZeroMoved)}`,
  )
  check(
    at('angle: turns the field at the library defaults — no warp, no motion, nothing else authored'),
    an.rotated > 4,
    `0deg vs 90deg distance=${n(an.rotated)} (~0 means the rotation never reached the sample point)`,
  )
  check(
    at('angle: 0.25turn is 90deg — the value goes through parseAngleRadians, not through num()'),
    an.turnMatchesDeg,
    'byte-identical to 90deg',
  )
  check(
    at('motion: evolve is the shipped behaviour under a name — the same bytes as an unset motion'),
    an.evolveIsDefaultExact,
    'byte-identical',
  )

  // ---- angle turns rigidly on a NON-SQUARE box (the shear regression) --------------------------
  const rg = readings.rigid
  /*
   * The bar is one fifth, and the number is measured rather than chosen. Swept over 40 noise seeds
   * off-GPU (both coordinate chains reimplemented against a stand-in fbm), the ratio comes out:
   *
   *     old maths, 8:5 box            0.306 .. 0.851   <- the bug
   *     corrected maths, 8:5 box      0.000
   *     corrected, centre off by 0.5px  <= 0.089       <- the worst rounding can cost this probe
   *
   * **A bar of one third would have sat inside the old maths' own floor of 0.306**, so a `/3` test
   * could have passed against the very defect it exists for. One fifth clears 0.089 from below and
   * 0.306 from above. That is the whole reason the constant is 5 and not 3 — do not "simplify" it
   * back without re-running that sweep. Every other knob is at its zero default here, so nothing
   * per-pixel and rotation-hostile (`grain`, `bands`, `chromatic`, `warp`) is in the picture.
   */
  check(
    at('angle: HARNESS CONTROL — the quarter-turn remap lines up on a square 80x80 box'),
    rg.square < rg.squareTurned / 5,
    `remapped=${n(rg.square)} vs turned-but-not-remapped=${n(rg.squareTurned)}`
      + ' (this passes under the old maths too — it proves the probe, not the fix)',
  )
  check(
    at('angle: turns RIGIDLY on a 160x100 box — 90deg is 0deg rotated, not 0deg rotated and sheared'),
    rg.nonSquare < rg.nonSquareTurned / 5,
    `${rg.px} px read; remapped=${n(rg.nonSquare)} vs turned-but-not-remapped=${n(rg.nonSquareTurned)}`
      + ' (a ratio near 1 is the per-axis-normalised rotation that made angle:45deg travel at 32deg)',
  )

  // ---- motion ---------------------------------------------------------------------------------
  const mo = readings.motion
  check(
    at('motion: HARNESS CONTROL — two identical fields in two boxes on one frame are the same picture'),
    mo.control < 2,
    `distance=${n(mo.control)} (this is the floor every threshold below clears)`,
  )
  check(
    at('motion: drift travels — a drifting field is a different picture from one evolving in place'),
    mo.drift > 4,
    `distance=${n(mo.drift)} vs a control floor of ${n(mo.control)}`,
  )
  check(
    at('motion: angle is the direction it travels — 0deg and 180deg are different journeys'),
    mo.driftDirection > 4,
    `distance=${n(mo.driftDirection)} (~0 would mean angle is read but the travel ignores it)`,
  )
  check(
    at('motion: swirl turns, and is its own mode rather than drift by another name'),
    mo.swirl > 4 && mo.driftVsSwirl > 4,
    `vs evolve=${n(mo.swirl)}, vs drift=${n(mo.driftVsSwirl)} at ${n(mo.phase)} rad into the turn `
      + `(${n(mo.spin)} rad total) — a phase near 0 or 6.28 would be the identity rotation, not a weak effect`,
  )
  check(
    at('motion: angle still turns the field when it is animating, not only when frozen'),
    mo.angleSameFrame > 4,
    `0deg vs 90deg at speed 4, distance=${n(mo.angleSameFrame)}`,
  )

  await page.evaluate(() => window.kUIAdvanced.getSharedShaderRenderer().release())
  await context.close()
}

/**
 * 16. Four defects the unit suite structurally cannot see, because it mocks WebGL.
 *
 * Every one of them is invisible to a suite whose `gl` is a `vi.fn()` record: a texture handle from
 * a lost context is a live JavaScript object to a mock, a blend is arithmetic no mock executes, a
 * `createBuffer` that answers `null` is a mock that was told to, and an element's own `opacity` is
 * a number nothing reads back. All four were reported as high or medium severity against source
 * that had 100% line coverage, which is the reason this block is here and not there.
 *
 * What each one asserts, and the shape of the failure it catches:
 *
 * - **Blend alpha.** `screen` and `add` ran their arithmetic over all four *premultiplied*
 *   components, so `screen((0,0,0,0), red)` was an opaque red pixel: a transparent PNG's surround
 *   filled with a solid rectangle. Read as alpha at a point where the source has no coverage —
 *   which is why the mark here is an annulus and not a blob, so there are two such points inside
 *   the element's own box rather than only outside it. The duotone ramp had the same shape of bug
 *   in a different place and is read the same way, on the red channel, because its wrong answer had
 *   `a == 0` with `rgb > 0` — additive glow rather than a rectangle.
 * - **The host's own opacity.** The replica was painted at the ancestors' opacity only, so a
 *   `.hero { opacity: .25 }` had its original hidden and its copy drawn at full strength. The trap
 *   in fixing it is that the module writes `opacity: 0` to the very element it must read, so the
 *   `late` reading below — taken seven frames after the hide, with the computed value asserted to
 *   be `0` — is the one that matters. `early` alone would pass against a live read.
 * - **A stale texture across a context restore.** `cancel()` takes the instance out of
 *   `contextCallbacks`, so nothing tells it the context died; `acquireRenderer` short-circuits on
 *   re-activation because the renderer itself never was destroyed. Asserted on both halves: the
 *   replica is red again (not the black an incomplete texture samples), and a *new* upload
 *   happened, which is the mechanism rather than the symptom.
 * - **A failed quad allocation.** `gl.createBuffer()` answers `null` under memory pressure and
 *   nothing downstream throws, so the renderer came up, drew nothing, and reported success — and
 *   the caller hid the element. The claim asserted is the user-visible one: the host keeps its
 *   opacity. Run on its own page, because it needs a document whose shared renderer has never been
 *   built.
 */
async function runShaderDefects({ browser, check, label, viewport, deviceScaleFactor }) {
  const url = `file://${fileURLToPath(new URL('./fixtures/advanced-shader-defects.html', import.meta.url))}`
  const context = await browser.newContext({ viewport, deviceScaleFactor })
  const page = await context.newPage()
  await page.goto(url)
  await page.waitForFunction(() => window.__kuiReady === true && window.kUIAdvanced !== undefined)
  // `isImg` in `createShaderTextureHolders` requires `complete && naturalWidth > 0`, and a holder
  // that finds no source uploads no texture and draws nothing — which reads here as every defect
  // being fixed at once. Wait for the decode rather than trusting `__kuiReady`.
  await page.waitForFunction(() => Array.from(document.images).every((i) => i.complete && i.naturalWidth > 0))

  const at = (name) => `${label}: ${name}`
  const show = (p) => `rgba(${p})`

  const PROBES = `
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const settle = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    const pt = (gl, canvas, el, fx, fy) => {
      const r = el.getBoundingClientRect()
      const px = new Uint8Array(4)
      gl.readPixels(
        Math.round((r.left + r.width * fx) * dpr),
        Math.round(canvas.height - (r.top + r.height * fy) * dpr),
        1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px,
      )
      return [px[0], px[1], px[2], px[3]]
    }
  `

  // One reference for the whole function, for the reason documented in `runGenerativeField`: the
  // last `destroy()` of each block would otherwise tear the context down and the next block would
  // build it again, which crashes headless Chromium's software GL.
  await page.evaluate(() => window.kUIAdvanced.getSharedShaderRenderer().acquire())

  // ---- Block A: blend and duotone over a source with no coverage -----------------------------
  const blend = await page.evaluate(`(async () => {
    ${PROBES}
    const { prepareShaders, getSharedShaderRenderer, createEffectParams } = window.kUIAdvanced
    const renderer = getSharedShaderRenderer()
    // \`strength: 0, speed: 0\` pins the ripple at zero, so every probe samples the texel under it
    // and a displaced edge cannot be mistaken for a coverage change.
    const read = async (id, opts) => {
      const el = document.getElementById(id)
      const inst = prepareShaders(el, createEffectParams({ mode: 'displace', strength: 0, speed: 0, ...opts }))
      inst.activate()
      await settle()
      const gl = renderer.gl
      const out = await new Promise((resolve) => requestAnimationFrame(() => resolve({
        ring: pt(gl, renderer.canvas, el, 0.22, 0.5),
        hole: pt(gl, renderer.canvas, el, 0.5, 0.5),
        corner: pt(gl, renderer.canvas, el, 0.04, 0.04),
      })))
      inst.destroy()
      await settle()
      return out
    }
    return {
      screen: await read('blend-screen', { blend: 'screen', tint: '#ff0000' }),
      add: await read('blend-add', { blend: 'add', tint: '#ff0000' }),
      duo: await read('duotone', { color1: '#ff0000', color2: '#0000ff' }),
    }
  })()`)

  const opaquePx = (p) => p[3] > 200
  const clearPx = (p) => p[3] < 20

  check(
    at('blend: screen still paints the mark — the control for everything below it'),
    opaquePx(blend.screen.ring),
    `ring=${show(blend.screen.ring)}`,
  )
  check(
    at('blend: screen leaves a transparent source transparent, inside the box and out'),
    clearPx(blend.screen.hole) && clearPx(blend.screen.corner),
    `hole=${show(blend.screen.hole)}, corner=${show(blend.screen.corner)} `
      + '(an opaque red pixel here is the tint blended into the alpha channel)',
  )
  check(
    at('blend: add paints the mark'),
    opaquePx(blend.add.ring),
    `ring=${show(blend.add.ring)}`,
  )
  check(
    at('blend: add leaves a transparent source transparent'),
    clearPx(blend.add.hole) && clearPx(blend.add.corner),
    `hole=${show(blend.add.hole)}, corner=${show(blend.add.corner)}`,
  )
  check(
    at('duotone: the ramp reaches color2 on a white source'),
    blend.duo.ring[2] > 200 && opaquePx(blend.duo.ring),
    `ring=${show(blend.duo.ring)} (blue = color2 at full luminance)`,
  )
  // Read on red, not on alpha: the duotone bug wrote `color1` into `rgb` and left `a` at 0, which a
  // premultiplied canvas composites additively. An alpha-only check passes straight through it.
  check(
    at('duotone: and writes no colour at all where the source has no coverage'),
    blend.duo.hole[0] < 20 && clearPx(blend.duo.hole) && blend.duo.corner[0] < 20,
    `hole=${show(blend.duo.hole)}, corner=${show(blend.duo.corner)} `
      + '(red with alpha 0 is color1 premultiplied by nothing — an additive glow, not a rectangle)',
  )

  // ---- Block B: the host element's own opacity -----------------------------------------------
  const faded = await page.evaluate(`(async () => {
    ${PROBES}
    const { prepareShaders, getSharedShaderRenderer, createEffectParams } = window.kUIAdvanced
    const renderer = getSharedShaderRenderer()
    const P = (o) => createEffectParams({ strength: 0, speed: 0, ...o })
    const els = {
      faded: document.getElementById('faded'),
      opaque: document.getElementById('opaque'),
      gen: document.getElementById('faded-gen'),
    }
    const inst = [
      prepareShaders(els.faded, P({ mode: 'displace' })),
      prepareShaders(els.opaque, P({ mode: 'displace' })),
      prepareShaders(els.gen, P({ mode: 'gradient', seed: 3, scale: 3, strength: 2 })),
    ]
    for (const i of inst) i.activate()
    await settle()
    const gl = renderer.gl
    const sample = () => ({
      faded: pt(gl, renderer.canvas, els.faded, 0.5, 0.5),
      opaque: pt(gl, renderer.canvas, els.opaque, 0.5, 0.5),
      gen: pt(gl, renderer.canvas, els.gen, 0.5, 0.5),
      computed: getComputedStyle(els.faded).opacity,
    })
    const early = await new Promise((r) => requestAnimationFrame(() => r(sample())))
    // Seven more frames. By now \`hideBehindRenderer\` has written \`opacity: 0\` on the host, so a
    // live read of its computed opacity answers 0 and only the instance's cache still holds .25.
    for (let i = 0; i < 7; i++) await new Promise((r) => requestAnimationFrame(r))
    const late = await new Promise((r) => requestAnimationFrame(() => r(sample())))
    for (const i of inst) i.destroy()
    await settle()
    return { early, late, restored: getComputedStyle(els.faded).opacity }
  })()`)

  // .25 of 255 is 64. The window is wide because the source is premultiplied on upload and the
  // read comes back through an 8-bit framebuffer, so a couple of levels either way is rounding.
  const quarter = (p) => p[3] > 45 && p[3] < 85

  check(
    at('host-opacity: an opacity:.25 host gets a replica at a quarter, not at full strength'),
    quarter(faded.late.faded),
    `faded=${show(faded.late.faded)} — 255 means the copy ignored the host's own opacity `
      + `while the original stayed hidden; expected alpha near 64`,
  )
  check(
    at('host-opacity: the identical image without the declaration is still opaque'),
    opaquePx(faded.late.opaque),
    `opaque=${show(faded.late.opaque)}`,
  )
  check(
    at('host-opacity: the cache is what is being read — the live computed value is 0 by now'),
    faded.late.computed === '0',
    `computed=${JSON.stringify(faded.late.computed)} (not 0 means the hide never happened and `
      + 'this block proved nothing about the cache)',
  )
  check(
    at('host-opacity: it held from the first frame, so no frame was drawn at the wrong alpha'),
    quarter(faded.early.faded),
    `early=${show(faded.early.faded)}, late=${show(faded.late.faded)}`,
  )
  check(
    at('host-opacity: a generative field over an opacity:.25 host is faded too'),
    quarter(faded.early.gen) && quarter(faded.late.gen),
    `early=${show(faded.early.gen)}, late=${show(faded.late.gen)} `
      + '(a generator never hides its host, so this one is always on the live read)',
  )
  check(
    at('host-opacity: teardown gives the author their .25 back'),
    faded.restored === '0.25',
    `computed=${JSON.stringify(faded.restored)}`,
  )

  // ---- Block C: a context lost while the instance is inactive ---------------------------------
  const stale = await page.evaluate(`(async () => {
    ${PROBES}
    const { prepareShaders, getSharedShaderRenderer, createEffectParams } = window.kUIAdvanced
    const renderer = getSharedShaderRenderer()
    const el = document.getElementById('stale')
    const gl = renderer.gl
    if (!gl) return { error: 'no gl' }
    let uploads = 0
    const origTexImage2D = gl.texImage2D
    gl.texImage2D = function (...args) { uploads++; return origTexImage2D.apply(this, args) }

    const inst = prepareShaders(el, createEffectParams({ mode: 'displace', strength: 0, speed: 0 }))
    inst.activate()
    await settle()
    const first = pt(gl, renderer.canvas, el, 0.5, 0.5)
    const hiddenWhileActive = el.style.opacity

    // Inactive but still acquired. \`cancel()\` unregisters the draw *and* the context callbacks,
    // which is precisely how this instance comes to miss what happens on the next two lines.
    inst.cancel()
    await settle()
    const visibleAfterCancel = el.style.opacity
    const registered = renderer.contextCallbacks.size

    const ext = gl.getExtension('WEBGL_lose_context')
    if (!ext) return { error: 'no WEBGL_lose_context' }
    ext.loseContext()
    await new Promise((r) => setTimeout(r, 60))
    const lost = renderer.isContextLost
    ext.restoreContext()
    await new Promise((r) => setTimeout(r, 60))
    await settle()

    const uploadsBeforeRevive = uploads
    inst.activate()
    await settle()
    const second = await new Promise((r) => requestAnimationFrame(() => r(pt(gl, renderer.canvas, el, 0.5, 0.5))))
    const hiddenAfterRevive = el.style.opacity
    const uploadsAfterRevive = uploads

    gl.texImage2D = origTexImage2D
    inst.destroy()
    await settle()
    return {
      first, second, hiddenWhileActive, visibleAfterCancel, registered, lost,
      hiddenAfterRevive, uploadsBeforeRevive, uploadsAfterRevive,
      generation: renderer.contextGeneration,
    }
  })()`)

  check(
    at('stale-texture: the first activation draws the source and hides it'),
    !stale.error && stale.first[0] > 200 && stale.hiddenWhileActive === '0',
    `error=${stale.error}, first=${show(stale.first ?? [])}, opacity=${JSON.stringify(stale.hiddenWhileActive)}`,
  )
  check(
    at('stale-texture: cancel gives the element back and leaves nothing listening for context loss'),
    stale.visibleAfterCancel === '' && stale.registered === 0,
    `opacity=${JSON.stringify(stale.visibleAfterCancel)}, contextCallbacks=${stale.registered} `
      + '(a non-zero count means this block is not testing an unregistered instance)',
  )
  check(
    at('stale-texture: the context really was lost and stamped while the instance was inactive'),
    stale.lost === true && stale.generation === 1,
    `isContextLost=${stale.lost}, contextGeneration=${stale.generation}`,
  )
  check(
    at('stale-texture: re-activating after that loss draws the image, not a blank replica'),
    stale.second[0] > 200,
    `second=${show(stale.second ?? [])} — black here is the pre-loss WebGLTexture being bound again, `
      + `with the host hidden at opacity=${JSON.stringify(stale.hiddenAfterRevive)} in front of it`,
  )
  check(
    at('stale-texture: and it got there by uploading a new texture, not by luck'),
    stale.uploadsAfterRevive > stale.uploadsBeforeRevive,
    `before=${stale.uploadsBeforeRevive}, after=${stale.uploadsAfterRevive}`,
  )

  // ---- Block D: a quad buffer that cannot be allocated -----------------------------------------
  // Its own page, because it needs a document whose shared renderer has never been built: the
  // failure is in `init()`, which runs once.
  const nobufPage = await context.newPage()
  await nobufPage.goto(url)
  await nobufPage.waitForFunction(() => window.__kuiReady === true && window.kUIAdvanced !== undefined)
  await nobufPage.waitForFunction(() => Array.from(document.images).every((i) => i.complete && i.naturalWidth > 0))

  const nobuf = await nobufPage.evaluate(async () => {
    const { prepareShaders, getSharedShaderRenderer, createEffectParams } = window.kUIAdvanced
    const el = document.getElementById('nobuf')
    const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    // The documented failure mode, reproduced at its source rather than simulated: WebGL reports a
    // buffer it could not allocate by returning null, and nothing downstream of that throws.
    const proto = window.WebGL2RenderingContext.prototype
    const orig = proto.createBuffer
    proto.createBuffer = () => null

    const inst = prepareShaders(el, createEffectParams({ mode: 'displace', strength: 0, speed: 0 }))
    inst.activate()
    await frame()
    const r = getSharedShaderRenderer()
    const failed = {
      gl: r.gl === null,
      canvas: r.canvas === null,
      quadBuffer: r.quadBuffer === null,
      refCount: r.refCount,
      opacity: el.style.opacity,
      canvasesInDoc: document.querySelectorAll('.kui-shader-canvas').length,
    }

    proto.createBuffer = orig
    inst.activate()
    await frame()
    const recovered = {
      gl: getSharedShaderRenderer().gl !== null,
      opacity: el.style.opacity,
      canvasesInDoc: document.querySelectorAll('.kui-shader-canvas').length,
    }
    inst.destroy()
    return { failed, recovered }
  })

  check(
    at('quad-alloc: a renderer that cannot allocate its quad does not hide the element'),
    nobuf.failed.opacity === '',
    `opacity=${JSON.stringify(nobuf.failed.opacity)} — "0" is the host hidden behind a canvas that `
      + 'drew nothing, i.e. the page losing its images rather than losing an effect',
  )
  check(
    at('quad-alloc: the half-built renderer is torn back down rather than left live'),
    nobuf.failed.gl && nobuf.failed.canvas && nobuf.failed.quadBuffer && nobuf.failed.refCount === 0,
    `gl=${nobuf.failed.gl}, canvas=${nobuf.failed.canvas}, quadBuffer=${nobuf.failed.quadBuffer}, `
      + `refCount=${nobuf.failed.refCount}`,
  )
  check(
    at('quad-alloc: and its canvas does not stay in the document'),
    nobuf.failed.canvasesInDoc === 0,
    `canvases=${nobuf.failed.canvasesInDoc} (one per failed attempt is the leak this guards)`,
  )
  check(
    at('quad-alloc: the next activation succeeds — a failed init is a retry, not a death sentence'),
    nobuf.recovered.gl && nobuf.recovered.opacity === '0' && nobuf.recovered.canvasesInDoc === 1,
    `gl=${nobuf.recovered.gl}, opacity=${JSON.stringify(nobuf.recovered.opacity)}, `
      + `canvases=${nobuf.recovered.canvasesInDoc}`,
  )

  await page.evaluate(() => window.kUIAdvanced.getSharedShaderRenderer().release())
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
