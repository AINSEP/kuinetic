// @vitest-environment node
//
// Which trigger a composed comma list ends up bound to.
//
// `test/composition-phase.test.ts` asserts *which effects survive* composition, and
// `test/catalog-phase-media-nav.test.ts` asserts the same thing family by family. Neither ever
// looked at `CompiledPlan.defaultActivation`, and that gap is what let a real bug ship through a
// 3,200-test suite: `compile.ts` merged the field with `??=`, so the first primitive in the list
// that declared anything decided when *every* effect on the element started.
//
// `lift` declares `defaultActivation: 'load'`. So `data-kui="fade-up, lift"` — the exact pair the
// phase axis was added to allow, asserted as composing in `composition-phase.test.ts` and shipped
// on the demo pages — bound the element on `load` and played its reveal before it had been scrolled
// to. The effects all survived, the fx list was right, the warnings were empty, and the reveal was
// spent. Measured across the catalog before the fix: 4,545 composing pairs took their activation
// from the non-entrance half.
//
// So this file asserts the resolved value and nothing else. Every case is a two-effect attribute
// where the answer is different from what at least one half declares alone, which is the only way
// to tell a merge rule from an accident.
//
// The node environment is not optional here for the reason `composition-phase.test.ts` gives:
// `compile`/`parse` are pure, and the registry support module resolves paths from `import.meta.url`.
import { describe, expect, it } from 'vitest'
import { compile, compileTargets } from '../src/core/compile.js'
import { parse } from '../src/core/parse.js'
import { catalogRegistry } from './support/registry.js'

const registry = catalogRegistry()

/** Every `target:` group's plan, for the cases that assert the merge reached all of them. */
function groupsOf(attribute: string) {
  return compileTargets(parse(attribute), registry, 'time').targets
}

/** The activation a compiled attribute prefers when the author names none. */
function activationOf(attribute: string): string | undefined {
  return compile(parse(attribute), registry, 'time').defaultActivation
}

/** The effects that survived, so a case cannot pass by having been refused instead of resolved. */
function survivors(attribute: string): string[] {
  return compile(parse(attribute), registry, 'time').fxNames
}

/**
 * What each half declares on its own, asserted rather than assumed.
 *
 * Every expectation below is a claim about a *merge*, and a merge test is worthless if the inputs
 * are not what it thinks. `lift` and `drag` declaring `load` is the whole reason those pairs used
 * to misfire; `fade-up` declaring nothing is why the entrance had no say. If a future catalog edit
 * changes one of these, the pair tests below would keep passing while meaning something else.
 */
describe('the declarations these merges are made from', () => {
  it('leaves an ordinary entrance undeclared, so element-config falls through to enter', () => {
    expect(activationOf('fade-up')).toBeUndefined()
    expect(activationOf('back-in-down')).toBeUndefined()
  })

  it('has the state halves declaring load', () => {
    expect(activationOf('lift')).toBe('load')
    expect(activationOf('drag')).toBe('load')
  })

  it('has one entrance that does declare an activation of its own', () => {
    // `drawer-slide` is `phase: 'entrance'` with `defaultActivation: 'click'` — a drawer reveals
    // when its trigger is pressed, not when it scrolls into view. It is the case that proves the
    // rule below prefers *the entrance's own answer* rather than hard-coding `enter`.
    expect(activationOf('drawer-slide')).toBe('click')
  })
})

/**
 * An entrance composed with a behaviour keeps its own trigger.
 *
 * Both spellings for every pair, for the reason `composition-phase.test.ts` gives about its own
 * table: authoring order is exactly what the broken `??=` was sensitive to, so a table frozen
 * around one order would pass against the bug half the time.
 */
const ENTRANCE_WINS: { attribute: string; activation: string; why: string }[] = [
  {
    attribute: 'fade-up, lift',
    activation: 'enter',
    why: 'the flagship composing pair — it bound on load and spent the reveal unseen',
  },
  {
    attribute: 'back-in-down, drag',
    activation: 'enter',
    why: 'a card that should fly in on scroll and then be draggable, not fly in at load',
  },
  {
    attribute: 'blur-in, border-glow',
    activation: 'enter',
    why: 'the same shape through a hover state that only ever needed wiring, not a trigger',
  },
  {
    attribute: 'drawer-slide, drag',
    activation: 'click',
    why: "the entrance's own declaration wins too — the rule is not a hard-coded 'enter'",
  },
]

describe('an entrance names the trigger for the whole element', () => {
  for (const { attribute, activation, why } of ENTRANCE_WINS) {
    for (const spelling of [attribute, attribute.split(', ').reverse().join(', ')]) {
      it(`resolves "${spelling}" to ${activation} — ${why}`, () => {
        expect(survivors(spelling), spelling).toHaveLength(2)
        expect(activationOf(spelling), spelling).toBe(activation)
      })
    }
  }
})

/**
 * Where the old first-wins fold is still the answer, and where it never applied at all.
 *
 * The fix is only correct if it changed exactly the lists that have an entrance in them. A rule
 * that quietly rewrote every other attribute in the catalog would be a much larger change wearing
 * a bug fix's description.
 */
describe('everything without an entrance resolves exactly as it did', () => {
  it('falls back to the first declared activation for a list of states', () => {
    expect(activationOf('lift, border-glow')).toBe('load')
    expect(survivors('lift, border-glow')).toEqual(['lift', 'border-glow'])
  })

  it('leaves a list that declares nothing at all undefined, entrance or not', () => {
    // `back-in-down` *is* an entrance, and the answer is still `undefined` rather than `'enter'`:
    // nothing in this list declared a value for it to beat, so there is nothing to decide. The
    // fallback belongs to `element-config.ts`, which applies it to the authored value and the
    // plan's preference alike. Materialising it here would move that decision into the compiler for
    // no gain and change what every existing caller asserting an absent field sees.
    expect(activationOf('back-in-down, before-after-wipe')).toBeUndefined()
    expect(survivors('back-in-down, before-after-wipe')).toHaveLength(2)
  })

  it('keeps a single effect on its own declaration', () => {
    expect(activationOf('drag')).toBe('load')
    expect(activationOf('drawer-slide')).toBe('click')
  })
})

/**
 * The same rule across a `target:` split.
 *
 * An element has one activation binding however many groups its attribute compiles to, so
 * `mergeHostFacts` folds the field across every group and writes the merged answer back onto all of
 * them. It carried its own copy of the `??=` and so had its own copy of the bug: with the entrance
 * relocated to a child and the behaviour left on the host, the host group is `targets[0]` and won
 * outright.
 */
describe('a target: split is still one element with one trigger', () => {
  it('lets an entrance on a child name the trigger for a behaviour on the host', () => {
    const document = compile(parse('fade-up target:h1, drag'), registry, 'time')
    expect(document.defaultActivation).toBe('enter')
  })

  it('writes the same answer onto every group, whichever one a caller reads', () => {
    const targets = groupsOf('fade-up target:h1, drag')
    expect(targets).toHaveLength(2)
    for (const target of targets) expect(target.plan.defaultActivation).toBe('enter')
  })

  it('is decided from the entries that survived composition, not the ones authored', () => {
    // `icon-spin` is refused against `fade-up` on the delivery axis (see
    // `css-composition-invariants.test.ts`), so only `fade-up` runs — and a dropped effect must not
    // get to name the trigger for the one that replaced it. `icon-spin` declares `load`.
    expect(survivors('fade-up, icon-spin')).toEqual(['fade-up'])
    expect(activationOf('fade-up, icon-spin')).toBeUndefined()
  })
})
