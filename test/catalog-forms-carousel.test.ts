import { afterEach, describe, expect, it } from 'vitest'
import { createActivationBinder } from '../src/core/activation.js'
import { Animator } from '../src/core/animator.js'
import { defaultCapabilities } from '../src/core/capabilities.js'
import type { Capabilities } from '../src/core/capabilities.js'
import { createParams } from '../src/core/js-params.js'
import { createStyleLedger } from '../src/core/owned-styles.js'
import type { PrepareContext } from '../src/core/effect-context.js'
import {
  FORMS_PRESETS,
  STEP_PROGRESS_PRIMITIVE,
  STRENGTH_METER_PRIMITIVE,
  clampStep,
  prevStep,
} from '../src/effects/forms/index.js'
import { catalogRegistry } from './support/registry.js'
import { fakeRoot, idleScheduler } from './support/js-effect-harness.js'

/**
 * `step-progress` under its second name, split out of `catalog-forms.test.ts`.
 *
 * Not a topic boundary — the deck is the same primitive the stepper is — but a size one: the two
 * suites together are past the 400-line cap `eslint.config.js` enforces, and the carousel half is
 * the half that keeps growing. Everything the rest of section O needs stays in the original file.
 */

function fakeCtx(el: Element): PrepareContext {
  return {
    win: window,
    doc: window.document,
    reducedMotion: false,
    warn: () => {},
    style: createStyleLedger(el),
  } as unknown as PrepareContext
}

/*
 * `bubbles: true`, and it is not incidental. Controls are bound by delegation from the scope root —
 * one listener, so a dot rendered after setup still works — which means a click that does not
 * travel up the tree never reaches the handler at all. A real press always bubbles; a bare
 * `new Event('click')` does not, and dispatching one would be testing something no browser does.
 */
function press(node: Element): void {
  node.dispatchEvent(new Event('click', { bubbles: true }))
}

/**
 * A real animator over the body: attribute -> parse -> compile -> gate -> prepare, all of it.
 *
 * The suite below needs it where the rest of this file does not, because two of the three defects
 * it covers live outside `prepareStepProgress` entirely — one in the animator's reduced-motion
 * gate, which decides whether the setup runs at all, and one in the `carousel` preset's own
 * parameter defaults, which a direct `prepare(el, createParams(...), ctx)` call never sees.
 */
function startAnimator(html: string, capabilities: Partial<Capabilities> = {}): Animator {
  document.body.innerHTML = html
  const animator = new Animator({
    root: document.body,
    registry: catalogRegistry(),
    capabilities: defaultCapabilities({ intersectionObserver: true, ...capabilities }),
    binder: createActivationBinder({ createObserver: undefined }),
    scheduler: idleScheduler,
    rootResolver: () => fakeRoot,
  })
  animator.start()
  return animator
}

/**
 * The `next:`/`prev:`/`jump:` controls, and the `carousel` name they exist for.
 *
 * `step-progress` shipped as a one-way index: it advanced when you clicked the element carrying it
 * and wrapped at the end. That is a progress bar. Driving a deck of slides needs the other
 * direction and needs the controls to be *separate elements*, because a container that advances on
 * its own click cannot hold selectable text or a link.
 *
 * The wrap is the feature, not an edge case — an endless deck is the whole ask — so both
 * directions are asserted across the boundary rather than only in the middle.
 */
describe('carousel controls', () => {
  afterEach(() => {
    document.body.replaceChildren()
  })

  const deck = (): { el: HTMLElement; step: () => string | null } => {
    document.body.innerHTML = `
      <div id="deck">
        <button class="prev"></button>
        <div class="track"><i class="slide"></i><i class="slide"></i><i class="slide"></i></div>
        <button class="next"></button>
        <nav><button class="dot"></button><button class="dot"></button><button class="dot"></button></nav>
      </div>`
    const el = document.getElementById('deck')!
    return { el, step: () => el.getAttribute('data-kui-step') }
  }

  const click = (selector: string): void => press(document.querySelector(selector)!)

  it('steps backwards, and wraps in both directions so the deck is endless', () => {
    const { el, step } = deck()
    const instance = STEP_PROGRESS_PRIMITIVE.prepare!(
      el,
      createParams({ target: '.slide', next: '.next', prev: '.prev' }),
      fakeCtx(el),
    )
    instance.activate()

    expect(step()).toBe('0')
    // Backwards off the front lands on the last slide rather than sticking or going negative —
    // `-1 % 3` is `-1` in JS, so the naive mirror of `nextStep` would mark nothing here.
    click('.prev')
    expect(step()).toBe('2')
    click('.next')
    expect(step()).toBe('0')
    click('.prev')
    click('.prev')
    expect(step()).toBe('1')
    // Destroyed even though the fixture is about to be replaced. A page-scoped instance now holds
    // one delegated listener on the *document*, so an instance left running outlives its own
    // markup and answers presses meant for the next test's deck — which per-node listeners on
    // since-detached buttons never did.
    instance.destroy()
  })

  it('jumps straight to a slide by the control’s own position', () => {
    const { el, step } = deck()
    const instance = STEP_PROGRESS_PRIMITIVE.prepare!(
      el,
      createParams({ target: '.slide', jump: '.dot' }),
      fakeCtx(el),
    )
    instance.activate()

    const dots = [...document.querySelectorAll('.dot')]
    press(dots[2]!)
    expect(step()).toBe('2')
    press(dots[0]!)
    expect(step()).toBe('0')
    instance.destroy()
  })

  it('publishes the index as a number so one CSS rule can move the track', () => {
    const { el, step } = deck()
    const instance = STEP_PROGRESS_PRIMITIVE.prepare!(
      el,
      createParams({ target: '.slide', next: '.next' }),
      fakeCtx(el),
    )
    instance.activate()

    // Without this a page is back to one `[data-kui-step='n']` rule per slide, which is the exact
    // enumeration `step-marking.ts` exists to end.
    expect(el.style.getPropertyValue('--kui-step')).toBe('0')
    click('.next')
    expect(el.style.getPropertyValue('--kui-step')).toBe('1')
    expect(step()).toBe('1')

    instance.destroy()
    expect(el.style.getPropertyValue('--kui-step')).toBe('')
  })

  it('stops advancing on its own click once a control is named, and unbinds every control on destroy', () => {
    const { el, step } = deck()
    const instance = STEP_PROGRESS_PRIMITIVE.prepare!(
      el,
      createParams({ target: '.slide', next: '.next' }),
      fakeCtx(el),
    )
    instance.activate()

    // The container must go inert: a deck whose whole frame advances makes its text unselectable
    // and fires on every stray press inside a slide.
    press(el)
    expect(step()).toBe('0')

    instance.destroy()
    click('.next')
    expect(el.hasAttribute('data-kui-step')).toBe(false)
  })

  it('counts the slides itself instead of being told, and counts per parent so the dots do not double it', () => {
    // The deck has 5 slides AND 5 dots under one `target:`. A flat count of the matched elements
    // would be 10, so the deck would appear to have ten positions and half of them would be blank.
    const { el, step } = deck()
    const instance = STEP_PROGRESS_PRIMITIVE.prepare!(
      el,
      createParams({ target: '.slide, .dot', prev: '.prev' }),
      fakeCtx(el),
    )
    instance.activate()

    // 3 slides in this fixture. Back from 0 lands on the last one, which is the count minus one —
    // so this asserts the derived total exactly, without a `steps:` anywhere.
    click('.prev')
    expect(step()).toBe('2')
    instance.destroy()
  })

  it('picks up a slide added after setup, because it re-counts per step', () => {
    const { el, step } = deck()
    const instance = STEP_PROGRESS_PRIMITIVE.prepare!(
      el,
      createParams({ target: '.slide', prev: '.prev' }),
      fakeCtx(el),
    )
    instance.activate()

    const fourth = document.createElement('i')
    fourth.className = 'slide'
    document.querySelector('.track')!.append(fourth)

    // Counted at setup this would still wrap to 2; counted per flip it reaches the new slide.
    click('.prev')
    expect(step()).toBe('3')
    instance.destroy()
  })

  it('still honours an authored steps: as an override', () => {
    const { el, step } = deck()
    const instance = STEP_PROGRESS_PRIMITIVE.prepare!(
      el,
      createParams({ steps: '2', target: '.slide', prev: '.prev' }),
      fakeCtx(el),
    )
    instance.activate()

    // Three slides present, but the author said two, so back from 0 wraps to 1 and not 2.
    click('.prev')
    expect(step()).toBe('1')
    instance.destroy()
  })

  it('publishes the spacing knobs as custom properties, so crowding is tunable from the attribute', () => {
    // Unlike a hypothetical `axis:`, these are values rather than a choice between two rules the
    // page was writing anyway — the library writes the number and `calc()` reads it back.
    const spec = STEP_PROGRESS_PRIMITIVE.parameters
    expect(spec.peek?.cssProperty).toBe('--kui-peek')
    expect(spec.rest?.cssProperty).toBe('--kui-rest')
    expect(spec.peek?.type).toBe('percentage')
    expect(spec.rest?.type).toBe('number')
  })

  it('leaves the spacing defaults out of the element, so they stay a var() fallback', () => {
    // design.md §7: a default is the `var()` fallback and is never written inline. A deck that
    // names neither must therefore carry no inline peek/rest at all.
    const { el } = deck()
    const instance = STEP_PROGRESS_PRIMITIVE.prepare!(
      el,
      createParams({ target: '.slide', next: '.next' }),
      fakeCtx(el),
    )
    instance.activate()
    expect(el.style.getPropertyValue('--kui-peek')).toBe('')
    expect(el.style.getPropertyValue('--kui-rest')).toBe('')
    instance.destroy()
  })

  /*
   * Three defects an adversarial review found by simulating the deck rather than reading it. All
   * three need the element set to change under a running instance, which no demo page does and no
   * test did — the counting is dynamic, so everything downstream of it had to be too.
   */
  it('keeps a slide active when the deck shrinks to one, instead of freezing with nothing live', () => {
    document.body.innerHTML = '<div id="deck"><div class="track"><i class="slide"></i><i class="slide"></i></div><button class="next"></button></div>'
    const el = document.getElementById('deck')!
    const instance = STEP_PROGRESS_PRIMITIVE.prepare!(
      el,
      createParams({ target: '.slide', next: '.next' }),
      fakeCtx(el),
    )
    instance.activate()

    // Remove the live slide. The survivor was stamped `after` when it was the second of two.
    document.querySelectorAll('.slide')[0]!.remove()
    click('.next')

    // One slide, so the index is 0 either way. An "index unchanged, skip the render" guard sees no
    // change and returns, leaving the survivor permanently `after` with no active slide anywhere —
    // and every later click skips identically, so it never recovers.
    const survivor = document.querySelector('.slide')!
    expect(survivor.getAttribute('data-kui-step-state')).toBe('active')
    expect(survivor.getAttribute('style')).toContain('--kui-offset: 0')
    instance.destroy()
  })

  it('re-reads a jump control’s position on each press, so removing a slide cannot strand one', () => {
    // The controls ARE the slides here, which is what makes the stale index observable.
    document.body.innerHTML = '<div id="deck"><div class="track"><i class="dot"></i><i class="dot"></i><i class="dot"></i></div></div>'
    const el = document.getElementById('deck')!
    const instance = STEP_PROGRESS_PRIMITIVE.prepare!(
      el,
      createParams({ target: '.dot', jump: '.dot' }),
      fakeCtx(el),
    )
    instance.activate()

    const dots = [...document.querySelectorAll('.dot')]
    press(dots[2]!)
    expect(el.getAttribute('data-kui-step')).toBe('2')

    dots[1]!.remove()
    press(dots[2]!)

    // Captured at bind time its index is still 2, which wraps against the new count of 2 to 0 —
    // the same slide the first dot selects, leaving the last one unreachable.
    expect(el.getAttribute('data-kui-step')).toBe('1')
    instance.destroy()
  })

  it('does not fall back to advancing on container click when a named control matched nothing', () => {
    document.body.innerHTML = '<div id="deck"><div class="track"><i class="slide"></i><i class="slide"></i><i class="slide"></i></div></div>'
    const el = document.getElementById('deck')!
    const warnings: string[] = []
    const ctx = { ...fakeCtx(el), warn: (m: string) => warnings.push(m) } as PrepareContext
    const instance = STEP_PROGRESS_PRIMITIVE.prepare!(
      el,
      createParams({ target: '.slide', next: '#absent' }),
      ctx,
    )
    instance.activate()

    // Asking for arrows and mistyping the selector must not silently re-arm the behaviour that
    // naming a control exists to turn off — otherwise the deck advances when you click the video.
    press(el)
    expect(el.getAttribute('data-kui-step')).toBe('0')
    expect(warnings.join(' ')).toContain('matched nothing')
    instance.destroy()
  })

  it('registers `carousel` as a second name for the same primitive', () => {
    // The alias is the whole point of the name — if it ever resolved to a different primitive the
    // controls above would silently not apply to it.
    const carousel = FORMS_PRESETS.find((preset) => preset.name === 'carousel')
    expect(carousel?.primitive).toBe('step-progress')
    expect(catalogRegistry().resolve('carousel')?.primitive.id).toBe('step-progress')
  })
})


/**
 * `prevStep` and `clampStep`, the two wrap rules the deck added.
 *
 * `nextStep` has had a unit test since the stepper shipped; these two arrived with the controls and
 * were only ever exercised through the DOM. Both are pure precisely so the wrap is assertable
 * without one, and the wrap is where they are interesting: `-1 % 3` is `-1` in JS, so the naive
 * mirror of `nextStep` produces a negative index that marks nothing and reads as a dead control.
 */
describe('prevStep / clampStep', () => {
  it('steps back and wraps to the last index rather than going negative', () => {
    expect(prevStep(2, 4)).toBe(1)
    expect(prevStep(0, 4)).toBe(3)
  })

  it('answers 0 for an empty deck instead of dividing by nothing', () => {
    expect(prevStep(0, 0)).toBe(0)
    expect(clampStep(3, 0)).toBe(0)
  })

  it('wraps an out-of-range index instead of clamping it', () => {
    // `steps:4` with six dots would otherwise set an index no step element has.
    expect(clampStep(5, 4)).toBe(1)
    expect(clampStep(-1, 4)).toBe(3)
  })
})

/**
 * Three defects an adversarial review found in the `carousel` name, none of which is visible from a
 * direct `prepare` call on one deck: one lives in the animator's reduced-motion gate, one needs a
 * second deck on the page, and one needs a control that did not exist at setup.
 */
describe('carousel: the whole pipeline', () => {
  let running: Animator | undefined
  afterEach(() => {
    // Same reason the suite above destroys its instances: a live animator holds live listeners.
    running?.destroy()
    running = undefined
    document.body.replaceChildren()
  })

  const DECK = `
    <div class="deck" data-kui="carousel target:.slide next:.next">
      <div class="track"><i class="slide"></i><i class="slide"></i><i class="slide"></i></div>
      <button class="next"></button>
    </div>`

  const stateOf = (root: ParentNode): (string | null)[] =>
    [...root.querySelectorAll('.slide')].map((s) => s.getAttribute('data-kui-step-state'))

  it('keeps working under reduced motion, because the setup is the widget', () => {
    // `jsInputPrimitive` declared `reducedMotion: 'disable'` for the whole family, and `disable` is
    // enforced by the animator refusing to activate at all — so the deferred setup never ran: no
    // listener on the arrow, no index published, no slide marked. A visitor who asked for reduced
    // motion got a dead widget rather than a calm one, which is not what the preference asks for.
    running = startAnimator(DECK, { reducedMotion: true })
    const deck = document.querySelector('.deck')!

    expect(deck.getAttribute('data-kui-step')).toBe('0')
    expect(stateOf(document)).toEqual(['active', 'after', 'after'])

    press(document.querySelector('.next')!)
    expect(deck.getAttribute('data-kui-step')).toBe('1')
    expect(stateOf(document)).toEqual(['before', 'active', 'after'])
  })

  it('declares a policy the animator will actually run, and leaves the meters on the old one', () => {
    // The assertion above could pass for the wrong reason — reduced motion never reaching this
    // element — so the policy itself is pinned. `strength-meter` stays `disable` on purpose: its
    // entire output is a resting style, and base.css shortens the transition that reaches it.
    expect(STEP_PROGRESS_PRIMITIVE.reducedMotion).toBe('shorten')
    expect(STRENGTH_METER_PRIMITIVE.reducedMotion).toBe('disable')
  })

  it('keeps two decks on one page independent', () => {
    // `target:`/`next:`/`prev:`/`jump:` resolve page-wide under `step-progress`, which is right for
    // a bar whose segments deliberately live elsewhere. On a deck it meant each instance bound
    // *both* decks' arrows and marked *both* decks' slides, so one press advanced the page rather
    // than the carousel. Two decks with the same class names is the ordinary case, not an edge one.
    running = startAnimator(`${DECK}${DECK}`)
    const [first, second] = [...document.querySelectorAll('.deck')]

    press(first!.querySelector('.next')!)

    expect(first!.getAttribute('data-kui-step')).toBe('1')
    expect(second!.getAttribute('data-kui-step')).toBe('0')
    expect(stateOf(first!)).toEqual(['before', 'active', 'after'])
    expect(stateOf(second!)).toEqual(['active', 'after', 'after'])
  })

  it('scopes the deck by default without moving the stepper', () => {
    // The fix is a preset default, not a behaviour change in the primitive: `step-progress` is what
    // the shipped stepper form is authored as and it must keep resolving page-wide, or a legend
    // beside the bar stops being markable. `scope:page` still spells the old reading for a deck.
    const carousel = FORMS_PRESETS.find((preset) => preset.name === 'carousel')
    const stepper = FORMS_PRESETS.find((preset) => preset.name === 'step-progress')
    expect(carousel?.params).toEqual({ scope: 'self' })
    expect(stepper?.params).toBeUndefined()
  })

  it('binds a dot added after setup, because controls are delegated and not snapshotted', () => {
    running = startAnimator(`
      <div class="deck" data-kui="carousel target:.slide jump:.dot">
        <div class="track"><i class="slide"></i><i class="slide"></i><i class="slide"></i></div>
        <nav><button class="dot"></button><button class="dot"></button></nav>
      </div>`)
    const deck = document.querySelector('.deck')!
    const third = document.createElement('button')
    third.className = 'dot'
    deck.querySelector('nav')!.append(third)

    // A listener per matched node was attached once, at prepare time, so this dot was inert for the
    // life of the page. The arrows kept working — they re-count on every press — which made the
    // failure read as "the dots are broken" rather than "controls are bound once".
    press(third)
    expect(deck.getAttribute('data-kui-step')).toBe('2')
  })

  it('counts a press on a control’s inner label as a press on the control', () => {
    // What per-node listeners got for free and delegation has to ask for: a control is nearly
    // always a button with a label or an icon inside it, and the press lands on that child.
    running = startAnimator(`
      <div class="deck" data-kui="carousel target:.slide next:.next">
        <div class="track"><i class="slide"></i><i class="slide"></i></div>
        <button class="next"><span class="label">Next</span></button>
      </div>`)

    press(document.querySelector('.label')!)
    expect(document.querySelector('.deck')!.getAttribute('data-kui-step')).toBe('1')
  })

  it('ignores a click that merely bubbles through an unrelated descendant', () => {
    // The risk delegation introduces, and the reason the handler asks `closest` rather than "did
    // this click happen inside me": one listener on the host sees every press in the subtree, so a
    // press on a slide must not count as a press on a control.
    running = startAnimator(DECK)

    press(document.querySelectorAll('.slide')[1]!)
    expect(document.querySelector('.deck')!.getAttribute('data-kui-step')).toBe('0')
  })
})
