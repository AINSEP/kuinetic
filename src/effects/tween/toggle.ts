import type { PrepareContext } from '../../core/effect-context.js'
import type { Cleanup } from '../../core/types.js'
import { TWEEN_PROPERTIES } from './properties.js'
import type { TweenGroup } from './properties.js'

export function toggleProperty(group: TweenGroup): string {
  return group === 'background' ? 'background-color' : group
}

/** Build the same grouped destination as tween.css; O(p) time and space. */
function destination(group: TweenGroup): string {
  const value = (key: string): string => `var(--kui-tween-${key}, ${TWEEN_PROPERTIES[key]!.spec.default})`
  if (group === 'translate') return ['x', 'y', 'z'].map(value).join(' ')
  if (group === 'scale') return ['scale-x', 'scale-y'].map((key) => `var(--kui-tween-${key}, ${value('scale')})`).join(' ')
  if (group === 'filter') return Object.entries(TWEEN_PROPERTIES).filter(([, p]) => p.group === group)
    .map(([key]) => `${key}(${value(key)})`).join(' ')
  return value(toggleProperty(group))
}

/** Clicks write opted-in destinations or release to the current stylesheet; no style reads. */
export function prepareToggle(el: Element, groups: readonly TweenGroup[], ctx: PrepareContext): Cleanup {
  const states = groups.map((group) => {
    const property = toggleProperty(group)
    return { property, to: destination(group) }
  })
  let on = false
  const toggle = (): void => {
    on = !on
    for (const state of states) ctx.style.set(state.property, on ? state.to : ctx.style.peek(state.property)!)
  }
  el.addEventListener('click', toggle)
  return () => el.removeEventListener('click', toggle)
}
