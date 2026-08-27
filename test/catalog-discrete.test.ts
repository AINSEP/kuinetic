// `@starting-style` discrete-open family (catalog section Q) — `effects/catalog/discrete.ts` and
// `css/discrete.css`. Same three questions `catalog-interaction.test.ts` asks of the hover family
// this is modelled on (registration shape, CSS shape, inert `prepare`), plus the two questions
// specific to this family: the compiled `--kui-transition` merge actually carries `display`/
// `overlay` alongside the visible properties, and `on:enter` warns by name instead of silently
// doing nothing, since there is no `transition-play-state` to defer one of these behind.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { resolveActivationSpec, warnAboutActivation } from '../src/core/activation.js'
import { compile } from '../src/core/compile.js'
import { createParams } from '../src/core/js-params.js'
import { parse } from '../src/core/parse.js'
import { Registry } from '../src/core/registry.js'
import { collectingReporter } from '../src/core/reporter.js'
import type { PrepareContext } from '../src/core/effect-context.js'
import { createStyleLedger } from '../src/core/owned-styles.js'
import { DISCRETE_PRESETS, DISCRETE_PRIMITIVES, registerDiscrete } from '../src/effects/catalog/discrete.js'
import { stripComments } from './support/css-scan.js'
import { catalogRegistry } from './support/registry.js'

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/css/discrete.css'), 'utf8')
// Comment-stripped for the checks that scan for a literal declaration shape — this file's own doc
// comments quote `transition:`/`display` inside backticks while explaining the design, which would
// otherwise read as the very declarations those checks assert are absent. Same idiom
// `css-invariants.test.ts` uses via `stripComments`.
const liveCss = stripComments(css)
const NAMES = DISCRETE_PRESETS.map((preset) => preset.name)

function registry(): Registry {
  return registerDiscrete(new Registry())
}

/** Same shape `catalog-interaction.test.ts` builds for its own `prepare` calls. */
function fakeCtx(el: Element, overrides: Partial<PrepareContext> = {}): PrepareContext {
  return {
    win: window,
    doc: window.document,
    reducedMotion: false,
    warn: () => {},
    style: createStyleLedger(el),
    ...overrides,
  } as unknown as PrepareContext
}

describe('discrete catalog registration', () => {
  it('registers six names, one primitive each', () => {
    expect(DISCRETE_PRESETS).toHaveLength(6)
    expect(DISCRETE_PRIMITIVES).toHaveLength(6)
    const reg = registry()
    expect(DISCRETE_PRESETS.every((preset) => reg.has(preset.name))).toBe(true)
    expect(NAMES).toEqual([
      'fade-open',
      'pop-open',
      'scale-open',
      'drop-open',
      'slide-open-up',
      'slide-open-down',
    ])
  })

  it('every primitive is manual-only — there is no transition-play-state to hold one behind on:enter', () => {
    for (const primitive of DISCRETE_PRIMITIVES) {
      expect(primitive.supportedActivations, primitive.id).toEqual(['manual'])
      expect(primitive.defaultActivation, primitive.id).toBe('manual')
      expect(primitive.renderer, primitive.id).toBe('javascript')
      expect(primitive.channels, primitive.id).toContain('discrete')
    }
  })

  it('resolves to a near-inert instance with no authored positional timing — the real motion lives in CSS', () => {
    const reg = registry()
    for (const preset of DISCRETE_PRESETS) {
      const resolved = reg.resolve(preset.name)!
      const el = document.createElement('div')
      const instance = resolved.primitive.prepare!(el, createParams({}), fakeCtx(el))
      instance.activate()
      expect(el.outerHTML, preset.name).toBe('<div></div>') // untouched — no DOM surgery, no attributes
      instance.destroy()
    }
  })

  it('mirrors an authored positional duration onto --kui-<name>-duration, same as the hover family', () => {
    const reg = registry()
    const resolved = reg.resolve('pop-open')!
    const el = document.createElement('div')
    const instance = resolved.primitive.prepare!(
      el,
      createParams({}, { durationMs: 400, delayMs: 50, easing: 'linear' }),
      fakeCtx(el),
    )
    instance.activate()
    expect((el as HTMLElement).style.getPropertyValue('--kui-pop-open-duration')).toBe('400ms')
    expect((el as HTMLElement).style.getPropertyValue('--kui-pop-open-delay')).toBe('50ms')
    expect((el as HTMLElement).style.getPropertyValue('--kui-pop-open-ease')).toBe('linear')
  })
})

describe('discrete.css shape', () => {
  for (const name of NAMES) {
    it(`${name}: ships an open rule with allow-discrete, a @starting-style from-state, and an unguarded closed rule`, () => {
      const selector = `[data-kui-fx~='${name}']`
      const openRule = new RegExp(
        `\\[data-kui-fx~='${name}'\\] \\{\\s*transition-behavior: allow-discrete;`,
      )
      expect(liveCss, `${name}: missing allow-discrete on its open rule`).toMatch(openRule)
      expect(liveCss, `${name}: missing a --kui-tx-delay slot`).toContain(`--kui-tx-delay-${name}: var(--kui-${name}-delay, 0ms);`)
      expect(liveCss, `${name}: missing closed-state rule`).toContain(
        `${selector}:not(:popover-open):not([open]):not([data-open])`,
      )
    })
  }

  it('every @starting-style block nests one of the six selectors, never sits behind @supports', () => {
    const blocks = [...liveCss.matchAll(/@starting-style\s*\{/g)]
    expect(blocks.length).toBe(NAMES.length)
    expect(liveCss).not.toContain('@supports')
  })

  it('writes no bare host-rule transition: shorthand — timing rides the compiled --kui-transition merge', () => {
    // `transition-behavior` deliberately does not match `\btransition\s*:` — see the file's own
    // header comment for why that longhand has to stay outside the merge.
    expect(liveCss).not.toMatch(/\btransition\s*:/)
  })

  it('never sets display on the open rule — the "to" value must stay whatever the author\'s own CSS gives the element', () => {
    for (const name of NAMES) {
      const openRule = new RegExp(`\\[data-kui-fx~='${name}'\\] \\{[^}]*\\}`, 's')
      const match = openRule.exec(liveCss)
      expect(match, name).not.toBeNull()
      expect(match![0], name).not.toContain('display')
    }
  })
})

describe('transition merge — discrete-open presets', () => {
  const registry = catalogRegistry()

  function run(source: string) {
    return compile(parse(source), registry, 'time')
  }

  it('pop-open merges opacity, scale, display, overlay — the plan\'s own worked example', () => {
    expect(run('pop-open').transition).toBe(
      'opacity var(--kui-pop-open-duration, 600ms) var(--kui-pop-open-ease, ease-out) ' +
        'var(--kui-tx-delay-pop-open, 0ms), ' +
        'scale var(--kui-pop-open-duration, 600ms) var(--kui-pop-open-ease, ease-out) ' +
        'var(--kui-tx-delay-pop-open, 0ms), ' +
        'display var(--kui-pop-open-duration, 600ms) var(--kui-pop-open-ease, ease-out) ' +
        'var(--kui-tx-delay-pop-open, 0ms), ' +
        'overlay var(--kui-pop-open-duration, 600ms) var(--kui-pop-open-ease, ease-out) ' +
        'var(--kui-tx-delay-pop-open, 0ms)',
    )
  })

  it('scale-open carries no opacity segment — it grows into place without also fading', () => {
    expect(run('scale-open').transition).toBe(
      'scale var(--kui-scale-open-duration, 600ms) var(--kui-scale-open-ease, ease-out) ' +
        'var(--kui-tx-delay-scale-open, 0ms), ' +
        'display var(--kui-scale-open-duration, 600ms) var(--kui-scale-open-ease, ease-out) ' +
        'var(--kui-tx-delay-scale-open, 0ms), ' +
        'overlay var(--kui-scale-open-duration, 600ms) var(--kui-scale-open-ease, ease-out) ' +
        'var(--kui-tx-delay-scale-open, 0ms)',
    )
  })

  it('drop-open carries translate alongside opacity, display, overlay', () => {
    expect(run('drop-open').transition).toBe(
      'opacity var(--kui-drop-open-duration, 600ms) var(--kui-drop-open-ease, ease-out) ' +
        'var(--kui-tx-delay-drop-open, 0ms), ' +
        'translate var(--kui-drop-open-duration, 600ms) var(--kui-drop-open-ease, ease-out) ' +
        'var(--kui-tx-delay-drop-open, 0ms), ' +
        'display var(--kui-drop-open-duration, 600ms) var(--kui-drop-open-ease, ease-out) ' +
        'var(--kui-tx-delay-drop-open, 0ms), ' +
        'overlay var(--kui-drop-open-duration, 600ms) var(--kui-drop-open-ease, ease-out) ' +
        'var(--kui-tx-delay-drop-open, 0ms)',
    )
  })

  it('honours an authored positional duration through the same var-or-literal precedence pushTrack gives a compiled animation', () => {
    expect(run('fade-open 400ms').transition).toBe(
      'opacity 400ms var(--kui-fade-open-ease, ease-out) var(--kui-tx-delay-fade-open, 0ms), ' +
        'display 400ms var(--kui-fade-open-ease, ease-out) var(--kui-tx-delay-fade-open, 0ms), ' +
        'overlay 400ms var(--kui-fade-open-ease, ease-out) var(--kui-tx-delay-fade-open, 0ms)',
    )
  })

  it('composes disjoint-channel members without warning, e.g. fade-open with an unrelated hover effect', () => {
    const plan = run('fade-open, lift')
    expect(plan.warnings).toEqual([])
  })
})

describe('activation: manual-only, warns instead of silently no-opping', () => {
  it('on:enter is refused by name for every discrete-open primitive, naming the one supported activation', () => {
    for (const primitive of DISCRETE_PRIMITIVES) {
      const reporter = collectingReporter()
      warnAboutActivation({
        el: document.createElement('div'),
        spec: resolveActivationSpec('enter'),
        supported: primitive.supportedActivations,
        reporter,
      })
      expect(reporter.messages.join(), primitive.id).toContain(
        'activation "enter" is not supported by this effect (supports: manual)',
      )
    }
  })

  it('manual itself is never flagged', () => {
    const reporter = collectingReporter()
    warnAboutActivation({
      el: document.createElement('div'),
      spec: resolveActivationSpec('manual'),
      supported: ['manual'],
      reporter,
    })
    expect(reporter.messages).toEqual([])
  })
})
