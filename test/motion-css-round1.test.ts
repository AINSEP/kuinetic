// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createJsEffectPreparer } from '../src/core/js-effect-preparer.js'
import { createStyleLedger } from '../src/core/owned-styles.js'
import { collectingReporter } from '../src/core/reporter.js'
import { compile } from '../src/core/compile.js'
import { parse } from '../src/core/parse.js'
import { catalogRegistry } from './support/registry.js'
import { CAPS, fakeRoot, idleScheduler } from './support/js-effect-harness.js'
import { readBalancedBlock, ruleBodies, stripComments } from './support/css-scan.js'

const registry = catalogRegistry()
const sheet = (name: string): string => stripComments(readFileSync(join(dirname(fileURLToPath(import.meta.url)), `../src/css/${name}.css`), 'utf8'))
const run = (source: string) => compile(parse(source), registry, 'time')
const EXAMPLES = [
  "fade-open shape:circle origin:'top left' 600ms",
  'fade-open shape:inset radius:24px 600ms',
  'fade-open backdrop:#0008 backdrop-blur:6px 400ms',
  "view-swap attribute:data-scene value:one values:'one two three' type:kui-page-slide-x",
  "view-swap attribute:data-scene value:two values:'one two three' type:kui-page-slide-x",
  "view-swap attribute:data-scene value:three values:'one two three' type:kui-page-slide-x",
  "view-swap attribute:data-scene value:one values:'one two three' type:kui-page-blur-slide",
  "view-swap attribute:data-scene value:two values:'one two three' type:kui-page-blur-slide",
  "view-swap attribute:data-scene value:three values:'one two three' type:kui-page-blur-slide",
  'cascade:50ms',
  'drop-open radius:80px angle:-90deg step:60deg distance:0px',
  'drop-open radius:100px angle:-90deg step:20deg distance:0px',
  'wobble y:6px on:hover',
  'cursor-spotlight gradient:conic',
  'pop scale:1.2 press:1.02',
  'gradient-sweep fill:true color:#ff0080 2s ease:linear repeat:infinite on:load',
  'ripple color:#24a69a strength:1',
  'mask-reveal direction:left 2s',
  'fade-blur-in timeline:view',
  'draw-stroke 2s ease:linear repeat:infinite on:load',
  'view-swap attribute:data-scene value:one type:kui-page-fade-wait',
  'view-swap attribute:data-scene value:two type:kui-page-fade-wait',
  'fade-open 250ms enter-delay:250ms',
  'carousel-fade controls:none next:#wait-next 250ms enter-delay:250ms',
  'fade-open',
]
const frames = (css: string, name: string): string => {
  const start = css.indexOf(`@keyframes ${name} {`)
  expect(start).toBeGreaterThanOrEqual(0)
  return readBalancedBlock(css, css.indexOf('{', start) + 1)
}

describe('Motion CSS additions and existing routes', () => {
  it('validates inline Motion examples through compilation and JS parameter preparation without reporter warnings', () => {
    const reporter = collectingReporter()
    const preparer = createJsEffectPreparer({
      capabilities: CAPS, reporter, respectReducedMotion: true,
      scheduler: idleScheduler, rootResolver: () => fakeRoot,
    })
    for (const source of EXAMPLES) {
      const plan = run(source)
      expect(plan.warnings, source).toEqual([])
      const el = document.createElement('div')
      const controller = new AbortController()
      const ledger = createStyleLedger(el)
      const instances = preparer.prepare({ el, plan, signal: controller.signal, ledger })
      try {
        expect(reporter.messages, source).toEqual([])
      } finally {
        instances.forEach((instance) => instance.destroy())
        controller.abort()
        ledger.restore()
      }
    }
  })

  it('leaves plain variants free of synthesized inline parameters and still reports unknown author keys', () => {
    for (const source of ['fade-open', 'cursor-spotlight', 'mask-reveal', 'gradient-sweep']) {
      expect(run(source).warnings, source).toEqual([])
      expect(run(source).vars, source).toEqual({})
    }
    for (const source of ['fade-open shape:circle', 'cursor-spotlight gradient:conic', 'mask-reveal direction:left', 'gradient-sweep fill:true']) {
      expect(run(`${source} typo:1`).warnings.join(), source).toContain('unknown parameter "typo"')
    }
  })

  it('adds a signed vertical wobble that settles back to rest without pointer input', () => {
    const plan = run('wobble y:-6px on:hover')
    expect(plan.warnings).toEqual([])
    expect(plan.vars['--kui-wobble-y']).toBe('-6px')
    const body = frames(sheet('feedback'), 'kui-wobble')
    expect(body).toContain('translate: calc(-6px * var(--kui-wobble-x, 1)) var(--kui-wobble-y, 0px)')
    expect(body).toContain('translate: calc(4px * var(--kui-wobble-x, 1)) calc(var(--kui-wobble-y, 0px) * -0.6667)')
    expect(body).toContain('rotate: calc(-6deg * var(--kui-wobble-angle, 1))')
    expect(body.slice(body.indexOf('100%'))).toContain('translate: 0 0;')
  })

  it('centres conic sectors on the existing pointer coordinates without rotating them', () => {
    const plan = run('cursor-spotlight gradient:conic')
    expect(plan.warnings).toEqual([])
    expect(plan.vars['--kui-spotlight-paint']).toContain('conic-gradient(at var(--kui-x, 50%) var(--kui-y, 50%)')
    expect(plan.vars['--kui-spotlight-paint']).not.toContain('from ')
    expect(plan.vars['--kui-spotlight-paint']).not.toMatch(/#(?:ff0080|ff0|0fc|08f)\b/i)
    expect(plan.vars['--kui-spotlight-paint']).toContain('var(--kui-spotlight-colors, var(--accent, #d2691e), transparent, var(--accent, #d2691e))')
    expect(sheet('interaction')).toContain('background: var(--kui-spotlight-paint, radial-gradient(')
    expect(run('cursor-spotlight').vars).not.toHaveProperty('--kui-spotlight-paint')
  })

  it('gives pop one press scale with precedence over its hover and focus scales', () => {
    const plan = run('pop scale:1.2 press:1.02')
    expect(plan.warnings).toEqual([])
    expect(plan.vars).toMatchObject({ '--kui-pop-scale': '1.2', '--kui-pop-press': '1.02' })
    const pressed = ruleBodies(sheet('interaction'), "[data-kui-fx~='pop'][style*='--kui-pop-press:']:active").join('')
    expect(pressed).toContain('scale: var(--kui-pop-press);')
    expect(pressed).toContain('--kui-tx-delay-pop: 0ms;')
    expect(run('pop press:-1').warnings.join()).toContain('press')
  })

  it('keeps plain pop at its hover scale while pressed, applying the press override only when requested', () => {
    const rule = sheet('interaction').split('}').find((part) => part.includes('scale: var(--kui-pop-press'))!
    const [selector, body] = rule.split('{')
    const pressedSelector = selector!.trim().replaceAll(':active', '[data-test-active]').replaceAll(':hover', '[data-test-hover]').replaceAll(':focus-visible', '[data-test-focus]')
    const host = document.createElement('button')
    host.setAttribute('data-kui-fx', 'pop')
    host.setAttribute('data-test-active', '')
    host.setAttribute('data-test-hover', '')
    for (const [key, value] of Object.entries(run('pop').vars)) host.style.setProperty(key, value)
    expect(host.matches(pressedSelector)).toBe(false)
    expect(ruleBodies(sheet('interaction'), "[data-kui-fx~='pop']:hover").join('')).toContain('scale: var(--kui-pop-scale, 1.06);')
    for (const [key, value] of Object.entries(run('pop press:1.02').vars)) host.style.setProperty(key, value)
    expect(host.matches(pressedSelector)).toBe(true)
    expect(body).toContain('scale: var(--kui-pop-press);')
  })

  it('uses the existing sweep to fill dim text through a hard edge', () => {
    const plan = run('gradient-sweep fill:true color:#ff0080 2s ease:linear repeat:infinite on:load')
    expect(plan.warnings).toEqual([])
    expect(plan.vars).toMatchObject({ '--kui-sweep-start': '100%', '--kui-sweep-end': '0%', '--kui-sweep-size': '200%' })
    expect(plan.vars['--kui-sweep-paint']).toContain('currentColor) 50%, color-mix(')
    expect(plan.vars['--kui-sweep-paint']).toContain('20%, transparent) 50%)')
    expect(plan.keyframeNames).toEqual(['kui-gradient-sweep'])
    expect(frames(sheet('text'), 'kui-gradient-sweep')).toContain('background-position: var(--kui-sweep-end, -60%) 0')
  })

  it('reverses the reveal edge and mask travel together for a right-to-left reveal', () => {
    const plan = run('mask-reveal direction:left')
    expect(plan.warnings).toEqual([])
    expect(plan.vars).toMatchObject({ '--kui-mask-from': '0%', '--kui-mask-to': '100%', '--kui-mask-angle': '270deg' })
    expect(frames(sheet('media'), 'kui-mask-reveal')).toContain('mask-position: var(--kui-mask-from, 100%) 0')
    expect(sheet('media')).toContain('linear-gradient(var(--kui-mask-angle, 90deg)')
    expect(run('mask-reveal direction:up').warnings.join()).toContain('direction')
  })

})
