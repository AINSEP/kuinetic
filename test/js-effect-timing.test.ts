import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createActivationBinder } from '../src/core/activation.js'
import { Animator } from '../src/core/animator.js'
import { ATTR } from '../src/core/attrs.js'
import type { Capabilities } from '../src/core/capabilities.js'
import { collectingReporter } from '../src/core/reporter.js'
import type { Reporter } from '../src/core/reporter.js'
import type { ScrollRoot, ScrollScheduler } from '../src/core/scroll-scheduler.js'
import { createRegistry } from '../src/effects/index.js'
import type { EffectInstance } from '../src/core/types.js'

/**
 * End-to-end regression tests for gaps two rounds of adversarial review found in the JS renderer.
 *
 * These go through the real attribute → `parse` → `compile` → `Animator` pipeline rather than
 * calling a primitive's `prepare` directly, because every defect here lived precisely in the
 * wiring between those stages: `js-effect-preparer` never read `spec.duration`/`delay`/`easing`
 * for several primitives, and several deferred JS instances inherited a `finished` that was either
 * already resolved before the effect started or never accounted for child work still in flight.
 */

const CAPS: Capabilities = {
  viewTimeline: false,
  scrollTimeline: false,
  animationRange: false,
  individualTransforms: true,
  scrollTimelineName: false,
  viewTransitions: false,
  intersectionObserver: true,
  reducedMotion: false,
  motionPath: true,
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

function build(html: string, reporter?: Reporter): Animator {
  document.body.innerHTML = html
  return new Animator({
    root: document.body,
    registry: createRegistry(),
    capabilities: CAPS,
    binder: createActivationBinder({ createObserver: undefined }),
    scheduler: idleScheduler,
    rootResolver: () => fakeRoot,
    reporter,
  })
}

const el = (): HTMLElement => document.body.querySelector('[data-kui]') as HTMLElement

/** The one JS instance an element's plan produced. */
function jsInstance(animator: Animator): EffectInstance {
  return animator.stateOf(el())!.instances[0]!
}

/** Track resolution without awaiting, so "still pending" is assertable rather than a timeout. */
function watch(promise: Promise<void>): () => boolean {
  let resolved = false
  void promise.then(() => {
    resolved = true
  })
  return () => resolved
}

/** Drain the microtask queue the animator's own `Promise.all` chain runs on. */
async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

beforeEach(() => {
  vi.useFakeTimers()
  document.body.innerHTML = ''
})

afterEach(() => vi.useRealTimers())

describe('positional timing reaches JS-rendered effects', () => {
  it('delays a typewriter and spreads its duration across the whole string', () => {
    // Previously both tokens were parsed, stored on the spec, and then silently dropped: the
    // preparer merged only preset and key:value params, so this typed immediately at 55ms/char.
    const animator = build('<p data-kui="typewriter 200ms 500ms" data-kui-on="load">Hi</p>')
    animator.start()
    const decorative = (): string => el().querySelector('.kui-typewriter')!.textContent ?? ''

    vi.advanceTimersByTime(499)
    expect(decorative()).toBe('')

    // 200ms across two graphemes is 100ms each — a duration sizes the effect, not one step.
    vi.advanceTimersByTime(101)
    expect(decorative()).toBe('H')
    vi.advanceTimersByTime(100)
    expect(decorative()).toBe('Hi')
  })

  it('falls back to the step parameter when no duration was authored', () => {
    const animator = build('<p data-kui="typewriter step:20ms" data-kui-on="load">Hi</p>')
    animator.start()

    vi.advanceTimersByTime(20)
    expect(el().querySelector('.kui-typewriter')?.textContent).toBe('H')
  })

  it('holds a scramble at its fully-scrambled from-state through the delay', () => {
    const animator = build('<p data-kui="scramble 400ms 200ms" data-kui-on="load">ok</p>')
    animator.start()
    const decorative = (): string => el().querySelector('.kui-scramble')!.textContent ?? ''

    // An empty element during the delay would be wrong: `animation-fill-mode: both` holds a CSS
    // effect's first frame for exactly as long, and noise is this effect's first frame.
    expect(decorative()).toHaveLength(2)
    vi.advanceTimersByTime(199)
    expect(decorative()).not.toBe('ok')

    vi.advanceTimersByTime(401)
    expect(decorative()).toBe('ok')
  })

  it('feeds positional timing into the split-text stagger formula', () => {
    // split-text declares look-alike `duration`/`delay`/`ease` parameters, so the key:value form
    // already worked while the positional form — the one `play()` emits — reached nothing.
    const animator = build('<p data-kui="text-reveal-up 2s 1s linear" data-kui-on="load">a b</p>')
    animator.start()

    const decorative = el().querySelector<HTMLElement>('.kui-split-decorative')!
    expect(decorative.style.getPropertyValue('--kui-duration')).toBe('2000ms')
    expect(decorative.style.getPropertyValue('--kui-delay')).toBe('1000ms')
    expect(decorative.style.getPropertyValue('--kui-ease')).toBe('linear')
  })

  it('keeps a preset default when the author wrote no positional timing', () => {
    const animator = build('<p data-kui="text-reveal-up" data-kui-on="load">a b</p>')
    animator.start()

    const decorative = el().querySelector<HTMLElement>('.kui-split-decorative')!
    expect(decorative.style.getPropertyValue('--kui-duration')).toBe('500ms')
    expect(decorative.style.getPropertyValue('--kui-ease')).toBe('ease-out')
  })

  it('sizes a counter by its positional duration, not the parameter default', () => {
    // `count` read `params.ms('duration', 1600)`, which only ever sees the `duration:` spelling,
    // so `count-up 400ms` ran for the full 1600ms default.
    const animator = build('<span data-kui="count-up 400ms" data-kui-on="load">0</span>')
    animator.start()
    const shown = (): string => el().querySelector('.kui-count-decorative')!.textContent ?? ''

    // At 400ms the 1600ms default would only be a quarter of the way up its ease-out ramp.
    vi.advanceTimersByTime(400)
    expect(shown()).toBe('100')
  })

  it('delays a word cycler before its first swap', () => {
    const animator = build(
      '<span data-kui="word-cycler 0ms 300ms words:alpha|beta interval:100ms" data-kui-on="load">x</span>',
    )
    animator.start()
    expect(el().textContent).toBe('alpha')

    vi.advanceTimersByTime(299)
    expect(el().textContent).toBe('alpha')
    vi.advanceTimersByTime(101 + 150)
    expect(el().textContent).toBe('beta')
  })

  it('delays a counter before it starts climbing', () => {
    // Previously `tweenNumber` started its interval at `activate()` unconditionally — an authored
    // delay reached every other JS-rendered primitive except this one.
    const animator = build('<span data-kui="count-up 320ms 300ms linear" data-kui-on="load">0</span>')
    animator.start()
    const shown = (): string => el().querySelector('.kui-count-decorative')!.textContent ?? ''

    vi.advanceTimersByTime(300)
    expect(shown()).toBe('0')

    vi.advanceTimersByTime(320)
    expect(shown()).toBe('100')
  })

  it('honors positional easing instead of the counter\'s hardcoded ease-out', () => {
    const animator = build('<span data-kui="count-up 320ms 0ms linear" data-kui-on="load">0</span>')
    animator.start()
    const shown = (): string => el().querySelector('.kui-count-decorative')!.textContent ?? ''

    // Halfway through a *linear* ramp is exactly the halfway value. The hardcoded `easeOutCubic`
    // this replaced would already be 87.5% of the way up its ramp at this same point.
    vi.advanceTimersByTime(160)
    expect(shown()).toBe('50')
  })

  it('warns and falls back to the default ease-out for an easing it cannot map to JS', () => {
    const reporter = collectingReporter()
    const animator = build('<span data-kui="count-up 16ms 0ms steps(4)" data-kui-on="load">0</span>', reporter)
    animator.start()

    vi.advanceTimersByTime(16)
    expect(el().querySelector('.kui-count-decorative')?.textContent).toBe('100')
    expect(reporter.messages.some((m) => m.includes('steps(4)'))).toBe(true)
  })
})

describe('finished tells the truth for JS-rendered effects', () => {
  it('stays pending while the typewriter is still typing', async () => {
    const animator = build('<p data-kui="typewriter 100ms" data-kui-on="load">Hi</p>')
    animator.start()
    const isResolved = watch(jsInstance(animator).finished)

    await flush()
    expect(isResolved()).toBe(false)
    expect(el().getAttribute(ATTR.state)).toBe('running')

    vi.advanceTimersByTime(50)
    await flush()
    // Half-typed. This resolved here — and stamped `finished` — before the fix.
    expect(isResolved()).toBe(false)
    expect(el().getAttribute(ATTR.state)).toBe('running')

    vi.advanceTimersByTime(50)
    await flush()
    expect(isResolved()).toBe(true)
    expect(el().getAttribute(ATTR.state)).toBe('finished')
  })

  it('never resolves for a looping typewriter', async () => {
    const animator = build('<p data-kui="typewriter-loop 100ms" data-kui-on="load">Hi</p>')
    animator.start()
    const isResolved = watch(jsInstance(animator).finished)

    vi.advanceTimersByTime(10_000)
    await flush()
    // Same contract as `animation-iteration-count: infinite`, whose `Animation.finished` also
    // never settles: an effect that never ends must never report that it has.
    expect(isResolved()).toBe(false)
    expect(el().getAttribute(ATTR.state)).toBe('running')
  })

  it('never resolves for a word cycler on its own, only once cancelled', async () => {
    // Previously `prepareWordCycler` returned a bare `Cleanup`, which `deferredInstance` treats as
    // already complete the instant `activate()` runs — `finished` resolved, and `data-kui-state`
    // stamped `"finished"`, while the words were still visibly cycling.
    const animator = build('<span data-kui="word-cycler words:alpha|beta interval:50ms" data-kui-on="load">x</span>')
    animator.start()
    const instance = jsInstance(animator)
    const isResolved = watch(instance.finished)

    vi.advanceTimersByTime(10_000)
    await flush()
    // Same contract as `animation-iteration-count: infinite`: cycling has no natural end, so
    // `finished` must not settle on its own.
    expect(isResolved()).toBe(false)
    expect(el().getAttribute(ATTR.state)).toBe('running')

    instance.cancel()
    await expect(instance.finished).resolves.toBeUndefined()
  })

  it('resolves split-text only after the last staggered item would finish revealing', async () => {
    // Previously `prepareSplitText` returned a bare `Cleanup`, so `finished` resolved at
    // `activate()` — before a single `.kui-split-item` had even started its delayed reveal.
    const animator = build(
      '<p data-kui="text-reveal-up 100ms 0ms linear stagger:50ms" data-kui-on="load">a b</p>',
    )
    animator.start()
    const isResolved = watch(jsInstance(animator).finished)

    // Two words: index 0 finishes its 100ms reveal at 100ms; index 1, delayed an extra 50ms of
    // stagger, finishes at 150ms — `finished` may not resolve until that later time.
    vi.advanceTimersByTime(100)
    await flush()
    expect(isResolved()).toBe(false)

    vi.advanceTimersByTime(50)
    await flush()
    expect(isResolved()).toBe(true)
  })

  it('resolves once a scramble has resolved every grapheme', async () => {
    const animator = build('<p data-kui="scramble 40ms" data-kui-on="load">ok</p>')
    animator.start()
    const isResolved = watch(jsInstance(animator).finished)

    await flush()
    expect(isResolved()).toBe(false)

    vi.advanceTimersByTime(40)
    await flush()
    expect(isResolved()).toBe(true)
  })

  it('stays pending while a counter is still climbing', async () => {
    const animator = build('<span data-kui="count-up 200ms" data-kui-on="load">0</span>')
    animator.start()
    const isResolved = watch(jsInstance(animator).finished)

    vi.advanceTimersByTime(100)
    await flush()
    // Halfway up. A counter is one-shot with a knowable end, so resolving here — as it did before
    // it reported its own completion — stamped `finished` on a still-running count.
    expect(isResolved()).toBe(false)
    expect(el().getAttribute(ATTR.state)).toBe('running')

    // The ramp advances in fixed 16ms steps, so 200ms of tween needs 13 of them.
    vi.advanceTimersByTime(120)
    await flush()
    expect(isResolved()).toBe(true)
    expect(el().getAttribute(ATTR.state)).toBe('finished')
  })

  it('jumps a counter to its final value and resolves on finish()', async () => {
    const animator = build('<span data-kui="count-up 5s" data-kui-on="load">0</span>')
    animator.start()
    const instance = jsInstance(animator)

    instance.finish()
    expect(el().querySelector('.kui-count-decorative')?.textContent).toBe('100')
    await expect(instance.finished).resolves.toBeUndefined()
  })

  it('keeps a scroll-mechanics effect "running" while still resolving its instance immediately', async () => {
    // Two different questions, and a continuous effect answers them differently.
    //
    // The *instance's* `finished` must still resolve at once. If a pin could hold that promise
    // open, it would hang every `play()` and stop any one-shot composed onto the same element ever
    // reporting complete — which is exactly why `ContinuousSetup` keeps the resolved promise.
    //
    // The *element's* reported state must not follow it there. A pin scrubs for as long as the
    // page is scrolled; reading `finished` on the first microtask, before it has even engaged,
    // left `[data-kui-state='running']` unstylable for the whole scroll-mechanics family.
    const animator = build('<div data-kui="pin-section" data-kui-on="load">pinned</div>')
    animator.start()

    await expect(jsInstance(animator).finished).resolves.toBeUndefined()
    await flush()
    expect(el().getAttribute(ATTR.state)).toBe('running')
  })

  it('still finishes a one-shot composed onto the same element as a continuous effect', async () => {
    // The reason continuous instances keep an already-resolved `finished` in the first place: one
    // must never hold a co-authored one-shot open forever. Excluding them from the animator's gate
    // has to preserve that, not just fix the all-continuous case.
    const animator = build('<div data-kui="pin-section, count-up 200ms" data-kui-on="load">0</div>')
    animator.start()

    await flush()
    expect(el().getAttribute(ATTR.state)).toBe('running')

    vi.advanceTimersByTime(240)
    await flush()
    expect(el().getAttribute(ATTR.state)).toBe('finished')
  })

  it('leaves a bare-cleanup effect reporting "finished", so a no-op bail-out is not read as perpetual', async () => {
    // The boundary of the fix, asserted rather than left to be discovered. Ten setups in the
    // catalog return a bare `Cleanup` meaning "there was nothing to do" — no words to cycle, no
    // fine pointer to follow, a stage that could not be built. For those, "no completion pending"
    // is the honest report, and an earlier draft of this fix that inferred "continuous" from the
    // bare-cleanup shape alone would have wrongly pinned all ten at "running" forever.
    //
    // `text-wave` is continuous in the ordinary sense and still reports `finished` here. That is
    // the current, deliberate scope: D9 is about the scroll-mechanics family, whose effects are
    // the ones pages style on. Widening `ContinuousSetup` to the hover/text families is a separate
    // decision, and this test is what will fail loudly when someone makes it.
    const animator = build('<p data-kui="text-wave" data-kui-on="load">hi</p>')
    animator.start()

    await expect(jsInstance(animator).finished).resolves.toBeUndefined()
    await flush()
    expect(el().getAttribute(ATTR.state)).toBe('finished')
  })

  it('resolves when the effect is cancelled mid-run', async () => {
    const animator = build('<p data-kui="typewriter 1s" data-kui-on="load">Hi there</p>')
    animator.start()
    const instance = jsInstance(animator)

    instance.cancel()
    await expect(instance.finished).resolves.toBeUndefined()
  })

  it('jumps to the finished text and resolves on finish()', async () => {
    const animator = build('<p data-kui="typewriter 1s" data-kui-on="load">Hi there</p>')
    animator.start()
    const instance = jsInstance(animator)

    instance.finish()
    expect(el().querySelector('.kui-typewriter')?.textContent).toBe('Hi there')
    await expect(instance.finished).resolves.toBeUndefined()
  })

  it('jumps to the resolved text and resolves when a scramble is finished early', async () => {
    const animator = build('<p data-kui="scramble 1s" data-kui-on="load">ok</p>')
    animator.start()
    const instance = jsInstance(animator)

    instance.finish()
    expect(el().querySelector('.kui-scramble')?.textContent).toBe('ok')
    await expect(instance.finished).resolves.toBeUndefined()
  })

  it('resolves at once for an element with nothing to type', async () => {
    const animator = build('<p data-kui="typewriter 100ms" data-kui-on="load"></p>')
    animator.start()
    const isResolved = watch(jsInstance(animator).finished)

    vi.advanceTimersByTime(55)
    await flush()
    expect(isResolved()).toBe(true)
  })
})

/**
 * The `delay:` spelling, asserted per primitive against the same pipeline as the positional block
 * above.
 *
 * These two spellings are one intent — `data-kui="scramble 400ms 200ms"` and
 * `data-kui="scramble 400ms delay:200ms"` say the same thing — and for six of the eight
 * trigger-activated JS primitives only the positional one arrived. The keyword was parsed, handed
 * to `resolveParams`, found to be undeclared by the primitive's own `ParameterSchema`, and
 * dropped with nothing but a console warning: the effect ran, on time, with no delay, and nothing
 * about the page said why.
 *
 * Two of them could not even be written positionally without a throwaway token, because the
 * positional grammar spends its first bare time value on `duration` and neither has one:
 * `typewriter` is paced by `step:` and `word-cycler` by `interval:`, so an author had to know to
 * write `word-cycler 0ms 300ms` to mean "start 300ms late".
 *
 * Each test advances to just inside the delay window and asserts nothing has moved, then past it
 * and asserts it has — the same shape as the positional tests, because "the parameter parses" is
 * not the property that was broken.
 */
describe('the delay: spelling reaches JS-rendered effects', () => {
  it('holds a scramble on its unchanged from-frame through a keyword delay', () => {
    const animator = build('<p data-kui="scramble 400ms delay:200ms" data-kui-on="load">ok</p>')
    animator.start()
    const decorative = (): string => el().querySelector('.kui-scramble')!.textContent ?? ''

    // Noise is this effect's first frame and it is painted before the delay, so "has not started"
    // cannot be read off emptiness. It can be read off *sameness*: `render()` only runs on a tick,
    // so an unchanged frame means no tick has fired. Without the fix the first tick lands at 100ms
    // (400ms over two graphemes at `revealEvery: 2`) and this frame is already different.
    const fromFrame = decorative()
    expect(fromFrame).toHaveLength(2)
    vi.advanceTimersByTime(199)
    expect(decorative()).toBe(fromFrame)

    vi.advanceTimersByTime(401)
    expect(decorative()).toBe('ok')
  })

  it('delays a word cycler with no throwaway duration token in front of it', () => {
    const animator = build(
      '<span data-kui="word-cycler delay:300ms words:alpha|beta interval:100ms" data-kui-on="load">x</span>',
    )
    animator.start()
    expect(el().textContent).toBe('alpha')

    // Undelayed, the first swap lands at 100ms + the 150ms opacity crossfade.
    vi.advanceTimersByTime(299)
    expect(el().textContent).toBe('alpha')

    vi.advanceTimersByTime(101 + 150)
    expect(el().textContent).toBe('beta')
  })

  it('delays a counter before it starts climbing', () => {
    const animator = build('<span data-kui="count-up 320ms delay:300ms" data-kui-on="load">0</span>')
    animator.start()
    const shown = (): string => el().querySelector('.kui-count-decorative')!.textContent ?? ''

    // Without the delay the 320ms ease-out ramp is effectively complete by here, so this reads
    // "100" rather than "0" — the two outcomes are as far apart as the assertion can make them.
    vi.advanceTimersByTime(299)
    expect(shown()).toBe('0')

    vi.advanceTimersByTime(1 + 320)
    expect(shown()).toBe('100')
  })

  it('delays an odometer before its digits start rolling', () => {
    const animator = build(
      '<span data-kui="odometer-roll 160ms delay:300ms from:0 to:9" data-kui-on="load">0</span>',
    )
    animator.start()
    // One digit position, so one strip: `--kui-o` is the digit its column is scrolled to.
    const strip = (): string =>
      el().querySelector<HTMLElement>('.kui-odometer-strip')!.style.getPropertyValue('--kui-o')

    vi.advanceTimersByTime(299)
    expect(strip()).toBe('0')

    vi.advanceTimersByTime(1 + 160)
    expect(strip()).toBe('9')
  })

  it('feeds a keyword delay into the split-motion phase offset', () => {
    // text-wave's motion is a CSS keyframe loop, so jsdom can never show it moving. What it can
    // show is the one value the stylesheet reads to decide when the loop starts:
    // `.kui-split-item { animation-delay: calc(var(--kui-delay, 0ms) + ...) }` in text.css.
    const animator = build('<p data-kui="text-wave delay:600ms" data-kui-on="load">hi</p>')
    animator.start()

    const decorative = el().querySelector<HTMLElement>('.kui-split-decorative')!
    expect(decorative.style.getPropertyValue('--kui-delay')).toBe('600ms')
  })

  it('leaves split-motion at no delay when the author wrote none, so the test above cannot pass vacuously', () => {
    const animator = build('<p data-kui="text-wave" data-kui-on="load">hi</p>')
    animator.start()

    const decorative = el().querySelector<HTMLElement>('.kui-split-decorative')!
    expect(decorative.style.getPropertyValue('--kui-delay')).toBe('0ms')
  })

  it('warns rather than silently dropping a delay the primitive genuinely has no use for', () => {
    // The other half of the contract. `pin-section` is scroll-position-driven — there is no clock
    // to shift — so `delay:` there is an author mistake, and the right answer is to say so.
    const reporter = collectingReporter()
    build('<div data-kui="pin-section delay:300ms" data-kui-on="load">pinned</div>', reporter).start()

    expect(reporter.messages.some((m) => m.includes('unknown parameter "delay"'))).toBe(true)
  })
})

/**
 * Structural guard: the next primitive of this shape cannot ship without a `delay`.
 *
 * Every defect the block above covers is the same one bug, found six times by hand, and nothing in
 * the suite would have caught the seventh. The recurring shape is narrow enough to state as an
 * invariant: `defaultActivation` is the registry's own record of whether an effect *has a start
 * moment* — `'enter'` means "wait for a trigger, then play", which is exactly the condition under
 * which "start N milliseconds after the trigger" is a coherent request. Everything else in the
 * catalog defaults to `'load'`: pointer handlers, pins, progress trackers, native-state
 * transitions — effects driven by a position or a pseudo-class rather than a clock, for which a
 * delay is meaningless and being told so is better than being obeyed.
 *
 * So: an effect that waits for a trigger must accept a delay from that trigger. There is exactly
 * one declaration of it — `TRIGGER_DELAY_PARAM` in `effects/shared.ts` — which CSS-rendered
 * effects get for free through `COMMON` and JS-rendered ones spread into their own schema. That
 * leaves one way to regress: a new triggered primitive that never spreads it. This is the guard
 * for that, and it is the reason the entry is worth centralising rather than policing by hand.
 *
 * Deliberately keyed on the *declaration*, not on behaviour — a schema entry is checkable for all
 * 54 names at once, where "does it actually honour it" needs the primitive's own DOM and its own
 * probe, which is what the per-primitive tests above are for.
 */
describe('every trigger-activated effect accepts a delay', () => {
  const registry = createRegistry()
  const triggered = registry
    .names()
    .map((name) => ({ name, resolved: registry.resolve(name)! }))
    // `defaultActivation` is optional and unset means `'enter'` — see `Primitive` in core/types.ts.
    .filter(({ resolved }) => (resolved.primitive.defaultActivation ?? 'enter') === 'enter')

  it('has names to guard, so this suite cannot pass vacuously', () => {
    expect(triggered.length).toBeGreaterThan(50)
    // Both renderers, so a JS-tier regression cannot hide behind the CSS tier's shared schema.
    expect(triggered.some(({ resolved }) => resolved.primitive.renderer === 'javascript')).toBe(true)
  })

  it('declares delay as a no-op-by-default time parameter on every one of them', () => {
    const offenders = triggered
      .filter(({ resolved }) => {
        const spec = resolved.primitive.parameters.delay
        return !spec || spec.type !== 'time' || spec.default !== '0ms'
      })
      .map(({ name }) => name)

    // A `0ms` default is what makes declaring this safe: `readEffectParams` fills every declared
    // parameter, so a non-zero default would be indistinguishable from an authored value and would
    // silently delay every unauthored instance.
    expect(offenders).toEqual([])
  })
})
