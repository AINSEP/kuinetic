import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createActivationBinder } from '../src/core/activation.js'
import { Animator } from '../src/core/animator.js'
import { ATTR } from '../src/core/attrs.js'
import { defaultCapabilities } from '../src/core/capabilities.js'
import { parse } from '../src/core/parse.js'
import { play, resolveTargets, toAttributeValue } from '../src/core/play.js'
import type { PlayOptions } from '../src/core/play.js'
import type { ScrollRoot, ScrollScheduler } from '../src/core/scroll-scheduler.js'
import type { EffectInstance } from '../src/core/types.js'
import { createRegistry } from '../src/effects/index.js'

/**
 * Regression coverage for the adversarial-review finding that `toAttributeValue`'s serializer
 * was not comma-safe: `play(el, 'scroll-spy', { target: '.a,.b' })` emitted an unquoted comma,
 * which `parse.ts`'s top-level splitter read as a second, bogus effect — the programmatic API
 * silently produced a different animation than the caller asked for. `play.ts` sat at ~7% test
 * coverage, which is how that shipped, so this file covers the whole module rather than just the
 * one reported value.
 */

const CAPS = defaultCapabilities({
  individualTransforms: true,
  intersectionObserver: true,
  motionPath: true,
})

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

function build(html: string): Animator {
  document.body.innerHTML = html
  return new Animator({
    root: document.body,
    registry: createRegistry(),
    capabilities: CAPS,
    binder: createActivationBinder({ createObserver: undefined }),
    scheduler: idleScheduler,
    rootResolver: () => fakeRoot,
  })
}

/** The one JS instance an element's plan produced — `typewriter` is JS-rendered and timer-driven,
 *  which is what makes `finished`/`cancel`/`finish` assertable deterministically. */
function jsInstance(animator: Animator, el: Element): EffectInstance {
  return animator.stateOf(el)!.instances[0]!
}

/**
 * Round-trip a parameter value through the real serializer and the real parser, the way
 * `play()` itself does internally (`toAttributeValue` → `data-kui` → `parse`).
 */
function roundtrip(value: string): { attr: string; got: string | undefined; warnings: string[] } {
  const attr = toAttributeValue('probe', { val: value })
  const parsed = parse(attr)
  return { attr, got: parsed.specs[0]?.params.val, warnings: parsed.warnings }
}

describe('toAttributeValue — value round-trip', () => {
  it('reproduces the reported defect as a passing regression: a comma-bearing selector stays one effect', () => {
    const attr = toAttributeValue('scroll-spy', { target: '.a,.b' })
    const parsed = parse(attr)
    expect(parsed.specs).toHaveLength(1)
    expect(parsed.specs[0]?.name).toBe('scroll-spy')
    expect(parsed.specs[0]?.params.target).toBe('.a,.b')
    expect(parsed.warnings).toEqual([])
  })

  // Every value here must survive `toAttributeValue` → `parse` byte-for-byte, as one spec, with
  // no warnings. This is the property the reported bug violated for one specific character
  // (comma); asserting it for a batch of awkward values catches every sibling of that bug rather
  // than just the one instance the review named.
  const exactRoundTrips: Record<string, string> = {
    'plain value': 'plain',
    'a top-level comma (the reported repro, as a bare property)': '.a,.b',
    'multiple commas': 'a,b,c,d',
    'a double quote': 'say "hi" now',
    "an apostrophe / single quote": "it's a test",
    'an unbalanced opening paren': 'a(b',
    'an unbalanced closing paren': 'a)b',
    'balanced parens with internal commas, unquoted-in-CSS shape': 'cubic-bezier(.2, .8, .2, 1)',
    'runs of whitespace': 'a b   c',
    'a colon (safe inside a value — only the first colon is the key/value split)': 'a:b',
    'a lone backslash with no other structural character (never quoted)': 'C:\\Users\\name',
    'unicode, including a non-BMP emoji': '日本語 テスト 🎉',
    'leading and trailing whitespace': '  padded  ',
    'a bare double-quote character on its own': '"',
    'a bare single-quote character on its own': "'",
    'comma + quote + parens combined': '.a,.b(x, y)"z"',
  }

  it.each(Object.entries(exactRoundTrips))('round-trips exactly: %s', (_label, value) => {
    const { attr, got, warnings } = roundtrip(value)
    expect(got, `attr was: ${attr}`).toBe(value)
    expect(warnings).toEqual([])
  })

  it('quotes only when a structural character is present — a plain value is left bare', () => {
    expect(toAttributeValue('fade', { distance: '40px' })).toBe('fade distance:40px')
  })

  it('a value ending in an odd number of backslashes cannot collide with the closing quote it needs', () => {
    // Known `parse.ts` limitation, not a play.ts bug: `unquote` only ever undoes `\"`, never
    // `\\`, so a raw backslash cannot be represented losslessly once a value also needs quoting
    // for another reason (here, the comma). Before this fix, quoting only escaped `"`, and a
    // trailing raw backslash paired with the appended closing quote, leaving it unterminated —
    // which swallowed every token after it (verified: a following effect vanished entirely, with
    // an "unterminated quote" warning). Doubling the backslash trades byte-exactness for safety:
    // no warning, no swallowed content, the value merely comes back with two backslashes instead
    // of one.
    const attr = `${toAttributeValue('fade', { a: 'x,\\' })}, blur-in`
    const parsed = parse(attr)
    expect(parsed.warnings).toEqual([])
    expect(parsed.specs.map((s) => s.name)).toEqual(['fade', 'blur-in'])
    expect(parsed.specs[0]?.params.a).toBe('x,\\\\')
  })

  it('an empty string parameter value cannot round-trip at all — a parse.ts grammar limit, not this file\'s', () => {
    // `splitPair` in parse.ts rejects a pair whose value is falsy (`key && value ? [...] : null`)
    // regardless of quoting, so there is no attribute-string encoding of an empty value this
    // serializer could produce that parse.ts would accept. Documented here rather than silently
    // asserted as "fine": the parameter is dropped and a warning is emitted, and other, unrelated
    // parameters on the same call are unaffected.
    const attr = toAttributeValue('fade', { empty: '', distance: '40px' })
    const parsed = parse(attr)
    expect(parsed.specs[0]?.params.empty).toBeUndefined()
    expect(parsed.specs[0]?.params.distance).toBe('40px')
    expect(parsed.warnings.join()).toContain('unrecognised token')
  })
})

describe('toAttributeValue — timing and shape', () => {
  it('converts a numeric duration to milliseconds', () => {
    expect(toAttributeValue('fade', { duration: 300 })).toBe('fade 300ms')
  })

  it('passes a string duration through unchanged', () => {
    expect(toAttributeValue('fade', { duration: '0.3s' })).toBe('fade 0.3s')
  })

  it('emits a synthetic 0ms duration so a delay with no duration is not misread as the duration', () => {
    expect(toAttributeValue('fade', { delay: 100 })).toBe('fade 0ms 100ms')
  })

  it('orders duration, delay, easing, then parameters', () => {
    expect(toAttributeValue('fade', { duration: 300, delay: 50, ease: 'ease-out', distance: '10px' })).toBe(
      'fade 300ms 50ms ease-out distance:10px',
    )
  })

  it('accepts a balanced easing function with internal commas, unquoted', () => {
    expect(toAttributeValue('fade', { ease: 'cubic-bezier(.2, .8, .2, 1)' })).toBe(
      'fade cubic-bezier(.2, .8, .2, 1)',
    )
  })

  it('excludes stagger from the emitted parameters (it is applied as a custom property, not a param)', () => {
    expect(toAttributeValue('fade', { stagger: 50, distance: '10px' })).toBe('fade distance:10px')
  })

  it('skips an explicitly-undefined option instead of emitting a bogus token', () => {
    expect(toAttributeValue('fade', { distance: undefined, delay: 50 })).toBe('fade 0ms 50ms')
  })

  it('serializes a numeric parameter as a bare number', () => {
    expect(toAttributeValue('fade', { count: 3 })).toBe('fade count:3')
  })

  it('emits a bare effect name with no options', () => {
    expect(toAttributeValue('fade-up')).toBe('fade-up')
  })
})

describe('toAttributeValue — positional and key slots reject what they cannot represent', () => {
  // The effect name, duration, delay, easing, and a parameter's own key are interpolated
  // unquoted — parse.ts's grammar has no quoting syntax for those slots. Rather than emit a
  // string the parser will silently misread (an easing value containing `:` was reclassified as
  // a bogus parameter and the easing dropped; an effect name containing `:` dropped the whole
  // spec), `toAttributeValue` now throws.
  const cases: Array<[string, string, PlayOptions]> = [
    ['effect name with a space', 'fade up', {}],
    ['effect name with a comma', 'fade,up', {}],
    ['effect name with a colon', 'fade:up', {}],
    ['string duration with a top-level comma', 'fade', { duration: '300ms,evil' }],
    ['string duration with a space', 'fade', { duration: '300ms extra' }],
    ['string delay with a colon', 'fade', { delay: '1:00' }],
    ['easing with a colon', 'fade', { ease: 'a:b' }],
    ['easing with an unbalanced paren', 'fade', { ease: 'cubic-bezier(.2, .8' }],
    ['a parameter key with a space', 'fade', { 'bad key': '1' }],
    ['a parameter key with a colon', 'fade', { 'bad:key': '1' }],
  ]

  it.each(cases)('throws for %s', (_label, effect, options) => {
    expect(() => toAttributeValue(effect, options)).toThrow(/cannot be serialized/)
  })
})

describe('resolveTargets', () => {
  it('resolves a CSS selector against the given root', () => {
    document.body.innerHTML = '<p class="x"></p><p class="x"></p><p></p>'
    expect(resolveTargets('.x', document.body)).toHaveLength(2)
  })

  it('wraps a single Element in a one-item array', () => {
    const el = document.createElement('div')
    expect(resolveTargets(el, document.body)).toEqual([el])
  })

  it('spreads an arbitrary iterable of elements', () => {
    const a = document.createElement('div')
    const b = document.createElement('div')
    expect(resolveTargets(new Set([a, b]), document.body)).toEqual([a, b])
  })
})

describe('play()', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('writes the compiled source and defaults activation to manual, then activates immediately', () => {
    const animator = build('<p id="a">Hi</p>')
    const el = document.getElementById('a')!
    play({ animator, root: document.body, target: '#a', effect: 'typewriter' }, { duration: 200 })

    expect(el.getAttribute(ATTR.source)).toBe('typewriter 200ms')
    expect(el.getAttribute(ATTR.on)).toBe('manual')
    expect(animator.stateOf(el)?.status).toBe('running')
  })

  it('leaves an already-declared activation alone instead of overwriting it with manual', () => {
    // An element authored `on:hover`/`on:click`/`on:load` keeps that activation across a
    // programmatic `play()` (e.g. a replay-all control), so a later natural hover/click still
    // works — `play()` still fires the effect immediately either way via `activate()`.
    const animator = build('<p id="a" data-kui-on="hover">Hi</p>')
    const el = document.getElementById('a')!
    play({ animator, root: document.body, target: '#a', effect: 'typewriter' }, { duration: 200 })

    expect(el.getAttribute(ATTR.on)).toBe('hover')
    expect(animator.stateOf(el)?.status).toBe('running')
  })

  it('replays: a second play() call on the same element restarts rather than silently no-opping', () => {
    // `process()` short-circuits on an unchanged configuration fingerprint, so playing the exact
    // same effect twice needs `animator.reset()` first or the second call is a silent no-op.
    const animator = build('<p id="a">Hi</p>')
    const el = document.getElementById('a')!
    const decorative = () => el.querySelector('.kui-typewriter')?.textContent ?? ''

    play({ animator, root: document.body, target: '#a', effect: 'typewriter' }, { duration: 100 })
    vi.advanceTimersByTime(100)
    expect(decorative()).toBe('Hi')

    play({ animator, root: document.body, target: '#a', effect: 'typewriter' }, { duration: 100 })
    expect(decorative()).toBe('')
    vi.advanceTimersByTime(100)
    expect(decorative()).toBe('Hi')
  })

  it('stamps --kui-stagger and a per-index --kui-i on every selected element', () => {
    const animator = build('<p class="x">Hi</p><p class="x">Yo</p>')
    play({ animator, root: document.body, target: '.x', effect: 'typewriter' }, { stagger: 50 })

    const els = [...document.querySelectorAll<HTMLElement>('.x')]
    expect(els[0]!.style.getPropertyValue('--kui-stagger')).toBe('50ms')
    expect(els[0]!.style.getPropertyValue('--kui-i')).toBe('0')
    expect(els[1]!.style.getPropertyValue('--kui-i')).toBe('1')
  })

  it('does not touch stagger custom properties when no stagger is given', () => {
    const animator = build('<p id="a">Hi</p>')
    play({ animator, root: document.body, target: '#a', effect: 'typewriter' })
    const el = document.getElementById('a')!
    expect(el.style.getPropertyValue('--kui-stagger')).toBe('')
  })

  it('returns the resolved elements on the handle', () => {
    const animator = build('<p class="x">Hi</p><p class="x">Yo</p>')
    const handle = play({ animator, root: document.body, target: '.x', effect: 'typewriter' })
    expect(handle.elements).toHaveLength(2)
  })

  it('finished resolves only once every selected element finishes', async () => {
    // No explicit duration, so each element types at the default 55ms/character `step` — `b`'s
    // longer text keeps it running well after `a` (2 characters) is done, and `finished` must
    // wait for it rather than settling as soon as the first element completes.
    const animator = build('<p class="x">Hi</p><p class="x">A much longer line</p>')
    const handle = play({ animator, root: document.body, target: '.x', effect: 'typewriter' })

    let resolved = false
    void handle.finished.then(() => {
      resolved = true
    })

    await vi.advanceTimersByTimeAsync(110)
    expect(resolved).toBe(false)

    await vi.advanceTimersByTimeAsync(2000)
    await Promise.resolve()
    expect(resolved).toBe(true)
  })

  it('cancel() cancels every instance on every selected element', () => {
    const animator = build('<p class="x">Hi</p><p class="x">Yo</p>')
    const handle = play({ animator, root: document.body, target: '.x', effect: 'typewriter' }, { duration: 100 })
    const els = [...document.querySelectorAll('.x')]
    const instances = els.map((el) => jsInstance(animator, el))
    const cancelSpies = instances.map((instance) => vi.spyOn(instance, 'cancel'))

    handle.cancel()
    for (const spy of cancelSpies) expect(spy).toHaveBeenCalledOnce()
  })

  it('resolves finished harmlessly for a target with no installed instances', async () => {
    const animator = build('<p id="a">Hi</p>')
    const handle = play({ animator, root: document.body, target: '#a', effect: 'not-a-real-effect' })

    await expect(handle.finished).resolves.toBeUndefined()
    expect(() => handle.cancel()).not.toThrow()
    expect(() => handle.finish()).not.toThrow()
  })

  it('finish() finishes every instance on every selected element', () => {
    const animator = build('<p class="x">Hi</p><p class="x">Yo</p>')
    const handle = play({ animator, root: document.body, target: '.x', effect: 'typewriter' }, { duration: 100 })
    const els = [...document.querySelectorAll('.x')]
    const instances = els.map((el) => jsInstance(animator, el))
    const finishSpies = instances.map((instance) => vi.spyOn(instance, 'finish'))

    handle.finish()
    for (const spy of finishSpies) expect(spy).toHaveBeenCalledOnce()
  })
})
