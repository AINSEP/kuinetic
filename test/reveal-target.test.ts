// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { Animator } from '../src/core/animator.js'
import { ATTR } from '../src/core/attrs.js'
import { compileTargets } from '../src/core/compile.js'
import { parse } from '../src/core/parse.js'
import { collectingReporter } from '../src/core/reporter.js'
import type { CollectingReporter } from '../src/core/reporter.js'
import { CAPS, fakeBinder } from './support/animator-harness.js'
import { catalogRegistry } from './support/registry.js'

/**
 * `target:` on `hover-intent` and `anchored-preview*` names the *part*, not a new host.
 *
 * `data-kui="anchored-preview-bottom target:.preview-img"` has to work with no `data-kui-preview` in
 * the markup: the effect stays on the element carrying `data-kui` (the trigger), the library stamps
 * the part's marker on the match, and teardown takes back only what it stamped. Both primitives opt
 * out of `compile.ts`'s `liftTarget` by *declaring* `target`, the same per-primitive declaration
 * `horizontal-track` and `scroll-spy` use — never a check on the effect's name.
 */

const PREVIEWS = [
  'anchored-preview',
  'anchored-preview-bottom',
  'anchored-preview-left',
  'anchored-preview-right',
]

describe('compile leaves target: on these effects instead of lifting it', () => {
  function compiled(source: string) {
    return compileTargets(parse(source), catalogRegistry(), 'time')
  }

  it.each([...PREVIEWS, 'hover-intent'])('%s compiles on the host with target: in its params', (name) => {
    const doc = compiled(`${name} target:.part`)
    expect(doc.warnings).toEqual([])
    expect(doc.targets.map((group) => group.selector)).toEqual([''])
    expect(doc.targets[0]!.specs[0]!.params.target).toBe('.part')
  })

  it('opts out by declaring the parameter on the primitive, the mechanism liftTarget reads', () => {
    const registry = catalogRegistry()
    for (const name of [...PREVIEWS, 'hover-intent']) {
      expect(registry.resolve(name)!.primitive.parameters.target).toMatchObject({
        type: 'text',
        default: '',
        cssProperty: '--kui-target',
      })
    }
  })

  it('still lifts masked-label-swap onto its target — that family relocates on purpose', () => {
    expect(compiled('masked-label-swap target:.label').targets.map((group) => group.selector)).toEqual(
      ['.label'],
    )
  })
})

describe('the animator, end to end', () => {
  let animator: Animator | undefined
  let reporter: CollectingReporter

  afterEach(() => {
    animator?.destroy()
    animator = undefined
    document.body.innerHTML = ''
  })

  function build(html: string): void {
    document.body.innerHTML = html
    reporter = collectingReporter()
    animator = new Animator({
      root: document.body,
      registry: catalogRegistry(),
      capabilities: CAPS,
      reporter,
      binder: fakeBinder(),
    })
    animator.start()
  }

  const $ = (selector: string) => document.body.querySelector(selector)!
  const warnings = () => reporter.messages

  it('keeps the effect on the trigger and stamps data-kui-preview on the named image', () => {
    build(
      '<span data-kui="anchored-preview-bottom target:.preview-img" tabindex="0">a word' +
        '<img class="preview-img" alt=""></span>',
    )
    const host = $('[data-kui]')
    const img = $('.preview-img')
    expect(host.getAttribute(ATTR.normalized)).toBe('anchored-preview-bottom')
    expect(img.hasAttribute(ATTR.normalized)).toBe(false)
    expect(img.getAttribute('data-kui-preview')).toBe('')
    expect(host.getAttribute('data-kui-preview-place')).toBe('bottom')
    expect(warnings()).toEqual([])
  })

  it('names the hint for hover-intent the same way', () => {
    build('<button data-kui="hover-intent target:.tip">Archive<span class="tip">Nothing is deleted</span></button>')
    expect($('[data-kui]').getAttribute(ATTR.normalized)).toBe('hover-intent')
    expect($('.tip').getAttribute('data-kui-hint')).toBe('')
  })

  it('teardown restores the markup exactly: the stamped marker comes off', () => {
    const html =
      '<span data-kui="anchored-preview target:.tag" tabindex="0">' +
      '<img alt=""><span class="tag">Jane</span></span>'
    build(html)
    expect($('.tag').hasAttribute('data-kui-preview')).toBe(true)
    animator!.destroy()
    animator = undefined
    expect($('.tag').hasAttribute('data-kui-preview')).toBe(false)
    expect(document.body.innerHTML).toBe(html)
  })

  it('round-trips with place:auto and tease: too', () => {
    const html =
      '<span data-kui="anchored-preview-left place:auto tease:2s target:.tag" tabindex="0">' +
      '<span class="tag">Jane</span></span>'
    build(html)
    expect($('[data-kui]').getAttribute('data-kui-preview-place')).toBe('left')
    expect($('.tag').hasAttribute('data-kui-preview')).toBe(true)
    animator!.destroy()
    animator = undefined
    expect(document.body.innerHTML).toBe(html)
  })

  it('teardown takes back the viewport shift too, leaving the markup byte for byte', () => {
    const html =
      '<span data-kui="anchored-preview-bottom target:.preview-img" tabindex="0">a word' +
      '<img class="preview-img" alt=""></span>'
    build(html)
    const host = $('[data-kui]') as HTMLElement
    const img = $('.preview-img')
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 })
    host.getBoundingClientRect = () => ({ top: 300, bottom: 320, left: 250, right: 330 }) as DOMRect
    Object.defineProperty(img, 'offsetLeft', { get: () => 40 })
    Object.defineProperty(img, 'offsetWidth', { get: () => 234 })
    host.dispatchEvent(new Event('pointerenter'))
    expect(host.style.getPropertyValue('--kui-anchored-preview-shift')).toBe('-25px')
    animator!.destroy()
    animator = undefined
    expect(document.body.innerHTML).toBe(html)
  })

  it('an authored marker on the named part survives teardown', () => {
    build(
      '<span data-kui="anchored-preview target:.tag" tabindex="0">' +
        '<span class="tag" data-kui-preview="kept">Jane</span></span>',
    )
    expect($('.tag').getAttribute('data-kui-preview')).toBe('kept')
    animator!.destroy()
    animator = undefined
    expect($('.tag').getAttribute('data-kui-preview')).toBe('kept')
  })

  it('legacy markup with no target: works unchanged, and keeps its marker after teardown', () => {
    build(
      '<span data-kui="anchored-preview-right" tabindex="0">a word<img data-kui-preview alt=""></span>',
    )
    expect($('[data-kui]').getAttribute('data-kui-preview-place')).toBe('right')
    expect(warnings()).toEqual([])
    animator!.destroy()
    animator = undefined
    expect($('img').getAttribute('data-kui-preview')).toBe('')
  })

  it('warns and marks nothing when target: matches nothing inside the trigger', () => {
    build(
      '<span data-kui="anchored-preview target:.missing" tabindex="0"></span>' +
        '<img class="missing" alt="">',
    )
    expect($('img').hasAttribute('data-kui-preview')).toBe(false)
    expect(warnings()).toEqual([
      expect.stringContaining('anchored-preview target ".missing" matched nothing inside this element'),
    ])
  })

  it('marks only the first of several matches, out loud', () => {
    build(
      '<span data-kui="anchored-preview target:img" tabindex="0">' +
        '<img id="a" alt=""><img id="b" alt=""></span>',
    )
    expect($('#a').hasAttribute('data-kui-preview')).toBe(true)
    expect($('#b').hasAttribute('data-kui-preview')).toBe(false)
    expect(warnings()).toEqual([expect.stringContaining('matched 2 elements; only the first is used')])
  })

  it('refuses a document-wide selector the way every target: does', () => {
    build('<span data-kui="hover-intent target:*" tabindex="0"><span>x</span></span>')
    expect($('[data-kui] span').hasAttribute('data-kui-hint')).toBe(false)
    expect(warnings()).toEqual([expect.stringContaining('matches the whole document')])
  })
})
