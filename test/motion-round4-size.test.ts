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
import { LAYOUT_PRIMITIVES } from '../src/effects/layout/primitives.js'
import { catalogRegistry } from './support/registry.js'

const autoSize = LAYOUT_PRIMITIVES.find((p) => p.id === 'auto-height')!
const registry = catalogRegistry()
const markup = [
  'accordion-height attribute:data-ratio 600ms',
  'accordion-height axis:width 600ms',
  'accordion-height 600ms',
  'accordion-height axis:width attribute:data-size 400ms',
]

describe('round 4 measured size', () => {
  it('exempts width hosts from collapsed height before activation without changing plain hosts', () => {
    expect(compile(parse(markup[1]!), registry, 'time').vars['--kui-auto-height-closed']).toBe('auto')
    expect(compile(parse('accordion-height'), registry, 'time').vars).toEqual({})
  })
  it('resets the closed height per host so nested height accordions do not inherit width auto', () => {
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/css/layout.css'), 'utf8')
    expect(css).toMatch(/\[data-kui-fx~='accordion-height'\]\s*\{[^}]*--kui-auto-height-closed:\s*0;/)
    expect(css).toMatch(/\[data-kui-fx~='accordion-height'\]:not\(\[data-open\]\)\s*\{\s*height:\s*var\(--kui-auto-height-closed\);/)
  })
  it.each(markup)('compiles exact holding markup without warnings: %s', (source) => {
    expect(compile(parse(source), registry, 'time').warnings).toEqual([])
  })
  it('claims width and nowrap only for the width option, retaining default height composition', () => {
    expect(compile(parse(markup[1]!), registry, 'time').channels).toEqual(['overflow', 'width', 'white-space'])
    expect(compile(parse(markup[2]!), registry, 'time').channels).toEqual(['overflow', 'height'])
    expect(compile(parse('accordion-height, tween x:20'), registry, 'time').warnings).toEqual([])
  })
  it.each(['width', 'height'])('retargets %s from the displayed size before cancelling; content needs the attribute signal', async (axis) => {
    const el = document.createElement('div')
    const child = document.createElement('span')
    child.textContent = 'Copy'
    el.append(child)
    el.style.setProperty(axis, '80px')
    el.style.whiteSpace = 'normal'
    const style = createStyleLedger(el)
    let natural = 80
    let displayed = 80
    let current: { playState: string; cancel: ReturnType<typeof vi.fn> } | undefined
    const rect = vi.fn(() => ({ [axis]: current?.playState === 'running' ? displayed : natural }))
    el.getBoundingClientRect = rect as unknown as typeof el.getBoundingClientRect
    const animate = vi.fn<Element['animate']>(() => {
      current = { playState: 'running', cancel: vi.fn(() => { current!.playState = 'idle' }) }
      return current as unknown as Animation
    })
    el.animate = animate
    const instance = autoSize.prepare!(el, createParams({ axis, attribute: 'data-size', duration: '400ms' }),
      { win: window, style, invalidate: vi.fn(), warn: vi.fn() } as unknown as PrepareContext)
    instance.activate()
    child.textContent = 'Copied successfully'
    natural = 180
    await Promise.resolve()
    expect(animate).not.toHaveBeenCalled()
    el.toggleAttribute('data-size')
    await Promise.resolve()
    expect(animate.mock.calls[0]).toEqual([[{ [axis]: '80px' }, { [axis]: '180px' }], expect.objectContaining({ fill: 'none' })])
    displayed = 115.5
    natural = 40
    const cancel = current!.cancel
    el.toggleAttribute('data-size')
    await Promise.resolve()
    expect(cancel).toHaveBeenCalledOnce()
    expect(animate.mock.calls[1]![0]).toEqual([{ [axis]: '115.5px' }, { [axis]: '40px' }])
    current!.playState = 'finished'
    natural = 120
    el.toggleAttribute('data-size')
    await Promise.resolve()
    expect(animate.mock.calls[2]![0]).toEqual([{ [axis]: '40px' }, { [axis]: '120px' }])
    expect(el.style.whiteSpace).toBe(axis === 'width' ? 'nowrap' : 'normal')
    instance.destroy()
    const calls = animate.mock.calls.length
    el.toggleAttribute('data-size')
    await Promise.resolve()
    expect(animate).toHaveBeenCalledTimes(calls)
    style.restore()
    expect(el.style.getPropertyValue(axis)).toBe('80px')
    expect(el.style.whiteSpace).toBe('normal')
  })
  it('animates supplied height endpoints in both directions without changing width', async () => {
    const el = document.createElement('div')
    el.style.width = '100px'
    el.getBoundingClientRect = (() => ({ width: 100, height: el.hasAttribute('data-ratio') ? 100 / 3 : 100 })) as typeof el.getBoundingClientRect
    const animate = vi.fn<Element['animate']>(() => ({ playState: 'finished', cancel: vi.fn() }) as unknown as Animation)
    el.animate = animate
    const instance = autoSize.prepare!(el, createParams({ attribute: 'data-ratio' }),
      { win: window, style: createStyleLedger(el), invalidate: vi.fn(), warn: vi.fn() } as unknown as PrepareContext)
    instance.activate()
    el.toggleAttribute('data-ratio')
    await Promise.resolve()
    expect(animate.mock.calls[0]![0]).toEqual([{ height: '100px' }, { height: `${100 / 3}px` }])
    el.toggleAttribute('data-ratio')
    await Promise.resolve()
    expect(animate.mock.calls[1]![0]).toEqual([{ height: `${100 / 3}px` }, { height: '100px' }])
    expect(el.style.width).toBe('100px')
    instance.destroy()
  })
})
