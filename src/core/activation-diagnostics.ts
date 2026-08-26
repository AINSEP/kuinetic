import {
  authorisingActivations,
  isKnownEventType,
  isNamedActivation,
  suggestActivation,
} from './activation-vocabulary.js'
import type { ActivationSpec } from './activation-vocabulary.js'
import type { Reporter } from './reporter.js'
import type { NamedActivation } from './types.js'

/**
 * What the library can still tell an author about an authored activation once the list is open.
 *
 * Separate from `activation-vocabulary.ts` because these checks need an element and that module is
 * deliberately DOM-free; separate from `animator.ts` because they are the diagnostics half of one
 * decision and the animator is already at its line budget. Nothing here changes behaviour — every
 * value that reaches these functions has already been bound.
 */

/** Everything the checks need, grouped so the call site reads as one request. */
export interface ActivationDiagnosticsRequest {
  el: Element
  spec: ActivationSpec
  /** Declared support from the composed primitives; empty means no primitive claimed anything. */
  supported: NamedActivation[]
  reporter: Reporter
}

/**
 * Report every way an authored activation looks like a mistake.
 *
 * @complexity O(s * a) time in the authored halves and the declared list, both single-digit.
 * @overallScore 100
 */
export function warnAboutActivation(request: ActivationDiagnosticsRequest): void {
  warnUnsupported(request)
  warnUnknownEvents(request)
}

/**
 * Warn when an authored activation is not one the composed effects support.
 *
 * Checked per half, because a pair can be half-supported: `enter/leave` on an effect that declares
 * `enter` is fine, `click/pointerleave` on one that declares only `load` is not. Each half is
 * matched through `authorisingActivations` rather than against the declared list directly —
 * `supportedActivations` predates both the exit twins and raw event names, so a literal check would
 * warn about `leave` for every effect in the catalog. See `SUPPORT_PROXIES`.
 *
 * @complexity O(s * a) time; O(1) space.
 * @overallScore 100
 */
function warnUnsupported({ el, spec, supported, reporter }: ActivationDiagnosticsRequest): void {
  if (supported.length === 0) return
  for (const name of spec.names) {
    if (authorisingActivations(name).some((named) => supported.includes(named))) continue
    reporter.warn(
      `activation "${name}" is not supported by this effect (supports: ${supported.join(', ')})`,
      el,
    )
  }
}

/**
 * Warn about an event name nothing will ever dispatch.
 *
 * Opening the activation list traded one failure mode for another. `data-kui-on="clik"` used to
 * warn at parse time because `clik` was not one of six known names; now it is a perfectly legal
 * event type, so it binds a listener that never fires and the author gets nothing at all — silence
 * being the one outcome this library treats as a bug rather than a limitation.
 *
 * So the check moves to where there is an element to ask. Two independent signals have to both fail
 * before anything is said: the library's own list of event names, and whether this document exposes
 * an `on<type>` handler property for it. Either alone produces false alarms — the list cannot
 * enumerate every event, and jsdom (which the unit suite runs in) has no `onpointerenter` or
 * `onfocusin` at all. A name carrying `-`, `:` or `.` is taken as a deliberate custom event and
 * never questioned.
 *
 * Only halves the author wrote as raw event names are probed. A named activation like `hover`
 * expands to event types this library chose, so questioning those would be questioning itself.
 *
 * @complexity O(t) time in the authored halves; O(1) space.
 * @overallScore 100
 */
function warnUnknownEvents({ el, spec, reporter }: ActivationDiagnosticsRequest): void {
  // An environment that exposes no handler properties at all (a plain namespaced `Element`, a
  // partial DOM implementation) would fail the probe for every name including real ones, so the
  // probe has to establish that it works before it is allowed to accuse anything.
  if (!('onclick' in el)) return
  for (const name of spec.names) {
    if (isNamedActivation(name) || isKnownEventType(name) || `on${name}` in el) continue
    const suggestion = suggestActivation(name)
    reporter.warn(
      `no DOM event named "${name}" — data-kui-on binds it anyway, so nothing will start it` +
        (suggestion ? `; did you mean "${suggestion}"?` : ''),
      el,
    )
  }
}
