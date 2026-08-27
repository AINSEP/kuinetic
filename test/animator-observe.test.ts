// Split out of `animator.test.ts` when that file crossed the 400-line budget. The seam is the
// collaborator: everything here drives a *real* `createDomWatcher` over a real MutationObserver,
// with `requestAnimationFrame` stubbed synchronous so the watcher's rAF-scheduled flush lands in
// the same tick. `animator.test.ts` injects a fake watcher and never observes anything, which is
// why these tests need their own `vi.stubGlobal`/`vi.unstubAllGlobals` lifecycle and none of that
// file's `build()`/`el()` harness.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Animator } from '../src/core/animator.js'
import { ATTR } from '../src/core/attrs.js'
import type { DomWatcher } from '../src/core/dom-watcher.js'
import { CAPS, fakeBinder } from './support/animator-harness.js'
import { catalogRegistry } from './support/registry.js'
describe('Animator — observe: true real DOM-watcher wiring', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  /** requestAnimationFrame stubbed to run synchronously, so the watcher's rAF-scheduled flush
   *  fires inside the same microtask tick a real MutationObserver callback lands in. */
  function stubSyncFrame(): void {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0)
      return 0
    })
  }

  async function flushMutations(): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  }

  it('scans an element inserted into the observed subtree', async () => {
    stubSyncFrame()
    document.body.innerHTML = ''
    const animator = new Animator({
      root: document.body,
      registry: catalogRegistry(),
      capabilities: CAPS,
      binder: fakeBinder(),
      observe: true,
    })
    animator.start()

    const added = document.createElement('div')
    added.setAttribute('data-kui', 'fade-up')
    document.body.append(added)
    await flushMutations()

    expect(added.getAttribute(ATTR.normalized)).toBe('fade-up')
    animator.destroy()
  })

  it('releases a live element when an ancestor of it is removed, not only the element itself', async () => {
    stubSyncFrame()
    document.body.innerHTML = '<section><div data-kui="fade-up"></div></section>'
    const wrapper = document.body.firstElementChild as HTMLElement
    const target = wrapper.firstElementChild as HTMLElement
    const animator = new Animator({
      root: document.body,
      registry: catalogRegistry(),
      capabilities: CAPS,
      binder: fakeBinder(),
      observe: true,
    })
    animator.start()
    expect(target.getAttribute(ATTR.normalized)).toBe('fade-up')

    wrapper.remove()
    await flushMutations()

    expect(target.hasAttribute(ATTR.normalized)).toBe(false)
    animator.destroy()
  })

  it('releases an element removed from the observed subtree', async () => {
    stubSyncFrame()
    document.body.innerHTML = '<div data-kui="fade-up"></div>'
    const target = document.body.firstElementChild as HTMLElement
    const animator = new Animator({
      root: document.body,
      registry: catalogRegistry(),
      capabilities: CAPS,
      binder: fakeBinder(),
      observe: true,
    })
    animator.start()
    expect(target.getAttribute(ATTR.normalized)).toBe('fade-up')

    target.remove()
    await flushMutations()

    expect(target.hasAttribute(ATTR.normalized)).toBe(false)
    animator.destroy()
  })

  it('reprocesses an element whose watched attribute changed', async () => {
    stubSyncFrame()
    document.body.innerHTML = '<div data-kui="fade-up"></div>'
    const target = document.body.firstElementChild as HTMLElement
    const animator = new Animator({
      root: document.body,
      registry: catalogRegistry(),
      capabilities: CAPS,
      binder: fakeBinder(),
      observe: true,
    })
    animator.start()
    expect(target.getAttribute(ATTR.normalized)).toBe('fade-up')

    target.setAttribute(ATTR.source, 'zoom-in')
    await flushMutations()

    expect(target.getAttribute(ATTR.normalized)).toBe('zoom-in')
    animator.destroy()
  })

  it('disconnects the real dom watcher on destroy, so later mutations are ignored', async () => {
    stubSyncFrame()
    document.body.innerHTML = ''
    const animator = new Animator({
      root: document.body,
      registry: catalogRegistry(),
      capabilities: CAPS,
      binder: fakeBinder(),
      observe: true,
    })
    animator.start()
    animator.destroy()

    const added = document.createElement('div')
    added.setAttribute('data-kui', 'fade-up')
    document.body.append(added)
    await flushMutations()

    expect(added.hasAttribute(ATTR.normalized)).toBe(false)
  })

  it('calls destroy() on an injected domWatcher', () => {
    const fakeWatcher: DomWatcher = { watch: vi.fn(), destroy: vi.fn() }
    document.body.innerHTML = ''
    const animator = new Animator({
      root: document.body,
      registry: catalogRegistry(),
      capabilities: CAPS,
      binder: fakeBinder(),
      observe: true,
      domWatcher: fakeWatcher,
    })
    animator.start()
    expect(fakeWatcher.watch).toHaveBeenCalledOnce()

    animator.destroy()
    expect(fakeWatcher.destroy).toHaveBeenCalledOnce()
  })
})
