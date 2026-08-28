import type { Reporter } from './reporter.js'

/**
 * Whether a positive `threshold:` is one this target's own geometry can ever satisfy.
 *
 * Split out of `activation.ts` because it answers a question about the *target's measured size*
 * rather than about a crossing: one diagnostic, consulted once per observed binding, that
 * `deliverEntry` runs ahead of its own dispatch and nothing else in the binder cares about.
 *
 * `meetsThreshold` in `activation.ts` documents the failure this closes: an `IntersectionObserver`
 * only ever reports the ratio it was asked to watch, so an element taller than its root — three
 * viewports tall tops out around 0.33 — can author `threshold:50%` and never once satisfy it, with
 * nothing to say so. That caveat is accepted as unfixable from the binder; this module is the
 * library declining to also be silent about it.
 */

/**
 * Slack matching `activation.ts`'s own `RATIO_EPSILON`: the entry a browser queues *because* a ratio
 * was crossed reports a value a hair either side of it, computed from subpixel float rects.
 */
const RATIO_EPSILON = 1e-6

/** The subset of an observed binding's state this diagnostic reads and updates. */
export interface ThresholdReachabilityState {
  /** Where to report an unreachable threshold. `undefined` means nowhere — nothing to check for. */
  reporter?: Reporter
  /**
   * Whether this element has ever been geometrically inside the root, independent of whether it
   * ever met the authored threshold. Tells a genuine leave (toured through, never got there) apart
   * from the first delivery of an element that starts outside the root (never arrived yet) — both
   * report `isIntersecting: false`, and only one of them is evidence of anything.
   */
  sawIntersecting: boolean
  /** Whether the threshold was ever actually met. A binding that got here has never met it. */
  entered: boolean
  /** Set once this has warned, so a repeated tour past the same unreachable threshold stays quiet. */
  thresholdWarned: boolean
}

/**
 * The greatest ratio this target could ever report, from one entry's geometry.
 *
 * Both dimensions the ratio is built from — the target's own box and the root it scrolls through —
 * are independent of scroll position: translating a box through a fixed root changes how much of it
 * *currently* overlaps, not how much it can *ever* overlap. So this bound holds for any entry
 * carrying usable geometry, not only one caught at the peak of a transit.
 *
 * @returns The ceiling, or `undefined` when the entry carries nothing to measure — a null
 *   `rootBounds` (a cross-origin iframe root) or a zero-area box.
 * @complexity O(1) time, O(1) space.
 * @overallScore 100
 */
function maxReachableRatio(entry: IntersectionObserverEntry): number | undefined {
  const root = entry.rootBounds
  const box = entry.boundingClientRect
  if (!root || box.width <= 0 || box.height <= 0) return undefined
  return Math.min(1, root.width / box.width) * Math.min(1, root.height / box.height)
}

/**
 * Render a ratio the way an author would write it as a threshold, for a message quoting one back.
 *
 * @complexity O(1) time, O(1) space.
 * @overallScore 100
 */
function formatThreshold(ratio: number): string {
  return `${Math.round(ratio * 1000) / 10}%`
}

/**
 * Say so when a full transit closes without an authored threshold ever being met, and the target's
 * own geometry is why it never can be: it is larger than the root it scrolls through, so its
 * intersection ratio has a hard ceiling below what was asked for. See {@link maxReachableRatio}.
 *
 * Checked only on a genuine leave — `!entry.isIntersecting` once {@link ThresholdReachabilityState.sawIntersecting}
 * already recorded a real entry — rather than on whichever delivery arrives first. A target's
 * measured size is a runtime fact, not an authored one, and the very first delivery for a freshly
 * observed element can land before a lazy image has decoded, an accordion has expanded, or a web
 * font has swapped in — any of which can measure a box taller *right now* than it will be once the
 * page settles. A completed transit — inside the root and back out — gives layout the whole scroll
 * past it to settle before its geometry is trusted for a diagnostic that, once given, cannot be
 * unsaid. The cost is a symmetrical blind spot: a target that is too tall only *during* one transit
 * (a mid-scroll resize) keeps quiet until the next full transit re-checks it — the same shape of
 * tradeoff `meetsThreshold`'s own caveat already accepts for the threshold itself.
 *
 * An element that starts already outside the root also delivers `isIntersecting: false` on its very
 * first entry — "hasn't arrived yet," not "toured through and failed" — which is exactly what
 * `sawIntersecting` exists to tell apart from a real leave.
 *
 * Warns once per element (`thresholdWarned`), not once per delivery or per transit: an element that
 * tours past its unreachable threshold repeatedly (a reader scrolling up and down) would otherwise
 * repeat the same diagnostic every time.
 *
 * @complexity O(1) time, O(1) space.
 * @overallScore 100
 */
export function checkThresholdReachability(
  binding: ThresholdReachabilityState,
  entry: IntersectionObserverEntry,
  ratio: number,
): void {
  const reporter = binding.reporter
  if (!reporter || ratio <= 0 || binding.thresholdWarned) return
  if (entry.isIntersecting) {
    binding.sawIntersecting = true
    return
  }
  if (!binding.sawIntersecting || binding.entered) return
  const max = maxReachableRatio(entry)
  if (max === undefined || max >= ratio - RATIO_EPSILON) return
  binding.thresholdWarned = true
  reporter.warn(
    `threshold:${formatThreshold(ratio)} can never be met on this element — it is larger than the ` +
      `root it scrolls through, so its intersection ratio maxes out around ${formatThreshold(max)} ` +
      `and never reaches ${formatThreshold(ratio)}. An IntersectionObserver only reports ratio ` +
      `crossings, so the library cannot soften this from here — author a smaller threshold, or make ` +
      `the element (or its scrolling root) fit the other.`,
    entry.target,
  )
}
