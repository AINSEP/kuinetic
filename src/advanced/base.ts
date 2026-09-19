// Created by Gemini 3.8 Flash
/**
 * Shared primitives and runtime utilities for kUInetic Advanced Modules.
 */

import type { EffectInstance, PrepareContext, Preset, Primitive } from '../core/types.js'
import type { StyleLedger } from '../core/owned-styles.js'
// The one value this tier imports from core, and the one core module that therefore lands inside
// `dist/kuinetic.advanced.js`. `owned-styles.ts` has no imports of its own, and `createStyleClaim`
// is deliberately absent from `src/core/index.ts`'s barrel, so sharing it across the two bundles
// would mean widening core's public API to save well under a kilobyte. Leave it inlined: the two
// bundles get a copy of the *code* each, and they still share one capture per element, because the
// registry those copies read lives on the element under a `Symbol.for` key rather than in either
// copy's module scope. Everything else here is `import type`, which is what keeps the rest of core
// out — see `asRegistry`.
import { createStyleClaim } from '../core/owned-styles.js'
import type { Registry } from '../core/registry.js'
import type { Animator } from '../core/animator.js'

export interface WindowLike {
  innerWidth?: number
  innerHeight?: number
  devicePixelRatio?: number
  performance?: { now?: () => number }
  addEventListener?: (type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) => void
  removeEventListener?: (type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions) => void
  requestAnimationFrame?: (fn: FrameRequestCallback) => number
  cancelAnimationFrame?: (id: number) => void
  getComputedStyle?: (el: Element) => CSSStyleDeclaration
}

export interface DocumentLike {
  body?: { appendChild?: (node: unknown) => unknown } | null
  createElement?: (tagName: string) => unknown
}

export type AnyWindow = Window | WindowLike | null
export type AnyDocument = Document | DocumentLike | null

export type RafFunction = (fn: FrameRequestCallback) => number | null
export type CafFunction = (id: number | null) => void | null

export interface AdvancedEnv {
  window?: AnyWindow
  document?: AnyDocument
  createCanvas?: () => HTMLCanvasElement | null
  raf?: RafFunction
  caf?: CafFunction
}

export interface ResolvedEnv {
  window: AnyWindow
  document: AnyDocument
  createCanvas: () => HTMLCanvasElement | null
  raf: RafFunction
  caf: CafFunction
}

export interface EffectInstanceOptions {
  continuous?: boolean
  activate?: () => void
  cancel?: () => void
  finish?: () => void
  destroy?: () => void
}

export function clamp(val: number, min: number, max: number): number {
  return Math.min(Math.max(val, min), max)
}

/**
 * Anything that can hand back one element's inline-style ledger.
 *
 * Deliberately narrower than `LedgerSet`: core's set (`createLedgerSet`) and this directory's
 * shared registry (`createAdvancedLedgers`) both satisfy it, so `styleOf` is one guard for both
 * and a module can be moved from one to the other without touching a single write site.
 */
export interface ElementLedgers {
  style(el: Element): StyleLedger
}

/**
 * This element's owned-write ledger, or `null` when the object cannot carry one.
 *
 * Every module here manages the author's inline styles through `core/owned-styles.ts` rather than
 * a snapshot of its own, and the reason is timing: `style(el)` builds that element's ledger the
 * first time it is *asked for*, and the ledger records a property's prior value the first time
 * that property is *written*. Asking at the write site is therefore the same thing as "capture
 * immediately before the first write", which is the invariant five rounds of review kept finding
 * broken — a snapshot taken at construction or preparation, restored much later over an author
 * value that had changed in between.
 *
 * The guard exists because `createStyleLedger` reads `hasAttribute('style')` the moment it is
 * built, and these controllers are constructed directly rather than by the animator: `prepare`
 * hands them whatever element the author wrote the attribute on, and the suites hand them `null`,
 * `{}`, and `{ getAttribute: () => null }` to exercise the degenerate paths. One check here beats
 * the same two clauses repeated at every write site.
 *
 * @param ledgers - The controller's ledger source, opened over its host element.
 * @param el - The element about to be written to.
 * @returns Its memoised ledger, or `null` when there is nothing to write to.
 * @complexity O(1).
 */
export function styleOf(ledgers: ElementLedgers, el: Element | null | undefined): StyleLedger | null {
  if (!el || typeof el.hasAttribute !== 'function') return null
  if (!(el as HTMLElement).style) return null
  return ledgers.style(el)
}

/**
 * A controller's claim on the shared per-element ledgers.
 *
 * `style` is not guarded — go through {@link styleOf}, which is the one place the "can this object
 * carry a ledger at all" question is answered.
 */
export interface AdvancedLedgers {
  /** This element's shared ledger, created on first ask by anyone. */
  style(el: Element): StyleLedger
  /**
   * Give up this controller's claim on every element it wrote to, restoring each one that no other
   * controller still holds.
   *
   * Every element is attempted. One that throws on the way out does not cost the ones after it; the
   * failures are re-thrown together as an `AggregateError` once the sweep is complete.
   */
  restore(): void
  /** Elements this controller has asked for. Diagnostics and leak assertions. */
  elements(): Element[]
}

/**
 * Open one controller's claim on the shared, ref-counted per-element ledgers.
 *
 * The registry itself lives in `core/owned-styles.ts` ({@link createStyleClaim}), and that is not
 * an implementation detail — it is the fix. This tier used to keep a `WeakMap` of its own, holding
 * one animator's private ledger on behalf of everybody, with a per-entry `foreign` flag deciding
 * whether the entry was ever restored. Both halves were decided *once*, by whichever controller
 * arrived first: a second controller's own `hostLedger` was silently ignored, and anything the
 * first controller flagged foreign was never restored by this path at all, so a property written
 * by a controller that outlived the animator outlived every restore that would have unwound it.
 *
 * Ref-counting removes the flag rather than fixing it. Core's `LedgerSet` is now an owner in the
 * same registry, so "the animator will restore this one" is no longer a special case a boolean has
 * to remember — it is simply another claim, and the element is unwound by whichever owner lets go
 * last, controller or animator.
 *
 * There is also no `hostLedger` parameter any more, and its absence is the point. It existed
 * because this tier ships as its own bundle with its own copy of `owned-styles.ts`, so the
 * animator's ledger for the host had to be *handed over* to be shared. That made sharing opt-in at
 * the call site and left two ways to open a capture. The registry now lives on the element itself,
 * under a `Symbol.for` key both bundles compute identically, so a controller and the animator find
 * the same entry by asking — and the only way to open a capture is to ask.
 *
 * What this tier still needs the registry *for* is what it always did. These controllers write to
 * elements they merely **found** — a `camera-layer` under a `camera-scene`, a `scene-step` under a
 * `scene` — and one found element can belong to two controllers. {@link ownedDescendants} removed
 * the *same-kind* half of that overlap; the cross-kind half is a supported authoring shape (an
 * element authored `camera-layer z:-100, scene-step from:0 to:1` genuinely has a camera and a scene
 * writing to it), and a controller constructed directly rather than through `prepare` never went
 * through the scan at all. Both still need one capture between them.
 *
 * @param host - The authored element this controller was prepared on. Released last, for the
 *   reason `createLedgerSet` documents: the host carries `data-kui-state`, which is the cloak
 *   layer's release key, so it must not become visible before the subtree under it is back to the
 *   author's markup.
 * @complexity O(1) per lookup; O(n) space and O(n) time to restore, in elements written to.
 */
export function createAdvancedLedgers(host: Element): AdvancedLedgers {
  const claim = createStyleClaim()

  return {
    style: (el) => claim.style(el),
    /*
     * One element's teardown must not cost the rest of the subtree's.
     *
     * This loop is the *only* thing that ever gives a found element back — a `camera-layer`, a
     * `scene-step` — because nothing else holds a claim on it. `createStyleLedger.restore()` ends
     * in `removeProperty`/`setProperty`/`removeAttribute` calls straight against the author's
     * element, and any of those can throw on a page that patched the CSSOM, froze a node, or runs a
     * `MutationObserver` that throws in the same task. An unguarded loop therefore turned one such
     * element into *every element after it in the claim set*, host included, keeping this library's
     * inline transforms permanently: `openClaimBook.leave` drops the claim before the restore that
     * threw, so those elements were never coming back — no later owner can be the last one out of
     * an entry the failed sweep already deleted, and `createEffectInstance.destroy()` latches
     * `isDestroyed` before `opts.destroy()`, so a second `destroy()` cannot retry either.
     *
     * The failures are collected rather than swallowed: `destroy()` throwing is contained upstream
     * (`js-effect-preparer.ts` warns and moves on; the animator's `runQuietly` swallows), and an
     * element the library genuinely could not hand back is worth saying so about. Aggregated so the
     * first failure does not hide the fifth.
     */
    restore() {
      const failures: unknown[] = []
      const release = (el: Element): void => {
        try {
          claim.release(el)
        } catch (error) {
          failures.push(error)
        }
      }
      for (const el of claim.elements()) {
        if (el !== host) release(el)
      }
      release(host)
      if (failures.length > 0) {
        throw new AggregateError(
          failures,
          `kuinetic: ${failures.length} element(s) could not be given back`,
        )
      }
    },
    elements: () => claim.elements(),
  }
}

/**
 * One compiled matcher per effect name. The names are literals at the two {@link ownedDescendants}
 * call sites — `scene`/`scene-step` and `camera-scene`/`camera-layer` — so the map has exactly four
 * entries in practice and never grows with the document.
 */
const effectNamePatterns = new Map<string, RegExp>()

/**
 * Match `name` where the `data-kui` grammar allows an *effect name*: first token of a
 * comma-separated segment.
 *
 * `parse.ts` is the definition — `parse` splits the attribute on top-level commas and
 * `parseSegment` takes the first space-separated token of each segment as the effect name. This
 * mirrors that rule rather than importing it, because a value import from `src/core/parse.ts`
 * would drag the transitively-reachable core graph into this bundle; see `asRegistry` and the
 * 45.6 KB → 17.4 KB gzip figure it records. Two lines of duplication against 28 KB of bundle.
 *
 * What the anchors buy, and the whole reason this is not `attr.includes(name)`:
 * - `camera-scene` does **not** match `scene` — the `-` before it is neither `^` nor `,` — so a
 *   nested camera scene cannot block an outer scene from claiming its own steps.
 * - `scene-step` does **not** match `scene` — the `-` after it is neither whitespace, `,` nor end
 *   — so a step nested in another step is not silently orphaned onto the outer step.
 * - `delay:scene` does not match: a parameter value is not an effect name.
 *
 * Not quote-aware, unlike `splitTopLevel`: a comma inside a quoted parameter value (`target:"a,
 * scene b"`) is data there and syntax here, so such an attribute could read as declaring an
 * effect it does not. It costs a false *block* on an element that both sits between a host and
 * its descendant and quotes a comma followed by a host name — at which point the descendant is
 * left unclaimed rather than claimed twice, i.e. it fails toward the safer half.
 *
 * @complexity O(n) time in attribute length, amortised O(1) to compile.
 */
function effectNamePattern(name: string): RegExp {
  let pattern = effectNamePatterns.get(name)
  if (!pattern) {
    pattern = new RegExp(String.raw`(?:^|,)\s*${name}(?=[\s,]|$)`)
    effectNamePatterns.set(name, pattern)
  }
  return pattern
}

/**
 * Does this element's authored `data-kui` name the effect `name`?
 *
 * Guarded rather than assumed: this runs over arbitrary ancestors and over whatever a host's
 * `querySelectorAll` handed back, and the suites reach this tier with `{} as HTMLElement` and with
 * hand-rolled stand-ins carrying nothing but `getAttribute`.
 *
 * @complexity O(n) in attribute length.
 */
function declaresEffect(el: Element, name: string): boolean {
  if (typeof el.getAttribute !== 'function') return false
  const attr = el.getAttribute('data-kui')
  return Boolean(attr) && effectNamePattern(name).test(attr!)
}

/**
 * Is `host` the nearest enclosing host *of its own kind* above `el`?
 *
 * A parent walk, terminating on `node === host` — deliberately not
 * `el.parentElement.closest(sel) === host`. Two reasons, and both have tests standing on them:
 *
 * - `closest()` needs the host to carry a matching attribute, and the host frequently carries no
 *   `data-kui` at all. Five existing cases construct one that way (four in `staging.test.ts`
 *   around `prepareCameraScene`, one in `ownership.test.ts`'s 'activate, cancel, re-activate and
 *   destroy'), and every layer under them would be dropped. The same is true of any effect the
 *   Animator applies programmatically rather than from markup. Identity does not care.
 * - Termination on identity also means the walk cannot be confused by what the host *does* carry.
 *
 * The chain running out before reaching `host` is the degenerate case, not a real one: a node
 * `querySelectorAll` returned is by definition a descendant, so in a real tree the walk always
 * arrives. The suites pass objects with no `parentElement` at all, and those are claimed — with no
 * chain to inspect there is no nearer host to find.
 *
 * @complexity O(d) in depth between `el` and `host`.
 */
function isNearestHostOfKind(host: Element, el: Element, hostEffect: string): boolean {
  let node = el?.parentElement
  while (node && node !== host) {
    if (declaresEffect(node, hostEffect)) return false
    node = node.parentElement
  }
  return true
}

/**
 * The descendants carrying `descendantEffect` that `host` actually owns.
 *
 * > A host claims a descendant only when no nearer host **of the same kind** sits between them.
 *
 * `prepareScene` and `prepareCameraScene` used the raw `[data-kui*="…"]` query, which is
 * descendant-wide and does not stop at a nested host — so an **outer** host over-reached into an
 * inner one and both controllers wrote the inner host's children every frame, with different
 * progress values. Listener and rAF order decided which write survived, which is to say nothing
 * decided it. {@link createAdvancedLedgers} made that survivable on *teardown* by sharing one
 * capture per element; it never arbitrated the writes themselves, because `ledger.set()` writes
 * straight through. This is the other half.
 *
 * "Of the same kind" is load-bearing and is not a tidy-up of the rule. An element authored
 * `camera-layer z:-100, scene-step from:0 to:1` under a `camera-scene` under a `scene` genuinely
 * has two owners afterwards — a scene and a camera, writing different properties for different
 * reasons — and `ownership.test.ts`'s 'an element that is both a scene step and a camera layer'
 * is the standing proof that it still does.
 *
 * The `*=` query is a native prefilter and nothing else, so both halves of the rule are predicates
 * run over what it returned: the candidate must itself *declare* `descendantEffect`, and no nearer
 * host of `hostEffect`'s kind may stand between it and `host`. The first half is not redundant with
 * the query. `[data-kui*="camera-layer"]` matches any attribute *containing* that text, which
 * includes a parameter value — `<img data-kui='fade-up target:".camera-layer"'>` merely names the
 * class it animates, and the scan used to claim it and write `preserve-3d` and a `translate3d` over
 * the author's own effect. {@link declaresEffect} is the same name test the parent walk already
 * uses, applied to the element the walk is about.
 *
 * The cost stays O(matched descendants × depth), not a walk of the subtree.
 *
 * @param host - The authored element the controller was prepared on.
 * @param hostEffect - The host's own primitive name, e.g. `scene`. A nearer element declaring it
 *   is what blocks the claim.
 * @param descendantEffect - The primitive name to collect, e.g. `scene-step`.
 * @returns The owned descendants, in document order. Empty when `host` cannot be queried.
 */
export function ownedDescendants<T extends Element>(
  host: Element,
  hostEffect: string,
  descendantEffect: string,
): T[] {
  if (typeof host.querySelectorAll !== 'function') return []
  const owned: T[] = []
  for (const el of host.querySelectorAll<T>(`[data-kui*="${descendantEffect}"]`)) {
    if (declaresEffect(el, descendantEffect) && isNearestHostOfKind(host, el, hostEffect)) owned.push(el)
  }
  return owned
}

export function lerp(start: number, end: number, progress: number): number {
  return start + (end - start) * progress
}

export function defaultRaf(win: Window | WindowLike | null | undefined, fn: FrameRequestCallback): number | null {
  if (win && typeof win.requestAnimationFrame === 'function') {
    return win.requestAnimationFrame(fn)
  }
  return null
}

export function defaultCaf(win: Window | WindowLike | null | undefined, id: number | null | undefined): null {
  if (win && typeof win.cancelAnimationFrame === 'function' && id != null) {
    win.cancelAnimationFrame(id)
  }
  return null
}

interface ContextWithEnv {
  win?: AnyWindow
  doc?: AnyDocument
  reducedMotion?: boolean | { enabled?: boolean }
  createCanvas?: () => HTMLCanvasElement | null
  raf?: RafFunction
  caf?: CafFunction
}

function resolveWindow(ctx: ContextWithEnv | null, env: AdvancedEnv): AnyWindow {
  if (ctx?.win !== undefined) return ctx.win
  if (env.window !== undefined) return env.window
  return typeof window !== 'undefined' ? window : null
}

function resolveDocument(ctx: ContextWithEnv | null, env: AdvancedEnv): AnyDocument {
  if (ctx?.doc !== undefined) return ctx.doc
  if (env.document !== undefined) return env.document
  return typeof document !== 'undefined' ? document : null
}

function resolveCreateCanvas(
  c: ContextWithEnv | null,
  env: AdvancedEnv,
  doc: AnyDocument,
): () => HTMLCanvasElement | null {
  if (c?.createCanvas) return c.createCanvas
  if (env.createCanvas) return env.createCanvas
  return () =>
    doc && typeof (doc as Document).createElement === 'function'
      ? (doc as Document).createElement('canvas')
      : null
}

function resolveRaf(
  c: ContextWithEnv | null,
  env: AdvancedEnv,
  win: AnyWindow,
): RafFunction {
  if (c?.raf) return c.raf
  if (env.raf) return env.raf
  return (fn: FrameRequestCallback) => defaultRaf(win, fn)
}

function resolveCaf(
  c: ContextWithEnv | null,
  env: AdvancedEnv,
  win: AnyWindow,
): CafFunction {
  if (c?.caf) return c.caf
  if (env.caf) return env.caf
  return (id: number | null) => defaultCaf(win, id)
}

export function resolveEnv(
  ctx: ContextWithEnv | PrepareContext | null = null,
  env: AdvancedEnv = {},
): ResolvedEnv {
  const c = ctx as ContextWithEnv | null
  const win = resolveWindow(c, env)
  const doc = resolveDocument(c, env)
  return {
    window: win,
    document: doc,
    createCanvas: resolveCreateCanvas(c, env, doc),
    raf: resolveRaf(c, env, win),
    caf: resolveCaf(c, env, win),
  }
}

export function isReducedMotion(ctx?: ContextWithEnv | PrepareContext | null): boolean {
  if (!ctx) return false
  const rm = (ctx as ContextWithEnv).reducedMotion
  if (rm === true) return true
  if (typeof rm === 'object' && rm && rm.enabled === true) return true
  return false
}

export function createEffectInstance(opts: EffectInstanceOptions = {}): EffectInstance {
  let isDestroyed = false
  let isFinished = false
  let resolveFinished: (() => void) | undefined
  const finishedPromise = new Promise<void>((resolve) => {
    resolveFinished = resolve
  })

  return {
    continuous: Boolean(opts.continuous),
    activate() {
      if (isDestroyed) return
      if (typeof opts.activate === 'function') opts.activate()
    },
    cancel() {
      if (isDestroyed) return
      if (typeof opts.cancel === 'function') opts.cancel()
      if (!isFinished && resolveFinished) {
        isFinished = true
        resolveFinished()
      }
    },
    finish() {
      if (isDestroyed) return
      if (typeof opts.finish === 'function') opts.finish()
      if (!isFinished && resolveFinished) {
        isFinished = true
        resolveFinished()
      }
    },
    finished: opts.continuous ? Promise.resolve() : finishedPromise,
    /*
     * `finally`, because `destroy()` is the one call that cannot be made twice.
     *
     * `cancel()` and `finish()` throwing leave the instance alive, so a later call still settles
     * `finished`. `destroy()` latches `isDestroyed` first — deliberately, so that a teardown which
     * threw partway cannot be re-entered and a later `activate()` cannot resurrect a destroyed
     * effect through ledgers that rejoin on write (`owned-styles.ts`). The cost of that latch was
     * that a throwing `opts.destroy()` also skipped the resolve below, and every subsequent call
     * returned at the guard: a non-continuous instance's `finished` then never settled at all, so
     * anything awaiting it waited for the life of the page. The teardown still throws — the caller
     * is told — but the promise it advertises is honoured on the way out.
     */
    destroy() {
      if (isDestroyed) return
      isDestroyed = true
      try {
        if (typeof opts.destroy === 'function') opts.destroy()
      } finally {
        if (!isFinished && resolveFinished) {
          isFinished = true
          resolveFinished()
        }
      }
    },
  }
}

export function createInertInstance(destroy?: () => void): EffectInstance {
  let isDestroyed = false
  return {
    continuous: false,
    activate() {},
    cancel() {},
    finish() {},
    finished: Promise.resolve(),
    destroy() {
      if (isDestroyed) return
      isDestroyed = true
      if (typeof destroy === 'function') destroy()
    },
  }
}

function toList<T>(val: T | T[]): T[] {
  return Array.isArray(val) ? val : [val]
}

/** The two methods `registerInto` actually calls. Checking more would assert a capability it never
 * exercises; checking fewer would accept an object it is about to crash on. */
function hasRegistrarShape(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const v = value as { registerPrimitives?: unknown; registerPresets?: unknown }
  return typeof v.registerPrimitives === 'function' && typeof v.registerPresets === 'function'
}

/**
 * Find the registry inside `target`, by shape rather than by constructor.
 *
 * This used to be `target instanceof Registry` / `target instanceof Animator`, and that is the one
 * thing standing between this tier and shipping as its own `<script>` tag. `instanceof` is class
 * *identity*: two independent esbuild IIFE bundles each inline their own copy of
 * `src/core/registry.ts`, so the `Registry` the advanced bundle tests against is a different class
 * object from the one core built the animator's registry with, and a perfectly valid animator gets
 * rejected. Shape survives that; identity cannot.
 *
 * The second payoff is a build one. Those two `instanceof` operands were the *only* reason this
 * module imported `Registry` and `Animator` as values. As types they erase at compile time, and the
 * entire transitively-reachable core graph erases with them: the advanced bundle went from 45.6 KB
 * to 17.4 KB gzipped, with no `--external:`, no esbuild plugin and no global-lookup shim. Do not
 * reintroduce a value import from `../core/` here without re-measuring.
 *
 * Deliberately NOT loosened into "accepts anything": an object carrying the singular
 * `registerPrimitive` and nothing else is still rejected, which is what
 * `__tests__/staging.test.ts` has always probed for.
 */
function asRegistry(target: unknown): Registry | undefined {
  if (!target || typeof target !== 'object') return undefined
  if (hasRegistrarShape(target)) return target as Registry
  const host = target as { registry?: unknown }
  if (hasRegistrarShape(host.registry)) return host.registry as Registry
  return undefined
}

export function registerInto(
  target: unknown,
  primitives: Primitive | Primitive[] | unknown,
  presets: Preset | Preset[] | unknown,
  name = 'module',
): Registry | Animator {
  const reg = asRegistry(target)
  if (!reg) {
    throw new Error(`kuinetic: register${name} requires a Registry or Animator instance`)
  }
  reg.registerPrimitives(toList(primitives) as Primitive[])
  reg.registerPresets(toList(presets) as Preset[])
  return target as Registry | Animator
}
