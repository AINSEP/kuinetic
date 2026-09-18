/**
 * `model-3d` — one div, one glTF model, one canvas.
 *
 * The grammar is `docs/3d-tier-grammar.md`; this file is the half of it that does not draw.
 * It owns the canvas, the host's two claimed properties, the `target:`/`poster:` fallback and the
 * teardown. It imports no renderer, requests no GL context and paints nothing. Everything here is
 * exercisable in jsdom, which is deliberate: a skeleton that stubbed `prepare()` into an inert
 * no-op would make `channels` a lie — declaring properties it never writes — and would prove only
 * that a name registers.
 *
 * ```html
 * <div data-kui="model-3d src:/models/robot.glb spin:360deg light:studio target:img">
 *   <h2>Meet the robot</h2>
 *   <img src="/img/robot.jpg" alt="A red toy robot" />
 * </div>
 * ```
 */

import type {
  EffectInstance,
  EffectParams,
  ParameterSchema,
  PrepareContext,
  Preset,
  Primitive,
} from '../core/types.js'
import type { StyleLedger } from '../core/owned-styles.js'
// Two value imports from core, and both are safe for a tier that has to bundle on its own:
// `owned-styles.ts` has no imports at all, and `target.ts`'s only import is `import type`. Nothing
// transitive follows either of them into `kuinetic.3d.js`. Everything else below is `import type`.
import { createStyleLedger } from '../core/owned-styles.js'
import { queryScoped, resolveTarget } from '../core/target.js'
import type { Registry } from '../core/registry.js'
import type { Animator } from '../core/animator.js'
import { clamp, degreesOf } from './angles.js'
import { warnClippingAncestor } from './flattening.js'
import { detectWebGL } from './webgl.js'
import { registerInto } from './register.js'

/** The effect name, spelled once. It is the authoring contract — a rename breaks every page. */
const EFFECT = 'model-3d'

const AXES = ['x', 'y', 'z'] as const
const LIGHT_RIGS = ['studio', 'key', 'rim', 'flat'] as const

export type ModelAxis = (typeof AXES)[number]
export type LightRig = (typeof LIGHT_RIGS)[number]

/**
 * Past this the model is edge-on and the effect has silently become nothing, so the clamp is a
 * feature rather than a bounds check. Matches the carousel's own ±80deg (`src/css/carousel.css:77`)
 * — and, like the carousel, positive means the camera is **above, looking down**.
 */
const MAX_TILT_DEG = 80

/**
 * Attribute stamped on the canvas this module inserts.
 *
 * A marker, not a hook: teardown finds the canvas through its own field. It exists so that a
 * `document.querySelector` in a test, a devtools search, or a teardown sweep can tell a
 * library-inserted node from an authored one without guessing from the tag name.
 */
const CANVAS_ATTR = 'data-kui-model-canvas'

/**
 * Inline style on the canvas: fill the host, paint above the host's background, below its content.
 *
 * `z-index: -1` is what puts it behind the author's `<h2>`, and it only works because the host is
 * isolated — see {@link HOST_STYLE}. Written directly rather than through a ledger because this
 * element is ours: it did not exist before `prepare()` and does not outlive `destroy()`, so there
 * is nothing of the author's to capture or give back.
 */
const CANVAS_STYLE =
  'position:absolute;inset:0;width:100%;height:100%;display:block;z-index:-1'

/**
 * What the host gets written to it, and therefore what this primitive has to claim as channels.
 *
 * `position: relative` because an absolutely-positioned canvas needs a positioned parent.
 *
 * `isolation: isolate` because without it the canvas's `z-index: -1` is not a library guarantee.
 * A negative z-index paints below everything in its *stacking context*, and if the host is not one,
 * that context is some ancestor's — so the canvas slides behind the host's own background, then
 * behind a section's, then behind `<body>`'s, and disappears. That is exactly the failure the
 * grammar doc's §2 rejects the `z-index:-1` fixed-canvas option for. Isolating the host contains
 * the negative index inside it: the canvas paints above the host's background and below every one
 * of the host's children, on any page, which is the composition §2 asks for. `isolation` is the
 * right property for that rather than a `z-index` or a `transform` on the host, because creating a
 * stacking context is the *only* thing it does — the other two also change layout or painting.
 *
 * **This is one property more than the grammar doc's §3 proposed.** §3 named `['position']`, before
 * anyone had written the canvas's own style. Its rule is what decides it: "declaring the property
 * you write is not optional here."
 */
const HOST_STYLE: readonly [string, string][] = [
  ['position', 'relative'],
  ['isolation', 'isolate'],
]

/** How the fallback element is taken out of the layout while the render owns the box. */
const HIDDEN = 'none'

/**
 * Everything `prepare()` decided, in the form the controller consumes.
 *
 * Split from the controller so the reading of the attribute and the writing to the DOM are two
 * testable halves: a suite can assert what `src:`/`spin:`/`target:` resolved to without a document,
 * and assert what got mounted without re-deriving the parameters.
 */
export interface ModelOptions {
  /** The glTF/GLB URL. Empty means there is nothing to render, whatever else was authored. */
  src: string
  /** Total turn across the element's scroll pass, in degrees. Not a rate. */
  spinDeg: number
  axis: ModelAxis
  /** Camera elevation in degrees, clamped to ±{@link MAX_TILT_DEG}. Positive is above. */
  tiltDeg: number
  light: LightRig
  /**
   * The element `target:` named, already inside the host. Shown when nothing renders, hidden when
   * something does. The library never creates this one.
   */
  fallbackEl: Element | null
  /** A still-image URL. Used only when `target:` named nothing — see the grammar doc's §4. */
  posterUrl: string
  /** Whether to mount a canvas at all. False under reduced motion, no WebGL, or no `src:`. */
  render: boolean
}

/**
 * Read one authored keyword, falling back when it is not in the list.
 *
 * `readParams` has already rejected anything outside `keywords` and substituted the declared
 * default, so the fallback arm is reachable only through direct construction. It is still here
 * rather than a cast, because a cast would make an unchecked string a `ModelAxis` and the compiler
 * would stop asking.
 *
 * @complexity O(n) in the list's length — three or four entries.
 */
function keywordOf<T extends string>(value: string, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly string[]).includes(value) ? (value as T) : fallback
}

/**
 * Which element the no-WebGL / reduced-motion path shows, and whether a poster survives beside it.
 *
 * `target:` wins over `poster:` when both resolve, and it is not a new rule — it is the call this
 * codebase already made for `media-scrub`'s `src:`/`frames:` versus its `target:`
 * (`effects/scroll-mechanics/primitives.ts:444`): one has the library build an element, the other
 * points at one already built, so there is no coherent "both" to honour, and silently building an
 * image while the author wrote a selector is the more surprising of the two.
 *
 * A `target:` that matched nothing is not the same as no `target:` at all — it is a typo — so it
 * says so and then lets `poster:` stand in rather than showing the visitor nothing.
 *
 * @complexity O(n) in matches; the query is the DOM's.
 */
function resolveFallback(
  el: Element,
  params: EffectParams,
  ctx: PrepareContext,
): { fallbackEl: Element | null; posterUrl: string } {
  const posterUrl = params.text('poster')
  const selector = resolveTarget(params.text('target'), ctx, EFFECT)
  if (!selector) return { fallbackEl: null, posterUrl }

  const fallbackEl = queryScoped(el, ctx, selector, 'self')[0] ?? null
  if (!fallbackEl) {
    ctx.warn(`${EFFECT} target "${selector}" matched no element inside the host`)
    return { fallbackEl: null, posterUrl }
  }
  if (posterUrl) {
    ctx.warn(
      `${EFFECT} has both target:"${selector}" and poster:"${posterUrl}" — target: names an ` +
        'element that already exists and wins; poster: is ignored',
    )
  }
  return { fallbackEl, posterUrl: '' }
}

/**
 * Turn the validated attribute into the decisions the controller acts on.
 *
 * `render` is the whole point of the function: three unrelated reasons collapse into one boolean,
 * so the controller has one branch instead of three and every caller agrees on what "nothing is
 * going to draw" means. Nothing renders without a `src:`, nothing renders under reduced motion
 * (the grammar's §4 — a spin's end is a camera position, not a design, so the fallback is a still
 * image and never the end state), and nothing renders without WebGL 2.
 *
 * @complexity O(n) in matches for the `target:` query; O(1) otherwise.
 */
export function resolveModelOptions(
  el: Element,
  params: EffectParams,
  ctx: PrepareContext,
): ModelOptions {
  const src = params.text('src')
  return {
    src,
    spinDeg: degreesOf(params.text('spin'), 0),
    axis: keywordOf(params.text('axis'), AXES, 'y'),
    tiltDeg: clamp(degreesOf(params.text('tilt'), 0), -MAX_TILT_DEG, MAX_TILT_DEG),
    light: keywordOf(params.text('light'), LIGHT_RIGS, 'studio'),
    ...resolveFallback(el, params, ctx),
    render: Boolean(src) && !ctx.reducedMotion && detectWebGL(ctx.win),
  }
}

/**
 * The mounted scene: a canvas, the host's two properties, and whichever still image stands in.
 *
 * **It does not reuse `createAdvancedLedgers`.** That helper exists to share one capture across
 * controllers that write to elements they merely *found* — a `camera-layer` under a `camera-scene`
 * — and it carries a known open defect for exactly the case this tier is: it decides an element's
 * `foreign` flag once, at first open, caches it in a module-level `WeakMap` (`advanced/base.ts:193`)
 * and then skips the restore for anything flagged foreign (`base.ts:233`), so a second controller
 * arriving later has its own `hostLedger` silently ignored and a written property can outlive every
 * animator that wrote it. This tier does not need any of that. It writes to at most two elements
 * and its ledgers are per-instance, so there is no cache to go stale:
 *
 * - **The host** is written through `ctx.style`, which *is* the host's entry in the animator's own
 *   `LedgerSet` — adopting it is what makes `model-3d` and a `fade-up` on the same div share one
 *   capture instead of snapshotting each other. It is deliberately **not** restored here:
 *   `animator.ts`'s `release()` owns that ledger, and restoring it from a primitive would unwind
 *   core's writes while the element is still live.
 * - **The `target:` element** gets a ledger of this controller's own, restored on `destroy()`,
 *   because nothing else will. Core's `LedgerSet` only covers elements *core* retargeted; a
 *   per-primitive `target:` parameter never goes through that path, so `ctx` cannot hand one over.
 */
class ModelController {
  private readonly el: HTMLElement
  private readonly doc: Document
  private readonly options: ModelOptions
  /** The animator's ledger for the host. Written through, never restored from here. */
  private readonly hostLedger: StyleLedger
  private canvas: HTMLCanvasElement | null = null
  private fallbackLedger: StyleLedger | null = null
  private poster: HTMLImageElement | null = null

  constructor(el: Element, options: ModelOptions, ctx: PrepareContext) {
    this.el = el as HTMLElement
    this.doc = ctx.doc
    this.options = options
    this.hostLedger = ctx.style
  }

  /**
   * Put the scene — or the still image standing in for it — into the document.
   *
   * @complexity O(1).
   */
  mount(): void {
    if (this.options.render) this.mountCanvas()
    else this.showFallback()
  }

  /**
   * Insert the canvas as the host's first child and claim the host's two properties.
   *
   * First child, not appended, so the author's own content follows it in document order as well as
   * in paint order — a screen reader meets the heading before the decoration, and the DOM reads the
   * way the page looks.
   */
  private mountCanvas(): void {
    const canvas = this.doc.createElement('canvas')
    canvas.setAttribute(CANVAS_ATTR, '')
    // The render is decoration; `target:`/`poster:` and the host's own children carry the meaning.
    canvas.setAttribute('aria-hidden', 'true')
    canvas.setAttribute('style', CANVAS_STYLE)
    for (const [property, value] of HOST_STYLE) this.hostLedger.set(property, value)
    this.el.insertBefore(canvas, this.el.firstChild)
    this.canvas = canvas
    this.hideFallback()
  }

  /**
   * Take the author's own image out of the layout, because something is about to draw over it.
   *
   * Through a ledger of this controller's own, so `destroy()` gives back whatever `display` the
   * author had — which is very often no inline `display` at all, and a ledger is the only thing
   * that knows the difference between restoring `''` and removing the property.
   */
  private hideFallback(): void {
    const el = this.options.fallbackEl
    if (!el) return
    this.fallbackLedger = createStyleLedger(el)
    this.fallbackLedger.set('display', HIDDEN)
  }

  /**
   * Show the still image, for the reduced-motion and no-WebGL paths.
   *
   * A `target:` element is already visible and already right — `srcset`, `loading`, real `alt` text
   * — so the whole job is to leave it alone. Only `poster:` has anything to do, and only because
   * the author had no element to point at and asked for one to be made.
   */
  private showFallback(): void {
    if (this.options.fallbackEl || !this.options.posterUrl) return
    const img = this.doc.createElement('img')
    img.setAttribute('src', this.options.posterUrl)
    // Empty, not descriptive: the library has no idea what the model is, and inventing alt text is
    // worse than declaring the image decorative. An author who wants real alt text writes an
    // `<img>` and points `target:` at it, which is why that spelling is the preferred one.
    img.setAttribute('alt', '')
    img.setAttribute(CANVAS_ATTR, '')
    this.el.insertBefore(img, this.el.firstChild)
    this.poster = img
  }

  /**
   * Give back everything this instance owns.
   *
   * Idempotent, because `destroy()` arrives from more than one direction — the animator's
   * `release()`, a recompile, and a consumer calling it directly — and unwinding twice would
   * restore the fallback element to a value this controller had already put back, leaving the
   * author's image at `display: none` and the visitor with a blank div.
   *
   * **Nothing in this method is what makes it idempotent, and that is worth knowing before you add
   * to it.** A `destroyed` flag stood here first; deleting it changed no test. So did dropping the
   * `= null` lines below; that changed no test either. The property comes entirely from what is
   * being called: `StyleLedger.restore()` clears its own map, so a second call restores an empty
   * set, and `Element.remove()` on a node with no parent is a no-op. Both were found by mutation,
   * not by reading — which is the point, because the moment this method starts releasing something
   * that is *not* self-guarding (a GL context, a program, a `requestAnimationFrame` handle) it
   * stops being idempotent silently, and the guard has to come back with a test that can tell.
   *
   * **Why this does not restore the two properties it wrote to the host.** That is the first
   * question this method gets asked, and the answer is that they are not this instance's to give
   * back. `position` and `isolation` went through `ctx.style`, which is the host's entry in the
   * *animator's* `LedgerSet` — deliberately, because sharing that one capture is what stops
   * `model-3d` and a `fade-up` on the same div from snapshotting each other's frame values as the
   * author's. `animator.ts`'s `release()` owns restoring it, and it restores every property in it,
   * including whatever a co-located CSS effect wrote. Calling `restore()` from here would therefore
   * unwind core's writes on an element that is still live — which is precisely the hazard
   * `advanced/base.ts`'s `foreign` flag exists to describe, and the reason this tier does not reuse
   * `createAdvancedLedgers` at all. The rule is narrower than "restore everything": give back
   * everything **this instance owns**, and nothing it merely borrowed.
   *
   * The `target:` element is the other half of that rule and goes the other way — its ledger is this
   * controller's own, nobody else will restore it, so it is restored here.
   *
   * @complexity O(p) in properties written, once.
   */
  destroy(): void {
    this.canvas?.remove()
    this.canvas = null
    this.poster?.remove()
    this.poster = null
    this.fallbackLedger?.restore()
    this.fallbackLedger = null
  }
}

/**
 * The lifecycle handle `prepare()` hands back.
 *
 * Inert in shape and real in teardown, which is the honest declaration while there is no renderer:
 * `activate()` is where the frame loop will start, and it does nothing because there is nothing to
 * start. `continuous: false` with an already-resolved `finished` is the same pair
 * `advanced/base.ts`'s `createInertInstance` uses, and for the same reason — an effect that never
 * runs has already finished. The renderer chunk turns `continuous` on and gives `activate`/`cancel`
 * bodies; nothing else here changes.
 *
 * @complexity O(1).
 */
function createModelInstance(controller: ModelController): EffectInstance {
  return {
    continuous: false,
    activate() {},
    cancel() {},
    finish() {},
    finished: Promise.resolve(),
    destroy() {
      controller.destroy()
    },
  }
}

/**
 * Wire up one `model-3d` host.
 *
 * `ctx` is required, unlike `camera-3d.ts`'s `prepareCameraScene`, which takes it optional to be
 * defensive about direct construction. `Primitive.prepare`'s own signature already says the
 * animator passes a real one, and every `ctx?.` arm underneath an optional parameter is a branch
 * that only a test can reach — under this repo's 100% branch threshold that is a branch written to
 * be covered rather than to be right. A suite constructs a context object instead.
 *
 * @param el - The authored host.
 * @param params - Validated parameters; a primitive never sees a raw author string.
 * @param ctx - The prepare context, for the document, the host's ledger, and the warning sink.
 * @returns A lifecycle handle. Nothing has started — the animator decides when.
 * @complexity O(d) in tree depth for the clipping diagnostic; O(1) otherwise.
 */
export function prepareModel3D(
  el: Element,
  params: EffectParams,
  ctx: PrepareContext,
): EffectInstance {
  const options = resolveModelOptions(el, params, ctx)
  // Only worth saying when something is going to draw. A still image is clipped by the same
  // ancestor, but "your picture is cropped" is a thing an author can see; "the 3D does nothing"
  // is the symptom that points at the wrong element.
  if (options.render) warnClippingAncestor(el, ctx)
  const controller = new ModelController(el, options, ctx)
  controller.mount()
  return createModelInstance(controller)
}

/**
 * `model-3d`'s parameters.
 *
 * Every custom property is namespaced `--kui-model-*`, and that is not tidiness. A custom property
 * published on a host inherits into its entire subtree, and three of these names are already taken:
 * `--kui-tilt` is read by `src/css/carousel.css:77`, so a model containing a carousel would tilt
 * the ring; `--kui-axis` is read by `src/css/text.css:360` as a `font-variation-settings` tag, so
 * `axis:y` would hand every variable-font descendant `font-variation-settings: y 100`; and
 * `--kui-poster` belongs to `effects/catalog/media.ts:325`. `--kui-progress` was lost this way once
 * already. `target:` keeps the shared `--kui-target` spelling on purpose — it is one convention
 * across the library (`advanced/audio.ts:828`, `scroll-mechanics/primitives.ts:727`) and, being
 * `text`, it is dropped before the stylesheet and can collide with nothing.
 */
export const MODEL_3D_PARAMETERS: ParameterSchema = {
  /**
   * The glTF/GLB URL. `text` is correct and honest about itself: it validates nothing, is consumed
   * only by JS, and `resolveParams` drops it before the stylesheet. A URL is the case that names.
   */
  src: { type: 'text', default: '', cssProperty: '--kui-model-src' },
  /**
   * **Total** turn across the element's scroll pass, not a rate: `spin:360deg` is one full turn
   * from entering to leaving. A real CSS unit, so it obeys the standing rule that normalised
   * scalar ranges are ruled out.
   */
  spin: { type: 'angle', default: '0deg', cssProperty: '--kui-model-spin' },
  axis: { type: 'keyword', default: 'y', keywords: AXES, cssProperty: '--kui-model-axis' },
  /** Camera elevation. Positive is above, looking down — the carousel's exact convention. */
  tilt: { type: 'angle', default: '0deg', cssProperty: '--kui-model-tilt' },
  /**
   * Named rigs, not coordinates. A designer says "studio lighting"; nobody hand-places three
   * lights in an HTML attribute.
   */
  light: {
    type: 'keyword',
    default: 'studio',
    keywords: LIGHT_RIGS,
    cssProperty: '--kui-model-light',
  },
  /** Names an element already inside the host to use as the fallback. The preferred spelling. */
  target: { type: 'text', default: '', cssProperty: '--kui-target' },
  /** Still-image URL, for an author with no element to point at. See {@link resolveFallback}. */
  poster: { type: 'text', default: '', cssProperty: '--kui-model-poster' },
}

/**
 * The primitive.
 *
 * `channels` names both properties this writes to the host — see {@link HOST_STYLE} for why there
 * are two. It deliberately does *not* name `display`, which goes to a `target:`-named descendant
 * and never to the host: `findConflicts` (`core/channels.ts:223`) groups claims per compiled host
 * element, so declaring it would make `model-3d` falsely conflict with any host-level effect that
 * claims `display`, over a write that never lands on the host.
 *
 * `reducedMotion: 'disable'` is what makes the animator refuse to activate this instance, and the
 * still image is therefore mounted in `prepare` precisely because nothing else runs — the same
 * arrangement `camera-scene` and `shaders` use.
 */
export const MODEL_3D_PRIMITIVE: Primitive = {
  id: EFFECT,
  renderer: 'javascript',
  channels: HOST_STYLE.map(([property]) => property),
  parameters: MODEL_3D_PARAMETERS,
  // `view` first, and it is the one that matches the spec: §1 defines `spin` as a *total* turn
  // across the element's scroll pass — entering the viewport to leaving it — which is what a view
  // timeline measures, not what a scroll timeline does. Provisional until something actually
  // animates, and the renderer chunk owes honouring it; widening this list later is safe, but
  // discovering that the doc and the declaration disagreed is not.
  supportedTimelines: ['view', 'scroll', 'time'],
  supportedActivations: ['load', 'enter'],
  defaultActivation: 'load',
  perfClass: 'continuous',
  reducedMotion: 'disable',
  prepare: prepareModel3D,
}

export const MODEL_3D_PRIMITIVES: Primitive[] = [MODEL_3D_PRIMITIVE]

export const MODEL_3D_PRESETS: Preset[] = [{ name: EFFECT, primitive: EFFECT }]

/**
 * Register `model-3d` onto a `Registry`, an `Animator`, or anything carrying either shape.
 *
 * @complexity O(1).
 */
export function registerModel3D(target: unknown): Registry | Animator {
  return registerInto(target, MODEL_3D_PRIMITIVES, MODEL_3D_PRESETS, 'Model3D')
}
