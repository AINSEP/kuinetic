// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compile } from '../src/core/compile.js'
import { parse } from '../src/core/parse.js'
import { createParams } from '../src/core/js-params.js'
import { createStyleLedger } from '../src/core/owned-styles.js'
import type { PrepareContext } from '../src/core/effect-context.js'
import { prepareToggle } from '../src/effects/tween/toggle.js'
import type { TweenGroup } from '../src/effects/tween/properties.js'
import { catalogRegistry } from './support/registry.js'
import { animatorOverBody } from './support/js-effect-harness.js'

const registry = catalogRegistry()
const plan = (markup: string) => compile(parse(markup), registry, 'time')
const markup = [
  'tween border-radius:50% rotate:90deg toggle:true 700ms ease:spring',
  "tween border-radius:'0,50%,20%,0' rotate:'0,90,180,0' 1600ms on:click",
  'tween y:-60 toggle:true 900ms ease:bounce',
  'tween x:140 toggle:true 900ms ease:spring',
]

describe('round 4 tween', () => {
  it('uses defined curve tokens in every holding example', () => {
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/css/base.css'), 'utf8')
    for (const source of markup) for (const [, name] of source.matchAll(/\bease:([\w-]+)/g)) {
      expect(css, name).toContain(`--kui-ease-${name}:`)
    }
  })
  it('toggles through the real Animator on repeated clicks for each activation spelling', () => {
    for (const activation of ['on:click', 'on:load', '']) {
      const el = document.createElement('div')
      el.setAttribute('data-kui', `tween x:50 toggle:true 100ms ${activation}`)
      document.body.append(el)
      const animator = animatorOverBody().start()
      try {
        el.click()
        expect(el.style.translate, activation).toContain('var(--kui-tween-x, 0)')
        el.click()
        expect(el.style.translate, activation).toBe('')
        el.click()
        expect(el.style.translate, activation).toContain('var(--kui-tween-x, 0)')
      } finally {
        animator.destroy()
        expect(el.hasAttribute('style')).toBe(false)
        el.remove()
      }
    }
  })
  it('returns to the current stylesheet after a theme change, with no captured style read', () => {
    const sheet = document.createElement('style')
    sheet.textContent = '.round4-rest { border-radius: 8px; }'
    document.head.append(sheet)
    const el = document.createElement('div')
    el.className = 'round4-rest'
    el.setAttribute('data-kui', 'tween border-radius:50% toggle:true on:load')
    document.body.append(el)
    const animator = animatorOverBody().start()
    try {
      el.click()
      sheet.textContent = '.round4-rest { border-radius: 24px; }'
      el.click()
      expect(el.style.borderRadius).toBe('')
      expect(window.getComputedStyle(el).borderRadius).toBe('24px')
    } finally {
      animator.destroy()
      el.remove()
      sheet.remove()
    }
  })
  it('keeps touched toggle groups out of synthesized inline parameters', () => {
    const toggled = plan('tween x:50 opacity:0 toggle:true')
    expect(Object.keys(toggled.vars).filter((key) => /-(?:translate|opacity)-toggle$/.test(key))).toEqual([])
  })
  it.each(markup)('compiles the exact holding markup without warnings: %s', (source) => {
    expect(plan(source).warnings).toEqual([])
  })
  it('uses a spring transition on only the opted-in properties and retains normal tweens', () => {
    const toggled = plan(markup[0]!)
    expect(toggled.declarations['animation-name']).toBeUndefined()
    expect(toggled.transition).toContain('border-radius')
    expect(toggled.transition).toContain('var(--kui-tween-border-radius-ease,')
    expect(toggled.vars['--kui-tween-ease']).toBe('var(--kui-ease-spring, ease-out)')
    expect(plan('tween x:140').transition).toBeUndefined()
    expect(plan('tween x:140').jsEffects).toEqual([])
    expect(plan('tween x:140').declarations['animation-name']).toBe('kui-tween-to-translate')
    expect(plan('tween border-radius:50%, fade-in').warnings).toEqual([])
    expect(plan('tween width:100 height:100').warnings.join(' ')).toContain('unknown parameter')
  })
  it.each(["tween x:'0,10' toggle:true", 'tween-from x:10 toggle:true'])('refuses unsupported toggles: %s', (source) => {
    expect(plan(source).warnings.join(' ')).toContain('toggle:true needs a scalar tween')
    expect(plan(source).transition).toBeUndefined()
  })
  it('writes destinations on rapid clicks, keeps the resting state, and removes its listener', () => {
    const el = document.createElement('div')
    el.style.setProperty('border-radius', '8px')
    const style = createStyleLedger(el)
    const ctx = { win: window, style } as unknown as PrepareContext
    const stop = prepareToggle(el, ['border-radius'], ctx)
    el.click()
    expect(el.style.borderRadius).toBe('var(--kui-tween-border-radius, 0px)')
    el.click()
    expect(el.style.borderRadius).toBe('8px')
    el.click()
    stop()
    style.restore()
    el.click()
    expect(el.style.borderRadius).toBe('8px')
  })
  it('constructs grouped destinations without touching unused channels', () => {
    const set = vi.fn()
    const el = document.createElement('div')
    const groups: TweenGroup[] = ['translate', 'rotate', 'scale', 'opacity', 'filter', 'color', 'background']
    const stop = prepareToggle(el, groups,
      { win: window, style: { set } } as unknown as PrepareContext)
    el.click()
    expect(set.mock.calls.map(([key]) => key)).toEqual(['translate', 'rotate', 'scale', 'opacity', 'filter', 'color', 'background-color'])
    expect(set.mock.calls.find(([key]) => key === 'scale')![1]).toContain('var(--kui-tween-scale-x, var(--kui-tween-scale, 1))')
    expect(set.mock.calls.find(([key]) => key === 'filter')![1]).toContain('blur(var(--kui-tween-blur, 0px))')
    stop()
  })
  it('installs the opt-in variant through the compiled plan', () => {
    const set = vi.fn()
    const el = document.createElement('div')
    const entry = plan('tween opacity:0 toggle:true on:load').jsEffects[0]!
    const instance = entry.variant!.prepare!(el, createParams({}),
      { win: window, style: { set } } as unknown as PrepareContext)
    instance.activate()
    el.click()
    expect(set).toHaveBeenCalledOnce()
    instance.destroy()
  })
})
