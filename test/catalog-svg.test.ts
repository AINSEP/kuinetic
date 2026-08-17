import { afterEach, describe, expect, it, vi } from 'vitest'
import { Registry } from '../src/core/registry.js'
import { createParams } from '../src/core/js-params.js'
import { createStyleLedger } from '../src/core/owned-styles.js'
import type { PrepareContext } from '../src/core/effect-context.js'
import { SVG_PRESETS, SVG_PRIMITIVES, registerSvg } from '../src/effects/svg/index.js'
import { createMorph } from '../src/core/path-morph.js'

const SQUARE = 'M0,0 L10,0 L10,10 L0,10 Z'
const DIAMOND = 'M5,0 L10,5 L5,10 L0,5 Z'
const UNSUPPORTED = 'M0,0 A5,5 0 0 1 10,10'

function registry(): Registry {
  return registerSvg(new Registry())
}

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

/**
 * Same queue-and-tick shape as `catalog-interaction.test.ts`'s `stubFrames`, plus a matching
 * `performance.now` stub — `prepareMorph`'s `drive()` reads both globals directly (no injectable
 * seam, unlike `spring.ts`'s `now` dependency), so the fake clock has to back both or `t` comes out
 * negative from mixing a real `performance.now()` start time with fake per-tick frame times.
 */
function stubFrames(): { tick: (count: number) => void } {
  const frames: Array<(time: number) => void> = []
  let time = 0
  vi.stubGlobal('requestAnimationFrame', (cb: (time: number) => void) => {
    frames.push(cb)
    return frames.length
  })
  vi.stubGlobal('cancelAnimationFrame', () => {})
  vi.stubGlobal('performance', { now: () => time })
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

function svgPath(d: string): SVGPathElement {
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  el.setAttribute('d', d)
  return el
}

describe('svg catalog registration', () => {
  it('registers path-morph with its two presets', () => {
    expect(SVG_PRIMITIVES).toHaveLength(1)
    expect(SVG_PRIMITIVES[0]?.id).toBe('path-morph')
    const reg = registry()
    for (const preset of SVG_PRESETS) expect(reg.has(preset.name)).toBe(true)
  })
})

describe('path-morph prepare', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('warns and no-ops instead of morphing when a path uses an unsupported command', () => {
    const reg = registry()
    const resolved = reg.resolve('icon-morph')!
    const el = svgPath(UNSUPPORTED)
    const warn = vi.fn()

    const instance = resolved.primitive.prepare!(
      el,
      createParams({ to: SQUARE }),
      fakeCtx(el, { warn }),
    )
    instance.activate()

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('cannot morph'))
    expect(el.getAttribute('d')).toBe(UNSUPPORTED) // untouched — no listeners, no frame driven
    instance.destroy()
  })

  it("falls back to the element's own d attribute when from: is not authored", () => {
    const reg = registry()
    const resolved = reg.resolve('icon-morph')!
    const el = svgPath(SQUARE)
    const frames = stubFrames()

    const instance = resolved.primitive.prepare!(
      el,
      createParams({ to: DIAMOND, duration: '0ms' }),
      fakeCtx(el),
    )
    instance.activate()
    el.dispatchEvent(new Event('pointerenter'))
    frames.tick(1)

    // duration:0 jumps straight to t=1 — the fully-morphed diamond, not the untouched square.
    expect(el.getAttribute('d')).not.toBe(SQUARE)
    instance.destroy()
  })

  it('drives d from the start shape toward the end shape on pointerenter/focusin, over multiple frames', () => {
    const reg = registry()
    const resolved = reg.resolve('icon-morph')!
    const el = svgPath(SQUARE)
    const frames = stubFrames()

    const instance = resolved.primitive.prepare!(
      el,
      createParams({ to: DIAMOND, duration: '300ms' }),
      fakeCtx(el),
    )
    instance.activate()
    el.dispatchEvent(new Event('pointerenter'))

    frames.tick(1)
    const midway = el.getAttribute('d')!
    expect(midway).not.toBe(SQUARE)

    frames.tick(20) // well past 300ms / 16ms-per-tick — should have converged to t=1
    const settled = el.getAttribute('d')!
    expect(settled).not.toBe(midway) // kept advancing between the two reads
    expect(settled).not.toBe(SQUARE)

    instance.destroy()
  })

  it('reverses on pointerleave/focusout', () => {
    const reg = registry()
    const resolved = reg.resolve('icon-morph')!
    const el = svgPath(SQUARE)
    const frames = stubFrames()

    const instance = resolved.primitive.prepare!(
      el,
      createParams({ to: DIAMOND, duration: '0ms' }),
      fakeCtx(el),
    )
    instance.activate()

    // `morph.at(0)` re-serializes through the cubic normalizer (L becomes C), so it isn't
    // byte-identical to the raw authored SQUARE — compute the same normalized form to compare.
    const normalizedStart = createMorph(SQUARE, DIAMOND).morph!.at(0)

    el.dispatchEvent(new Event('focusin'))
    frames.tick(1)
    expect(el.getAttribute('d')).not.toBe(normalizedStart)

    el.dispatchEvent(new Event('focusout'))
    frames.tick(1)
    expect(el.getAttribute('d')).toBe(normalizedStart) // t:0 is exactly the start shape again

    instance.destroy()
  })

  it('falls all the way through to an empty from: string when neither from: nor a d attribute is present, which then fails to parse', () => {
    const reg = registry()
    const resolved = reg.resolve('icon-morph')!
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'path') // no d attribute at all
    const warn = vi.fn()

    // `startPath` falls all the way through `params.text('from') || path.getAttribute('d') || ''`
    // to the empty-string default, which `parsePath` then rejects as having no drawable segments —
    // the same warn-and-no-op path as an unsupported command, exercised here for the third `||`.
    const instance = resolved.primitive.prepare!(
      el,
      createParams({ to: SQUARE }),
      fakeCtx(el, { warn }),
    )
    instance.activate()

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('no drawable segments'))
    expect(el.getAttribute('d')).toBeNull() // never set — no-op cleanup, no listeners attached
    instance.destroy()
  })

  it('destroy cancels the pending frame, removes every listener, and restores the original d', () => {
    const reg = registry()
    const resolved = reg.resolve('icon-morph')!
    const el = svgPath(SQUARE)
    const frames = stubFrames()

    const instance = resolved.primitive.prepare!(
      el,
      createParams({ to: DIAMOND, duration: '300ms' }),
      fakeCtx(el),
    )
    instance.activate()
    el.dispatchEvent(new Event('pointerenter'))
    frames.tick(1)
    expect(el.getAttribute('d')).not.toBe(SQUARE)

    instance.destroy()
    expect(el.getAttribute('d')).toBe(SQUARE)

    // A pending frame fired after destroy must not resurrect the morph — `cancelled` gates `step`.
    frames.tick(5)
    expect(el.getAttribute('d')).toBe(SQUARE)

    // Listeners are gone too: a post-destroy pointerenter drives nothing.
    el.dispatchEvent(new Event('pointerenter'))
    frames.tick(5)
    expect(el.getAttribute('d')).toBe(SQUARE)
  })
})
