// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Animator } from '../src/core/animator.js'
import { ATTR } from '../src/core/attrs.js'
import { createActivationBinder } from '../src/core/activation.js'
import { Registry } from '../src/core/registry.js'
import type { ScrollRoot, ScrollScheduler } from '../src/core/scroll-scheduler.js'
import type { Primitive } from '../src/core/types.js'
import { CAPS, fakeBinder } from './support/animator-harness.js'
import type { FakeBinder } from './support/animator-harness.js'
import { catalogRegistry } from './support/registry.js'

/**
 * The reconcile's own integration pass (target:-everywhere plan §4): every phase test up to this
 * one drives its module against a hand-built `AnimatorPort` double. This file is the seam where
 * those modules meet a *real* `Animator`, a real DOM, and (where the assertion needs it) a real
 * `MutationObserver` — the composed behaviour no single phase's fake port could show on its own.
 *
 * `toEqual` on an array of DOM elements is a trap here (target-group-gate.test.ts's own R-2 fix,
 * see its `expectOrder` helper): two bare, unattributed elements are structurally identical to a
 * deep-equality matcher, so any element-array comparison in this file goes through `expectOrder`
 * below, never `toEqual`.
 */
function expectOrder(actual: Element[], ...expected: Element[]): void {
  expect(actual).toHaveLength(expected.length)
  expected.forEach((el, i) => expect(actual[i]).toBe(el))
}

/** Every animator this file starts, torn down after its test even on failure — an `observe: true`
 *  animator left running would go on scanning the next test's markup otherwise (same reasoning as
 *  `animator-observe.test.ts`'s own `running` array). */
const running: Animator[] = []
afterEach(() => {
  for (const animator of running.splice(0)) animator.destroy()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

/** The fakeBinder-driven harness every non-`func:` test below uses: deterministic control over
 *  when a deferred gate actually fires, with no layout or IntersectionObserver polyfill needed —
 *  the same recipe `animator.test.ts`'s own `build()` uses. */
function build(html: string): { animator: Animator; binder: FakeBinder } {
  document.body.innerHTML = html
  const binder = fakeBinder()
  const animator = new Animator({
    root: document.body,
    registry: catalogRegistry(),
    capabilities: CAPS,
    binder,
  })
  running.push(animator)
  animator.start()
  return { animator, binder }
}

describe('cascade + target: publishes the host\'s --kui-stagger-count', () => {
  it('is 5 after start(), for a 5-member cascade group', () => {
    build(
      '<ul id="host" data-kui="fade-up on:click target:li cascade:90ms">' +
        '<li></li><li></li><li></li><li></li><li></li>' +
        '</ul>',
    )
    const host = document.getElementById('host')!
    expect(host.style.getPropertyValue('--kui-stagger-count')).toBe('5')
  })
})

describe('grouped vs ungrouped target: binding count', () => {
  it('binds once, on the host, when the group reads as grouped (cascade:)', () => {
    const { binder } = build(
      '<ul id="host" data-kui="fade-up on:click target:li cascade:90ms">' +
        '<li></li><li></li><li></li>' +
        '</ul>',
    )
    const host = document.getElementById('host')!
    expect(binder.bindings).toHaveLength(1)
    expect(binder.bindings[0]?.el).toBe(host)
  })

  it('binds once per match, on each li, when the group has no grouped key', () => {
    const { binder } = build(
      '<ul id="host" data-kui="fade-up on:click target:li">' + '<li></li><li></li><li></li>' + '</ul>',
    )
    const host = document.getElementById('host')!
    const lis = Array.from(host.querySelectorAll('li'))
    expect(binder.bindings).toHaveLength(3)
    expectOrder(
      binder.bindings.map((b) => b.el),
      lis[0]!,
      lis[1]!,
      lis[2]!,
    )
  })
})

describe('reset() restores a target: host and its matches to pristine markup', () => {
  it('outerHTML matches exactly after reset', () => {
    document.body.innerHTML =
      '<ul id="host" data-kui="fade-up, blur-in target:li cascade:60ms">' + '<li></li><li></li>' + '</ul>'
    const host = document.getElementById('host')!
    const pristine = host.outerHTML

    const animator = new Animator({ root: document.body, registry: catalogRegistry(), capabilities: CAPS, binder: fakeBinder() })
    running.push(animator)
    animator.start()

    // Sanity: the install actually did something, so reset() has real work to undo.
    expect(host.getAttribute(ATTR.state)).toBe('ready')
    const li = host.querySelector('li')!
    expect(li.getAttribute(ATTR.state)).toBe('ready')

    animator.reset(host)

    expect(host.outerHTML).toBe(pristine)
  })
})

describe('a late-inserted target: match is adopted and ranked', () => {
  function stubSyncFrame(): void {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0)
      return 0
    })
  }
  const flushMutations = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

  it('gets --kui-i:3 once adopted; the three original siblings keep their own ranks', async () => {
    stubSyncFrame()
    document.body.innerHTML =
      '<ul id="host" data-kui="fade-up on:click target:li cascade:90ms">' +
      '<li></li><li></li><li></li>' +
      '</ul>'
    const animator = new Animator({
      root: document.body,
      registry: catalogRegistry(),
      capabilities: CAPS,
      binder: fakeBinder(),
      observe: true,
    })
    running.push(animator)
    animator.start()

    const host = document.getElementById('host')!
    const original = Array.from(host.querySelectorAll('li'))
    expect(original.map((li) => li.style.getPropertyValue('--kui-i'))).toEqual(['0', '1', '2'])

    const late = document.createElement('li')
    host.append(late)
    await flushMutations()

    expect(late.style.getPropertyValue('--kui-i')).toBe('3')
    expect(original.map((li) => li.style.getPropertyValue('--kui-i'))).toEqual(['0', '1', '2'])
    expect(host.style.getPropertyValue('--kui-stagger-count')).toBe('4')
  })

  // `restageAfterTreeRelease`'s own doc comment: "a host removed in the same batch has no state
  // left to restage". Removing the host itself takes its `li` matches out in the same synchronous
  // DOM operation, so `releaseTree`'s `candidates` list (the removed root plus every descendant)
  // carries both the host and its former matches — by the time the former-host lookup runs, the
  // host's own `release()` (earlier in that same `candidates` pass) has already dropped its
  // `InstanceState`, so `restageAfterTreeRelease` must skip it rather than restage a dead host.
  it('removing an entire target: host subtree at once does not throw restaging a released host', async () => {
    stubSyncFrame()
    document.body.innerHTML = '<div id="wrap"><ul id="host" data-kui="fade-up target:li cascade:90ms"><li></li><li></li></ul></div>'
    const animator = new Animator({
      root: document.body,
      registry: catalogRegistry(),
      capabilities: CAPS,
      binder: fakeBinder(),
      observe: true,
    })
    running.push(animator)
    animator.start()

    const host = document.getElementById('host')!
    expect(animator.derivedOf(host)).toHaveLength(2)

    host.remove()
    await expect(flushMutations()).resolves.toBeUndefined()
  })

  // The other half of the same function: a match removed on its own, host untouched, restages the
  // surviving host (`restageTargets`/`syncAggregate` both actually run, unlike the skip branch
  // above) — `--kui-stagger-count` drops from 3 to 2 once only two matches are left to rank.
  it('removing one match (host untouched) restages the surviving host', async () => {
    stubSyncFrame()
    document.body.innerHTML =
      '<ul id="host" data-kui="fade-up target:li cascade:90ms"><li></li><li></li><li></li></ul>'
    const animator = new Animator({
      root: document.body,
      registry: catalogRegistry(),
      capabilities: CAPS,
      binder: fakeBinder(),
      observe: true,
    })
    running.push(animator)
    animator.start()

    const host = document.getElementById('host')!
    expect(host.style.getPropertyValue('--kui-stagger-count')).toBe('3')

    host.querySelector('li')!.remove()
    await flushMutations()

    expect(host.style.getPropertyValue('--kui-stagger-count')).toBe('2')
    expect(animator.derivedOf(host)).toHaveLength(2)
  })
})

describe('hostOf() is derivedOf()\'s inverse', () => {
  it('names the host for one of its matches, and undefined for an unrelated element', () => {
    const { animator } = build('<ul id="host" data-kui="fade-up on:click target:li"><li></li></ul><p id="other"></p>')
    const host = document.getElementById('host')!
    const li = host.querySelector('li')!
    const other = document.getElementById('other')!

    expect(animator.hostOf(li)).toBe(host)
    expect(animator.hostOf(other)).toBeUndefined()
    expect(animator.hostOf(host)).toBeUndefined()
  })
})

describe('install order: the host\'s data-kui-state is stamped after its matches\' animation-name', () => {
  it('records the host\'s data-kui-state mutation after a match\'s style mutation', () => {
    document.body.innerHTML =
      '<ul id="host" data-kui="fade-up on:click target:li cascade:90ms">' + '<li></li><li></li>' + '</ul>'
    const host = document.getElementById('host')!

    const observer = new MutationObserver(() => {})
    observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['style', ATTR.state] })

    const animator = new Animator({ root: document.body, registry: catalogRegistry(), capabilities: CAPS, binder: fakeBinder() })
    running.push(animator)
    animator.start()

    const records = observer.takeRecords()
    const matchStyleIndex = records.findIndex(
      (r) => r.type === 'attributes' && r.attributeName === 'style' && r.target !== host,
    )
    const hostStateIndex = records.findIndex(
      (r) => r.type === 'attributes' && r.attributeName === ATTR.state && r.target === host,
    )
    expect(matchStyleIndex).toBeGreaterThanOrEqual(0)
    expect(hostStateIndex).toBeGreaterThanOrEqual(0)
    expect(hostStateIndex).toBeGreaterThan(matchStyleIndex)
  })
})

describe('multi-group claims compile to one union install', () => {
  it('a match claimed by two target: groups installs once, carrying both effects', () => {
    const { animator } = build(
      '<div id="host" data-kui="fade-up target:.item, blur-in target:.item"><p class="item"></p></div>',
    )
    const host = document.getElementById('host')!
    const item = host.querySelector('.item')!

    // One derived install, not two competing ones — the D-D collision rule's union path, not a
    // last-write-wins race between the two groups that both claimed the same element.
    expectOrder(animator.derivedOf(host), item)
    const normalized = item.getAttribute(ATTR.normalized) ?? ''
    expect(normalized.split(' ')).toEqual(expect.arrayContaining(['fade-up', 'blur-in']))
  })
})

describe('data-kui-unmatched', () => {
  it('names an unmatched target: selector alongside a healthy own group', () => {
    build('<div id="host" data-kui="fade-up, pop target:.nonexistent"></div>')
    const host = document.getElementById('host')!

    // The host's own (untargeted) group still installs normally...
    expect(host.getAttribute(ATTR.state)).toBe('ready')
    // ...and the failed group is named, not silently dropped.
    expect(host.getAttribute(ATTR.unmatched)).toBe('.nonexistent')
  })
})

describe('func: fires once for a host with derived target: matches', () => {
  interface FakePrimitiveDeps {
    supportedActivations: readonly string[]
  }

  function fakeCssPrimitive({ supportedActivations }: FakePrimitiveDeps): Primitive {
    return {
      id: 'fake-css',
      renderer: 'css-keyframes',
      channels: ['opacity'],
      parameters: {},
      supportedTimelines: ['time'],
      supportedActivations: supportedActivations as Primitive['supportedActivations'],
      perfClass: 'compositor',
      reducedMotion: 'shorten',
    }
  }

  const idleScheduler: ScrollScheduler = {
    subscribe: () => () => {},
    invalidate: () => {},
    rootCount: () => 0,
    destroy: () => {},
  }

  const fakeRoot: ScrollRoot = {
    key: 'fake',
    metrics: () => ({
      scrollTop: 0,
      scrollLeft: 0,
      viewportWidth: 800,
      viewportHeight: 600,
      viewportTop: 0,
      viewportLeft: 0,
    }),
    onScroll: () => () => {},
    onResize: () => () => {},
  }

  const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

  it('is not also invoked by a derived match\'s finish bubbling up to the host', async () => {
    const onReveal = vi.fn()
    vi.stubGlobal('onReveal', onReveal)
    const registry = new Registry()
      .registerPrimitive(fakeCssPrimitive({ supportedActivations: ['load', 'enter', 'click', 'manual'] }))
      .registerPresets([{ name: 'fake-fade', primitive: 'fake-css' }])

    document.body.innerHTML =
      '<div id="group" data-kui="fake-fade func:onReveal, fake-fade target:.child" data-kui-on="load">' +
      '<div class="child"></div><div class="child"></div>' +
      '</div>'
    const animator = new Animator({
      root: document.body,
      registry,
      capabilities: CAPS,
      binder: createActivationBinder({ createObserver: undefined }),
      scheduler: idleScheduler,
      rootResolver: () => fakeRoot,
    })
    running.push(animator)
    animator.start()
    await tick()

    // Two derived matches finish too (same `fake-fade`, real DOM descendants of the host), and
    // `kui:finish` bubbles — without callback.ts's `event.target !== el` guard this would have
    // fired three times, once for the host and once per bubbled child.
    expect(onReveal).toHaveBeenCalledOnce()
    expect((onReveal.mock.calls[0]![0] as Event).target).toBe(document.getElementById('group'))
  })
})

describe('a class-free trigger:click flip card gets its faces and an injected control (R-7)', () => {
  it('stamps front/back parts and injects a wired .kui-flip-control button', () => {
    build(
      '<div id="card" data-kui="flip-card trigger:click">' +
        '<div class="a">Front</div><div class="b">Back</div>' +
        '</div>',
    )
    const card = document.getElementById('card')!

    const front = card.querySelector('.a')!
    const back = card.querySelector('.b')!
    expect(front.getAttribute(ATTR.part)).toBe('front')
    expect(back.getAttribute(ATTR.part)).toBe('back')

    const control = card.querySelector(':scope > button.kui-flip-control')
    expect(control).not.toBeNull()
    expect(control!.getAttribute('aria-pressed')).toBe('false')
    expect(control!.getAttribute(ATTR.part)).toBe('control injected')
    expect(control!.textContent).toBe('Flip card')
  })
})
