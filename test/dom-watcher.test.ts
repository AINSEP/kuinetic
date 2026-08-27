import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDomWatcher } from '../src/core/dom-watcher.js'

/**
 * These suites fabricate `MutationRecord`s rather than waiting for a real observer, so their
 * fixtures have to be attached to the watcher's root by hand. That is not test bookkeeping: a real
 * observer only ever reports nodes that were in the tree, and the watcher now asks whether an
 * element it is about to *install* is still there — see `whileAttached` for what a detached one
 * used to leak.
 */
describe('DomWatcher batching', () => {
  it('deduplicates nested additions before scheduled work runs', () => {
    const root = document.createElement('main')
    const parent = document.createElement('section')
    const child = document.createElement('div')
    parent.append(child)
    root.append(parent)
    let mutationCallback: MutationCallback = () => {}
    const frames: Array<() => void> = []
    const added = vi.fn()
    const watcher = createDomWatcher({
      root,
      onElementAdded: added,
      onElementRemoved: vi.fn(),
      onAttributeChanged: vi.fn(),
      schedule: (callback) => frames.push(callback),
      createObserver(callback) {
        mutationCallback = callback
        return { observe: vi.fn(), disconnect: vi.fn() } as unknown as MutationObserver
      },
    })
    watcher.watch()
    mutationCallback([
      { type: 'childList', addedNodes: [parent], removedNodes: [] },
      { type: 'childList', addedNodes: [child], removedNodes: [] },
    ] as unknown as MutationRecord[], {} as MutationObserver)

    expect(added).not.toHaveBeenCalled()
    frames.shift()?.()
    expect(added).toHaveBeenCalledOnce()
    expect(added).toHaveBeenCalledWith(parent)
  })

  it('flushes attribute changes to onAttributeChanged', () => {
    const root = document.createElement('main')
    const el = document.createElement('div')
    root.append(el)
    let mutationCallback: MutationCallback = () => {}
    const frames: Array<() => void> = []
    const changed = vi.fn()
    const watcher = createDomWatcher({
      root,
      onElementAdded: vi.fn(),
      onElementRemoved: vi.fn(),
      onAttributeChanged: changed,
      schedule: (callback) => frames.push(callback),
      createObserver(callback) {
        mutationCallback = callback
        return { observe: vi.fn(), disconnect: vi.fn() } as unknown as MutationObserver
      },
    })
    watcher.watch()
    mutationCallback(
      [{ type: 'attributes', target: el, addedNodes: [], removedNodes: [] }] as unknown as MutationRecord[],
      {} as MutationObserver,
    )

    frames.shift()?.()
    expect(changed).toHaveBeenCalledOnce()
    expect(changed).toHaveBeenCalledWith(el)
  })

  it('flushes removed elements to onElementRemoved', () => {
    const root = document.createElement('main')
    const el = document.createElement('div')
    let mutationCallback: MutationCallback = () => {}
    const frames: Array<() => void> = []
    const removed = vi.fn()
    const watcher = createDomWatcher({
      root,
      onElementAdded: vi.fn(),
      onElementRemoved: removed,
      onAttributeChanged: vi.fn(),
      schedule: (callback) => frames.push(callback),
      createObserver(callback) {
        mutationCallback = callback
        return { observe: vi.fn(), disconnect: vi.fn() } as unknown as MutationObserver
      },
    })
    watcher.watch()
    mutationCallback(
      [{ type: 'childList', addedNodes: [], removedNodes: [el] }] as unknown as MutationRecord[],
      {} as MutationObserver,
    )

    frames.shift()?.()
    expect(removed).toHaveBeenCalledOnce()
    expect(removed).toHaveBeenCalledWith(el)
  })

  it('ignores non-element nodes such as text nodes', () => {
    const root = document.createElement('main')
    const text = document.createTextNode('hi')
    let mutationCallback: MutationCallback = () => {}
    const frames: Array<() => void> = []
    const added = vi.fn()
    const watcher = createDomWatcher({
      root,
      onElementAdded: added,
      onElementRemoved: vi.fn(),
      onAttributeChanged: vi.fn(),
      schedule: (callback) => frames.push(callback),
      createObserver(callback) {
        mutationCallback = callback
        return { observe: vi.fn(), disconnect: vi.fn() } as unknown as MutationObserver
      },
    })
    watcher.watch()
    mutationCallback(
      [{ type: 'childList', addedNodes: [text], removedNodes: [] }] as unknown as MutationRecord[],
      {} as MutationObserver,
    )

    expect(() => frames.shift()?.()).not.toThrow()
    expect(added).not.toHaveBeenCalled()
  })

  it('replaces an already-queued descendant when a later batch adds its ancestor, without scheduling a second frame', () => {
    const root = document.createElement('main')
    const parent = document.createElement('section')
    const child = document.createElement('div')
    parent.append(child)
    root.append(parent)
    let mutationCallback: MutationCallback = () => {}
    const frames: Array<() => void> = []
    const added = vi.fn()
    const watcher = createDomWatcher({
      root,
      onElementAdded: added,
      onElementRemoved: vi.fn(),
      onAttributeChanged: vi.fn(),
      schedule: (callback) => frames.push(callback),
      createObserver(callback) {
        mutationCallback = callback
        return { observe: vi.fn(), disconnect: vi.fn() } as unknown as MutationObserver
      },
    })
    watcher.watch()
    // child arrives in its own batch first.
    mutationCallback(
      [{ type: 'childList', addedNodes: [child], removedNodes: [] }] as unknown as MutationRecord[],
      {} as MutationObserver,
    )
    expect(frames).toHaveLength(1)

    // parent arrives in a second batch before the first scheduled frame has run — queueWork sees
    // `scheduled` already true and must not queue a second frame.
    mutationCallback(
      [{ type: 'childList', addedNodes: [parent], removedNodes: [] }] as unknown as MutationRecord[],
      {} as MutationObserver,
    )
    expect(frames).toHaveLength(1)

    frames.shift()?.()
    expect(added).toHaveBeenCalledOnce()
    expect(added).toHaveBeenCalledWith(parent)
  })

  it('drains only up to the frame work budget, then reschedules the remainder', () => {
    const root = document.createElement('main')
    let mutationCallback: MutationCallback = () => {}
    const frames: Array<() => void> = []
    const added = vi.fn()
    const watcher = createDomWatcher({
      root,
      onElementAdded: added,
      onElementRemoved: vi.fn(),
      onAttributeChanged: vi.fn(),
      schedule: (callback) => frames.push(callback),
      createObserver(callback) {
        mutationCallback = callback
        return { observe: vi.fn(), disconnect: vi.fn() } as unknown as MutationObserver
      },
    })
    watcher.watch()
    // Unrelated siblings (not nested), so queueRoot dedup keeps all 150 as distinct roots — well
    // over the 100-element work budget.
    const elements = Array.from({ length: 150 }, () => document.createElement('div'))
    root.append(...elements)
    mutationCallback(
      [{ type: 'childList', addedNodes: elements, removedNodes: [] }] as unknown as MutationRecord[],
      {} as MutationObserver,
    )

    frames.shift()?.()
    expect(added).toHaveBeenCalledTimes(100)
    expect(frames).toHaveLength(1) // leftover work rescheduled a follow-up flush

    frames.shift()?.()
    expect(added).toHaveBeenCalledTimes(150)
    expect(frames).toHaveLength(0)
  })

  it('stops processing queued work and disconnects the observer once destroyed', () => {
    const root = document.createElement('main')
    const el = document.createElement('div')
    let mutationCallback: MutationCallback = () => {}
    const frames: Array<() => void> = []
    const added = vi.fn()
    const disconnect = vi.fn()
    const watcher = createDomWatcher({
      root,
      onElementAdded: added,
      onElementRemoved: vi.fn(),
      onAttributeChanged: vi.fn(),
      schedule: (callback) => frames.push(callback),
      createObserver(callback) {
        mutationCallback = callback
        return { observe: vi.fn(), disconnect } as unknown as MutationObserver
      },
    })
    watcher.watch()
    mutationCallback(
      [{ type: 'childList', addedNodes: [el], removedNodes: [] }] as unknown as MutationRecord[],
      {} as MutationObserver,
    )
    expect(frames).toHaveLength(1)

    watcher.destroy()
    expect(disconnect).toHaveBeenCalledOnce()

    // Nothing cancels the frame queued before destroy(); flush() itself must no-op instead.
    frames.shift()?.()
    expect(added).not.toHaveBeenCalled()
  })

  /**
   * An element that is gone by the time the queued frame runs.
   *
   * The queues describe a whole frame, not a single state, so an element appended and removed
   * before the flush sits in both of them. Removals drain first and find nothing installed, and
   * the addition then installed a detached element that nothing afterwards ever revisited — held
   * by the animator's live set, its own listeners and its own observers until the animator was
   * destroyed.
   */
  function sameFrame(records: MutationRecord[]): {
    added: ReturnType<typeof vi.fn>
    changed: ReturnType<typeof vi.fn>
    removed: ReturnType<typeof vi.fn>
    root: HTMLElement
    run: () => void
  } {
    const root = document.createElement('main')
    let mutationCallback: MutationCallback = () => {}
    const frames: Array<() => void> = []
    const added = vi.fn()
    const changed = vi.fn()
    const removed = vi.fn()
    const watcher = createDomWatcher({
      root,
      onElementAdded: added,
      onElementRemoved: removed,
      onAttributeChanged: changed,
      schedule: (callback) => frames.push(callback),
      createObserver(callback) {
        mutationCallback = callback
        return { observe: vi.fn(), disconnect: vi.fn() } as unknown as MutationObserver
      },
    })
    watcher.watch()
    return {
      added,
      changed,
      removed,
      root,
      run: () => {
        mutationCallback(records, {} as MutationObserver)
        while (frames.length > 0) frames.shift()?.()
      },
    }
  }

  it('does not install an element that was appended and removed before the flush', () => {
    const el = document.createElement('div')
    const { added, removed, run } = sameFrame([
      { type: 'childList', addedNodes: [el], removedNodes: [] },
      { type: 'childList', addedNodes: [], removedNodes: [el] },
    ] as unknown as MutationRecord[])

    run()
    expect(added).not.toHaveBeenCalled()
    expect(removed).toHaveBeenCalledWith(el)
  })

  it('still installs an element removed and then put back in the same frame', () => {
    // The other order, and the discriminator for a fix that merely skipped anything named in both
    // sets: this element *is* in the tree when the flush runs, so it has to be scanned.
    const el = document.createElement('div')
    const harness = sameFrame([
      { type: 'childList', addedNodes: [], removedNodes: [el] },
      { type: 'childList', addedNodes: [el], removedNodes: [] },
    ] as unknown as MutationRecord[])
    harness.root.append(el)

    harness.run()
    expect(harness.added).toHaveBeenCalledWith(el)
  })

  it('does not recompile an element whose subtree left in the same frame', () => {
    // `queueRoot` cannot collapse this one: the removed root is the *ancestor* and the changed
    // element is the descendant, so the two queues name different nodes entirely.
    const section = document.createElement('section')
    const el = document.createElement('div')
    section.append(el)
    const { changed, removed, run } = sameFrame([
      { type: 'attributes', target: el, addedNodes: [], removedNodes: [] },
      { type: 'childList', addedNodes: [], removedNodes: [section] },
    ] as unknown as MutationRecord[])

    run()
    expect(changed).not.toHaveBeenCalled()
    expect(removed).toHaveBeenCalledWith(section)
  })

  it('installs a nested subtree root that really is in the tree', () => {
    // Containment is asked of the element itself, so a queued root some way below the watcher's
    // own root still passes — the guard must not become "only direct children".
    const section = document.createElement('section')
    const el = document.createElement('div')
    section.append(el)
    const harness = sameFrame([
      { type: 'childList', addedNodes: [el], removedNodes: [] },
    ] as unknown as MutationRecord[])
    harness.root.append(section)

    harness.run()
    expect(harness.added).toHaveBeenCalledWith(el)
  })

  it('destroy() is a safe no-op if watch() was never called', () => {
    const watcher = createDomWatcher({
      root: document.createElement('main'),
      onElementAdded: vi.fn(),
      onElementRemoved: vi.fn(),
      onAttributeChanged: vi.fn(),
    })
    expect(() => watcher.destroy()).not.toThrow()
  })
})

describe('DomWatcher default collaborators', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('uses requestAnimationFrame as the default scheduler when available', () => {
    const raf = vi.fn((callback: FrameRequestCallback) => {
      callback(0)
      return 0
    })
    vi.stubGlobal('requestAnimationFrame', raf)
    let mutationCallback: MutationCallback = () => {}
    const added = vi.fn()
    const root = document.createElement('main')
    const watcher = createDomWatcher({
      root,
      onElementAdded: added,
      onElementRemoved: vi.fn(),
      onAttributeChanged: vi.fn(),
      createObserver(callback) {
        mutationCallback = callback
        return { observe: vi.fn(), disconnect: vi.fn() } as unknown as MutationObserver
      },
    })
    watcher.watch()
    const el = document.createElement('div')
    root.append(el)
    mutationCallback(
      [{ type: 'childList', addedNodes: [el], removedNodes: [] }] as unknown as MutationRecord[],
      {} as MutationObserver,
    )

    expect(raf).toHaveBeenCalledOnce()
    expect(added).toHaveBeenCalledWith(el)
  })

  it('falls back to a microtask scheduler when requestAnimationFrame is unavailable', async () => {
    vi.stubGlobal('requestAnimationFrame', undefined)
    let mutationCallback: MutationCallback = () => {}
    const added = vi.fn()
    const root = document.createElement('main')
    const watcher = createDomWatcher({
      root,
      onElementAdded: added,
      onElementRemoved: vi.fn(),
      onAttributeChanged: vi.fn(),
      createObserver(callback) {
        mutationCallback = callback
        return { observe: vi.fn(), disconnect: vi.fn() } as unknown as MutationObserver
      },
    })
    watcher.watch()
    const el = document.createElement('div')
    root.append(el)
    mutationCallback(
      [{ type: 'childList', addedNodes: [el], removedNodes: [] }] as unknown as MutationRecord[],
      {} as MutationObserver,
    )

    expect(added).not.toHaveBeenCalled()
    await Promise.resolve()
    expect(added).toHaveBeenCalledWith(el)
  })

  it('no-ops watch() when MutationObserver is unavailable in this realm', () => {
    vi.stubGlobal('MutationObserver', undefined)
    const watcher = createDomWatcher({
      root: document.createElement('main'),
      onElementAdded: vi.fn(),
      onElementRemoved: vi.fn(),
      onAttributeChanged: vi.fn(),
    })
    expect(() => {
      watcher.watch()
      watcher.destroy()
    }).not.toThrow()
  })

  it('creates a real MutationObserver by default when supported', async () => {
    const raf = vi.fn((callback: FrameRequestCallback) => {
      callback(0)
      return 0
    })
    vi.stubGlobal('requestAnimationFrame', raf)
    const root = document.createElement('main')
    const added = vi.fn()
    const watcher = createDomWatcher({
      root,
      onElementAdded: added,
      onElementRemoved: vi.fn(),
      onAttributeChanged: vi.fn(),
    })
    watcher.watch()
    const child = document.createElement('div')
    root.append(child)

    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    expect(added).toHaveBeenCalledWith(child)
    watcher.destroy()
  })
})
