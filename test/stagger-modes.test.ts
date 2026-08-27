import { describe, expect, it } from 'vitest'
import { ATTR } from '../src/core/attrs.js'
import { parse } from '../src/core/parse.js'
import { collectingReporter } from '../src/core/reporter.js'
import {
  indexStaggerGroup,
  parseStaggerAttribute,
  resolveStaggerConfig,
} from '../src/core/stagger.js'

/**
 * The stagger *modes* — the two things a group can say about its own timing beyond a plain step.
 *
 * Kept out of `stagger-count.test.ts` only because that file is already at its length budget; the
 * subject is the same module and the same two attributes.
 */

/**
 * A group of `count` animated children, declared however the caller likes.
 *
 * @param declaration - The `data-kui-stagger` value, or `null` to leave the attribute off entirely
 *   (which is how the `data-kui`-hoisted spellings are exercised).
 * @param source - The group's own `data-kui`, for the hoisted spellings.
 */
function group(count: number, declaration: string | null, source?: string): HTMLElement {
  const ul = document.createElement('ul')
  if (declaration !== null) ul.setAttribute(ATTR.stagger, declaration)
  if (source !== undefined) ul.setAttribute(ATTR.source, source)
  for (let i = 0; i < count; i++) {
    const li = document.createElement('li')
    li.setAttribute(ATTR.source, 'fade-up')
    ul.append(li)
  }
  return ul
}

const stepOf = (ul: HTMLElement): string => ul.style.getPropertyValue('--kui-stagger')

describe('spread: — a total stagger budget', () => {
  it('divides the budget by the largest rank, not by the child count', () => {
    // Five children, ranks 0..4, so four gaps: 600ms / 4.
    const ul = group(5, 'spread:600ms')
    indexStaggerGroup(ul)
    expect(stepOf(ul)).toBe('calc((600ms) / 4)')
  })

  it('keeps the whole group inside the budget however many children arrive', () => {
    // The point of the mode: the divisor grows with the group, so the span does not.
    for (const count of [3, 20, 200]) {
      const ul = group(count, 'spread:600ms')
      indexStaggerGroup(ul)
      expect(stepOf(ul)).toBe(`calc((600ms) / ${String(count - 1)})`)
    }
  })

  it('publishes a stagger-count that still spends the budget exactly on a pin scrub', () => {
    // `declarations.ts`'s span term is `(count - 1) * stagger`, and `count` is `maxRank + 1`. With
    // the step at `budget / maxRank` that product is the budget itself — the property that makes a
    // budgeted group safe for `timeline: pin`.
    const ul = group(5, 'spread:600ms')
    indexStaggerGroup(ul)
    expect(ul.style.getPropertyValue('--kui-stagger-count')).toBe('5')
  })

  it('writes 0ms rather than a division by zero when the group has one beat', () => {
    // `calc(600ms / 0)` is an *invalid declaration*, not a harmless value: the browser drops it and
    // the group silently inherits an ancestor's step.
    const ul = group(1, 'spread:600ms')
    indexStaggerGroup(ul)
    expect(stepOf(ul)).toBe('0ms')
  })

  it('divides by the beat count, not the child count, once an ordering reuses beats', () => {
    // `center` on six children tops out at rank 2. Dividing by 5 would stretch the span to two and
    // a half times the budget.
    const ul = group(6, 'spread:600ms order:center')
    indexStaggerGroup(ul)
    expect(stepOf(ul)).toBe('calc((600ms) / 2)')
  })

  it('accepts an expression, exactly as the per-item step always has', () => {
    const ul = group(3, 'spread:var(--reveal-window)')
    indexStaggerGroup(ul)
    expect(stepOf(ul)).toBe('calc((var(--reveal-window)) / 2)')
  })

  it('brackets the budget so an authored calc() nests instead of merging', () => {
    const ul = group(3, 'spread:calc(1s - 200ms)')
    indexStaggerGroup(ul)
    expect(stepOf(ul)).toBe('calc((calc(1s - 200ms)) / 2)')
  })

  it('refuses a budget that could escape the declaration, and says so', () => {
    const warnings: string[] = []
    expect(resolveStaggerConfig('spread:600ms;color:red', '', warnings)?.spread).toBeUndefined()
    expect(warnings.join()).toContain('stagger spread')
    expect(warnings.join()).toContain('disallowed CSS syntax')
  })

  it('names a duplicate rather than letting token order pick', () => {
    const warnings: string[] = []
    expect(parseStaggerAttribute('spread:600ms spread:200ms', warnings).spread).toBe('600ms')
    expect(warnings.join()).toContain('duplicate "spread:"')
  })

  it('still names an unrecognised key, and offers spread: among the alternatives', () => {
    const warnings: string[] = []
    parseStaggerAttribute('90ms sprad:600ms', warnings)
    expect(warnings.join()).toContain('"spread:"')
  })
})

describe('spread: hoisted into data-kui', () => {
  it('parses as an element-wide hoist', () => {
    expect(parse('fade-up spread:600ms').spread).toBe('600ms')
  })

  it('stands alone as the whole attribute, the way cascade: and order: do', () => {
    // A group parent usually animates nothing of its own, so the segment names no effect.
    const parsed = parse('spread:600ms')
    expect(parsed.spread).toBe('600ms')
    expect(parsed.warnings).toEqual([])
  })

  it('declares a group all by itself', () => {
    const ul = group(3, null, 'spread:600ms')
    indexStaggerGroup(ul)
    expect(stepOf(ul)).toBe('calc((600ms) / 2)')
  })

  it('wins over a longhand budget and names the value it displaced', () => {
    const warnings: string[] = []
    const config = resolveStaggerConfig('spread:200ms', 'fade-up spread:600ms', warnings)
    expect(config?.spread).toBe('600ms')
    expect(warnings.join()).toContain('conflicting stagger budget')
  })
})

describe('spread: and cascade: are alternatives, never a pair', () => {
  it('takes the budget and names the step it ignored', () => {
    const warnings: string[] = []
    const config = resolveStaggerConfig('90ms', 'fade-up spread:600ms', warnings)
    expect(config).toEqual({ from: 'start', spread: '600ms' })
    expect(warnings.join()).toContain('is ignored')
  })

  it('resolves the same way whichever attribute each half arrived in', () => {
    const config = resolveStaggerConfig('spread:600ms', 'fade-up cascade:90ms', [])
    expect(config).toEqual({ from: 'start', spread: '600ms' })
  })

  it('warns at parse time when both spellings sit in one data-kui', () => {
    const parsed = parse('fade-up cascade:90ms spread:600ms')
    expect(parsed.warnings.join()).toContain('two ways to set one stagger step')
  })

  it('reports the conflict through the reporter, against the group element', () => {
    const reporter = collectingReporter()
    const ul = group(3, '90ms spread:600ms')
    indexStaggerGroup(ul, reporter)
    expect(reporter.messages.join()).toContain('is ignored')
    expect(stepOf(ul)).toBe('calc((600ms) / 2)')
  })
})
