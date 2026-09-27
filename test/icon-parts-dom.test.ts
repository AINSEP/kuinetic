// @vitest-environment jsdom
//
// DOM-level behaviour of `withIconParts` (src/effects/svg/icon-parts.ts). The CSS drift guard
// lives in `test/icon-parts.test.ts` instead — that one reads stylesheets through
// `test/support/css-sources.ts`, which must stay in the node env (the default), so it cannot
// share this file.
import { afterEach, describe, expect, it } from 'vitest'
import { withIconParts } from '../src/effects/svg/icon-parts.js'
import { createParams } from '../src/core/js-params.js'
import { createStyleLedger } from '../src/core/owned-styles.js'
import { inertInstance } from '../src/core/types.js'
import type { EffectInstance } from '../src/core/types.js'
import type { PrepareContext } from '../src/core/effect-context.js'

/** A minimal `PrepareContext` with a real `AbortController`, so `ctx.signal.dispatchEvent`-style
 *  teardown (via `controller.abort()`) exercises the same path the animator's own release does. */
function fakeCtx(el: Element): { ctx: PrepareContext; abort: () => void } {
  const controller = new AbortController()
  return {
    ctx: {
      win: window,
      doc: window.document,
      reducedMotion: false,
      warn: () => {},
      style: createStyleLedger(el),
      signal: controller.signal,
    } as unknown as PrepareContext,
    abort: () => controller.abort(),
  }
}

/** Records whether — and with what — the wrapped `inner` ran, standing in for a real primitive's
 *  own `prepare` so these tests isolate `withIconParts`'s own part-stamping logic. Exposes the
 *  exact `EffectInstance` it returns so a caller can assert `withIconParts` passes it through
 *  unchanged rather than wrapping or replacing it. */
function spyInner(): {
  inner: NonNullable<Parameters<typeof withIconParts>[0]>
  calls: unknown[][]
  instance: EffectInstance
} {
  const calls: unknown[][] = []
  const instance: EffectInstance = inertInstance()
  const inner = (...args: unknown[]): EffectInstance => {
    calls.push(args)
    return instance
  }
  return { inner: inner as NonNullable<Parameters<typeof withIconParts>[0]>, calls, instance }
}

afterEach(() => {
  document.body.replaceChildren()
})

describe('withIconParts', () => {
  it('stamps data-kui-part="bar" on class-free positional children', () => {
    const host = document.createElement('button')
    host.innerHTML = '<span></span><span></span><span></span>'
    document.body.append(host)
    const { ctx } = fakeCtx(host)

    withIconParts(spyInner().inner)(host, createParams({}), ctx)

    const bars = host.querySelectorAll("[data-kui-part='bar']")
    expect(bars.length).toBe(3)
  })

  it('skips a label sibling that carries its own text', () => {
    const host = document.createElement('button')
    host.innerHTML = '<span></span><span></span><span aria-hidden="true">Menu</span>'
    document.body.append(host)
    const { ctx } = fakeCtx(host)

    withIconParts(spyInner().inner)(host, createParams({}), ctx)

    expect(host.querySelectorAll("[data-kui-part='bar']").length).toBe(2)
    const label = host.lastElementChild
    expect(label).not.toBeNull()
    expect(label?.hasAttribute('data-kui-part')).toBe(false)
  })

  it("reads an <svg>-only host's drawable children as the bars, in document order", () => {
    const host = document.createElement('button')
    host.innerHTML =
      '<svg><circle cx="1" cy="1" r="1"></circle><rect x="0" y="0" width="1" height="1"></rect></svg>'
    document.body.append(host)
    const { ctx } = fakeCtx(host)

    withIconParts(spyInner().inner)(host, createParams({}), ctx)

    const bars = host.querySelectorAll("[data-kui-part='bar']")
    expect(Array.from(bars).map((b) => b.tagName.toLowerCase())).toEqual(['circle', 'rect'])
  })

  it('leaves an already-classed host untouched', () => {
    const host = document.createElement('button')
    host.innerHTML = '<span class="kui-bar"></span><span class="kui-bar"></span>'
    document.body.append(host)
    const before = host.outerHTML
    const { ctx } = fakeCtx(host)

    withIconParts(spyInner().inner)(host, createParams({}), ctx)

    expect(host.outerHTML).toBe(before)
  })

  it('restores every stamped attribute on ctx.signal abort — outerHTML is byte-identical', () => {
    const host = document.createElement('button')
    host.innerHTML = '<span></span><span></span>'
    document.body.append(host)
    const before = host.outerHTML
    const { ctx, abort } = fakeCtx(host)

    withIconParts(spyInner().inner)(host, createParams({}), ctx)
    expect(host.outerHTML).not.toBe(before) // sanity: the stamp actually happened first

    abort()
    expect(host.outerHTML).toBe(before)
  })

  it('does not stamp, and does not throw, when there are no candidate bars', () => {
    const host = document.createElement('button')
    document.body.append(host)
    const { ctx } = fakeCtx(host)

    expect(() => withIconParts(spyInner().inner)(host, createParams({}), ctx)).not.toThrow()
    expect(host.querySelectorAll("[data-kui-part='bar']").length).toBe(0)
  })

  it('always calls inner with the same (el, params, ctx) and returns its instance', () => {
    const host = document.createElement('button')
    host.innerHTML = '<span></span>'
    document.body.append(host)
    const { ctx } = fakeCtx(host)
    const params = createParams({})
    const { inner, calls, instance } = spyInner()

    const result = withIconParts(inner)(host, params, ctx)

    expect(calls).toEqual([[host, params, ctx]])
    expect(result).toBe(instance)
  })
})
