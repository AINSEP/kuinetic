// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveActivationSpec, warnAboutActivation } from '../src/core/activation.js'
import { collectingReporter } from '../src/core/reporter.js'
import { build } from './support/js-effect-harness.js'

/**
 * When does "activation X is not supported by this effect" fire on a *composition*?
 *
 * The check runs against what every composed primitive declares in common, so one load-only widget
 * in a comma list used to make an authored `on:enter` warn — even when the entrance beside it is
 * exactly what `on:enter` was written for. `host-facts.ts` records that as the accepted trade: the
 * entrance names the trigger, the widget wires up when its element scrolls into view instead of at
 * load, "late, and it still works". The warning was therefore false for that shape and true for
 * the others, and these cases pin both halves.
 *
 * The shape is `demo/index.html`'s `#deck-demo`: a carousel host step, an entrance with `on:enter`,
 * and a targeted hover step with its own `on:load`.
 */

afterEach(() => {
  vi.unstubAllGlobals()
})

const DECK = `
  <div data-kui="ATTR">
    <div class="slide"></div><div class="dot"></div><a class="play">go</a>
  </div>`

function unsupportedNotes(attr: string): string[] {
  const reporter = collectingReporter()
  build(DECK.replace('ATTR', attr), reporter).start()
  return reporter.messages.filter((message) => message.includes('is not supported by this effect'))
}

describe('activation warnings on a composed attribute', () => {
  it('does not warn when a load-only widget shares the element with an entrance that names on:enter', () => {
    // The `#deck-demo` shape.
    expect(
      unsupportedNotes(
        "carousel target:'.slide, .dot', fade-blur-up distance:280px 1800ms on:enter, pop scale:1.08 target:.play on:load",
      ),
    ).toEqual([])
  })

  it('does not warn for a plain widget-plus-entrance pair either', () => {
    expect(unsupportedNotes("carousel target:'.slide, .dot', fade-up on:enter")).toEqual([])
  })

  it('still warns when the load-only widget has no entrance to justify the trigger', () => {
    // Nothing is being revealed: this is a widget asked to wire up only once scrolled to, which is
    // the mistake the warning exists to catch.
    expect(unsupportedNotes("carousel target:'.slide, .dot' on:enter")).toHaveLength(1)
  })

  it('still warns for a manual-only primitive even beside an entrance', () => {
    // `enter` can never fire a manual-only effect, so it is not "late" — it is dead.
    expect(unsupportedNotes('fade-up on:enter, fade-open')).toHaveLength(1)
  })

  it('still warns when the composed effects share no activation at all', () => {
    // An entrance declaring only `enter` beside a manual-only effect: the intersection is empty,
    // which must not read as "nothing declared" — the manual effect is dead under `on:enter`.
    const reporter = collectingReporter()
    warnAboutActivation({
      el: document.createElement('div'),
      spec: resolveActivationSpec('enter'),
      supported: [],
      claims: [
        { supported: ['enter'], entrance: true },
        { supported: ['manual'], entrance: false },
      ],
      reporter,
    })
    expect(reporter.messages.filter((m) => m.includes('is not supported by this effect'))).toHaveLength(1)
  })
})
