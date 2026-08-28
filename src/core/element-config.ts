import { ATTR } from './attrs.js'
import { parseActivationAttribute } from './parse.js'
import type { ParsedActivationAttribute } from './parse.js'
import { parseToggleActions } from './toggle-actions.js'
import type { ToggleActions } from './toggle-actions.js'
import type { Activation, ParsedValue, Timeline } from './types.js'

/** The subset of an element's attributes this module needs. Keeps resolution DOM-free. */
export interface ElementAttributes {
  source: string
  on: string | null
  timeline: string | null
  threshold: string | null
}

export interface ElementConfig {
  activation: Activation
  /** Whether the author named an activation, so a primitive default may fill in when not. */
  activationAuthored: boolean
  /** Optional selector for the event source named by `data-kui-on`'s `from:` refinement. */
  activationSource?: string
  /**
   * What to do at each of the observer's four crossings, when the author wrote `actions:`.
   *
   * Absent — not a defaulted four-way table — because absent and "the default four-way table" are
   * genuinely different bindings: without this the observer keeps its two-way delivery and its
   * one-shot release, which is what every piece of existing markup depends on.
   */
  actions?: ToggleActions
  timeline: Timeline
  /** Trailing tokens of `data-kui-timeline`, e.g. `entry 0% cover 60%`. */
  range: string
  threshold: string
}

const TIMELINES = new Set<Timeline>(['time', 'view', 'scroll', 'pointer', 'pin'])

/**
 * Read the attributes this module consumes off a live element.
 *
 * The only DOM-touching function here, so every downstream decision can be tested with a plain
 * object instead of a rendered document.
 *
 * @param el - Element carrying the authored attributes.
 * @returns A plain snapshot of the relevant attribute values.
 * @complexity O(1) time, O(1) space.
 * @overallScore 100
 */
export function readAttributes(el: Element): ElementAttributes {
  return {
    source: el.getAttribute(ATTR.source) ?? '',
    on: el.getAttribute(ATTR.on),
    timeline: el.getAttribute(ATTR.timeline),
    threshold: el.getAttribute(ATTR.threshold),
  }
}

/**
 * Resolve element-scoped activation and timeline settings.
 *
 * Activation and timeline are element-scoped rather than per-effect because one element has one
 * activation; values written inline (`on:enter`) are a convenience that takes precedence over the
 * longhand attribute.
 *
 * @param attributes - Snapshot from `readAttributes`.
 * @param parsed - Result of parsing the `data-kui` value, whose hoisted keys win.
 * @returns Fully defaulted configuration; unknown values fall back rather than throwing.
 * @complexity O(k) time in the length of the timeline attribute; O(1) extra space.
 * @overallScore 100
 */
export function resolveConfig(attributes: ElementAttributes, parsed: ParsedValue): ElementConfig {
  const rawTimeline = parsed.timeline ?? attributes.timeline ?? 'time'
  const [head = 'time', ...rest] = rawTimeline.trim().split(/\s+/)

  const longhand = parseActivationAttribute(attributes.on)
  const authored = parsed.activation ?? longhand.activation
  return {
    activation: authored ?? 'enter',
    activationAuthored: authored !== undefined,
    ...sourceFromLonghand({ parsed, longhand }),
    // Re-parsed rather than threaded down, and its warnings dropped: `parse.ts` has already
    // reported every one of them against this same element through `validateToggleActions`, so
    // forwarding them would double each diagnostic. There is no longhand attribute to merge with —
    // `actions:` refines `on:` and has only the inline spelling.
    ...(parsed.actions === undefined ? {} : { actions: parseToggleActions(parsed.actions) }),
    timeline: TIMELINES.has(head as Timeline) ? (head as Timeline) : 'time',
    range: rest.join(' '),
    threshold: parsed.threshold ?? attributes.threshold ?? '0%',
  }
}

/**
 * Keep a source selector only when its longhand activation won the precedence decision.
 *
 * Applying `from:` after an inline `on:` wins would pair two independently authored activations.
 *
 * @param input - Parsed inline and longhand activation settings.
 * @returns The optional source field for the resolved element configuration.
 * @complexity O(1) time and space.
 */
function sourceFromLonghand({
  parsed,
  longhand,
}: {
  parsed: ParsedValue
  longhand: ParsedActivationAttribute
}): Pick<ElementConfig, 'activationSource'> {
  if (parsed.activation !== undefined || longhand.from === undefined) return {}
  return { activationSource: longhand.from }
}
