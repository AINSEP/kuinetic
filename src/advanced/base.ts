// Created by Gemini 3.8 Flash
/**
 * Shared primitives and runtime utilities for kUInetic Advanced Modules.
 */

import type { EffectInstance, PrepareContext, Preset, Primitive } from '../core/types.js'
import type { StyleLedger } from '../core/owned-styles.js'
import { createStyleLedger } from '../core/owned-styles.js'
import { Registry } from '../core/registry.js'
import { Animator } from '../core/animator.js'

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
 * One inline-style ledger per element, shared by every controller in this directory that writes
 * to that element — and, for the authored host, shared with core as well.
 *
 * `owned-styles.ts` says why this has to exist at all: *"a second ledger over an element the first
 * has already written to would snapshot this library's values as the author's own and restore to
 * them."* `createLedgerSet` memoises within one set, which is enough for core because the animator
 * builds exactly one set per authored element and hands every primitive on it the same one. It is
 * not enough here, because these controllers write to elements they merely *found* — a
 * `camera-layer` under a `camera-scene`, a `scene-step` under a `scene` — and those descendant
 * queries are not scoped to stop at a nested host. A `scene` inside a `scene` therefore claims the
 * same step, and with a set each the inner one captures the outer one's frame value as the
 * author's and pins the element to it forever on teardown.
 *
 * So the ledger is keyed by element, not by controller, and ref-counted by controller: the first
 * controller to write captures, and the *last* one to let go restores. That is the same
 * "before this instance existed" guarantee `LedgerSet` gives, extended across instances.
 *
 * A `WeakMap` because the key is the author's element and nothing here should keep it alive; the
 * entry dies with the element whether or not teardown ever ran.
 */
interface SharedStyleEntry {
  ledger: StyleLedger
  /** Controllers still writing through this ledger. The last one out restores. */
  owners: Set<object>
  /**
   * Whether the ledger belongs to someone else — `ctx.style`, i.e. the animator's own set.
   *
   * The animator owns `restore()` for every ledger in that set (`animator.ts` `release()` runs
   * `controller.abort()`, then each `instance.destroy()`, then `state.ledgers.restore()`), so a
   * module that restored it too would unwind core's writes while the element is still live. We
   * still register it here, because sharing it is the whole point: an advanced controller and a
   * CSS-rendered effect on one host then have one capture between them.
   */
  foreign: boolean
}

const sharedStyleLedgers = new WeakMap<Element, SharedStyleEntry>()

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
   */
  restore(): void
  /** Elements this controller has asked for. Diagnostics and leak assertions. */
  elements(): Element[]
}

/**
 * Open one controller's claim on the shared ledgers.
 *
 * @param host - The authored element this controller was prepared on. Restored last, for the
 *   reason `createLedgerSet` documents: the host carries `data-kui-state`, which is the cloak
 *   layer's release key, so it must not become visible before the subtree under it is back to the
 *   author's markup.
 * @param hostLedger - `ctx.style` when the animator prepared this controller: the host's entry in
 *   the animator's own `LedgerSet`. Adopting it is what makes an advanced effect and a CSS effect
 *   on one element share a single capture. Omitted (tests, direct construction) means nobody else
 *   is restoring the host, so this registry does.
 * @complexity O(1) per lookup; O(n) space and O(n) time to restore, in elements written to.
 */
export function createAdvancedLedgers(
  host: Element,
  hostLedger?: StyleLedger | null,
): AdvancedLedgers {
  const owner = {}
  const claimed = new Set<Element>()

  function entryFor(el: Element): SharedStyleEntry {
    let entry = sharedStyleLedgers.get(el)
    if (!entry) {
      const foreign = el === host && Boolean(hostLedger)
      entry = {
        ledger: foreign ? hostLedger! : createStyleLedger(el),
        owners: new Set(),
        foreign,
      }
      sharedStyleLedgers.set(el, entry)
    }
    return entry
  }

  return {
    style(el) {
      const entry = entryFor(el)
      entry.owners.add(owner)
      claimed.add(el)
      return entry.ledger
    },
    restore() {
      for (const el of claimed) {
        if (el !== host) releaseSharedLedger(el, owner)
      }
      if (claimed.has(host)) releaseSharedLedger(host, owner)
      claimed.clear()
    },
    elements: () => [...claimed],
  }
}

/**
 * Drop one owner from an element's shared entry, restoring the element when it was the last.
 *
 * @complexity O(p) in properties written, only on the last release.
 */
function releaseSharedLedger(el: Element, owner: object): void {
  const entry = sharedStyleLedgers.get(el)
  if (!entry) return
  entry.owners.delete(owner)
  if (entry.owners.size > 0) return
  sharedStyleLedgers.delete(el)
  if (!entry.foreign) entry.ledger.restore()
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
    destroy() {
      if (isDestroyed) return
      isDestroyed = true
      if (typeof opts.destroy === 'function') opts.destroy()
      if (!isFinished && resolveFinished) {
        isFinished = true
        resolveFinished()
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

function isValidRegistry(target: unknown): target is Registry | Animator | { registry: Registry } {
  if (!target || typeof target !== 'object') return false
  if (target instanceof Registry) return true
  if (target instanceof Animator && target.registry instanceof Registry) return true
  const r = target as { registry?: unknown }
  return r.registry instanceof Registry
}

export function registerInto(
  target: unknown,
  primitives: Primitive | Primitive[] | unknown,
  presets: Preset | Preset[] | unknown,
  name = 'module',
): Registry | Animator {
  if (!isValidRegistry(target)) {
    throw new Error(`kuinetic: register${name} requires a Registry or Animator instance`)
  }
  const reg: Registry = target instanceof Registry
    ? target
    : (target as { registry: Registry }).registry
  reg.registerPrimitives(toList(primitives) as Primitive[])
  reg.registerPresets(toList(presets) as Preset[])
  return target as Registry | Animator
}
