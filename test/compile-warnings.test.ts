// Two invariants about what an author is *told* about one `data-kui` attribute, which is why they
// share a file rather than sitting in `compile.test.ts` and `animator.test.ts` separately:
//
//   1. Every warning is reported **exactly once**. `compileTargets` returns warnings in two places
//      — the document's own, and one list per `target:` group — and `animator.ts` walks both. When
//      those were the same array object every diagnostic in the library printed 1 + (group count)
//      times off a single attribute.
//   2. A channel collision is **always loud**, on every channel, in either authoring order, with or
//      without extra parameters. Dropping the second effect is the correct outcome; doing it
//      silently is not, and a table here is deliberately not frozen around the one spelling that
//      prompted the check — a regression test that pins the exact parameters a bug used is a blind
//      spot the moment the next bug picks different ones.
import { beforeEach, describe, expect, it } from 'vitest'
import { Animator } from '../src/core/animator.js'
import { ATTR } from '../src/core/attrs.js'
import { compile, compileTargets } from '../src/core/compile.js'
import { parse } from '../src/core/parse.js'
import { collectingReporter } from '../src/core/reporter.js'
import type { CollectingReporter } from '../src/core/reporter.js'
import { CAPS, fakeBinder } from './support/animator-harness.js'
import { catalogRegistry } from './support/registry.js'

let reporter: CollectingReporter

/** Install one attribute through the real animator, and hand back what the author would see. */
function report(attribute: string, markup = ''): { messages: string[]; fx: string } {
  document.body.innerHTML = `<div data-kui="${attribute}">${markup}</div>`
  reporter = collectingReporter()
  new Animator({
    root: document.body,
    registry: catalogRegistry(),
    capabilities: CAPS,
    reporter,
    binder: fakeBinder(),
  }).start()
  const el = document.body.querySelector('[data-kui]')!
  return { messages: reporter.messages, fx: el.getAttribute(ATTR.normalized) ?? '' }
}

function occurrences(messages: string[], fragment: string): number {
  return messages.filter((message) => message.includes(fragment)).length
}

function compiled(source: string) {
  return compileTargets(parse(source), catalogRegistry(), 'time')
}

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('every warning reaches the author exactly once', () => {
  it('reports a composition warning once, not once per place the plan is reachable from', () => {
    const { messages } = report('fade-up, lift-shadow')
    expect(occurrences(messages, 'cannot compose')).toBe(1)
  })

  it('reports a document-scoped warning once', () => {
    const { messages } = report('fade-upp')
    expect(occurrences(messages, 'unknown effect')).toBe(1)
  })

  it('reports a group warning once even when the element compiled into several groups', () => {
    // Two groups — the host (`wobble`) and `h1` — and the collision belongs to the `h1` group
    // alone. Sharing one array made this print three times: once as the document's, once through
    // each of the two plans.
    const { messages } = report('wobble, fade-up target:h1, fade-left target:h1', '<h1>t</h1>')
    expect(occurrences(messages, 'cannot compose')).toBe(1)
  })

  it('reports a refused rm: once for the whole element, not once per group', () => {
    // `rm:` is hoisted off the whole attribute and resolved against one merged policy, so the
    // refusal is a single decision however many groups the attribute compiled into.
    const { messages } = report('flip-reorder target:.list rm:shorten, fade-up', '<ul class="list"></ul>')
    expect(occurrences(messages, 'may only strengthen')).toBe(1)
  })

  it('never reports the same warning through both a plan and the document', () => {
    const document_ = compiled('fade-upp, fade-up, lift-shadow')
    for (const target of document_.targets) {
      expect(target.plan.warnings).not.toBe(document_.warnings)
      for (const warning of target.plan.warnings) {
        expect(document_.warnings).not.toContain(warning)
      }
    }
  })

  it('gives each target group its own warning list', () => {
    const document_ = compiled('fade-up target:h1, fade-left target:h1, blur-in target:p')
    const [first, second] = document_.targets
    expect(first!.plan.warnings).not.toBe(second!.plan.warnings)
  })
})

describe('compile() still returns one flat warning list', () => {
  it('keeps document-scoped warnings on the single plan it returns', () => {
    // The narrow single-plan entry point has no document to read, so the split must not lose the
    // half that lives there — `unknown effect` is raised before partitioning.
    expect(compile(parse('fade-upp'), catalogRegistry(), 'time').warnings.join()).toContain(
      'unknown effect "fade-upp"',
    )
  })

  it('keeps group-scoped warnings on it too', () => {
    expect(compile(parse('fade-up, lift-shadow'), catalogRegistry(), 'time').warnings.join()).toContain(
      'cannot compose',
    )
  })

  it('carries both halves at once, each exactly once', () => {
    const plan = compile(parse('fade-upp, fade-up, lift-shadow'), catalogRegistry(), 'time')
    expect(occurrences(plan.warnings, 'unknown effect')).toBe(1)
    expect(occurrences(plan.warnings, 'cannot compose')).toBe(1)
  })
})

/**
 * The rejection is right — two effects writing one CSS property replace each other rather than
 * blending — so what is asserted is the *diagnostic*, on both of the channels an entrance effect
 * can collide on and through both of the ways an effect declares one: statically on its primitive
 * (`lift-shadow`, `pop-open`) and per-attribute through a variant (the generic tween, whose
 * channels are whatever properties the author named).
 */
const COLLISIONS: { attribute: string; channel: string; effects: [string, string]; keeps: string }[] = [
  { attribute: 'fade-up, lift-shadow', channel: 'translate', effects: ['fade-up', 'lift-shadow'], keeps: 'fade-up' },
  { attribute: 'lift-shadow, fade-up', channel: 'translate', effects: ['lift-shadow', 'fade-up'], keeps: 'lift-shadow' },
  { attribute: 'fade-up, pop-open', channel: 'opacity', effects: ['fade-up', 'pop-open'], keeps: 'fade-up' },
  { attribute: 'pop-open, fade-up', channel: 'opacity', effects: ['pop-open', 'fade-up'], keeps: 'pop-open' },
  { attribute: 'tween y:120px, fade-in', channel: 'translate', effects: ['tween', 'fade-in'], keeps: 'tween' },
  { attribute: 'fade-in, tween y:120px', channel: 'translate', effects: ['fade-in', 'tween'], keeps: 'fade-in' },
  { attribute: 'tween opacity:0, fade-in', channel: 'opacity', effects: ['tween', 'fade-in'], keeps: 'tween' },
  // Extra parameters, durations and an easing on both halves — the knobs a real page carries, and
  // the ones a fixture frozen at `"a, b"` would never exercise.
  {
    attribute: 'fade-up distance:40px 800ms expo-out, lift-shadow 600ms',
    channel: 'translate',
    effects: ['fade-up', 'lift-shadow'],
    keeps: 'fade-up',
  },
  // A tween touching three property groups still collides on the one its neighbour shares.
  {
    attribute: 'tween x:64px rotate:12deg y:120px 900ms, fade-in 400ms',
    channel: 'translate',
    effects: ['tween', 'fade-in'],
    keeps: 'tween',
  },
]

describe('a channel collision is never silent', () => {
  for (const { attribute, channel, effects, keeps } of COLLISIONS) {
    it(`warns by name and channel for "${attribute}"`, () => {
      const { messages, fx } = report(attribute)
      const composition = messages.filter((message) => message.includes('cannot compose'))
      expect(composition, attribute).toHaveLength(1)
      expect(composition[0], attribute).toContain(`both animate ${channel}`)
      for (const effect of effects) expect(composition[0], attribute).toContain(`"${effect}"`)
      // The drop itself is correct, and is asserted alongside the warning so a future change that
      // made the pair compose could not pass by quietly deleting the diagnostic.
      expect(fx, attribute).toBe(keeps)
    })
  }
})

describe('effects on disjoint channels still compose, in either order', () => {
  const SAFE = ['fade-up, blur-in', 'blur-in, fade-up', 'fade-up, shine-sweep', 'shine-sweep, fade-up']

  for (const attribute of SAFE) {
    it(`composes "${attribute}" without a warning`, () => {
      const { messages, fx } = report(attribute)
      expect(messages.join(), attribute).not.toContain('cannot compose')
      expect(fx.split(' '), attribute).toHaveLength(2)
    })
  }
})
