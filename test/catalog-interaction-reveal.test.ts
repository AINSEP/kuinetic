import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { Registry } from '../src/core/registry.js'
import { createParams } from '../src/core/js-params.js'
import { createStyleLedger } from '../src/core/owned-styles.js'
import type { PrepareContext } from '../src/core/effect-context.js'
import { stripComments } from './support/css-scan.js'
import { registerInteraction } from '../src/effects/catalog/interaction.js'
import {
  ANCHORED_PREVIEW_PRESETS,
  HOVER_INTENT_PRESETS,
  LABEL_SWAP_PRESETS,
  REVEAL_PRESETS,
  SEARCH_EXPAND_PRESETS,
} from '../src/effects/catalog/interaction-reveal.js'

/**
 * The reveal-shaped families of catalog section I: `masked-label-swap` (three axes),
 * `hover-intent`, `anchored-preview` (four placements) and `search-expand`.
 *
 * A file of their own, next to `catalog-interaction-states.test.ts`, for the reason that file
 * records for `press-depth`/`group-dim`: `catalog-interaction.test.ts` requires every member of
 * `HOVER_PRESETS` to ship a `:hover`/`:focus-visible` pair on its *own* box, and every family here
 * exists outside that contract because it paints a second element. So they need their own, and it
 * is a stricter one — the contract that actually matters for all four is not "does the host have a
 * hover rule" but "does the state reach the second box without a selector".
 */

const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../src/css/interaction.css'),
  'utf8',
)

function registry(): Registry {
  return registerInteraction(new Registry())
}

function fakeCtx(el: Element): PrepareContext {
  return {
    win: window,
    doc: window.document,
    reducedMotion: false,
    warn: () => {},
    style: createStyleLedger(el),
  } as unknown as PrepareContext
}

const REVEAL_NAMES = REVEAL_PRESETS.map((preset) => preset.name)

describe('two-box registration', () => {
  it('registers four names across two primitives', () => {
    expect(LABEL_SWAP_PRESETS.map((p) => p.name)).toEqual([
      'masked-label-swap',
      'masked-label-swap-x',
      'masked-label-swap-diagonal',
    ])
    expect(HOVER_INTENT_PRESETS.map((p) => p.name)).toEqual(['hover-intent'])

    const reg = registry()
    // One primitive behind all three axes, so they share the `--kui-label-swap-*` timing namespace,
    // the schema and the channel claim — and so two of them on one host collide rather than fight
    // over `--kui-label-swap-dx` in silence.
    for (const name of LABEL_SWAP_PRESETS) {
      expect(reg.resolve(name.name)!.primitive.id).toBe('label-swap')
    }
    expect(reg.resolve('hover-intent')!.primitive.id).toBe('hover-intent')
  })

  it('resolves to an inert instance — the motion is CSS, prepare only mirrors positional timing', () => {
    const reg = registry()
    for (const name of REVEAL_NAMES) {
      const el = document.createElement('button')
      const instance = reg.resolve(name)!.primitive.prepare!(el, createParams({}), fakeCtx(el))
      instance.activate()
      expect(el.outerHTML, `${name} performed DOM surgery`).toBe('<button></button>')
      instance.destroy()
    }
  })
})

/**
 * The `target:` contract, asserted from both ends.
 *
 * `test/css-requires-own-subtree.test.ts` re-derives, from the shipped stylesheets, every name whose
 * CSS carries a combinator past its own `[data-kui-fx~='…']` compound, and requires each one to
 * declare `Preset.requiresOwnSubtree` — which makes `compile.ts` refuse to relocate it with
 * `target:`. Both families here are written specifically to stay out of that set, because
 * `data-kui="masked-label-swap target:.label"` on a button that also holds an icon is the main way
 * anyone will write this, not an edge case.
 *
 * That is a property of how the CSS is *spelled*, not of what it does, so it is exactly the kind of
 * thing a later edit breaks by accident: swapping the inherited `--kui-label-swap-shown` for the
 * obvious `[data-kui-fx~='masked-label-swap']:hover [data-kui-swap]` would render identically, pass
 * every visual check, and silently take `target:` away. This is the test that fails instead.
 */
describe('the state travels by inheritance, so target: keeps working', () => {
  /** Whether a combinator carries this name's compound past itself anywhere in the stylesheet. */
  function reachesPastSelf(name: string): boolean {
    for (const match of css.matchAll(new RegExp(`\\[data-kui-fx~='${name}'\\]`, 'g'))) {
      let sawCombinator = false
      for (let i = match.index + match[0].length; i < css.length; i++) {
        const ch = css[i]!
        if (ch === ',' || ch === '{') break
        if (/[\s>~+]/.test(ch)) sawCombinator = true
        else if (sawCombinator) return true
      }
    }
    return false
  }

  it.each(REVEAL_NAMES)('%s never reaches past its own element in CSS', (name) => {
    expect(reachesPastSelf(name)).toBe(false)
  })

  it.each(REVEAL_NAMES)('%s therefore declares no requiresOwnSubtree', (name) => {
    expect(registry().resolve(name)!.preset.requiresOwnSubtree).toBeUndefined()
  })

  it('routes both families through a standalone part selector instead', () => {
    // The other half of the same fact: the parts are styled by their own prefix-free rule, which is
    // what lets the fx rules stay combinator-free. Asserted by presence so this suite cannot pass
    // by the CSS having quietly lost the parts altogether.
    expect(css).toContain('[data-kui-swap]')
    expect(css).toContain('[data-kui-hint]')
  })
})

/**
 * Hover intent is a *cancelling* delay, and the mechanism that makes it cancel is the delay living
 * only in the state rules.
 *
 * A CSS transition reads its parameters from the after-change style, so a delay present only while
 * the state matches means: entering arms a delayed transition, and leaving before it elapses
 * reverts the property and cancels the pending transition before it ever started. Put the same
 * delay on the base rule as well and the effect still *looks* right on the way in while quietly
 * becoming a symmetric lag on the way out — the failure this asserts against.
 */
describe('the delay is asymmetric, which is what makes an early leave cancel', () => {
  function ruleBody(selector: string): string {
    const start = css.indexOf(selector)
    expect(start, `no rule for ${selector}`).toBeGreaterThan(-1)
    const open = css.indexOf('{', start)
    return css.slice(open, css.indexOf('}', open))
  }

  it('rests both families at a zero lag on their base rule', () => {
    expect(ruleBody("[data-kui-fx~='masked-label-swap'],")).toContain('--kui-label-swap-lag: 0ms')
    expect(ruleBody("[data-kui-fx~='hover-intent'] {")).toContain('--kui-hover-intent-lag: 0ms')
  })

  it('spends the authored delay only in the state rules', () => {
    expect(ruleBody("[data-kui-fx~='hover-intent']:focus-visible")).toContain(
      'var(--kui-hover-intent-delay, 1000ms)',
    )
    expect(ruleBody("[data-kui-fx~='hover-intent']:hover")).toContain(
      'var(--kui-hover-intent-delay, 1000ms)',
    )
  })

  it('defaults hover-intent to a full second, unlike every other delay in the catalog', () => {
    // The one deliberate exception to the `0ms` rule `js-effect-timing.test.ts` polices. That guard
    // covers primitives whose `defaultActivation` is `'enter'` — where a delay is a modifier on
    // something that would otherwise happen at once. Here it is not a modifier: an unauthored
    // `hover-intent` with a zero delay is an ordinary instant hover reveal, which is a different
    // effect that should have a different name.
    const primitive = registry().resolve('hover-intent')!.primitive
    expect(primitive.parameters.delay!.default).toBe('1000ms')
    expect(primitive.defaultActivation).toBe('load')
  })

  it('leaves every other reveal delay at the catalog default', () => {
    expect(registry().resolve('masked-label-swap')!.primitive.parameters.delay!.default).toBe('0ms')
  })
})

describe('every state is reachable by pointer, keyboard and touch', () => {
  it.each(REVEAL_NAMES)('%s ships a :focus-visible rule and a :hover mirror', (name) => {
    expect(css, `${name}: missing :focus-visible`).toContain(`[data-kui-fx~='${name}']:focus-visible`)
    expect(css, `${name}: missing :hover`).toContain(`[data-kui-fx~='${name}']:hover`)
  })

  it.each(REVEAL_NAMES)('%s ships a coarse-pointer :active fallback', (name) => {
    // Not a formality. Every `:hover` rule in this file is fine-pointer-gated so a tap cannot leave
    // an element stuck hovered, which without this leaves both families reachable on a touchscreen
    // by keyboard focus alone — on the device where a swapping label and a hint are worth the most.
    expect(css, `${name}: missing :active`).toContain(`[data-kui-fx~='${name}']:active`)
  })

  it('shortens, rather than removes, both part transitions under reduced motion', () => {
    // Shortened lands on the end value, so no part can be stranded mid-slide — the choice
    // `base.css` makes for the whole transition tier. Written out here because `base.css` shortens
    // `[data-kui-rm]` and its pseudo-elements, and both families move a *child* box.
    const block = css.slice(css.lastIndexOf('@media (prefers-reduced-motion: reduce)'))
    expect(block).toContain('[data-kui-swap]')
    expect(block).toContain('[data-kui-hint]')
    expect(block).toContain('transition-duration: 1ms')
  })

  it('keeps the hint uninteractive in every state', () => {
    // A revealed panel the pointer can move into is a menu, and a menu needs the pointer to be able
    // to leave its trigger without closing it — trajectory intent, a different feature. This is what
    // keeps the name honest about which of the two it is.
    const hint = css.slice(css.indexOf('[data-kui-hint] {'))
    expect(hint.slice(0, hint.indexOf('}'))).toContain('pointer-events: none')
  })
})

describe('the three axes differ only in their two offsets', () => {
  // `lastIndexOf`, not `indexOf`. Each name's axis-specific rule (the one that actually sets
  // `--kui-label-swap-dx`/`-dy`) is a real, standalone `[data-kui-fx~='NAME'] {` rule further down
  // the file than the three names' *shared* combined-selector rule above it (`display: inline-grid`
  // etc.) — correct, ordinary CSS, not a bug. But `masked-label-swap-diagonal` is the last name in
  // that shared selector list, so the literal substring `[data-kui-fx~='masked-label-swap-diagonal']
  // {` also closes the shared rule's own opening, and a plain `indexOf` finds *that* occurrence
  // first — pulling in the wrong rule body (the shared `display`/`overflow`/`--kui-label-swap-shown`
  // block, which contains neither offset) and failing this suite. The axis-specific rule is always
  // the *later* occurrence for every name, whether or not it happens to collide with the shared
  // rule's boundary, so `lastIndexOf` is the fix on every name uniformly rather than a special case
  // for the one that currently collides.
  it.each([
    ['masked-label-swap', '--kui-label-swap-dx: 0%'],
    ['masked-label-swap-x', '--kui-label-swap-dy: 0%'],
  ])('%s pins the axis it does not travel on to zero', (name, zeroed) => {
    const start = css.lastIndexOf(`[data-kui-fx~='${name}'] {`)
    expect(start).toBeGreaterThan(-1)
    expect(css.slice(start, css.indexOf('}', start))).toContain(zeroed)
  })

  it('travels on both axes for the diagonal', () => {
    const start = css.lastIndexOf("[data-kui-fx~='masked-label-swap-diagonal'] {")
    const body = css.slice(start, css.indexOf('}', start))
    expect(body).toContain('--kui-label-swap-dx: var(--kui-label-swap-distance, 100%)')
    expect(body).not.toContain('--kui-label-swap-dy: 0%')
  })

  it('computes the incoming copy as the outgoing one minus a full unit, never as its own pair', () => {
    // Authored as two independent expressions the pair drifts the moment anyone edits one of them,
    // and a swap whose copies are not exactly one unit apart reads as a stutter rather than a swap.
    const start = css.indexOf("[data-kui-swap='to'] {")
    expect(css.slice(start, css.indexOf('}', start))).toContain('- 1)')
  })
})

/**
 * `anchored-preview` — one primitive, four placements, sharing `preview` as their child-box
 * channel. The generic `REVEAL_NAMES`-parameterised suites above already cover the shared
 * `INHERITED_STATE` contract (no combinator, no `requiresOwnSubtree`, a `:focus-visible`/`:hover`/
 * `:active` triple, shortened-not-removed reduced motion); what follows is specific to this
 * primitive's own placement geometry and its considered choice not to use CSS anchor positioning.
 */
describe('anchored-preview: one primitive, four placements', () => {
  it('shares one primitive across all four placement names', () => {
    expect(ANCHORED_PREVIEW_PRESETS.map((p) => p.name)).toEqual([
      'anchored-preview',
      'anchored-preview-bottom',
      'anchored-preview-left',
      'anchored-preview-right',
    ])
    const reg = registry()
    for (const preset of ANCHORED_PREVIEW_PRESETS) {
      expect(reg.resolve(preset.name)!.primitive.id).toBe('anchored-preview')
    }
    expect(reg.resolve('anchored-preview')!.primitive.channels).toEqual(['preview'])
  })

  it('declares phase: state on all four placements — none carries Preset.transitions to derive it', () => {
    // `compile.ts`'s `phaseOf` treats an undeclared phase as conflicting with everything, not a
    // permissive default; a reveal driven by inherited custom properties on a real child element
    // has no `transitions` field for it to derive `'state'` from, so each placement says so itself.
    for (const preset of ANCHORED_PREVIEW_PRESETS) {
      const resolved = registry().resolve(preset.name)!
      expect(resolved.preset.phase, preset.name).toBe('state')
      expect(resolved.preset.transitions, preset.name).toBeUndefined()
    }
  })

  it('bounds scale to 0..1 — above 1 is an overshoot, a different request', () => {
    const scale = registry().resolve('anchored-preview')!.primitive.parameters.scale!
    expect(scale.minimum).toBe(0)
    expect(scale.maximum).toBe(1)
    expect(scale.default).toBe('0.85')
  })

  // `lastIndexOf`, not `indexOf`, for the identical reason the label-swap suite above uses it:
  // `anchored-preview-right` is the last name in the four-way shared `position: relative` base rule
  // (`[data-kui-fx~='anchored-preview'], [...-bottom], [...-left], [...-right] { position: relative;
  // ... }`), so the literal `[data-kui-fx~='anchored-preview-right'] {` also closes that shared
  // rule's own brace and a plain `indexOf` finds it before the placement-specific rule further down
  // that actually sets `--kui-anchored-preview-inset`. Applied to all four for the same reason it
  // was applied to all three label-swap names — correct whether or not a given placement happens to
  // collide with the shared rule's boundary today.
  it.each([
    ['anchored-preview', '--kui-anchored-preview-inset: auto auto calc(100% +'],
    ['anchored-preview-bottom', '--kui-anchored-preview-inset: calc(100% +'],
    ['anchored-preview-left', '--kui-anchored-preview-inset: 50% calc(100% +'],
    ['anchored-preview-right', '--kui-anchored-preview-inset: 50% auto auto calc(100% +'],
  ])('%s precomputes its own inset side rather than sharing one', (name, expected) => {
    const start = css.lastIndexOf(`[data-kui-fx~='${name}'] {`)
    expect(start, `no base rule for ${name}`).toBeGreaterThan(-1)
    expect(css.slice(start, css.indexOf('}', start))).toContain(expected)
  })

  it('never reaches for CSS anchor positioning', () => {
    // The project's own planning notes record the owner dropping `anchor()`/`position-anchor`
    // outright on 2026-08-26 for a reason that applies directly to this effect (a harmful,
    // wrong-place fallback rather than a neutral one) — this is a regression guard against a future
    // edit reaching for the "obvious" platform feature this task's own brief raised and rejected.
    const start = css.indexOf("[data-kui-fx~='anchored-preview']")
    const end = css.indexOf('proximity-field / proximity-glow')
    const block = css.slice(start, end)
    expect(block).not.toContain('anchor(')
    expect(block).not.toContain('position-anchor')
  })

  it('keeps the preview uninteractive, the same reasoning hover-intent gives its own hint', () => {
    const start = css.indexOf('[data-kui-preview] {')
    expect(css.slice(start, css.indexOf('}', start))).toContain('pointer-events: none')
  })
})

/**
 * `search-expand` — not a FLIP job, and not `interpolate-size` either.
 */
describe('search-expand: an explicit-length inline-size transition', () => {
  it('registers one primitive across three distinct boxes', () => {
    const reg = registry()
    expect(reg.resolve('search-expand')!.primitive.id).toBe('search-expand')
    expect(reg.resolve('search-expand')!.primitive.channels).toEqual([
      'expand',
      'discrete',
      'search-field',
    ])
    // Not the family's shared `'compositor'` default — `inline-size` triggers layout, unlike every
    // other reveal-shaped effect's opacity/translate/scale.
    expect(reg.resolve('search-expand')!.primitive.perfClass).toBe('layout')
  })

  it('resolves phase: state from Preset.transitions rather than a duplicate explicit declaration', () => {
    // `phaseOf` (`core/compile.ts`) already derives `'state'` for any preset carrying `transitions`
    // — declaring `phase: 'state'` here too would be data that can only drift from the field it
    // duplicates, so this asserts the derivation directly rather than a restated literal.
    expect(SEARCH_EXPAND_PRESETS[0]!.phase).toBeUndefined()
    expect(SEARCH_EXPAND_PRESETS[0]!.transitions).toEqual([{ property: 'inline-size' }])
  })

  it('eases inline-size through Preset.transitions, never a bare host-rule transition', () => {
    expect(SEARCH_EXPAND_PRESETS[0]!.transitions).toEqual([{ property: 'inline-size' }])
    const start = css.indexOf("[data-kui-fx~='search-expand'] {")
    const body = css.slice(start, css.indexOf('}', start))
    expect(body).not.toContain('transition:')
  })

  it('never reaches for interpolate-size — that technique is deliberately deferred pending Safari', () => {
    // `search-expand` is the last section in `interaction.css` today, so its start to end of file
    // is exactly its own block; a future section appended after it would need this to name an end
    // marker instead, the same way the anchor-positioning guard above does.
    //
    // Comments stripped before the check, not after finding the section: the section's own opening
    // comment *names* `interpolate-size` to explain why it is deliberately unused, which is exactly
    // the kind of live-looking-but-inert text `stripComments` exists to remove before a scanner sees
    // it (`css-scan.ts`'s own doc comment makes the identical point about a retired selector kept
    // for reference). Checking the raw slice made this guard fail on its own explanation.
    //
    // The marker has to include the `/*` that opens the section comment, not just the `--- ` text a
    // few characters into its body: `stripComments`'s regex matches a `/*`...`*/` pair, and slicing
    // from *inside* an already-open comment cuts off its opener, so the regex never recognises the
    // truncated remainder as a comment at all and leaves the very text this guard is trying to skip
    // sitting in the "real CSS" it checks.
    const start = css.indexOf("/* --- search-expand")
    expect(start, 'search-expand section not found').toBeGreaterThan(-1)
    expect(stripComments(css.slice(start))).not.toContain('interpolate-size')
  })

  it('keeps the field open once a query has been typed, so blur does not collapse an in-progress search', () => {
    expect(css).toContain(":has(input:not(:placeholder-shown))")
  })

  it('lets the field fill the growth the host makes available', () => {
    // `lastIndexOf`, the same fix as the two `it.each` suites above and for the identical reason:
    // `[data-kui-search-field]` is *also* the last selector in the shared reduced-motion block
    // (`[data-kui-swap], [data-kui-hint], [data-kui-preview], [data-kui-search-field] {
    // transition-duration: 1ms; }`), which appears earlier in the file than this structural rule, so
    // a plain `indexOf` finds that block — which has no `flex`/`min-inline-size` at all — first.
    const start = css.lastIndexOf('[data-kui-search-field] {')
    const body = css.slice(start, css.indexOf('}', start))
    expect(body).toContain('flex: 1 1 auto')
    expect(body).toContain('min-inline-size: 0')
  })
})
