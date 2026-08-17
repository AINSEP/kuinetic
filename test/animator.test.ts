import { beforeEach, describe, expect, it } from 'vitest'
import type { ActivationBinder } from '../src/core/activation.js'
import { Animator } from '../src/core/animator.js'
import { ATTR } from '../src/core/attrs.js'
import type { Capabilities } from '../src/core/capabilities.js'
import { collectingReporter } from '../src/core/reporter.js'
import type { CollectingReporter } from '../src/core/reporter.js'
import type { Activation } from '../src/core/types.js'
import { createRegistry } from '../src/effects/index.js'

const CAPS: Capabilities = {
  viewTimeline: true,
  scrollTimeline: true,
  animationRange: true,
  individualTransforms: true,
  scrollTimelineName: true,
  viewTransitions: true,
  intersectionObserver: true,
  reducedMotion: false,
}

interface FakeBinder extends ActivationBinder {
  bindings: Array<{ el: Element; activation: Activation; threshold: string }>
  fire(el: Element): void
  unbound: number
}

/**
 * Stand-in for the real binder. Injecting it is what lets visibility-driven behaviour be tested
 * without layout, an IntersectionObserver polyfill, or timers.
 */
function fakeBinder(): FakeBinder {
  const bindings: FakeBinder['bindings'] = []
  const callbacks = new Map<Element, () => void>()
  const binder: FakeBinder = {
    bindings,
    unbound: 0,
    bind(el, activation, threshold, onActivate) {
      bindings.push({ el, activation, threshold })
      callbacks.set(el, onActivate)
      return () => {
        binder.unbound++
        callbacks.delete(el)
      }
    },
    fire(el) {
      callbacks.get(el)?.()
    },
    destroy() {},
  }
  return binder
}

let reporter: CollectingReporter
let binder: FakeBinder

function build(html: string, capabilities: Partial<Capabilities> = {}) {
  document.body.innerHTML = html
  reporter = collectingReporter()
  binder = fakeBinder()
  const animator = new Animator({
    root: document.body,
    registry: createRegistry(),
    capabilities: { ...CAPS, ...capabilities },
    reporter,
    binder,
  })
  animator.start()
  return animator
}

function el(selector = '[data-kui]'): HTMLElement {
  return document.body.querySelector(selector) as HTMLElement
}

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('Animator.scan', () => {
  it('processes elements and stamps the normalized attribute', () => {
    build('<div data-kui="fade-up"></div>')
    expect(el().getAttribute(ATTR.normalized)).toBe('fade-up')
    expect(el().getAttribute(ATTR.state)).toBe('ready')
  })

  it('writes the compiled animation declarations', () => {
    build('<div data-kui="fade-up 800ms"></div>')
    expect(el().style.getPropertyValue('animation-name')).toBe('kui-in-up')
    expect(el().style.getPropertyValue('animation-duration')).toBe('800ms')
  })

  it('processes the scan root itself, not only its descendants', () => {
    // A subtree inserted by MutationObserver usually carries the attribute on its top node.
    document.body.innerHTML = '<section data-kui="fade-up"><p>x</p></section>'
    const animator = new Animator({
      root: document.body.firstElementChild as ParentNode,
      registry: createRegistry(),
      capabilities: CAPS,
      binder: fakeBinder(),
    })
    animator.start()
    expect(document.body.firstElementChild?.getAttribute(ATTR.normalized)).toBe('fade-up')
  })

  it('is idempotent — rescanning an unchanged element does not rebind', () => {
    const animator = build('<div data-kui="fade-up"></div>')
    animator.scan()
    expect(binder.bindings).toHaveLength(1)
  })
})

describe('Animator — unknown effects', () => {
  it('does not stamp data-kui-fx, so a later registration can still claim the element', () => {
    // Stamping here would make the `[data-kui-fx]` guard skip this element permanently.
    build('<div data-kui="not-a-real-effect"></div>')
    expect(el().hasAttribute(ATTR.normalized)).toBe(false)
    expect(el().getAttribute(ATTR.state)).toBe('pending')
  })

  it('routes the warning to the injected reporter rather than the console', () => {
    build('<div data-kui="not-a-real-effect"></div>')
    expect(reporter.messages.join()).toContain('unknown effect')
  })

  it('installs the valid effect when only one name in a list is unknown', () => {
    build('<div data-kui="fade-up, bogus"></div>')
    expect(el().getAttribute(ATTR.normalized)).toBe('fade-up')
  })
})

describe('Animator — activation', () => {
  it('defers a reveal and starts it when the binding fires', () => {
    build('<div data-kui="fade-up"></div>')
    expect(el().style.getPropertyValue('animation-play-state')).toBe('paused')

    binder.fire(el())
    expect(el().style.getPropertyValue('animation-play-state')).toBe('running')
    expect(el().getAttribute(ATTR.state)).toBe('running')
  })

  it('binds the authored activation and threshold', () => {
    build('<div data-kui="fade-up on:hover" data-kui-threshold="30%"></div>')
    expect(binder.bindings[0]).toMatchObject({ activation: 'hover', threshold: '30%' })
  })

  it('starts on:load immediately without binding', () => {
    build('<div data-kui="fade-up on:load"></div>')
    expect(el().style.getPropertyValue('animation-play-state')).toBe('running')
    expect(binder.bindings).toHaveLength(0)
  })

  it('does not bind when a native timeline drives progress', () => {
    build('<div data-kui="parallax-y" data-kui-timeline="view"></div>')
    expect(binder.bindings).toHaveLength(0)
    expect(el().style.getPropertyValue('animation-timeline')).toBe('view()')
  })

  it('binds an observer when the browser lacks native timelines', () => {
    build('<div data-kui="parallax-y" data-kui-timeline="view"></div>', { viewTimeline: false })
    expect(binder.bindings[0]?.activation).toBe('enter')
  })
})

describe('Animator — recompilation and teardown', () => {
  it('recompiles when the source attribute changes', () => {
    const animator = build('<div data-kui="fade-up"></div>')
    el().setAttribute(ATTR.source, 'zoom-in')
    animator.process(el())

    expect(el().getAttribute(ATTR.normalized)).toBe('zoom-in')
    expect(el().style.getPropertyValue('animation-name')).toBe('kui-zoom-in')
    expect(binder.unbound).toBe(1)
  })

  it('releases bindings and library attributes on destroy', () => {
    const animator = build('<div data-kui="fade-up"></div>')
    animator.destroy()

    expect(el().hasAttribute(ATTR.normalized)).toBe(false)
    expect(el().hasAttribute(ATTR.rm)).toBe(false)
    expect(binder.unbound).toBe(1)
  })
})

describe('Animator — stagger', () => {
  it('indexes only the animated children', () => {
    build(`
      <ul data-kui-stagger="60ms">
        <li data-kui="fade-up"></li>
        <li>not animated</li>
        <li data-kui="fade-up"></li>
      </ul>
    `)
    const items = [...document.querySelectorAll('li')] as HTMLElement[]
    expect(items[0]?.style.getPropertyValue('--kui-i')).toBe('0')
    expect(items[1]?.style.getPropertyValue('--kui-i')).toBe('')
    expect(items[2]?.style.getPropertyValue('--kui-i')).toBe('1')
  })

  it('writes the step onto the group', () => {
    build('<ul data-kui-stagger="60ms"><li data-kui="fade-up"></li></ul>')
    expect(el('ul').style.getPropertyValue('--kui-stagger')).toBe('60ms')
  })
})

describe('Animator — fail-open cloak', () => {
  it('removes the cloak attribute on start', () => {
    document.documentElement.setAttribute(ATTR.cloak, '')
    build('<div data-kui="fade-up"></div>')
    expect(document.documentElement.hasAttribute(ATTR.cloak)).toBe(false)
  })
})

describe('Animator — activation failure isolation', () => {
  // `tab-indicator-slide`'s `follow` param is handed straight to `querySelector` (see
  // `prepareIndicator` in src/effects/layout/primitives.ts) with no validation — an author value
  // that is not a legal selector throws there. That real setup only runs once `activate()` calls
  // the deferred instance, which for `on:load` (this preset's default activation) happens
  // synchronously inside `scan()`'s per-element loop — the same loop that processes every other
  // `[data-kui]` element on the page.
  it("does not let one element's throwing effect stop the next element from activating", () => {
    build(
      '<div data-kui="tab-indicator-slide follow:]"></div>' +
        '<div data-kui="fade-up on:load"></div>',
    )
    const [, next] = [...document.body.querySelectorAll('[data-kui]')] as HTMLElement[]

    // Before the fix, the throw out of the first element's activate() unwound scan()'s loop and
    // the second element was never processed at all — no normalized attribute, no state, nothing.
    expect(next?.getAttribute(ATTR.normalized)).toBe('fade-up')
    expect(next?.getAttribute(ATTR.state)).toBe('running')
    expect(next?.style.getPropertyValue('animation-play-state')).toBe('running')
  })

  it('marks the offending element failed and warns instead of hanging as "running"', () => {
    build('<div data-kui="tab-indicator-slide follow:]"></div>')
    expect(el().getAttribute(ATTR.state)).toBe('failed')
    expect(reporter.messages.join()).toContain('failed to activate')
  })
})
