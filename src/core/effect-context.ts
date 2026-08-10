import type { Capabilities } from './capabilities.js'
import type { StyleLedger } from './owned-styles.js'
import type { ScrollRoot, ScrollScheduler } from './scroll-scheduler.js'

/**
 * What a JS-rendered primitive receives.
 *
 * v1 handed `prepare` only `{ doc, warn }`, which was enough for effects the browser drove and
 * nothing else. Pinning, scrubbing, and FLIP all need the scroll position as a number, the
 * environment's real capabilities, and a way to say "geometry moved" — and every one of those has
 * to be injected rather than read off a global, or the primitive becomes untestable and each
 * instance installs its own listeners.
 *
 * `params` are validated and defaulted (see `js-params.ts`). A primitive never sees a raw author
 * string.
 */
export interface PrepareContext {
  doc: Document
  win: Window
  /** Shared frame source. One listener per scroll root, one rAF per dirtied frame. */
  scheduler: ScrollScheduler
  /** The scroll root that actually moves this element — the window, or a nested scroller. */
  rootFor(el: Element): ScrollRoot
  capabilities: Capabilities
  /**
   * Bump the measurement epoch and schedule a frame. Call after a DOM change the scheduler
   * cannot observe, such as inserting a pin spacer.
   */
  invalidate(): void
  warn(message: string): void
  /**
   * Whether the user has asked for reduced motion.
   *
   * The animator refuses to activate any effect whose declared policy is `'disable'` when this is
   * true, so a primitive never has to enforce that itself. It is exposed because effects that
   * remain interactive under reduced motion — a drag still has to follow the finger — need to
   * skip only their decorative parts.
   */
  reducedMotion: boolean
  /** Aborted on teardown, so a primitive can pass it straight to `addEventListener`. */
  signal: AbortSignal
  /**
   * Ledger for this element's inline style.
   *
   * Primitives must write through it rather than touching `element.style` directly. Several were
   * previously *removing* properties on teardown — `translate`, `scroll-snap-align` — that the
   * consumer had set themselves and the library never owned.
   */
  style: StyleLedger
}
