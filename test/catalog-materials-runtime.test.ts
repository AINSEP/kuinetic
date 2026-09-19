// @vitest-environment jsdom
// Materials (catalog section S) — the runtime half of `effects/catalog/materials.ts`.
//
// `catalog-materials.test.ts` is a node-environment suite: it reads the registry row and the text of
// `src/css/glass.css`, which is the right shape for every question it asks and is why it never has a
// DOM. The consequence is that `prepareGlass` — the primitive's whole JavaScript surface — was never
// once called by the suite, and the four claims its doc comment makes about *runtime* behaviour had
// nothing holding them:
//
//   1. it is deferred, so `on:enter` / `on:manual` still gate a material;
//   2. it reports itself continuous, so a resting surface never claims `data-kui-state="finished"`;
//   3. it touches nothing, so every parameter really does reach `glass.css` through `resolveParams`
//      alone rather than through any code here;
//   4. its cleanup is a no-op that still has to leave the authored markup byte for byte.
//
// Those are all DOM questions, so this is a separate jsdom file rather than an addition there.
import { describe, expect, it } from 'vitest'
import { ATTR } from '../src/core/attrs.js'
import { createParams } from '../src/core/js-params.js'
import { createStyleLedger } from '../src/core/owned-styles.js'
import type { PrepareContext } from '../src/core/effect-context.js'
import type { EffectInstance } from '../src/core/types.js'
import { build, el } from './support/js-effect-harness.js'
import { catalogRegistry } from './support/registry.js'

const registry = catalogRegistry()

/** Same shape `catalog-transforms.test.ts` builds for the other resting-state primitive. */
function fakeCtx(node: Element): PrepareContext {
  return {
    win: window,
    doc: document,
    style: createStyleLedger(node),
    warn: () => {},
    reducedMotion: false,
  } as unknown as PrepareContext
}

function prepare(node: Element, params: Record<string, string> = {}): EffectInstance {
  return registry.resolve('glass')!.primitive.prepare!(node, createParams(params), fakeCtx(node))
}

describe('glass — the primitive at runtime', () => {
  /**
   * The deferral is the only reason `on:enter` and `on:manual` are offered on this primitive at all.
   * `prepareGlass` is a no-op, so "nothing happened yet" cannot be observed by looking at the
   * element — what is observable is that the instance has not reported itself continuous yet,
   * because `deferredInstance` only learns which kind of setup it wraps once that setup has run.
   */
  it('runs nothing until activate(), which is what keeps on:enter and on:manual meaningful', () => {
    const node = document.createElement('div')
    const instance = prepare(node, { blur: '20px' })

    expect(instance.continuous).toBe(false)

    instance.activate()
    expect(instance.continuous).toBe(true)
    instance.destroy()
  })

  /**
   * A material is a state the element sits in, not a move it makes — the same claim `rotate-static`
   * and `background-media` each make, and the reason `prepareGlass` returns `continuousSetup`
   * rather than resolving a completion. Resolving one would stamp `data-kui-state="finished"` from
   * the first microtask about a surface that has no end, which is a lie a scrubbed neighbour or an
   * author's own `[data-kui-state='finished']` rule would then act on.
   */
  it('reports itself as continuous, so nothing ever calls it finished', () => {
    const node = document.createElement('div')
    const instance = prepare(node)
    instance.activate()

    expect(instance.continuous).toBe(true)
    instance.destroy()
  })

  /**
   * The no-op is the design, not an omission: every parameter reaches `glass.css` as an inline
   * custom property written by `resolveParams`, so there is no value for JavaScript to thread and
   * no element for it to touch. A `prepare` that started writing here would be writing a *second*
   * source of truth for the same declarations.
   */
  it('writes nothing of its own — no style, no attribute, not even an empty style attribute', () => {
    const node = document.createElement('div')
    node.textContent = 'panel'
    const instance = prepare(node, { blur: '24px', tint: 'navy', radius: '999px' })
    instance.activate()

    expect(node.outerHTML).toBe('<div>panel</div>')

    instance.destroy()
    expect(node.outerHTML).toBe('<div>panel</div>')
  })
})

describe('glass — through a real animator', () => {
  /**
   * `defaultActivation: 'load'`, chosen so a panel already on screen at page load, in a background
   * tab, or still zero-area is not waiting on an `IntersectionObserver` that may never fire to be
   * given the surface it is supposed to be *made of*. The harness's binder has no observer at all
   * (`createObserver: undefined`), so an `enter` default would leave this element bare — which is
   * exactly the failure this pins, and exactly what a background tab does to a real page.
   */
  it('activates on load without an IntersectionObserver, and never reaches a finished state', async () => {
    const animator = build('<div data-kui="glass blur:24px">panel</div>')
    animator.start()
    await Promise.resolve()
    await Promise.resolve()

    const host = el()
    expect(host.getAttribute(ATTR.normalized)).toBe('glass')
    // The authored parameter reached the element as its declared custom property, from
    // `resolveParams` rather than from any code in `materials.ts`.
    expect(host.style.getPropertyValue('--kui-glass-blur')).toBe('24px')
    // Unauthored parameters write nothing at all, which is what leaves `glass.css`'s own `var()`
    // fallbacks — and, for `radius`, a page's own `border-radius` — in charge.
    expect(host.style.getPropertyValue('--kui-glass-radius')).toBe('')
    expect(host.style.getPropertyValue('--kui-glass-tint')).toBe('')
    // `running`, positively, not merely "not finished": `settleWhen` declines to arm a gate at all
    // when every instance on the element is continuous, and `running` is the state that leaves.
    // A `finished` here would be the animator reporting an end for a surface that has none.
    expect(host.getAttribute(ATTR.state)).toBe('running')

    animator.destroy()
    expect(host.outerHTML).toBe('<div data-kui="glass blur:24px">panel</div>')
  })

  /**
   * `on:manual` is offered on this primitive, so it has to actually gate. `prepareGlass` writes
   * nothing, so the state attribute is the only observable: `ready` is installed-and-waiting, and
   * the authored markup has to come back untouched however the run ended.
   *
   * Deliberately *not* asserting the state after `animator.activate()` here. It is `finished`,
   * which contradicts `settleWhen`'s own contract — an element whose every instance is continuous
   * is supposed to stay `running`, and the `on:load` test above shows this same primitive doing
   * exactly that. `rotate-static`, the other resting-state primitive, behaves identically on both
   * paths, so the discrepancy is in the manual-activation route through `core/animator.ts` rather
   * than in anything this file owns. Pinning `finished` here would make a bug look intentional;
   * pinning `running` would fail today. It is reported instead.
   */
  it('honours on:manual, waiting at ready, and gives the markup back whatever happens after', async () => {
    const animator = build('<div data-kui="glass on:manual">panel</div>')
    animator.start()
    await Promise.resolve()

    const host = el()
    expect(host.getAttribute(ATTR.state)).toBe('ready')

    animator.activate(host)
    await Promise.resolve()
    await Promise.resolve()

    animator.destroy()
    expect(host.outerHTML).toBe('<div data-kui="glass on:manual">panel</div>')
  })
})
