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
    const { messages } = report('fade-up, fade-left')
    expect(occurrences(messages, 'cannot compose')).toBe(1)
  })

  it('names the effect it dropped, not just the channel that clashed', () => {
    // The diagnosis ("both animate translate") was already there; the consequence was not. An
    // author who writes this gets no slide, and the old sentence never said an effect was removed.
    //
    // Two entrances deliberately, not the entrance+hover pair this used to use: `fade-up,
    // lift-shadow` composes now that phases ship, so it no longer produces a warning to assert on.
    // Same-phase claims on one channel are still a genuine, unresolvable clash.
    const { messages } = report('fade-up, fade-left')
    const composition = messages.find((message) => message.includes('cannot compose')) ?? ''
    expect(composition).toContain('Dropped "fade-left"')
    expect(composition).toContain('only "fade-up" will run')
  })

  it('names every dropped effect when more than one is discarded', () => {
    const { messages } = report('fade-up, fade-left, fade-down')
    const composition = messages.find((message) => message.includes('cannot compose')) ?? ''
    expect(composition).toContain('"fade-left"')
    expect(composition).toContain('"fade-down"')
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
    const document_ = compiled('fade-upp, fade-up, fade-left')
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
    expect(compile(parse('fade-up, fade-left'), catalogRegistry(), 'time').warnings.join()).toContain(
      'cannot compose',
    )
  })

  it('carries both halves at once, each exactly once', () => {
    const plan = compile(parse('fade-upp, fade-up, fade-left'), catalogRegistry(), 'time')
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
  { attribute: 'tween y:120px, fade-in', channel: 'translate', effects: ['tween', 'fade-in'], keeps: 'tween' },
  { attribute: 'fade-in, tween y:120px', channel: 'translate', effects: ['fade-in', 'tween'], keeps: 'fade-in' },
  { attribute: 'tween opacity:0, fade-in', channel: 'opacity', effects: ['tween', 'fade-in'], keeps: 'tween' },
  // Extra parameters, durations and an easing on both halves — the knobs a real page carries, and
  // the ones a fixture frozen at `"a, b"` would never exercise.
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
  // `fade-up, lift-shadow` and `fade-up, pop-open` joined this list when `Preset.phase` shipped:
  // an entrance and a state response claim the same channel but never drive it at the same moment,
  // so refusing them was a false positive the channel model could not see. They are asserted here
  // in both orders because the exemption must not depend on which half the author wrote first.
  const SAFE = [
    'fade-up, blur-in',
    'blur-in, fade-up',
    'fade-up, shine-sweep',
    'shine-sweep, fade-up',
    'fade-up, lift-shadow',
    'lift-shadow, fade-up',
    'fade-up, pop-open',
    'pop-open, fade-up',
    'fade-up distance:40px 800ms expo-out, lift-shadow 600ms',
  ]

  for (const attribute of SAFE) {
    it(`composes "${attribute}" without a warning`, () => {
      const { messages, fx } = report(attribute)
      expect(messages.join(), attribute).not.toContain('cannot compose')
      expect(fx.split(' '), attribute).toHaveLength(2)
    })
  }
})
