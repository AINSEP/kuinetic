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

  /**
   * The stagger half of an attribute edit. `data-kui-stagger` was not in the watcher's
   * `attributeFilter`, so retargeting a group produced no mutation record at all — and the
   * `data-kui` half only ever recompiled the one element, which never touches a rank.
   */
  describe('a retargeted stagger group', () => {
    // Torn down here rather than at the end of each body: an animator left observing `document.body`
    // by a failing assertion goes on scanning the *next* test's markup, which turned a genuine
    // failure into a pass depending on which tests ran before it.
    const running: Animator[] = []
    afterEach(() => {
      for (const animator of running.splice(0)) animator.destroy()
    })

    function list(attribute: string): { animator: Animator; ul: HTMLElement } {
      stubSyncFrame()
      document.body.innerHTML =
        `<ul ${attribute}>${'<li data-kui="fade-up"></li>'.repeat(5)}</ul>`
      const animator = new Animator({
        root: document.body,
        registry: catalogRegistry(),
        capabilities: CAPS,
        binder: fakeBinder(),
        observe: true,
      })
      animator.start()
      running.push(animator)
      return { animator, ul: document.body.firstElementChild as HTMLElement }
    }

    const ranks = (ul: HTMLElement): string[] =>
      [...ul.children].map((li) => (li as HTMLElement).style.getPropertyValue('--kui-i'))

    it('re-ranks when the longhand attribute is edited', async () => {
      const { ul } = list('data-kui-stagger="100ms from:start"')
      expect(ranks(ul)).toEqual(['0', '1', '2', '3', '4'])

      ul.setAttribute(ATTR.stagger, 'spread:600ms from:center')
      await flushMutations()

      expect(ranks(ul)).toEqual(['2', '1', '0', '1', '2'])
      expect(ul.style.getPropertyValue('--kui-stagger')).toBe('calc((600ms) / 2)')
    })

    it('re-ranks when the group is declared inside data-kui instead', async () => {
      const { ul } = list('data-kui="fade-up cascade:100ms"')
      expect(ranks(ul)).toEqual(['0', '1', '2', '3', '4'])

      ul.setAttribute(ATTR.source, 'fade-up cascade:100ms order:end')
      await flushMutations()

      expect(ranks(ul)).toEqual(['4', '3', '2', '1', '0'])
    })

    it('leaves nothing behind on destroy', async () => {
      const { animator, ul } = list('data-kui-stagger="100ms from:start"')
      expect(ul.style.getPropertyValue('--kui-stagger-count')).toBe('5')

      animator.destroy()
      await flushMutations()

      expect(ul.getAttribute('style')).toBeNull()
      for (const li of ul.children) expect(li.getAttribute('style')).toBeNull()
    })
  })

  /**
   * The stagger half of a removal, through the real `releaseTree` path this bug lived in.
   *
   * `stagger-teardown.test.ts` covers `restageAfterRemoval` itself at the unit level; this exercises
   * the wiring that actually calls it — a real `MutationObserver` reporting a `childList` removal,
   * flushed through `Animator.releaseTree` exactly as a page author's own removal would be.
   */
  describe('a stagger group that loses a member', () => {
    const running: Animator[] = []
    afterEach(() => {
      for (const animator of running.splice(0)) animator.destroy()
    })

    function list(attribute: string, children = 5): { animator: Animator; ul: HTMLElement } {
      stubSyncFrame()
      document.body.innerHTML =
        `<ul ${attribute}>${'<li data-kui="fade-up"></li>'.repeat(children)}</ul>`
      const animator = new Animator({
        root: document.body,
        registry: catalogRegistry(),
        capabilities: CAPS,
        binder: fakeBinder(),
        observe: true,
      })
      animator.start()
      running.push(animator)
      return { animator, ul: document.body.firstElementChild as HTMLElement }
    }

    const ranks = (ul: HTMLElement): string[] =>
      [...ul.children].map((li) => (li as HTMLElement).style.getPropertyValue('--kui-i'))

    it('re-ranks the surviving siblings, not just tears the removed one down', async () => {
      const { ul } = list('data-kui-stagger="100ms from:start"')
      expect(ranks(ul)).toEqual(['0', '1', '2', '3', '4'])

      ul.children[2]!.remove()
      await flushMutations()

      expect(ranks(ul)).toEqual(['0', '1', '2', '3'])
      expect(ul.style.getPropertyValue('--kui-stagger-count')).toBe('4')
    })

    it('re-ranks correctly when several siblings leave in the same tick', async () => {
      // Real `MutationObserver` records batch every synchronous removal before the deferred flush
      // runs, so all three of these have already happened by the time `releaseTree` sees any of
      // them — the same batch shape `restageAfterRemoval`'s dedup exists for.
      const { ul } = list('data-kui-stagger="100ms from:start"', 6)
      expect(ranks(ul)).toEqual(['0', '1', '2', '3', '4', '5'])

      ul.children[1]!.remove()
      ul.children[1]!.remove()
      ul.children[1]!.remove()
      await flushMutations()

      expect(ranks(ul)).toEqual(['0', '1', '2'])
      expect(ul.style.getPropertyValue('--kui-stagger-count')).toBe('3')
    })
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
