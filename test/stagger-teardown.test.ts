import { describe, expect, it } from 'vitest'
import { ATTR } from '../src/core/attrs.js'
import { applyStagger, releaseStagger, restageAround } from '../src/core/stagger.js'

/**
 * Undoing a stagger index.
 *
 * Split from `stagger-count.test.ts`, which owns what an index *produces* — ranks, the published
 * count, the grammar behind them. Everything here is about the other direction: putting the
 * author's own markup back, and re-indexing as a replacement rather than an overlay.
 */

function tree(html: string): HTMLElement {
  const root = document.createElement('div')
  root.innerHTML = html
  return root
}

const list = (attribute: string, children = 5): HTMLElement =>
  tree(`<ul ${attribute}>${'<li data-kui="fade-up"></li>'.repeat(children)}</ul>`)

const ul = (root: HTMLElement): HTMLElement => root.querySelector('ul')!

/** The `--kui-i` actually stamped on each animated child, in DOM order. */
function ranksOf(group: HTMLElement): string[] {
  return [...group.children]
    .filter((c) => c.hasAttribute(ATTR.source))
    .map((c) => (c as HTMLElement).style.getPropertyValue('--kui-i'))
}

/**
 * Indexing as an owned write rather than a permanent one.
 *
 * `--kui-i`, `--kui-stagger` and `--kui-stagger-count` used to go straight onto `element.style`,
 * so nothing could take them off again: destroying the animator left every one of them on the
 * page, an author's own `--kui-i` was overwritten with no record it had existed, and a re-index
 * could only ever add to what the last one wrote.
 */
describe('indexStaggerGroup — what an index can be undone back to', () => {
  it('gives an author their own --kui-i back', () => {
    const root = tree(
      `<ul data-kui-stagger="90ms"><li data-kui="fade-up" style="--kui-i: 7"></li></ul>`,
    )
    const child = root.querySelector('li') as HTMLElement

    applyStagger(root)
    expect(child.style.getPropertyValue('--kui-i')).toBe('0')

    releaseStagger(root)
    expect(child.style.getPropertyValue('--kui-i')).toBe('7')
  })

  it('leaves a child that had no inline style with no inline style', () => {
    const root = list('data-kui-stagger="90ms"')
    applyStagger(root)
    releaseStagger(root)
    for (const child of root.querySelectorAll('li')) {
      expect(child.getAttribute('style')).toBeNull()
    }
  })

  it('takes the group’s published properties off the host again', () => {
    const root = list('data-kui-stagger="90ms"')
    applyStagger(root)
    expect(ul(root).style.getPropertyValue('--kui-stagger-count')).toBe('5')

    releaseStagger(root)
    expect(ul(root).style.getPropertyValue('--kui-stagger')).toBe('')
    expect(ul(root).style.getPropertyValue('--kui-stagger-count')).toBe('')
  })

  // Three different edits, because a re-index that merely overwrote every property it writes would
  // pass the first two: what has to hold is that a property the *new* config does not write is
  // gone, not that the ones it does write are current.
  const rewrites: Array<{ label: string; before: string; after: string; step: string }> = [
    { label: 'a step replaced by an ordering', before: '100ms from:start', after: 'from:center', step: '' },
    { label: 'a spread replaced by an ordering', before: 'spread:600ms', after: 'from:end', step: '' },
    {
      label: 'a fixed step replaced by a spread',
      before: '100ms from:start',
      after: 'spread:600ms from:center',
      step: 'calc((600ms) / 2)',
    },
  ]

  for (const { label, before, after, step } of rewrites) {
    it(`re-indexes on ${label}, rather than overlaying the old one`, () => {
      const root = list(`data-kui-stagger="${before}"`)
      applyStagger(root)
      expect(ul(root).style.getPropertyValue('--kui-stagger')).not.toBe('')

      ul(root).setAttribute(ATTR.stagger, after)
      restageAround(ul(root))
      expect(ul(root).style.getPropertyValue('--kui-stagger')).toBe(step)
    })
  }

  it('re-ranks every child, not only the host’s published step', () => {
    const root = list('data-kui-stagger="100ms from:start"')
    applyStagger(root)
    expect(ranksOf(ul(root))).toEqual(['0', '1', '2', '3', '4'])

    ul(root).setAttribute(ATTR.stagger, 'spread:600ms from:center')
    restageAround(ul(root))
    expect(ranksOf(ul(root))).toEqual(['2', '1', '0', '1', '2'])
    expect(ul(root).style.getPropertyValue('--kui-stagger-count')).toBe('3')
  })

  it('unwinds a group that stops declaring one inside data-kui', () => {
    const root = list('data-kui="fade-up cascade:90ms"')
    applyStagger(root)
    expect(ul(root).style.getPropertyValue('--kui-stagger')).toBe('90ms')

    ul(root).setAttribute(ATTR.source, 'fade-up')
    applyStagger(root)
    expect(ul(root).style.getPropertyValue('--kui-stagger')).toBe('')
    expect(ul(root).style.getPropertyValue('--kui-stagger-count')).toBe('')
    expect(ranksOf(ul(root))).toEqual(['', '', '', '', ''])
  })

  it('unwinds a group whose longhand attribute is removed outright', () => {
    // This one no longer matches `applyStagger`'s selector at all, so only the attribute-change
    // path can reach it — which is exactly the path `data-kui-stagger` was missing from the
    // mutation filter for.
    const root = list('data-kui-stagger="90ms"')
    applyStagger(root)

    ul(root).removeAttribute(ATTR.stagger)
    restageAround(ul(root))
    expect(ul(root).getAttribute('style')).toBeNull()
    expect(ranksOf(ul(root))).toEqual(['', '', '', '', ''])
  })

  it('re-ranks the parent group when a child gains or loses its effect', () => {
    // A child is a *member* of its parent's group, and membership is exactly "carries data-kui".
    const root = list('data-kui-stagger="90ms"', 3)
    applyStagger(root)
    expect(ul(root).style.getPropertyValue('--kui-stagger-count')).toBe('3')

    const last = ul(root).lastElementChild!
    last.removeAttribute(ATTR.source)
    restageAround(last)
    expect(ul(root).style.getPropertyValue('--kui-stagger-count')).toBe('2')
  })
})
