import type { EffectParams, ParameterSchema, PrepareContext, Preset, Primitive } from '../core/types.js'
import { continuousSetup, deferPrepare } from '../core/instances.js'
import type { SetupResult } from '../core/instances.js'
import { createAttributeLedger, createStyleLedger } from '../core/owned-styles.js'
import { withTimingContract } from '../effects/shared.js'
import { widgetPrimitive } from './shared.js'

/**
 * `compare` — before/after media comparison slider (Phase 3).
 *
 * Stacks two media elements (img, picture, or video) in a grid and lays a full-size
 * native range input over them. Moving the slider adjusts `--kui-compare`, which clips
 * the "after" media element via `clip-path: inset(...)` and translates the visible handle
 * divider on the compositor thread.
 */

const COMPARE_AXES = ['x', 'y'] as const

export const COMPARE_AXIS_ATTR = 'data-kui-compare-axis'

const compareParams: ParameterSchema = {
  position: {
    type: 'percentage',
    default: '50%',
    cssProperty: '--kui-compare',
  },
  axis: {
    type: 'keyword',
    default: 'x',
    cssProperty: '--kui-compare-axis',
    keywords: [...COMPARE_AXES],
  },
}

function getMediaAlt(item: Element | undefined): string {
  if (!item) return ''
  if (item.tagName.toLowerCase() === 'picture') {
    return item.querySelector('img')?.getAttribute('alt') ?? ''
  }
  return item.getAttribute('alt') ?? ''
}

function resolveCompareLabel(el: Element, media: Element[]): string {
  const authored = el.getAttribute('aria-label')
  if (authored) return authored
  const first = media[0]
  const second = media[1]
  if (first && second) {
    return `Compare: ${getMediaAlt(first)} / ${getMediaAlt(second)}`
  }
  return 'Compare'
}

function createCompareElements(doc: Document, label: string, initialPercent: number): {
  range: HTMLInputElement
  handle: HTMLElement
} {
  const range = doc.createElement('input')
  range.type = 'range'
  range.className = 'kui-compare-range'
  range.min = '0'
  range.max = '100'
  range.step = '1'
  range.value = String(initialPercent)
  range.setAttribute('aria-label', label)
  range.setAttribute('aria-valuetext', `${initialPercent}% after`)

  const handle = doc.createElement('span')
  handle.className = 'kui-compare-handle'
  handle.setAttribute('aria-hidden', 'true')

  return { range, handle }
}

function prepareCompare(el: Element, params: EffectParams, ctx: PrepareContext): SetupResult {
  const media = Array.from(el.querySelectorAll(':scope > :is(img, picture, video)'))
  if (media.length < 2) {
    ctx.warn('compare requires at least two media children (img, picture, or video)')
  }

  const attrs = createAttributeLedger(el)
  attrs.set(COMPARE_AXIS_ATTR, params.text('axis', 'x'))

  const initialPercent = Math.round(params.num('position', 0.5) * 100)
  const style = createStyleLedger(el)
  style.set('--kui-compare', params.text('position', '50%'))

  const { range, handle } = createCompareElements(
    el.ownerDocument,
    resolveCompareLabel(el, media),
    initialPercent,
  )

  const onInput = (): void => {
    const val = range.value
    style.set('--kui-compare', `${val}%`)
    range.setAttribute('aria-valuetext', `${val}% after`)
  }
  range.addEventListener('input', onInput)

  el.appendChild(range)
  el.appendChild(handle)

  return continuousSetup(() => {
    range.removeEventListener('input', onInput)
    range.remove()
    handle.remove()
    attrs.restore()
    style.restore()
  })
}

export const COMPARE_PRIMITIVE: Primitive = widgetPrimitive(
  'compare',
  {
    channels: ['clip', 'widget'],
    parameters: compareParams,
    perfClass: 'paint',
  },
  withTimingContract(
    'compare',
    {
      because:
        'it builds an interactive before/after slider; there is no motion to time',
    },
    deferPrepare(prepareCompare),
  ),
)

export const COMPARE_PRESETS: Preset[] = [
  {
    name: 'compare',
    primitive: 'compare',
    requiresOwnSubtree: true,
  },
]
