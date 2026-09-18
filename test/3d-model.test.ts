import { afterEach, describe, expect, it } from 'vitest'
import { createParams, readEffectParams } from '../src/core/js-params.js'
import { createStyleLedger } from '../src/core/owned-styles.js'
import type { EffectParams, PrepareContext } from '../src/core/types.js'
import {
  MODEL_3D_PARAMETERS,
  MODEL_3D_PRIMITIVE,
  prepareModel3D,
  resolveModelOptions,
} from '../src/3d/model-3d.js'
import { clamp, degreesOf } from '../src/3d/angles.js'
import { detectWebGL } from '../src/3d/webgl.js'
import { warnClippingAncestor } from '../src/3d/flattening.js'

/**
 * `model-3d`'s skeleton: everything the tier does except draw.
 *
 * The thing worth stating up front, because it is what these assertions are *for*: a `prepare()`
 * that returned an inert instance would pass a registration test, report 100% coverage, and be a
 * lie — `channels` would name two properties nothing ever wrote. So every test below asks about an
 * observable effect on the document, not about a value coming back out of a function.
 */

/** A window that claims WebGL 2, which jsdom's does not, plus whatever layout the test needs. */
function glWin(getComputedStyle?: (el: Element) => CSSStyleDeclaration | null): Window {
  return {
    WebGL2RenderingContext: class {},
    getComputedStyle: getComputedStyle ?? ((el: Element) => window.getComputedStyle(el)),
  } as unknown as Window
}

/**
 * A `PrepareContext` over one host, plus the two things a test needs to read back out of it: what
 * got warned, and the ledger the animator would own.
 */
function probe(host: Element, over: Partial<PrepareContext> = {}) {
  const warnings: string[] = []
  const style = createStyleLedger(host)
  const ctx = {
    doc: document,
    win: glWin(),
    scheduler: {},
    rootFor: () => ({}),
    capabilities: {},
    invalidate() {},
    warn: (message: string) => warnings.push(message),
    reducedMotion: false,
    signal: new AbortController().signal,
    style,
    ...over,
  } as unknown as PrepareContext
  return { ctx, warnings, style }
}

function host(inner = ''): HTMLElement {
  const el = document.createElement('div')
  el.innerHTML = inner
  document.body.append(el)
  return el
}

/** Parameters as the animator would hand them over: validated, defaulted, never raw. */
function params(authored: Record<string, string>, warn: (m: string) => void = () => {}): EffectParams {
  return readEffectParams(authored, MODEL_3D_PARAMETERS, warn)
}

const GLB = '/models/robot.glb'

afterEach(() => {
  document.body.innerHTML = ''
})

describe('model-3d parameters', () => {
  it('declares exactly the seven the grammar names, with the keyword lists closed', () => {
    expect(Object.keys(MODEL_3D_PARAMETERS)).toEqual([
      'src',
      'spin',
      'axis',
      'tilt',
      'light',
      'target',
      'poster',
    ])
    expect(MODEL_3D_PARAMETERS.axis!.keywords).toEqual(['x', 'y', 'z'])
    expect(MODEL_3D_PARAMETERS.light!.keywords).toEqual(['studio', 'key', 'rim', 'flat'])
    // A keyword parameter with no list accepts nothing at all, so the type demands one. The
    // converse half matters as much: a word list on a value parameter is a compile error.
    expect(MODEL_3D_PARAMETERS.spin!.keywords).toBeUndefined()
    expect(MODEL_3D_PARAMETERS.tilt!.keywords).toBeUndefined()
  })

  it('namespaces every custom property it publishes, because three of the plain names are taken', () => {
    // Not cosmetic. A custom property on a host inherits into its whole subtree: `--kui-tilt` is
    // read by `src/css/carousel.css:77`, so a model containing a carousel would tilt the ring;
    // `--kui-axis` is read by `src/css/text.css:360` as a `font-variation-settings` tag, so
    // `axis:y` would hand every variable-font descendant `font-variation-settings: y 100`; and
    // `--kui-poster` belongs to `effects/catalog/media.ts:325`.
    for (const [name, spec] of Object.entries(MODEL_3D_PARAMETERS)) {
      if (name === 'target') {
        // The one shared spelling, on purpose: `target:` is one convention across the library, and
        // being `text` it is dropped before the stylesheet and can collide with nothing.
        expect(spec.cssProperty).toBe('--kui-target')
      } else {
        expect(spec.cssProperty, `${name} publishes an unnamespaced property`).toMatch(/^--kui-model-/)
      }
    }
  })

  it('reads an angle in any CSS unit, because the numeric reader cannot', () => {
    // `core/js-params.ts`'s `toNumber` returns its *fallback* for any unit but `''`/`%`, so
    // `params.num('spin')` on a validated "360deg" reads back as 0 and the model never turns.
    const el = host()
    const read = (authored: Record<string, string>) =>
      resolveModelOptions(el, params(authored), probe(el).ctx)

    expect(read({ spin: '360deg' }).spinDeg).toBe(360)
    expect(read({ spin: '1turn' }).spinDeg).toBe(360)
    expect(read({ spin: '200grad' }).spinDeg).toBe(180)
    expect(read({ spin: '-90deg' }).spinDeg).toBe(-90)
    expect(read({}).spinDeg).toBe(0)
  })

  it('clamps tilt to the range past which the model is edge-on and the effect is nothing', () => {
    const el = host()
    const read = (tilt: string) => resolveModelOptions(el, params({ tilt }), probe(el).ctx).tiltDeg
    expect(read('30deg')).toBe(30)
    expect(read('200deg')).toBe(80)
    expect(read('-200deg')).toBe(-80)
  })

  it('falls back on a keyword the validator would have rejected, rather than casting it through', () => {
    // `readParams` substitutes the declared default for anything outside `keywords`, so this arm is
    // reachable only by constructing the reader directly — which is exactly what a consumer calling
    // `prepareModel3D` by hand does.
    const el = host()
    const raw = createParams({ axis: 'w', light: 'disco', src: GLB })
    const options = resolveModelOptions(el, raw, probe(el).ctx)
    expect(options.axis).toBe('y')
    expect(options.light).toBe('studio')
  })

  it('carries the authored axis and rig through when they are real', () => {
    const el = host()
    const options = resolveModelOptions(el, params({ axis: 'z', light: 'rim' }), probe(el).ctx)
    expect(options.axis).toBe('z')
    expect(options.light).toBe('rim')
  })
})

describe('model-3d mounting', () => {
  it('inserts a canvas as the host first child and claims the two properties it writes', () => {
    const el = host('<h2>Meet the robot</h2>')
    const { ctx, style } = probe(el)
    prepareModel3D(el, params({ src: GLB }), ctx)

    const canvas = el.firstElementChild as HTMLCanvasElement
    expect(canvas.tagName).toBe('CANVAS')
    expect(canvas.hasAttribute('data-kui-model-canvas')).toBe(true)
    // The render is decoration; the heading and the fallback image carry the meaning.
    expect(canvas.getAttribute('aria-hidden')).toBe('true')
    // First child, so the author's own content follows it in document order as well as paint
    // order — a screen reader meets the heading before the decoration.
    expect(el.children[1]!.tagName).toBe('H2')

    expect(el.style.position).toBe('relative')
    expect(el.style.isolation).toBe('isolate')
    // Declared, not just written. `channels` is what the conflict detector arbitrates on, and a
    // property written but unclaimed is audit finding A2 all over again.
    expect(MODEL_3D_PRIMITIVE.channels).toEqual(['position', 'isolation'])
    expect(style.owned()).toEqual(expect.arrayContaining(['position', 'isolation']))
  })

  it('paints the canvas above the host background and below the host own content', () => {
    // The whole composition claim of the tier, and it takes both halves. `z-index: -1` alone puts
    // the canvas behind the *nearest stacking context*, which without `isolation: isolate` on the
    // host is some ancestor's — so the canvas slides behind the host's background, then behind a
    // section's, then behind `<body>`'s, and disappears. That is the failure the grammar doc's §2
    // rejects the fixed `z-index:-1` canvas for, reproduced one element down.
    const el = host('<h2>Meet the robot</h2>')
    prepareModel3D(el, params({ src: GLB }), probe(el).ctx)

    const canvas = el.firstElementChild as HTMLCanvasElement
    expect(canvas.style.position).toBe('absolute')
    expect(canvas.style.zIndex).toBe('-1')
    expect(el.style.isolation).toBe('isolate')
  })

  it('hides a target: element while the render owns the box', () => {
    const el = host('<img src="/img/robot.jpg" alt="A red toy robot" />')
    const img = el.querySelector('img')!
    prepareModel3D(el, params({ src: GLB, target: 'img' }), probe(el).ctx)

    expect(img.style.display).toBe('none')
    expect(el.querySelector('canvas')).not.toBeNull()
  })

  it('mounts nothing under reduced motion, and leaves the still image standing', () => {
    // The grammar's §4: a spin's end is a camera position, not a design, so reduced motion falls
    // back to a still image and never to the effect's end state.
    const el = host('<img src="/img/robot.jpg" alt="A red toy robot" />')
    const img = el.querySelector('img')!
    prepareModel3D(el, params({ src: GLB, target: 'img' }), probe(el, { reducedMotion: true }).ctx)

    expect(el.querySelector('canvas')).toBeNull()
    expect(img.style.display).toBe('')
    expect(el.style.position).toBe('')
  })

  it('mounts nothing without a src:, whatever else was authored', () => {
    const el = host('<img src="/img/robot.jpg" alt="" />')
    prepareModel3D(el, params({ spin: '360deg', target: 'img' }), probe(el).ctx)
    expect(el.querySelector('canvas')).toBeNull()
    expect(el.querySelector('img')!.style.display).toBe('')
  })

  it('mounts nothing where there is no WebGL 2', () => {
    const el = host()
    // jsdom's own window, which genuinely has no `WebGL2RenderingContext`.
    prepareModel3D(el, params({ src: GLB }), probe(el, { win: window }).ctx)
    expect(el.querySelector('canvas')).toBeNull()
  })

  it('declares the reduced-motion policy that makes the animator refuse to activate it', () => {
    // Load-bearing, not metadata: `disable` is why the still image is mounted in `prepare` at all.
    // If the policy were `shorten`, the animator would activate an instance whose `activate()` is
    // empty and the visitor would get a blank box instead of a photograph.
    expect(MODEL_3D_PRIMITIVE.reducedMotion).toBe('disable')
    expect(MODEL_3D_PRIMITIVE.renderer).toBe('javascript')
  })
})

describe('model-3d fallback resolution', () => {
  it('builds a poster image only when target: named nothing', () => {
    const el = host('<h2>Meet the robot</h2>')
    prepareModel3D(el, params({ src: GLB, poster: '/img/robot.jpg' }), probe(el, { win: window }).ctx)

    const img = el.firstElementChild as HTMLImageElement
    expect(img.tagName).toBe('IMG')
    expect(img.getAttribute('src')).toBe('/img/robot.jpg')
    // Empty, not invented: the library has no idea what the model is, and making alt text up is
    // worse than declaring the image decorative. An author who wants real alt text uses `target:`.
    expect(img.getAttribute('alt')).toBe('')
  })

  it('lets target: win over poster:, and says which one it dropped', () => {
    // Not a new rule: the same call `media-scrub` already made for `src:`/`frames:` versus its own
    // `target:` (`effects/scroll-mechanics/primitives.ts:444`). One has the library build an
    // element, the other points at one already built, so there is no coherent "both" to honour.
    const el = host('<img src="/img/robot.jpg" alt="A red toy robot" />')
    const { ctx, warnings } = probe(el, { win: window })
    const options = resolveModelOptions(el, params({ src: GLB, target: 'img', poster: '/img/other.jpg' }), ctx)

    expect(options.fallbackEl).toBe(el.querySelector('img'))
    expect(options.posterUrl).toBe('')
    expect(warnings.join('\n')).toMatch(/target:"img" and poster:"\/img\/other\.jpg"/)

    // And the observable half: nothing is built, because there was already an element.
    prepareModel3D(el, params({ src: GLB, target: 'img', poster: '/img/other.jpg' }), probe(el, { win: window }).ctx)
    expect(el.querySelectorAll('img')).toHaveLength(1)
    expect(el.querySelector('img')!.getAttribute('src')).toBe('/img/robot.jpg')
  })

  it('says so when target: matched nothing, and lets poster: stand in', () => {
    const el = host('<h2>Meet the robot</h2>')
    const { ctx, warnings } = probe(el, { win: window })
    const options = resolveModelOptions(el, params({ src: GLB, target: '.figure', poster: '/img/robot.jpg' }), ctx)

    expect(options.fallbackEl).toBeNull()
    expect(options.posterUrl).toBe('/img/robot.jpg')
    expect(warnings.join('\n')).toMatch(/target "\.figure" matched no element inside the host/)
  })

  it('refuses a target: that reaches the whole document, through core own resolver', () => {
    const el = host('<img alt="" />')
    const { ctx, warnings } = probe(el, { win: window })
    const options = resolveModelOptions(el, params({ src: GLB, target: 'body' }), ctx)
    expect(options.fallbackEl).toBeNull()
    expect(warnings.join('\n')).toMatch(/matches the whole document/)
  })

  it('renders nothing and leaves the host children alone when neither was authored', () => {
    // The grammar's §4: a 3D model has no meaningful CSS fallback. That is a content requirement
    // on the author, not a library behaviour, and inventing a placeholder would hide it.
    const el = host('<h2>Meet the robot</h2>')
    prepareModel3D(el, params({ src: GLB }), probe(el, { win: window }).ctx)
    expect(el.children).toHaveLength(1)
    expect(el.firstElementChild!.tagName).toBe('H2')
  })
})

describe('model-3d teardown', () => {
  it('removes the canvas and gives the fallback element back byte for byte', () => {
    const el = host('<img src="/img/robot.jpg" alt="A red toy robot" />')
    const before = el.innerHTML
    const instance = prepareModel3D(el, params({ src: GLB, target: 'img' }), probe(el).ctx)

    expect(el.innerHTML).not.toBe(before)
    instance.destroy()
    // Not `display: ''` — the attribute itself. `<img>` and `<img style="">` are different markup,
    // and a teardown sweep reads the difference as a synthetic node left behind.
    expect(el.innerHTML).toBe(before)
  })

  it('leaves the host own properties to the animator, which owns that ledger', () => {
    // `ctx.style` is the host's entry in the animator's `LedgerSet`, shared with every CSS effect
    // on the same div. Restoring it from a primitive would unwind core's writes on a live element
    // — the hazard `advanced/base.ts`'s `foreign` flag exists to describe.
    const el = host()
    const { ctx, style } = probe(el)
    const instance = prepareModel3D(el, params({ src: GLB }), ctx)

    instance.destroy()
    expect(el.style.position).toBe('relative')
    expect(el.style.isolation).toBe('isolate')

    // And the animator's own release does put them back, which is the other half of the claim.
    style.restore()
    expect(el.getAttribute('style')).toBeNull()
  })

  it('removes a poster it built, and nothing it did not', () => {
    const el = host('<h2>Meet the robot</h2>')
    const before = el.innerHTML
    const instance = prepareModel3D(el, params({ src: GLB, poster: '/img/robot.jpg' }), probe(el, { win: window }).ctx)

    expect(el.querySelectorAll('img')).toHaveLength(1)
    instance.destroy()
    expect(el.innerHTML).toBe(before)
  })

  it('is idempotent, because destroy arrives from more than one direction', () => {
    const el = host('<img src="/img/robot.jpg" alt="" style="display:inline-block" />')
    const instance = prepareModel3D(el, params({ src: GLB, target: 'img' }), probe(el).ctx)
    const img = el.querySelector('img')!
    expect(img.style.display).toBe('none')

    instance.destroy()
    // A second unwind over a ledger that already restored would put back *this library's* value —
    // the fallback would come back `display: none` and the visitor would be left with a blank div.
    //
    // Worth being honest about what this does and does not prove. Mutation-checking it showed that
    // nothing in `destroy()` is what holds the property up: deleting its `destroyed` flag changed
    // no test, and so did deleting the `= null` lines. `StyleLedger.restore()` clears its own map
    // and `Element.remove()` no-ops on a detached node, so idempotence is inherited from what is
    // being called. This guards the *contract*, which the renderer chunk will be the first thing
    // able to break — a `gl.deleteProgram()` here is not self-guarding.
    instance.destroy()
    expect(img.style.display).toBe('inline-block')
    expect(el.querySelector('canvas')).toBeNull()
    // Deliberately the property and not `innerHTML` here, unlike the test above: this author wrote
    // a `style` attribute, and jsdom re-serializes one as `display: inline-block;` the moment any
    // CSSOM write touches the element. The value is intact; only the spacing is the DOM's. The
    // byte-for-byte promise is about an element the author left *without* a style attribute, which
    // is the case that leaves `style=""` behind when a ledger gets it wrong.
  })

  it('hands back a lifecycle handle that has started nothing', async () => {
    // `prepare` must only wire things up — the animator decides when, or whether, to activate.
    const el = host()
    const instance = prepareModel3D(el, params({ src: GLB }), probe(el).ctx)
    expect(instance.continuous).toBe(false)
    instance.activate()
    instance.cancel()
    instance.finish()
    expect(el.querySelector('canvas')).not.toBeNull()
    await expect(instance.finished).resolves.toBeUndefined()
    instance.destroy()
  })
})

describe('degreesOf', () => {
  it('converts every angle unit the validator lets through', () => {
    expect(degreesOf('90deg', -1)).toBe(90)
    expect(degreesOf('0.5turn', -1)).toBe(180)
    expect(degreesOf('200grad', -1)).toBe(180)
    expect(degreesOf('3.141592653589793rad', -1)).toBeCloseTo(180, 10)
    expect(degreesOf('45', -1)).toBe(45)
    expect(degreesOf('  -45deg  ', -1)).toBe(-45)
  })

  it('falls back rather than throwing, because it sits behind the validator', () => {
    expect(degreesOf('auto', -1)).toBe(-1)
    expect(degreesOf('', -1)).toBe(-1)
    expect(degreesOf('12px', -1)).toBe(-1)
    // A shape the regex accepts but `Number` cannot: several dots.
    expect(degreesOf('1.2.3deg', -1)).toBe(-1)
  })
})

describe('clamp', () => {
  it('bounds both ends and passes the middle through', () => {
    expect(clamp(5, 0, 10)).toBe(5)
    expect(clamp(-5, 0, 10)).toBe(0)
    expect(clamp(50, 0, 10)).toBe(10)
  })
})

describe('detectWebGL', () => {
  it('answers from presence, and never by requesting a context', () => {
    expect(detectWebGL({ WebGL2RenderingContext: class {} })).toBe(true)
    expect(detectWebGL({})).toBe(false)
    expect(detectWebGL(null)).toBe(false)
    expect(detectWebGL(undefined)).toBe(false)
    // jsdom's own window is the real "no" this runs against in every other test in this file.
    expect(detectWebGL(window)).toBe(false)
  })
})

describe('warnClippingAncestor', () => {
  function styleOf(values: Record<string, string>): CSSStyleDeclaration {
    return { getPropertyValue: (p: string) => values[p] ?? '' } as unknown as CSSStyleDeclaration
  }

  it('names the first ancestor that clips the host, and stops there', () => {
    const outer = host()
    const middle = document.createElement('section')
    const el = document.createElement('div')
    outer.append(middle)
    middle.append(el)

    const warnings: string[] = []
    warnClippingAncestor(el, {
      win: { getComputedStyle: (node: Element) => styleOf(node === middle ? { overflow: 'hidden' } : {}) },
      warn: (m) => warnings.push(m),
    })
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatch(/an ancestor <section> has overflow: hidden/)
  })

  it('catches a clip-path as readily as an overflow', () => {
    const outer = host()
    const el = document.createElement('div')
    outer.append(el)

    const warnings: string[] = []
    warnClippingAncestor(el, {
      win: { getComputedStyle: () => styleOf({ overflow: 'visible', 'clip-path': 'inset(10%)' }) },
      warn: (m) => warnings.push(m),
    })
    expect(warnings[0]).toMatch(/has clip-path: inset\(10%\)/)
  })

  it('says nothing about an ancestor that only dims or blurs the scene', () => {
    // The carousel's copy warns on `opacity`, `filter` and `backdrop-filter` too, because all three
    // defeat `preserve-3d`. None of them clips a canvas: a dimmed 3D hero is a design, not a bug,
    // and firing on it is how a diagnostic teaches people to ignore it.
    const outer = host()
    const el = document.createElement('div')
    outer.append(el)

    const warnings: string[] = []
    warnClippingAncestor(el, {
      win: {
        getComputedStyle: () =>
          styleOf({ overflow: 'visible', 'clip-path': 'none', opacity: '0.5', filter: 'blur(2px)' }),
      },
      warn: (m) => warnings.push(m),
    })
    expect(warnings).toEqual([])
  })

  it('stops at body, so a page-level overflow does not fire on every model ever authored', () => {
    const el = host()
    const warnings: string[] = []
    warnClippingAncestor(el, {
      win: { getComputedStyle: () => styleOf({ overflow: 'hidden' }) },
      warn: (m) => warnings.push(m),
    })
    // `el`'s only ancestor is `<body>` itself, which the walk never inspects.
    expect(warnings).toEqual([])
  })

  it('never throws in a realm with no layout, because a diagnostic must not be the thing that breaks', () => {
    const outer = host()
    const el = document.createElement('div')
    outer.append(el)

    const warnings: string[] = []
    warnClippingAncestor(el, { win: {}, warn: (m) => warnings.push(m) })
    warnClippingAncestor(el, { win: { getComputedStyle: () => null }, warn: (m) => warnings.push(m) })
    expect(warnings).toEqual([])
  })
})
