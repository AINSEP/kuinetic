// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { describeEffect } from '../src/core/describe.js'
import { collectingReporter } from '../src/core/reporter.js'
import { build } from './support/js-effect-harness.js'
import { catalogRegistry } from './support/registry.js'

/**
 * `describe()`'s `honoured` flags against what the runtime actually does.
 *
 * Every JS primitive in the catalog is built with all three bare timing tokens written, and the
 * tokens it warns "cannot honour" must be exactly the slots `describe()` marks `honoured: false`.
 * That is the guard on `core/timing-contract.ts`'s side table: a wrapper that drops the contract,
 * or a contract enforced without being recorded, disagrees here.
 */

beforeEach(() => {
  vi.useFakeTimers()
  document.body.innerHTML = ''
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const registry = catalogRegistry()
/** One name per JS primitive — the contract belongs to the primitive, not the preset. */
const names = [
  ...new Map(
    registry
      .names()
      .map((name) => [registry.resolve(name)!.primitive, name] as const)
      .filter(([primitive]) => primitive.renderer === 'javascript')
      .map(([primitive, name]) => [primitive.id, name]),
  ).values(),
]

function refusedAtRuntime(name: string): string[] {
  const reporter = collectingReporter()
  build(`<div data-kui="${name} 400ms 200ms linear"><p>a</p><p>b</p></div>`, reporter).start()
  const id = registry.resolve(name)!.primitive.id
  return (['duration', 'delay', 'ease'] as const).filter((token) =>
    reporter.messages.some((m) => m.includes(`"${id}" cannot honour ${token}:`)),
  )
}

describe('describe() honoured flags match the runtime warnings', () => {
  it('covers primitives on both sides, so the comparison cannot pass vacuously', () => {
    const refusing = names.filter((name) => describeEffect(registry, name)!.unhonouredBecause)
    expect(refusing.length).toBeGreaterThan(10)
    expect(names.length - refusing.length).toBeGreaterThan(10)
  })

  it('every JS primitive refuses at runtime exactly the slots describe() marks unhonoured', () => {
    const mismatches = names.flatMap((name) => {
      const described = describeEffect(registry, name)!
      const expected = described.positionalOrder.filter((slot) => !slot.honoured).map((slot) => slot.slot)
      const actual = refusedAtRuntime(name)
      return JSON.stringify(expected) === JSON.stringify(actual)
        ? []
        : [`${name}: describe() says ${JSON.stringify(expected)}, runtime refuses ${JSON.stringify(actual)}`]
    })
    expect(mismatches).toEqual([])
  })
})
