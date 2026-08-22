import { afterEach, describe, expect, it, vi } from 'vitest'
import { createParams } from '../src/core/js-params.js'
import type { PrepareContext } from '../src/core/effect-context.js'
import { LAYOUT_PRIMITIVES } from '../src/effects/layout/primitives.js'

/**
 * Regression coverage for the layout primitives' resource-teardown discipline.
 *
 * `prepareIndicator` previously subscribed its attribute watcher *before* calling `move()`, which
 * can throw (a malformed `follow` selector reaches `querySelector` directly). A throw from `move()`
 * meant the primitive's setup never reached its `return stop` line, so the caller — `deferredInstance`
 * in `core/instances.ts` — never received a cleanup to run. The subscription was live and nothing
 * could ever disconnect it. See `flip-indicator` below.
 */

/** Only `doc` and `style.set` are read by these primitives; a partial fake is enough. */
function fakeCtx(): PrepareContext {
  return {
    doc: document,
    win: window,
    style: { set: vi.fn(), claim: vi.fn(), restore: vi.fn(), owned: () => [] },
    invalidate: vi.fn(),
  } as unknown as PrepareContext
}

const flipIndicator = LAYOUT_PRIMITIVES.find((primitive) => primitive.id === 'flip-indicator')!
const flipContainer = LAYOUT_PRIMITIVES.find((primitive) => primitive.id === 'flip-container')!
const autoHeight = LAYOUT_PRIMITIVES.find((primitive) => primitive.id === 'auto-height')!

describe('flip-indicator', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('leaves no live MutationObserver subscription when the first move() throws', () => {
    // A fake standing in for the global constructor, so the test can count subscribe/teardown
    // calls instead of only asserting "it didn't crash" — the crash is already handled by
    // `Animator.activate()`'s per-instance isolation. What matters here is the resource.
    let observeCalls = 0
    let disconnectCalls = 0
    class FakeMutationObserver {
      observe(): void {
        observeCalls++
      }
      disconnect(): void {
        disconnectCalls++
      }
    }
    vi.stubGlobal('MutationObserver', FakeMutationObserver)

    const el = document.createElement('div')
    // `]` is not a parseable selector; `ctx.doc.querySelector(selector)` throws synchronously,
    // so `move()` throws on its very first, unconditional call inside `prepareIndicator`.
    const params = createParams({
      follow: ']',
      attribute: 'aria-selected',
      duration: '400ms',
      ease: 'ease-out',
    })
    const instance = flipIndicator.prepare!(el, params, fakeCtx())

    expect(() => instance.activate()).toThrow()

    // Whatever the primitive did internally, it must not end up with a subscription that nothing
    // can reach: every `observe()` must be matched by a `disconnect()` by the time activation has
    // finished unwinding.
    expect(observeCalls).toBe(disconnectCalls)
  })

  it('still follows its target on a working selector', () => {
    const el = document.createElement('div')
    const target = document.createElement('button')
    target.id = 'active-tab'
    document.body.append(el, target)

    const params = createParams({
      follow: '#active-tab',
      attribute: 'aria-selected',
      duration: '400ms',
      ease: 'ease-out',
    })
    const setSpy = vi.fn()
    const ctx = {
      ...fakeCtx(),
      style: { set: setSpy, claim: vi.fn(), restore: vi.fn(), owned: () => [] },
    } as unknown as PrepareContext

    const instance = flipIndicator.prepare!(el, params, ctx)
    expect(() => instance.activate()).not.toThrow()
    expect(setSpy).toHaveBeenCalledWith('translate', expect.any(String))

    instance.destroy()
    target.remove()
    el.remove()
  })

  it('does nothing when the follow selector is left at its default empty string', () => {
    const el = document.createElement('div')
    const setSpy = vi.fn()
    const params = createParams({ attribute: 'aria-selected', duration: '400ms', ease: 'ease-out' })
    const ctx = {
      ...fakeCtx(),
      style: { set: setSpy, claim: vi.fn(), restore: vi.fn(), owned: () => [] },
    } as unknown as PrepareContext

    const instance = flipIndicator.prepare!(el, params, ctx)
    expect(() => instance.activate()).not.toThrow()
    expect(setSpy).not.toHaveBeenCalled()

    instance.destroy()
  })

  it('does nothing when the follow selector matches no element', () => {
    const el = document.createElement('div')
    const setSpy = vi.fn()
    const params = createParams({
      follow: '#does-not-exist',
      attribute: 'aria-selected',
      duration: '400ms',
      ease: 'ease-out',
    })
    const ctx = {
      ...fakeCtx(),
      style: { set: setSpy, claim: vi.fn(), restore: vi.fn(), owned: () => [] },
    } as unknown as PrepareContext

    const instance = flipIndicator.prepare!(el, params, ctx)
    expect(() => instance.activate()).not.toThrow()
    expect(setSpy).not.toHaveBeenCalled()

    instance.destroy()
  })

  it('installs no MutationObserver subscription when the watched attribute is left empty', () => {
    let observeCalls = 0
    class FakeMutationObserver {
      observe(): void {
        observeCalls++
      }
      disconnect(): void {}
    }
    vi.stubGlobal('MutationObserver', FakeMutationObserver)

    const el = document.createElement('div')
    const target = document.createElement('button')
    target.id = 'active-tab'
    document.body.append(el, target)

    const params = createParams({ follow: '#active-tab', attribute: '', duration: '400ms', ease: 'ease-out' })
    const instance = flipIndicator.prepare!(el, params, fakeCtx())
    instance.activate()

    expect(observeCalls).toBe(0)

    instance.destroy()
    target.remove()
    el.remove()
  })

  it('degrades to a no-op subscription in an environment without MutationObserver', () => {
    vi.stubGlobal('MutationObserver', undefined)

    const el = document.createElement('div')
    const target = document.createElement('button')
    target.id = 'active-tab'
    document.body.append(el, target)

    const params = createParams({
      follow: '#active-tab',
      attribute: 'aria-selected',
      duration: '400ms',
      ease: 'ease-out',
    })
    const instance = flipIndicator.prepare!(el, params, fakeCtx())

    expect(() => instance.activate()).not.toThrow()
    expect(() => instance.destroy()).not.toThrow()

    target.remove()
    el.remove()
  })
})

describe('flip-container', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('wires a FLIP engine to the container and disconnects cleanly on destroy', () => {
    let observeCalls = 0
    let disconnectCalls = 0
    class FakeMutationObserver {
      observe(): void {
        observeCalls++
      }
      disconnect(): void {
        disconnectCalls++
      }
    }
    vi.stubGlobal('MutationObserver', FakeMutationObserver)

    const container = document.createElement('ul')
    container.append(document.createElement('li'))
    const params = createParams({ duration: '400ms', ease: 'ease-out', scale: 'false' })
    const instance = flipContainer.prepare!(container, params, fakeCtx())

    instance.activate()
    expect(observeCalls).toBe(1)

    instance.destroy()
    expect(disconnectCalls).toBe(1)
  })
})

describe('auto-height', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('restarts the height animation on each attribute toggle and cancels the running one on destroy', () => {
    // Registered by pushing `this` into a list rather than assigning it to an outer `latest`
    // binding. Same reach, but it does not alias the instance to a variable — which is the thing
    // `no-this-alias` exists to stop, because such an alias silently outlives whatever it named.
    // Keeping every observer rather than only the most recent is also strictly more informative
    // if this test ever grows a second one.
    const observers: Array<{ fire: () => void }> = []
    const latest = (): { fire: () => void } => {
      const last = observers.at(-1)
      if (!last) throw new Error('no MutationObserver was constructed')
      return last
    }
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

    const el = document.createElement('div')
    document.body.append(el)

    // A stand-in for the Web Animations API, which jsdom does not implement: each call records a
    // distinct `cancel` spy, so the assertions below can tell *which* animation a later toggle or
    // destroy actually cancelled.
    const cancels: Array<ReturnType<typeof vi.fn>> = []
    const fakeAnimate = (): Animation => {
      const cancel = vi.fn()
      cancels.push(cancel)
      return { cancel } as unknown as Animation
    }
    el.animate = fakeAnimate as unknown as typeof el.animate

    const params = createParams({ attribute: 'data-open', duration: '400ms', ease: 'ease-out' })
    const instance = autoHeight.prepare!(el, params, fakeCtx())
    instance.activate()

    latest().fire()
    expect(cancels).toHaveLength(1)
    expect(cancels[0]).not.toHaveBeenCalled()

    // A second toggle must cancel the animation the first toggle started, not just replace it.
    latest().fire()
    expect(cancels).toHaveLength(2)
    expect(cancels[0]).toHaveBeenCalledOnce()

    // Destroying mid-animation must cancel whichever one is still running.
    instance.destroy()
    expect(cancels[1]).toHaveBeenCalledOnce()

    el.remove()
  })

  /*
   * A mutation observer is a reaction: by the time it runs, the stylesheet has already repainted
   * the panel at its new resting height. Reading that height as the animation's *start* is what
   * made closing play forwards — the panel snapped shut, grew back open over 400ms, then cut to
   * nothing. The rendered height is the **end**; the start is the previous resting height.
   *
   * Watched in the browser first (`0 → 44.9 → 0`, both directions ramping) and pinned here.
   */
  it('animates towards the height the stylesheet settled on, in whichever direction that is', () => {
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

    const el = document.createElement('div')
    document.body.append(el)

    // jsdom has no layout, so both readings the primitive makes are stubbed directly: `rendered` is
    // what the stylesheet is showing right now, `natural` the unconstrained content height.
    let rendered = 0
    const natural = 45
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

    // Opening: the panel is already laid out at its natural height, so it has to come from zero.
    rendered = natural
    observer.fire()
    expect(frames[0]).toEqual([{ height: '0px' }, { height: '45px' }])

    // Closing: the stylesheet has already collapsed it. Starting from the rendered 0 would replay
    // the opening animation and then cut — the bug. It must start from where it just was.
    rendered = 0
    observer.fire()
    expect(frames[1]).toEqual([{ height: '45px' }, { height: '0px' }])

    // And the tracked previous height keeps a partial ("peek") collapsed state honest too.
    rendered = natural
    observer.fire()
    expect(frames[2]).toEqual([{ height: '0px' }, { height: '45px' }])

    instance.destroy()
    el.remove()
  })

  /*
   * `scrollHeight` is a rounded integer while the rendered height is fractional, so an open 44.8px
   * panel reports 45 — before the fix below, the old to-vs-scrollHeight heuristic read that as
   * "shorter than its content" and mistook opening for closing. Seeding `previous` from the actual
   * rendered height at `activate()` sidesteps the rounding gap entirely: it never consults
   * `scrollHeight`. The element starts collapsed (0) at activation, same as any authored panel, and
   * only reaches its fractional natural height once the toggle actually opens it.
   */
  it('does not mistake a sub-pixel rounding gap for a collapsed panel', () => {
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

    const el = document.createElement('div')
    document.body.append(el)
    let rendered = 0 // collapsed, same as the DOM looks before the panel is ever opened
    el.getBoundingClientRect = (() => ({ height: rendered })) as unknown as Element['getBoundingClientRect']
    Object.defineProperty(el, 'scrollHeight', { get: () => 45 })

    const frames: Array<Array<Record<string, string>>> = []
    el.animate = ((keyframes: Array<Record<string, string>>) => {
      frames.push(keyframes)
      return { cancel: vi.fn() } as unknown as Animation
    }) as unknown as typeof el.animate

    const params = createParams({ attribute: 'data-open', duration: '400ms', ease: 'ease-out' })
    const instance = autoHeight.prepare!(el, params, fakeCtx())
    instance.activate()

    rendered = 44.8 // the stylesheet's own fractional natural height, once the toggle opens it
    observers.at(-1)!.fire()

    expect(frames[0]).toEqual([{ height: '0px' }, { height: '44.8px' }])

    instance.destroy()
    el.remove()
  })
})
