import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Registry } from '../src/core/registry.js'
import { createParams } from '../src/core/js-params.js'
import { createStyleLedger } from '../src/core/owned-styles.js'
import type { PrepareContext } from '../src/core/effect-context.js'
import {
  HOVER_PRESETS,
  INTERACTION_PRESETS,
  POINTER_PRESETS,
  registerInteraction,
} from '../src/effects/catalog/interaction.js'
import { parallaxOffset, supportsFineHover, tiltAngles } from '../src/effects/catalog/interaction-shared.js'

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/css/interaction.css'), 'utf8')

function registry(): Registry {
  return registerInteraction(new Registry())
}

/**
 * A real `window` plus a real per-element `StyleLedger` — everything the pointer-tracking
 * primitives read off `ctx` beyond DOM listeners they attach to `el` directly. Cloning or
 * proxy-wrapping `window` risks "illegal invocation" on native methods like `getComputedStyle`
 * that require a genuine `Window` receiver, so this reuses the real one rather than faking it.
 */
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

function stubRect(el: Element, box: { left: number; top: number; width: number; height: number }): void {
  Object.defineProperty(el, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ ...box, right: box.left + box.width, bottom: box.top + box.height }),
  })
}

function pointerEvent(type: string, x: number, y: number): PointerEvent {
  const event = new Event(type) as PointerEvent
  Object.defineProperty(event, 'clientX', { value: x })
  Object.defineProperty(event, 'clientY', { value: y })
  return event
}

/**
 * Deterministic stand-in for `requestAnimationFrame`/`cancelAnimationFrame`, so a cursor dot's
 * spring frames advance only when the test asks — the same queue-and-tick shape `spring.test.ts`
 * uses for `createSpringRunner` directly, needed here because `springDepsFor` reads the real
 * globals rather than anything injectable off `ctx`.
 */
function stubFrames(): { tick: (count: number) => void } {
  const frames: Array<(time: number) => void> = []
  let time = 0
  vi.stubGlobal('requestAnimationFrame', (cb: (time: number) => void) => {
    frames.push(cb)
    return frames.length
  })
  vi.stubGlobal('cancelAnimationFrame', () => {})
  return {
    tick(count: number) {
      for (let i = 0; i < count; i++) {
        const next = frames.shift()
        time += 16
        next?.(time)
      }
    },
  }
}

describe('interaction catalog registration', () => {
  it('registers 20 section I names (magnetic, already built elsewhere, is not part of this set)', () => {
    expect(INTERACTION_PRESETS).toHaveLength(20)
    expect(HOVER_PRESETS).toHaveLength(12)
    expect(POINTER_PRESETS).toHaveLength(7)
    const reg = registry()
    expect(INTERACTION_PRESETS.every((preset) => reg.has(preset.name))).toBe(true)
  })

  it('never registers a name already owned by the gestures module', () => {
    expect(registry().has('magnetic')).toBe(false)
  })
})

describe('discrete hover/focus effects (CSS-driven, no-op prepare)', () => {
  it('every hover primitive resolves to an inert instance — the real motion lives in CSS', () => {
    const reg = registry()
    for (const preset of HOVER_PRESETS) {
      const resolved = reg.resolve(preset.name)!
      const el = document.createElement('button')
      const instance = resolved.primitive.prepare!(el, createParams({}), fakeCtx(el))
      instance.activate()
      expect(el.outerHTML).toBe('<button></button>') // untouched — no DOM surgery, no attributes
      instance.destroy()
    }
  })

  it('ships a :focus-visible rule and a fine-pointer :hover mirror for every hover name', () => {
    for (const preset of HOVER_PRESETS) {
      const selector = `[data-kui-fx~='${preset.name}']`
      expect(css, `${preset.name}: missing :focus-visible`).toContain(`${selector}:focus-visible`)
      expect(css, `${preset.name}: missing :hover`).toContain(`${selector}:hover`)
    }
  })

  it('scopes every :hover rule to fine-pointer devices, and gives cursor dots a coarse-pointer fallback', () => {
    expect(css).toContain('@media (hover: hover) and (pointer: fine)')
    expect(css).toContain('@media (pointer: coarse)')
  })
})

describe('beam-border-auto (continuous variant, CSS-driven, no-op prepare)', () => {
  it('resolves to an inert instance, same as the hover-gated family', () => {
    const reg = registry()
    const resolved = reg.resolve('beam-border-auto')!
    const el = document.createElement('div')
    const instance = resolved.primitive.prepare!(el, createParams({}), fakeCtx(el))
    expect(() => instance.activate()).not.toThrow()
    expect(el.outerHTML).toBe('<div></div>')
    instance.destroy()
  })
})

describe('pointer-tracking effects (real JS)', () => {
  afterEach(() => {
    document.body.replaceChildren()
  })

  it('no-ops on a coarse pointer instead of wiring listeners or inserting a cursor dot', () => {
    const reg = registry()
    const resolved = reg.resolve('cursor-follow')!
    const el = document.createElement('a')
    document.body.append(el)
    const before = document.body.querySelectorAll('.kui-cursor-dot').length

    // `supportsFineHover` is the very first line of `prepareCursorDot`, so a fake window that
    // fails that check is safe here — nothing past it ever touches `ctx.win` again.
    const coarseWin = { matchMedia: () => ({ matches: false }) } as unknown as Window
    const instance = resolved.primitive.prepare!(el, createParams({}), fakeCtx(el, { win: coarseWin }))
    instance.activate()
    expect(document.body.querySelectorAll('.kui-cursor-dot')).toHaveLength(before)
    instance.destroy()
  })

  it.each(['tilt-3d', 'tilt-parallax', 'cursor-spotlight'] as const)(
    '%s no-ops on a coarse pointer, each carrying its own guard',
    (name) => {
      const reg = registry()
      const resolved = reg.resolve(name)!
      const el = document.createElement('div')
      document.body.append(el)
      const coarseWin = { matchMedia: () => ({ matches: false }) } as unknown as Window
      const instance = resolved.primitive.prepare!(el, createParams({}), fakeCtx(el, { win: coarseWin }))
      expect(() => instance.activate()).not.toThrow()
      instance.destroy()
    },
  )

  it('tilt-3d writes a perspective/rotate transform on pointermove and resets on pointerleave', () => {
    const reg = registry()
    const resolved = reg.resolve('tilt-3d')!
    const el = document.createElement('div')
    document.body.append(el)
    stubRect(el, { left: 0, top: 0, width: 200, height: 100 })

    const instance = resolved.primitive.prepare!(el, createParams({ maxAngle: '14' }), fakeCtx(el))
    instance.activate()

    el.dispatchEvent(pointerEvent('pointermove', 180, 50)) // near the right edge, vertical centre
    expect((el as HTMLElement).style.transform).toContain('rotateY(')
    expect((el as HTMLElement).style.transform).not.toContain('rotateY(0.00deg)')

    el.dispatchEvent(new Event('pointerleave'))
    expect((el as HTMLElement).style.transform).toContain('rotateX(0.00deg) rotateY(0.00deg)')

    instance.destroy()
  })

  it('cursor-spotlight publishes --kui-x/--kui-y on pointermove and hides on pointerleave', () => {
    const reg = registry()
    const resolved = reg.resolve('cursor-spotlight')!
    const el = document.createElement('div')
    document.body.append(el)
    stubRect(el, { left: 10, top: 10, width: 100, height: 100 })

    const instance = resolved.primitive.prepare!(el, createParams({}), fakeCtx(el))
    instance.activate()

    el.dispatchEvent(pointerEvent('pointermove', 60, 40))
    expect((el as HTMLElement).style.getPropertyValue('--kui-x')).toBe('50.0px')
    expect((el as HTMLElement).style.getPropertyValue('--kui-y')).toBe('30.0px')
    expect((el as HTMLElement).style.getPropertyValue('--kui-spotlight-opacity')).toBe('1')

    el.dispatchEvent(new Event('pointerleave'))
    expect((el as HTMLElement).style.getPropertyValue('--kui-spotlight-opacity')).toBe('0')

    instance.destroy()
  })

  it('tilt-parallax moves [data-depth] children opposite the pointer, scaled by depth', () => {
    const reg = registry()
    const resolved = reg.resolve('tilt-parallax')!
    const el = document.createElement('div')
    el.innerHTML = '<span data-depth="10"></span><span data-depth="20"></span>'
    document.body.append(el)
    stubRect(el, { left: 0, top: 0, width: 100, height: 100 })

    const instance = resolved.primitive.prepare!(el, createParams({ strength: '24' }), fakeCtx(el))
    instance.activate()

    el.dispatchEvent(pointerEvent('pointermove', 100, 50)) // far edge, vertical centre

    const [shallow, deep] = [...el.querySelectorAll('span')] as HTMLElement[]
    const shallowX = Number.parseFloat(shallow!.style.translate)
    const deepX = Number.parseFloat(deep!.style.translate)
    expect(deepX).toBeGreaterThan(shallowX) // the deeper layer moves further for the same pointer offset
    expect(shallowX).toBeGreaterThan(0)

    el.dispatchEvent(new Event('pointerleave'))
    expect(shallow!.style.translate).toBe('0.00px 0.00px')
    expect(deep!.style.translate).toBe('0.00px 0.00px')

    instance.destroy()
  })

  it('treats a non-numeric data-depth as depth 0 rather than NaN', () => {
    const reg = registry()
    const resolved = reg.resolve('tilt-parallax')!
    const el = document.createElement('div')
    el.innerHTML = '<span data-depth="not-a-number"></span>'
    document.body.append(el)
    stubRect(el, { left: 0, top: 0, width: 100, height: 100 })

    const instance = resolved.primitive.prepare!(el, createParams({ strength: '24' }), fakeCtx(el))
    instance.activate()
    el.dispatchEvent(pointerEvent('pointermove', 100, 50))

    const layer = el.querySelector('span') as HTMLElement
    expect(layer.style.translate).toBe('0.00px 0.00px')
    instance.destroy()
  })

  it('tilt-3d jumps to a partial tilt on focus (no pointer position to follow) and resets on blur', () => {
    const reg = registry()
    const resolved = reg.resolve('tilt-3d')!
    const el = document.createElement('div')
    document.body.append(el)
    stubRect(el, { left: 0, top: 0, width: 200, height: 100 })

    const instance = resolved.primitive.prepare!(el, createParams({ maxAngle: '14' }), fakeCtx(el))
    instance.activate()

    el.dispatchEvent(new Event('focus'))
    expect((el as HTMLElement).style.transform).toContain('rotateX(-7.00deg) rotateY(7.00deg)')

    el.dispatchEvent(new Event('blur'))
    expect((el as HTMLElement).style.transform).toContain('rotateX(0.00deg) rotateY(0.00deg)')

    instance.destroy()
  })

  it('cursor-spotlight re-centres and shows on focus (no pointer position to follow), hides on blur', () => {
    const reg = registry()
    const resolved = reg.resolve('cursor-spotlight')!
    const el = document.createElement('div')
    document.body.append(el)
    stubRect(el, { left: 10, top: 10, width: 100, height: 100 })

    const instance = resolved.primitive.prepare!(el, createParams({}), fakeCtx(el))
    instance.activate()

    el.dispatchEvent(new Event('focus'))
    expect((el as HTMLElement).style.getPropertyValue('--kui-x')).toBe('50%')
    expect((el as HTMLElement).style.getPropertyValue('--kui-y')).toBe('50%')
    expect((el as HTMLElement).style.getPropertyValue('--kui-spotlight-opacity')).toBe('1')

    el.dispatchEvent(new Event('blur'))
    expect((el as HTMLElement).style.getPropertyValue('--kui-spotlight-opacity')).toBe('0')

    instance.destroy()
  })

  it('leaves an already-positioned element\'s position untouched', () => {
    const reg = registry()
    const resolved = reg.resolve('cursor-spotlight')!
    const el = document.createElement('div')
    el.style.position = 'absolute'
    document.body.append(el)
    stubRect(el, { left: 10, top: 10, width: 100, height: 100 })

    const instance = resolved.primitive.prepare!(el, createParams({}), fakeCtx(el))
    instance.activate()

    expect((el as HTMLElement).style.position).toBe('absolute')
    instance.destroy()
  })

  it('claims position:relative for an explicitly static element, anchoring the glow overlay', () => {
    // jsdom's getComputedStyle reports an empty string, not "static", for an element with no
    // position style set at all — the claim path is only actually reachable (in this test
    // environment, and matching the code's own === 'static' check) via an *explicit* `static`.
    const reg = registry()
    const resolved = reg.resolve('cursor-spotlight')!
    const el = document.createElement('div')
    el.style.position = 'static'
    document.body.append(el)
    stubRect(el, { left: 10, top: 10, width: 100, height: 100 })

    const instance = resolved.primitive.prepare!(el, createParams({}), fakeCtx(el))
    instance.activate()

    expect((el as HTMLElement).style.position).toBe('relative')
    instance.destroy()
  })
})

describe('cursor-dot family (real JS, spring-driven)', () => {
  afterEach(() => {
    document.body.replaceChildren()
    vi.unstubAllGlobals()
  })

  it('cursor-follow springs a synthetic dot toward the pointer, hides on leave, jumps to centre on focus, and cleans up on destroy', () => {
    const { tick } = stubFrames()
    const reg = registry()
    const resolved = reg.resolve('cursor-follow')!
    const el = document.createElement('a')
    document.body.append(el)
    stubRect(el, { left: 0, top: 0, width: 100, height: 40 })

    const instance = resolved.primitive.prepare!(
      el,
      createParams({ stiffness: '300', damping: '30' }),
      fakeCtx(el),
    )
    instance.activate()

    const dot = document.querySelector('.kui-cursor-dot-follow') as HTMLElement
    expect(dot).toBeTruthy()
    expect(dot.parentElement).toBe(document.body)

    el.dispatchEvent(pointerEvent('pointermove', 80, 20))
    expect(dot.classList.contains('kui-cursor-dot-active')).toBe(true)

    tick(20) // let the spring actually advance toward the pointer position
    const [x] = dot.style.translate.split(' ').map(Number.parseFloat)
    expect(x).toBeGreaterThan(0)

    el.dispatchEvent(new Event('pointerleave'))
    expect(dot.classList.contains('kui-cursor-dot-active')).toBe(false)

    el.dispatchEvent(new Event('focus'))
    expect(dot.classList.contains('kui-cursor-dot-active')).toBe(true)
    expect(dot.style.translate).toBe('50.0px 20.0px') // element centre: left 0 + width/2, top 0 + height/2

    el.dispatchEvent(new Event('blur'))
    expect(dot.classList.contains('kui-cursor-dot-active')).toBe(false)

    instance.destroy()
    expect(document.querySelector('.kui-cursor-dot-follow')).toBeNull()
  })

  it('cursor-label sets the dot text from its label param', () => {
    const reg = registry()
    const el = document.createElement('div')
    document.body.append(el)

    const resolved = reg.resolve('cursor-label')!
    const instance = resolved.primitive.prepare!(el, createParams({ label: 'View' }), fakeCtx(el))
    instance.activate()

    const dot = document.querySelector('.kui-cursor-dot-label') as HTMLElement
    expect(dot.textContent).toBe('View')

    instance.destroy()
    expect(document.querySelector('.kui-cursor-dot-label')).toBeNull()
  })

  it('cursor-lag and cursor-invert each wire up their own dot class', () => {
    const reg = registry()
    for (const [name, cls] of [
      ['cursor-lag', 'kui-cursor-dot-lag'],
      ['cursor-invert', 'kui-cursor-dot-invert'],
    ] as const) {
      const el = document.createElement('div')
      document.body.append(el)
      const resolved = reg.resolve(name)!
      const instance = resolved.primitive.prepare!(el, createParams({}), fakeCtx(el))
      instance.activate()
      expect(document.querySelector(`.${cls}`)).toBeTruthy()
      instance.destroy()
      expect(document.querySelector(`.${cls}`)).toBeNull()
    }
  })
})

describe('interaction pure math', () => {
  it('tiltAngles is zero at dead centre', () => {
    const angles = tiltAngles({ x: 50, y: 50 }, { width: 100, height: 100 }, 14)
    expect(angles.rotateX).toBe(-0)
    expect(angles.rotateY).toBe(0)
  })

  it('tiltAngles rotates the far edge away as the pointer moves right', () => {
    const angles = tiltAngles({ x: 100, y: 50 }, { width: 100, height: 100 }, 14)
    expect(angles.rotateY).toBeCloseTo(14, 5)
  })

  it('tiltAngles inverts Y so hovering the top tilts the element back', () => {
    const angles = tiltAngles({ x: 50, y: 0 }, { width: 100, height: 100 }, 14)
    expect(angles.rotateX).toBeCloseTo(14, 5)
  })

  it('tiltAngles degrades to zero rotation for a zero-size element rather than dividing by zero', () => {
    const angles = tiltAngles({ x: 5, y: 5 }, { width: 0, height: 0 }, 14)
    expect(angles).toEqual({ rotateX: -0, rotateY: 0 })
  })

  it('parallaxOffset scales linearly with strength', () => {
    const offset = parallaxOffset({ x: 100, y: 50 }, { width: 100, height: 100 }, 24)
    expect(offset.x).toBeCloseTo(24, 5)
    expect(offset.y).toBeCloseTo(0, 5)
  })

  it('supportsFineHover reads the injected matchMedia result', () => {
    const capable = { matchMedia: () => ({ matches: true }) } as unknown as Window
    const incapable = { matchMedia: () => ({ matches: false }) } as unknown as Window
    expect(supportsFineHover(capable)).toBe(true)
    expect(supportsFineHover(incapable)).toBe(false)
  })

  it('supportsFineHover fails open when matchMedia is unavailable', () => {
    expect(supportsFineHover({} as Window)).toBe(true)
  })
})
