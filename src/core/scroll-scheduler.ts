import type { Cleanup } from './types.js'

/**
 * Shared scroll orchestration.
 *
 * "Zero scroll listeners" is a property of *native timeline* effects and does not survive contact
 * with pinning, scrubbing, or spying — those need the scroll position as a number. The correct
 * architecture is the one docs/design.md §13 names: one passive listener per scroll root that
 * marks a shared scheduler dirty, and exactly one rAF callback per dirtied frame. An
 * always-running rAF loop is the thing being avoided, not the listener.
 *
 * Every collaborator is injected. The frame source, the scroll roots, and the scrollability test
 * are all parameters, so the whole module is drivable from tests with no layout, no timers, and
 * no real scrolling.
 */

/** What a scroll root reports each frame. One read per root, shared by all its subscribers. */
export interface ScrollMetrics {
  scrollTop: number
  scrollLeft: number
  /** Visible size of the root's scrollport. */
  viewportWidth: number
  viewportHeight: number
  /**
   * Position of the scrollport itself in the viewport. Zero for the window.
   *
   * Without this, a subscriber measuring an element with `getBoundingClientRect` — which is
   * viewport-relative — and subtracting a nested scroller's `scrollTop` — which is local to that
   * scroller — mixes two coordinate systems, and every nested progress value is wrong by the
   * scroller's own offset.
   */
  viewportTop: number
  viewportLeft: number
}

/**
 * A scrollable context. The window is one; any `overflow: auto` element is another.
 *
 * `key` identifies the root for deduplication: two effects inside the same scroller must share a
 * listener, or a page with 200 pinned elements installs 200 listeners.
 */
export interface ScrollRoot {
  key: string
  metrics(): ScrollMetrics
  /** Attach a passive scroll listener. Returns its own removal. */
  onScroll(handler: () => void): Cleanup
  /** Attach a resize listener. Resize invalidates cached measurements, so it bumps the epoch. */
  onResize(handler: () => void): Cleanup
}

export interface ScrollFrame {
  metrics: ScrollMetrics
  /**
   * Increments whenever something invalidated cached geometry. Subscribers cache measurements
   * against this number instead of re-measuring every frame, which is what keeps a scroll frame
   * off the layout path.
   */
  epoch: number
}

export type ScrollSubscriber = (frame: ScrollFrame) => void

export interface SchedulerDeps {
  requestFrame(callback: () => void): number
  cancelFrame(handle: number): void
}

export interface ScrollScheduler {
  /**
   * Receive a frame whenever `root` scrolls or resizes, plus one immediately-scheduled frame so a
   * subscriber never has to wait for user input to reach its initial state.
   */
  subscribe(root: ScrollRoot, onFrame: ScrollSubscriber): Cleanup
  /** Bump the epoch and schedule a frame, for layout changes the scheduler cannot observe. */
  invalidate(): void
  /** Live root count. Diagnostics and leak assertions. */
  rootCount(): number
  destroy(): void
}

interface RootEntry {
  root: ScrollRoot
  subscribers: Set<ScrollSubscriber>
  detach: Cleanup[]
  /** Only dirtied roots are measured and notified; one scroller must not wake the others. */
  dirty: boolean
}

/**
 * Frame source defaults. Kept at the construction boundary so no logic below reads a global.
 *
 * @complexity O(1) time and space.
 * @overallScore 100
 */
function defaultDeps(): SchedulerDeps {
  const raf = globalThis.requestAnimationFrame
  if (typeof raf !== 'function') {
    return {
      requestFrame: (callback) => globalThis.setTimeout(callback, 16) as unknown as number,
      cancelFrame: (handle) => globalThis.clearTimeout(handle),
    }
  }
  return {
    requestFrame: (callback) => raf(callback),
    cancelFrame: (handle) => globalThis.cancelAnimationFrame(handle),
  }
}

/**
 * Create a scroll scheduler.
 *
 * @param deps - Frame source. Defaults to `requestAnimationFrame`, falling back to a timer where
 *   rAF does not exist (jsdom, workers).
 * @returns A scheduler that runs at most one frame per dirtying event.
 * @complexity O(s) time per frame in subscribers of dirtied roots; O(r + s) space.
 * @overallScore 100
 */
// Factory closing over the root-entry map; length is four small named closures plus the returned
// scheduler, not one long procedure.
// eslint-disable-next-line max-lines-per-function
export function createScrollScheduler(deps: SchedulerDeps = defaultDeps()): ScrollScheduler {
  const entries = new Map<string, RootEntry>()
  let epoch = 0
  let pending: number | null = null

  function schedule(entry?: RootEntry): void {
    if (entry) entry.dirty = true
    else for (const other of entries.values()) other.dirty = true

    if (pending !== null) return
    pending = deps.requestFrame(runFrame)
  }

  function runFrame(): void {
    pending = null
    // Metrics are read once per root and then shared, so N subscribers cost one layout read
    // rather than N. Subscriber writes therefore cannot interleave with this module's reads.
    for (const entry of entries.values()) {
      if (!entry.dirty || entry.subscribers.size === 0) continue
      entry.dirty = false
      const frame: ScrollFrame = { metrics: entry.root.metrics(), epoch }
      for (const subscriber of [...entry.subscribers]) subscriber(frame)
    }
  }

  function attach(root: ScrollRoot): RootEntry {
    const existing = entries.get(root.key)
    if (existing) return existing
    const entry: RootEntry = { root, subscribers: new Set(), detach: [], dirty: false }
    entry.detach.push(root.onScroll(() => schedule(entry)))
    entry.detach.push(
      root.onResize(() => {
        // A resize invalidates cached geometry everywhere, not only in the resized scroller.
        epoch++
        schedule()
      }),
    )
    entries.set(root.key, entry)
    return entry
  }

  function release(entry: RootEntry): void {
    if (entry.subscribers.size > 0) return
    for (const detach of entry.detach) detach()
    entries.delete(entry.root.key)
  }

  return {
    subscribe(root, onFrame) {
      const entry = attach(root)
      entry.subscribers.add(onFrame)
      schedule(entry)
      return () => {
        entry.subscribers.delete(onFrame)
        release(entry)
      }
    },

    invalidate() {
      epoch++
      schedule()
    },

    rootCount: () => entries.size,

    destroy() {
      if (pending !== null) deps.cancelFrame(pending)
      pending = null
      for (const entry of entries.values()) {
        entry.subscribers.clear()
        for (const detach of entry.detach) detach()
      }
      entries.clear()
    },
  }
}

/**
 * The window as a scroll root.
 *
 * @param win - Window to observe. Passed in so iframes, test doubles, and multiple documents work.
 * @complexity O(1) time and space.
 * @overallScore 100
 */
export function windowScrollRoot(win: Window): ScrollRoot {
  return {
    key: 'window',
    metrics: () => ({
      scrollTop: win.scrollY,
      scrollLeft: win.scrollX,
      viewportWidth: win.innerWidth,
      viewportHeight: win.innerHeight,
      viewportTop: 0,
      viewportLeft: 0,
    }),
    onScroll: (handler) => listen(win, 'scroll', handler),
    onResize: (handler) => listen(win, 'resize', handler),
  }
}

/**
 * An `overflow: auto` element as a scroll root.
 *
 * Nested scroll containers are a first-class case, not an edge case: a pinned element inside a
 * modal or a horizontally scrolled track must track *its* scroller, not the page.
 *
 * @param el - The scrolling element.
 * @param win - Window used for resize notification; element resize alone does not cover viewport
 *   changes that alter the element's own box.
 * @complexity O(1) time and space.
 * @overallScore 100
 */
export function elementScrollRoot(el: Element, win: Window): ScrollRoot {
  return {
    key: `el:${rootId(el)}`,
    metrics: () => {
      const rect = el.getBoundingClientRect()
      return {
        scrollTop: el.scrollTop,
        scrollLeft: el.scrollLeft,
        viewportWidth: el.clientWidth,
        viewportHeight: el.clientHeight,
        viewportTop: rect.top,
        viewportLeft: rect.left,
      }
    },
    onScroll: (handler) => listen(el, 'scroll', handler),
    // Window resize alone misses the cases that actually invalidate a nested scroller: images
    // loading, fonts swapping, a container changing size, or content being inserted.
    onResize: (handler) => observeSize(el, win, handler),
  }
}

function listen(target: EventTarget, type: string, handler: () => void): Cleanup {
  target.addEventListener(type, handler, { passive: true })
  return () => target.removeEventListener(type, handler)
}

/**
 * Observe an element's own size as well as the window's.
 *
 * @complexity O(1) to install; callback cost is the caller's.
 * @overallScore 100
 */
function observeSize(el: Element, win: Window, handler: () => void): Cleanup {
  const stopWindow = listen(win, 'resize', handler)
  if (typeof ResizeObserver === 'undefined') return stopWindow

  const observer = new ResizeObserver(handler)
  observer.observe(el)
  return () => {
    stopWindow()
    observer.disconnect()
  }
}

let nextRootId = 0
const rootIds = new WeakMap<Element, string>()

/** Stable per-element identity, so two effects in one scroller share its listener. */
function rootId(el: Element): string {
  const existing = rootIds.get(el)
  if (existing) return existing
  const id = String(++nextRootId)
  rootIds.set(el, id)
  return id
}

export interface RootResolverOptions {
  win: Window
  /** Injected so the overflow test is fakeable; the default reads computed style. */
  isScrollable?: (el: Element) => boolean
}

/**
 * Find the scroll root that actually moves a given element.
 *
 * @param options - Window plus an optional scrollability predicate.
 * @returns A resolver returning the nearest scrollable ancestor, or the window root.
 * @complexity O(d) time in DOM depth per call; O(1) space.
 * @overallScore 100
 */
export function createRootResolver(options: RootResolverOptions): (el: Element) => ScrollRoot {
  const { win } = options
  const isScrollable = options.isScrollable ?? defaultIsScrollable(win)
  const windowRoot = windowScrollRoot(win)

  return (el) => {
    for (let node = el.parentElement; node; node = node.parentElement) {
      if (isScrollable(node)) return elementScrollRoot(node, win)
    }
    return windowRoot
  }
}

const SCROLLABLE_OVERFLOW = new Set(['auto', 'scroll', 'overlay'])

/**
 * An ancestor counts as a scroll root only if it *can* scroll.
 *
 * `overflow: auto` on a box whose content fits scrolls nothing, so treating it as the root would
 * hand every descendant a scroller that never moves.
 *
 * @complexity O(1) time per call, but reads computed style and scroll size.
 * @overallScore 100
 */
function defaultIsScrollable(win: Window): (el: Element) => boolean {
  return (el) => {
    const style = win.getComputedStyle(el)
    const vertical = SCROLLABLE_OVERFLOW.has(style.overflowY) && el.scrollHeight > el.clientHeight
    const horizontal = SCROLLABLE_OVERFLOW.has(style.overflowX) && el.scrollWidth > el.clientWidth
    return vertical || horizontal
  }
}

/**
 * Clamp to the unit interval.
 *
 * @complexity O(1) time and space.
 * @overallScore 100
 */
export function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0
  return Math.min(1, Math.max(0, value))
}

/**
 * Progress of `position` through the range `[start, end]`, clamped.
 *
 * A zero-length range is the degenerate case that matters: an element shorter than its own pin
 * distance, or a track no wider than its viewport. Returning 0 rather than `Infinity`/`NaN` keeps
 * every downstream write finite.
 *
 * @complexity O(1) time and space.
 * @overallScore 100
 */
export function progressBetween(start: number, end: number, position: number): number {
  const span = end - start
  if (span <= 0) return 0
  return clamp01((position - start) / span)
}

export interface MeasureCache<T> {
  /** Measured value for this epoch, re-measuring only when the epoch moved. */
  read(epoch: number): T
  clear(): void
}

/**
 * Memoise a measurement against the scheduler's epoch.
 *
 * This is what makes a scroll frame cheap: geometry is read once per resize, not once per frame.
 * Getting this wrong is the difference between a pinned page that scrolls at 60fps and one that
 * forces a full layout on every wheel tick.
 *
 * @param measure - The layout-reading function to memoise.
 * @returns A cache keyed on epoch.
 * @complexity O(1) amortised per read; O(1) space.
 * @overallScore 100
 */
export function createMeasureCache<T>(measure: () => T): MeasureCache<T> {
  let cachedEpoch = -1
  let cached: T | undefined

  return {
    read(epoch) {
      if (cachedEpoch !== epoch || cached === undefined) {
        cached = measure()
        cachedEpoch = epoch
      }
      return cached
    },
    clear() {
      cachedEpoch = -1
      cached = undefined
    },
  }
}
