import { describe, expect, it } from 'vitest'
import { indexStaggerGroup, parseStaggerAttribute, staggerRanks } from '../src/core/stagger.js'
import { collectingReporter } from '../src/core/reporter.js'
import { ATTR } from '../src/core/attrs.js'

function group(childCount: number, animatedCount = childCount, stagger = '90ms'): HTMLElement {
  const ul = document.createElement('ul')
  ul.setAttribute(ATTR.stagger, stagger)
  for (let i = 0; i < childCount; i++) {
    const li = document.createElement('li')
    if (i < animatedCount) li.setAttribute(ATTR.source, 'fade-up timeline:pin')
    ul.append(li)
  }
  return ul
}

/** The `--kui-i` actually stamped on each animated child, in DOM order. */
function ranksOf(ul: HTMLElement): string[] {
  return [...ul.children]
    .filter((c) => c.hasAttribute(ATTR.source))
    .map((c) => (c as HTMLElement).style.getPropertyValue('--kui-i'))
}

describe('indexStaggerGroup — --kui-stagger-count', () => {
  it('publishes the number of animated children on the group', () => {
    const ul = group(6)
    indexStaggerGroup(ul)
    expect(ul.style.getPropertyValue('--kui-stagger-count')).toBe('6')
  })

  it('counts only children that actually carry an effect', () => {
    // Plain <li>s between animated ones must not widen the scrub head; nothing animates on them.
    const ul = group(6, 4)
    indexStaggerGroup(ul)
    expect(ul.style.getPropertyValue('--kui-stagger-count')).toBe('4')
  })

  it('never publishes 0, which would make the scrub head shorter than one duration', () => {
    // `duration + (count - 1) * stagger` with count 0 subtracts a stagger step from the head, so
    // an empty or unmarked group would seek past the final frame before progress reached 1.
    const ul = group(3, 0)
    indexStaggerGroup(ul)
    expect(ul.style.getPropertyValue('--kui-stagger-count')).toBe('1')
  })

  it('still indexes each animated child', () => {
    const ul = group(3)
    indexStaggerGroup(ul)
    const indices = [...ul.children].map((c) => (c as HTMLElement).style.getPropertyValue('--kui-i'))
    expect(indices).toEqual(['0', '1', '2'])
  })

  /*
   * The property's meaning is "how many stagger beats", not "how many children". They coincided
   * while the only ordering was linear. `compile.ts` spends it as `(count - 1) * stagger` to widen
   * a `timeline: pin` scrub head to the group's whole span, so publishing the child count under an
   * ordering that tops out lower stretches the head past the real span and leaves dead scroll after
   * the last child has landed.
   */
  it('publishes the largest rank + 1, not the child count, under a non-linear ordering', () => {
    const ul = group(6, 6, '90ms from:center')
    indexStaggerGroup(ul)
    // Ranks 2,1,0,0,1,2 — three beats, not six.
    expect(ul.style.getPropertyValue('--kui-stagger-count')).toBe('3')
  })

  it('is unchanged for edges, which tops out at the same beat as center', () => {
    const ul = group(6, 6, '90ms from:edges')
    indexStaggerGroup(ul)
    expect(ul.style.getPropertyValue('--kui-stagger-count')).toBe('3')
  })

  it('stays the child count for random, which is a permutation', () => {
    const ul = group(6, 6, '90ms from:random')
    indexStaggerGroup(ul)
    expect(ul.style.getPropertyValue('--kui-stagger-count')).toBe('6')
  })

  it('follows a numeric origin, whose span is the longer of the two sides', () => {
    // `from:1` on five children ranks them 1,0,1,2,3 — four beats.
    const ul = group(5, 5, '90ms from:1')
    indexStaggerGroup(ul)
    expect(ul.style.getPropertyValue('--kui-stagger-count')).toBe('4')
  })
})

describe('indexStaggerGroup — from: ordering', () => {
  it('leaves a bare time step behaving exactly as before', () => {
    const ul = group(4)
    indexStaggerGroup(ul)
    expect(ul.style.getPropertyValue('--kui-stagger')).toBe('90ms')
    expect(ranksOf(ul)).toEqual(['0', '1', '2', '3'])
  })

  it('reads the step and the ordering off the one attribute', () => {
    const ul = group(4, 4, '90ms from:end')
    indexStaggerGroup(ul)
    expect(ul.style.getPropertyValue('--kui-stagger')).toBe('90ms')
    expect(ranksOf(ul)).toEqual(['3', '2', '1', '0'])
  })

  it('accepts an ordering with no step at all, leaving --kui-stagger to CSS', () => {
    const ul = group(3, 3, 'from:end')
    indexStaggerGroup(ul)
    expect(ul.style.getPropertyValue('--kui-stagger')).toBe('')
    expect(ranksOf(ul)).toEqual(['2', '1', '0'])
  })

  /*
   * `calc(90ms * 2)` has two top-level spaces. A plain `.split(' ')` would read it as three tokens
   * and write `calc(90ms` into `--kui-stagger`, killing a value that worked before ordering existed
   * — the attribute has always been passed through verbatim.
   */
  it('keeps a parenthesised step whole', () => {
    const ul = group(2, 2, 'calc(90ms * 2) from:end')
    indexStaggerGroup(ul)
    expect(ul.style.getPropertyValue('--kui-stagger')).toBe('calc(90ms * 2)')
    expect(ranksOf(ul)).toEqual(['1', '0'])
  })

  it('ranks a numeric origin by distance from that child', () => {
    const ul = group(5, 5, '90ms from:2')
    indexStaggerGroup(ul)
    expect(ranksOf(ul)).toEqual(['2', '1', '0', '1', '2'])
  })

  it('ranks only the animated children, ignoring plain siblings between them', () => {
    const ul = group(5, 3, '90ms from:end')
    indexStaggerGroup(ul)
    // Three animated children out of five: their ranks run over the group of three, not of five.
    expect(ranksOf(ul)).toEqual(['2', '1', '0'])
  })

  it('never stamps a negative index, which would seek an entrance instead of delaying it', () => {
    for (const from of ['start', 'end', 'center', 'edges', 'random', '0', '4', '-9', '99']) {
      const ul = group(5, 5, `90ms from:${from}`)
      indexStaggerGroup(ul)
      for (const rank of ranksOf(ul)) expect(Number(rank)).toBeGreaterThanOrEqual(0)
    }
  })

  it('reports a malformed attribute through the reporter the animator threads in', () => {
    const reporter = collectingReporter()
    const ul = group(3, 3, '90ms from:sideways')
    indexStaggerGroup(ul, reporter)
    expect(reporter.messages).toHaveLength(1)
    expect(reporter.messages[0]).toContain('from:sideways')
    // Falls back to the default ordering rather than dropping the stagger.
    expect(ranksOf(ul)).toEqual(['0', '1', '2'])
  })

  it('warns and clamps an index past the end of the group', () => {
    const reporter = collectingReporter()
    const ul = group(3, 3, '90ms from:99')
    indexStaggerGroup(ul, reporter)
    expect(reporter.messages[0]).toContain('outside the group')
    // Clamped to the last child, i.e. `from:end` — not 99, 98, 97, which is 8.5s of nothing first.
    expect(ranksOf(ul)).toEqual(['2', '1', '0'])
  })

  it('clamps a negative index to the first child rather than counting back from the end', () => {
    const reporter = collectingReporter()
    const ul = group(3, 3, '90ms from:-2')
    indexStaggerGroup(ul, reporter)
    expect(reporter.messages[0]).toContain('outside the group')
    expect(ranksOf(ul)).toEqual(['0', '1', '2'])
  })
})

describe('staggerRanks', () => {
  it('is linear by default, so every group written before ordering existed is unaffected', () => {
    expect(staggerRanks(5, 'start')).toEqual([0, 1, 2, 3, 4])
  })

  it('reverses for end', () => {
    expect(staggerRanks(5, 'end')).toEqual([4, 3, 2, 1, 0])
  })

  it('blooms outward from the middle child of an odd group', () => {
    expect(staggerRanks(5, 'center')).toEqual([2, 1, 0, 1, 2])
  })

  /*
   * An even group has no single middle, so the origin sits on a half index and the raw distances
   * are 1.5, 0.5, 0.5, 1.5. Flooring pulls the pair in the middle onto beat 0. Without it every
   * child would sit half a step late and nothing in the group would start at t=0 — a visible dead
   * half-beat in front of every even-sized grid.
   */
  it('starts an even group on beat 0, from its two middle children', () => {
    expect(staggerRanks(6, 'center')).toEqual([2, 1, 0, 0, 1, 2])
    expect(staggerRanks(4, 'center')).toEqual([1, 0, 0, 1])
  })

  it('closes inward from both ends for edges', () => {
    expect(staggerRanks(5, 'edges')).toEqual([0, 1, 2, 1, 0])
    expect(staggerRanks(6, 'edges')).toEqual([0, 1, 2, 2, 1, 0])
  })

  it('measures distance from a numeric origin', () => {
    expect(staggerRanks(5, 3)).toEqual([3, 2, 1, 0, 1])
  })

  it('treats from:0 as start and from:<last> as end, so clamping lands on a real keyword', () => {
    expect(staggerRanks(4, 0)).toEqual(staggerRanks(4, 'start'))
    expect(staggerRanks(4, 3)).toEqual(staggerRanks(4, 'end'))
  })

  it('handles a group of one and a group of none without producing a rank', () => {
    expect(staggerRanks(1, 'center')).toEqual([0])
    expect(staggerRanks(0, 'random')).toEqual([])
  })

  /*
   * `random` is a permutation, not a scatter. `slatOrder`'s `random-ish` in
   * `effects/catalog/media-shared.ts` is `floor(frac(i·phi) * n)`, which collides for almost every
   * `n` — invisible on image slats, but here a collision is two cards moving as a pair, which reads
   * as a grid that failed to randomise. A permutation also keeps the largest rank at `count - 1`,
   * so `--kui-stagger-count` stays the child count for this ordering.
   */
  it('produces every rank exactly once for random', () => {
    for (const count of [2, 3, 5, 8, 13, 40]) {
      const ranks = staggerRanks(count, 'random')
      expect([...ranks].sort((a, b) => a - b)).toEqual([...Array(count).keys()])
    }
  })

  it('does not simply return DOM order for random', () => {
    // A "shuffle" that is the identity is the failure mode a determinism requirement invites.
    expect(staggerRanks(12, 'random')).not.toEqual([...Array(12).keys()])
  })

  /*
   * The whole design constraint. `applyStagger` re-runs on re-activation, on a subtree scan after a
   * DOM mutation, and on every page load; a fresh shuffle on each would reorder a list mid-
   * interaction and make the order in a bug report unreproducible. There is no seed anywhere in
   * the implementation for exactly this reason — the rank is a pure function of (index, count).
   */
  it('scatters identically every time it is asked, on a fresh group and a re-indexed one', () => {
    const first = staggerRanks(9, 'random')
    expect(staggerRanks(9, 'random')).toEqual(first)

    const ul = group(9, 9, '90ms from:random')
    indexStaggerGroup(ul)
    const stamped = ranksOf(ul)
    indexStaggerGroup(ul)
    expect(ranksOf(ul)).toEqual(stamped)
    expect(stamped).toEqual(first.map(String))
  })

  it('gives groups of different sizes unrelated orders rather than a shared prefix', () => {
    // `count` is mixed into the hash so a group of 10 is not a group of 5 with a tail.
    expect(staggerRanks(10, 'random').slice(0, 5)).not.toEqual(staggerRanks(5, 'random'))
  })
})

describe('parseStaggerAttribute', () => {
  it('reads a bare step, the shape every group in the repo uses today', () => {
    expect(parseStaggerAttribute('90ms')).toEqual({ step: '90ms', from: 'start' })
  })

  it('reads an empty attribute as no step and the default ordering', () => {
    expect(parseStaggerAttribute('')).toEqual({ from: 'start' })
  })

  it('reads step and ordering together, in that order', () => {
    expect(parseStaggerAttribute('120ms from:edges')).toEqual({ step: '120ms', from: 'edges' })
  })

  it('accepts the ordering before the step, since only the step is positional', () => {
    expect(parseStaggerAttribute('from:edges 120ms')).toEqual({ step: '120ms', from: 'edges' })
  })

  it('reads a numeric origin as a number, not a string', () => {
    expect(parseStaggerAttribute('90ms from:2').from).toBe(2)
  })

  it('refuses a fractional index rather than silently rounding it', () => {
    const warnings: string[] = []
    expect(parseStaggerAttribute('90ms from:2.5', warnings).from).toBe('start')
    expect(warnings[0]).toContain('from:2.5')
  })

  /*
   * `Number('9'.repeat(400))` is `Infinity`, and `String(Infinity)` in `--kui-i` is a keyword the
   * downstream `calc()` cannot use — the declaration drops and the group loses its stagger with
   * nothing to say why. The digit bound rejects it at the door.
   */
  it('refuses an index too long to be a real one', () => {
    const warnings: string[] = []
    expect(parseStaggerAttribute(`from:${'9'.repeat(400)}`, warnings).from).toBe('start')
    expect(warnings).toHaveLength(1)
  })

  it('warns on a key it does not know instead of writing it into --kui-stagger', () => {
    const warnings: string[] = []
    const config = parseStaggerAttribute('90ms form:center', warnings)
    expect(config.step).toBe('90ms')
    expect(warnings[0]).toContain('form')
  })

  it('warns on a second bare token, which used to poison the whole declaration', () => {
    const warnings: string[] = []
    expect(parseStaggerAttribute('90ms 40ms', warnings).step).toBe('90ms')
    expect(warnings[0]).toContain('extra token')
  })

  it('keeps the first of two orderings, so which mistake you get does not depend on token order', () => {
    const warnings: string[] = []
    expect(parseStaggerAttribute('from:end from:center', warnings).from).toBe('end')
    expect(warnings[0]).toContain('duplicate')
  })

  it('accepts every ordering keyword', () => {
    for (const from of ['start', 'end', 'center', 'edges', 'random']) {
      expect(parseStaggerAttribute(`from:${from}`).from).toBe(from)
    }
  })
})
