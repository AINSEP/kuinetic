// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { compile } from '../src/core/compile.js'
import { createParams } from '../src/core/js-params.js'
import { createStyleLedger } from '../src/core/owned-styles.js'
import { parse } from '../src/core/parse.js'
import type { PrepareContext } from '../src/core/effect-context.js'
import { catalogRegistry } from './support/registry.js'
import { build } from './support/js-effect-harness.js'
import { collectingReporter } from '../src/core/reporter.js'
import { atRuleBlocks, ruleBodies } from './support/css-scan.js'

const registry = catalogRegistry()
const examples = [
  'masked-label-swap stagger:25ms',
  'lift, masked-label-swap stagger:25ms',
  "word-cycler words:'Animate|Spring|Easing' swap:scramble step:40ms interval:1200ms on:load",
  "word-cycler words:Stagger swap:scramble from:center step:40ms interval:1200ms on:load",
  'pin-section distance:150vh',
  'split-words hold:true on:load',
  "typewriter words:'Websites|Apps|Games|Experiences|Products' step:90ms on:load",
  'typewriter step:65ms on:load',
]

function prepare(name: string, params: Record<string, string>, html = '<em>a👩‍👩‍👧‍👦b</em>') {
  const host = document.createElement('div')
  host.innerHTML = html
  const resolved = registry.resolve(name)!
  const warn = vi.fn()
  const instance = resolved.primitive.prepare!(host, createParams({ ...resolved.preset.params, ...params }), {
    win: window, doc: document, style: createStyleLedger(host), warn,
  } as unknown as PrepareContext)
  instance.activate()
  return { host, instance, warn, visual: () => host.querySelector('.kui-split-decorative')! }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => { vi.useRealTimers(); document.body.replaceChildren() })

describe('Motion batch 7', () => {
  it('holds each completed list word, and finishes mid-word typing or deletion on the complete current word', () => {
    const held = prepare('typewriter', { words: 'abc|de', step: '10ms', interval: '50ms' })
    vi.advanceTimersByTime(30)
    expect(held.visual().textContent).toBe('abc')
    vi.advanceTimersByTime(50)
    expect(held.visual().textContent).toBe('abc')
    vi.advanceTimersByTime(10)
    expect(held.visual().textContent).toBe('ab')
    held.instance.finish()
    expect(held.visual().textContent).toBe('abc')
    held.instance.destroy()
    const typing = prepare('typewriter', { words: 'abc|de', step: '10ms' })
    vi.advanceTimersByTime(10)
    expect(typing.visual().textContent).toBe('a')
    typing.instance.finish()
    expect(typing.visual().textContent).toBe('abc')
    vi.advanceTimersByTime(100)
    expect(typing.visual().textContent).toBe('abc')
    typing.instance.destroy()
    const zero = prepare('typewriter', { words: 'x|y', step: '0ms', interval: '2ms' })
    vi.advanceTimersByTime(8)
    expect(zero.visual().textContent).toBe('')
    zero.instance.destroy()
  })

  it('reduces rolling-letter duration and removes letter staggering while preserving the authored trigger delay', () => {
    const css = readFileSync('src/css/interaction.css', 'utf8')
    const reduce = atRuleBlocks(css, '@media (prefers-reduced-motion: reduce)').join('\n')
    const rules = ruleBodies(reduce, '.kui-label-letter').join('\n')
    expect(rules).toContain('transition-duration: 1ms;')
    expect(rules).toContain('transition-delay: var(--kui-label-swap-lag, 0ms);')
    const letter = ruleBodies(css, '.kui-label-letter').join('\n')
    expect(letter).toContain('var(--kui-i, 0) * var(--kui-label-stagger, 0ms)')
    expect(css).toMatch(/\[data-kui-swap-split\]\[data-kui-swap='to'\]\s*{\s*--kui-label-copy: -1;/)
  })

  it('warns when interactive children prevent letter splitting and leaves those children intact', () => {
    const { host, instance, warn } = prepare('masked-label-swap', { stagger: '25ms' }, '<a href="#">Keep link</a>')
    expect(warn).toHaveBeenCalledWith('label-swap would remove the link or control inside this element — apply it to a leaf element instead')
    expect(host.querySelector('a')?.textContent).toBe('Keep link')
    expect(host.querySelector('.kui-label-letter')).toBeNull()
    instance.destroy()
  })
  it('compiles every reported example and installs them without reporter warnings', () => {
    for (const example of examples) expect(compile(parse(example), registry, 'time').warnings).toEqual([])
    for (const name of ['typewriter', 'word-cycler', 'split-words', 'masked-label-swap']) {
      const vars = compile(parse(name), registry, 'time').vars
      for (const key of ['--kui-split-hold', '--kui-words', '--kui-word-swap', '--kui-resolve-order', '--kui-label-stagger']) {
        expect(vars).not.toHaveProperty(key)
      }
    }
    const reporter = collectingReporter()
    const animator = build(examples.map((example) => `<div data-kui="${example}">Text</div>`).join(''), reporter)
    animator.start()
    expect(reporter.messages).toEqual([])
    animator.destroy()
  })

  it('types whole graphemes, deletes to empty and advances the list; interruption restores the authored nodes', () => {
    const { host, instance, visual } = prepare('typewriter', { words: 'a👩‍👩‍👧‍👦|é', step: '10ms', interval: '0ms' })
    const sr = host.querySelector('.kui-sr-only')
    vi.advanceTimersByTime(20)
    expect(visual().textContent).toBe('a👩‍👩‍👧‍👦')
    vi.advanceTimersByTime(20)
    expect(visual().textContent).toBe('')
    vi.advanceTimersByTime(10)
    expect(visual().textContent).toBe('é')
    expect(sr?.textContent).toBe('a👩‍👩‍👧‍👦b')
    instance.finish()
    vi.advanceTimersByTime(100)
    expect(visual().textContent).toBe('é')
    instance.destroy()
    expect(host.innerHTML).toBe('<em>a👩‍👩‍👧‍👦b</em>')
  })

  it.each(['start', 'end', 'center', 'edges'])('scrambles both ways in %s order and finishes on a complete word', (order) => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const { host, instance, visual } = prepare('word-cycler', {
      words: 'abcde|👩‍👩‍👧‍👦é', swap: 'scramble', from: order, step: '10ms', interval: '30ms',
    })
    expect(visual().textContent).toBe('!!!!!')
    const incoming: Record<string, string> = { start: 'a!!!!', end: '!!!!e', center: '!!c!!', edges: 'a!!!e' }
    vi.advanceTimersByTime(10)
    expect(visual().textContent).toBe(incoming[order])
    vi.advanceTimersByTime(order === 'center' || order === 'edges' ? 60 : 80)
    const outgoing: Record<string, string> = { start: '!bcde', end: 'abcd!', center: 'ab!de', edges: '!bcd!' }
    expect(visual().textContent).toBe(outgoing[order])
    if (order === 'center') {
      vi.advanceTimersByTime(10)
      expect(visual().textContent).toBe('a!!!e')
      vi.advanceTimersByTime(10)
      expect(visual().textContent).toBe('!!!!!')
      vi.advanceTimersByTime(10)
      expect(visual().textContent).toBe('!!')
      vi.advanceTimersByTime(10)
      expect(visual().textContent).toBe('👩‍👩‍👧‍👦é')
      vi.advanceTimersByTime(20)
      expect(visual().textContent).toBe('👩‍👩‍👧‍👦é')
    }
    expect(host.querySelector('.kui-sr-only')?.textContent).toBe('a👩‍👩‍👧‍👦b')
    instance.finish()
    expect(['abcde', '👩‍👩‍👧‍👦é']).toContain(visual().textContent)
    instance.destroy()
    vi.advanceTimersByTime(100)
    expect(host.innerHTML).toBe('<em>a👩‍👩‍👧‍👦b</em>')
    vi.restoreAllMocks()
  })

  it.each(['chars', 'words', 'lines'])('holds %s beyond the reveal timer and through finish, then restores node identity on teardown and replay', (unit) => {
    const { host, instance } = prepare('split-words', { hold: 'true', unit })
    expect(host.querySelector('.kui-split-held')).not.toBeNull()
    expect(host.querySelector('.kui-sr-only')?.textContent).toBe('a👩‍👩‍👧‍👦b')
    expect(host.querySelector('.kui-split-decorative')?.getAttribute('aria-hidden')).toBe('true')
    instance.finish()
    vi.advanceTimersByTime(100000)
    expect(host.querySelector('.kui-split-held')).not.toBeNull()
    instance.destroy()
    const original = host.firstChild
    instance.activate()
    instance.destroy()
    expect(host.firstChild).toBe(original)
    expect(host.innerHTML).toBe('<em>a👩‍👩‍👧‍👦b</em>')
    const css = readFileSync('src/css/text.css', 'utf8')
    expect(css).toContain('opacity: clamp(0.2, calc(var(--kui-progress, 0) * var(--kui-split-count, 1) - var(--kui-i, 0)), 1)')
    expect(css).toMatch(/\.kui-split-held \.kui-split-item\s*{\s*animation: none;/)
  })

  it('resolves a five-letter word from its centre outward after clearing the previous word', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const { instance, visual } = prepare('word-cycler', {
      words: 'abcde|vwxyz', swap: 'scramble', from: 'center', step: '10ms',
    })
    expect(visual().textContent).toBe('!!!!!')
    vi.advanceTimersByTime(10)
    expect(visual().textContent).toBe('!!c!!')
    vi.advanceTimersByTime(10)
    expect(visual().textContent).toBe('!bcd!')
    vi.advanceTimersByTime(10)
    expect(visual().textContent).toBe('abcde')
    vi.advanceTimersByTime(2240)
    expect(visual().textContent).toBe('!!!!!')
    vi.advanceTimersByTime(10)
    expect(visual().textContent).toBe('!!x!!')
    vi.advanceTimersByTime(10)
    expect(visual().textContent).toBe('!wxy!')
    instance.destroy()
    vi.restoreAllMocks()
  })

  it('splits both label copies into graphemes, keeps the reading label, restores markup and leaves plain swaps unsplit', () => {
    const html = '<span data-kui-swap="from"><em>a👩‍👩‍👧‍👦</em></span><span data-kui-swap="to">Go</span>'
    const { host, instance } = prepare('masked-label-swap', { stagger: '25ms' }, html)
    expect([...host.querySelectorAll('.kui-label-letter')].map((item) => item.textContent)).toEqual(['a', '👩‍👩‍👧‍👦', 'G', 'o'])
    expect(host.querySelector('[data-kui-swap="to"]')?.getAttribute('aria-hidden')).toBe('true')
    expect(host.querySelector('[data-kui-swap="from"] .kui-sr-only')?.textContent).toBe('a👩‍👩‍👧‍👦')
    instance.destroy()
    expect(host.innerHTML).toBe(html)
    const plain = prepare('masked-label-swap', {}, html)
    expect(plain.host.querySelector('.kui-label-letter')).toBeNull()
    plain.instance.destroy()
    const interactive = prepare('masked-label-swap', { stagger: '25ms' }, '<a href="#">Keep link</a>')
    expect(interactive.host.querySelector('a')).not.toBeNull()
    expect(interactive.host.querySelector('.kui-label-letter')).toBeNull()
    interactive.instance.destroy()
  })
})
