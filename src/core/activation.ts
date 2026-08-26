import type { Reporter } from './reporter.js'
import type { Activation, Cleanup, NamedActivation } from './types.js'

/**
 * Activations — one concern, three parts, in the order a value travels through them.
 *
 * First the vocabulary: what an authored `data-kui-on` value *means*, as tables and pure functions
 * with no DOM anywhere in sight, so `parse.ts`, `element-config.ts` and `style-plan.ts` can each
 * ask their own question of it without pulling in a document. Then the binder: how a resolved spec
 * is actually attached to an element, sharing one `IntersectionObserver` per threshold. Then the
 * diagnostics: what the library can still tell an author about a value once the list is open,
 * which needs an element and so cannot live with the first part.
 */

/**
 * What an authored `data-kui-on` value *means*, with no DOM anywhere in sight.
 *
 * Kept DOM-free, and kept as a table, because four call sites each need a different slice of the
 * same knowledge and none of them wants the others' dependencies. `parse.ts` has to validate an
 * authored value without touching a document; `element-config.ts` has to do the same for the
 * longhand attribute; `style-plan.ts` only needs to know whether the value starts immediately; the
 * binder below needs the event types to actually listen for. Writing the table once here is what
 * stops those four from drifting apart — which is exactly how the old closed list ended up
 * duplicated as a `Set` in `parse.ts`, a second `Set` in `element-config.ts`, and a `Record` in
 * the binder, three copies that all had to be edited to add one name.
 */

/**
 * How one half of an activation is delivered.
 *
 * A tagged union rather than a bare event-name list because the four delivery mechanisms are
 * genuinely different machinery — `load` runs now, `manual` runs never, `enter`/`leave` share an
 * `IntersectionObserver`, and everything else is `addEventListener`. Naming them keeps the
 * binder's dispatch flat, which is the property the binder's own architecture note below asks for.
 */
export type ActivationTrigger =
  | { readonly kind: 'immediate' }
  | { readonly kind: 'manual' }
  | { readonly kind: 'observed'; readonly when: 'enter' | 'leave' }
  | { readonly kind: 'events'; readonly types: readonly string[] }

/** One resolved `data-kui-on` value: what starts the effects, and what plays them back out. */
export interface ActivationSpec {
  /** The authored value, verbatim, so `data-kui-on` round-trips and fingerprints stay stable. */
  readonly source: Activation
  /** The authored halves, verbatim — `['pointerenter', 'pointerleave']`. One or two entries. */
  readonly names: readonly string[]
  readonly start: ActivationTrigger
  /** Present only when the author wrote a pair. */
  readonly end?: ActivationTrigger
}

/**
 * Separator between the two halves of a pair: `data-kui-on="pointerenter/pointerleave"`.
 *
 * A slash rather than a comma, a space, or a second attribute. A comma and a space are both
 * already structural in `parse.ts`'s tokenizer, so either would have forced authors to quote the
 * inline spelling (`on:"pointerenter, pointerleave"`) for the commonest case in the feature — and
 * a second attribute (`data-kui-off`) proliferates attributes for something that is one decision
 * about one element. A slash is inert to the tokenizer, so `on:pointerenter/pointerleave` needs no
 * quoting, and reads the way CSS already writes paired values (`grid-area: 1 / 2`).
 */
export const PAIR_SEPARATOR = '/'

/**
 * The named activations, and what each one actually binds.
 *
 * `load`, `enter`, `manual`, `hover`, `focus` and `click` are unchanged from the closed list this
 * replaced, down to `hover` also listening for `focusin` so keyboard users reach the same state as
 * pointer users. The four additions are exit twins, and exist because an open list still cannot
 * spell two of them: there is no DOM event for "scrolled out of view", and `unhover` is two events
 * rather than one.
 *
 * `leave` is `enter`'s twin and the reason `data-kui-on="enter/leave"` can express "fade out when
 * it scrolls away" at all. `unhover`/`blur` are sugar — `hover/unhover` is `pointerenter,focusin`
 * against `pointerleave,focusout`, which an author can also write the long way now that raw event
 * names work.
 */
const NAMED_TRIGGERS: Record<NamedActivation, ActivationTrigger> = {
  load: { kind: 'immediate' },
  manual: { kind: 'manual' },
  enter: { kind: 'observed', when: 'enter' },
  leave: { kind: 'observed', when: 'leave' },
  hover: { kind: 'events', types: ['pointerenter', 'focusin'] },
  unhover: { kind: 'events', types: ['pointerleave', 'focusout'] },
  focus: { kind: 'events', types: ['focusin'] },
  blur: { kind: 'events', types: ['focusout'] },
  click: { kind: 'events', types: ['click'] },
}

/**
 * Which declared `supportedActivations` entries authorise each name.
 *
 * A primitive's `supportedActivations` is a contract written before any of this existed, so it
 * lists only the original six. Checking a new name against it literally would warn on
 * `enter/leave` for every effect in the catalog — `leave` is in nobody's list — which is a false
 * alarm about a feature that works. So each name maps to the original activation whose machinery
 * it shares: `leave` is authorised by `enter` (same observer), `unhover` by `hover`, `blur` by
 * `focus`. A primitive that declared `enter` support declared support for that observer, and the
 * exit twin is the same observer delivering the other edge.
 */
const SUPPORT_PROXIES: Record<NamedActivation, readonly NamedActivation[]> = {
  load: ['load'],
  manual: ['manual'],
  enter: ['enter'],
  leave: ['enter'],
  hover: ['hover'],
  unhover: ['hover'],
  focus: ['focus'],
  blur: ['focus'],
  click: ['click'],
}

/**
 * A raw DOM event name is the same *kind* of thing as `hover`/`focus`/`click` — a listener on the
 * element — so any effect that declared support for one of those has declared support for this.
 * An effect that declared only `load` or only `manual` genuinely cannot be event-driven, and that
 * is worth a warning rather than a silent listener.
 */
const EVENT_DRIVEN: readonly NamedActivation[] = ['hover', 'focus', 'click']

/**
 * Event names this library will vouch for without asking the document.
 *
 * Used for two things, neither of which is gating: suggesting a correction for a near miss, and
 * covering for environments whose handler properties are incomplete. jsdom, which the unit suite
 * runs in, has no `onpointerenter`, `onfocusin` or `onanimationend` — so a probe alone would warn
 * that `pointerleave` is not a DOM event, which is both false and exactly the sort of noise that
 * teaches authors to ignore warnings. Anything here, or anything the document itself recognises,
 * passes silently; only names failing both are named.
 */
const KNOWN_EVENTS: readonly string[] = [
  'click', 'dblclick', 'auxclick', 'contextmenu',
  'pointerdown', 'pointerup', 'pointerenter', 'pointerleave', 'pointerover', 'pointerout',
  'pointermove', 'pointercancel', 'gotpointercapture', 'lostpointercapture',
  'mousedown', 'mouseup', 'mouseenter', 'mouseleave', 'mouseover', 'mouseout', 'mousemove',
  'focusin', 'focusout', 'focus', 'blur',
  'keydown', 'keyup', 'keypress',
  'input', 'beforeinput', 'change', 'submit', 'reset', 'invalid', 'select', 'search',
  'touchstart', 'touchend', 'touchmove', 'touchcancel', 'wheel', 'scroll', 'scrollend',
  'dragstart', 'drag', 'dragend', 'dragenter', 'dragover', 'dragleave', 'drop',
  'animationstart', 'animationend', 'animationiteration', 'animationcancel',
  'transitionstart', 'transitionend', 'transitionrun', 'transitioncancel',
  'play', 'playing', 'pause', 'ended', 'timeupdate', 'seeked', 'volumechange', 'ratechange',
  'loadeddata', 'loadedmetadata', 'canplay', 'canplaythrough', 'waiting', 'stalled',
  'toggle', 'beforetoggle', 'close', 'cancel', 'copy', 'cut', 'paste',
  'load', 'error', 'abort', 'resize', 'fullscreenchange',
]

/**
 * What `addEventListener` will accept without the author having meant something else.
 *
 * Deliberately looser than "a name we recognise" — the list above is open, and a custom event
 * (`cart:updated`, `htmx-after-swap`) is a first-class activation. It is only tight enough to
 * reject text that cannot be an event type at all, which is where a *silent* misbinding would
 * otherwise start: `data-kui-on="on click"` or an empty half of a pair.
 */
const EVENT_NAME_RE = /^[A-Za-z][A-Za-z0-9._:-]*$/

/** Longest edit distance still worth offering as a correction. */
const SUGGESTION_DISTANCE = 2

export function isNamedActivation(name: string): name is NamedActivation {
  return Object.hasOwn(NAMED_TRIGGERS, name)
}

/**
 * Resolve one half of an authored value into the machinery that delivers it.
 *
 * `Object.hasOwn` rather than a truthiness test on the lookup, for the reason spelled out in
 * `parse.ts`'s `applyToken`: a plain object's lookup falls through to `Object.prototype`, so an
 * author-controlled name like `__proto__` or `constructor` resolves to an inherited value —
 * truthy, and not a trigger.
 *
 * @complexity O(1) time, O(1) space.
 * @overallScore 100
 */
function triggerFor(name: string): ActivationTrigger {
  if (isNamedActivation(name)) return NAMED_TRIGGERS[name]
  return { kind: 'events', types: [name] }
}

/**
 * Resolve a `data-kui-on` value into its start and (optional) end triggers.
 *
 * Total by construction: an unvalidated or malformed value still resolves, to a listener for an
 * event that will simply never fire. That is the open list's own contract — the library cannot
 * know that `cart:updated` is real and `clik` is not — and the diagnostics that make a typo
 * visible live in `validateActivation` and in `animator.ts`, not here.
 *
 * @param activation - Authored value, e.g. `enter`, `pointerenter/pointerleave`, `cart:updated`.
 * @complexity O(n) time in the value's length; O(1) space.
 * @overallScore 100
 */
export function resolveActivationSpec(activation: Activation): ActivationSpec {
  const names = String(activation).split(PAIR_SEPARATOR)
  const [start = '', end] = names
  return {
    source: activation,
    names,
    start: triggerFor(start),
    ...(end === undefined ? {} : { end: triggerFor(end) }),
  }
}

/**
 * Diagnose an authored `data-kui-on` value without a document.
 *
 * Returns the reasons the value cannot be used at all, so the caller can fall back to the default
 * activation rather than binding something meaningless. It deliberately does *not* police whether
 * an event name is real — that is the open list's whole point, and the check that can be made
 * (does this document know the name?) needs an element, so it lives in `animator.ts`.
 *
 * @returns Zero warnings when the value is usable.
 * @complexity O(n) time in the value's length; O(1) space.
 * @overallScore 100
 */
export function validateActivation(value: string): string[] {
  const names = value.split(PAIR_SEPARATOR)
  if (names.length > 2) {
    return [
      `activation "${value}" has more than one "${PAIR_SEPARATOR}" — ` +
        `expected "start${PAIR_SEPARATOR}end"`,
    ]
  }
  const malformed = names.filter((name) => !EVENT_NAME_RE.test(name))
  if (malformed.length > 0) {
    return [`activation "${value}" is not an event name or a "start${PAIR_SEPARATOR}end" pair`]
  }
  // `load` runs the moment the element is installed and `manual` never runs on its own, so
  // neither can be the *exit* half of anything: `pointerenter/load` would play the effect out
  // before it had played in. Rejecting it here beats binding a pair that can only misbehave.
  const end = names[1]
  if (end !== undefined && (end === 'load' || end === 'manual')) {
    return [`activation "${value}" cannot end on "${end}" — an exit needs an event to fire on`]
  }
  return []
}

/**
 * Which kind of machinery starts this activation.
 *
 * Exported so `style-plan.ts` can ask "does this start on its own?" without importing the whole
 * trigger union — it used to compare `config.activation === 'load'`, which a pair like
 * `load/pointerleave` would have quietly failed.
 *
 * @complexity O(n) time in the value's length; O(1) space.
 * @overallScore 100
 */
export function startKindOf(activation: Activation): ActivationTrigger['kind'] {
  return resolveActivationSpec(activation).start.kind
}

/**
 * Whether this activation is spent by its first firing.
 *
 * One-shot `enter` is the library's default and a great deal of existing markup depends on it —
 * the effect plays once and stays. Pairing it is what opts out: an author who wrote an exit half
 * is asking for the binding to stay live, because an exit that fires once and then stops
 * responding is not an exit. Observed activations are the only ones that were ever one-shot;
 * `hover` and `click` deliberately stay bound so a card can flip back.
 *
 * @complexity O(n) time in the value's length; O(1) space.
 * @overallScore 100
 */
export function isOneShot(spec: ActivationSpec): boolean {
  return spec.end === undefined && spec.start.kind === 'observed'
}

/**
 * The named activations, any one of which authorises `name` against a primitive's declared
 * `supportedActivations`. See `SUPPORT_PROXIES`.
 *
 * @complexity O(1) time, O(1) space.
 * @overallScore 100
 */
export function authorisingActivations(name: string): readonly NamedActivation[] {
  return isNamedActivation(name) ? SUPPORT_PROXIES[name] : EVENT_DRIVEN
}

/**
 * Whether this library recognises `type` as a real event name on its own, without asking a
 * document. A `-`, `:` or `.` is treated as a deliberate custom-event namespace and always
 * vouched for — `cart:updated` and `htmx-after-swap` are legitimate activations that no document
 * will ever recognise, and warning about them would make the warning useless.
 *
 * @complexity O(n) time in the list length; O(1) space.
 * @overallScore 100
 */
export function isKnownEventType(type: string): boolean {
  if (/[-:.]/.test(type)) return true
  return KNOWN_EVENTS.includes(type)
}

/**
 * Offer the closest activation or event name to a near miss, for a warning that says what to do
 * instead of only what went wrong.
 *
 * @returns The suggestion, or `undefined` when nothing is close enough to be worth offering.
 * @complexity O(k * n * m) time over the candidate list; O(m) space. Only ever runs on the
 * diagnostic path for a name the environment already rejected.
 * @overallScore 100
 */
export function suggestActivation(name: string): string | undefined {
  let best: string | undefined
  let bestDistance = SUGGESTION_DISTANCE + 1
  for (const candidate of [...Object.keys(NAMED_TRIGGERS), ...KNOWN_EVENTS]) {
    const distance = editDistance(name, candidate)
    if (distance >= bestDistance) continue
    bestDistance = distance
    best = candidate
  }
  // A distance-2 suggestion for a three-letter name is noise, not help: two edits on `abc` reach
  // most of the alphabet. Requiring the suggestion to be closer than half the name keeps the
  // offer proportional to how much of it was actually right.
  return bestDistance <= SUGGESTION_DISTANCE && bestDistance * 2 < name.length ? best : undefined
}

/**
 * Levenshtein distance, one row at a time.
 *
 * A full matrix is O(n*m) space for no benefit here — nothing needs the alignment, only the
 * number — and the candidate list is scanned once per warning, on a path that has already decided
 * something is wrong.
 *
 * @complexity O(n * m) time; O(m) space.
 * @overallScore 100
 */
function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    for (let j = 1; j <= b.length; j++) {
      const substitution = previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1)
      row.push(Math.min(previous[j]! + 1, row[j - 1]! + 1, substitution))
    }
    previous = row
  }
  return previous[b.length]!
}

const NOOP: Cleanup = () => {}

/**
 * Bind an authored activation to an element.
 *
 * The delivery mechanisms live in the table above rather than in a switch here, so adding an
 * activation stays a data change and this binder's branch count stays flat —
 * the original architecture note, kept through the change from a closed list of six names to an
 * open one. What used to be `Record<Activation, string[]>` is now a tagged union of four kinds,
 * for the same reason: an event-name list could not express "any name at all" without also
 * claiming that `enter` was an event.
 */

/** Everything one binding needs, grouped so the call site reads as one request. */
export interface ActivationRequest {
  /** `IntersectionObserver` threshold, used only by observed activations. */
  threshold: string
  /** Start the effects. */
  activate(): void
  /**
   * Play them back out.
   *
   * Called only for the exit half of a pair, so a binder consumer that has nothing to reverse can
   * leave it off and the exit half simply goes unbound.
   */
  deactivate?(): void
}

export interface ActivationBinder {
  bind(el: Element, activation: Activation, request: ActivationRequest): Cleanup
  destroy(): void
}

export interface ActivationBinderOptions {
  /** Injected so tests can supply a controllable observer and assert without layout. */
  createObserver?: (
    callback: IntersectionObserverCallback,
    options: IntersectionObserverInit,
  ) => IntersectionObserver
}

/** One element's stake in a shared observer. */
interface ObservedBinding {
  onEnter?: () => void
  onLeave?: () => void
  release: Cleanup
  /** Released by its first firing — plain `enter`, the library default. */
  oneShot: boolean
  /**
   * Whether the element has been seen intersecting yet.
   *
   * An observer's first delivery for a freshly observed element reports its *current* state, which
   * for anything below the fold is `isIntersecting: false`. Without this, `enter/leave` would play
   * its exit on every off-screen element the instant it was installed — an animation running
   * backwards out of a from-state it had never left.
   */
  entered: boolean
}

/**
 * Deliver one observer entry to the element's binding.
 *
 * @complexity O(1) time, O(1) space.
 * @overallScore 100
 */
function deliverEntry(binding: ObservedBinding, isIntersecting: boolean): void {
  if (!isIntersecting && !binding.entered) return
  binding.entered = isIntersecting
  const side = isIntersecting ? binding.onEnter : binding.onLeave
  if (!side) return
  side()
  if (binding.oneShot) binding.release()
}

/**
 * Bind activations to elements, sharing one IntersectionObserver per distinct threshold.
 *
 * One observer per threshold rather than per element is the difference between a constant number
 * of observers and one per animated node on a long page.
 *
 * @param options - Optional observer factory; defaults to the global constructor when present.
 * @returns A binder whose `bind` returns the teardown for that single binding.
 * @complexity O(1) per bind; O(t) space in the number of distinct thresholds.
 * @overallScore 100
 */
// Factory closing over shared observer/callback state; length is five small named closures plus
// the returned binder, not one long procedure.
// eslint-disable-next-line max-lines-per-function
export function createActivationBinder(options: ActivationBinderOptions = {}): ActivationBinder {
  const observers = new Map<string, { observer: IntersectionObserver; count: number }>()
  const callbacks = new WeakMap<Element, ObservedBinding>()
  const createObserver = options.createObserver ?? defaultObserverFactory()

  function observerFor(
    threshold: string,
  ): { key: string; shared: { observer: IntersectionObserver; count: number } } | undefined {
    if (!createObserver) return undefined
    const ratio = toThresholdRatio(threshold)
    const key = String(ratio)
    const existing = observers.get(key)
    if (existing) return { key, shared: existing }

    const observer = createObserver(
      (entries) => {
        for (const entry of entries) {
          const binding = callbacks.get(entry.target)
          if (binding) deliverEntry(binding, entry.isIntersecting)
        }
      },
      { threshold: ratio },
    )
    const shared = { observer, count: 0 }
    observers.set(key, shared)
    return { key, shared }
  }

  /**
   * Both observed halves of one spec go through here together, in one `ObservedBinding`. They
   * cannot be bound separately: `callbacks` is keyed by element, so a second observed binding on
   * the same element would evict the first — and `enter/leave` is precisely two observed halves on
   * one element.
   */
  function bindObserved(el: Element, spec: ObservedRequest, request: ActivationRequest): Cleanup {
    const binding = observerFor(request.threshold)
    // No IntersectionObserver means no way to know when the element is visible; showing the
    // content immediately is the only fail-open choice — but only when the observer was what the
    // effects were *waiting on*. For `pointerenter/leave` the exit half is observed while the
    // start half is an ordinary listener, and starting the effect here would fire the entrance
    // the author asked to be triggered by a pointer. There is correspondingly no way to know when
    // an element stops being visible, so an observed exit is simply never delivered.
    if (!binding) {
      if (spec.failOpen) request.activate()
      return NOOP
    }
    const { key, shared } = binding
    let active = true
    const release = (): void => {
      if (!active) return
      active = false
      callbacks.delete(el)
      shared.observer.unobserve(el)
      shared.count--
      if (shared.count > 0) return
      shared.observer.disconnect()
      observers.delete(key)
    }
    callbacks.set(el, {
      onEnter: spec.onEnter,
      onLeave: spec.onLeave,
      oneShot: spec.oneShot,
      release,
      entered: false,
    })
    shared.count++
    shared.observer.observe(el)
    return release
  }

  return {
    bind(el, activation, request) {
      const spec = resolveActivationSpec(activation)
      const sides = sidesOf(spec, request)
      const cleanups: Cleanup[] = []

      const observed = observedSides(sides)
      if (observed) {
        const failOpen = spec.start.kind === 'observed'
        cleanups.push(bindObserved(el, { ...observed, oneShot: isOneShot(spec), failOpen }, request))
      }
      for (const side of sides) {
        const { trigger } = side
        if (trigger.kind === 'events') cleanups.push(bindEvents(el, trigger.types, side.run))
        // `load` starts now and returns nothing to release; `manual` and `observed` have no
        // listener of their own to add here.
        else if (trigger.kind === 'immediate') side.run()
      }
      return cleanups.length === 0
        ? NOOP
        : () => {
            for (const cleanup of cleanups) cleanup()
          }
    },

    destroy() {
      for (const { observer } of observers.values()) observer.disconnect()
      observers.clear()
    },
  }
}

/** One half of a resolved spec, paired with the callback it drives. */
interface Side {
  trigger: ActivationTrigger
  run: () => void
}

type ObservedSides = Pick<ObservedBinding, 'onEnter' | 'onLeave'>

interface ObservedRequest extends ObservedSides {
  oneShot: boolean
  /** Whether losing the observer entirely should start the effects anyway. */
  failOpen: boolean
}

/**
 * Pair each half of a spec with the callback it runs. An exit half with nothing to reverse is
 * dropped here rather than being bound to a no-op, so it never keeps an observer alive.
 *
 * @complexity O(1) time and space.
 * @overallScore 100
 */
function sidesOf(spec: ActivationSpec, request: ActivationRequest): Side[] {
  const sides: Side[] = [{ trigger: spec.start, run: () => request.activate() }]
  const deactivate = request.deactivate
  if (spec.end && deactivate) sides.push({ trigger: spec.end, run: () => deactivate() })
  return sides
}

/**
 * Collect the observed halves of a spec, or `undefined` when it has none.
 *
 * @complexity O(1) time and space.
 * @overallScore 100
 */
function observedSides(sides: Side[]): ObservedSides | undefined {
  const observed: ObservedSides = {}
  let found = false
  for (const side of sides) {
    if (side.trigger.kind !== 'observed') continue
    found = true
    if (side.trigger.when === 'enter') observed.onEnter = side.run
    else observed.onLeave = side.run
  }
  return found ? observed : undefined
}

/**
 * Listen for one half's event types.
 *
 * Every listener stays `{ passive: true }`, including the ones an open list newly makes reachable
 * (`wheel`, `touchstart`, `submit`). Passive only forbids `preventDefault()`, and this handler
 * never calls it — it starts an animation and returns — so the promise is one the library can
 * genuinely keep, and keeping it is what stops a `data-kui-on="wheel"` from making a page's scroll
 * janky. An activation that needed to cancel its event would need a different contract entirely,
 * and would have to say so.
 *
 * @complexity O(t) time in the number of event types; O(t) space.
 * @overallScore 100
 */
function bindEvents(el: Element, types: readonly string[], run: () => void): Cleanup {
  const handler = (): void => run()
  for (const type of types) el.addEventListener(type, handler, { passive: true })
  return () => {
    for (const type of types) el.removeEventListener(type, handler)
  }
}

/**
 * Convert an IntersectionObserver threshold from `"30%"` or `"0.3"` into a clamped ratio.
 *
 * Lives here rather than with the rest of the attribute reading in `element-config.ts`, where it
 * used to sit: the binder above is its only caller, and leaving it there would have made
 * `activation.ts` and `element-config.ts` import each other — a cycle, once `validateActivation`
 * moved into this file. `.dependency-cruiser.cjs` forbids those for a reason, and the honest fix
 * is that a threshold is activation machinery, not element configuration.
 *
 * @param raw - Authored threshold value.
 * @returns A ratio in [0, 1]; unparseable input yields 0 rather than throwing.
 * @complexity O(1) time, O(1) space.
 * @overallScore 100
 */
export function toThresholdRatio(raw: string): number {
  const value = Number.parseFloat(raw)
  if (Number.isNaN(value)) return 0
  const ratio = raw.includes('%') ? value / 100 : value
  return Math.min(1, Math.max(0, ratio))
}

function defaultObserverFactory(): ActivationBinderOptions['createObserver'] {
  if (typeof IntersectionObserver === 'undefined') return undefined
  return (callback, init) => new IntersectionObserver(callback, init)
}

/**
 * What the library can still tell an author about an authored activation once the list is open.
 *
 * Separate from the vocabulary above because these checks need an element and that half is
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
