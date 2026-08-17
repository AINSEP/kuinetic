import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDomWatcher } from '../src/core/dom-watcher.js'

describe('DomWatcher batching', () => {
  it('deduplicates nested additions before scheduled work runs', () => {
    const root = document.createElement('main')
    const parent = document.createElement('section')
    const child = document.createElement('div')
    parent.append(child)
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
    const watcher = createDomWatcher({
      root: document.createElement('main'),
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
    const watcher = createDomWatcher({
      root: document.createElement('main'),
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
