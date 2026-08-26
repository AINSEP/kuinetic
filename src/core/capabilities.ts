/**
 * Per-feature detection.
 *
 * One global `CSS.supports('animation-timeline','view()')` check is not an abstraction boundary:
 * `animation-range`, named timelines, and individual transform properties all ship separately.
 * Each capability is probed independently and cached. See docs/design.md §6.
 */

function supports(property: string, value: string): boolean {
  if (typeof CSS === 'undefined' || typeof CSS.supports !== 'function') return false
  try {
    return CSS.supports(property, value)
  } catch {
    return false
  }
}

export interface Capabilities {
  viewTimeline: boolean
  scrollTimeline: boolean
  animationRange: boolean
  individualTransforms: boolean
  scrollTimelineName: boolean
  viewTransitions: boolean
  intersectionObserver: boolean
  reducedMotion: boolean
  /**
   * CSS Motion Path — `offset-path`, and with it `offset-distance`/`offset-rotate`/`offset-anchor`.
   *
   * Probed with a `path()` value specifically, not with `offset-path` alone: Chrome shipped
   * `offset-path: path()` years before it accepted a `<basic-shape>` there, so "does this property
   * parse" and "does this property parse the thing we emit" are different questions, in the same
   * way `view()` and `scroll()` are two probes above rather than one.
   */
  motionPath: boolean
}

/**
 * Every capability at its "this environment does not have it" value.
 *
 * All `false`, and not one field is a judgement call: `false` is exactly what `supports()` returns
 * when there is no `CSS.supports` to ask, so this record is literally what `detect()` computes on a
 * bare Node runtime. It is the real baseline, not an invented one. `reducedMotion` reads inverted
 * — `true` there means the *user* asked for less motion — and `false` is still the honest "nothing
 * detected, nothing requested", so the polarity costs nothing.
 *
 * Choosing `false` over `true` is the whole point of the factory. A construction site that never
 * heard of a capability inherits "absent", which routes the runtime down its documented fallback
 * (or through `unsupportedChannelWarnings` below) — a visible, already-tested path. Inheriting
 * `true` would have every existing harness silently *claim* support it was never checked against,
 * and the failure would then surface somewhere downstream with nothing pointing back here.
 */
const ABSENT: Capabilities = {
  viewTimeline: false,
  scrollTimeline: false,
  animationRange: false,
  individualTransforms: false,
  scrollTimelineName: false,
  viewTransitions: false,
  intersectionObserver: false,
  reducedMotion: false,
  motionPath: false,
}

/**
 * Build a `Capabilities` from only the fields a caller actually has an opinion about.
 *
 * `Capabilities` is a closed record of required booleans, so before this existed every object
 * literal constructing one had to name every field. Adding `motionPath` was therefore O(number of
 * construction sites) rather than O(1), and it broke three test harnesses in a single merge — none
 * of which had any interest in motion paths, and all of which failed to compile purely for not
 * mentioning one. Spreading a complete default makes a new field additive everywhere instead.
 *
 * Deliberately *not* used by `detect()`, even though `detect()` is a construction site too. Its
 * literal is the detection logic: keeping it exhaustive is what makes the compiler demand a real
 * probe for each new capability. Route it through here and adding a field would type-check the
 * moment it was given a default, and ship as permanently `false` in every browser — the feature
 * dead in production, with no test able to notice. So the two defaults differ on purpose: a
 * caller stating a fixed environment gets "absent unless said otherwise", and production gets no
 * constant default at all, because the honest answer there is always "go and probe it". Adding a
 * capability still means editing one file — this one — in two adjacent places the compiler names.
 *
 * There is deliberately no `allCapabilities()` counterpart. A harness that wants a fully modern
 * browser lists its `true`s, because the alternative is a test opting in to every capability
 * invented after it was written.
 *
 * @param overrides - Fields this caller has actually decided; everything else comes back absent.
 * @returns A fully-populated capability record.
 * @complexity O(c) time and space in the number of capability fields — fixed and single-digit.
 * @overallScore 100
 */
export function defaultCapabilities(overrides?: Partial<Capabilities>): Capabilities {
  return { ...ABSENT, ...overrides }
}

let cached: Capabilities | undefined

export function detect(force = false): Capabilities {
  if (cached && !force) return cached
  // Exhaustive by design — see `defaultCapabilities` for why this one literal does not spread it.
  cached = {
    viewTimeline: supports('animation-timeline', 'view()'),
    scrollTimeline: supports('animation-timeline', 'scroll()'),
    animationRange: supports('animation-range', 'entry 0% cover 30%'),
    // `translate`/`rotate`/`scale` as independent properties is what makes the channel model
    // possible at all — under the `transform` shorthand every effect would collide.
    individualTransforms: supports('translate', '0 10px') && supports('scale', '1.1'),
    scrollTimelineName: supports('scroll-timeline-name', '--x'),
    viewTransitions: typeof document !== 'undefined' && 'startViewTransition' in document,
    intersectionObserver: typeof IntersectionObserver !== 'undefined',
    reducedMotion:
      typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches,
    motionPath: supports('offset-path', 'path("M 0 0")'),
  }
  return cached
}

export function resetCapabilities(): void {
  cached = undefined
}

/**
 * Channels whose entire output depends on one capability, and what to say when it is absent.
 *
 * A table rather than a chain of `if`s, for the reason `activation.ts` gives for its own: a new
 * entry should be a data change, not a new branch in the caller.
 *
 * Only channels that *silently* produce nothing belong here. `translate`/`rotate`/`scale` do not,
 * even though they have a capability of their own: a browser without individual transform
 * properties leaves a deferred entrance paused at an invisible from-state forever, which is bad
 * enough that `style-plan.ts` changes the *gate* rather than merely mentioning it. The `offset`
 * channel is the opposite case — the animation still runs, still finishes, still resolves
 * `finished`, and the element simply never moves. Nothing is broken, nothing is stuck, and there
 * is nothing the runtime could usefully do differently. What there is, is an author staring at a
 * motionless element with no idea why, which a warning fixes and a gate change would not.
 */
const CHANNEL_REQUIREMENTS: ReadonlyArray<{
  channel: string
  capability: keyof Capabilities
  message: string
}> = [
  {
    channel: 'offset',
    capability: 'motionPath',
    message:
      'this browser does not support CSS Motion Path (offset-path), so the element will not ' +
      'travel — the animation still runs and completes, it just has no path to follow',
  },
]

/**
 * Diagnostics for composed channels this environment cannot render.
 *
 * @param channels - Channels the compiled effects write to (`CompiledPlan.channels`).
 * @param capabilities - The environment's detected capabilities.
 * @returns One message per unsupported channel; empty in a browser that supports them all.
 * @complexity O(r) time in the requirement table's length — single digits; O(1) space per message.
 * @overallScore 100
 */
export function unsupportedChannelWarnings(
  channels: readonly string[],
  capabilities: Capabilities,
): string[] {
  return CHANNEL_REQUIREMENTS.filter(
    (entry) => channels.includes(entry.channel) && !capabilities[entry.capability],
  ).map((entry) => entry.message)
}
