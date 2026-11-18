import { createAutoMotion, clampPeriod, MIN_PERIOD_MS } from './auto-motion.js'
import { authoredParams, schemaFor } from './compile.js'
import type { CompiledDocument } from './compile.js'
import type { PrepareContext } from './effect-context.js'
import { readEffectParams } from './js-params.js'
import type { Cleanup } from './types.js'

/**
 * The runtime half of `every:` — "while this element is on screen, the tab is visible, nothing
 * pauses it and the visitor has not asked for reduced motion, perform one demonstration step every
 * period" — as a thin layer over the library's one scheduler.
 *
 * It is `createAutoMotion` configured as a pure timer (`autoplayMs`, no spin, no settle), so the pause
 * rules are not restated here: offscreen, hidden tab, keyboard focus, a paused scope and reduced
 * motion all come from the scheduler, which a deck's `autoplay:` and a scroll-snap strip's share. A
 * private `setInterval` would have been the third copy of those rules (decks, `slideshow`, this).
 *
 * Two deliberate departures from a deck's defaults:
 *
 * - **Hover does not pause it.** A demo loop is not text to read, and a pointer resting on a tile
 *   would otherwise freeze exactly the tile the visitor is looking at. Keyboard focus still pauses,
 *   and WCAG 2.2.2's "a way to pause" is served by the `pause-scope` control.
 * - **Reduced motion never arms it.** The scheduler starts paused under that preference and a cadence
 *   has no play control to lift it, which is the point: no demo loop for a visitor who asked for none.
 *
 * What a *step* is lives in the animator (`Animator#cadenceTick`) because it needs the element's
 * lifecycle state; this module only decides *when*.
 */

/** What {@link createCadence} needs. */
export interface CadenceRequest {
  el: Element
  /** The authored period in milliseconds; floored to the scheduler's 2s minimum with a warning. */
  periodMs: number
  /** The realm, document and reduced-motion preference the scheduler reads. */
  host: Pick<PrepareContext, 'win' | 'doc' | 'reducedMotion'>
  /** Perform one demonstration step. Called only while nothing pauses the cadence. */
  tick(): void
  warn(message: string): void
}

/**
 * Start a cadence on one element.
 *
 * A period of `0` (or one that is not finite) arms nothing and says why, rather than looping at the
 * floor: `every:0s` is more likely a typo than a request for the fastest loop allowed.
 *
 * @returns Its release; always safe to call, including twice.
 * @complexity O(1) time and space.
 * @overallScore 100
 */
export function createCadence(request: CadenceRequest): { release: Cleanup } {
  const { el, periodMs, host, tick, warn } = request
  const period = clampPeriod(periodMs)
  if (period === 0) {
    warn('every: needs a period above zero, such as every:3s; no cadence started')
    return { release() {} }
  }
  if (period !== periodMs) {
    warn(`every: minimum is ${MIN_PERIOD_MS / 1000}s; clamped to ${period / 1000}s`)
  }
  const motion = createAutoMotion({
    el,
    ctx: host,
    spinMs: 0,
    autoplayMs: period,
    settleMs: 0,
    pauseOnHover: false,
    step: () => tick(),
    onPausedChange: () => {},
  })
  return { release: () => motion.release() }
}

/**
 * Read an `every:` value into milliseconds.
 *
 * `parse.ts` validates the token as a non-negative `s`/`ms` time.
 * {@link createCadence} rejects periods that overflow when converted to milliseconds.
 *
 * @complexity O(n) time in the token length; O(1) space.
 * @overallScore 100
 */
export function everyToMs(every: string): number {
  const token = every.trim()
  const milliseconds = token.endsWith('ms')
  if (!milliseconds && !token.endsWith('s')) return Number.NaN
  const value = Number(token.slice(0, milliseconds ? -2 : -1))
  return value * (milliseconds ? 1 : 1000)
}

/**
 * The cycle hooks of the host group's composed primitives, as thunks that run them.
 *
 * A thunk reads its params exactly as `js-effect-preparer.ts` does for the same entry (preset
 * defaults under the authored values, validated against the entry's own schema), so a hook sees the
 * values the effect itself runs with — `auto-height`'s `attribute:` is the author's, not a default.
 * Each thunk is isolated: a hook that throws is warned about and the next one still runs, mirroring
 * `startInstance`, so one bad hook cannot stop the cadence.
 *
 * Only the host group's entries count. A `target:` group's entries act on derived matches, and a
 * cycle hook is handed the host element; calling it for a group would mutate the wrong node. When a
 * group names a primitive that has a hook, the animator says so once ({@link hasGroupedCycle}) and
 * the group replays instead.
 *
 * @param el - The element the cadence is on (the host).
 * @param document - The element's compiled document; an empty selector identifies its host group.
 * @param warn - The element's warning sink.
 * @returns One thunk per host-group entry whose primitive declares `cycle`; empty when none do.
 * @complexity O(e) time and space in composed effects.
 * @overallScore 100
 */
export function cycleThunks(el: Element, document: CompiledDocument, warn: (message: string) => void): Array<() => void> {
  const doc = el.ownerDocument
  const ctx = { doc, win: doc.defaultView ?? (globalThis as unknown as Window), warn }
  const thunks: Array<() => void> = []
  const host = document.targets.find((target) => target.selector === '')
  for (const entry of host?.plan.jsEffects ?? []) {
    const cycle = entry.resolved.primitive.cycle
    if (!cycle) continue
    const params = readEffectParams(
      { ...entry.resolved.preset.params, ...authoredParams(entry) },
      schemaFor(entry),
      warn,
    )
    const name = entry.spec.name
    thunks.push(() => {
      try {
        cycle.call(entry.resolved.primitive, el, params, ctx)
      } catch (error) {
        warn(`"${name}" failed to cycle: ${String(error)}`)
      }
    })
  }
  return thunks
}

/**
 * Whether a `target:` group (not the host's own) composes a primitive with a cycle hook.
 *
 * Separate from {@link cycleThunks} so the animator can say it once, when a cadence is created,
 * instead of on every replay's recompile.
 *
 * @complexity O(e) time in composed effects; O(1) space.
 * @overallScore 100
 */
export function hasGroupedCycle(document: CompiledDocument): boolean {
  return document.targets.some(
    (target) => target.selector !== '' && target.plan.jsEffects.some((entry) => entry.resolved.primitive.cycle),
  )
}
