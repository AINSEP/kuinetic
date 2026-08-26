import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { collectingReporter } from '../src/core/reporter.js'
import { createRegistry } from '../src/effects/index.js'
import { animatorOverBody, build, el } from './support/js-effect-harness.js'

/**
 * Timing parity for JavaScript-rendered effects, second half: the primitives that were *not*
 * already covered by `js-effect-timing.test.ts`.
 *
 * That file proves an authored `duration`/`delay`/`ease` reaches the eight or so JS primitives
 * that drive their own frames. This one covers the rest of the JS tier — 45 primitives that
 * declared no `delay` at all — and it has two jobs, because the fix has two halves.
 *
 * Half one: the primitives that *should* have had a delay and did not. They fall into two
 * mechanisms — a stylesheet transition keyed off a custom property (the hover family, the icon
 * toggles, the flip card) and a JS-driven tween (`path-morph`, `auto-height`, the FLIP pair) — and
 * each is asserted against the thing that actually carries the value.
 *
 * Half two: the primitives that genuinely cannot honour one, which must say so. A parameter that
 * parses and is then discarded is worse for an author than one that does not exist: there is no
 * way to tell it apart from broken markup.
 */

beforeEach(() => {
  vi.useFakeTimers()
  document.body.innerHTML = ''
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

/**
 * Timing parity for the *stylesheet-driven* JS primitives — the hover family, the icon toggles,
 * the flip card.
 *
 * These render as `renderer: 'javascript'` but draw nothing themselves: their motion is a native
 * `:hover`/`[aria-expanded]` transition in `interaction.css`/`svg.css`/`three-d.css`, keyed off
 * `--kui-<primitive>-duration`/`-delay`/`-ease`. That made exactly one of the two spellings work.
 * `resolveParams` writes every `key:value` override inline, so `lift duration:400ms` reached the
 * rule; `compile.pushTrack`, which is what turns the positional `spec.duration`/`.delay`/`.easing`
 * into anything at all, runs for `css-keyframes` primitives only — so `lift 400ms` parsed, resolved,
 * installed, and changed nothing.
 *
 * Asserted on the inline custom properties rather than on rendered motion, deliberately: jsdom
 * computes no transitions, and the property is the entire contract between this tier and its
 * stylesheet. Whether the rule then reads it is `css-invariants.test.ts`'s question.
 */
describe('positional timing reaches stylesheet-driven JS effects', () => {
  const prop = (name: string): string => (el() as HTMLElement).style.getPropertyValue(name)

  it('mirrors all three positional tokens onto a hover effect', () => {
    build('<button data-kui="lift 400ms 200ms ease-in">Go</button>').start()

    expect(prop('--kui-lift-duration')).toBe('400ms')
    expect(prop('--kui-lift-delay')).toBe('200ms')
    expect(prop('--kui-lift-ease')).toBe('ease-in')
  })

  it('writes nothing when the author wrote no positional timing, so the test above cannot pass vacuously', () => {
    build('<button data-kui="lift">Go</button>').start()

    // Not `'0ms'`: an unwritten property must stay unwritten so the preset layer's own value (and
    // then the rule's `var()` fallback) still decides. Compare `presets.generated.css`.
    expect(prop('--kui-lift-duration')).toBe('')
    expect(prop('--kui-lift-delay')).toBe('')
    expect(prop('--kui-lift-ease')).toBe('')
  })

  it('still accepts the key:value spelling on its own', () => {
    build('<button data-kui="lift delay:200ms">Go</button>').start()

    expect(prop('--kui-lift-delay')).toBe('200ms')
  })

  it('lets the positional token win when an author writes both spellings', () => {
    // The same precedence `effectDurationMs` already applies for JS-driven primitives
    // (`params.timing.durationMs ?? params.ms('duration')`). Two spellings of one intent must not
    // resolve differently depending on which tier the effect happens to render on.
    build('<button data-kui="lift 400ms duration:600ms">Go</button>').start()

    expect(prop('--kui-lift-duration')).toBe('400ms')
  })

  it('delays an icon toggle, whose transition lives on descendants that inherit the property', () => {
    build('<button data-kui="hamburger-to-x 300ms 200ms" aria-expanded="false"></button>').start()

    expect(prop('--kui-icon-toggle-duration')).toBe('300ms')
    expect(prop('--kui-icon-toggle-delay')).toBe('200ms')
  })

  it('delays a flip card even on the click trigger, which wires no listeners at all', () => {
    // `prepareCardToggle` returns early for `trigger:click` — the default — so the mirror has to
    // run before that branch or the commonest flip card is the one case that keeps ignoring
    // positional timing.
    build('<div data-kui="flip-card 900ms 200ms">card</div>').start()

    expect(prop('--kui-card-toggle-duration')).toBe('900ms')
    expect(prop('--kui-card-toggle-delay')).toBe('200ms')
  })
})

/**
 * The other half of §11.3's contract: a timing parameter a primitive cannot act on must say so.
 *
 * The `delay:` spelling was already loud — it is not in these primitives' schemas, so `readParams`
 * rejects it as an unknown parameter. The positional spelling was not: `readEffectTiming` lifts it
 * onto `params.timing` *before* any schema is consulted, so `pin-section 0ms 300ms` reached a
 * primitive with no clock to shift and evaporated without a word. An author then has no way to
 * tell "this effect ignores delay" from "my markup is wrong" from "the library is broken".
 *
 * Every warning names the effect and the token, and says why — `TimingContract.because` in
 * `effects/shared.ts`.
 */
describe('a timing parameter a primitive cannot honour warns by name', () => {
  function warningsFor(html: string): string[] {
    const reporter = collectingReporter()
    build(html, reporter).start()
    return reporter.messages
  }

  const refused = (messages: string[], id: string, token: string): boolean =>
    messages.some((m) => m.includes(`"${id}" cannot honour ${token}`))

  it('refuses a positional delay on a scroll-driven pin', () => {
    const messages = warningsFor('<div data-kui="pin-section 0ms 300ms">pinned</div>')

    expect(refused(messages, 'pin', 'delay')).toBe(true)
    expect(messages.some((m) => m.includes('scroll position'))).toBe(true)
  })

  it('refuses a positional duration on a pointer-tracked tilt', () => {
    expect(refused(warningsFor('<div data-kui="tilt-3d 400ms">card</div>'), 'tilt-3d', 'duration')).toBe(true)
  })

  it('refuses a positional duration on a scroll-reactive header', () => {
    const messages = warningsFor('<header data-kui="header-shrink 400ms">h</header>')

    expect(refused(messages, 'header-shrink', 'duration')).toBe(true)
  })

  it('refuses every token on a drag, which is driven by the finger', () => {
    const messages = warningsFor('<div data-kui="drag 400ms 100ms linear">x</div>')

    expect(refused(messages, 'draggable', 'duration')).toBe(true)
    expect(refused(messages, 'draggable', 'delay')).toBe(true)
    expect(refused(messages, 'draggable', 'ease')).toBe(true)
  })

  it('accepts duration on a long-press, where it means the hold threshold rather than a span', () => {
    // The boundary of the rule above. `pressable` is the one gesture that reads a `duration`, and
    // a blanket refusal for the category would have made the library warn about a value it obeys.
    const messages = warningsFor('<button data-kui="long-press 800ms 100ms">hold</button>')

    expect(refused(messages, 'pressable', 'duration')).toBe(false)
    // ...and the delay written beside it is still refused: the threshold is not a start moment.
    expect(refused(messages, 'pressable', 'delay')).toBe(true)
  })

  it('refuses an easing on a continuous linear spin while still accepting its duration and delay', () => {
    const messages = warningsFor('<span data-kui="icon-spin 700ms 200ms back-out">i</span>')

    expect(refused(messages, 'icon-spin', 'ease')).toBe(true)
    expect(refused(messages, 'icon-spin', 'duration')).toBe(false)
    expect(refused(messages, 'icon-spin', 'delay')).toBe(false)
  })

  it('also drops the ease declaration from that spin, so the key:value spelling warns too', () => {
    // Declaring a parameter nothing reads is the quiet half of the same defect: `readParams` only
    // warns about names the schema does not know, so `icon-spin` had to *stop* declaring `ease`
    // for `ease:` to become answerable. Nothing an existing page renders changes — the property
    // was already never read by the rule.
    const messages = warningsFor('<span data-kui="icon-spin ease:back-out">i</span>')

    expect(messages.some((m) => m.includes('unknown parameter "ease"'))).toBe(true)
  })

  it('refuses timing on the forms native-state family, whose stylesheet pins it literally', () => {
    // The `text.ts:172` precedent: a case to warn about rather than to "fix". `forms.css` writes
    // `transition: translate 180ms ease-out` with literal times because the motion lands on a
    // sibling that an inline custom property cannot reach across `~`.
    const messages = warningsFor('<input data-kui="label-float 300ms 100ms">')

    expect(refused(messages, 'native-state', 'duration')).toBe(true)
    expect(refused(messages, 'native-state', 'delay')).toBe(true)
  })

  it('refuses timing on a backdrop, which is not an animation at all', () => {
    const messages = warningsFor('<div data-kui="background 500ms" data-kui-on="load">x</div>')

    expect(refused(messages, 'background-media', 'duration')).toBe(true)
  })

  it('stays quiet for an effect that honours everything it was given', () => {
    // The vacuity guard for this whole block: if the warning fired unconditionally, every
    // assertion above would pass for the wrong reason.
    const messages = warningsFor('<button data-kui="lift 400ms 200ms ease-in">Go</button>')

    expect(messages.filter((m) => m.includes('cannot honour'))).toEqual([])
  })
})

/**
 * The group-A members that drive their own frames, rather than handing a number to a stylesheet.
 *
 * Four primitives honour `delay` in JavaScript: `path-morph` runs a `requestAnimationFrame` lerp,
 * and `auto-height`/`flip-container`/`flip-indicator` hand Web Animations a keyframe pair. Each
 * needed the wait to be spent *looking un-started* rather than merely starting late — a FLIP whose
 * delay is unfilled shows its children already at their destination for the whole wait and then
 * snaps back to animate, which is worse than no delay at all. So these tests assert the fill mode
 * alongside the delay; the two are one behaviour.
 */
describe('JS-driven one-shots honour a delay in their own frame loop', () => {
  /** A hand-driven rAF: frames run only when the test says so, at a clock it controls. */
  function fakeFrames(): { tick(now: number): void; install(): void } {
    let callbacks: Array<(now: number) => void> = []
    let clock = 0
    return {
      install() {
        vi.stubGlobal('requestAnimationFrame', (cb: (now: number) => void) => {
          callbacks.push(cb)
          return callbacks.length
        })
        vi.stubGlobal('cancelAnimationFrame', () => {})
        vi.stubGlobal('performance', { now: () => clock })
      },
      tick(now: number) {
        clock = now
        const due = callbacks
        callbacks = []
        for (const cb of due) cb(now)
      },
    }
  }

  it('holds a path morph on its from-shape through the delay, then interpolates', () => {
    const frames = fakeFrames()
    frames.install()
    const animator = build(
      '<svg><path data-kui="icon-morph 200ms delay:300ms to:\'M0 0L20 0\'" d="M0 0L10 0"></path></svg>',
    )
    animator.start()
    const path = document.querySelector('path')!
    const fromShape = path.getAttribute('d')

    path.dispatchEvent(new Event('pointerenter'))
    // Inside the delay: `drive()` is running frames, but each one returns before painting, so the
    // shape has to be byte-identical to where it started. Without the fix the first frame at 100ms
    // is already halfway along the lerp.
    frames.tick(100)
    frames.tick(299)
    expect(path.getAttribute('d')).toBe(fromShape)

    // Past the delay and past the duration: fully morphed.
    frames.tick(300 + 200)
    expect(path.getAttribute('d')).not.toBe(fromShape)
  })

  it('does not delay the morph back on leave, only the morph out on enter', () => {
    // Deliberately one-directional, matching the hover family's `transition-delay`-on-the-state-
    // rule shape: a symmetric delay would leave the shape morphed for 300ms after the pointer had
    // already gone, which reads as lag rather than intent.
    const frames = fakeFrames()
    frames.install()
    build('<svg><path data-kui="icon-morph 200ms delay:300ms to:\'M0 0L20 0\'" d="M0 0L10 0"></path></svg>').start()
    const path = document.querySelector('path')!

    path.dispatchEvent(new Event('pointerenter'))
    frames.tick(500)
    const morphed = path.getAttribute('d')

    path.dispatchEvent(new Event('pointerleave'))
    frames.tick(500 + 200)
    expect(path.getAttribute('d')).not.toBe(morphed)
  })

  it('delays an accordion height tween and fills backwards so the panel looks shut while it waits', () => {
    const options = captureAnimateOptions('<div data-kui="accordion-height 400ms delay:250ms" data-open="">x</div>')

    expect(options.delay).toBe(250)
    // The panel's *rendered* height is already the open one by the time a MutationObserver runs
    // (see `heightEndpoints`), so an unfilled delay would show it open for 250ms and then snap
    // shut to animate. `'backwards'` holds the first keyframe instead, and — filling only the
    // before-phase — still hands the resting height back to the stylesheet at the end.
    expect(options.fill).toBe('backwards')
  })

  it('leaves an undelayed accordion on fill: none, exactly as before', () => {
    const options = captureAnimateOptions('<div data-kui="accordion-height 400ms" data-open="">x</div>')

    expect(options.delay).toBe(0)
    expect(options.fill).toBe('none')
  })

  /** Drive one `auto-height` toggle and hand back the options its `animate()` call received. */
  function captureAnimateOptions(html: string): KeyframeAnimationOptions {
    const observers: Array<() => void> = []
    class FakeMutationObserver {
      constructor(private readonly callback: () => void) {
        observers.push(() => this.callback())
      }
      observe(): void {}
      disconnect(): void {}
    }
    vi.stubGlobal('MutationObserver', FakeMutationObserver)

    let captured: KeyframeAnimationOptions = {}
    build(html).start()
    const node = el() as HTMLElement
    node.animate = ((_keyframes: unknown, options: KeyframeAnimationOptions) => {
      captured = options
      return { cancel: vi.fn() } as unknown as Animation
    }) as unknown as typeof node.animate

    observers.at(-1)!()
    return captured
  }
})

/**
 * FLIP: the delay has to be spent looking *un-moved*, which is a fill-mode question as much as a
 * delay one.
 *
 * A FLIP runs after the layout change it animates — the browser has already painted the children
 * at their destinations. The invert keyframe is what puts them visually back where they were, so
 * an unfilled delay would show the finished layout for the whole wait and then jump backwards to
 * animate. `fill: 'backwards'` holds that invert for exactly the delay and fills nothing at the
 * end, which is what keeps `runDeltas`' existing "the stylesheet owns the resting position"
 * guarantee intact.
 *
 * jsdom lays nothing out, so every rect is zero and the engine would skip every element as
 * unmoved. `atLeft` supplies the one measurement each test needs.
 */
describe('FLIP effects honour a delay without showing the finished layout first', () => {
  /** Pin an element's measured position, so the engine sees a real delta against its snapshot. */
  function atLeft(node: Element, left: number): void {
    node.getBoundingClientRect = (() =>
      ({ left, top: 0, width: 10, height: 10, right: left + 10, bottom: 10 })) as never
  }

  /** Capture the options the FLIP engine hands to `Element.animate`. */
  function captureAnimate(node: Element): () => KeyframeAnimationOptions {
    let captured: KeyframeAnimationOptions = {}
    ;(node as HTMLElement).animate = ((_k: unknown, options: KeyframeAnimationOptions) => {
      captured = options
      return { finished: Promise.resolve(), cancel: vi.fn() } as unknown as Animation
    }) as unknown as HTMLElement['animate']
    return () => captured
  }

  it('passes the key:value delay and a backwards fill through flip-container', () => {
    const observers: Array<() => void> = []
    class FakeMutationObserver {
      constructor(private readonly callback: () => void) {
        observers.push(() => this.callback())
      }
      observe(): void {}
      disconnect(): void {}
    }
    vi.stubGlobal('MutationObserver', FakeMutationObserver)

    // The snapshot is taken at `activate()`, with jsdom's all-zero rects; moving the child
    // afterwards is what the observer callback then measures as a delta.
    build('<div data-kui="flip-reorder 300ms delay:150ms"><i>a</i></div>').start()
    const child = el().querySelector('i')!
    atLeft(child, 80)
    const options = captureAnimate(child)

    observers.at(-1)!()

    expect(options().duration).toBe(300)
    expect(options().delay).toBe(150)
    expect(options().fill).toBe('backwards')
  })

  it('passes the positional spelling of the same delay through flip-indicator', () => {
    // Positional here on purpose, so the pair covers both routes rather than the same one twice.
    // `prepareIndicator` calls `move()` unconditionally during `activate()`, so the stubs have to
    // be in place before `start()` — which is why this builds its animator over an existing body.
    document.body.innerHTML =
      '<nav><b id="t">t</b><span data-kui="tab-indicator-slide 300ms 150ms follow:\'#t\'"></span></nav>'
    const indicator = document.querySelector('span')!
    atLeft(document.querySelector('#t')!, 80)
    const options = captureAnimate(indicator)

    let measurements = 0
    indicator.getBoundingClientRect = (() => {
      measurements += 1
      // The snapshot reads it where it is; by the time `engine.play` re-measures, the inline
      // `translate` this primitive just wrote has moved it. Two values are all the engine needs.
      const left = measurements <= 1 ? 0 : 80
      return { left, top: 0, width: 10, height: 10, right: left + 10, bottom: 10 }
    }) as never

    animatorOverBody().start()

    expect(options().duration).toBe(300)
    expect(options().delay).toBe(150)
    expect(options().fill).toBe('backwards')
  })

  it('leaves an undelayed FLIP on fill: none, so nothing about the existing path moved', () => {
    const observers: Array<() => void> = []
    class FakeMutationObserver {
      constructor(private readonly callback: () => void) {
        observers.push(() => this.callback())
      }
      observe(): void {}
      disconnect(): void {}
    }
    vi.stubGlobal('MutationObserver', FakeMutationObserver)

    build('<div data-kui="flip-reorder 300ms"><i>a</i></div>').start()
    const child = el().querySelector('i')!
    atLeft(child, 80)
    const options = captureAnimate(child)

    observers.at(-1)!()

    expect(options().delay).toBe(0)
    expect(options().fill).toBe('none')
  })
})

/**
 * The classification itself, written down as an invariant.
 *
 * The guard above catches a new `defaultActivation: 'enter'` primitive that forgets its `delay`.
 * It says nothing about the 45 JS primitives that default to `'load'`, which is where the whole of
 * this round's gap lived — `'load'` covers both "install a hover listener now" (a start moment
 * arrives later; a delay is coherent) and "read scroll position forever" (there is no start
 * moment; a delay is not). Only reading the source tells the two apart, so the split has to be
 * recorded somewhere a reviewer can see it and a change has to argue with.
 *
 * This is that record. Every JS-rendered primitive is on exactly one side: it declares a `delay`,
 * or it is named here with the reason it cannot have one. A new primitive lands on neither and
 * fails, which is the point — the author has to decide, rather than defaulting into silence.
 */
const TIMING_REFUSALS: Record<string, string> = {
  // Pointer-driven: the effect is a function of where the pointer is right now.
  'tilt-3d': 'pointer position',
  'tilt-parallax': 'pointer position',
  'cursor-follow': 'pointer position',
  'cursor-lag': 'pointer position',
  'cursor-label': 'pointer position',
  'cursor-invert': 'pointer position',
  'cursor-spotlight': 'pointer position',
  magnetic: 'pointer position',
  draggable: 'pointer position and velocity',
  swipeable: 'pointer position and velocity',
  pressable: 'pointer position; its `duration` is a hold threshold, not a span',

  // Scroll-driven: the effect is a function of where the page is.
  pin: 'scroll position',
  'scroll-progress': 'scroll position',
  'horizontal-track': 'scroll position',
  'media-scrub': 'scroll position',
  'scroll-spy': 'scroll position',
  'scroll-snap': 'scroll position; it configures native snapping rather than animating',
  'smooth-scroll': 'it sets `scroll-behavior` and animates nothing itself',
  'header-shrink': 'scroll position',
  'header-hide-on-scroll': 'scroll position',
  'back-to-top-fade': 'scroll position',

  // Neither a clock nor a position: nothing here moves on its own at all.
  'background-media': 'it paints a backdrop rather than animating',
  'beam-border-auto': 'an always-on loop with no start moment',

  // A start moment exists, but the shipped stylesheet pins the timing and the motion lands on a
  // sibling an inline custom property cannot reach. See `forms/primitives.ts`.
  'native-state': 'forms.css pins its timing literally',
  'toggle-morph': 'forms.css pins its timing literally',
  'radio-fill': 'forms.css pins its timing literally',
}

describe('every JS-rendered primitive either accepts a delay or is on the record refusing one', () => {
  const registry = createRegistry()
  const jsPrimitives = [
    ...new Map(
      registry
        .names()
        .map((name) => registry.resolve(name)!.primitive)
        .filter((primitive) => primitive.renderer === 'javascript')
        .map((primitive) => [primitive.id, primitive]),
    ).values(),
  ]

  it('has both groups populated, so neither assertion below can pass vacuously', () => {
    const accepting = jsPrimitives.filter((primitive) => primitive.parameters.delay)
    expect(accepting.length).toBeGreaterThan(25)
    expect(Object.keys(TIMING_REFUSALS).length).toBeGreaterThan(20)
    expect(accepting.length + Object.keys(TIMING_REFUSALS).length).toBe(jsPrimitives.length)
  })

  it('leaves no JS primitive unclassified', () => {
    const unclassified = jsPrimitives
      .filter((primitive) => !primitive.parameters.delay && !TIMING_REFUSALS[primitive.id])
      .map((primitive) => primitive.id)

    // A new one lands here. Decide which side it is on: spread `TRIGGER_DELAY_PARAM` into its
    // schema and honour it, or add it above with the reason it has no start moment.
    expect(unclassified).toEqual([])
  })

  it('keeps the refusal list free of stale entries', () => {
    const stale = Object.keys(TIMING_REFUSALS).filter((id) => {
      const primitive = jsPrimitives.find((candidate) => candidate.id === id)
      return !primitive || Boolean(primitive.parameters.delay)
    })

    expect(stale).toEqual([])
  })

  it('gives every accepting primitive the same no-op-by-default declaration', () => {
    const offenders = jsPrimitives
      .filter((primitive) => primitive.parameters.delay)
      .filter(({ parameters }) => parameters.delay!.type !== 'time' || parameters.delay!.default !== '0ms')
      .map((primitive) => primitive.id)

    expect(offenders).toEqual([])
  })
})
