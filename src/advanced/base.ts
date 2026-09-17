// Created by Gemini 3.8 Flash
/**
 * Shared primitives and runtime utilities for kUInetic Advanced Modules.
 */

import type { EffectInstance, PrepareContext, Preset, Primitive } from '../core/types.js'
import type { LedgerSet, StyleLedger } from '../core/owned-styles.js'
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
 * This element's owned-write ledger, or `null` when the object cannot carry one.
 *
 * Every module here manages the author's inline styles through `core/owned-styles.ts` rather than
 * a snapshot of its own, and the reason is timing: `LedgerSet.style(el)` builds that element's
 * ledger the first time it is *asked for*, and the ledger records a property's prior value the
 * first time that property is *written*. Asking at the write site is therefore the same thing as
 * "capture immediately before the first write", which is the invariant five rounds of review kept
 * finding broken — a snapshot taken at construction or preparation, restored much later over an
 * author value that had changed in between.
 *
 * The guard exists because `createStyleLedger` reads `hasAttribute('style')` the moment it is
 * built, and these controllers are constructed directly rather than by the animator: `prepare`
 * hands them whatever element the author wrote the attribute on, and the suites hand them `null`,
 * `{}`, and `{ getAttribute: () => null }` to exercise the degenerate paths. One check here beats
 * the same two clauses repeated at every write site.
 *
 * @param ledgers - The controller's ledger set, opened over its host element.
 * @param el - The element about to be written to.
 * @returns Its memoised ledger, or `null` when there is nothing to write to.
 * @complexity O(1).
 */
export function styleOf(ledgers: LedgerSet, el: Element | null | undefined): StyleLedger | null {
  if (!el || typeof el.hasAttribute !== 'function') return null
  if (!(el as HTMLElement).style) return null
  return ledgers.style(el)
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
