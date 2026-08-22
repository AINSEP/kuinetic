import { describe, expect, it, vi } from 'vitest'
import { createRegistry } from '../src/effects/index.js'
import { createParams, readEffectParams } from '../src/core/js-params.js'
import { createStyleLedger } from '../src/core/owned-styles.js'
import type { PrepareContext } from '../src/core/effect-context.js'
import {
  applySlatTimingVars,
  installSlatStage,
  slatAssembleFinishMs,
  slatOrder,
} from '../src/effects/catalog/media-shared.js'

/**
 * `prepareSlatAssemble` reads `ctx.win` and `ctx.style` (to conditionally claim `position:
 * relative` on the host) and nothing else, so a fake covering just those two — the same shape
 * `catalog-text-js.test.ts`'s `fakeCtx` uses for the JS-tier text primitives — is enough to
 * exercise it through the real registered `prepare` function.
 */
function fakeCtx(el: Element, win: Window & typeof globalThis = window): PrepareContext {
  return { win, doc: win.document, style: createStyleLedger(el) } as unknown as PrepareContext
}

const registry = createRegistry()

describe('slatOrder', () => {
  it('is always 0 for a single slat', () => {
    expect(slatOrder(0, 1, 'alternate')).toBe(0)
    expect(slatOrder(0, 0, 'start')).toBe(0)
  })

  it('start ranks in geometric order', () => {
    expect([0, 1, 2, 3].map((i) => slatOrder(i, 4, 'start'))).toEqual([0, 1, 2, 3])
  })

  it('end ranks in reverse geometric order', () => {
    expect([0, 1, 2, 3].map((i) => slatOrder(i, 4, 'end'))).toEqual([3, 2, 1, 0])
  })

  it('edges ranks both ends first and the middle last', () => {
    expect([0, 1, 2, 3].map((i) => slatOrder(i, 4, 'edges'))).toEqual([0, 1, 1, 0])
  })

  it('alternate zig-zags from both ends inward, converging on the middle last', () => {
    // Visiting order is 0, 4, 1, 3, 2 — sorting positions by their rank should recover exactly
    // that order.
    const ranked = [0, 1, 2, 3, 4].map((i) => [i, slatOrder(i, 5, 'alternate')] as const)
    const byRank = [...ranked].sort((a, b) => a[1] - b[1]).map(([index]) => index)
    expect(byRank).toEqual([0, 4, 1, 3, 2])
  })

  it('random-ish is a deterministic pure function of index and count, not real randomness', () => {
    const first = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => slatOrder(i, 8, 'random-ish'))
    const second = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => slatOrder(i, 8, 'random-ish'))
    expect(first).toEqual(second)
    for (const rank of first) {
      expect(rank).toBeGreaterThanOrEqual(0)
      expect(rank).toBeLessThan(8)
    }
  })
})

describe('installSlatStage', () => {
  it('returns null when the element holds no <img>', () => {
    const el = document.createElement('figure')
    expect(installSlatStage(el, document, window, { count: 8, angleDegrees: 0, from: 'alternate', fold: false })).toBeNull()
  })

  it('returns null when the <img> has no resolvable src', () => {
    const el = document.createElement('figure')
    el.append(document.createElement('img'))
    expect(installSlatStage(el, document, window, { count: 8, angleDegrees: 0, from: 'alternate', fold: false })).toBeNull()
  })

  it('builds N slats over the image, sharing one background-image URL and never cloning <img>', () => {
    const el = document.createElement('figure')
    const img = document.createElement('img')
    img.src = './photo.jpg'
    el.append(img)

    const built = installSlatStage(el, document, window, {
      count: 5,
      angleDegrees: 0,
      from: 'start',
      fold: false,
    })!
    expect(built).not.toBeNull()
    expect(built.slats).toHaveLength(5)
    expect(el.querySelectorAll('img')).toHaveLength(1) // still exactly the one original <img>
    expect(el.querySelector('.kui-slat-stage')?.getAttribute('aria-hidden')).toBe('true')
    expect(built.stage.style.getPropertyValue('--kui-slat-count')).toBe('5')
    expect(built.stage.dataset.kuiSlatAxis).toBe('vertical')
    expect(built.stage.dataset.kuiSlatFold).toBe('false')

    built.slats.forEach((slat, index) => {
      expect(slat.style.getPropertyValue('--kui-slat-index')).toBe(String(index))
      expect(slat.style.getPropertyValue('--kui-i')).toBe(String(index)) // from:start === geometric order
      expect(slat.style.backgroundImage).toContain('photo.jpg')
    })
    // Every slat's background points at the same URL as the original <img> — one fetch, one
    // decode, shared across every slat, never a per-slat copy of the source image.
    const urls = new Set(built.slats.map((slat) => slat.style.backgroundImage))
    expect(urls.size).toBe(1)
  })

  it('sets data-kui-slat-fold and leaves the original <img> completely untouched', () => {
    const el = document.createElement('figure')
    const img = document.createElement('img')
    img.src = './photo.jpg'
    img.alt = 'A description'
    el.append(img)

    const built = installSlatStage(el, document, window, {
      count: 3,
      angleDegrees: 90,
      from: 'end',
      fold: true,
    })!
    expect(built.stage.dataset.kuiSlatFold).toBe('true')
    expect(built.stage.dataset.kuiSlatAxis).toBe('horizontal')
    expect(img.getAttribute('aria-hidden')).toBeNull()
    expect(img.alt).toBe('A description')

    built.restore()
    expect(el.querySelector('.kui-slat-stage')).toBeNull()
    expect(el.querySelectorAll('img')).toHaveLength(1)
    expect(img.alt).toBe('A description')
  })

  /** jsdom never lays anything out, so `offsetTop`/`offsetWidth`/etc. are always 0 on a real
   * node — stubbing them is the standard way to exercise layout-reading code under jsdom. */
  function stubOffsetBox(
    el: HTMLElement,
    box: { top: number; left: number; width: number; height: number },
  ): void {
    Object.defineProperty(el, 'offsetTop', { value: box.top, configurable: true })
    Object.defineProperty(el, 'offsetLeft', { value: box.left, configurable: true })
    Object.defineProperty(el, 'offsetWidth', { value: box.width, configurable: true })
    Object.defineProperty(el, 'offsetHeight', { value: box.height, configurable: true })
  }

  it("sizes the stage to the <img>'s own box, not el's, when el carries a caption below it", () => {
    const el = document.createElement('figure')
    const img = document.createElement('img')
    img.src = './photo.jpg'
    stubOffsetBox(img, { top: 0, left: 0, width: 400, height: 300 })
    el.append(img)
    const caption = document.createElement('figcaption')
    caption.textContent = 'a caption that would be spilled over by a flat inset:0 stage'
    el.append(caption)
    // el's own box is taller than the image alone, exactly like a real .demo-card figure —
    // proving the stage tracks the <img>, not this, is the whole point of the test.
    stubOffsetBox(el, { top: 0, left: 0, width: 400, height: 375 })

    const built = installSlatStage(el, document, window, {
      count: 4,
      angleDegrees: 0,
      from: 'start',
      fold: false,
    })!

    expect(built.stage.style.top).toBe('0px')
    expect(built.stage.style.left).toBe('0px')
    expect(built.stage.style.width).toBe('400px')
    expect(built.stage.style.height).toBe('300px') // the image's height, not el's 375px
    built.restore()
  })

  it('re-syncs the stage on a window resize (the ResizeObserver-less fallback path)', () => {
    const el = document.createElement('figure')
    const img = document.createElement('img')
    img.src = './photo.jpg'
    stubOffsetBox(img, { top: 0, left: 0, width: 200, height: 150 })
    el.append(img)

    // This environment has no native ResizeObserver, so installSlatStage already exercises the
    // fallback branch — asserted explicitly here rather than assumed.
    expect((window as Window & { ResizeObserver?: unknown }).ResizeObserver).toBeUndefined()

    const built = installSlatStage(el, document, window, {
      count: 2,
      angleDegrees: 0,
      from: 'start',
      fold: false,
    })!

    stubOffsetBox(img, { top: 10, left: 5, width: 240, height: 180 })
    window.dispatchEvent(new Event('resize'))

    expect(built.stage.style.top).toBe('10px')
    expect(built.stage.style.left).toBe('5px')
    expect(built.stage.style.width).toBe('240px')
    expect(built.stage.style.height).toBe('180px')

    built.restore()
    // Restore stops listening — a further resize must not throw or touch the (now-removed) stage.
    stubOffsetBox(img, { top: 99, left: 99, width: 99, height: 99 })
    expect(() => window.dispatchEvent(new Event('resize'))).not.toThrow()
    expect(built.stage.style.top).toBe('10px') // unchanged: the listener was already removed
  })

  it('uses ResizeObserver instead when the environment provides one, and disconnects it on restore', () => {
    class FakeResizeObserver {
      static readonly instances: FakeResizeObserver[] = []
      callback: () => void
      observed: Element[] = []
      disconnected = false
      constructor(callback: () => void) {
        this.callback = callback
        FakeResizeObserver.instances.push(this)
      }
      observe(target: Element): void {
        this.observed.push(target)
      }
      disconnect(): void {
        this.disconnected = true
      }
    }

    const win = window as Window & { ResizeObserver?: unknown }
    const original = win.ResizeObserver
    win.ResizeObserver = FakeResizeObserver
    try {
      const el = document.createElement('figure')
      const img = document.createElement('img')
      img.src = './photo.jpg'
      stubOffsetBox(img, { top: 0, left: 0, width: 100, height: 80 })
      el.append(img)

      const built = installSlatStage(el, document, window, {
        count: 2,
        angleDegrees: 0,
        from: 'start',
        fold: false,
      })!

      const observer = FakeResizeObserver.instances.at(-1)!
      expect(observer.observed).toEqual([img])

      stubOffsetBox(img, { top: 1, left: 2, width: 120, height: 90 })
      observer.callback()
      expect(built.stage.style.width).toBe('120px')
      expect(built.stage.style.height).toBe('90px')

      built.restore()
      expect(observer.disconnected).toBe(true)
    } finally {
      win.ResizeObserver = original
    }
  })
})

describe('applySlatTimingVars', () => {
  it('prefers positional segment timing over the same-named parameters', () => {
    const stage = document.createElement('div')
    const params = createParams(
      { duration: '900ms', delay: '10ms', ease: 'linear', stagger: '80ms' },
      { durationMs: 2000, delayMs: 100, easing: 'ease-in-out' },
    )
    applySlatTimingVars(stage, params)
    expect(stage.style.getPropertyValue('--kui-duration')).toBe('2000ms')
    expect(stage.style.getPropertyValue('--kui-delay')).toBe('100ms')
    expect(stage.style.getPropertyValue('--kui-ease')).toBe('ease-in-out')
    expect(stage.style.getPropertyValue('--kui-stagger')).toBe('80ms')
  })

  it('falls back to the named parameters when no positional timing was authored', () => {
    const stage = document.createElement('div')
    const params = createParams({ duration: '900ms', delay: '10ms', ease: 'linear', stagger: '80ms' })
    applySlatTimingVars(stage, params)
    expect(stage.style.getPropertyValue('--kui-duration')).toBe('900ms')
    expect(stage.style.getPropertyValue('--kui-delay')).toBe('10ms')
    expect(stage.style.getPropertyValue('--kui-ease')).toBe('linear')
  })
})

describe('slatAssembleFinishMs', () => {
  it('is zero when there were no slats to build', () => {
    expect(slatAssembleFinishMs(createParams({}), 0)).toBe(0)
  })

  it('accounts for the last slat’s stagger delay plus its own duration', () => {
    const params = createParams({ duration: '500ms', delay: '0ms', stagger: '60ms' })
    // last of 8 slats waits 7 * 60ms, then its own 500ms.
    expect(slatAssembleFinishMs(params, 8)).toBe(7 * 60 + 500)
  })
})

describe('slat-assemble primitive', () => {
  it('defers DOM surgery until activate(), then builds the stage as a child of the figure', () => {
    const el = document.createElement('figure')
    // jsdom's `getComputedStyle` only reports a property that was actually set somewhere — an
    // author who wrote nothing at all reads back as `''`, not the CSS initial value — so this
    // spells out `static` explicitly, the same workaround
    // `catalog-interaction.test.ts`'s "claims position:relative for an explicitly static element"
    // case uses for `cursor-spotlight`'s identical defensive claim.
    el.style.position = 'static'
    const img = document.createElement('img')
    img.src = './photo.jpg'
    el.append(img)

    const resolved = registry.resolve('slat-assemble')!
    const instance = resolved.primitive.prepare!(
      el,
      createParams({ slats: '6', axis: 'vertical', from: 'alternate' }),
      fakeCtx(el),
    )

    expect(el.querySelector('.kui-slat-stage')).toBeNull()

    instance.activate()
    const stage = el.querySelector('.kui-slat-stage')!
    expect(stage).not.toBeNull()
    expect(el.querySelectorAll('.kui-slat-item')).toHaveLength(6)
    expect(stage.classList.contains('kui-slat-animating')).toBe(true)
    // The figure had no authored position, so the effect claims one defensively.
    expect(el.style.position).toBe('relative')

    // `ctx.style` is a per-*element* ledger the animator owns and restores once at full release —
    // not per-primitive on `destroy()` (see `cursor-spotlight`'s identical claim in
    // `interaction.ts`, which does not restore it on its own `destroy()` either) — so only the
    // stage removal is this instance's own responsibility to verify here.
    instance.destroy()
    expect(el.querySelector('.kui-slat-stage')).toBeNull()
  })

  it('leaves an already-positioned host alone', () => {
    const el = document.createElement('figure')
    el.style.position = 'absolute'
    const img = document.createElement('img')
    img.src = './photo.jpg'
    el.append(img)

    const instance = registry.resolve('slat-assemble')!.primitive.prepare!(
      el,
      createParams({}),
      fakeCtx(el),
    )
    instance.activate()
    expect(el.style.position).toBe('absolute')
    instance.destroy()
    expect(el.style.position).toBe('absolute')
  })

  it('is a harmless no-op when the figure holds no <img>', () => {
    const el = document.createElement('figure')
    const instance = registry.resolve('slat-assemble')!.primitive.prepare!(
      el,
      createParams({}),
      fakeCtx(el),
    )
    expect(() => instance.activate()).not.toThrow()
    expect(el.querySelector('.kui-slat-stage')).toBeNull()
    expect(() => instance.destroy()).not.toThrow()
  })

  /**
   * Landing must hand the picture back to the real `<img>`.
   *
   * It used to only drop the `kui-slat-animating` class, so the finished state was eight
   * background-image slats standing in for the photograph while the source `<img>` stayed
   * `visibility: hidden` — for good, on any page that never destroys the instance. Each slat
   * paints its own slice of a background scaled to `800% 100%` and the slats overlap by 1px so no
   * hairline shows between them, which means the reassembled picture is off by a pixel at every
   * seam. On a face the seams cut through the eyes and mouth and it reads as a rendering fault.
   */
  it('restores the <img> and removes the stage once the slats have landed', async () => {
    vi.useFakeTimers()
    const el = document.createElement('figure')
    const img = document.createElement('img')
    img.src = './photo.jpg'
    el.append(img)

    const instance = registry.resolve('slat-assemble')!.primitive.prepare!(
      el,
      createParams({ slats: '3', duration: '100ms', stagger: '50ms' }),
      fakeCtx(el),
    )
    instance.activate()
    // While the slats are flying, the source image is deliberately not painted.
    expect(img.style.visibility).toBe('hidden')
    expect(el.querySelector('.kui-slat-stage')).not.toBeNull()

    await vi.advanceTimersByTimeAsync(2 * 50 + 100)

    expect(img.style.visibility).toBe('')
    expect(el.querySelector('.kui-slat-stage')).toBeNull()
    vi.useRealTimers()
  })

  it('is a no-op when finish() arrives after the slats already landed on their own', async () => {
    // A real sequence, not a hypothetical: anything holding a `PlaybackHandle` can call `finish()`
    // late, and the replay FAB resets elements that may already have completed. Without the guard
    // the second landing restores a stage that is gone and re-resolves an already-settled promise.
    vi.useFakeTimers()
    const el = document.createElement('figure')
    const img = document.createElement('img')
    img.src = './photo.jpg'
    el.append(img)

    const instance = registry.resolve('slat-assemble')!.primitive.prepare!(
      el,
      createParams({ slats: '2', duration: '50ms', stagger: '0ms' }),
      fakeCtx(el),
    )
    instance.activate()
    await vi.advanceTimersByTimeAsync(50)
    expect(el.querySelector('.kui-slat-stage')).toBeNull()

    expect(() => instance.finish()).not.toThrow()
    await expect(instance.finished).resolves.toBeUndefined()
    expect(img.style.visibility).toBe('')
    vi.useRealTimers()
  })

  it('restores exactly once when a landing is followed by a destroy', async () => {
    // `land()` and `cleanup()` both restore; running the teardown twice must stay harmless.
    vi.useFakeTimers()
    const el = document.createElement('figure')
    const img = document.createElement('img')
    img.src = './photo.jpg'
    img.style.visibility = 'collapse'
    el.append(img)

    const instance = registry.resolve('slat-assemble')!.primitive.prepare!(
      el,
      createParams({ slats: '2', duration: '50ms', stagger: '0ms' }),
      fakeCtx(el),
    )
    instance.activate()
    await vi.advanceTimersByTimeAsync(50)
    // The author's own inline value comes back, not an empty string.
    expect(img.style.visibility).toBe('collapse')
    expect(() => instance.destroy()).not.toThrow()
    expect(img.style.visibility).toBe('collapse')
    expect(el.querySelector('.kui-slat-stage')).toBeNull()
    vi.useRealTimers()
  })

  it('finish() clears the pending completion timer, drops kui-slat-animating, and resolves finished immediately', async () => {
    vi.useFakeTimers()
    const el = document.createElement('figure')
    const img = document.createElement('img')
    img.src = './photo.jpg'
    el.append(img)

    const instance = registry.resolve('slat-assemble')!.primitive.prepare!(
      el,
      createParams({ slats: '4', duration: '2s', stagger: '100ms' }),
      fakeCtx(el),
    )
    instance.activate()
    const stage = el.querySelector('.kui-slat-stage')!
    instance.finish()
    await expect(instance.finished).resolves.toBeUndefined()
    expect(stage.classList.contains('kui-slat-animating')).toBe(false)

    // The timer that would have settled `finished` on its own is now dead.
    expect(() => vi.advanceTimersByTime(10_000)).not.toThrow()
    vi.useRealTimers()
  })

  it('settles finished on its own once every staggered slat would have landed', async () => {
    vi.useFakeTimers()
    const el = document.createElement('figure')
    const img = document.createElement('img')
    img.src = './photo.jpg'
    el.append(img)

    const instance = registry.resolve('slat-assemble')!.primitive.prepare!(
      el,
      createParams({ slats: '3', duration: '100ms', stagger: '50ms' }),
      fakeCtx(el),
    )
    instance.activate()
    const stage = el.querySelector('.kui-slat-stage')!

    let settled = false
    void instance.finished.then(() => {
      settled = true
    })

    await vi.advanceTimersByTimeAsync(2 * 50 + 100 - 1)
    expect(settled).toBe(false)
    expect(stage.classList.contains('kui-slat-animating')).toBe(true)

    // `deferredInstance`'s own `finished` only settles after a further `.then()` hop past this
    // primitive's own promise (see `instances.ts`), so the async timer advance — which flushes
    // microtasks between ticks — is what `vi.advanceTimersByTime` plus a single `await
    // Promise.resolve()` cannot reliably do; `play.test.ts` uses the same async form for the same
    // reason.
    await vi.advanceTimersByTimeAsync(1)
    expect(settled).toBe(true)
    expect(stage.classList.contains('kui-slat-animating')).toBe(false)

    instance.destroy()
    vi.useRealTimers()
  })

  it('rejects an out-of-range or non-integer slats count back to the schema default, not the raw input', () => {
    const { parameters } = registry.resolve('slat-assemble')!.primitive
    const warnings: string[] = []
    const warn = (message: string): void => {
      warnings.push(message)
    }

    expect(readEffectParams({ slats: '99' }, parameters, warn).num('slats')).toBe(8)
    expect(readEffectParams({ slats: '1' }, parameters, warn).num('slats')).toBe(8)
    expect(readEffectParams({ slats: '3.5' }, parameters, warn).num('slats')).toBe(8)
    expect(readEffectParams({ slats: '10' }, parameters, warn).num('slats')).toBe(10)
    expect(warnings.length).toBeGreaterThanOrEqual(3)
  })
})
