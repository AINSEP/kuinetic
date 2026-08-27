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

/** The `--kui-i` actually stamped on each animated child, in DOM order. */
const ranksOf = (ul: HTMLElement): string[] =>
  [...ul.children].map((child) => (child as HTMLElement).style.getPropertyValue('--kui-i'))

/**
 * Fake a laid-out row-major grid, so `cols:auto` can be measured in jsdom, which has no layout.
 *
 * Only `left`, `width` and `height` matter: the wrap is found by watching the sign of the step in
 * `left` reverse, and the zero-size check is what tells a group with no layout from a real one.
 */
function layOut(ul: HTMLElement, cols: number, { rtl = false } = {}): void {
  for (const [index, cell] of [...ul.children].entries()) {
    const column = index % cols
    const left = (rtl ? cols - 1 - column : column) * 100
    cell.getBoundingClientRect = (): DOMRect =>
      ({ left, top: Math.floor(index / cols) * 100, width: 80, height: 80 }) as DOMRect
  }
}

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

describe('cols: — ranking by distance through a grid', () => {
  it('fans out from the middle cell, not the middle index', () => {
    // Two rows of three. By DOM index `center` would start at child 2, halfway along row one; by
    // grid it starts at the two cells either side of the block's centre, origin (1, 0.5).
    const ul = group(6, '60ms cols:3 order:center')
    indexStaggerGroup(ul)
    expect(ranksOf(ul)).toEqual(['1.118', '0.5', '1.118', '1.118', '0.5', '1.118'])
  })

  it('measures distance in cells, so a straight-line neighbour ranks 1', () => {
    const ul = group(6, '60ms cols:3')
    indexStaggerGroup(ul)
    expect(ranksOf(ul)).toEqual(['0', '1', '2', '1', '1.414', '2.236'])
  })

  it('restricts the wave to one axis with along:', () => {
    // Column-major: every child in column 1 starts together, whatever row it is in.
    const ul = group(6, '60ms cols:3 along:x')
    indexStaggerGroup(ul)
    expect(ranksOf(ul)).toEqual(['0', '1', '2', '0', '1', '2'])
  })

  it('ranks strictly by row under along:y', () => {
    const ul = group(6, '60ms cols:3 along:y')
    indexStaggerGroup(ul)
    expect(ranksOf(ul)).toEqual(['0', '0', '0', '1', '1', '1'])
  })

  it("accepts GSAP's word for the axis on the longhand attribute", () => {
    expect(parseStaggerAttribute('60ms cols:3 axis:y').along).toBe('y')
  })

  it('takes an arbitrary origin as x/y fractions of the grid', () => {
    // `1/0` is the top-right corner — a point no keyword names, and the reason a point exists.
    const ul = group(6, '60ms cols:3 order:1/0')
    indexStaggerGroup(ul)
    expect(ranksOf(ul)).toEqual(['2', '1', '0', '2.236', '1.414', '1'])
  })

  it('needs no quoting for the point, because a slash is inert to the tokenizer', () => {
    // A comma would have split `data-kui` into two effect segments instead.
    expect(parse('fade-up cols:3 order:1/0').order).toBe('1/0')
  })

  it('turns edges inside out from center, so the block closes on its middle', () => {
    const ul = group(6, '60ms cols:3 order:edges')
    indexStaggerGroup(ul)
    expect(ranksOf(ul)).toEqual(['0', '0.618', '0', '0', '0.618', '0'])
  })

  it('measures order:end from the bottom-right corner', () => {
    const ul = group(6, '60ms cols:3 order:end')
    indexStaggerGroup(ul)
    expect(ranksOf(ul)).toEqual(['2.236', '1.414', '1', '2', '1', '0'])
  })

  it('leaves random alone — a scatter is a scatter in any shape', () => {
    const flat = group(6, '60ms order:random')
    const grid = group(6, '60ms cols:3 order:random')
    indexStaggerGroup(flat)
    indexStaggerGroup(grid)
    expect(ranksOf(grid)).toEqual(ranksOf(flat))
  })

  it('divides a spread budget by the largest distance, so a grid still finishes on time', () => {
    const ul = group(6, 'spread:600ms cols:3')
    indexStaggerGroup(ul)
    expect(stepOf(ul)).toBe('calc((600ms) / 2.236)')
    expect(ul.style.getPropertyValue('--kui-stagger-count')).toBe('3.236')
  })
})

describe('cols:auto', () => {
  it('counts the columns from where the first row wraps', () => {
    const ul = group(6, '60ms cols:auto along:x')
    layOut(ul, 3)
    indexStaggerGroup(ul)
    expect(ranksOf(ul)).toEqual(['0', '1', '2', '0', '1', '2'])
  })

  it('reads a right-to-left row correctly, where left decreases across the row', () => {
    // Requiring `left` to increase would report one column for every RTL grid on the web.
    const ul = group(6, '60ms cols:auto along:x')
    layOut(ul, 3, { rtl: true })
    indexStaggerGroup(ul)
    expect(ranksOf(ul)).toEqual(['0', '1', '2', '0', '1', '2'])
  })

  it('treats a single-column list as one column rather than as a failure', () => {
    const ul = group(4, '60ms cols:auto')
    layOut(ul, 1)
    indexStaggerGroup(ul)
    expect(ranksOf(ul)).toEqual(['0', '1', '2', '3'])
  })

  it('falls back to DOM order and says so when nothing has been laid out', () => {
    // jsdom gives every element a zero rect, which is exactly the `display: none` case.
    const reporter = collectingReporter()
    const ul = group(6, '60ms cols:auto order:center')
    indexStaggerGroup(ul, reporter)
    expect(reporter.messages.join()).toContain('could not measure')
    expect(ranksOf(ul)).toEqual(['2', '1', '0', '0', '1', '2'])
  })
})

describe('the grid keys refuse what they cannot honour', () => {
  it('warns when along: names an axis of a grid that was never declared', () => {
    const reporter = collectingReporter()
    const ul = group(4, '60ms along:x')
    indexStaggerGroup(ul, reporter)
    expect(reporter.messages.join()).toContain('has not declared')
    expect(ranksOf(ul)).toEqual(['0', '1', '2', '3'])
  })

  it('warns when a point origin has no grid to be a point in', () => {
    const reporter = collectingReporter()
    const ul = group(4, '60ms order:0.5/0.5')
    indexStaggerGroup(ul, reporter)
    expect(reporter.messages.join()).toContain('is a point in a grid')
    expect(ranksOf(ul)).toEqual(['0', '1', '2', '3'])
  })

  it('refuses a column count that is not a count, and names it', () => {
    const warnings: string[] = []
    expect(parseStaggerAttribute('60ms cols:wide', warnings).cols).toBeUndefined()
    expect(warnings.join()).toContain('unrecognised "cols:wide"')
  })

  it('refuses zero columns, which would rank every child NaN', () => {
    const warnings: string[] = []
    expect(parseStaggerAttribute('60ms cols:0', warnings).cols).toBeUndefined()
    expect(warnings.join()).toContain('unrecognised "cols:0"')
  })

  it('refuses an axis that is not an axis', () => {
    const warnings: string[] = []
    expect(parseStaggerAttribute('60ms along:diagonal', warnings).along).toBeUndefined()
    expect(warnings.join()).toContain('unrecognised "along:diagonal"')
  })

  it('clamps a point outside the grid to its edge, and names it', () => {
    const warnings: string[] = []
    expect(parseStaggerAttribute('60ms cols:3 order:2/0', warnings).from).toEqual({ x: 1, y: 0 })
    expect(warnings.join()).toContain('outside the grid')
  })

  it('treats axis: and along: as one key, so writing both is a duplicate', () => {
    const warnings: string[] = []
    expect(parseStaggerAttribute('60ms axis:x along:y', warnings).along).toBe('x')
    expect(warnings.join()).toContain('duplicate "along:"')
  })
})

describe('cols:/along: hoisted into data-kui', () => {
  it('parse as element-wide hoists', () => {
    const parsed = parse('fade-up cascade:60ms cols:auto along:y')
    expect(parsed.cols).toBe('auto')
    expect(parsed.along).toBe('y')
  })

  it('stand alone as the whole attribute, the way cascade: and order: do', () => {
    const parsed = parse('cascade:60ms cols:3')
    expect(parsed.cols).toBe('3')
    expect(parsed.warnings).toEqual([])
  })

  it('win over the longhand and name the value they displaced', () => {
    const warnings: string[] = []
    const config = resolveStaggerConfig('60ms cols:2', 'fade-up cols:4', warnings)
    expect(config?.cols).toBe(4)
    expect(warnings.join()).toContain('conflicting stagger columns')
  })

  it('keep the longhand value when the inline one does not parse', () => {
    // A typo in one attribute must not silently discard a working declaration in the other.
    const config = resolveStaggerConfig('60ms cols:2', 'fade-up cols:wide', [])
    expect(config?.cols).toBe(2)
  })
})
