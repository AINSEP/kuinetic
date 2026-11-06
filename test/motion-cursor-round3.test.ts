// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { compile } from '../src/core/compile.js'
import { createParams } from '../src/core/js-params.js'
import { createStyleLedger } from '../src/core/owned-styles.js'
import { parse } from '../src/core/parse.js'
import { collectingReporter } from '../src/core/reporter.js'
import type { PrepareContext } from '../src/core/effect-context.js'
import { catalogRegistry } from './support/registry.js'
import { build } from './support/js-effect-harness.js'

const registry = catalogRegistry()
const examples = [
  'cursor-follow over:.copy match:text',
  'cursor-follow over:.box match:rect snap:center dot-class:cursor-corners',
  'cursor-follow over:.link match:rect snap:center',
  'magnetic strength:4',
  'cursor-follow over:.badge snap:center dot-class:cursor-ring',
  'cursor-follow over:.city dot-class:kui-cursor-media',
  'masked-label-swap stagger:25ms',
  "cursor-lag stiffness:300 damping:30 dot-class:'cursor-ring trail-small'",
  "cursor-lag stiffness:120 damping:22 dot-class:'cursor-ring trail-medium'",
  "cursor-lag stiffness:50 damping:14 dot-class:'cursor-ring trail-large'",
  'cursor-follow over:.photo dot-class:kui-cursor-ticker',
]

function move(el: Element, x = 240, y = 90): void {
  el.dispatchEvent(Object.assign(new Event('pointermove', { bubbles: true }), { clientX: x, clientY: y }))
}

function rect(el: Element, width = 100, height = 40) {
  return vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({ left: 20, top: 30, width, height } as DOMRect)
}

function prepare(host: HTMLElement, params: Record<string, string>, name = 'cursor-follow', fine = true) {
  const resolved = registry.resolve(name)!
  const warn = vi.fn()
  const instance = resolved.primitive.prepare!(host, createParams({ ...resolved.preset.params, ...params }), {
    doc: document, win: fine ? window : { matchMedia: () => ({ matches: false }) },
    style: createStyleLedger(host), warn,
  } as unknown as PrepareContext)
  instance.activate()
  return { instance, warn, dot: document.body.lastElementChild as HTMLElement }
}

function frames() {
  let time = 0
  let next = 0
  const pending = new Map<number, FrameRequestCallback>()
  vi.spyOn(performance, 'now').mockImplementation(() => time)
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { pending.set(++next, callback); return next })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => pending.delete(id))
  return (count: number) => {
    for (let i = 0; i < count; i++) {
      time += 16
      const ready = [...pending.values()]
      pending.clear()
      ready.forEach((callback) => callback(time))
    }
  }
}

beforeEach(() => { document.body.innerHTML = '<div id="host"><button class="box">One</button><button class="other">Two</button></div>' })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren() })
const host = () => document.getElementById('host')!

describe('Motion batch 8', () => {
  it('ignores mouse focus on a target but centres keyboard focus', () => {
    const tick = frames()
    const node = host()
    const target = node.querySelector('.box')!
    rect(target)
    const { dot, instance } = prepare(node, { over: 'button' })
    move(target)
    tick(200)
    expect(dot.style.translate).toBe('240.0px 90.0px')
    const matches = vi.spyOn(target, 'matches').mockReturnValue(false)
    target.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
    expect(matches).toHaveBeenCalledWith(':focus-visible')
    expect(dot.style.translate).toBe('240.0px 90.0px')
    matches.mockReturnValue(true)
    target.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
    expect(dot.style.translate).toBe('70.0px 50.0px')
    instance.destroy()
  })

  it('lets only the inner of two followers own shared content, including a ticker, and restores it after both tear down', () => {
    frames()
    const outer = host()
    outer.innerHTML = '<div class="inner"><button class="box">City<span hidden data-kui-cursor-content>TOKYO ✦ TOKYO ✦ </span></button></div>'
    const inner = outer.firstElementChild as HTMLElement
    const target = inner.firstElementChild!
    const content = target.firstElementChild!
    const first = prepare(inner, { over: '.box', 'dot-class': 'kui-cursor-ticker' })
    const second = prepare(outer, { over: '.box', 'dot-class': 'kui-cursor-media' })
    move(target)
    expect(first.dot.firstElementChild).toBe(content)
    expect(first.dot.hasAttribute('data-kui-cursor-target')).toBe(true)
    expect(content.hasAttribute('hidden')).toBe(false)
    expect(second.dot.childNodes).toHaveLength(0)
    second.instance.destroy()
    expect(first.dot.firstElementChild).toBe(content)
    first.instance.destroy()
    expect(target.firstElementChild).toBe(content)
    expect(content.hasAttribute('hidden')).toBe(true)
    expect([...target.childNodes].filter((node) => node.nodeType === Node.COMMENT_NODE)).toHaveLength(0)
    const css = readFileSync('src/css/interaction.css', 'utf8')
    expect(css).toMatch(/\.kui-cursor-dot\.kui-cursor-ticker:not\(\[data-kui-cursor-target\]\)\s*{\s*opacity: 0;/)
  })
  it('compiles and installs every report/demo attribute with zero warnings', () => {
    for (const example of examples) expect(compile(parse(example), registry, 'time').warnings).toEqual([])
    expect(compile(parse('cursor-follow targets:.box'), registry, 'time').warnings.join()).toContain('targets')
    for (const name of ['cursor-follow', 'cursor-lag', 'cursor-label', 'cursor-invert']) {
      const vars = compile(parse(name), registry, 'time').vars
      for (const key of ['--kui-cursor-over', '--kui-cursor-match', '--kui-cursor-snap', '--kui-cursor-class']) {
        expect(vars).not.toHaveProperty(key)
      }
    }
    const reporter = collectingReporter()
    const animator = build(examples.map((example) => `<div data-kui="${example}">Text</div>`).join(''), reporter)
    animator.start()
    expect(reporter.messages).toEqual([])
    animator.destroy()
  })

  it('tracks the hovered rect and centre, resets on non-target/leave, and restores content and focus after switching', () => {
    const tick = frames()
    const node = host()
    const target = node.querySelector('.box')!
    const second = node.querySelector('.other')!
    rect(target)
    rect(second, 60, 20)
    const { dot, instance } = prepare(node, { over: 'button', match: 'rect', snap: 'center', 'dot-class': 'cursor-corners' })
    move(target)
    tick(200)
    expect(dot.style.translate).toBe('70.0px 50.0px')
    expect(dot.style.width).toBe('100px')
    expect(dot.style.height).toBe('40px')
    expect(dot.hasAttribute('data-kui-cursor-target')).toBe(true)
    move(second)
    expect(dot.style.width).toBe('60px')
    move(node)
    expect(dot.style.width).toBe('')
    expect(dot.hasAttribute('data-kui-cursor-target')).toBe(false)
    vi.spyOn(target, 'matches').mockReturnValue(true)
    target.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
    expect(dot.style.translate).toBe('70.0px 50.0px')
    target.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: second }))
    expect(dot.classList.contains('kui-cursor-dot-active')).toBe(true)
    second.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    expect(dot.classList.contains('kui-cursor-dot-active')).toBe(false)
    move(target)
    node.dispatchEvent(new Event('pointerleave'))
    expect(dot.style.width).toBe('')
    instance.destroy()
    target.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
    expect(document.querySelector('.kui-cursor-dot')).toBeNull()
    const centered = prepare(node, { over: 'button', snap: 'center' })
    move(target)
    tick(200)
    expect(centered.dot.style.translate).toBe('70.0px 50.0px')
    expect(centered.dot.style.width).toBe('')
    centered.instance.destroy()
    const pointer = prepare(node, { over: 'button', match: 'rect' })
    move(target)
    tick(200)
    expect(pointer.dot.style.translate).toBe('240.0px 90.0px')
    expect(pointer.dot.style.width).toBe('100px')
    pointer.instance.destroy()
  })

  it('matches tiny and large text height, keeps label strings literal, and leaves all plain-host listeners and reads unchanged', () => {
    frames()
    const node = host()
    const target = node.querySelector('.box') as HTMLElement
    const other = node.querySelector('.other') as HTMLElement
    target.style.fontSize = '9px'
    other.style.fontSize = '32px'
    target.setAttribute('data-kui-cursor-label', '<img src=x onerror=alert(1)>')
    const targetRect = rect(target)
    const computed = vi.spyOn(window, 'getComputedStyle')
    const rich = prepare(node, { over: 'button', match: 'text' })
    move(target)
    move(target)
    expect(rich.dot.style.height).toBe('9px')
    expect(computed).toHaveBeenCalledOnce()
    expect(targetRect).not.toHaveBeenCalled()
    expect(rich.dot.textContent).toBe('<img src=x onerror=alert(1)>')
    expect(rich.dot.querySelector('img')).toBeNull()
    move(other)
    expect(rich.dot.style.height).toBe('32px')
    rich.instance.destroy()
    computed.mockClear()
    const listeners = vi.spyOn(node, 'addEventListener')
    const ownRect = rect(node)
    const plain = prepare(node, {})
    expect(listeners.mock.calls.map(([name]) => name)).toEqual(['pointermove', 'pointerleave', 'focus', 'blur'])
    move(target)
    expect(ownRect).not.toHaveBeenCalled()
    expect(computed).not.toHaveBeenCalled()
    expect(plain.dot.className).toBe('kui-cursor-dot kui-cursor-dot-follow kui-cursor-dot-active')
    expect(plain.dot.hasAttribute('data-kui-cursor-target')).toBe(false)
    node.dispatchEvent(new Event('focus'))
    expect(ownRect).toHaveBeenCalledOnce()
    expect(plain.dot.style.translate).toBe('70.0px 50.0px')
    plain.instance.destroy()
  })

  it.each(['kui-cursor-media', 'kui-cursor-ticker'])('moves live rich content for %s without parsing HTML, preserves handlers and restores it after target detachment', (dotClass) => {
    frames()
    const node = host()
    const target = node.querySelector('.box')!
    target.innerHTML = '<span hidden data-kui-cursor-content><img src="city.jpg" alt=""></span>'
    const content = target.firstElementChild!
    const image = content.firstElementChild!
    const load = vi.fn()
    image.addEventListener('load', load)
    const { dot, instance } = prepare(node, { over: 'button', 'dot-class': dotClass, label: 'View' })
    move(target)
    expect(dot.firstElementChild).toBe(content)
    expect(content.hasAttribute('hidden')).toBe(false)
    image.dispatchEvent(new Event('load'))
    expect(load).toHaveBeenCalledOnce()
    move(node.querySelector('.other')!)
    expect(target.firstElementChild).toBe(content)
    expect(content.hasAttribute('hidden')).toBe(true)
    expect(content.firstElementChild).toBe(image)
    expect(dot.textContent).toBe('View')
    move(target)
    target.remove()
    instance.destroy()
    expect(target.firstElementChild).toBe(content)
    expect(content.hasAttribute('hidden')).toBe(true)
    expect(content.firstElementChild).toBe(image)
    expect(dot.isConnected).toBe(false)
  })

  it('rejects bad target selectors once, does not reach outside its host, and skips all target work on touch', () => {
    frames()
    const node = host()
    const invalid = prepare(node, { over: '[' })
    expect(invalid.warn).toHaveBeenCalledOnce()
    expect(invalid.warn).toHaveBeenCalledWith('cursor follower over "[" is not a valid selector and will be ignored')
    move(node)
    invalid.instance.destroy()
    const broad = prepare(node, { over: '*' })
    expect(broad.warn).toHaveBeenCalledOnce()
    broad.instance.destroy()
    document.body.classList.add('outside')
    const outside = prepare(node, { over: '.outside' })
    move(node)
    expect(outside.dot.hasAttribute('data-kui-cursor-target')).toBe(false)
    outside.instance.destroy()
    document.body.classList.remove('outside')
    const reads = vi.spyOn(node, 'querySelector')
    const listeners = vi.spyOn(node, 'addEventListener')
    const touch = prepare(node, { over: 'button', match: 'rect' }, 'cursor-follow', false)
    expect(document.querySelector('.kui-cursor-dot')).toBeNull()
    expect(reads).not.toHaveBeenCalled()
    expect(listeners).not.toHaveBeenCalled()
    touch.instance.destroy()
  })

  it('uses three existing independent springs for multifollow: increasing lag in flight and the same resting point', () => {
    const tick = frames()
    const node = host()
    node.innerHTML = '<div><div>Move here</div></div>'
    const nodes = [node, node.firstElementChild!, node.firstElementChild!.firstElementChild!]
    const instances = nodes.map((item, index) => prepare(item as HTMLElement, {
      stiffness: String([300, 120, 50][index]), damping: String([30, 22, 14][index]),
      'dot-class': `cursor-ring trail-${index}`,
    }, 'cursor-lag'))
    move(nodes[2]!)
    tick(10)
    const positions = instances.map(({ dot }) => Number.parseFloat(dot.style.translate))
    expect(positions[0]).toBeGreaterThan(positions[1]!)
    expect(positions[1]).toBeGreaterThan(positions[2]!)
    tick(300)
    for (const { dot, instance } of instances) {
      expect(dot.style.translate).toBe('240.0px 90.0px')
      expect(dot.classList.contains('cursor-ring')).toBe(true)
      instance.destroy()
    }
    const css = readFileSync('src/css/interaction.css', 'utf8')
    expect(css).toContain('animation: kui-marquee var(--kui-cursor-period, 2s) linear infinite')
    expect(css).toContain('transform: translate(-50%, -50%)')
    expect(css).not.toContain('.kui-cursor-ring')
    expect(css).not.toContain('.kui-cursor-corners')
    expect(css).not.toContain('rotate 160ms')
    expect(css).toContain('white-space: pre;')
    const lab = readFileSync('demo/motion-lab.html', 'utf8')
    expect(lab).toContain('.cursor-ring { background: transparent; border: 1px solid currentColor; }')
    expect(lab).toContain('.cursor-corners[data-kui-cursor-target] { rotate: 0deg; }')
  })
})
