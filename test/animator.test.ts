import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Animator, createAnimator } from '../src/core/animator.js'
import { ATTR } from '../src/core/attrs.js'
import type { Capabilities } from '../src/core/capabilities.js'
import { collectingReporter } from '../src/core/reporter.js'
import type { CollectingReporter } from '../src/core/reporter.js'
import { CAPS, fakeBinder } from './support/animator-harness.js'
import type { FakeBinder } from './support/animator-harness.js'
import { catalogRegistry } from './support/registry.js'

let reporter: CollectingReporter
let binder: FakeBinder

function build(html: string, capabilities: Partial<Capabilities> = {}) {
  document.body.innerHTML = html
  reporter = collectingReporter()
  binder = fakeBinder()
  const animator = new Animator({
    root: document.body,
    registry: catalogRegistry(),
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
      registry: catalogRegistry(),
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

  it('spends the one-shot enter binding on a programmatic activation', () => {
    // Regression: a reveal started by `activate()` left its enter-observer armed, so scrolling the
    // element into view afterwards delivered a SECOND activation to the same instance —
    // `createCssInstance` reads that as a repeat and answers with `animation.reverse()`, wiping a
    // finished `wipe-circle` back down to `circle(0)`. Verified in Chrome: `playbackRate` flipped
    // to -1 and `clip-path` counted 75% → 0% the moment the element scrolled in.
    const animator = build('<div data-kui="wipe-circle"></div>')
    const target = el()
    expect(binder.bindings[0]?.activation).toBe('enter')

    const instance = animator.stateOf(target)?.instances[0]
    const activate = vi.spyOn(instance!, 'activate')

    animator.activate(target)
    expect(activate).toHaveBeenCalledTimes(1)
    expect(binder.unbound).toBe(1)

    binder.fire(target)
    expect(activate).toHaveBeenCalledTimes(1)

    // `releaseOnce` is also reachable from the element's own abort signal on teardown — an
    // already-spent binding hitting that second path must no-op, not double-release.
    expect(() => animator.destroy()).not.toThrow()
    expect(binder.unbound).toBe(1)
  })

  it('keeps a toggle binding armed after activation, so a repeat trigger can still fire', () => {
    // The other side of the fix: releasing a `click`/`hover` binding on first use is exactly what
    // would stop a card flip flipping back, which is what `createCssInstance`'s reverse exists for.
    const animator = build('<div data-kui="card-flip-y on:click"></div>')
    animator.activate(el())
    expect(binder.unbound).toBe(0)
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

describe('Animator — no composable specs at all', () => {
  it('marks an element failed rather than pending when there is nothing to even suggest', () => {
    // `plan.unknown.length > 0` is what distinguishes "you typo'd a real effect name" (pending —
    // a later registration could still claim it) from "there was nothing here to parse at all"
    // (failed — an empty data-kui value produces zero specs and zero unknown names).
    build('<div data-kui=""></div>')
    expect(el().getAttribute(ATTR.state)).toBe('failed')
  })
})

describe('Animator.start — idempotency', () => {
  it('does not rescan on a second start() call', () => {
    const animator = build('<div data-kui="fade-up"></div>')
    const bindingsBefore = binder.bindings.length
    animator.start()
    expect(binder.bindings).toHaveLength(bindingsBefore)
  })
})

describe('createAnimator', () => {
  it('builds a working Animator instance', () => {
    document.body.innerHTML = '<div data-kui="fade-up"></div>'
    const animator = createAnimator({
      root: document.body,
      registry: catalogRegistry(),
      capabilities: CAPS,
      binder: fakeBinder(),
    })
    expect(animator).toBeInstanceOf(Animator)
    animator.start()
    expect(el().getAttribute(ATTR.normalized)).toBe('fade-up')
  })
})

describe('Animator.play', () => {
  it('delegates to the free play() function for its own root and registry', () => {
    const animator = build('<p id="a">Hi</p>')
    const handle = animator.play('#a', 'fade-up')
    expect(handle.elements).toEqual([document.getElementById('a')])
    expect(el('#a').getAttribute(ATTR.on)).toBe('manual')
  })
})

describe('Animator — teardown isolates a throwing instance', () => {
  it('does not let one instance\'s throwing destroy() stop the others from being released', () => {
    const animator = build('<div data-kui="fade-up on:load"></div>')
    const state = animator.stateOf(el())!
    const throwing = { ...state.instances[0]!, destroy: () => { throw new Error('destroy boom') } }
    state.instances.push(throwing)

    expect(() => animator.destroy()).not.toThrow()
    expect(el().hasAttribute(ATTR.normalized)).toBe(false)
  })
})

describe('Animator — stagger group indexed at the scan root itself', () => {
  it('indexes the root element when it is itself the stagger group, not only its descendants', () => {
    document.body.innerHTML = '<ul data-kui-stagger="60ms"><li data-kui="fade-up"></li></ul>'
    const ul = document.body.firstElementChild as HTMLElement
    const animator = new Animator({
      root: ul,
      registry: catalogRegistry(),
      capabilities: CAPS,
      binder: fakeBinder(),
    })
    animator.start()
    expect(ul.style.getPropertyValue('--kui-stagger')).toBe('60ms')
    expect((ul.firstElementChild as HTMLElement).style.getPropertyValue('--kui-i')).toBe('0')
  })
})

/**
 * `target:` — docs/plan-scope-page.md steps 6/8/10. Unit-level coverage over jsdom, which can
 * assert every attribute/inline-style write and every teardown, but cannot prove an effect
 * actually *animates* — that is `test/browser/target-*.test.mjs`'s job (see the plan's step 11 and
 * the recall note "tests never render a frame").
 */
describe('Animator — target: retargeting', () => {
  it('moves data-kui-fx/data-kui-rm to the match, and leaves data-kui-state on the host', () => {
    build('<div data-kui="fade-up target:h2"><h2>Title</h2></div>')
    const host = el()
    const h2 = el('h2')
    expect(host.getAttribute(ATTR.state)).toBe('ready')
    expect(host.hasAttribute(ATTR.normalized)).toBe(false)
    expect(h2.getAttribute(ATTR.normalized)).toBe('fade-up')
    expect(h2.hasAttribute(ATTR.rm)).toBe(true)
    expect(h2.hasAttribute(ATTR.state)).toBe(false)
  })

  it('writes the compiled declarations onto the match, not the host', () => {
    build('<div data-kui="fade-up 800ms target:h2"><h2>Title</h2></div>')
    expect(el('h2').style.getPropertyValue('animation-duration')).toBe('800ms')
    expect(el().style.getPropertyValue('animation-name')).toBe('')
  })

  it('keeps an untargeted segment on the host alongside a targeted one', () => {
    build('<div data-kui="blur-in, fade-up target:h2"><h2>Title</h2></div>')
    expect(el().getAttribute(ATTR.normalized)).toBe('blur-in')
    expect(el().style.getPropertyValue('animation-name')).toBe('kui-blur-in')
    expect(el('h2').getAttribute(ATTR.normalized)).toBe('fade-up')
    expect(el('h2').style.getPropertyValue('animation-name')).toBe('kui-in-up')
  })

  it('resolves under scope:page against the whole document, not just descendants', () => {
    build('<h2 id="elsewhere">Title</h2><div data-kui="fade-up target:#elsewhere scope:page"></div>')
    expect(el('#elsewhere').getAttribute(ATTR.normalized)).toBe('fade-up')
  })

  it('restores the match to authored markup on reset, same as the host always has', () => {
    const animator = build('<div data-kui="fade-up target:h2"><h2>Title</h2></div>')
    animator.reset(el())
    const h2 = el('h2')
    expect(h2.hasAttribute(ATTR.normalized)).toBe(false)
    expect(h2.hasAttribute(ATTR.rm)).toBe(false)
    expect(h2.style.length).toBe(0)
    expect(h2.hasAttribute('style')).toBe(false)
  })

  it('numbers --kui-i across the matched set, in document order', () => {
    build('<div data-kui="fade-up target:li"><ul><li></li><li></li><li></li></ul></div>')
    const items = [...document.querySelectorAll('li')] as HTMLElement[]
    expect(items.map((li) => li.style.getPropertyValue('--kui-i'))).toEqual(['0', '1', '2'])
    expect(el().style.getPropertyValue('--kui-stagger-count')).toBe('3')
  })

  it('warns and marks the host failed when the selector matches the whole document', () => {
    build('<div data-kui="fade-up target:body"></div>')
    expect(el().getAttribute(ATTR.state)).toBe('failed')
    expect(reporter.messages.join()).toContain('matches the whole document')
  })

  it('warns and marks the host failed when the selector matches nothing', () => {
    build('<div data-kui="fade-up target:.nope"></div>')
    expect(el().getAttribute(ATTR.state)).toBe('failed')
    expect(reporter.messages.join()).toContain('matched nothing')
  })

  it('keeps the host group running even when a sibling group matches nothing', () => {
    build('<div data-kui="blur-in, fade-up target:.nope"></div>')
    expect(el().getAttribute(ATTR.state)).toBe('ready')
    expect(el().getAttribute(ATTR.normalized)).toBe('blur-in')
    expect(reporter.messages.join()).toContain('matched nothing')
  })

  it('refuses target: on a preset whose CSS reaches past itself, and animates the host instead', () => {
    build('<div data-kui="card-flip-x target:.face"><div class="face"></div></div>')
    expect(el().getAttribute(ATTR.normalized)).toBe('card-flip-x')
    expect(el('.face').hasAttribute(ATTR.normalized)).toBe(false)
    expect(reporter.messages.join()).toContain('cannot be retargeted')
  })
})
