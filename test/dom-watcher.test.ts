import { describe, expect, it, vi } from 'vitest'
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
})
