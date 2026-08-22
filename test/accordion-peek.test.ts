import { afterEach, describe, expect, it, vi } from 'vitest'
import { createParams } from '../src/core/js-params.js'
import type { PrepareContext } from '../src/core/effect-context.js'
import { LAYOUT_PRIMITIVES } from '../src/effects/layout/primitives.js'
import { build, el } from './support/scroll-mechanics-harness.js'

/**
 * `accordion-height` (primitive `auto-height`) has no dedicated "peek" parameter — a peek (a
 * collapsed state that still shows a non-zero sliver of content) is authored entirely by the
 * page's own CSS for the collapsed resting state; the primitive just reads whatever height the
 * stylesheet resolves to and animates between that and the natural height. See
 * `heightEndpoints()` in src/effects/layout/primitives.ts.
 *
 * That makes it supported through the *tracked* previous height (`previous = endpoints.to` in
 * `prepareAutoHeight`), which is exactly the mechanism test/layout.test.ts:336 gestures at without
 * exercising it — that test's "peek" step reuses a collapsed height of 0, so it re-proves the
 * already-covered zero case rather than a real non-zero collapse. These tests use a genuine
 * non-zero peek height (48px) against a 200px natural height, closing over a full sequence of
 * toggles so `previous` is actually populated by the time each assertion runs.
 */

/** Only `doc` and `style.set` are read by `prepareAutoHeight`; a partial fake is enough. */
function fakeCtx(): PrepareContext {
  return {
    doc: document,
    win: window,
    style: { set: vi.fn(), claim: vi.fn(), restore: vi.fn(), owned: () => [] },
    invalidate: vi.fn(),
  } as unknown as PrepareContext
}

const autoHeight = LAYOUT_PRIMITIVES.find((primitive) => primitive.id === 'auto-height')!

/**
 * A controllable fake, following the precedent in test/layout.test.ts for this exact primitive:
 * push `this` from inside the constructor rather than aliasing it to a variable, which is what
 * that file's identical fake does and what keeps `no-this-alias` happy.
 */
function stubControllableObserver(): Array<{ fire: () => void }> {
  const observers: Array<{ fire: () => void }> = []
  class ControllableMutationObserver {
    private readonly callback: MutationCallback
    constructor(callback: MutationCallback) {
      this.callback = callback
      observers.push(this)
    }
    observe(): void {}
    disconnect(): void {}
    fire(): void {
      this.callback([], this as unknown as MutationObserver)
    }
  }
  vi.stubGlobal('MutationObserver', ControllableMutationObserver)
  return observers
}

describe('auto-height: a partial ("peek") collapsed state', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('collapsing returns to the authored peek height, not to zero', () => {
    const observers = stubControllableObserver()

    const el = document.createElement('div')
    document.body.append(el)

    const natural = 200
    const peek = 48
    let rendered = natural // starts open
    el.getBoundingClientRect = (() => ({ height: rendered })) as unknown as Element['getBoundingClientRect']
    Object.defineProperty(el, 'scrollHeight', { get: () => natural })

    const frames: Array<Array<Record<string, string>>> = []
    el.animate = ((keyframes: Array<Record<string, string>>) => {
      frames.push(keyframes)
      return { cancel: vi.fn() } as unknown as Animation
    }) as unknown as typeof el.animate

    const params = createParams({ attribute: 'data-open', duration: '400ms', ease: 'ease-out' })
    const instance = autoHeight.prepare!(el, params, fakeCtx())
    instance.activate()
    const observer = observers.at(-1)!

    // First-ever toggle on this instance: the stylesheet has already collapsed the panel to its
    // authored peek height (48px), not to 0.
    rendered = peek
    observer.fire()

    expect(frames[0]).toEqual([{ height: '200px' }, { height: '48px' }])

    instance.destroy()
    el.remove()
  })

  it('expanding from a peek restores the full natural height', () => {
    const observers = stubControllableObserver()

    const el = document.createElement('div')
    document.body.append(el)

    const natural = 200
    const peek = 48
    let rendered = natural // starts open
    el.getBoundingClientRect = (() => ({ height: rendered })) as unknown as Element['getBoundingClientRect']
    Object.defineProperty(el, 'scrollHeight', { get: () => natural })

    const frames: Array<Array<Record<string, string>>> = []
    el.animate = ((keyframes: Array<Record<string, string>>) => {
      frames.push(keyframes)
      return { cancel: vi.fn() } as unknown as Animation
    }) as unknown as typeof el.animate

    const params = createParams({ attribute: 'data-open', duration: '400ms', ease: 'ease-out' })
    const instance = autoHeight.prepare!(el, params, fakeCtx())
    instance.activate()
    const observer = observers.at(-1)!

    // Close to the peek first, so `previous` is a real recorded value (48), not the null this
    // primitive starts with.
    rendered = peek
    observer.fire()
    expect(frames[0]).toEqual([{ height: '200px' }, { height: '48px' }])

    // Now expand: the start must be the peek height that was actually showing (48px), not 0 — a
    // naive "collapsed == 0" assumption would animate from the wrong place even though the panel
    // never touched zero.
    rendered = natural
    observer.fire()
    expect(frames[1]).toEqual([{ height: '48px' }, { height: '200px' }])

    instance.destroy()
    el.remove()
  })

  it('the very first toggle opens from the peek, with no prior close to seed `previous`', () => {
    // The two tests above both arrange a close *before* the assertion they care about, specifically
    // so `previous` is already a real recorded number by the time they check a frame. That sidesteps
    // the actual bug: a panel authored collapsed-to-a-peek whose *first-ever* toggle is opening it.
    // `previous` starts seeded from whatever `prepareAutoHeight` measured at `activate()` — this
    // test never touches `rendered` before that call, so it has to be right without any toggle
    // having happened yet.
    const observers = stubControllableObserver()

    const el = document.createElement('div')
    document.body.append(el)

    const natural = 200
    const peek = 48
    let rendered = peek // authored collapsed-to-peek, and never anything else before activation
    el.getBoundingClientRect = (() => ({ height: rendered })) as unknown as Element['getBoundingClientRect']
    Object.defineProperty(el, 'scrollHeight', { get: () => natural })

    const frames: Array<Array<Record<string, string>>> = []
    el.animate = ((keyframes: Array<Record<string, string>>) => {
      frames.push(keyframes)
      return { cancel: vi.fn() } as unknown as Animation
    }) as unknown as typeof el.animate

    const params = createParams({ attribute: 'data-open', duration: '400ms', ease: 'ease-out' })
    const instance = autoHeight.prepare!(el, params, fakeCtx())
    instance.activate()
    const observer = observers.at(-1)!

    // First-ever toggle: open. A `previous` that started `null` and fell back to the old
    // to-vs-scrollHeight heuristic would read this as "opening" too, but from 0 — the actual bug,
    // since the panel was already showing its 48px peek, not nothing.
    rendered = natural
    observer.fire()

    expect(frames[0]).toEqual([{ height: '48px' }, { height: '200px' }])

    instance.destroy()
    el.remove()
  })

  it('hands the authored markup back untouched on teardown, mid-peek', async () => {
    const animator = build('<div data-kui="accordion-height" data-open="false"><p>peek</p></div>')
    const host = el()
    const authored = host.innerHTML

    const natural = 200
    const peek = 48
    let rendered = peek // authored collapsed-to-peek initial state
    host.getBoundingClientRect = (() => ({ height: rendered })) as unknown as Element['getBoundingClientRect']
    Object.defineProperty(host, 'scrollHeight', { get: () => natural, configurable: true })

    animator.start()

    // A real attribute mutation and a real MutationObserver microtask — not the fake used above —
    // so teardown is proven safe after the tracked `previous` height has actually been touched by
    // a peek-to-open cycle, not just at rest.
    rendered = natural
    host.setAttribute('data-open', 'true')
    await Promise.resolve()
    await Promise.resolve()

    animator.destroy()

    expect(host.innerHTML).toBe(authored)
    expect(host.style.overflow).toBe('')
    expect(host.style.height).toBe('')
  })
})
