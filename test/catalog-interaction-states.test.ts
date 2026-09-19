// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { findConflicts } from '../src/core/channels.js'
import type { ChannelClaim } from '../src/core/channels.js'
import { resolveParams } from '../src/core/params.js'
import { readBalancedBlock, stripComments } from './support/css-scan.js'
import { build, el } from './support/js-effect-harness.js'
import { catalogRegistry } from './support/registry.js'

/**
 * `press-depth` and `group-dim` — the two *state* effects of catalog section I.
 *
 * Their own file rather than more cases in `catalog-interaction.test.ts`, the same split
 * `catalog-interaction-beam.test.ts` already made for the same reason (ESLint's per-file line cap),
 * and along the same seam: nothing here needs the pointer/DOM rig that file carries for the
 * `tilt-*`/`cursor-*` family.
 *
 * Both effects exist because of a *state* that had no name, so most of what is worth asserting is
 * about which selector they key on and which they deliberately do not:
 *
 *  - `press-depth` is the only rule in `interaction.css` with no fine-pointer gate. That is the
 *    whole point of it — a press has an end where a hover does not, and touch is the pointer type
 *    with no hover to give a control any affordance at all — so "is it still outside the gate" is
 *    a regression worth a test rather than a detail.
 *  - `group-dim` paints its container's *children*, which makes it the first preset in this
 *    section to reach past itself, and the channel it claims is what decides whether composing it
 *    with an ordinary opacity effect works or silently deletes one of them.
 */

const css = stripComments(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/css/interaction.css'), 'utf8'),
)

// The shared, sealed full catalog rather than a private `registerInteraction(new Registry())`:
// the composition cases below compare a section I name against `fade-in`, which lives in
// `catalog/core.ts`, and nothing here registers onto the registry it reads.
const registry = catalogRegistry()

/** A preset's declared channels, as `findConflicts` wants them. */
function claim(name: string): ChannelClaim {
  return { name, channels: [...registry.resolve(name)!.primitive.channels] }
}

/**
 * Every `@media (hover: hover) and (pointer: fine)` block body in the stylesheet.
 *
 * Brace-balanced via the shared scanner rather than "everything after the marker": the file has
 * more than one such block now, and a naive slice to the next `}` stops at the first nested rule.
 */
function fineHoverBlocks(source: string): string[] {
  const marker = '@media (hover: hover) and (pointer: fine)'
  const blocks: string[] = []
  for (let at = source.indexOf(marker); at !== -1; at = source.indexOf(marker, at + marker.length)) {
    blocks.push(readBalancedBlock(source, source.indexOf('{', at) + 1))
  }
  return blocks
}

describe('press-depth — the :active state section I never had', () => {
  it('registers, and its primitive is the reusable half of the name', () => {
    // `press`, not `press-depth`: a future `glass-press` is a second Preset row on this primitive
    // plus its own selector, inheriting the `--kui-press-*` namespace, the schema, the
    // reduced-motion policy and the channel claim rather than restating any of them.
    const resolved = registry.resolve('press-depth')!
    expect(resolved.primitive.id).toBe('press')
  })

  it('claims scale and shadow, and deliberately not translate', () => {
    // The claim is a veto, not documentation: `compile.ts` *drops* every effect after the first
    // when two claims overlap. Claiming `translate` would make `lift, press-depth` — raise on
    // hover, sink on press, the most useful pairing this effect has — delete the press outright.
    expect(registry.resolve('press-depth')!.primitive.channels).toEqual(['scale', 'shadow'])
  })

  it('composes with lift, and is refused against the two presets that really do share its box', () => {
    const conflictsWith = (name: string): string[] =>
      findConflicts([claim(name), claim('press-depth')]).map((conflict) => conflict.channel)

    expect(conflictsWith('lift')).toEqual([])
    // Both genuinely write `box-shadow` on the same box in overlapping states, so the refusal is
    // correct rather than a false positive the way a `translate` claim would have been.
    expect(conflictsWith('lift-shadow')).toEqual(['shadow'])
    expect(conflictsWith('pop')).toEqual(['scale'])
  })

  it('transitions exactly the two properties its channels cover', () => {
    // Through `Preset.transitions`, never a bare host-rule `transition:` — see
    // `css-composition-invariants.test.ts` for why the stylesheet spelling is a violation now.
    expect(registry.resolve('press-depth')!.preset.transitions).toEqual([
      { property: 'scale' },
      { property: 'box-shadow' },
    ])
  })

  it('ships an :active rule', () => {
    expect(css).toContain("[data-kui-fx~='press-depth']:active")
  })

  it('leaves that rule outside every fine-pointer block, so a touchscreen still gets it', () => {
    const blocks = fineHoverBlocks(css)
    // Non-vacuity: the blocks are found at all, and they really are where the hover family lives.
    expect(blocks.length).toBeGreaterThan(0)
    expect(blocks.some((block) => block.includes("[data-kui-fx~='lift']:hover"))).toBe(true)

    // The regression this guards: gating `:active` to fine pointers removes the press from exactly
    // the devices with no hover state to signal that a control is live. `:active` cannot strand an
    // element the way `:hover` can — the browser releases it on pointerup — so the reason the
    // hover rules are gated does not apply here.
    expect(blocks.some((block) => block.includes('press-depth'))).toBe(false)
  })

  it('drives its whole shadow from one authored length', () => {
    // Offset, blur and spread all scale together, so the collapse stays proportional however far
    // the press is pushed. There is no `box-shadow` parameter type to author the value whole.
    expect(css).toContain('var(--kui-press-shadow-depth, 2px)')
    expect(css).toContain('calc(var(--kui-press-shadow-depth, 2px) * 2)')
    expect(css).toContain('calc(var(--kui-press-shadow-depth, 2px) * -1)')
  })

  it('writes authored geometry to its own namespaced properties', () => {
    const { primitive } = registry.resolve('press-depth')!
    expect(resolveParams({ scale: '0.9' }, primitive.parameters, () => {})).toEqual({
      '--kui-press-scale': '0.9',
    })
    expect(resolveParams({ depth: '6px' }, primitive.parameters, () => {})).toEqual({
      '--kui-press-shadow-depth': '6px',
    })
  })

  it('emits no colour declaration when none is authored, so the CSS fallback still decides', () => {
    // The empty-default convention `COLOR_PARAMS` documents: a real default here would seize the
    // shadow colour from every author who never asked for one.
    const { primitive } = registry.resolve('press-depth')!
    expect(resolveParams({}, primitive.parameters, () => {})).toEqual({})
    expect(resolveParams({ color: 'rebeccapurple' }, primitive.parameters, () => {})).toEqual({
      '--kui-press-shadow-color': 'rebeccapurple',
    })
  })
})

describe('group-dim — collective hover, read off the container', () => {
  it('claims a channel of its own rather than opacity', () => {
    // It paints its *children's* opacity, which is a different box. Filing it under `opacity`
    // would make the compiler refuse `fade-in, group-dim` — a container that fades itself in and
    // dims its children on hover — even though the two never touch the same box.
    expect(registry.resolve('group-dim')!.primitive.channels).toEqual(['group'])
  })

  it('declares requiresOwnSubtree, because its rules reach its children', () => {
    // `target:` relocates `data-kui-fx` onto whatever a selector matches, and a `> *` rule that
    // lands somewhere with a different shape beneath it compiles to silence.
    // `css-requires-own-subtree.test.ts` re-derives this set from the stylesheet rather than
    // trusting the flag; this asserts the flag itself is on the preset.
    expect(registry.resolve('group-dim')!.preset.requiresOwnSubtree).toBe(true)
  })

  it('declares no host-box transitions, since nothing moves on the container', () => {
    // `Preset.transitions` compiles into one `--kui-transition` on the element carrying
    // `data-kui-fx` — the container — so it cannot reach the children at all. Theirs is authored
    // on their own rule in interaction.css instead.
    expect(registry.resolve('group-dim')!.preset.transitions).toBeUndefined()
  })

  it('gives its children their own transition and no delay on the way back out', () => {
    expect(css).toContain("[data-kui-fx~='group-dim'] > * {")
    expect(css).toContain(
      'transition: opacity var(--kui-group-dim-duration, 260ms) var(--kui-group-dim-ease, ease-out);',
    )
    // The delay lives on the state rules only, so it buys hover intent without leaving the grid
    // dim after the pointer has gone — the asymmetry interaction.css's opening comment describes.
    expect(css).toContain('transition-delay: var(--kui-group-dim-delay, 0ms);')
  })

  it('excludes the same lit set in both state rules', () => {
    // The regression: written as two independent rules — one sparing the hovered child, one
    // sparing the focused child — a pointer over card A while focus sits on card B makes each rule
    // dim the other rule's survivor and the whole grid goes flat. One shared exclusion list, used
    // verbatim by both, is what prevents it.
    const exclusion = '> :not(:hover, :focus-visible, :has(:focus-visible))'
    expect(css.split(exclusion)).toHaveLength(3) // two occurrences
  })

  it('gates only the hover-triggered rule to fine pointers, and leaves the focus one everywhere', () => {
    const blocks = fineHoverBlocks(css)
    expect(blocks.some((block) => block.includes("[data-kui-fx~='group-dim']:has(> :hover"))).toBe(
      true,
    )
    // Keyboard focus reaches the effect on every pointer type, the same contract every
    // `:focus-visible` rule in this file keeps.
    expect(css).toContain("[data-kui-fx~='group-dim']:has(:focus-visible)")
  })

  it('shortens the dim under reduced motion rather than removing it', () => {
    // base.css shortens `[data-kui-rm]` and its pseudo-elements; this effect's motion is on a child
    // box that attribute never lands on, so the reach is written out in interaction.css.
    const at = css.indexOf('@media (prefers-reduced-motion: reduce)', css.indexOf('group-dim'))
    const block = readBalancedBlock(css, css.indexOf('{', at) + 1)
    expect(block).toContain("[data-kui-fx~='group-dim'] > *")
    expect(block).toContain('transition-duration: 1ms;')
  })

  it('composes with an ordinary opacity entrance on the same container', () => {
    expect(findConflicts([claim('fade-in'), claim('group-dim')])).toEqual([])
  })

  it('accepts an authored dim level and refuses one outside the alpha range', () => {
    const { primitive } = registry.resolve('group-dim')!
    expect(resolveParams({ opacity: '0.15' }, primitive.parameters, () => {})).toEqual({
      '--kui-group-dim-opacity': '0.15',
    })

    const warn = vi.fn()
    expect(resolveParams({ opacity: '4' }, primitive.parameters, warn)).toEqual({})
    expect(warn).toHaveBeenCalled()
  })
})

/**
 * Positional timing, through the real attribute → parse → compile → animator pipeline.
 *
 * Both primitives are stylesheet-driven: they render nothing themselves, and the only reason their
 * `prepare` is not a no-op is that `lift 400ms` (positional) reaches no custom property on its own
 * while `lift duration:400ms` does — see `js-effect-timing-parity.test.ts` for the full account of
 * that gap. A new stylesheet-driven primitive that forgot `stylesheetTimingPrepare` would parse,
 * install, and silently discard the number.
 */
describe('positional timing reaches both state effects', () => {
  const prop = (name: string): string => el().style.getPropertyValue(name)

  beforeEach(() => {
    vi.useFakeTimers()
    document.body.innerHTML = ''
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('mirrors all three tokens onto press-depth', () => {
    build('<button data-kui="press-depth 90ms 50ms linear">Go</button>').start()

    expect(prop('--kui-press-duration')).toBe('90ms')
    expect(prop('--kui-press-delay')).toBe('50ms')
    expect(prop('--kui-press-ease')).toBe('linear')
  })

  it('mirrors all three tokens onto group-dim', () => {
    build('<ul data-kui="group-dim 400ms 150ms ease-in"><li></li><li></li></ul>').start()

    expect(prop('--kui-group-dim-duration')).toBe('400ms')
    expect(prop('--kui-group-dim-delay')).toBe('150ms')
    expect(prop('--kui-group-dim-ease')).toBe('ease-in')
  })
})
