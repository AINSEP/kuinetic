import { describe, expect, it } from 'vitest'
import type { EffectParams } from '../../core/types.js'
import { prepareScene } from '../scenes.js'
import { prepareCameraScene } from '../camera-3d.js'
import { createRealPrepareContext } from './prepare-context-fixture.js'

/**
 * Which descendants a host's scan actually claims.
 *
 * `prepareScene` and `prepareCameraScene` each open with a `[data-kui*="…"]` query, and that query
 * is descendant-wide: it does not stop at a nested host of the same kind. So an **outer** scene
 * reached into an **inner** one — `querySelectorAll` only ever returns descendants, so the
 * over-reach can only run outward-in — and both controllers then wrote the inner host's children
 * every frame with different progress values. Listener and rAF order picked the winner, which is
 * to say nothing did.
 *
 * `createAdvancedLedgers` made that survivable on *teardown* by sharing one capture per element.
 * It never arbitrated the writes, because `ledger.set()` writes straight through. `ownedDescendants`
 * is the other half, and this file is what holds it: the rule is that a host claims a descendant
 * only when no nearer host **of the same kind** sits between them.
 *
 * Why it needs its own file rather than a case bolted onto the existing ones: `camera-3d.ts` was at
 * 100% line *and* branch coverage while this was broken. The scan loop was fully covered; which
 * elements it loops over is not a branch. Everything below is written to fail if the scan reverts
 * to the unscoped query — verified by doing exactly that.
 *
 * Reduced motion is the probe throughout. It is the one policy that composes the whole scene
 * synchronously inside `prepare` — `prepareScene` holds progress 1, `prepareCameraScene` calls
 * `renderStatic()` — so "did this host claim that element" is legible as an inline style, with no
 * scroll, no rAF and no window.
 */

/** Neither `prepare` requires a single accessor: every read is optional-chained past a bare object. */
const NO_PARAMS = {} as EffectParams

function stillFrameContext(el: Element | null, warnings: string[] = []) {
  return createRealPrepareContext(el, {
    win: null,
    reducedMotion: true,
    warn: (message: string) => warnings.push(message),
  })
}

function authored(kui?: string): HTMLDivElement {
  const el = document.createElement('div')
  if (kui) el.setAttribute('data-kui', kui)
  return el
}

/** `from:0 to:1` so progress 1 reads straight back out of the assertion. */
const STEP = 'scene-step from:0 to:1 opacity:0->1'

describe('a scene claims only the steps no nearer scene stands between', () => {
  it('leaves a nested scene\'s steps to the nested scene', () => {
    const outer = authored('scene')
    const inner = authored('scene')
    const ownStep = authored(STEP)
    const nestedStep = authored(STEP)
    outer.append(ownStep, inner)
    inner.append(nestedStep)

    const outerInst = prepareScene(outer, NO_PARAMS, stillFrameContext(outer))
    expect(ownStep.style.opacity).toBe('1')
    // The whole finding, in one assertion: before the fix the outer scene wrote here too.
    expect(nestedStep.style.opacity).toBe('')

    // And the inner scene still gets its own. "Nobody claims it" would satisfy the line above.
    const innerInst = prepareScene(inner, NO_PARAMS, stillFrameContext(inner))
    expect(nestedStep.style.opacity).toBe('1')

    outerInst.destroy()
    innerInst.destroy()
  })

  it('reports the empty-window warning for its own steps only', () => {
    /*
     * The style probe above shows what each controller *wrote*; this shows what each one
     * *enumerated*, which is the scan itself with the rendering taken out. `prepareScene` warns
     * once per step whose window never opens, quoting that step's own numbers — so two differently
     * broken windows make the two steps individually identifiable in the warning list.
     */
    const outer = authored('scene')
    const inner = authored('scene')
    const ownStep = authored('scene-step from:0.9 to:0.1')
    const nestedStep = authored('scene-step from:0.8 to:0.2')
    outer.append(ownStep, inner)
    inner.append(nestedStep)

    const warnings: string[] = []
    prepareScene(outer, NO_PARAMS, stillFrameContext(outer, warnings)).destroy()

    expect(warnings).toEqual([
      'scene-step from:0.9 to:0.1 is an empty window — from: must be less than to:, so this step never animates',
    ])
  })

  it('is not blocked by a camera-scene between it and its step', () => {
    /*
     * The canary for "same kind only", and a real supported shape rather than a degenerate one:
     * `ownership.test.ts`'s 'an element that is both a scene step and a camera layer' asserts that
     * this element genuinely keeps two owners. They are different kinds of host, so neither blocks
     * the other, and the element is written by both.
     *
     * A substring host selector — `[data-kui*="scene"]`, or `attr.includes('scene')` — breaks
     * exactly here: `camera-scene` contains `scene`, so the camera would be mistaken for a nearer
     * scene and the outer scene would drop its own step.
     */
    const scene = authored('scene')
    const camera = authored('camera-scene')
    const both = authored('camera-layer z:-100, scene-step from:0 to:1 y:40px->0px')
    scene.append(camera)
    camera.append(both)

    const sceneInst = prepareScene(scene, NO_PARAMS, stillFrameContext(scene))
    expect(both.style.transform).toBe('translateY(0px)')

    const cameraInst = prepareCameraScene(camera, NO_PARAMS, stillFrameContext(camera))
    expect(both.style.transform).toContain('translate3d')

    sceneInst.destroy()
    cameraInst.destroy()
  })

  it('claims a step nested inside another step', () => {
    /*
     * The second way a substring test fails, and the quieter one. A `scene-step` contains the
     * text `scene`, so an ancestor step would read as the nearest scene and the inner step would
     * resolve its owner to an element that is not a scene at all — claimed by nobody, with nothing
     * said. A step inside a step is not exotic authoring; nesting is how a step gets a caption.
     */
    const scene = authored('scene')
    const outerStep = authored(STEP)
    const innerStep = authored(STEP)
    scene.append(outerStep)
    outerStep.append(innerStep)

    const inst = prepareScene(scene, NO_PARAMS, stillFrameContext(scene))
    expect(outerStep.style.opacity).toBe('1')
    expect(innerStep.style.opacity).toBe('1')
    inst.destroy()
  })
})

describe('a camera scene claims only the layers no nearer camera scene stands between', () => {
  it('leaves a nested camera scene\'s layers to the nested camera scene', () => {
    const outer = authored('camera-scene')
    const inner = authored('camera-scene')
    const ownLayer = authored('camera-layer z:40')
    const nestedLayer = authored('camera-layer z:90')
    outer.append(ownLayer, inner)
    inner.append(nestedLayer)

    const outerInst = prepareCameraScene(outer, NO_PARAMS, stillFrameContext(outer))
    expect(ownLayer.style.transform).toContain('translate3d(0, 0, 40px)')
    expect(nestedLayer.style.transform).toBe('')

    const innerInst = prepareCameraScene(inner, NO_PARAMS, stillFrameContext(inner))
    expect(nestedLayer.style.transform).toContain('translate3d(0, 0, 90px)')

    outerInst.destroy()
    innerInst.destroy()
  })

  it('is not blocked by a scene between it and its layer', () => {
    // The mirror of the scene-side canary. `camera-scene` happens not to be a substring of
    // `camera-layer`, so the camera half was luckier than the scene half — but only luckier, and
    // a `scene` sitting between still has to be ignored on purpose.
    const camera = authored('camera-scene')
    const scene = authored('scene')
    const layer = authored('camera-layer z:40')
    camera.append(scene)
    scene.append(layer)

    const inst = prepareCameraScene(camera, NO_PARAMS, stillFrameContext(camera))
    expect(layer.style.transform).toContain('translate3d(0, 0, 40px)')
    inst.destroy()
  })

  it('claims its layers from a host carrying no data-kui at all', () => {
    /*
     * Why the predicate is a parent walk terminating on `node === host`, and not
     * `el.parentElement.closest('[data-kui*="camera-scene"]') === host`.
     *
     * The host does not have to carry the attribute the query would look for. Four cases in
     * `staging.test.ts` and one in `ownership.test.ts` construct exactly this, and so does any
     * effect the Animator applies programmatically rather than from markup — `closest()` returns
     * `null` for all of them and every layer is silently dropped. Identity does not care what the
     * host is labelled.
     */
    const host = document.createElement('div')
    const layer = authored('camera-layer z:40')
    host.append(layer)

    const inst = prepareCameraScene(host, NO_PARAMS, stillFrameContext(host))
    expect(layer.style.transform).toContain('translate3d(0, 0, 40px)')
    inst.destroy()
  })

  it('claims a returned element with no parent chain rather than dropping it', () => {
    /*
     * The degenerate input this tier is actually reached with. `staging.test.ts` hands
     * `prepareCameraScene` a hand-rolled host whose `querySelectorAll` returns objects with no
     * `parentElement` — the walk has to optional-chain or it throws on the first step, and it has
     * to treat "no chain at all" as claimed or the layer vanishes. That test asserts only
     * `toBeDefined()`, so it would report neither.
     *
     * Claiming is also the correct reading rather than a concession: an element `querySelectorAll`
     * returned is by definition a descendant, so in a real tree the walk always arrives at `host`.
     * Running out of parents means there was never a chain to find a nearer host in.
     */
    const orphan = authored('camera-layer z:40')
    const host = {
      style: {},
      querySelectorAll: () => [orphan],
    } as unknown as HTMLElement

    const inst = prepareCameraScene(host, NO_PARAMS, stillFrameContext(null))
    expect(orphan.style.transform).toContain('translate3d(0, 0, 40px)')
    inst.destroy()
  })

  it('walks past an ancestor that is not a real element', () => {
    /*
     * The other half of the degenerate case: not a layer with no parent, but a layer whose parent
     * chain contains something that is not an `Element`. Same origin — a hand-rolled stand-in
     * handed to `prepare` — and the walk reads `data-kui` off every ancestor it passes, so it must
     * neither throw on the missing `getAttribute` nor read the absence as "this blocks the claim".
     */
    const orphan = authored('camera-layer z:40')
    Object.defineProperty(orphan, 'parentElement', {
      value: { nodeName: 'NOT-AN-ELEMENT' },
      configurable: true,
    })
    const host = {
      style: {},
      querySelectorAll: () => [orphan],
    } as unknown as HTMLElement

    const inst = prepareCameraScene(host, NO_PARAMS, stillFrameContext(null))
    expect(orphan.style.transform).toContain('translate3d(0, 0, 40px)')
    inst.destroy()
  })
})
