import { clampPeriod, createAutoMotion } from '../core/auto-motion.js'
import type { AutoMotion, AutoMotionRequest } from '../core/auto-motion.js'
import type { PrepareContext } from '../core/effect-context.js'
import { createAttributeLedger } from '../core/owned-styles.js'
import type { AttributeLedger } from '../core/owned-styles.js'
import { queryControls, resolveTarget } from '../core/target.js'
import type { Cleanup, EffectParams, ParamSpec } from '../core/types.js'
import { bindControl } from './step-index.js'
import type { ControlGroup } from './step-index.js'

/*
 * The scheduler itself (`createAutoMotion`, the period floor, the pause rules) lives in
 * `core/auto-motion.ts` since the `every:` cadence needed it from the animator, which may not import
 * effects. Re-exported so every existing importer of this path keeps compiling; new core code imports
 * from core directly. What stays here is the deck-facing half: how a deck reads `autoplay:`/`spin:`/
 * `pause:`/`hover:` and reflects pause onto its control.
 */
export { clampPeriod, createAutoMotion }
export type { AutoMotion, AutoMotionRequest }

/**
 * Make the author's pause control hold every other clock-driven effect on the same host.
 *
 * Effects composed on one element (`starfield, carousel-warp autoplay:6s`) each own a separate
 * kind of motion, but a visitor sees one pause button and expects the whole element to stop
 * (WCAG 2.2.2). Compiled CSS effects are gated by `animation-play-state` on the host, which is the
 * property `control().pause()` writes, through the host's own style ledger (`ctx.style`, the same
 * ledger object the CSS instances use). Writing it here, through that ledger, reaches every such
 * effect on the host without this widget knowing which ones they are, and unwinds with them on
 * teardown. It writes nothing until a pause is first pressed, so an unpaused widget leaves the
 * other effects' own play state alone.
 *
 * @param ctx - The widget's prepare context; `ctx.style` is the host's ledger.
 * @returns A setter: `true` holds the host's other effects, `false` lets them run again.
 * @complexity O(1) time and space per call.
 */
export function createHostPlayhead(ctx: PrepareContext): (paused: boolean) => void {
  let held = false
  return (paused) => {
    if (paused === held) return
    held = paused
    ctx.style.set('animation-play-state', paused ? 'paused' : 'running')
  }
}

/*
 * Stepped motion: how long the deck rests on each slide before moving to the next. `0s` is off.
 *
 * The `slideshow` model — a timer pressing "next", with the stylesheet's own transition doing the
 * travel — and its two-second floor. Negative steps backwards. One declaration for every deck, so
 * the spelling and the default cannot drift between the spatial decks and the flat one.
 */
export const AUTOPLAY_PARAM: ParamSpec = { type: 'time', default: '0s', cssProperty: '--kui-autoplay' }

/*
 * A control that pauses and resumes the deck's own motion, resolved like `next:`/`prev:`/`jump:`.
 *
 * The library does not invent the button, unlike `slideshow`, which builds its own chrome: every
 * other control on a deck is the author's markup, and a pause button that appeared from nowhere
 * beside arrows the page styled itself would be the one control that did not match. It gets
 * `aria-pressed` (true while paused) so it announces as the toggle it is. Moving content that starts
 * on its own and runs past five seconds needs a way to stop it (WCAG 2.2.2); hover and keyboard
 * focus already pause, and this is the control for everyone else.
 */
export const PAUSE_PARAM: ParamSpec = { type: 'text', default: '', cssProperty: '--kui-pause' }

/*
 * What the pointer resting on the deck does to its own motion: `pause` (the default) holds it still,
 * `none` lets it carry on under the pointer — for a deck that is ambient decoration rather than
 * something to read, or one so large that a resting mouse is almost always over it.
 *
 * The name and the `none` are the catalogue's existing ones: `shaders`' `hover:` likewise says what
 * hovering does, and `none` there means "nothing". Only the hover reason goes; keyboard focus, the
 * `pause:` control and reduced motion still stop the deck, so WCAG 2.2.2's "a way to pause" stands.
 */
export const HOVER_PARAM: ParamSpec = {
  type: 'keyword',
  default: 'pause',
  keywords: ['pause', 'none'],
  cssProperty: '--kui-hover',
}

/** What {@link createDeckMotion} needs from a deck. */
export interface DeckMotionRequest {
  el: Element
  ctx: PrepareContext
  params: EffectParams
  /** Prefix for warnings, the word an author would recognise. */
  label: string
  /** How long a manual move takes to settle, so the motion does not resume mid-transition. */
  settleMs: number
  /** Step the deck one place. */
  step(direction: 1 | -1): void
  onAutoplayProgress?: AutoMotionRequest['onAutoplayProgress']
  /**
   * The continuous half, for a deck that has a continuous position to spin (`spin:`). Omitted, the
   * deck has no `spin:` parameter and only `autoplay:` is read.
   */
  spin?: Pick<AutoMotionRequest, 'advance' | 'setSpinning'>
}

/** What {@link createDeckMotion} returns. */
export interface DeckMotion {
  /** The motion handle the deck's manual inputs talk to (`interrupt`, `hold`). */
  motion: AutoMotion
  /**
   * The `pause:` control as a group for the deck's own delegated listener, or `null` when none was
   * named or there is nothing to pause. Bound by the deck, so a press on it goes through the same
   * one listener — and the same inside-first search (`core/target.ts`'s `queryControls`) — as its
   * arrows and dots. A pause button in a band header outside the ring needs no `scope:`.
   */
  pause: ControlGroup | null
  release: Cleanup
}

/**
 * The configured motion, after the floor, with the both-set conflict resolved.
 *
 * @complexity O(1) time and space.
 */
function motionPeriods(request: DeckMotionRequest): { spin: number; autoplay: number } {
  const { params, ctx, label } = request
  const spinRaw = request.spin ? params.ms('spin', 0) : 0
  const autoplayRaw = params.ms('autoplay', 0)
  const spin = clampPeriod(spinRaw)
  const autoplay = clampPeriod(autoplayRaw)
  if (spin !== spinRaw) ctx.warn(`${label} spin: minimum is 2s; clamped to ${Math.abs(spin) / 1000}s`)
  if (autoplay !== autoplayRaw) {
    ctx.warn(`${label} autoplay: minimum is 2s; clamped to ${Math.abs(autoplay) / 1000}s`)
  }
  if (spin !== 0 && autoplay !== 0) {
    ctx.warn(`${label}: spin: and autoplay: are both set; spin: wins`)
    return { spin, autoplay: 0 }
  }
  return { spin, autoplay }
}

/*
 * Elements whose deck went away paused, for a deck that takes over the same element in this task.
 *
 * Setting `data-kui` tears one effect down and installs the next synchronously, and the pause dies
 * with the old deck's closures, so without this a visitor who stopped the motion (WCAG 2.2.2) has it
 * start again because they chose another arrangement. It lives here rather than beside the poses in
 * `carousel/glide.ts` because the pause belongs to every deck on this scheduler, the flat `carousel`
 * included, and because a glide's record is skipped where it could not play and when a deck replays.
 *
 * The microtask is the expiry, as it is for those poses: an entry still here afterwards means nothing
 * replaced the deck, and a deck installed on this element later must start fresh. Reduced motion needs
 * nothing from this, since a deck starts paused under it anyway.
 */
const carriedPauses = new WeakSet<Element>()

/** Hand this element's pause to whichever deck replaces it in this task. O(1). */
function carryPause(el: Element): void {
  carriedPauses.add(el)
  queueMicrotask(() => carriedPauses.delete(el))
}

/**
 * A deck's `autoplay:` (and, for a spatial deck, `spin:`) with its `pause:` control: the periods,
 * the floor and its warning, the scheduler, and the `aria-pressed` the control carries.
 *
 * The deck-facing half of {@link createAutoMotion}, so the spatial decks and the flat `carousel`
 * read the same parameters, warn the same way and reflect pause the same way — the only things a
 * deck supplies are how it steps and, if it spins, how it advances.
 *
 * A pause carried over from the deck this one replaced is taken up only if there is a control to lift
 * it: a deck left stopped with no way to restart it would be worse than one that moves.
 *
 * @complexity O(1) at setup plus one scoped query for a named `pause:`; O(m) per pause toggle in the
 *   matched controls.
 */
export function createDeckMotion(request: DeckMotionRequest): DeckMotion {
  const { el, ctx, params, label, settleMs, step } = request
  const { spin, autoplay } = motionPeriods(request)
  const ledgers = new Map<Element, AttributeLedger>()
  const pauseSelector = resolveTarget(params.text('pause'), ctx, `${label} pause`)
  const startPaused = carriedPauses.delete(el) && pauseSelector !== '' && queryControls(el, ctx, pauseSelector).length > 0
  let paused = startPaused
  const holdHost = createHostPlayhead(ctx)
  const reflectPaused = (next: boolean): void => {
    paused = next
    holdHost(next)
    if (!pauseSelector) return
    for (const node of queryControls(el, ctx, pauseSelector)) {
      let ledger = ledgers.get(node)
      if (!ledger) {
        ledger = createAttributeLedger(node)
        ledgers.set(node, ledger)
      }
      ledger.set('aria-pressed', String(next))
    }
  }

  const motion = createAutoMotion({
    el,
    ctx,
    spinMs: spin,
    autoplayMs: autoplay,
    settleMs,
    pauseOnHover: !params.is('hover', 'none'),
    advance: request.spin?.advance,
    step,
    setSpinning: request.spin?.setSpinning,
    onAutoplayProgress: autoplay !== 0 ? request.onAutoplayProgress : undefined,
    onPausedChange: reflectPaused,
    startPaused,
  })

  let pause: ControlGroup | null = null
  if (pauseSelector && !motion.enabled) {
    ctx.warn(`${label} pause: has nothing to pause without ${request.spin ? 'spin: or ' : ''}autoplay:`)
  } else if (pauseSelector) {
    // Re-resolving an already-valid selector warns nothing, so an invalid one is named once.
    pause = bindControl({ el, ctx, params, label }, 'pause', () => motion.toggle())
  }

  return {
    motion,
    pause,
    release() {
      motion.release()
      for (const ledger of ledgers.values()) ledger.restore()
      ledgers.clear()
      if (paused) carryPause(el)
    },
  }
}
