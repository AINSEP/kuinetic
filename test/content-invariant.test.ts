// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createParams, readParams } from '../src/core/js-params.js'
import { createStyleLedger } from '../src/core/owned-styles.js'
import type { PrepareContext } from '../src/core/effect-context.js'
import type { EffectParams, Preset, Primitive } from '../src/core/types.js'
import { formatCount, groupDigits } from '../src/effects/catalog/numbers-shared.js'
import type { CountFormat } from '../src/effects/catalog/numbers-shared.js'
import { catalogRegistry } from './support/registry.js'

/**
 * The content invariant (docs/design.md §12): animation may change presentation, never content.
 * At every instant — before activation, mid-effect, at rest, and after teardown — the text a
 * screen reader or a no-JS crawler would read must equal the authored text (or, for a counter
 * whose displayed number the library itself computes, the value it settles on).
 *
 * Enumerated from the registry's own `channels`, never hand-listed (see numbers.ts's "Missed #6"
 * and the `'content'`-channel comments this task added to split-text/split-text-motion/typewriter
 * in text.ts): a future content-mutating effect that forgets to declare the channel would
 * silently fall out of both this test and `findConflicts`'s composition guard, so the guard
 * itself is `CONTENT_PRESETS` below.
 */

const registry = catalogRegistry()

const HOST_TEXT = 'Hello world'

/**
 * Per-preset param overrides this test needs beyond the preset's own authored defaults.
 *
 * Only `word-cycler`: its preset ships no `words:` (see text.ts's `TEXT_JS_PRESETS`), and
 * `prepareWordCycler` no-ops on an empty word list, so exercising it at all needs one supplied.
 */
const PARAM_OVERRIDES: Record<string, Record<string, string>> = {
  'word-cycler': { words: 'alpha|beta' },
}

/** Every JS-tier text primitive reads only `win`/`doc`/`style`/`warn`/`reducedMotion` off `ctx`. */
function fakeCtx(el: Element): PrepareContext {
  return {
    win: window,
    doc: window.document,
    style: createStyleLedger(el),
    reducedMotion: false,
    warn: () => {},
  } as unknown as PrepareContext
}

/**
 * Validate a preset's own params against its primitive's schema exactly the way
 * `js-effect-preparer.ts` does in production (`readEffectParams`), so a JS primitive under test
 * sees the same defaulted, validated values it would from a real `data-kui` attribute.
 */
function buildParams(preset: Preset, primitive: Primitive): { params: EffectParams; values: Record<string, string> } {
  const authored = { ...(preset.params ?? {}), ...(PARAM_OVERRIDES[preset.name] ?? {}) }
  const values = readParams(authored, primitive.parameters, () => {})
  return { params: createParams(values), values }
}

/**
 * The text this preset's accessible layer must hold, start to finish.
 *
 * A counter cannot be checked against the authored host text — Task 6 only warns on a mismatch,
 * it does not read `to:` from the authored number — so its expectation is the value the library
 * itself computes and settles on: `formatCount`/`groupDigits` applied to the preset's own `to`.
 * Every other content-channel preset must read back exactly what the author wrote.
 */
function expectedTextFor(primitiveId: string, values: Record<string, string>): string {
  if (primitiveId === 'count') {
    return formatCount(Number(values.to ?? '100'), {
      format: (values.format ?? 'number') as CountFormat,
      decimals: Number(values.decimals ?? '0'),
      currency: values.currency ?? 'USD',
    })
  }
  if (primitiveId === 'count-odometer') {
    return groupDigits(String(Math.round(Math.max(0, Number(values.to ?? '100')))))
  }
  return HOST_TEXT
}

/**
 * The text a screen reader or a no-JS crawler would read: every text node not beneath an
 * `aria-hidden="true"` ancestor, whitespace-collapsed the way accessible-name computation does.
 */
function accessibleText(el: Element): string {
  const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  let text = ''
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.parentElement?.closest('[aria-hidden="true"]')) text += node.textContent ?? ''
  }
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * Every registered preset whose resolved primitive claims the `content` channel — derived from
 * the registry rather than hardcoded, per the standing "counts come from the registry" rule.
 */
const CONTENT_PRESETS = registry
  .names()
  .map((name) => registry.resolve(name)!)
  .filter(({ primitive }) => primitive.channels.includes('content'))

describe('content-channel registry enumeration', () => {
  it('finds a non-empty set that includes word-cycler and count-up', () => {
    const names = CONTENT_PRESETS.map(({ preset }) => preset.name)
    expect(names.length).toBeGreaterThan(0)
    expect(names).toContain('word-cycler')
    expect(names).toContain('count-up')
  })
})

describe('content invariant: accessible text never drifts from the authored/settled value', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it.each(CONTENT_PRESETS.map(({ preset }) => preset.name))('%s', (name) => {
    const { preset, primitive } = registry.resolve(name)!
    const el = document.createElement('p')
    el.textContent = HOST_TEXT
    const authoredInnerHTML = el.innerHTML

    const { params, values } = buildParams(preset, primitive)
    const expected = expectedTextFor(primitive.id, values)

    const instance = primitive.prepare!(el, params, fakeCtx(el))

    // (a) `prepare()` alone must not touch the DOM — every JS primitive here defers setup to
    // `activate()` (via `deferPrepare`).
    expect(el.innerHTML).toBe(authoredInnerHTML)

    // (b) right after activation.
    instance.activate()
    expect(accessibleText(el)).toBe(expected)

    // (c) partway through. The invariant does not depend on landing at a precise half — it holds
    // whether the effect is mid-flight or has already settled by this point.
    vi.advanceTimersByTime(200)
    expect(accessibleText(el)).toBe(expected)

    // (d) after completion or finish(). Advancing far past every preset's default
    // duration/interval here settles the ones that finish on their own (split-text, scramble,
    // count/count-odometer); an explicit finish() covers the ones that only jump to an end state
    // on request (typewriter) and is a harmless no-op for the ones that never end at all
    // (split-text-motion, typewriter-loop, word-cycler).
    vi.advanceTimersByTime(20_000)
    instance.finish()
    expect(accessibleText(el)).toBe(expected)

    // (e) after destroy(): the authored DOM comes back exactly, not the value the effect reached.
    instance.destroy()
    expect(el.innerHTML).toBe(authoredInnerHTML)
  })
})
