import type { PrepareContext } from '../../core/effect-context.js'
import { createLedgerSet } from '../../core/owned-styles.js'
import { defaultCapabilities } from '../../core/capabilities.js'
import { createScrollScheduler, windowScrollRoot } from '../../core/scroll-scheduler.js'

export interface PrepareContextOverrides extends Omit<Partial<PrepareContext>, 'win' | 'doc'> {
  win?: Window | unknown
  doc?: Document | unknown
  createCanvas?: () => HTMLCanvasElement | null
  raf?: (fn: FrameRequestCallback) => number | null
  caf?: (id: number | null) => void | null
}

function resolveTargetDoc(el?: Element | null, overrides?: PrepareContextOverrides): Document {
  if (overrides?.doc) return overrides.doc as Document
  if (el?.ownerDocument) return el.ownerDocument
  return typeof document !== 'undefined' ? document : ({} as Document)
}

function resolveTargetWin(doc: Document, overrides?: PrepareContextOverrides): Window {
  if (overrides?.win) return overrides.win as Window
  if (doc?.defaultView) return doc.defaultView
  return typeof window !== 'undefined' ? window : ({} as Window)
}

function createDefaultScheduler(overrides?: PrepareContextOverrides) {
  if (overrides?.scheduler) return overrides.scheduler
  return createScrollScheduler({
    requestFrame: (cb) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(cb) : (setTimeout(cb, 16) as unknown as number)),
    cancelFrame: (id) => (typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame(id) : clearTimeout(id)),
  })
}

export function createRealPrepareContext(
  el?: Element | null,
  overrides?: PrepareContextOverrides,
): PrepareContext {
  const hasElementMethods = el && typeof el.hasAttribute === 'function'
  const fallbackEl = typeof document !== 'undefined' ? document.createElement('div') : null
  const targetEl = hasElementMethods ? el! : (fallbackEl || ({} as Element))
  const doc = resolveTargetDoc(targetEl, overrides)
  const win = resolveTargetWin(doc, overrides)
  const scheduler = createDefaultScheduler(overrides)
  const abortController = new AbortController()
  const reduced = Boolean(overrides?.reducedMotion)
  const styleTarget = targetEl || document.createElement('div')

  const ctx: PrepareContext = {
    doc,
    win,
    scheduler,
    rootFor: () => windowScrollRoot(win),
    capabilities: defaultCapabilities({ reducedMotion: reduced }),
    invalidate: () => scheduler.invalidate(),
    warn: () => {},
    reducedMotion: reduced,
    signal: abortController.signal,
    // Exactly what `animator.ts` does — `createLedgerSet(el)` then `ledgers.style(el)` — rather
    // than a bare `createStyleLedger`. The difference is the whole subject of
    // `ownership.test.ts`'s last two describes: a set's handle is a *claim* on the shared
    // per-element ledger, so `ctx.style.restore()` here means "the animator has released the
    // host", not "unwind the element now whoever else is still writing to it". A bare ledger
    // cannot express that, and a fixture that hands one out quietly tests a context the animator
    // never produces.
    style: createLedgerSet(styleTarget).style(styleTarget),
  }

  if (overrides) Object.assign(ctx, overrides)
  return ctx
}
