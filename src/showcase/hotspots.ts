import type { EffectParams, ParameterSchema, PrepareContext, Preset, Primitive } from '../core/types.js'
import { continuousSetup, deferPrepare } from '../core/instances.js'
import type { SetupResult } from '../core/instances.js'
import { createAttributeLedger, createStyleLedger } from '../core/owned-styles.js'
import { queryScoped, resolveTarget, SCOPE_PARAM, scopeParam } from '../core/target.js'
import { withTimingContract } from '../effects/shared.js'
import { widgetPrimitive } from './shared.js'

/**
 * `hotspots` — image hotspots with native popover notes (Phase 3).
 *
 * Places interactive marker buttons over an image using author-provided `--kui-x` and `--kui-y`
 * custom properties. Each marker opens its corresponding note via native `popover="auto"` and
 * `popovertarget`. Uses CSS anchor positioning where supported (`position-area: top`), with
 * JS fallback on `toggle` events.
 */

const HOTSPOT_MARKERS = ['number', 'dot'] as const

const hotspotsParams: ParameterSchema = {
  target: {
    type: 'text',
    default: '',
    cssProperty: '--kui-target',
  },
  marker: {
    type: 'keyword',
    default: 'number',
    keywords: [...HOTSPOT_MARKERS],
    cssProperty: '--kui-hotspot-marker',
  },
  scope: SCOPE_PARAM,
}

let hotspotIdCounter = 0
let anchorCounter = 0

/**
 * A numbered marker shows "1", so its accessible name must contain "1" (WCAG 2.5.3 label in name):
 * "1: Live filters". The "Note n" fallback already carries the number.
 */
function resolveNoteLabel(note: Element, index: number, marker: string): string {
  const heading = note.querySelector('strong, h1, h2, h3, h4, h5, h6')
  const text = heading?.textContent?.trim()
  if (!text) return `Note ${index + 1}`
  return marker === 'number' ? `${index + 1}: ${text}` : text
}

function isPopoverOpen(note: HTMLElement, event: Event): boolean {
  const toggleEvent = event as { newState?: string }
  if (toggleEvent.newState !== undefined) {
    return toggleEvent.newState === 'open'
  }
  try {
    return note.matches(':popover-open') || note.hasAttribute('open')
  } catch {
    return note.hasAttribute('open')
  }
}

function setupFallbackPositioning(
  button: HTMLElement,
  note: HTMLElement,
  noteStyle: ReturnType<typeof createStyleLedger>,
): () => void {
  const viewport = note.ownerDocument.defaultView ?? window
  const gap = 8
  const clamp = (value: number, size: number, limit: number): number =>
    Math.max(gap, Math.min(value, Math.max(gap, limit - size - gap)))
  const onToggle = (event: Event): void => {
    if (!isPopoverOpen(note, event)) return
    const buttonRect = button.getBoundingClientRect()
    const noteRect = note.getBoundingClientRect()
    const above = buttonRect.top - noteRect.height - gap
    const top = above >= gap ? above : buttonRect.bottom + gap
    const center = buttonRect.left + buttonRect.width / 2
    const left = center - noteRect.width / 2
    noteStyle.set('position', 'fixed')
    noteStyle.set('inset', 'auto')
    noteStyle.set('top', `${clamp(top, noteRect.height, viewport.innerHeight)}px`)
    noteStyle.set('left', `${clamp(left, noteRect.width, viewport.innerWidth)}px`)
    noteStyle.set('translate', '0 0')
    noteStyle.set('margin', '0')
  }
  note.addEventListener('toggle', onToggle)
  return () => note.removeEventListener('toggle', onToggle)
}

function setupAnchorPositioning(
  buttonStyle: ReturnType<typeof createStyleLedger>,
  noteStyle: ReturnType<typeof createStyleLedger>,
): void {
  // Always generated: an authored id such as "a.b" or "step 1" is not a valid <dashed-ident>.
  const anchorName = `--kui-anchor-${++anchorCounter}`
  buttonStyle.set('anchor-name', anchorName)
  noteStyle.set('position-anchor', anchorName)
  noteStyle.set('position-area', 'top')
  noteStyle.set('position-try-fallbacks', 'flip-block')
}

function supportsAnchorPositioning(): boolean {
  return (
    typeof CSS !== 'undefined' &&
    typeof CSS.supports === 'function' &&
    CSS.supports('position-area: top')
  )
}

function readCoordinates(note: Element, win: Window): { x: string; y: string } {
  const computed = win.getComputedStyle(note)
  const style = (note as HTMLElement).style
  const computedX = computed.getPropertyValue('--kui-x').trim()
  const computedY = computed.getPropertyValue('--kui-y').trim()
  const x = computedX ? computedX : style.getPropertyValue('--kui-x').trim()
  const y = computedY ? computedY : style.getPropertyValue('--kui-y').trim()
  return { x, y }
}

function setupNotePopover(note: Element): {
  noteId: string
  noteAttrs: ReturnType<typeof createAttributeLedger>
} {
  const existingId = note.getAttribute('id')
  const noteId = existingId ? existingId : `kui-hotspot-note-${++hotspotIdCounter}`
  const noteAttrs = createAttributeLedger(note)
  if (!existingId) {
    noteAttrs.set('id', noteId)
  }
  noteAttrs.set('popover', 'auto')
  return { noteId, noteAttrs }
}

interface ButtonConfig {
  doc: Document
  noteId: string
  label: string
  marker: string
  index: number
  coords: { x: string; y: string }
}

function createHotspotButton(config: ButtonConfig): {
  button: HTMLButtonElement
  buttonStyle: ReturnType<typeof createStyleLedger>
} {
  const { doc, noteId, label, marker, index, coords } = config
  const button = doc.createElement('button')
  button.type = 'button'
  button.className = 'kui-hotspot'
  button.setAttribute('aria-label', label)
  button.setAttribute('popovertarget', noteId)
  if (marker === 'number') {
    button.textContent = String(index + 1)
  }

  const buttonStyle = createStyleLedger(button)
  if (coords.x) buttonStyle.set('--kui-x', coords.x)
  if (coords.y) buttonStyle.set('--kui-y', coords.y)
  return { button, buttonStyle }
}

interface NoteOptions {
  el: Element
  marker: string
  ctx: PrepareContext
}

function setupSingleNote(
  note: Element,
  index: number,
  options: NoteOptions,
): {
  button: HTMLButtonElement
  teardown(): void
} {
  const { el, marker, ctx } = options
  const win = ctx.doc.defaultView ?? window
  const coords = readCoordinates(note, win)
  if (!coords.x || !coords.y) {
    ctx.warn('hotspots note is missing --kui-x or --kui-y position')
  }

  const { noteId, noteAttrs } = setupNotePopover(note)
  const label = resolveNoteLabel(note, index, marker)
  const { button, buttonStyle } = createHotspotButton({
    doc: el.ownerDocument,
    noteId,
    label,
    marker,
    index,
    coords,
  })

  const noteStyle = createStyleLedger(note)
  let cleanupToggle: (() => void) | undefined
  if (supportsAnchorPositioning()) {
    setupAnchorPositioning(buttonStyle, noteStyle)
  } else {
    cleanupToggle = setupFallbackPositioning(button, note as HTMLElement, noteStyle)
  }

  return {
    button,
    teardown: () => {
      cleanupToggle?.()
      noteStyle.restore()
      noteAttrs.restore()
      buttonStyle.restore()
      button.remove()
    },
  }
}

function prepareHotspots(el: Element, params: EffectParams, ctx: PrepareContext): SetupResult {
  const targetAuthored = params.text('target')
  const targetSelector = targetAuthored || ':scope > :is(ol, ul) > li'
  const selector = resolveTarget(targetSelector, ctx, 'hotspots')
  const scope = scopeParam(params, 'self')
  const notes = selector ? queryScoped(el, ctx, selector, scope) : []

  const marker = params.text('marker', 'number')
  const hostAttrs = createAttributeLedger(el)
  hostAttrs.set('data-kui-hotspot-marker', marker)

  const hotspots = notes.map((note, index) =>
    setupSingleNote(note, index, { el, marker, ctx }),
  )

  for (const hotspot of hotspots) {
    el.appendChild(hotspot.button)
  }

  return continuousSetup(() => {
    for (const hotspot of hotspots) {
      hotspot.teardown()
    }
    hostAttrs.restore()
  })
}

export const HOTSPOTS_PRIMITIVE: Primitive = widgetPrimitive(
  'hotspots',
  {
    channels: ['widget'],
    parameters: hotspotsParams,
    perfClass: 'layout',
  },
  withTimingContract(
    'hotspots',
    {
      because:
        'it places interactive hotspot markers and binds popovers; there is no motion to time',
    },
    deferPrepare(prepareHotspots),
  ),
)

export const HOTSPOTS_PRESETS: Preset[] = [
  {
    name: 'hotspots',
    primitive: 'hotspots',
    // The primitive's `target` selects notes, so the compiler does not use this flag to reject
    // `target:`. The flag still records that this CSS reaches from the host into descendants.
    requiresOwnSubtree: true,
  },
]
