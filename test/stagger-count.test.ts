import { describe, expect, it } from 'vitest'
import { indexStaggerGroup } from '../src/core/stagger.js'
import { ATTR } from '../src/core/attrs.js'

function group(childCount: number, animatedCount = childCount): HTMLElement {
  const ul = document.createElement('ul')
  ul.setAttribute(ATTR.stagger, '90ms')
  for (let i = 0; i < childCount; i++) {
    const li = document.createElement('li')
    if (i < animatedCount) li.setAttribute(ATTR.source, 'fade-up timeline:pin')
    ul.append(li)
  }
  return ul
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
})
