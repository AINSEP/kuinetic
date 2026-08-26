import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { createParams } from '../src/core/js-params.js'
import { createStyleLedger } from '../src/core/owned-styles.js'
import type { PrepareContext } from '../src/core/effect-context.js'
import type { ScrollRoot, ScrollScheduler, ScrollSubscriber } from '../src/core/scroll-scheduler.js'
import { NAV_CSS_PRESETS, NAV_JS_PRIMITIVES, NAVIGATION_PRESETS } from '../src/effects/navigation/index.js'
import { catalogRegistry } from './support/registry.js'

// A relative `new URL(..., import.meta.url)` throws under the jsdom test environment (its `URL`
// implementation rejects the resolved result) — resolving through `node:path` off this file's own
// URL avoids that, same trick as `catalog-numbers.test.ts`. jsdom (rather than `node`) is needed
// here because the scroll-position primitives below are exercised through real DOM elements.
const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/css/navigation.css'), 'utf8')

/** A scheduler that hands frames to whichever single subscriber last called `subscribe`. */
function fakeSchedulerRig(): { scheduler: ScrollScheduler; emit: (scrollTop: number, epoch?: number) => void } {
  let subscriber: ScrollSubscriber | undefined
  const scheduler: ScrollScheduler = {
    subscribe(_root, onFrame) {
      subscriber = onFrame
      return () => {
        subscriber = undefined
      }
    },
    invalidate() {},
    rootCount: () => (subscriber ? 1 : 0),
    destroy() {},
  }
  return {
    scheduler,
    emit(scrollTop, epoch = 0) {
      subscriber?.({
        metrics: { scrollTop, scrollLeft: 0, viewportWidth: 1000, viewportHeight: 800, viewportTop: 0, viewportLeft: 0 },
        epoch,
      })
    },
  }
}

const fakeRoot: ScrollRoot = {
  key: 'fake',
  metrics: () => ({ scrollTop: 0, scrollLeft: 0, viewportWidth: 1000, viewportHeight: 800, viewportTop: 0, viewportLeft: 0 }),
  onScroll: () => () => {},
  onResize: () => () => {},
}

function fakeCtx(el: Element, scheduler: ScrollScheduler): PrepareContext {
  return {
    win: window,
    doc: window.document,
    scheduler,
    rootFor: () => fakeRoot,
    style: createStyleLedger(el),
    invalidate: () => {},
  } as unknown as PrepareContext
}

const findJs = (id: string) => NAV_JS_PRIMITIVES.find((primitive) => primitive.id === id)!

describe('navigation catalog', () => {
  it('registers all 8 section M names', () => {
    const registry = catalogRegistry()
    expect(NAVIGATION_PRESETS).toHaveLength(8)
    expect(NAVIGATION_PRESETS.every((preset) => registry.has(preset.name))).toBe(true)
  })

  it('ships a keyframe for every CSS-tier preset', () => {
    const missing = NAV_CSS_PRESETS.filter(
      (preset) => !css.includes(`@keyframes ${preset.keyframes ?? ''}`),
    )
    expect(missing).toEqual([])
  })

  it('keeps the three scroll-position primitives at reducedMotion disable', () => {
    const registry = catalogRegistry()
    for (const name of ['header-shrink', 'header-hide-on-scroll', 'back-to-top-fade']) {
      expect(registry.resolve(name)?.primitive.reducedMotion).toBe('disable')
    }
  })

  it('does not claim ownership of focus/aria state for menu content', () => {
    // Structural guard on the documented boundary: none of these primitives declare a `state`
    // or `aria` channel, which would signal they own more than motion.
    const registry = catalogRegistry()
    for (const name of ['menu-stagger-open', 'dropdown-open', 'drawer-slide', 'mega-menu-drop']) {
      const channels = registry.resolve(name)?.primitive.channels ?? []
      expect(channels).not.toContain('aria')
    }
  })
})

/*
 * These three stamp a state attribute every frame. Nothing asserted what happened to it on
 * teardown — `header-shrink`'s test called `destroy()` as its last line and checked nothing after
 * it — so all three leaked their attribute into the author's markup forever. The browser teardown
 * sweep caught two; `header-hide-on-scroll` only escaped because the sweep never produces a
 * scroll *delta*, which is the one input its attribute depends on.
 */
describe('navigation state attributes are the library\'s, and are handed back', () => {
  afterEach(() => {
    document.body.replaceChildren()
  })

  it('header-shrink takes data-kui-shrunk back on destroy', () => {
    const el = document.createElement('header')
    document.body.append(el)
    const { scheduler, emit } = fakeSchedulerRig()
    const instance = findJs('header-shrink').prepare!(el, createParams({ offset: '120' }), fakeCtx(el, scheduler))
    instance.activate()
    emit(150)
    expect(el.getAttribute('data-kui-shrunk')).toBe('true')

    instance.destroy()
    expect(el.hasAttribute('data-kui-shrunk')).toBe(false)
  })

  it('back-to-top-fade takes data-kui-visible back on destroy', () => {
    const el = document.createElement('button')
    document.body.append(el)
    const { scheduler, emit } = fakeSchedulerRig()
    const instance = findJs('back-to-top-fade').prepare!(el, createParams({ offset: '400' }), fakeCtx(el, scheduler))
    instance.activate()
    emit(900)
    expect(el.getAttribute('data-kui-visible')).toBe('true')

    instance.destroy()
    expect(el.hasAttribute('data-kui-visible')).toBe(false)
  })

  it('header-hide-on-scroll takes data-kui-hidden back on destroy', () => {
    const el = document.createElement('header')
    document.body.append(el)
    const { scheduler, emit } = fakeSchedulerRig()
    const instance = findJs('header-hide-on-scroll').prepare!(el, createParams({ offset: '8' }), fakeCtx(el, scheduler))
    instance.activate()
    emit(200)
    expect(el.getAttribute('data-kui-hidden')).toBe('true')

    instance.destroy()
    expect(el.hasAttribute('data-kui-hidden')).toBe(false)
  })

  it('gives an author their own value back rather than deleting it', () => {
    const el = document.createElement('header')
    el.setAttribute('data-kui-shrunk', 'authored')
    document.body.append(el)
    const { scheduler, emit } = fakeSchedulerRig()
    const instance = findJs('header-shrink').prepare!(el, createParams({ offset: '120' }), fakeCtx(el, scheduler))
    instance.activate()
    emit(150)

    instance.destroy()
    expect(el.getAttribute('data-kui-shrunk')).toBe('authored')
  })
})

describe('header-shrink', () => {
  afterEach(() => {
    document.body.replaceChildren()
  })

  it('publishes shrink progress from 0 to 1 across the offset and flags the fully-shrunk boundary', () => {
    const el = document.createElement('header')
    document.body.append(el)
    const { scheduler, emit } = fakeSchedulerRig()
    const instance = findJs('header-shrink').prepare!(el, createParams({ offset: '120' }), fakeCtx(el, scheduler))
    instance.activate()

    emit(0)
    expect(el.style.getPropertyValue('--kui-shrink')).toBe('0.0000')
    expect(el.getAttribute('data-kui-shrunk')).toBe('false')

    emit(60)
    expect(el.style.getPropertyValue('--kui-shrink')).toBe('0.5000')

    emit(150)
    expect(el.style.getPropertyValue('--kui-shrink')).toBe('1.0000')
    expect(el.getAttribute('data-kui-shrunk')).toBe('true')

    instance.destroy()
  })

  it('treats a non-positive offset as always fully shrunk', () => {
    const el = document.createElement('header')
    document.body.append(el)
    const { scheduler, emit } = fakeSchedulerRig()
    const instance = findJs('header-shrink').prepare!(el, createParams({ offset: '0' }), fakeCtx(el, scheduler))
    instance.activate()

    emit(0)
    expect(el.style.getPropertyValue('--kui-shrink')).toBe('1.0000')
    expect(el.getAttribute('data-kui-shrunk')).toBe('true')

    instance.destroy()
  })
})

describe('header-hide-on-scroll', () => {
  afterEach(() => {
    document.body.replaceChildren()
  })

  it('hides past the offset on scroll-down and reveals on scroll-up', () => {
    const el = document.createElement('header')
    document.body.append(el)
    const { scheduler, emit } = fakeSchedulerRig()
    const instance = findJs('header-hide-on-scroll').prepare!(el, createParams({ offset: '8' }), fakeCtx(el, scheduler))
    instance.activate()

    emit(50)
    expect(el.getAttribute('data-kui-hidden')).toBe('true')

    emit(10)
    expect(el.getAttribute('data-kui-hidden')).toBe('false')

    instance.destroy()
  })

  it('ignores jitter smaller than the offset, leaving the attribute untouched', () => {
    const el = document.createElement('header')
    document.body.append(el)
    const { scheduler, emit } = fakeSchedulerRig()
    const instance = findJs('header-hide-on-scroll').prepare!(el, createParams({ offset: '8' }), fakeCtx(el, scheduler))
    instance.activate()

    emit(3)
    expect(el.hasAttribute('data-kui-hidden')).toBe(false)

    instance.destroy()
  })
})

describe('back-to-top-fade', () => {
  afterEach(() => {
    document.body.replaceChildren()
  })

  it('toggles visibility once scrolled past the offset', () => {
    const el = document.createElement('button')
    document.body.append(el)
    const { scheduler, emit } = fakeSchedulerRig()
    const instance = findJs('back-to-top-fade').prepare!(el, createParams({ offset: '400' }), fakeCtx(el, scheduler))
    instance.activate()

    emit(200)
    expect(el.getAttribute('data-kui-visible')).toBe('false')

    emit(500)
    expect(el.getAttribute('data-kui-visible')).toBe('true')

    instance.destroy()
  })
})
