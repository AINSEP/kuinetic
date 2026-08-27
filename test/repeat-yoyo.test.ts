import { beforeEach, describe, expect, it } from 'vitest'
import { compile } from '../src/core/compile.js'
import { parse } from '../src/core/parse.js'
import { Registry } from '../src/core/registry.js'
import type { Timeline } from '../src/core/types.js'
import { catalogRegistry } from './support/registry.js'

/**
 * `repeat:` and `yoyo:` — how many times a segment plays, and whether it alternates.
 *
 * Driven through `parse` + `compile` rather than against `core/repeat.ts` directly, because every
 * claim worth making is about what reaches the browser: which track carries the count, whether the
 * neighbouring track was left alone, and whether an impossible combination was dropped rather than
 * emitted. A unit test of the validator would pass with the compiler wired to nothing.
 */

let registry: Registry

beforeEach(() => {
  registry = catalogRegistry()
})

function run(source: string, timeline: Timeline = 'time') {
  return compile(parse(source), registry, timeline)
}

/** The iteration-count track, which is the whole point of `repeat:`. */
function iterations(source: string, timeline: Timeline = 'time'): string | undefined {
  return run(source, timeline).declarations['animation-iteration-count']
}

function warnings(source: string, timeline: Timeline = 'time'): string {
  return run(source, timeline).warnings.join('\n')
}

describe('repeat: — the value grammar', () => {
  it('lifts a count onto the spec rather than into params', () => {
    // Not a parameter: no `ParameterSchema` declares `repeat`, so leaving it in `params` would
    // make `resolveParams` warn "unknown parameter" on all 262 effects in the catalog.
    const [spec] = parse('fade-up repeat:3').specs
    expect(spec?.repeat).toBe('3')
    expect(spec?.params).toEqual({})
  })

  it('accepts infinite, spelled the way CSS spells it', () => {
    expect(parse('glow-pulse repeat:infinite').specs[0]?.repeat).toBe('infinite')
  })

  it('accepts a fractional count, because animation-iteration-count does', () => {
    expect(iterations('fade-up repeat:2.5')).toBe('2.5')
  })

  it('names a negative count and points at the spelling that works', () => {
    // -1 is how several other libraries spell "forever", so this is a specific wrong idea rather
    // than a typo, and it gets a specific answer.
    expect(warnings('fade-up repeat:-1')).toContain('is negative')
    expect(warnings('fade-up repeat:-1')).toContain('repeat:infinite')
  })

  it('leaves the effect playing once when the count is refused', () => {
    // Fail-open, the same as a refused gate: a mistyped count must not stop the effect running.
    expect(iterations('fade-up repeat:-1')).toBe('var(--kui-fx-fade-up-iterations, 1)')
    expect(iterations('fade-up repeat:banana')).toBe('var(--kui-fx-fade-up-iterations, 1)')
  })

  it('names a count that is not a number', () => {
    expect(warnings('fade-up repeat:banana')).toContain('is not a play count')
  })

  it('warns on repeat:0 but still emits it', () => {
    // GSAP's `repeat: 0` means "play once, no repeats". Ours is the CSS meaning — zero plays — so
    // an author carrying that habit over gets a blank element, and is told exactly that.
    expect(iterations('fade-up repeat:0')).toBe('0')
    expect(warnings('fade-up repeat:0')).toContain('never plays')
  })

  it('names a repeated key rather than silently taking the last one', () => {
    expect(warnings('fade-up repeat:3 repeat:4')).toContain('duplicate parameter "repeat"')
  })
})

describe('yoyo: — the value grammar', () => {
  it('reads true and false as a boolean on the spec', () => {
    expect(parse('fade-up yoyo:true').specs[0]?.yoyo).toBe(true)
    expect(parse('fade-up yoyo:false').specs[0]?.yoyo).toBe(false)
  })

  it('names anything that is not a boolean', () => {
    expect(warnings('fade-up yoyo:maybe')).toContain('is not a boolean')
    expect(parse('fade-up yoyo:maybe').specs[0]?.yoyo).toBeUndefined()
  })

  it('leaves the existing "direction" parameter alone — the reason it is not called that', () => {
    // The split-text primitive declares `direction` with values fade|up|down|mask. A key lifted
    // onto the spec never reaches `spec.params`, so spelling yoyo as `direction:` would have made
    // this line unwritable. This test is the guard on that decision.
    expect(run('split-chars direction:up').vars['--kui-direction']).toBe('up')
    expect(warnings('split-chars direction:up')).toBe('')
  })
})

describe('repeat: — what it compiles to', () => {
  it('writes the count literally into the track', () => {
    // A literal, not an inline `--kui-fx-fade-up-iterations`: `--kui-*` is a flat inherited
    // namespace, and a descendant also carrying `fade-up` would read the ancestor's count.
    // `animation-iteration-count` is not inherited, so a literal cannot travel.
    expect(iterations('fade-up repeat:3')).toBe('3')
    expect(run('fade-up repeat:3').vars).toEqual({})
  })

  it('leaves an unrepeated effect on the preset custom property, unchanged', () => {
    expect(iterations('fade-up')).toBe('var(--kui-fx-fade-up-iterations, 1)')
  })

  it('repeats only the segment it was written on', () => {
    // The whole reason the count is a per-track value list rather than a bare property: a composed
    // one-shot effect must not inherit its neighbour's loop. An element-scoped `repeat:` would
    // have undone that in the grammar after the compiler prevented it in the CSS.
    expect(iterations('fade-up repeat:3, blur-in')).toBe(
      '3, var(--kui-fx-blur-in-iterations, 1)',
    )
  })

  it('overrides a preset that loops forever in its own stylesheet', () => {
    // `spinner` sets --kui-fx-spinner-iterations: infinite in feedback.css. An inline literal in
    // the track beats it, which is what makes "spin twice" expressible at all.
    expect(iterations('spinner repeat:2')).toBe('2')
  })
})

describe('yoyo: — what it compiles to', () => {
  it('writes animation-direction: alternate', () => {
    expect(run('fade-up yoyo:true').declarations['animation-direction']).toBe('alternate')
  })

  it('emits no animation-direction at all when nothing alternates', () => {
    // `normal` is the CSS initial value, so a list of them is a no-op declaration written onto
    // every animated element on every page. Omitting it is what keeps an attribute written before
    // `yoyo:` existed compiling byte-for-byte identically.
    expect(run('fade-up').declarations['animation-direction']).toBeUndefined()
    expect(run('fade-up yoyo:false').declarations['animation-direction']).toBeUndefined()
  })

  it('pads the list to full length so a neighbour is not swept along', () => {
    // A shorter list would be repeated by the browser to match `animation-name`, silently
    // alternating `blur-in` too.
    expect(run('fade-up yoyo:true, blur-in').declarations['animation-direction']).toBe(
      'alternate, normal',
    )
  })

  it('names a cloaked entrance that an even count leaves hidden', () => {
    // alternate + an even count ends on a reversed iteration, and fill-mode: both holds it — for a
    // preset whose from-state is one the visitor must not see, that is a blank element.
    const message = warnings('fade-up yoyo:true repeat:2')
    expect(message).toContain('finishes hidden')
    expect(message).toContain('repeat:3')
    // Warned and kept, not refused: it is a real request with a one-character fix.
    expect(iterations('fade-up yoyo:true repeat:2')).toBe('2')
  })

  it('says nothing about an odd count, or about an effect with nothing to hide', () => {
    expect(warnings('fade-up yoyo:true repeat:3')).toBe('')
    // `fade-out` starts at the rest state, so ending there is not a failure.
    expect(warnings('fade-out yoyo:true repeat:2')).toBe('')
  })
})

describe('repeat: — refusals the renderer forces', () => {
  it('names a JavaScript-rendered effect rather than ignoring the key', () => {
    // The silent-no-op failure this whole feature had to avoid: `count-up` compiles no
    // `animation-iteration-count`, so there is nothing for a repeat to set.
    const message = warnings('count-up repeat:3')
    expect(message).toContain('"count-up"')
    expect(message).toContain('rendered in JavaScript')
    expect(message).toContain('repeat:3')
  })

  it('names yoyo on a JavaScript-rendered effect too', () => {
    expect(warnings('typewriter yoyo:true')).toContain('yoyo:true')
  })

  it('says nothing when neither key was written', () => {
    expect(warnings('count-up')).toBe('')
  })
})

describe('repeat: — refusals the timeline forces', () => {
  it('drops repeat:infinite under a view timeline, and says why', () => {
    // A progress timeline divides its finite range by the iteration count; for `infinite` that
    // collapses the active duration to zero and the element renders frozen at its end state.
    // Dropping the modifier is the fail-open here precisely because keeping it is the broken one.
    expect(iterations('fade-up repeat:infinite', 'view')).toBe(
      'var(--kui-fx-fade-up-iterations, 1)',
    )
    expect(warnings('fade-up repeat:infinite', 'view')).toContain('frozen at its end state')
  })

  it('drops it under a scroll timeline for the same reason', () => {
    expect(iterations('fade-up repeat:infinite', 'scroll')).toBe(
      'var(--kui-fx-fade-up-iterations, 1)',
    )
    expect(warnings('fade-up repeat:infinite', 'scroll')).toContain('"scroll" timeline')
  })

  it('drops it under a pin, where the scrub head spans one playthrough', () => {
    expect(iterations('fade-up repeat:infinite', 'pin')).toBe(
      'var(--kui-fx-fade-up-iterations, 1)',
    )
    expect(warnings('fade-up repeat:infinite', 'pin')).toContain('no iteration past the first')
  })

  it('keeps a finite count under a scroll-driven timeline', () => {
    // Three plays across a finite range is a perfectly coherent request; only "forever" is not.
    expect(iterations('fade-up repeat:3', 'view')).toBe('3')
    expect(warnings('fade-up repeat:3', 'view')).toBe('')
  })

  it('leaves a looping preset alone — only an authored infinite is refused', () => {
    // ~20 ambient/feedback presets set their own `--kui-fx-<name>-iterations: infinite`, and pages
    // pair them with scroll timelines today. The refusal reads `spec.repeat`, which those presets
    // never set, so it must not reach them. (`glow-pulse` warns about the timeline itself here —
    // that diagnostic predates this feature and is not what is being asserted.)
    expect(iterations('glow-pulse', 'view')).toBe('var(--kui-fx-glow-pulse-iterations, 1)')
    expect(warnings('glow-pulse', 'view')).not.toContain('repeat')
  })
})

describe('repeat: — the pin scrub head', () => {
  // The head spans the element's whole compiled timeline — where its one track *ends*, which is
  // that track's own start plus its playback. The leading `var(--kui-reveal-delay, 0ms)` inside
  // the head is that start; it is zero for `fade-up`, and the reason it has to be written is that
  // a delay the head did not include is subtracted from the track without ever being spanned by
  // it, which is what stopped `delay:300ms timeline:pin` half way through.
  const oneIteration =
    'calc(var(--kui-reveal-delay, 0ms) + var(--kui-i, 0) * var(--kui-stagger, 0ms) - ' +
    'var(--kui-progress, 0) * (var(--kui-reveal-delay, 0ms) + ' +
    'var(--kui-reveal-duration, 600ms) + ' +
    '(var(--kui-stagger-count, 1) - 1) * var(--kui-stagger, 0ms)))'

  it('is unchanged when nothing repeats', () => {
    expect(run('fade-up', 'pin').declarations['animation-delay']).toBe(oneIteration)
  })

  it('widens to the whole playback so every iteration is reachable', () => {
    // With a one-iteration head, progress 1 lands on the end of the first play and iterations 2
    // and 3 are unreachable however far the page is scrolled — a knob that exists and does
    // nothing, which is worse than a missing one.
    expect(run('fade-up repeat:3', 'pin').declarations['animation-delay']).toBe(
      oneIteration.replace(
        'var(--kui-reveal-duration, 600ms) +',
        'var(--kui-reveal-duration, 600ms) * 3 +',
      ),
    )
  })
})

describe('repeat: — how at: measures a repeating effect', () => {
  function delays(source: string): string[] {
    return (run(source).declarations['animation-delay'] ?? '').split('), calc(')
  }

  it('measures the whole playback, not one iteration', () => {
    // "start when the previous one ends" has to mean the end the visitor actually sees.
    expect(delays('fade-up 400ms repeat:3, blur-in at:after')[1]).toContain('+ 400ms * 3 +')
  })

  it('is unchanged for an unrepeated neighbour', () => {
    expect(delays('fade-up 400ms, blur-in at:after')[1]).toContain('+ 400ms +')
  })

  it('refuses to measure the end of an effect that never ends', () => {
    // There is no arithmetic answer to "200ms before the end" when there is no end, and each of
    // the plausible readings is a silent lie. Refused by name, the same as an unreadable duration.
    const message = warnings('glow-pulse 400ms repeat:infinite, blur-in at:after')
    expect(message).toContain('never ends')
    expect(message).toContain('at:with')
  })

  it('leaves the refused segment on its own delay, still running', () => {
    const plan = run('glow-pulse 400ms repeat:infinite, blur-in at:after')
    expect(plan.declarations['animation-delay']).toContain('var(--kui-blur-delay, 0ms)')
    expect(plan.declarations['animation-iteration-count']).toContain('infinite')
  })

  it('still accepts at:with against an endless neighbour', () => {
    // A start moment exists even when an end does not, so `with` stays well defined.
    expect(warnings('glow-pulse 400ms repeat:infinite, blur-in at:with')).toBe('')
  })
})
