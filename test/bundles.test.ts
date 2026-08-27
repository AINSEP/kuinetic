import { beforeEach, describe, expect, it } from 'vitest'
import { Animator } from '../src/core/animator.js'
import { ATTR } from '../src/core/attrs.js'
import { collectingReporter } from '../src/core/reporter.js'
import type { CollectingReporter } from '../src/core/reporter.js'
import { CAPS, fakeBinder } from './support/animator-harness.js'
import type { FakeBinder } from './support/animator-harness.js'
import { catalogRegistry } from './support/registry.js'

/**
 * `data-kui-define` — named, reusable compositions.
 *
 * Driven through `Animator` rather than against `BundleTable` directly, because the whole claim of
 * the design is that a bundle is indistinguishable from its own expansion: the assertions that
 * matter are about compiled declarations and stamped attributes, which only exist once the element
 * has been through `process()`.
 */

let reporter: CollectingReporter
let binder: FakeBinder

function build(html: string): Animator {
  document.body.innerHTML = html
  reporter = collectingReporter()
  binder = fakeBinder()
  const animator = new Animator({
    root: document.body,
    registry: catalogRegistry(),
    capabilities: CAPS,
    reporter,
    binder,
  })
  animator.start()
  return animator
}

function el(selector = '#use'): HTMLElement {
  return document.body.querySelector(selector) as HTMLElement
}

function warnings(): string {
  return reporter.messages.join('\n')
}

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('data-kui-define — expansion', () => {
  it('expands a reference into the segments the bundle names', () => {
    build(`
      <template data-kui-define="hero" data-kui="fade-up 2000ms, blur-in 600ms"></template>
      <div id="use" data-kui="hero"></div>
    `)
    expect(el().getAttribute(ATTR.normalized)).toBe('fade-up blur-in')
    expect(el().style.getPropertyValue('animation-name')).toBe('kui-in-up, kui-blur-in')
  })

  it('resolves a definition written after the element that uses it', () => {
    // The forward reference. `scan` collects every definition before it compiles any element, so
    // document order between the two cannot matter — this is the case that silently fails on one
    // page and works on the next if resolution is folded into the per-element pass.
    build(`
      <div id="use" data-kui="hero"></div>
      <template data-kui-define="hero" data-kui="fade-up 900ms"></template>
    `)
    expect(el().getAttribute(ATTR.normalized)).toBe('fade-up')
    expect(el().style.getPropertyValue('animation-duration')).toBe('900ms')
  })

  it('composes a bundle with a locally named effect', () => {
    build(`
      <template data-kui-define="hero" data-kui="fade-up 800ms"></template>
      <div id="use" data-kui="hero, blur-in"></div>
    `)
    expect(el().getAttribute(ATTR.normalized)).toBe('fade-up blur-in')
  })

  it('keeps each segment its own timing', () => {
    build(`
      <template data-kui-define="hero" data-kui="fade-up 2000ms, blur-in 600ms"></template>
      <div id="use" data-kui="hero"></div>
    `)
    expect(el().style.getPropertyValue('animation-duration')).toBe('2000ms, 600ms')
  })

  it('carries a target: from inside the bundle', () => {
    build(`
      <template data-kui-define="heading" data-kui="fade-up 500ms target:h1"></template>
      <div id="use" data-kui="heading"><h1>title</h1></div>
    `)
    expect(el('#use h1').style.getPropertyValue('animation-duration')).toBe('500ms')
    expect(el().style.getPropertyValue('animation-duration')).toBe('')
  })

  it('lets the usage site retarget the whole bundle', () => {
    // `target:` is a parameter like any other, so the override rule covers retargeting for free.
    build(`
      <template data-kui-define="heading" data-kui="fade-up 500ms target:h1"></template>
      <div id="use" data-kui="heading target:h2"><h1>a</h1><h2>b</h2></div>
    `)
    expect(el('#use h2').style.getPropertyValue('animation-duration')).toBe('500ms')
    expect(el('#use h1').style.getPropertyValue('animation-duration')).toBe('')
  })

  it('never animates the definition itself', () => {
    build(`
      <template data-kui-define="hero" data-kui="fade-up"></template>
      <div id="use" data-kui="hero"></div>
    `)
    const template = document.body.querySelector('template') as HTMLElement
    expect(template.hasAttribute(ATTR.normalized)).toBe(false)
    expect(template.hasAttribute(ATTR.state)).toBe(false)
    expect(template.style.getPropertyValue('animation-name')).toBe('')
  })

  it('collects definitions when the root is the document rather than an element', () => {
    // `scan`'s root is a `ParentNode`, which a `Document` satisfies — the definition sweep has to
    // ask whether the root *is* a definition without assuming it is even an element.
    document.body.innerHTML = `
      <template data-kui-define="hero" data-kui="fade-up 700ms"></template>
      <div id="use" data-kui="hero"></div>
    `
    new Animator({
      root: document,
      registry: catalogRegistry(),
      capabilities: CAPS,
      reporter: collectingReporter(),
      binder: fakeBinder(),
    }).start()
    expect(el().style.getPropertyValue('animation-duration')).toBe('700ms')
  })

  it('registers a definition that is itself the scan root', () => {
    // `querySelectorAll` never returns the node it was called on, and `dom-watcher.ts` hands
    // `scan` the inserted node itself — which, for a definition inserted on its own, *is* the
    // template.
    document.body.innerHTML = '<div id="use" data-kui="hero"></div>'
    reporter = collectingReporter()
    const animator = new Animator({
      root: document.body,
      registry: catalogRegistry(),
      capabilities: CAPS,
      reporter,
      binder: fakeBinder(),
    })
    animator.start()
    expect(el().getAttribute(ATTR.state)).toBe('pending')

    const template = document.createElement('template')
    template.setAttribute(ATTR.define, 'hero')
    template.setAttribute(ATTR.source, 'fade-up')
    document.body.append(template)
    animator.scan(template)

    // Retried because the definition arrived late: the element was already stamped `pending`, and
    // nothing else would ever have looked at it again.
    expect(el().getAttribute(ATTR.normalized)).toBe('fade-up')
  })
})

describe('data-kui-define — precedence', () => {
  it('lets a local duration override the bundle', () => {
    build(`
      <template data-kui-define="hero" data-kui="fade-up 2000ms"></template>
      <div id="use" data-kui="hero 400ms"></div>
    `)
    expect(el().style.getPropertyValue('animation-duration')).toBe('400ms')
  })

  it('applies a local override to every segment the bundle expands to', () => {
    build(`
      <template data-kui-define="hero" data-kui="fade-up 2000ms, blur-in 600ms"></template>
      <div id="use" data-kui="hero 400ms"></div>
    `)
    expect(el().style.getPropertyValue('animation-duration')).toBe('400ms, 400ms')
  })

  it('lets a local easing and delay override the bundle', () => {
    build(`
      <template data-kui-define="hero" data-kui="fade-up 800ms 100ms linear"></template>
      <div id="use" data-kui="hero 800ms 250ms bounce"></div>
    `)
    expect(el().style.getPropertyValue('animation-delay')).toContain('250ms')
    expect(el().style.getPropertyValue('animation-timing-function')).toContain('bounce')
  })

  it('lets a local parameter override the bundle, keeping the ones it does not name', () => {
    build(`
      <template data-kui-define="hero" data-kui="tween x:10 y:40"></template>
      <div id="use" data-kui="hero y:80"></div>
    `)
    const vars = el().getAttribute('style') ?? ''
    expect(vars).toContain('80')
    expect(vars).toContain('10')
  })

  it('keeps the outermost override when a bundle references a bundle', () => {
    build(`
      <template data-kui-define="inner" data-kui="fade-up 900ms"></template>
      <template data-kui-define="outer" data-kui="inner 600ms"></template>
      <div id="use" data-kui="outer 200ms"></div>
    `)
    expect(el().style.getPropertyValue('animation-duration')).toBe('200ms')
  })

  it('takes the bundle value when the reference names nothing', () => {
    build(`
      <template data-kui-define="inner" data-kui="fade-up 900ms"></template>
      <template data-kui-define="outer" data-kui="inner"></template>
      <div id="use" data-kui="outer"></div>
    `)
    expect(el().style.getPropertyValue('animation-duration')).toBe('900ms')
  })
})

describe('data-kui-define — hoisted keys', () => {
  it('carries the bundle activation to the element that uses it', () => {
    build(`
      <template data-kui-define="hero" data-kui="fade-up on:hover"></template>
      <div id="use" data-kui="hero"></div>
    `)
    expect(binder.bindings[0]?.activation).toBe('hover')
  })

  it('lets the element override the bundle activation without a warning', () => {
    build(`
      <template data-kui-define="hero" data-kui="fade-up on:hover"></template>
      <div id="use" data-kui="hero on:click"></div>
    `)
    expect(binder.bindings[0]?.activation).toBe('click')
    expect(warnings()).not.toContain('conflicts')
  })

  it('carries the bundle threshold and reduced-motion policy', () => {
    build(`
      <template data-kui-define="hero" data-kui="fade-up threshold:40% rm:disable"></template>
      <div id="use" data-kui="hero"></div>
    `)
    expect(binder.bindings[0]?.threshold).toBe('40%')
    expect(el().getAttribute(ATTR.rm)).toBe('disable')
  })

  it('warns when two bundles on one element disagree about a hoisted key', () => {
    build(`
      <template data-kui-define="a" data-kui="fade-up on:hover"></template>
      <template data-kui-define="b" data-kui="blur-in on:click"></template>
      <div id="use" data-kui="a, b"></div>
    `)
    expect(warnings()).toContain(
      'bundle "b" sets "on:click", which conflicts with "on:hover" from an earlier bundle — the first wins',
    )
    expect(binder.bindings[0]?.activation).toBe('hover')
  })

  it('says nothing when two bundles agree about a hoisted key', () => {
    build(`
      <template data-kui-define="a" data-kui="fade-up on:hover"></template>
      <template data-kui-define="b" data-kui="blur-in on:hover"></template>
      <div id="use" data-kui="a, b"></div>
    `)
    expect(warnings()).not.toContain('conflicts with')
  })

  it('refuses the stagger keys in a definition, and says where they belong', () => {
    build(`
      <template data-kui-define="cards" data-kui="fade-up, cascade:90ms, order:end"></template>
      <div id="use" data-kui="cards"></div>
    `)
    expect(warnings()).toContain('bundle "cards" declares "cascade:" and "order:"')
    expect(warnings()).toContain('write it on the group element itself')
    expect(el().style.getPropertyValue('--kui-stagger')).toBe('')
  })

  it('does not index a definition as a stagger group', () => {
    build(`
      <template data-kui-define="cards" data-kui="fade-up, cascade:90ms"></template>
      <div id="use" data-kui="cards"></div>
    `)
    const template = document.body.querySelector('template') as HTMLElement
    expect(template.style.getPropertyValue('--kui-stagger-count')).toBe('')
  })
})

describe('data-kui-define — failure modes', () => {
  it('warns and drops a bundle that names itself', () => {
    build(`
      <template data-kui-define="loop" data-kui="fade-up, loop"></template>
      <div id="use" data-kui="loop"></div>
    `)
    expect(warnings()).toContain(
      'bundle "loop" is defined in terms of itself (loop → loop) — the reference is dropped',
    )
    // The rest of the bundle still runs: a cycle drops the reference, not the composition.
    expect(el().getAttribute(ATTR.normalized)).toBe('fade-up')
  })

  it('names the whole path when the cycle runs through another bundle', () => {
    build(`
      <template data-kui-define="a" data-kui="fade-up, b"></template>
      <template data-kui-define="b" data-kui="a"></template>
      <div id="use" data-kui="a"></div>
    `)
    expect(warnings()).toContain('bundle "a" is defined in terms of itself (a → b → a)')
  })

  it('warns on a second definition of a name and keeps the first', () => {
    build(`
      <template data-kui-define="hero" data-kui="fade-up 800ms"></template>
      <template data-kui-define="hero" data-kui="parallax-y 300ms"></template>
      <div id="use" data-kui="hero"></div>
    `)
    expect(warnings()).toContain('bundle "hero" is already defined — the first definition wins')
    expect(el().getAttribute(ATTR.normalized)).toBe('fade-up')
  })

  it('says nothing when the same definition is collected twice', () => {
    // `collect` runs on every scan, so re-reading an unchanged definition is the normal case.
    const animator = build(`
      <template data-kui-define="hero" data-kui="fade-up"></template>
      <div id="use" data-kui="hero"></div>
    `)
    animator.scan()
    expect(warnings()).not.toContain('already defined')
  })

  it('leaves an undefined name to the unknown-effect diagnostic', () => {
    build('<div id="use" data-kui="never-defined"></div>')
    expect(warnings()).toContain('unknown effect "never-defined"')
    // Not `failed`: an effect — or a definition — registered later must be able to claim it.
    expect(el().getAttribute(ATTR.state)).toBe('pending')
  })

  it('points at the bundle when an unknown name is one typo away from one', () => {
    build(`
      <template data-kui-define="hero-entrance" data-kui="fade-up"></template>
      <div id="use" data-kui="hero-entrence"></div>
    `)
    expect(warnings()).toContain(
      '"hero-entrence" is not a registered effect — did you mean the bundle "hero-entrance"?',
    )
  })

  it('does not offer a bundle for a name the catalog already knows', () => {
    build(`
      <template data-kui-define="fade-upp" data-kui="parallax-y"></template>
      <div id="use" data-kui="fade-up"></div>
    `)
    expect(warnings()).not.toContain('did you mean the bundle')
  })

  it('warns about a definition that names no effect', () => {
    build(`
      <template data-kui-define="empty" data-kui=""></template>
      <div id="use" data-kui="empty"></div>
    `)
    expect(warnings()).toContain('bundle "empty" names no effect')
  })

  it('warns about a definition with no body at all', () => {
    build('<template data-kui-define="bare"></template>')
    expect(warnings()).toContain('bundle "bare" names no effect')
  })

  it('reports a grammar mistake inside a definition against the definition', () => {
    // The definition element is never compiled, so this is the only chance anyone gets to hear
    // about a typo in its body.
    build(`
      <template data-kui-define="hero" data-kui="fade-up wobble"></template>
      <div id="use" data-kui="hero"></div>
    `)
    expect(warnings()).toContain('in bundle "hero": unrecognised token "wobble"')
  })

  it('refuses an empty name', () => {
    build('<template data-kui-define="" data-kui="fade-up"></template>')
    expect(warnings()).toContain('data-kui-define needs a name — an empty one defines nothing')
  })

  it('refuses a name carrying grammar characters', () => {
    build('<template data-kui-define="hero entrance" data-kui="fade-up"></template>')
    expect(warnings()).toContain('bundle name "hero entrance" cannot contain whitespace')
  })

  it('refuses a name the catalog already owns, and the effect still wins', () => {
    build(`
      <template data-kui-define="fade-up" data-kui="parallax-y 1200ms"></template>
      <div id="use" data-kui="fade-up 300ms"></div>
    `)
    expect(warnings()).toContain('bundle "fade-up" is already the name of a registered effect')
    expect(el().getAttribute(ATTR.normalized)).toBe('fade-up')
    expect(el().style.getPropertyValue('animation-duration')).toBe('300ms')
  })

  it('warns when a definition is not a template, and still does not animate it', () => {
    build(`
      <div data-kui-define="hero" data-kui="fade-up"></div>
      <div id="use" data-kui="hero"></div>
    `)
    expect(warnings()).toContain('bundle "hero" is defined on <div>')
    const definition = document.body.querySelector('[data-kui-define]') as HTMLElement
    expect(definition.hasAttribute(ATTR.normalized)).toBe(false)
    expect(el().getAttribute(ATTR.normalized)).toBe('fade-up')
  })

  it('warns when a local at: flattens the offsets the bundle sets on its own segments', () => {
    build(`
      <template data-kui-define="hero" data-kui="fade-up 800ms, blur-in 600ms at:-200ms"></template>
      <div id="use" data-kui="hero at:+100ms" data-kui-timeline="time"></div>
    `)
    expect(warnings()).toContain(
      '"at:+100ms" on "hero" overrides the offsets the bundle sets on its own segments',
    )
  })

  it('says nothing about at: when the bundle sets no offsets of its own', () => {
    build(`
      <template data-kui-define="hero" data-kui="fade-up 800ms"></template>
      <div id="use" data-kui="blur-in 400ms, hero at:+100ms"></div>
    `)
    expect(warnings()).not.toContain('overrides the offsets')
  })

  it('refuses a channel conflict between a bundle and a local effect exactly as it would inline', () => {
    // The point of expanding before `compileTargets` runs: composition is not aware that a bundle
    // was involved, so a collision reads and warns the same either way.
    build(`
      <template data-kui-define="hero" data-kui="fade-up"></template>
      <div id="use" data-kui="hero, parallax-y"></div>
    `)
    expect(warnings()).toContain('cannot compose')
  })
})
