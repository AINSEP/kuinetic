// @vitest-environment jsdom
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
import { indexStaggerGroup, releaseStaggerGroup } from '../src/core/stagger.js'
import { DISCRETE_PRESETS, DISCRETE_PRIMITIVES, registerDiscrete } from '../src/effects/catalog/discrete.js'
import { ruleBodies, stripComments } from './support/css-scan.js'
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
  it.each(NAMES)('%s leaves native backdrop paint untouched unless each property is requested', (name) => {
    const host = document.createElement('dialog')
    host.setAttribute('data-kui-fx', name)
    const paintProperties = (): string[] => liveCss.split('}').flatMap((rule) => {
      const parts = rule.split('{')
      if (parts.length < 2) return []
      const selector = parts.at(-2)!.trim()
      const properties = [...parts.at(-1)!.matchAll(/(?:^|;)\s*(background|backdrop-filter)\s*:/g)].map((match) => match[1]!)
      if (!properties.length || !selector.endsWith('::backdrop')) return []
      return host.matches(selector.slice(0, -'::backdrop'.length)) ? properties : []
    })
    const apply = (source: string): void => {
      host.removeAttribute('style')
      const plan = compile(parse(source), catalogRegistry(), 'time')
      expect(plan.warnings).toEqual([])
      for (const [key, value] of Object.entries(plan.vars)) host.style.setProperty(key, value)
    }
    apply(name)
    expect(paintProperties()).toEqual([])
    apply(`${name} backdrop:transparent`)
    expect(paintProperties()).toEqual(['background'])
    apply(`${name} backdrop-blur:0px`)
    expect(paintProperties()).toEqual(['backdrop-filter'])
    apply(`${name} backdrop:#0008 backdrop-blur:6px`)
    expect(paintProperties()).toEqual(['background', 'backdrop-filter'])
  })

  it('preserves the original drop-open closed rule inside an open details or panel', () => {
    const selector = "[data-kui-fx~='drop-open']:not(:popover-open):not([open]):not([data-open])"
    const closed = ruleBodies(liveCss, selector).join('')
    expect(closed).toContain('display: none;')
    expect(closed).toContain('opacity: 0;')
    expect(closed).toContain('translate: 0 calc(var(--kui-drop-open-distance, 12px) * -1);')
    for (const parent of ['<details open>', '<div data-open>']) {
      const fixture = document.createElement('div')
      fixture.innerHTML = `${parent}<div data-kui-fx="drop-open"></div>`
      const item = fixture.firstElementChild!.firstElementChild!
      expect(item.matches(selector.replace(':popover-open', '[data-test-popover-open]'))).toBe(true)
      expect(ruleBodies(liveCss, "[data-kui-fx~='drop-open']").join('')).toContain('translate: 0 0;')
    }
  })

  for (const name of NAMES) {
    it(`${name}: ships an open rule with allow-discrete, a @starting-style from-state, and an unguarded closed rule`, () => {
      const selector = `[data-kui-fx~='${name}']`
      const openRule = new RegExp(
        `\\[data-kui-fx~='${name}'\\] \\{[^}]*transition-behavior: allow-discrete;`,
      )
      expect(liveCss, `${name}: missing allow-discrete on its open rule`).toMatch(openRule)
      expect(liveCss, `${name}: missing a --kui-tx-delay slot`).toContain(`--kui-tx-delay-${name}:`)
      expect(liveCss, `${name}: missing closed-state rule`).toContain(
        `${selector}:not(:popover-open):not([open]):not([data-open])`,
      )
    })
  }

  it('every @starting-style block nests one of the six selectors, never sits behind @supports', () => {
    const blocks = [...liveCss.matchAll(/@starting-style\s*\{/g)]
    expect(blocks.length).toBe(NAMES.length + 3)
    expect(liveCss).not.toContain('@supports')
  })

  it('writes no bare host-rule transition: shorthand — timing rides the compiled --kui-transition merge', () => {
    // `transition-behavior` deliberately does not match `\btransition\s*:` — see the file's own
    // header comment for why that longhand has to stay outside the merge.
    const hostRules = liveCss.split('}').filter((rule) => !rule.includes('::backdrop')).join('}')
    expect(hostRules).not.toMatch(/\btransition\s*:/)
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

  it('preserves plain fade-open composition with clip effects in either order', () => {
    for (const effect of ['heart-fill', 'bookmark-fill', 'chart-area-fill', 'curtain-wipe', 'curtain-reveal', 'wipe-up', 'wipe-down', 'wipe-left', 'wipe-right', 'wipe-circle', 'wipe-diagonal', 'before-after-wipe', 'typewriter', 'typewriter-loop', 'star-rating-fill']) {
      for (const names of [['fade-open', effect], [effect, 'fade-open']]) {
        const plan = run(names.join(', '))
        expect(plan.warnings, names.join(', ')).toEqual([])
        expect(plan.fxNames).toEqual(names)
      }
    }
    expect(run('fade-open').transition).not.toContain('clip-path')
    for (const shape of ['circle', 'inset']) {
      expect(run(`fade-open shape:${shape}, wipe-up`).warnings.join()).toContain('both animate clip')
    }
  })

  it('does not apply clip-path rules to plain fade-open, including inside a shaped host', () => {
    const parent = document.createElement('div')
    parent.style.setProperty('--kui-open-clip-end', 'circle(150%)')
    parent.style.setProperty('--kui-open-clip-start', 'circle(0%)')
    parent.innerHTML = '<div data-kui-fx="fade-open" data-open></div>'
    const host = parent.firstElementChild as HTMLElement
    const clipSelectors = liveCss.split('}').flatMap((rule) => {
      const parts = rule.split('{')
      if (!parts.at(-1)?.includes('clip-path:')) return []
      return [parts.at(-2)!.trim().replaceAll(':popover-open', '[data-test-popover-open]')]
    })
    expect(clipSelectors.filter((selector) => host.matches(selector))).toEqual([])
    for (const [key, value] of Object.entries(run('fade-open shape:circle').vars)) host.style.setProperty(key, value)
    expect(clipSelectors.some((selector) => host.matches(selector))).toBe(true)
  })

  it('places ring or arc items from radius, starting angle and indexed angle spacing', () => {
    const plan = run('drop-open radius:80px angle:-90deg step:60deg distance:0px')
    expect(plan.warnings).toEqual([])
    expect(plan.vars).toMatchObject({ '--kui-fan-radius': '80px', '--kui-fan-start': '-90deg', '--kui-fan-step': '60deg', '--kui-drop-open-distance': '0px' })
    expect(liveCss).toContain('--kui-fan-angle: calc(var(--kui-fan-start, -90deg) + var(--kui-i, 0) * var(--kui-fan-step, 60deg));')
    expect(liveCss).toContain('--kui-fan-translate: calc(cos(var(--kui-fan-angle)) * var(--kui-fan-radius)) calc(sin(var(--kui-fan-angle)) * var(--kui-fan-radius));')
    expect(run('drop-open radius:100px angle:-90deg step:20deg').vars['--kui-fan-step']).toBe('20deg')
    expect(plan.transition).toContain('translate')
  })

  it('uses existing cascade indexing for fan placement and incoming stagger, restoring indices on release', () => {
    const group = document.createElement('div')
    group.setAttribute('data-kui', 'cascade:50ms')
    group.innerHTML = Array.from({ length: 6 }, () => '<div data-kui="drop-open radius:80px step:60deg"></div>').join('')
    indexStaggerGroup(group)
    expect([...group.children].map((child) => (child as HTMLElement).style.getPropertyValue('--kui-i'))).toEqual(['0', '1', '2', '3', '4', '5'])
    expect(group.style.getPropertyValue('--kui-stagger')).toBe('50ms')
    expect(liveCss).toContain('--kui-tx-delay-drop-open: calc(var(--kui-drop-open-delay, 0ms) + var(--kui-i, 0) * var(--kui-stagger, 0ms));')
    releaseStaggerGroup(group)
    expect(group.style.getPropertyValue('--kui-stagger')).toBe('')
    expect((group.firstElementChild as HTMLElement).style.getPropertyValue('--kui-i')).toBe('')
  })

  it('keeps group items out of layout when closed and accepts native or authored parent open state', () => {
    const itemSelector = "[data-kui-fx~='drop-open'][style*='--kui-fan-radius:']"
    const closedSelector = `${itemSelector}:not(:popover-open):not([open]):not([data-open])`
    const groupOpenSelector = `:is([data-open], [open], :popover-open) > ${closedSelector}`
    const openRule = ruleBodies(liveCss, groupOpenSelector).join('')
    expect(openRule).toContain('display: revert-layer;')
    expect(openRule).toContain('opacity: 1;')
    expect(openRule).toContain('translate: var(--kui-fan-translate);')
    expect(ruleBodies(liveCss, closedSelector).join('')).toContain('--kui-tx-delay-drop-open: var(--kui-drop-open-delay, 0ms);')
    for (const attribute of ['open', 'data-open', 'data-test-popover-open']) {
      const parent = document.createElement('div')
      parent.setAttribute(attribute, '')
      parent.innerHTML = '<div data-kui-fx="drop-open"></div>'
      const item = parent.firstElementChild as HTMLElement
      const selector = groupOpenSelector.replaceAll(':popover-open', '[data-test-popover-open]')
      expect(item.matches(selector)).toBe(false)
      for (const [key, value] of Object.entries(run('drop-open radius:80px').vars)) item.style.setProperty(key, value)
      expect(item.matches(selector)).toBe(true)
      parent.removeAttribute(attribute)
      expect(item.matches(selector)).toBe(false)
    }
  })

  it('delays only the arriving fade-open state, so leaving can finish first', () => {
    const plan = run('fade-open 250ms enter-delay:250ms')
    expect(plan.warnings).toEqual([])
    expect(plan.vars['--kui-fade-open-enter-delay']).toBe('250ms')
    expect(liveCss).toContain('--kui-tx-delay-fade-open: calc(var(--kui-fade-open-delay, 0ms) + var(--kui-fade-open-enter-delay, 0ms));')
    const closed = liveCss.split("[data-kui-fx~='fade-open']:not(:popover-open):not([open]):not([data-open]) {")[1]!.split('}')[0]!
    expect(closed).toContain('--kui-tx-delay-fade-open: var(--kui-fade-open-delay, 0ms);')
    expect(closed).not.toContain('enter-delay')
  })

  it('compiles circle endpoints and a quoted corner origin without consuming sequence at:', () => {
    const plan = run("fade-open shape:circle origin:'top left'")
    expect(plan.warnings).toEqual([])
    expect(plan.vars['--kui-open-origin']).toBe('top left')
    expect(plan.vars['--kui-open-clip-start']).toBe('circle(0% at var(--kui-open-origin, center))')
    expect(plan.vars['--kui-open-clip-end']).toBe('circle(150% at var(--kui-open-origin, center))')
    expect(plan.transition).toContain('clip-path')
    expect(ruleBodies(liveCss, "[data-kui-fx~='fade-open'][style*='--kui-open-clip-end:']").join('')).toContain('clip-path: var(--kui-open-clip-end);')
    expect(liveCss).toContain('clip-path: var(--kui-open-clip-start);')
  })

  it('keeps inset corners round at both endpoints and rejects an unknown origin', () => {
    const plan = run('fade-open shape:inset radius:24px')
    expect(plan.warnings).toEqual([])
    expect(plan.vars['--kui-open-radius']).toBe('24px')
    expect(plan.vars['--kui-open-clip-start']).toContain('inset(50% round')
    expect(plan.vars['--kui-open-clip-end']).toContain('inset(0% round')
    expect(run('fade-open origin:banana').warnings.join()).toContain('origin')
    expect(run('fade-open').vars).toEqual({})
  })

  it('compiles backdrop tint and blur on a sliding host and supplies both fade endpoints', () => {
    const plan = run('slide-open-up backdrop:#0008 backdrop-blur:6px')
    expect(plan.warnings).toEqual([])
    expect(plan.vars['--kui-open-backdrop']).toBe('#0008')
    expect(plan.vars['--kui-open-backdrop-blur']).toBe('6px')
    expect(liveCss).toMatch(/::backdrop\s*\{[^}]*opacity: 1;[^}]*transition: inherit;/s)
    expect(liveCss).toMatch(/@starting-style\s*\{[^{}]*::backdrop\s*\{ opacity: 0;/)
    expect(liveCss).toContain(':not(:popover-open):not([open])::backdrop { opacity: 0; }')
  })

  it('takes backdrop duration, easing and motion policy from the host transition instead of a second clock', () => {
    const plan = run('fade-open backdrop:#0008 backdrop-blur:6px 400ms ease-in')
    expect(plan.warnings).toEqual([])
    expect(plan.transition).toContain('opacity 400ms ease-in ')
    const selector = "[data-kui-fx]:is([style*='--kui-open-backdrop:'], [style*='--kui-open-backdrop-blur:'])::backdrop"
    expect(ruleBodies(liveCss, selector).join('')).toContain('transition: inherit;')
    expect(liveCss).not.toContain('--kui-open-duration')
    expect(liveCss).not.toContain('--kui-open-ease')
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
