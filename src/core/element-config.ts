import { validateActivation } from './activation.js'
import { ATTR } from './attrs.js'
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

  const authored = parsed.activation ?? readActivation(attributes.on)
  return {
    activation: authored ?? 'enter',
    activationAuthored: authored !== undefined,
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
 * The longhand attribute, when it holds something bindable.
 *
 * "Bindable" rather than "one of six known names": the activation list is open, so `data-kui-on`
 * accepts any event type and any `start/end` pair. Only text that cannot be an event type at all
 * is dropped — falling back to the default rather than binding something meaningless. This module
 * has no reporter, so the diagnostic for a dropped value comes from `parse.ts` (for the inline
 * `on:` spelling) or `animator.ts` (for an event name no document recognises).
 */
function readActivation(attribute: string | null): Activation | undefined {
  return attribute && validateActivation(attribute).length === 0 ? attribute : undefined
}
