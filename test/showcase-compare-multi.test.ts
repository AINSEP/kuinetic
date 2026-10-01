// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createStyleLedger } from '../src/core/owned-styles.js'
import { readEffectParams } from '../src/core/js-params.js'
import type { PrepareContext } from '../src/core/effect-context.js'
import type { EffectInstance } from '../src/core/types.js'
import { COMPARE_DIVIDERS_ATTR, COMPARE_PRIMITIVE } from '../src/showcase/compare.js'
import { ruleBodies } from './support/css-scan.js'

/**
 * `compare` with three or more media: one frame, N−1 dividers.
 *
 * Driven through `prepare` with a stand-in `win` (fake frames, no observer unless a test wants one)
 * so the autoplay clock is exact. jsdom lays nothing out, so the frame's box is stubbed where a
 * pointer test needs one; what is asserted is each divider's `--kui-compare` and its range.
 * Real drags in a real browser are `test/browser/compare-multi.test.mjs`.
 */

const FOUR =
  '<figure><img src="k.jpg" alt="Black"><img src="w.jpg" alt="White">' +
  '<img src="b.jpg" alt="Blue"><img src="p.jpg" alt="Pink"></figure>'
const THREE = '<figure><img src="k.jpg" alt="Black"><img src="w.jpg" alt="White"><img src="b.jpg" alt="Blue"></figure>'

interface MountOptions {
  warn?: (m: string) => void
}

function mount(
  html: string,
  params: Record<string, string> = {},
  options: MountOptions = {},
): { host: HTMLElement; instance: EffectInstance; win: Window } {
  document.body.innerHTML = html
  const host = document.body.firstElementChild as HTMLElement
  const win = {
    requestAnimationFrame: vi.fn((cb: FrameRequestCallback) => requestAnimationFrame(cb)),
    cancelAnimationFrame: vi.fn((handle: number) => cancelAnimationFrame(handle)),
  } as unknown as Window
  const ctx = {
    win,
    doc: window.document,
    reducedMotion: false,
    warn: options.warn ?? (() => {}),
    style: createStyleLedger(host),
  } as unknown as PrepareContext
  const instance = COMPARE_PRIMITIVE.prepare!(host, readEffectParams(params, COMPARE_PRIMITIVE.parameters, () => {}), ctx)
  instance.activate()
  return { host, instance, win }
}

const rangesOf = (host: HTMLElement): HTMLInputElement[] =>
  Array.from(host.querySelectorAll<HTMLInputElement>('.kui-compare-range'))
const handlesOf = (host: HTMLElement): HTMLElement[] =>
  Array.from(host.querySelectorAll<HTMLElement>('.kui-compare-handle'))
const mediaOf = (host: HTMLElement): HTMLElement[] => Array.from(host.querySelectorAll<HTMLElement>(':scope > img'))
const surfaceOf = (host: HTMLElement): HTMLElement => host.querySelector('.kui-compare-surface') as HTMLElement
/** Where divider `k` is drawn, in percent. */
const at = (host: HTMLElement, k: number): number =>
  parseFloat(handlesOf(host)[k]!.style.getPropertyValue('--kui-compare'))

function box(host: HTMLElement, rect: Partial<DOMRect>): void {
  host.getBoundingClientRect = () => ({ left: 0, top: 0, width: 0, height: 0, ...rect }) as DOMRect
}

function pointer(target: Element, type: string, init: { x?: number; y?: number; button?: number; id?: number }): Event {
  const event = new MouseEvent(type, {
    clientX: init.x ?? 0,
    clientY: init.y ?? 0,
    button: init.button ?? 0,
    bubbles: true,
    cancelable: true,
  })
  Object.defineProperty(event, 'pointerId', { value: init.id ?? 1 })
  target.dispatchEvent(event)
  return event
}

function run(ms: number): void {
  for (let left = ms; left > 0; left -= 16) vi.advanceTimersByTime(Math.min(16, left))
}

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'Date'],
  })
})

afterEach(() => {
  vi.useRealTimers()
  document.body.innerHTML = ''
})

describe('compare with three or more media: structure', () => {
  it('builds one range and one handle per divider, range before its handle, and one pointer surface', () => {
    const { host } = mount(FOUR)
    expect(host.getAttribute(COMPARE_DIVIDERS_ATTR)).toBe('3')
    const added = Array.from(host.children).slice(4).map((node) => node.className)
    expect(added).toEqual([
      'kui-compare-range', 'kui-compare-handle',
      'kui-compare-range', 'kui-compare-handle',
      'kui-compare-range', 'kui-compare-handle',
      'kui-compare-surface',
    ])
    expect(surfaceOf(host).getAttribute('aria-hidden')).toBe('true')
    // No host-level variable: each divider carries its own.
    expect(host.style.getPropertyValue('--kui-compare')).toBe('')
  })

  it('splits evenly by default: 25/50/75 for four, 33/67 for three', () => {
    const four = mount(FOUR).host
    expect(rangesOf(four).map((range) => range.value)).toEqual(['25', '50', '75'])
    expect([0, 1, 2].map((k) => at(four, k))).toEqual([25, 50, 75])
    const three = mount(THREE).host
    expect(rangesOf(three).map((range) => range.value)).toEqual(['33', '67'])
  })

  it('clips every medium after the first at its own divider, inline, and leaves the first alone', () => {
    const { host } = mount(FOUR)
    const media = mediaOf(host)
    expect(media[0]!.hasAttribute('style')).toBe(false)
    expect(media.slice(1).map((item) => item.style.getPropertyValue('--kui-compare'))).toEqual(['25%', '50%', '75%'])
    for (const item of media.slice(1)) expect(item.style.getPropertyValue('clip-path')).toBe('inset(0 0 0 var(--kui-compare))')

    const y = mount(THREE, { axis: 'y' }).host
    expect(mediaOf(y)[1]!.style.getPropertyValue('clip-path')).toBe('inset(var(--kui-compare) 0 0 0)')
  })

  it('names each divider by its place and its two neighbours', () => {
    const { host } = mount(FOUR)
    const ranges = rangesOf(host)
    expect(ranges.map((range) => range.getAttribute('aria-label'))).toEqual([
      'Divider 1 of 3: Black / White',
      'Divider 2 of 3: White / Blue',
      'Divider 3 of 3: Blue / Pink',
    ])
    expect(ranges[1]!.getAttribute('aria-valuetext')).toBe('50%')
    expect(ranges[1]!.type).toBe('range')
    expect(ranges[1]!.hasAttribute('aria-orientation')).toBe(false)

    const named = mount(FOUR.replace('<figure>', '<figure aria-label="Palette">')).host
    expect(rangesOf(named)[2]!.getAttribute('aria-label')).toBe('Palette: divider 3 of 3')

    const unnamed = mount('<figure><img src="a.jpg"><img src="b.jpg"><img src="c.jpg"></figure>').host
    expect(rangesOf(unnamed)[1]!.getAttribute('aria-label')).toBe('Divider 2 of 2: Image 2 / Image 3')
  })

  it('bounds each range by its neighbours, and moves the bounds when a neighbour moves', () => {
    const { host } = mount(FOUR)
    const ranges = rangesOf(host)
    expect(ranges.map((range) => [range.min, range.max])).toEqual([['0', '50'], ['25', '75'], ['50', '100']])

    ranges[1]!.value = '60'
    ranges[1]!.dispatchEvent(new Event('input'))
    expect(at(host, 1)).toBe(60)
    expect(ranges[1]!.getAttribute('aria-valuetext')).toBe('60%')
    expect(mediaOf(host)[2]!.style.getPropertyValue('--kui-compare')).toBe('60%')
    expect(ranges[0]!.max).toBe('60')
    expect(ranges[2]!.min).toBe('60')
    // Nothing else moved.
    expect(at(host, 0)).toBe(25)
    expect(at(host, 2)).toBe(75)
  })

  it('cannot push a divider past its neighbour from the keyboard', () => {
    const { host } = mount(FOUR)
    const ranges = rangesOf(host)
    // A range sanitises its own value to [min, max] — that is the clamp.
    ranges[1]!.value = '99'
    ranges[1]!.dispatchEvent(new Event('input'))
    expect(at(host, 1)).toBe(75)
    ranges[1]!.value = '0'
    ranges[1]!.dispatchEvent(new Event('input'))
    expect(at(host, 1)).toBe(25)
  })

  it('pins the vertical arrow keys on the y axis for every divider', () => {
    const { host } = mount(THREE, { axis: 'y' })
    const ranges = rangesOf(host)
    expect(ranges.every((range) => range.getAttribute('aria-orientation') === 'vertical')).toBe(true)
    const up = new KeyboardEvent('keydown', { key: 'ArrowUp', cancelable: true })
    ranges[1]!.dispatchEvent(up)
    expect(up.defaultPrevented).toBe(true)
    expect(at(host, 1)).toBe(66)
    expect(ranges[0]!.max).toBe('66')
  })

  it('takes an authored positions: list', () => {
    const { host } = mount(FOUR, { positions: '10% 20.4% 90%' })
    expect(rangesOf(host).map((range) => range.value)).toEqual(['10', '20', '90'])
  })

  it.each([
    ['the wrong count', '10% 20%'],
    ['a value that is not a percentage', '10% 20 90%'],
    ['a descending list', '10% 80% 50%'],
    ['a value past 100%', '10% 50% 120%'],
  ])('warns and splits evenly for %s', (_name, positions) => {
    const warn = vi.fn()
    const { host } = mount(FOUR, { positions }, { warn })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("positions:'25% 50% 75%'"))
    expect(rangesOf(host).map((range) => range.value)).toEqual(['25', '50', '75'])
  })

  it('warns that position: belongs to two media', () => {
    const warn = vi.fn()
    mount(FOUR, { position: '30%' }, { warn })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('use positions:'))
    const quiet = vi.fn()
    mount(FOUR, {}, { warn: quiet })
    expect(quiet).not.toHaveBeenCalled()
  })

  it('teardown restores the authored markup byte for byte', () => {
    const html =
      '<figure class="f" aria-label="Palette"><img src="k.jpg" alt="Black">' +
      '<img src="w.jpg" alt="White" style="opacity: 0.9;"><img src="b.jpg" alt="Blue"><figcaption>c</figcaption></figure>'
    const { host, instance } = mount(html, { autoplay: 'always', loop: 'true' })
    pointer(surfaceOf(host), 'pointerdown', { x: 10 })
    instance.destroy()
    expect(document.body.innerHTML).toBe(html)
    // jsdom's own `focus()` queues a zero-delay timer; flush it, then nothing of ours may be left.
    run(16)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('showcase.css: ranges hand the pointer to the surface; the surface claims only the drag axis', () => {
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/showcase/showcase.css'), 'utf8')
    const ranges = ruleBodies(css, `[data-kui-fx~='compare'][data-kui-compare-dividers] > .kui-compare-range`)
    expect(ranges[0]).toContain('pointer-events: none;')
    const surface = ruleBodies(css, "[data-kui-fx~='compare'] > .kui-compare-surface")
    expect(surface[0]).toContain('grid-area: 1 / 1;')
    expect(surface[0]).toContain('touch-action: pan-y;')
    const y = ruleBodies(css, "[data-kui-fx~='compare'][data-kui-compare-axis='y'] > .kui-compare-surface")
    expect(y[0]).toContain('touch-action: pan-x;')
  })
})

describe('compare with three or more media: pointer', () => {
  it('grabs the nearest divider, jumps it to the press, drags it, and stops at its neighbours', () => {
    const { host } = mount(FOUR)
    box(host, { left: 100, width: 400 })
    const surface = surfaceOf(host)
    const ranges = rangesOf(host)

    const down = pointer(surface, 'pointerdown', { x: 100 + 240 })
    expect(down.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(ranges[1])
    expect(at(host, 1)).toBe(60)

    pointer(surface, 'pointermove', { x: 100 + 380 })
    expect(at(host, 1)).toBe(75)
    pointer(surface, 'pointermove', { x: 100 + 20 })
    expect(at(host, 1)).toBe(25)
    expect([at(host, 0), at(host, 2)]).toEqual([25, 75])

    pointer(surface, 'pointerup', {})
    pointer(surface, 'pointermove', { x: 100 + 200 })
    expect(at(host, 1)).toBe(25)
  })

  it('keeps the first pointer in charge when a second presses, moves and releases', () => {
    const { host, instance } = mount(THREE)
    box(host, { width: 300 })
    const surface = surfaceOf(host)
    pointer(surface, 'pointerdown', { x: 90, id: 1 })
    pointer(surface, 'pointerdown', { x: 240, id: 2 })
    pointer(surface, 'pointermove', { x: 270, id: 2 })
    expect([at(host, 0), at(host, 1)]).toEqual([30, 67])
    pointer(surface, 'pointerup', { id: 2 })
    pointer(surface, 'pointercancel', { id: 2 })
    pointer(surface, 'pointermove', { x: 120, id: 1 })
    expect([at(host, 0), at(host, 1)]).toEqual([40, 67])
    pointer(surface, 'pointerup', { id: 1 })
    pointer(surface, 'pointermove', { x: 150, id: 1 })
    expect(at(host, 0)).toBe(40)
    instance.destroy()
  })

  it('ends on its own capture loss, ignoring child and unrelated pointer capture loss', () => {
    const { host, instance } = mount(THREE)
    box(host, { width: 300 })
    const surface = surfaceOf(host)
    surface.setPointerCapture = vi.fn()
    const child = surface.appendChild(document.createElement('span'))
    pointer(surface, 'pointerdown', { x: 90 })
    pointer(child, 'lostpointercapture', {})
    pointer(surface, 'lostpointercapture', { id: 2 })
    pointer(surface, 'pointermove', { x: 120 })
    expect(at(host, 0)).toBe(40)
    pointer(surface, 'lostpointercapture', {})
    pointer(surface, 'pointermove', { x: 150 })
    expect(at(host, 0)).toBe(40)
    // Losing capture also frees the surface for a new drag.
    pointer(surface, 'pointerdown', { x: 240, id: 2 })
    expect(at(host, 1)).toBe(80)
    instance.destroy()
  })

  it('lets go on pointercancel too', () => {
    const { host } = mount(FOUR)
    box(host, { width: 400 })
    pointer(surfaceOf(host), 'pointerdown', { x: 380 })
    pointer(surfaceOf(host), 'pointercancel', {})
    pointer(surfaceOf(host), 'pointermove', { x: 220 })
    expect(at(host, 2)).toBe(95)
  })

  it('ignores a secondary button', () => {
    const { host } = mount(FOUR)
    box(host, { width: 400 })
    const down = pointer(surfaceOf(host), 'pointerdown', { x: 380, button: 2 })
    expect(down.defaultPrevented).toBe(false)
    pointer(surfaceOf(host), 'pointermove', { x: 380 })
    expect(at(host, 2)).toBe(75)
  })

  it('pulls apart two dividers that meet by the side the press lands on', () => {
    const { host } = mount(FOUR, { positions: '50% 50% 90%' })
    box(host, { width: 100 })
    pointer(surfaceOf(host), 'pointerdown', { x: 50 })
    pointer(surfaceOf(host), 'pointermove', { x: 70 })
    pointer(surfaceOf(host), 'pointerup', {})
    expect([at(host, 0), at(host, 1)]).toEqual([50, 70])

    const again = mount(FOUR, { positions: '50% 50% 90%' }).host
    box(again, { width: 100 })
    pointer(surfaceOf(again), 'pointerdown', { x: 49 })
    pointer(surfaceOf(again), 'pointermove', { x: 30 })
    expect([at(again, 0), at(again, 1)]).toEqual([30, 50])
  })

  it('measures along y on the y axis', () => {
    const { host } = mount(THREE, { axis: 'y' })
    box(host, { top: 50, height: 200, width: 999 })
    pointer(surfaceOf(host), 'pointerdown', { x: 0, y: 50 + 20 })
    expect(at(host, 0)).toBe(10)
  })

  it('treats a frame with no size as 0%', () => {
    const { host } = mount(THREE)
    box(host, {})
    pointer(surfaceOf(host), 'pointerdown', { x: 300 })
    expect(at(host, 0)).toBe(0)
  })

  it('captures the pointer where the platform can', () => {
    const { host } = mount(THREE)
    box(host, { width: 100 })
    const capture = vi.fn()
    surfaceOf(host).setPointerCapture = capture
    pointer(surfaceOf(host), 'pointerdown', { x: 80 })
    expect(capture).toHaveBeenCalledWith(1)
  })
})

describe('compare with three or more media: autoplay', () => {
  it('sweeps one divider at a time between its neighbours, then parks it home exactly', () => {
    const { host } = mount(THREE, { autoplay: 'always', duration: '1s' })
    // Divider 1 travels [0, 67]; from 33 heading up it reaches 67 at half a sweep.
    run(500)
    expect(at(host, 0)).toBeCloseTo(67, 0)
    expect(at(host, 1)).toBe(67)
    run(1000)
    expect(at(host, 0)).toBeCloseTo(0, 0)
    expect(at(host, 1)).toBe(67)
    // Divider 1 is done after two sweeps; divider 2 ([33, 100]) is under way.
    run(1000)
    expect(at(host, 0)).toBe(33)
    expect(at(host, 1)).toBeGreaterThan(67)
    // Both home and the clock stopped after the whole pass.
    run(2100)
    expect([at(host, 0), at(host, 1)]).toEqual([33, 67])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('reverse: starts from the last divider, heading toward 0%', () => {
    const { host } = mount(THREE, { autoplay: 'always', duration: '1s', reverse: 'true' })
    run(200)
    expect(at(host, 0)).toBe(33)
    expect(at(host, 1)).toBeLessThan(67)
  })

  it('loop: comes back round to the first divider', () => {
    const { host } = mount(THREE, { autoplay: 'always', duration: '1s', loop: 'true' })
    run(4000 + 500)
    expect(at(host, 0)).toBeCloseTo(67, 0)
    expect(at(host, 1)).toBe(67)
  })

  it('holds a divider whose neighbours meet it still for its turn', () => {
    const { host } = mount(FOUR, { autoplay: 'always', duration: '1s', positions: '40% 40% 40%' })
    run(2000 + 500)
    expect(at(host, 1)).toBe(40)
  })

  it.each([
    ['a press on the surface', (host: HTMLElement) => pointer(surfaceOf(host), 'pointerdown', { x: 0 })],
    ['focus on any divider', (host: HTMLElement) => rangesOf(host)[1]!.dispatchEvent(new Event('focus'))],
  ])('stops for good on %s', (_name, grab) => {
    const { host } = mount(THREE, { autoplay: 'always', duration: '1s', loop: 'true' })
    box(host, { width: 100 })
    run(300)
    grab(host)
    const held = [at(host, 0), at(host, 1)]
    run(3000)
    expect([at(host, 0), at(host, 1)]).toEqual(held)
    expect(vi.getTimerCount()).toBe(0)
  })
})
