import { afterEach, describe, expect, it } from 'vitest'
import { createActivationBinder } from '../src/core/activation.js'
import { Animator } from '../src/core/animator.js'
import {
  axisOf,
  BREAKPOINTS,
  breakpointQuery,
  breakpointRank,
  breakpointsIn,
  createGateWatcher,
  gateMatches,
  gateProperty,
  gatedAnimationName,
  gatesOverlap,
  isBreakpoint,
} from '../src/core/breakpoints.js'
import type { EffectGate } from '../src/core/breakpoints.js'
import { defaultCapabilities } from '../src/core/capabilities.js'
import { Registry } from '../src/core/registry.js'
import { extendableRegistry } from './support/registry.js'
import { idleScheduler, fakeRoot } from './support/js-effect-harness.js'

/**
 * Viewport gates — `data-kui="fade-up above:md"`.
 *
 * The grammar half lives in `parse.test.ts` and the compiled-output half in `compile.test.ts`,
 * beside the rest of what those two modules do. What has no existing home, and is why this file
 * exists, is the *environment* half: the JavaScript mirror of a condition that is otherwise decided
 * entirely in CSS, and the live re-evaluation that mirror needs when the viewport crosses a
 * breakpoint. Neither can be asserted without a fake viewport, and nothing else in the suite has
 * one.
 *
 * The CSS half is asserted statically in `css-invariants.test.ts`, which already reads `base.css`.
 */

/** Root font size the fake viewport converts `rem` breakpoints against — jsdom's default. */
const ROOT_FONT_PX = 16

interface FakeMediaQueryList {
  media: string
  matches: boolean
  addEventListener?: (type: string, handler: () => void) => void
  removeEventListener?: (type: string, handler: () => void) => void
}

interface FakeViewport {
  matchMedia: (media: string) => FakeMediaQueryList
  resize: (width: number) => void
  /** How many `change` handlers are currently attached, across every query handed out. */
  listenerCount: () => number
}

/**
 * A resizable stand-in for `window.matchMedia`.
 *
 * jsdom implements no `matchMedia` at all, which is not merely an inconvenience — it is the case
 * `gateMatches` fails open for, so a suite that used the real thing would be asserting the fallback
 * path forever and would never once exercise a gate that is actually off.
 *
 * Only `(min-width: <n>rem)` is understood, because that is the only query shape the library ever
 * builds (see `breakpointQuery`). Anything else is a bug in the caller, not a gap here.
 *
 * @param initial - Starting viewport width in CSS pixels.
 * @param withListeners - `false` builds lists with no `addEventListener`, for the older-browser
 *   path where install-time gating still works but live re-evaluation is dropped.
 */
function fakeViewport(initial: number, withListeners = true): FakeViewport {
  const lists: { list: FakeMediaQueryList; handlers: Set<() => void> }[] = []
  let width = initial

  const evaluate = (media: string): boolean => {
    const rems = /\(min-width: ([\d.]+)rem\)/.exec(media)
    if (!rems) throw new Error(`fakeViewport was handed an unexpected query: ${media}`)
    return width >= Number(rems[1]) * ROOT_FONT_PX
  }

  return {
    matchMedia(media) {
      const handlers = new Set<() => void>()
      const list: FakeMediaQueryList = { media, matches: evaluate(media) }
      if (withListeners) {
        list.addEventListener = (_type, handler) => handlers.add(handler)
        list.removeEventListener = (_type, handler) => handlers.delete(handler)
      }
      lists.push({ list, handlers })
      return list
    },
    resize(next) {
      width = next
      for (const { list, handlers } of lists) {
        const matches = evaluate(list.media)
        if (matches === list.matches) continue
        list.matches = matches
        for (const handler of [...handlers]) handler()
      }
    },
    listenerCount() {
      return lists.reduce((total, entry) => total + entry.handlers.size, 0)
    },
  }
}

/** The fake, typed as the `Window` the production signatures ask for. */
function asWindow(viewport: FakeViewport): Window {
  return viewport as unknown as Window
}

describe('the breakpoint scale', () => {
  it('is Tailwind v4 defaults, in rem, narrowest first', () => {
    // Locked deliberately. These names are the library's public vocabulary the moment an author
    // writes `above:md`, and `base.css` hardcodes the same five widths as media queries — so a
    // change here is a change to both a published grammar and a shipped stylesheet, and should
    // have to break this assertion to happen.
    expect(BREAKPOINTS).toEqual({
      sm: '40rem',
      md: '48rem',
      lg: '64rem',
      xl: '80rem',
      '2xl': '96rem',
    })
    expect(breakpointRank('sm')).toBe(0)
    expect(breakpointRank('md')).toBe(1)
    expect(breakpointRank('2xl')).toBe(4)
  })

  it('accepts only names on the scale', () => {
    expect(isBreakpoint('md')).toBe(true)
    expect(isBreakpoint('2xl')).toBe(true)
    expect(isBreakpoint('tablet')).toBe(false)
  })

  it('does not accept an inherited Object.prototype key as a breakpoint', () => {
    // `above:` values come straight off an author-written attribute, so `'constructor' in
    // BREAKPOINTS` — or a truthiness test on the lookup — would wave both of these through and
    // compile `var(--kui-above-constructor, …)`, a property nothing declares, which resolves to its
    // fallback and leaves the gate silently on everywhere.
    expect(isBreakpoint('constructor')).toBe(false)
    expect(isBreakpoint('__proto__')).toBe(false)
  })

  it('builds only min-width queries, so the two directions share one boundary', () => {
    expect(breakpointQuery('md')).toBe('(min-width: 48rem)')
  })

  it('names the custom property base.css declares', () => {
    expect(gateProperty('above', 'md')).toBe('--kui-above-md')
    expect(gateProperty('below', '2xl')).toBe('--kui-below-2xl')
    // Shared verbatim with the container axis — one function, both axes, see its own comment.
    expect(gateProperty('wide', 'md')).toBe('--kui-wide-md')
    expect(gateProperty('narrow', '2xl')).toBe('--kui-narrow-2xl')
  })
})

describe('axisOf', () => {
  it('pairs each direction with the other half of its own axis', () => {
    expect(axisOf('above')).toEqual(['above', 'below'])
    expect(axisOf('below')).toEqual(['above', 'below'])
    expect(axisOf('wide')).toEqual(['wide', 'narrow'])
    expect(axisOf('narrow')).toEqual(['wide', 'narrow'])
  })
})

describe('gatedAnimationName', () => {
  it('leaves an ungated track as a bare ident', () => {
    expect(gatedAnimationName('kui-in-up', undefined)).toBe('kui-in-up')
  })

  it('wraps a gated track in the switch property, keeping the ident as the fallback', () => {
    expect(gatedAnimationName('kui-in-up', { above: 'md' })).toBe('var(--kui-above-md, kui-in-up)')
    expect(gatedAnimationName('kui-in-up', { below: 'lg' })).toBe('var(--kui-below-lg, kui-in-up)')
  })

  it('nests both halves of a band, above outermost', () => {
    expect(gatedAnimationName('kui-in-up', { above: 'md', below: 'xl' })).toBe(
      'var(--kui-above-md, var(--kui-below-xl, kui-in-up))',
    )
  })

  it('wraps a container gate the same way, switch property named wide/narrow', () => {
    expect(gatedAnimationName('kui-in-up', { wide: 'md' })).toBe('var(--kui-wide-md, kui-in-up)')
    expect(gatedAnimationName('kui-in-up', { narrow: 'lg' })).toBe(
      'var(--kui-narrow-lg, kui-in-up)',
    )
  })

  it('nests both halves of a container band, wide outermost', () => {
    expect(gatedAnimationName('kui-in-up', { wide: 'md', narrow: 'xl' })).toBe(
      'var(--kui-wide-md, var(--kui-narrow-xl, kui-in-up))',
    )
  })

  it('nests all four conditions when both axes are gated, viewport outermost', () => {
    // Order is readability only — every condition ANDs together through the chain of fallbacks —
    // but the compiled output has to be exact and stable, since `compile.test.ts` and
    // `css-invariants.test.ts` both depend on the literal string.
    expect(
      gatedAnimationName('kui-in-up', { above: 'md', below: 'xl', wide: 'sm', narrow: 'lg' }),
    ).toBe('var(--kui-above-md, var(--kui-below-xl, var(--kui-wide-sm, var(--kui-narrow-lg, kui-in-up))))')
  })
})

describe('gateMatches', () => {
  it('matches an ungated segment without asking the environment anything', () => {
    expect(gateMatches(undefined, undefined)).toBe(true)
  })

  it('fails OPEN where there is no matchMedia to ask', () => {
    // A server render, a bare Node runtime, and jsdom all land here. Failing closed would let an
    // environment with no viewport decide that every gated effect is off — a silent no-op, which
    // is the one thing the grammar promises never to produce.
    expect(gateMatches({ above: 'md' }, undefined)).toBe(true)
    expect(gateMatches({ above: 'md' }, {} as Window)).toBe(true)
  })

  it('treats `above` as inclusive of its own breakpoint', () => {
    const win = asWindow(fakeViewport(768))
    expect(gateMatches({ above: 'md' }, win)).toBe(true)
    expect(gateMatches({ above: 'lg' }, win)).toBe(false)
  })

  it('treats `below` as exclusive of its own breakpoint', () => {
    const win = asWindow(fakeViewport(768))
    expect(gateMatches({ below: 'md' }, win)).toBe(false)
    expect(gateMatches({ below: 'lg' }, win)).toBe(true)
  })

  it('tiles the axis: exactly one of a complementary pair matches at every width', () => {
    // The property the whole `above`/`below` spelling exists to guarantee, checked either side of
    // a boundary and exactly on it. A `min-width`/`max-width` pair fails the middle case by
    // running both.
    for (const width of [767, 768, 769]) {
      const win = asWindow(fakeViewport(width))
      const both = [gateMatches({ above: 'md' }, win), gateMatches({ below: 'md' }, win)]
      expect(both.filter(Boolean)).toHaveLength(1)
    }
  })

  it('requires both halves of a band', () => {
    expect(gateMatches({ above: 'md', below: 'xl' }, asWindow(fakeViewport(1000)))).toBe(true)
    expect(gateMatches({ above: 'md', below: 'xl' }, asWindow(fakeViewport(600)))).toBe(false)
    expect(gateMatches({ above: 'md', below: 'xl' }, asWindow(fakeViewport(1400)))).toBe(false)
  })
})

describe('gatesOverlap', () => {
  it('treats an ungated segment as live at every width', () => {
    expect(gatesOverlap(undefined, undefined)).toBe(true)
    expect(gatesOverlap({ above: 'lg' }, undefined)).toBe(true)
    expect(gatesOverlap(undefined, { below: 'sm' })).toBe(true)
  })

  it('separates a complementary pair at their shared boundary', () => {
    // The whole reason `channels.ts` asks: `fade-up below:md, parallax-y above:md` both own
    // `translate`, and without this the compiler refuses the pair and drops its second half at
    // every width — the exact list the feature exists to make expressible.
    expect(gatesOverlap({ below: 'md' }, { above: 'md' })).toBe(false)
    expect(gatesOverlap({ above: 'md' }, { below: 'md' })).toBe(false)
  })

  it('overlaps two conditions that share any width', () => {
    expect(gatesOverlap({ above: 'md' }, { above: 'lg' })).toBe(true)
    expect(gatesOverlap({ below: 'md' }, { below: 'lg' })).toBe(true)
    expect(gatesOverlap({ above: 'md', below: 'lg' }, { above: 'md' })).toBe(true)
  })

  it('separates adjacent bands', () => {
    expect(gatesOverlap({ above: 'md', below: 'lg' }, { above: 'lg' })).toBe(false)
    expect(gatesOverlap({ above: 'md', below: 'lg' }, { below: 'md' })).toBe(false)
  })

  it('separates a complementary pair on the container axis exactly as it does on the viewport one', () => {
    expect(gatesOverlap({ narrow: 'md' }, { wide: 'md' })).toBe(false)
    expect(gatesOverlap({ wide: 'md' }, { narrow: 'md' })).toBe(false)
  })

  it('requires agreement on BOTH axes: a viewport overlap does not survive a container disjunction', () => {
    // `wide:md` and `above:md` are independent questions — a wide container in a narrow viewport
    // is ordinary layout — so two effects that clearly overlap on one axis still cannot collide if
    // they are disjoint on the other. This is the case `channels.ts` needs: two effects sharing a
    // channel, both live at every viewport width, but never live in the same container width.
    expect(gatesOverlap({ above: 'md', narrow: 'lg' }, { above: 'md', wide: 'lg' })).toBe(false)
  })

  it('overlaps when both axes agree', () => {
    expect(gatesOverlap({ above: 'md', wide: 'sm' }, { above: 'lg', wide: 'md' })).toBe(true)
  })

  it('treats a gate with only a container half as live at every viewport width', () => {
    expect(gatesOverlap({ wide: 'md' }, { above: 'lg' })).toBe(true)
  })
})

describe('breakpointsIn', () => {
  it('is empty for an ungated list', () => {
    expect(breakpointsIn([])).toEqual([])
    expect(breakpointsIn([{}])).toEqual([])
  })

  it('collects both directions and deduplicates', () => {
    const gates: EffectGate[] = [{ above: 'md' }, { below: 'md' }, { above: 'lg', below: 'xl' }]
    // Insertion order, which is the order the gates were read in — not the scale's order, since
    // nothing downstream cares which breakpoint is bound first.
    expect(breakpointsIn(gates)).toEqual(['md', 'lg', 'xl'])
  })
})

describe('createGateWatcher', () => {
  it('binds nothing at all when the environment has no matchMedia', () => {
    const seen: Element[] = []
    const watcher = createGateWatcher(undefined, (el) => seen.push(el))
    // Every call still has to be accepted: install-time gating already ran and was correct, so a
    // browser (or a server) with no matchMedia is stale after a resize, not broken at load.
    expect(() => watcher.watch(document.createElement('div'), ['md'])).not.toThrow()
    watcher.destroy()
    expect(seen).toEqual([])
  })

  it('binds nothing when the MediaQueryList predates addEventListener', () => {
    const viewport = fakeViewport(600, false)
    const seen: Element[] = []
    const watcher = createGateWatcher(asWindow(viewport), (el) => seen.push(el))
    watcher.watch(document.createElement('div'), ['md'])
    viewport.resize(1000)
    expect(seen).toEqual([])
    watcher.destroy()
  })

  it('notifies only the elements watching the breakpoint that moved', () => {
    const viewport = fakeViewport(600)
    const narrow = document.createElement('div')
    const wide = document.createElement('div')
    const seen: Element[] = []
    const watcher = createGateWatcher(asWindow(viewport), (el) => seen.push(el))
    watcher.watch(narrow, ['md'])
    watcher.watch(wide, ['xl'])

    viewport.resize(800)
    expect(seen).toEqual([narrow])

    viewport.resize(1400)
    expect(seen).toEqual([narrow, wide])
    watcher.destroy()
  })

  it('binds one listener per breakpoint however many elements share it', () => {
    const viewport = fakeViewport(600)
    const watcher = createGateWatcher(asWindow(viewport), () => {})
    watcher.watch(document.createElement('div'), ['md'])
    watcher.watch(document.createElement('div'), ['md'])
    watcher.watch(document.createElement('div'), ['md', 'lg'])
    expect(viewport.listenerCount()).toBe(2)
    watcher.destroy()
  })

  it('stops notifying an unwatched element, and treats an empty list as unwatching', () => {
    const viewport = fakeViewport(600)
    const explicit = document.createElement('div')
    const emptied = document.createElement('div')
    const seen: Element[] = []
    const watcher = createGateWatcher(asWindow(viewport), (el) => seen.push(el))
    watcher.watch(explicit, ['md'])
    watcher.watch(emptied, ['md'])

    watcher.unwatch(explicit)
    // An element that no longer carries a gate re-registers with nothing, rather than the caller
    // having to remember to call `unwatch` on the other side of a branch.
    watcher.watch(emptied, [])

    viewport.resize(1000)
    expect(seen).toEqual([])
    watcher.destroy()
  })

  it('detaches every listener on destroy', () => {
    const viewport = fakeViewport(600)
    const seen: Element[] = []
    const watcher = createGateWatcher(asWindow(viewport), (el) => seen.push(el))
    watcher.watch(document.createElement('div'), ['md'])
    expect(viewport.listenerCount()).toBe(1)

    watcher.destroy()
    expect(viewport.listenerCount()).toBe(0)
    viewport.resize(1000)
    expect(seen).toEqual([])
  })
})

/**
 * A JavaScript-rendered primitive that records every `prepare` and every `destroy`.
 *
 * A locally registered probe rather than a catalog name, for the reason `sequence.test.ts` gives
 * for its own: the question here is about the *renderer*, not about any particular effect, and any
 * catalog name picked as "the JavaScript one" is a fixture with an expiry date.
 */
function registryWithProbe(log: string[]): Registry {
  const registry = extendableRegistry()
  registry.registerPrimitive({
    id: 'probe',
    renderer: 'javascript',
    channels: ['text'],
    parameters: {},
    supportedTimelines: ['time'],
    supportedActivations: ['load'],
    defaultActivation: 'load',
    perfClass: 'paint',
    reducedMotion: 'shorten',
    prepare() {
      log.push('prepare')
      return {
        activate() {},
        cancel() {},
        finish() {},
        finished: Promise.resolve(),
        destroy() {
          log.push('destroy')
        },
      }
    },
  })
  registry.registerPreset({ name: 'probe', primitive: 'probe' })
  return registry
}

function animatorFor(registry: Registry): Animator {
  return new Animator({
    root: document.body,
    registry,
    capabilities: defaultCapabilities({ individualTransforms: true }),
    binder: createActivationBinder({ createObserver: undefined }),
    scheduler: idleScheduler,
    rootResolver: () => fakeRoot,
  })
}

describe('the animator honours a gate on a JavaScript-rendered effect', () => {
  let animator: Animator | undefined

  afterEach(() => {
    animator?.destroy()
    animator = undefined
    delete (globalThis.window as Partial<Window>).matchMedia
    document.body.innerHTML = ''
  })

  /** Install the fake on the jsdom window the animator will read through `el.ownerDocument`. */
  function useViewport(width: number): FakeViewport {
    const viewport = fakeViewport(width)
    Object.defineProperty(globalThis.window, 'matchMedia', {
      value: viewport.matchMedia,
      configurable: true,
      writable: true,
    })
    return viewport
  }

  it('does not prepare a JS effect whose gate is not satisfied', () => {
    // The half CSS cannot do. A JS-rendered effect emits no `animation-name`, so there is no
    // declaration for a stylesheet to neutralise and the decision has to be made at install.
    useViewport(600)
    const log: string[] = []
    document.body.innerHTML = `<p data-kui="probe above:md">x</p>`
    animator = animatorFor(registryWithProbe(log))
    animator.start()
    expect(log).toEqual([])
  })

  it('prepares it when the gate is satisfied', () => {
    useViewport(1000)
    const log: string[] = []
    document.body.innerHTML = `<p data-kui="probe above:md">x</p>`
    animator = animatorFor(registryWithProbe(log))
    animator.start()
    expect(log).toEqual(['prepare'])
  })

  it('tears the effect down and rebuilds it when the viewport crosses the breakpoint', () => {
    // GSAP's `matchMedia` exists precisely because this transition has to revert what the previous
    // breakpoint set up. Here it reuses `release` + `process` — the same pair an attribute edit
    // takes — so the JS effect's own `destroy()` runs and both ledgers unwind before the new plan
    // is installed, rather than a second, partial teardown existing alongside the tested one.
    const viewport = useViewport(1000)
    const log: string[] = []
    document.body.innerHTML = `<p data-kui="probe above:md">x</p>`
    animator = animatorFor(registryWithProbe(log))
    animator.start()
    expect(log).toEqual(['prepare'])

    viewport.resize(600)
    expect(log).toEqual(['prepare', 'destroy'])

    viewport.resize(1000)
    expect(log).toEqual(['prepare', 'destroy', 'prepare'])
  })

  it('watches nothing for an ungated element, and stops watching one that loses its gate', () => {
    const viewport = useViewport(1000)
    const log: string[] = []
    document.body.innerHTML = `<p data-kui="probe">x</p>`
    animator = animatorFor(registryWithProbe(log))
    animator.start()
    // Nothing gated, so no MediaQueryList was ever asked for, let alone listened to.
    expect(viewport.listenerCount()).toBe(0)

    const el = document.body.querySelector('[data-kui]')!
    el.setAttribute('data-kui', 'probe above:md')
    animator.process(el)
    expect(viewport.listenerCount()).toBe(1)

    // Editing the gate away has to unregister, or every later resize would keep recompiling an
    // element that no longer has anything to re-decide.
    el.setAttribute('data-kui', 'probe')
    animator.process(el)
    viewport.resize(600)
    expect(log).toEqual(['prepare', 'destroy', 'prepare', 'destroy', 'prepare'])
  })
})
