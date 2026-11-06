// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createRowCopies, watchCopySources } from '../src/effects/carousel/row-copies.js'
import type { PrepareContext } from '../src/core/effect-context.js'

const context = (): PrepareContext => ({ doc: document, win: window, warn: vi.fn() }) as unknown as PrepareContext
beforeEach(() => vi.useFakeTimers())
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); document.body.replaceChildren() })

it('copies authored appearance without per-slide state and reads heights before inserting anything', () => {
  const host = document.createElement('div')
  const images = [document.createElement('img'), document.createElement('img')]
  host.append(...images)
  const reads: number[] = []
  for (const image of images) {
    image.style.setProperty('--kui-offset', '2')
    image.style.setProperty('--kui-item-count', '3')
    image.style.setProperty('--poster-tone', 'var(--accent)')
    image.style.borderRadius = '12px'
    Object.defineProperty(image, 'offsetHeight', { get: () => { reads.push(host.childElementCount); return 120 } })
  }
  const source = createRowCopies(host, context())
  const copies = source.measure(images, [100, 100], 240, 1000)
  expect(copies.length).toBeGreaterThan(2)
  expect(reads).toEqual([2, 2])
  for (const copy of copies) {
    expect(copy.style.getPropertyValue('--kui-offset')).toBe('')
    expect(copy.style.getPropertyValue('--kui-item-count')).toBe('')
    expect(copy.style.getPropertyValue('--poster-tone')).toBe('var(--accent)')
    expect(copy.style.borderRadius).toBe('12px')
    expect(copy.style.height).toBe('120px')
  }
  source.clear()
  expect(host.childElementCount).toBe(2)
})

it.each([{ empty: true, cycle: 0, required: 390 }, { empty: false, cycle: 0, required: 390 },
  { empty: false, cycle: 100, required: 100_000 }])('keeps only originals when copies cannot cover: %j', ({ empty, cycle, required }) => {
  const host = document.createElement('div')
  const image = document.createElement('img')
  const images = empty ? [] : [image]
  host.append(...images)
  const source = createRowCopies(host, context())
  expect(source.measure(images, [100], cycle, required)).toEqual([])
  expect(host.childElementCount).toBe(images.length)
})

it('still refreshes original loads without MutationObserver and ignores generated loads', () => {
  vi.stubGlobal('MutationObserver', undefined)
  const host = document.createElement('div')
  const original = document.createElement('img')
  const copy = document.createElement('img')
  copy.setAttribute('data-kui-row-copy', '')
  host.append(original, copy)
  const refresh = vi.fn()
  const release = watchCopySources(host, context(), refresh)
  copy.dispatchEvent(new Event('load'))
  vi.advanceTimersByTime(20)
  expect(refresh).not.toHaveBeenCalled()
  original.dispatchEvent(new Event('load'))
  vi.advanceTimersByTime(20)
  expect(refresh).toHaveBeenCalledTimes(1)
  release()
  original.dispatchEvent(new Event('load'))
  vi.advanceTimersByTime(20)
  expect(refresh).toHaveBeenCalledTimes(1)
  expect(vi.getTimerCount()).toBe(0)
})
