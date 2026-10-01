// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Registry } from '../src/core/registry.js'
import { readEffectParams } from '../src/core/js-params.js'
import { resolveParams } from '../src/core/params.js'
import { createStyleLedger } from '../src/core/owned-styles.js'
import type { PrepareContext } from '../src/core/effect-context.js'
import type { EffectInstance } from '../src/core/types.js'
import { stripComments } from './support/css-scan.js'
import { registerInteraction } from '../src/effects/catalog/interaction.js'
import { chooseSide, shiftWithin } from '../src/effects/catalog/interaction-reveal.js'

/**
 * The tooltip knobs on `hover-intent` and `anchored-preview`: `color`, `bg-color`, `radius` and
 * `place:top|bottom|auto`.
 *
 * Three layers, asserted separately because each fails differently: the schema maps each word to
 * its namespaced custom property; the stylesheet actually reads that property with the schema's
 * default as its fallback (a property nothing reads is a parameter that silently does nothing);
 * and `place:` resolves to a side the stylesheet keys its geometry on — `auto` by measuring.
 */

const css = stripComments(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/css/interaction.css'), 'utf8'),
)

const registry = registerInteraction(new Registry())

function schemaOf(name: string) {
  return registry.resolve(name)!.primitive.parameters
}

describe('the styling knobs reach namespaced custom properties', () => {
  it.each([
    ['hover-intent', '--kui-hover-intent'],
    ['anchored-preview', '--kui-anchored-preview'],
  ])('%s maps color / bg-color / radius onto %s-*', (name, prefix) => {
    const warn = vi.fn()
    const out = resolveParams(
      { color: 'red', 'bg-color': '#000', radius: '4px' },
      schemaOf(name),
      warn,
    )
    expect(warn).not.toHaveBeenCalled()
    expect(out).toEqual({
      [`${prefix}-color`]: 'red',
      [`${prefix}-bg-color`]: '#000',
      [`${prefix}-radius`]: '4px',
    })
  })

  it.each(['bg', 'background'])('spells the background bg-color only — %s: is unknown', (key) => {
    const warn = vi.fn()
    expect(resolveParams({ [key]: '#000' }, schemaOf('hover-intent'), warn)).toEqual({})
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(`unknown parameter "${key}"`))
  })

  it('rejects a colour that is not one, and a radius that is not a length', () => {
    const warn = vi.fn()
    expect(resolveParams({ color: 'banana', radius: 'big' }, schemaOf('hover-intent'), warn)).toEqual(
      {},
    )
    expect(warn).toHaveBeenCalledTimes(2)
  })

  it('closes place: to top|bottom|auto on hover-intent, and adds left|right on anchored-preview', () => {
    expect(schemaOf('hover-intent').place).toMatchObject({
      type: 'keyword',
      keywords: ['top', 'bottom', 'auto'],
      default: 'top',
    })
    expect(schemaOf('anchored-preview').place).toMatchObject({
      type: 'keyword',
      keywords: ['top', 'bottom', 'left', 'right', 'auto'],
      default: 'top',
    })
    const warn = vi.fn()
    resolveParams({ place: 'left' }, schemaOf('hover-intent'), warn)
    expect(warn).toHaveBeenCalledOnce()
  })

  it('gives each suffixed anchored-preview its side as params.place', () => {
    expect(registry.resolve('anchored-preview')!.preset.params).toBeUndefined()
    for (const side of ['bottom', 'left', 'right']) {
      expect(registry.resolve(`anchored-preview-${side}`)!.preset.params).toEqual({ place: side })
    }
  })
})

/**
 * A parameter whose custom property no rule reads is accepted, validated, written inline — and does
 * nothing. So every styling knob is checked against the stylesheet, fallback included: the
 * fallback *is* the default, since `resolveParams` never writes an unauthored value.
 */
function ruleBody(selector: string): string {
  const start = css.indexOf(`${selector} {`)
  expect(start, `no rule for ${selector}`).toBeGreaterThan(-1)
  return css.slice(start, css.indexOf('}', start))
}

describe('the stylesheet reads every styling knob, with the schema default as its fallback', () => {
  it.each([
    ['hover-intent', '[data-kui-hint]'],
    ['anchored-preview', '[data-kui-preview]'],
  ])('%s: %s reads color, bg-color and radius', (name, part) => {
    const schema = schemaOf(name)
    const body = ruleBody(part)
    for (const [key, property] of [
      ['color', 'color'],
      ['bg-color', 'background-color'],
      ['radius', 'border-radius'],
    ] as const) {
      const spec = schema[key]!
      expect(body).toContain(`${property}: var(${spec.cssProperty}, ${spec.default});`)
    }
  })

  it("defaults hover-intent to the dark card and anchored-preview to today's look", () => {
    // The two are different on purpose: a hint with no surface is unusable, while a preview is as
    // often an image, which a default fill or rounding would restyle.
    const hint = schemaOf('hover-intent')
    expect([hint.color!.default, hint['bg-color']!.default, hint.radius!.default]).toEqual([
      '#f4f4f0',
      '#111111',
      '12px',
    ])
    const preview = schemaOf('anchored-preview')
    expect([preview.color!.default, preview['bg-color']!.default, preview.radius!.default]).toEqual(
      ['currentcolor', 'transparent', '0px'],
    )
  })

  it('swaps the hint below its trigger from the stamped side, on the host itself', () => {
    const body = ruleBody("[data-kui-fx][data-kui-hint-place='bottom']")
    expect(body).toContain('--kui-hover-intent-top: 100%')
    expect(body).toContain('--kui-hover-intent-bottom: auto')
    expect(body).toContain('--kui-hover-intent-dir: -1')
    const hint = ruleBody('[data-kui-hint]')
    expect(hint).toContain('top: var(--kui-hover-intent-top, auto)')
    expect(hint).toContain('bottom: var(--kui-hover-intent-bottom, 100%)')
    expect(hint).toContain('var(--kui-hover-intent-dir, 1)')
  })
})

describe('chooseSide', () => {
  const room = (top: number, bottom: number, left = 0, right = 0) => ({ top, bottom, left, right })

  it('keeps the preferred side whenever the part fits there', () => {
    expect(chooseSide('top', room(100, 900), 100)).toBe('top')
  })

  it('flips to the opposite side when the preferred one is too tight and the other has more room', () => {
    expect(chooseSide('top', room(40, 900), 100)).toBe('bottom')
    expect(chooseSide('right', room(0, 0, 500, 20), 100)).toBe('left')
  })

  it('stays put when neither side fits and the opposite has no more room', () => {
    expect(chooseSide('top', room(40, 30), 100)).toBe('top')
    expect(chooseSide('top', room(40, 40), 100)).toBe('top')
  })
})

/**
 * `place:` end to end through the primitive's own `prepare`, with layout stubbed: jsdom lays
 * nothing out, so the host's rect, the part's offsets and the viewport height are set by hand.
 */
describe('place: stamps the side the stylesheet keys on', () => {
  let instances: EffectInstance[] = []
  let controller: AbortController

  beforeEach(() => {
    controller = new AbortController()
    frames = []
    // Queued, not run inline: `frameScheduler` stores the returned id *after* the call, so a
    // callback run inside `requestAnimationFrame` leaves its "frame pending" flag set forever and
    // every later request is dropped — a harness bug that would look like a missing re-measure.
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback)
      return frames.length
    })
  })

  let frames: FrameRequestCallback[] = []

  /** Fire a viewport event, then run the frame it scheduled, if any. */
  function viewportEvent(type: 'scroll' | 'resize'): void {
    window.dispatchEvent(new Event(type))
    for (const callback of frames.splice(0)) callback(0)
  }

  afterEach(() => {
    for (const instance of instances) instance.destroy()
    instances = []
    controller.abort()
    vi.restoreAllMocks()
    document.body.replaceChildren()
  })

  function ctx(el: Element): PrepareContext {
    return {
      win: window,
      doc: document,
      reducedMotion: false,
      warn: () => {},
      signal: controller.signal,
      style: createStyleLedger(el),
    } as unknown as PrepareContext
  }

  /** A host + part pair with stubbed geometry, prepared and activated under `name`. */
  function mount(name: string, authored: Record<string, string>, part = 'data-kui-hint') {
    const host = document.createElement('button')
    host.setAttribute('data-kui-fx', name)
    const child = document.createElement('span')
    child.setAttribute(part, '')
    host.append(child)
    document.body.append(host)

    const geometry = { rect: { top: 0, bottom: 0, left: 0, right: 0 }, height: 40, width: 80 }
    const offsets = { top: 0, left: 0, height: 0, width: 0 }
    host.getBoundingClientRect = () => geometry.rect as DOMRect
    Object.defineProperty(host, 'clientHeight', { get: () => geometry.height })
    Object.defineProperty(host, 'clientWidth', { get: () => geometry.width })
    Object.defineProperty(child, 'offsetTop', { get: () => offsets.top })
    Object.defineProperty(child, 'offsetLeft', { get: () => offsets.left })
    Object.defineProperty(child, 'offsetHeight', { get: () => offsets.height })
    Object.defineProperty(child, 'offsetWidth', { get: () => offsets.width })

    // Viewport geometry includes the current CSS shift, just as a browser's rect does.
    child.getBoundingClientRect = () => {
      const prefix = part === 'data-kui-preview' ? '--kui-anchored-preview' : '--kui-hover-intent'
      const shift = parseFloat(host.style.getPropertyValue(`${prefix}-shift`)) || 0
      const side = host.getAttribute(part === 'data-kui-preview' ? 'data-kui-preview-place' : 'data-kui-hint-place')
      const vertical = side === 'left' || side === 'right' || (!side && name.endsWith('-left'))
      return {
        left: geometry.rect.left + offsets.left - offsets.width / 2 + (vertical ? 0 : shift),
        top: geometry.rect.top + offsets.top - offsets.height / 2 + (vertical ? shift : 0),
        width: offsets.width,
        height: offsets.height,
      } as DOMRect
    }

    const resolved = registry.resolve(name)!
    const params = readEffectParams(
      { ...resolved.preset.params, ...authored },
      resolved.primitive.parameters,
      () => {},
    )
    const instance = resolved.primitive.prepare!(host, params, ctx(host))
    instance.activate()
    instances.push(instance)
    return { host, child, geometry, offsets, instance }
  }

  function setViewport(width: number, height: number): void {
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: height })
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
  }

  it('stamps a fixed side once and restores the attribute on destroy', () => {
    const { host, instance } = mount('hover-intent', {})
    expect(host.getAttribute('data-kui-hint-place')).toBe('top')
    instance.destroy()
    instances = []
    expect(host.hasAttribute('data-kui-hint-place')).toBe(false)
  })

  it('stamps place:bottom as written; a fixed side measures once on show, never while hidden', () => {
    const { host } = mount('hover-intent', { place: 'bottom' })
    const measure = vi.spyOn(host, 'getBoundingClientRect')
    viewportEvent('scroll')
    expect(measure).not.toHaveBeenCalled()
    host.dispatchEvent(new Event('pointerenter'))
    expect(host.getAttribute('data-kui-hint-place')).toBe('bottom')
    // Once, for `SHIFT` — the side itself is never re-chosen.
    expect(measure).toHaveBeenCalledOnce()
    host.dispatchEvent(new Event('pointerleave'))
    viewportEvent('resize')
    expect(measure).toHaveBeenCalledOnce()
  })

  it.each(['bottom', 'left', 'right'])('carries anchored-preview-%s through its preset params', (side) => {
    const { host } = mount(`anchored-preview-${side}`, {}, 'data-kui-preview')
    expect(host.getAttribute('data-kui-preview-place')).toBe(side)
  })

  it('auto: flips the hint below when the top is too tight, and back when the top has room', () => {
    setViewport(1000, 800)
    const { host, geometry, offsets } = mount('hover-intent', { place: 'auto' })
    expect(host.getAttribute('data-kui-hint-place')).toBe('top')

    // Trigger 30px from the top of the viewport; the hint (60px + 8px gap) reaches 68px above it.
    geometry.rect = { top: 30, bottom: 70, left: 100, right: 180 }
    Object.assign(offsets, { top: -68, height: 60 })
    host.dispatchEvent(new Event('pointerenter'))
    expect(host.getAttribute('data-kui-hint-place')).toBe('bottom')

    // Now sitting below: offsetTop is the host's height plus the gap, and the extent measured from
    // the bottom side must come out as the same 68px. A small scroll that still leaves the top
    // 50px short of it keeps the hint below…
    Object.assign(offsets, { top: 48, height: 60 })
    geometry.rect = { top: 50, bottom: 90, left: 100, right: 180 }
    viewportEvent('scroll')
    expect(host.getAttribute('data-kui-hint-place')).toBe('bottom')

    // …and once the top has room again (80px ≥ 68px — a margin that only the true extent clears),
    // it goes back.
    geometry.rect = { top: 80, bottom: 120, left: 100, right: 180 }
    viewportEvent('scroll')
    expect(host.getAttribute('data-kui-hint-place')).toBe('top')
  })

  it('auto: stops listening to the viewport once neither hovered nor focused', () => {
    setViewport(1000, 800)
    const { host, geometry, offsets } = mount('hover-intent', { place: 'auto' })
    Object.assign(offsets, { top: -68, height: 60 })
    geometry.rect = { top: 300, bottom: 340, left: 0, right: 0 }
    host.dispatchEvent(new Event('pointerenter'))
    host.dispatchEvent(new Event('pointerleave'))

    geometry.rect = { top: 30, bottom: 70, left: 0, right: 0 }
    // Asserted after each event: the stubbed offsets do not move with the stamped side, so a
    // second live measure would flip it straight back and hide the first.
    viewportEvent('scroll')
    expect(host.getAttribute('data-kui-hint-place')).toBe('top')
    viewportEvent('resize')
    expect(host.getAttribute('data-kui-hint-place')).toBe('top')
  })

  it('auto: stays watching while focus moves between descendants, and stops when it leaves', () => {
    setViewport(1000, 800)
    const { host, child, geometry, offsets } = mount('hover-intent', { place: 'auto' })
    Object.assign(offsets, { top: -68, height: 60 })
    geometry.rect = { top: 300, bottom: 340, left: 0, right: 0 }
    host.dispatchEvent(new FocusEvent('focusin'))
    host.dispatchEvent(new FocusEvent('focusout', { relatedTarget: child }))

    geometry.rect = { top: 30, bottom: 70, left: 0, right: 0 }
    viewportEvent('resize')
    expect(host.getAttribute('data-kui-hint-place')).toBe('bottom')

    host.dispatchEvent(new FocusEvent('focusout', { relatedTarget: null }))
    Object.assign(offsets, { top: 48, height: 60 })
    geometry.rect = { top: 300, bottom: 340, left: 0, right: 0 }
    viewportEvent('scroll')
    expect(host.getAttribute('data-kui-hint-place')).toBe('bottom')
  })

  it('auto: re-entering after a leave measures again', () => {
    setViewport(1000, 800)
    const { host, geometry, offsets } = mount('hover-intent', { place: 'auto' })
    Object.assign(offsets, { top: -68, height: 60 })
    geometry.rect = { top: 300, bottom: 340, left: 0, right: 0 }
    host.dispatchEvent(new Event('pointerenter'))
    host.dispatchEvent(new Event('pointerleave'))
    geometry.rect = { top: 30, bottom: 70, left: 0, right: 0 }
    host.dispatchEvent(new Event('pointerenter'))
    expect(host.getAttribute('data-kui-hint-place')).toBe('bottom')
  })

  it("auto on anchored-preview-right prefers the preset's side and flips along its own axis", () => {
    setViewport(1000, 800)
    const { host, geometry, offsets } = mount(
      'anchored-preview-right',
      { place: 'auto' },
      'data-kui-preview',
    )
    expect(host.getAttribute('data-kui-preview-place')).toBe('right')

    // Host 80px wide, 150px from the right edge: a 200px preview + 10px gap reaches 210px past it.
    geometry.rect = { top: 300, bottom: 340, left: 770, right: 850 }
    Object.assign(offsets, { left: 90, width: 200 })
    host.dispatchEvent(new Event('pointerenter'))
    expect(host.getAttribute('data-kui-preview-place')).toBe('left')

    // On the left now, the same 210px measured from the left edge. Still 70px short on the right,
    // so it stays left…
    Object.assign(offsets, { left: -210, width: 200 })
    geometry.rect = { top: 300, bottom: 340, left: 850, right: 930 }
    viewportEvent('scroll')
    expect(host.getAttribute('data-kui-preview-place')).toBe('left')

    // …until the right has room again.
    geometry.rect = { top: 300, bottom: 340, left: 100, right: 180 }
    viewportEvent('scroll')
    expect(host.getAttribute('data-kui-preview-place')).toBe('right')
  })

  it.each([
    ['anchored-preview', 'top'],
    ['anchored-preview-bottom', 'bottom'],
    ['anchored-preview-left', 'left'],
  ])('auto on %s starts from %s', (name, side) => {
    const { host } = mount(name, { place: 'auto' }, 'data-kui-preview')
    expect(host.getAttribute('data-kui-preview-place')).toBe(side)
  })

  it('auto with no fx name to read falls back to top', () => {
    const { host } = mount('anchored-preview', { place: 'auto' }, 'data-kui-preview')
    instances.pop()!.destroy()
    host.removeAttribute('data-kui-fx')
    const resolved = registry.resolve('anchored-preview')!
    const params = readEffectParams({ place: 'auto' }, resolved.primitive.parameters, () => {})
    const instance = resolved.primitive.prepare!(host, params, ctx(host))
    instance.activate()
    instances.push(instance)
    expect(host.getAttribute('data-kui-preview-place')).toBe('top')
  })

  it('auto with no part inside the host leaves the preferred side alone', () => {
    setViewport(1000, 800)
    const { host, child, geometry } = mount('hover-intent', { place: 'auto' })
    child.remove()
    geometry.rect = { top: 0, bottom: 40, left: 0, right: 0 }
    host.dispatchEvent(new Event('pointerenter'))
    expect(host.getAttribute('data-kui-hint-place')).toBe('top')
  })

  /**
   * `SHIFT` — the part slides along its cross axis to stay inside the viewport. Geometry is stubbed
   * as layout would give it: a centred part's `offsetLeft` is half its host's width (`left: 50%`,
   * before the `-50%` translate), so its resting start is `rect.left + offsetLeft - width / 2`.
   */
  describe('SHIFT', () => {
    const shiftOf = (host: Element, prefix = '--kui-hover-intent') =>
      (host as HTMLElement).style.getPropertyValue(`${prefix}-shift`)

    it('slides a top-placed hint left off the right edge, and only once it is shown', () => {
      setViewport(390, 800)
      const { host, geometry, offsets } = mount('hover-intent', {})
      // Host 60px wide at x=300; a 234px hint centred on it spans 213..447, past 390 - 8.
      geometry.rect = { top: 300, bottom: 340, left: 300, right: 360 }
      Object.assign(offsets, { left: 30, width: 234, top: -60, height: 50 })
      expect(shiftOf(host)).toBe('')
      host.dispatchEvent(new Event('pointerenter'))
      expect(shiftOf(host)).toBe('-65px')
    })

    it('slides it right off the left edge', () => {
      setViewport(390, 800)
      const { host, geometry, offsets } = mount('hover-intent', {})
      geometry.rect = { top: 300, bottom: 340, left: 10, right: 70 }
      Object.assign(offsets, { left: 30, width: 234 })
      host.dispatchEvent(new FocusEvent('focusin'))
      expect(shiftOf(host)).toBe('85px')
    })

    it('shifts a scaled preview in viewport coordinates and converts back to local pixels', () => {
      setViewport(390, 800)
      const { host, child, geometry, offsets } = mount('anchored-preview-bottom', {}, 'data-kui-preview')
      // An ancestor doubles the trigger and preview; the preview itself enters at scale .85.
      geometry.rect = { top: 300, bottom: 340, left: 250, right: 410 }
      Object.assign(offsets, { left: 40, width: 100 })
      Object.defineProperty(host, 'offsetWidth', { get: () => 80 })
      host.getBoundingClientRect = () => ({ ...geometry.rect, width: 160, height: 40 }) as DOMRect
      child.style.scale = '0.85'
      let renderedShift = 0
      child.getBoundingClientRect = () =>
        ({ left: 330 + renderedShift * 2 - 85, width: 170, top: 350, height: 100 }) as DOMRect
      host.dispatchEvent(new Event('pointerenter'))
      // Resting viewport bounds are 230..430: -48 viewport px is -24 local CSS px.
      expect(shiftOf(host, '--kui-anchored-preview')).toBe('-24px')
      // Scroll can re-measure before the translate transition has caught up to the new shift.
      viewportEvent('scroll')
      expect(shiftOf(host, '--kui-anchored-preview')).toBe('-24px')
      renderedShift = -24
      viewportEvent('scroll')
      expect(shiftOf(host, '--kui-anchored-preview')).toBe('-24px')
    })

    it('writes no shift while the host is collapsed to a zero-size rect', () => {
      setViewport(390, 800)
      const { host, geometry, offsets } = mount('anchored-preview-bottom', {}, 'data-kui-preview')
      geometry.rect = { top: 300, bottom: 300, left: 250, right: 250 }
      Object.assign(offsets, { left: 40, width: 100 })
      // Laid out at 80px but painted at 0 (a scale(0) ancestor): no zoom to convert the shift by.
      Object.defineProperty(host, 'offsetWidth', { get: () => 80 })
      host.getBoundingClientRect = () => ({ ...geometry.rect, width: 0, height: 0 }) as DOMRect
      host.dispatchEvent(new Event('pointerenter'))
      expect(shiftOf(host, '--kui-anchored-preview')).toBe('')
    })

    it('anchored-preview-bottom shifts horizontally too — the 390px showcase bug', () => {
      setViewport(390, 800)
      const { host, geometry, offsets } = mount('anchored-preview-bottom', {}, 'data-kui-preview')
      geometry.rect = { top: 300, bottom: 320, left: 250, right: 330 }
      Object.assign(offsets, { left: 40, width: 234, top: 30, height: 150 })
      host.dispatchEvent(new Event('pointerenter'))
      // 250 + 40 - 117 = 173 → ends at 407; the right margin is 382.
      expect(shiftOf(host, '--kui-anchored-preview')).toBe('-25px')
    })

    it('left/right placements shift vertically, and ignore horizontal overflow', () => {
      setViewport(390, 800)
      const { host, geometry, offsets } = mount('anchored-preview-right', {}, 'data-kui-preview')
      // Trigger at the very top: a 200px preview centred on it starts 70px above the viewport.
      geometry.rect = { top: 10, bottom: 50, left: 300, right: 380 }
      Object.assign(offsets, { left: 90, width: 400, top: 20, height: 200 })
      host.dispatchEvent(new Event('pointerenter'))
      expect(shiftOf(host, '--kui-anchored-preview')).toBe('78px')
    })

    it('a part wider than the viewport aligns to the start edge', () => {
      setViewport(390, 800)
      const { host, geometry, offsets } = mount('hover-intent', {})
      // Starts on screen (330 - 250 = 80) and overflows only the right: pulling its end back to the
      // margin would push its start off the left, so its start goes to the margin instead.
      geometry.rect = { top: 300, bottom: 340, left: 300, right: 360 }
      Object.assign(offsets, { left: 30, width: 500 })
      host.dispatchEvent(new Event('pointerenter'))
      expect(shiftOf(host)).toBe('-72px')
    })

    it('re-measures on scroll while shown, writes only on change, and stops after leave', () => {
      setViewport(390, 800)
      const { host, geometry, offsets } = mount('hover-intent', {})
      geometry.rect = { top: 300, bottom: 340, left: 300, right: 360 }
      Object.assign(offsets, { left: 30, width: 234 })
      const writes = vi.spyOn(host.style, 'setProperty')
      host.dispatchEvent(new Event('pointerenter'))
      expect(shiftOf(host)).toBe('-65px')

      viewportEvent('scroll')
      expect(writes).toHaveBeenCalledOnce()

      geometry.rect = { top: 300, bottom: 340, left: 100, right: 160 }
      viewportEvent('scroll')
      // Back inside: the shift returns to zero rather than staying where it was.
      expect(shiftOf(host)).toBe('0px')

      host.dispatchEvent(new Event('pointerleave'))
      geometry.rect = { top: 300, bottom: 340, left: 300, right: 360 }
      viewportEvent('scroll')
      // Kept while hidden too, so the exit does not slide sideways.
      expect(shiftOf(host)).toBe('0px')
    })

    it("measures against the root's client width, which excludes a classic scrollbar", () => {
      setViewport(405, 800)
      Object.defineProperty(document.documentElement, 'clientWidth', {
        configurable: true,
        get: () => 390,
      })
      try {
        const { host, geometry, offsets } = mount('hover-intent', {})
        geometry.rect = { top: 300, bottom: 340, left: 300, right: 360 }
        Object.assign(offsets, { left: 30, width: 234 })
        host.dispatchEvent(new Event('pointerenter'))
        expect(shiftOf(host)).toBe('-65px')
      } finally {
        delete (document.documentElement as unknown as { clientWidth?: number }).clientWidth
      }
    })

    it("measures against the root's client height on the vertical axis", () => {
      setViewport(390, 815)
      Object.defineProperty(document.documentElement, 'clientHeight', {
        configurable: true,
        get: () => 800,
      })
      try {
        const { host, geometry, offsets } = mount('anchored-preview-left', {}, 'data-kui-preview')
        // A 200px preview centred on a trigger at y=720..760 ends at 840; the bottom margin is 792.
        geometry.rect = { top: 720, bottom: 760, left: 300, right: 380 }
        Object.assign(offsets, { top: 20, height: 200 })
        host.dispatchEvent(new Event('pointerenter'))
        expect(shiftOf(host, '--kui-anchored-preview')).toBe('-48px')
      } finally {
        delete (document.documentElement as unknown as { clientHeight?: number }).clientHeight
      }
    })

    it('place:auto flips and shifts in one measure, on the flipped side’s cross axis', () => {
      setViewport(1000, 800)
      const { host, geometry, offsets } = mount(
        'anchored-preview-right',
        { place: 'auto' },
        'data-kui-preview',
      )
      // Flips right → left (as above); then the 200px-tall preview starts 70px above the viewport.
      geometry.rect = { top: 10, bottom: 50, left: 770, right: 850 }
      Object.assign(offsets, { left: 90, width: 200, top: 20, height: 200 })
      host.dispatchEvent(new Event('pointerenter'))
      expect(host.getAttribute('data-kui-preview-place')).toBe('left')
      expect(shiftOf(host, '--kui-anchored-preview')).toBe('78px')
    })

    it("with no place: to read, shifts on the preferred side's axis", () => {
      setViewport(390, 800)
      const host = document.createElement('span')
      host.setAttribute('data-kui-fx', 'anchored-preview-left')
      const part = document.createElement('img')
      part.setAttribute('data-kui-preview', '')
      host.append(part)
      document.body.append(host)
      host.getBoundingClientRect = () => ({ top: 10, bottom: 50, left: 0, right: 0 }) as DOMRect
      Object.defineProperty(part, 'offsetTop', { get: () => 20 })
      Object.defineProperty(part, 'offsetHeight', { get: () => 200 })
      part.getBoundingClientRect = () => ({ top: -70, height: 200, left: 0, width: 0 }) as DOMRect
      const resolved = registry.resolve('anchored-preview-left')!
      // An empty schema reads every key as '' — no side stamped, so the shift asks `preferred`.
      const instance = resolved.primitive.prepare!(host, readEffectParams({}, {}, () => {}), ctx(host))
      instance.activate()
      instances.push(instance)
      host.dispatchEvent(new Event('pointerenter'))
      expect(host.hasAttribute('data-kui-preview-place')).toBe(false)
      expect(shiftOf(host, '--kui-anchored-preview')).toBe('78px')
    })
  })

  describe('shiftWithin', () => {
    it('is zero for a span already inside the margins', () => {
      expect(shiftWithin(8, 100, 390)).toBe(0)
      expect(shiftWithin(282, 100, 390)).toBe(0)
    })

    it('moves a span back from either edge to the margin', () => {
      expect(shiftWithin(300, 100, 390)).toBe(-18)
      expect(shiftWithin(-20, 100, 390)).toBe(28)
      expect(shiftWithin(-20, 100, 390, 0)).toBe(20)
    })

    it('aligns an over-wide span to the start margin, whichever edge it overflows', () => {
      expect(shiftWithin(-100, 400, 390)).toBe(108)
      expect(shiftWithin(50, 400, 390)).toBe(-42)
      // Exactly the room fits, and is not treated as over-wide.
      expect(shiftWithin(8, 374, 390)).toBe(0)
    })
  })

  /**
   * `tease:` — open once, unasked, on the first half-in-view entry. jsdom has no
   * `IntersectionObserver` and lays nothing out, so both the observer and the timer are fakes the
   * test drives by hand. The fake honours `disconnect()` the way the real one does — a
   * disconnected observer delivers nothing — so "once per mount" is tested through the real
   * mechanism rather than through the fake's own bookkeeping.
   */
  describe('tease:', () => {
    class FakeObserver {
      static readonly all: FakeObserver[] = []
      observed: Element[] = []
      connected = true
      disconnect = vi.fn(() => {
        this.connected = false
      })
      constructor(
        readonly callback: IntersectionObserverCallback,
        readonly options: IntersectionObserverInit,
      ) {
        FakeObserver.all.push(this)
      }
      observe(el: Element): void {
        this.observed.push(el)
      }
      /** Deliver one entry, as the browser would — never after `disconnect()`. */
      fire(isIntersecting = true, intersectionRatio = isIntersecting ? 0.5 : 0): void {
        if (!this.connected) return
        this.callback(
          [{ isIntersecting, intersectionRatio } as IntersectionObserverEntry],
          this as unknown as IntersectionObserver,
        )
      }
    }

    let timers: Map<number, { callback: () => void; ms: number }>
    let nextTimer: number

    beforeEach(() => {
      FakeObserver.all.length = 0
      ;(window as unknown as { IntersectionObserver: unknown }).IntersectionObserver = FakeObserver
      timers = new Map()
      nextTimer = 1
      vi.spyOn(window, 'setTimeout').mockImplementation(((callback: () => void, ms: number) => {
        timers.set(nextTimer, { callback, ms })
        return nextTimer++
      }) as unknown as typeof window.setTimeout)
      vi.spyOn(window, 'clearTimeout').mockImplementation(((id: number) => {
        timers.delete(id)
      }) as typeof window.clearTimeout)
    })

    afterEach(() => {
      delete (window as unknown as { IntersectionObserver?: unknown }).IntersectionObserver
    })

    /** Run every pending timer, as if its delay had elapsed. */
    function elapse(): void {
      for (const [id, { callback }] of [...timers]) {
        timers.delete(id)
        callback()
      }
    }

    it.each([
      ['absent', {}],
      ['0ms', { tease: '0ms' }],
    ])('is off when %s: no observer, no attribute', (_label, authored) => {
      mount('hover-intent', authored)
      mount('anchored-preview', authored, 'data-kui-preview')
      // `auto` takes the listening path even with no tease — it must not start one there either.
      mount('hover-intent', { place: 'auto', ...authored })
      expect(FakeObserver.all).toHaveLength(0)
    })

    it('observes the host at half in view, opens on entry, and closes after the tease', () => {
      const { host } = mount('hover-intent', { tease: '2s' })
      const [observer] = FakeObserver.all
      expect(observer!.observed).toEqual([host])
      expect(observer!.options).toEqual({ threshold: 0.5 })
      expect(host.hasAttribute('data-kui-hint-tease')).toBe(false)

      observer!.fire()
      expect(host.getAttribute('data-kui-hint-tease')).toBe('')
      expect([...timers.values()].map((t) => t.ms)).toEqual([2000])

      elapse()
      expect(host.hasAttribute('data-kui-hint-tease')).toBe(false)
    })

    it('waits for half visibility after an initially intersecting entry below the threshold', () => {
      const { host } = mount('hover-intent', { tease: '2s' })
      const observer = FakeObserver.all[0]!
      observer.fire(true, 0.1)
      expect(host.hasAttribute('data-kui-hint-tease')).toBe(false)
      expect(timers.size).toBe(0)
      expect(observer.disconnect).not.toHaveBeenCalled()
      observer.fire(true, 0.49)
      expect(host.hasAttribute('data-kui-hint-tease')).toBe(false)
      observer.fire(true, 0.5)
      expect(host.hasAttribute('data-kui-hint-tease')).toBe(true)
      expect(observer.disconnect).toHaveBeenCalledOnce()
    })

    it('ignores an entry that is not intersecting', () => {
      const { host } = mount('hover-intent', { tease: '2s' })
      FakeObserver.all[0]!.fire(false)
      expect(host.hasAttribute('data-kui-hint-tease')).toBe(false)
      expect(FakeObserver.all[0]!.disconnect).not.toHaveBeenCalled()
    })

    it('teases once per mount: the observer disconnects on the first entry', () => {
      const { host } = mount('hover-intent', { tease: '2s' })
      const [observer] = FakeObserver.all
      observer!.fire()
      expect(observer!.disconnect).toHaveBeenCalledOnce()
      elapse()

      observer!.fire()
      expect(host.hasAttribute('data-kui-hint-tease')).toBe(false)
      expect(timers.size).toBe(0)
    })

    it.each([
      ['pointerenter', () => new Event('pointerenter')],
      ['focusin', () => new FocusEvent('focusin')],
    ])('%s mid-tease hands over at once, and the timer is cancelled', (_type, event) => {
      const { host } = mount('hover-intent', { tease: '2s' })
      FakeObserver.all[0]!.fire()
      host.dispatchEvent(event())
      expect(host.hasAttribute('data-kui-hint-tease')).toBe(false)
      expect(timers.size).toBe(0)
      // The side the tease was placed on stays: the hover now holds the part open there.
      expect(host.getAttribute('data-kui-hint-place')).toBe('top')
    })

    it('a hover after the tease has ended does nothing to it', () => {
      const { host } = mount('hover-intent', { tease: '2s' })
      FakeObserver.all[0]!.fire()
      elapse()
      const removals = vi.spyOn(host, 'removeAttribute')
      host.dispatchEvent(new Event('pointerenter'))
      expect(removals).not.toHaveBeenCalled()
    })

    it('teardown mid-tease cancels the timer, disconnects and removes the attribute', () => {
      const { host, instance } = mount('hover-intent', { tease: '2s' })
      const [observer] = FakeObserver.all
      observer!.fire()
      instance.destroy()
      instances = []
      expect(timers.size).toBe(0)
      expect(host.hasAttribute('data-kui-hint-tease')).toBe(false)
      expect(host.hasAttribute('data-kui-hint-place')).toBe(false)
    })

    it('teardown before any entry disconnects the observer', () => {
      const { instance } = mount('hover-intent', { tease: '2s' })
      instance.destroy()
      instances = []
      expect(FakeObserver.all[0]!.disconnect).toHaveBeenCalledOnce()
    })

    it('place:auto measures and stamps its side BEFORE the tease opens the part', () => {
      setViewport(1000, 800)
      const { host, geometry, offsets } = mount('hover-intent', { place: 'auto', tease: '2s' })
      geometry.rect = { top: 30, bottom: 70, left: 0, right: 0 }
      Object.assign(offsets, { top: -68, height: 60 })
      const writes = vi.spyOn(host, 'setAttribute')
      FakeObserver.all[0]!.fire()
      expect(writes.mock.calls.map(([name]) => name)).toEqual([
        'data-kui-hint-place',
        'data-kui-hint-tease',
      ])
      expect(host.getAttribute('data-kui-hint-place')).toBe('bottom')
    })

    it('place:auto keeps re-placing on scroll while teasing, and stops once the tease ends', () => {
      setViewport(1000, 800)
      const { host, geometry, offsets } = mount('hover-intent', { place: 'auto', tease: '2s' })
      Object.assign(offsets, { top: -68, height: 60 })
      geometry.rect = { top: 300, bottom: 340, left: 0, right: 0 }
      FakeObserver.all[0]!.fire()
      expect(host.getAttribute('data-kui-hint-place')).toBe('top')

      geometry.rect = { top: 30, bottom: 70, left: 0, right: 0 }
      viewportEvent('scroll')
      expect(host.getAttribute('data-kui-hint-place')).toBe('bottom')

      elapse()
      Object.assign(offsets, { top: 48, height: 60 })
      geometry.rect = { top: 300, bottom: 340, left: 0, right: 0 }
      viewportEvent('scroll')
      expect(host.getAttribute('data-kui-hint-place')).toBe('bottom')
    })

    it('with no IntersectionObserver in the realm, no tease and no throw', () => {
      delete (window as unknown as { IntersectionObserver?: unknown }).IntersectionObserver
      const { host, instance } = mount('hover-intent', { tease: '2s' })
      expect(host.getAttribute('data-kui-hint-place')).toBe('top')
      expect(host.hasAttribute('data-kui-hint-tease')).toBe(false)
      expect(() => instance.destroy()).not.toThrow()
      instances = []
    })

    it('anchored-preview-left teases through data-kui-preview-tease, on its own side', () => {
      const { host } = mount('anchored-preview-left', { tease: '1500ms' }, 'data-kui-preview')
      FakeObserver.all[0]!.fire()
      expect(host.getAttribute('data-kui-preview-tease')).toBe('')
      expect(host.getAttribute('data-kui-preview-place')).toBe('left')
      expect([...timers.values()].map((t) => t.ms)).toEqual([1500])
    })

    it('target: + place:auto + tease: measures the named part, which carries no authored marker', () => {
      setViewport(1000, 800)
      const { host, child, geometry, offsets } = mount(
        'hover-intent',
        { place: 'auto', tease: '2s', target: '[data-named]' },
        'data-named',
      )
      expect(child.getAttribute('data-kui-hint')).toBe('')
      geometry.rect = { top: 30, bottom: 70, left: 0, right: 0 }
      Object.assign(offsets, { top: -68, height: 60 })
      FakeObserver.all[0]!.fire()
      expect(host.getAttribute('data-kui-hint-place')).toBe('bottom')
      expect(host.getAttribute('data-kui-hint-tease')).toBe('')
    })

    it('a tease on a fixed side shifts the part into view before it opens, and keeps it there', () => {
      setViewport(390, 800)
      const { host, geometry, offsets } = mount('anchored-preview-bottom', { tease: '2s' }, 'data-kui-preview')
      geometry.rect = { top: 300, bottom: 320, left: 250, right: 330 }
      Object.assign(offsets, { left: 40, width: 234 })
      let shiftWhenOpened = ''
      vi.spyOn(host, 'setAttribute').mockImplementation(function (this: Element, name, value) {
        if (name === 'data-kui-preview-tease') {
          shiftWhenOpened = (host as HTMLElement).style.getPropertyValue('--kui-anchored-preview-shift')
        }
        Element.prototype.setAttribute.call(this, name, value)
      })
      FakeObserver.all[0]!.fire()
      expect(shiftWhenOpened).toBe('-25px')

      // The reader scrolls the trigger further right mid-tease: still re-measured.
      geometry.rect = { top: 300, bottom: 320, left: 270, right: 350 }
      viewportEvent('scroll')
      expect(host.style.getPropertyValue('--kui-anchored-preview-shift')).toBe('-45px')
    })

    it('still teases under reduced motion — the stylesheet shortens it, the script does not skip it', () => {
      const host = document.createElement('button')
      host.setAttribute('data-kui-fx', 'hover-intent')
      const hint = document.createElement('span')
      hint.setAttribute('data-kui-hint', '')
      host.append(hint)
      document.body.append(host)
      const resolved = registry.resolve('hover-intent')!
      const params = readEffectParams({ tease: '2s' }, resolved.primitive.parameters, () => {})
      const instance = resolved.primitive.prepare!(host, params, {
        ...ctx(host),
        reducedMotion: true,
      } as PrepareContext)
      instance.activate()
      instances.push(instance)
      FakeObserver.all[0]!.fire()
      expect(host.getAttribute('data-kui-hint-tease')).toBe('')
    })
  })
})

describe('tease: in the stylesheet', () => {
  it.each([
    ['[data-kui-fx][data-kui-hint-tease]', '--kui-hover-intent'],
    ['[data-kui-fx][data-kui-preview-tease]', '--kui-anchored-preview'],
  ])('%s opens the part with no lag, as a compound on the host', (selector, prefix) => {
    const body = ruleBody(selector)
    expect(body).toContain(`${prefix}-shown: 1;`)
    expect(body).toContain(`${prefix}-lag: 0ms;`)
  })

  it('the reduced-motion block covers both parts, so a tease shows without moving', () => {
    const blocks = css.split('@media (prefers-reduced-motion: reduce)')
    const last = blocks[blocks.length - 1]!
    expect(last.slice(0, last.indexOf('}'))).toMatch(/\[data-kui-hint\],[\s\S]*\[data-kui-preview\],/)
  })
})

describe('SHIFT in the stylesheet', () => {
  it.each([
    ["[data-kui-fx~='hover-intent']", '--kui-hover-intent'],
    ["[data-kui-fx~='anchored-preview-right']", '--kui-anchored-preview'],
  ])('%s resets %s-shift to 0px, so a nested trigger never inherits it', (selector, prefix) => {
    expect(ruleBody(selector)).toContain(`${prefix}-shift: 0px;`)
  })

  it('the hint adds the shift to its -50% centring', () => {
    expect(ruleBody('[data-kui-hint]')).toContain(
      'translate: calc(-50% + var(--kui-hover-intent-shift, 0px))',
    )
  })

  it.each(['top', 'bottom', 'left', 'right'])(
    'the %s preview travel adds the shift to its -50% centring, resolved on the host',
    (side) => {
      const body = ruleBody(`[data-kui-fx][data-kui-preview-place='${side}']`)
      expect(body).toContain('calc(-50% + var(--kui-anchored-preview-shift, 0px))')
      expect(body).not.toMatch(/(^|[\s:])-50%\s/)
    },
  )
})
