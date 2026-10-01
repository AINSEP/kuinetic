import { VIEWER_EVENT } from '../core/deck-viewer.js'
import type { ViewerDetail } from '../core/deck-viewer.js'
import type { PrepareContext } from '../core/effect-context.js'
import { createAttributeLedger } from '../core/owned-styles.js'
import type { AttributeLedger } from '../core/owned-styles.js'
import { queryControls, resolveTarget } from '../core/target.js'
import type { Cleanup, EffectParams, ParamSpec } from '../core/types.js'
import { bindControl } from './step-index.js'
import type { ControlGroup } from './step-index.js'

/**
 * A deck that moves on its own: continuous `spin:` and stepped `autoplay:`.
 *
 * Shared by every deck in the library — the spatial ones (`carousel/deck.ts`) and the flat
 * `carousel`/`step-progress` index (`forms/primitives.ts`). It lived in `carousel/` while only the
 * spatial decks had motion; it moved here, beside `step-index.ts` and `swipe-event.ts`, when the
 * flat deck gained `autoplay:`, because a second copy of the pause rules below is exactly the drift
 * this module exists to prevent. Nothing in it knows about positions or shapes: the deck hands in
 * how to `step` (and, for a spatial deck, how to `advance` by a fraction).
 *
 * Both are the same question asked at two grains — "when nobody is touching the deck, where does it
 * go next?" — and both have to answer the same four follow-ups identically, which is why they share
 * one scheduler rather than each growing its own: when to stop (hover, keyboard focus, a hidden tab,
 * offscreen, reduced motion, the author's pause control), how to yield to a person (a drag or a
 * control press takes over, then the motion resumes from wherever the deck was left), how to hand
 * the transition back and forth (a frame-driven spin must not also be eased), and how to tear down.
 *
 * ## Why `requestAnimationFrame` writing the deck's own position, and not a CSS animation
 *
 * The obvious CSS answer — register `--kui-step-position` with `@property` and run an infinite
 * linear `@keyframes` over it — fails the one requirement that matters most here: a drag, a click
 * and the spin must all move *one* number. A CSS animation owns its value; the drag would have to
 * read the animated position back out of `getComputedStyle` at `pointerdown`, cancel the animation,
 * drive the deck from JavaScript, and then restart the keyframe at a negative `animation-delay`
 * computed to land on wherever the release settled. That is two sources of truth reconciled by
 * arithmetic on every hand-off, and the "no snap-back when spin resumes" requirement is precisely
 * the bug that reconciliation produces when it is off by one frame.
 *
 * Writing the continuous `position` the deck already has (the same number the drag moves and the
 * controls set) makes the hand-off free: pausing is "stop adding to it", resuming is "start adding
 * to it again", and a drag in between simply moved it. It costs nothing the CSS route would have
 * saved — an animated custom property is recomputed on the main thread either way, because the
 * geometry reading it is a `calc()` the compositor cannot run.
 *
 * `autoplay:` does not need frames at all: it is a timer that presses "next", and the stylesheet's
 * own transition does the travel, exactly as it does for a click. Same model as
 * `showcase/slideshow.ts`'s `autoplay:`, whose pause rules this mirrors.
 */

/**
 * The shortest period either kind of motion may be set to, in milliseconds.
 *
 * The same floor `slideshow`'s `autoplay:` has and for the same reason: below it, content moves
 * faster than it can be read, and a whole ring turning in under two seconds is a strobe rather than
 * a carousel. Clamped with a warning rather than refused, so a typo still produces a working deck.
 */
export const MIN_PERIOD_MS = 2000

/**
 * The longest frame a spin will integrate over, in milliseconds.
 *
 * A dropped frame or a debugger pause otherwise arrives as one enormous `dt` and the ring leaps.
 * Capping it turns a hitch into a brief slow-down, which is the less surprising failure. Resuming
 * from a pause never relies on this — the first frame after a resume only records its timestamp.
 */
export const MAX_FRAME_MS = 100

/**
 * An authored signed period, floored to {@link MIN_PERIOD_MS} in magnitude.
 *
 * Pure and exported so the clamp and the sign rule are assertable without a clock. `0` means off
 * and stays `0`; the sign is the direction and survives the clamp.
 *
 * @param ms - Authored period in milliseconds; negative runs backwards.
 * @returns The period to run at, or `0` for off.
 * @complexity O(1) time and space.
 */
export function clampPeriod(ms: number): number {
  if (!Number.isFinite(ms) || ms === 0) return 0
  return Math.sign(ms) * Math.max(MIN_PERIOD_MS, Math.abs(ms))
}

/**
 * How far one frame advances the deck, in whole cycles of it.
 *
 * A cycle is every slide passing once — one revolution of a full ring. Expressed in cycles rather
 * than places so the rate an author writes (`spin:40s`) is independent of how many slides there
 * are: adding a card to a 40-second ring keeps it a 40-second ring rather than slowing each card.
 *
 * @param dtMs - Milliseconds since the previous frame, before capping.
 * @param periodMs - Signed milliseconds per cycle; non-zero.
 * @complexity O(1) time and space.
 */
export function cyclesFor(dtMs: number, periodMs: number): number {
  return Math.min(Math.max(dtMs, 0), MAX_FRAME_MS) / periodMs
}

export interface AutoMotionRequest {
  el: Element
  ctx: PrepareContext
  /** Signed milliseconds per full cycle of continuous spin, already clamped; `0` is off. */
  spinMs: number
  /** Signed milliseconds between autoplay steps, already clamped; `0` is off. */
  autoplayMs: number
  /** How long a manual move takes to settle, so the motion does not resume mid-transition. */
  settleMs: number
  /** Whether the pointer resting on the deck pauses it. Omitted, it does. See `HOVER_PARAM`. */
  pauseOnHover?: boolean
  /** Move the deck on by a (signed) fraction of a full cycle. */
  advance(cycles: number): void
  /** Step the deck one place. */
  step(direction: 1 | -1): void
  /** Publish whether frames, rather than the stylesheet's transition, are driving the deck. */
  setSpinning(spinning: boolean): void
  /** Called whenever the author-facing paused state changes, to mirror it onto pause controls. */
  onPausedChange(paused: boolean): void
}

export interface AutoMotion {
  /** Whether any motion was configured at all. */
  readonly enabled: boolean
  /** A person moved the deck: hand the transition back and hold off for one settle period. */
  interrupt(): void
  /** A gesture is (or is no longer) in progress; nothing moves on its own while one is. */
  hold(holding: boolean): void
  /** The author's pause control was pressed. */
  toggle(): void
  release: Cleanup
}

/**
 * Whether a focus event is keyboard focus — the kind that should pause the deck.
 *
 * `slideshow` pauses on any focus inside it; this deck refines that, because its host is itself
 * focusable (`carousel/drag.ts` grants `tabindex="0"`) and a mouse press on a focusable element focuses it.
 * Pausing on that would mean one click on a spinning ring stops it until the visitor clicks
 * somewhere else — a drag could never hand back to the spin at all. `:focus-visible` is the
 * platform's own answer to "did this focus come from the keyboard", so a Tab still pauses (which is
 * what the rule is for: nobody can read or operate a card that is moving under the focus ring) and a
 * press is left to the hover rule, which already covers it.
 *
 * A realm that cannot parse the selector (older engines, jsdom) throws from `matches`; that is
 * answered as "keyboard" — the conservative reading, which pauses.
 *
 * @complexity O(1) time and space.
 */
function isKeyboardFocus(target: EventTarget | null): boolean {
  const node = target as Element | null
  if (typeof node?.matches !== 'function') return true
  try {
    return node.matches(':focus-visible')
  } catch {
    return true
  }
}

/**
 * Start the deck's own motion and return the handle its manual inputs talk to.
 *
 * @returns A controller; `enabled` is false (and every method inert) when neither motion was set.
 * @complexity O(1) per event and per frame; O(1) space.
 */
// A factory closing over one deck's motion state — several small named closures plus wiring, the
// same shape as `carousel/drag.ts`'s `createRingDrag` and `core/gesture.ts`'s `recognise`.
// eslint-disable-next-line max-lines-per-function
export function createAutoMotion(request: AutoMotionRequest): AutoMotion {
  const { el, ctx, spinMs, autoplayMs, settleMs, advance, step, setSpinning, onPausedChange } =
    request
  const pauseOnHover = request.pauseOnHover ?? true
  const enabled = spinMs !== 0 || autoplayMs !== 0
  if (!enabled) {
    return {
      enabled,
      interrupt() {},
      hold() {},
      toggle() {},
      release() {},
    }
  }

  const win = ctx.win
  /*
   * Reduced motion starts paused rather than disabling the feature, which is `slideshow`'s rule:
   * nothing moves on its own, and a visitor who presses the author's play control has asked for
   * motion explicitly — a request the preference exists to respect, not to overrule.
   */
  let userPaused = ctx.reducedMotion
  let hovered = false
  let focused = false
  let onscreen = true
  let gesture = false
  let held = false
  /*
   * The shared viewer is showing one of this deck's cards (`kui:viewer`, `core/deck-viewer.ts`).
   * One more reason beside the others rather than a press of the author's pause, so closing the
   * viewer lifts only its own reason: a deck the visitor paused stays paused.
   *
   * Paging inside the viewer does not move the deck — the gallery keeps its own index — so on close
   * the deck carries on from the card it was showing. It does not "catch up" on the steps it
   * skipped: autoplay re-arms a full period (the pending step was cleared on open, not suspended),
   * and spin's first frame after a resume only records the clock, so nothing leaps.
   */
  let viewing = false
  /** The shared viewer is open at all, from this deck or any other opener. See `onFocusIn`. */
  let viewerOpen = false
  let focusBeforeViewer = false

  let frame = 0
  let lastFrameAt: number | null = null
  // The realm's own timers (`win.setTimeout`), so a test can hand in a clock; typed as the DOM's
  // number handle, which is what `Window#setTimeout` returns.
  let timer: number | null = null
  let holdTimer: number | null = null
  let spinning = false

  const active = (): boolean =>
    !userPaused && !hovered && !focused && onscreen && !gesture && !held && !viewing && !ctx.doc.hidden

  const requestFrame = (callback: (now: number) => void): number =>
    typeof win.requestAnimationFrame === 'function'
      ? win.requestAnimationFrame(callback)
      : (win.setTimeout(() => callback(Date.now()), 16) as unknown as number)
  const cancelFrame = (handle: number): void => {
    if (typeof win.cancelAnimationFrame === 'function') win.cancelAnimationFrame(handle)
    else win.clearTimeout(handle)
  }

  const publishSpinning = (next: boolean): void => {
    if (next === spinning) return
    spinning = next
    setSpinning(next)
  }

  const tick = (now: number): void => {
    frame = 0
    if (!active()) return
    // The first frame after a start or a resume only records the clock. Integrating from the last
    // frame *before* the pause would move the deck by however long it was paused for — the very
    // snap this scheduler exists to avoid.
    if (lastFrameAt !== null) advance(cyclesFor(now - lastFrameAt, spinMs))
    lastFrameAt = now
    frame = requestFrame(tick)
  }

  /** Start the frame loop, unless it is already running. */
  const startSpin = (): void => {
    if (frame !== 0) return
    publishSpinning(true)
    lastFrameAt = null
    frame = requestFrame(tick)
  }
  const stopSpin = (): void => {
    if (frame !== 0) cancelFrame(frame)
    frame = 0
    publishSpinning(false)
  }

  /** Arm the next autoplay step, unless one is already pending. */
  const armAutoplay = (): void => {
    if (timer !== null) return
    timer = win.setTimeout(() => {
      timer = null
      step(autoplayMs > 0 ? 1 : -1)
      update()
    }, Math.abs(autoplayMs))
  }
  const clearAutoplay = (): void => {
    if (timer === null) return
    win.clearTimeout(timer)
    timer = null
  }

  function update(): void {
    const running = active()
    if (spinMs !== 0) (running ? startSpin : stopSpin)()
    if (autoplayMs !== 0) (running ? armAutoplay : clearAutoplay)()
  }

  const onEnter = (): void => { hovered = true; update() }
  const onLeave = (): void => { hovered = false; update() }
  /*
   * Focus arriving while the shared viewer is open is the viewer handing focus back, not a person
   * tabbing in: a modal dialog makes the rest of the page inert, so nobody can reach the deck from
   * the keyboard until it has closed. `<dialog>.close()` restores focus to whatever had it before
   * (on a deck, the host a click focused) synchronously, before the `close` event the shell
   * announces `kui:viewer` from — so the open flag is still up when that focus lands. After an
   * Escape the browser marks even mouse-origin focus `:focus-visible`. Count restoration only if
   * the deck had keyboard focus before opening: a keyboard reader must keep their pause reason.
   */
  const onFocusIn = (event: Event): void => {
    focused = (!viewerOpen || focusBeforeViewer) && isKeyboardFocus(event.target)
    update()
  }
  const onFocusOut = (event: Event): void => {
    // Remember keyboard focus before the modal takes it, so restoration keeps that pause reason.
    if (!viewerOpen) focusBeforeViewer = focused
    const next = (event as FocusEvent).relatedTarget as Node | null
    focused = next !== null && el.contains(next) && isKeyboardFocus(next)
    update()
  }
  const onVisibility = (): void => update()
  // On the document, like `kui:swipe`: a close whose card was removed is announced there. There is
  // one viewer per document, so any close ends this deck's reason, and an open is this deck's only
  // when it came from inside it (`contains` is inclusive of the deck's own element).
  const onViewer = (event: Event): void => {
    const open = (event as CustomEvent<Partial<ViewerDetail> | null>).detail?.open === true
    viewerOpen = open
    viewing = open && el.contains(event.target as Node)
    update()
  }

  // `hover:none` takes away this one reason and nothing else: keyboard focus, the pause control,
  // reduced motion, a hidden tab and the rest still stop the deck.
  if (pauseOnHover) {
    el.addEventListener('pointerenter', onEnter)
    el.addEventListener('pointerleave', onLeave)
  }
  el.addEventListener('focusin', onFocusIn)
  el.addEventListener('focusout', onFocusOut)
  ctx.doc.addEventListener('visibilitychange', onVisibility)
  ctx.doc.addEventListener(VIEWER_EVENT, onViewer)

  /*
   * Offscreen is a pause, not an optimisation. A spinning ring scrolled out of view that kept
   * spinning would come back somewhere arbitrary; paused, it comes back where the visitor left it.
   * A realm with no observer is treated as always on screen — the motion still works, it just does
   * not stop.
   */
  const Observer = (win as Window & { IntersectionObserver?: typeof IntersectionObserver })
    .IntersectionObserver
  const observer = Observer
    ? new Observer((entries) => {
        for (const entry of entries) onscreen = entry.isIntersecting
        update()
      })
    : null
  observer?.observe(el)

  onPausedChange(userPaused)
  update()

  return {
    enabled,
    interrupt() {
      held = true
      if (holdTimer !== null) win.clearTimeout(holdTimer)
      holdTimer = win.setTimeout(() => {
        holdTimer = null
        held = false
        update()
      }, Math.max(0, settleMs))
      update()
    },
    hold(holding) {
      gesture = holding
      update()
    },
    toggle() {
      userPaused = !userPaused
      onPausedChange(userPaused)
      update()
    },
    release() {
      if (frame !== 0) cancelFrame(frame)
      frame = 0
      if (timer !== null) win.clearTimeout(timer)
      if (holdTimer !== null) win.clearTimeout(holdTimer)
      timer = null
      holdTimer = null
      observer?.disconnect()
      el.removeEventListener('pointerenter', onEnter)
      el.removeEventListener('pointerleave', onLeave)
      el.removeEventListener('focusin', onFocusIn)
      el.removeEventListener('focusout', onFocusOut)
      ctx.doc.removeEventListener('visibilitychange', onVisibility)
      ctx.doc.removeEventListener(VIEWER_EVENT, onViewer)
      publishSpinning(false)
    },
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

/**
 * A deck's `autoplay:` (and, for a spatial deck, `spin:`) with its `pause:` control: the periods,
 * the floor and its warning, the scheduler, and the `aria-pressed` the control carries.
 *
 * The deck-facing half of {@link createAutoMotion}, so the spatial decks and the flat `carousel`
 * read the same parameters, warn the same way and reflect pause the same way — the only things a
 * deck supplies are how it steps and, if it spins, how it advances.
 *
 * @complexity O(1) at setup plus one scoped query for a named `pause:`; O(m) per pause toggle in the
 *   matched controls.
 */
export function createDeckMotion(request: DeckMotionRequest): DeckMotion {
  const { el, ctx, params, label, settleMs, step } = request
  const { spin, autoplay } = motionPeriods(request)
  const ledgers = new Map<Element, AttributeLedger>()
  const pauseSelector = resolveTarget(params.text('pause'), ctx, `${label} pause`)
  const reflectPaused = (paused: boolean): void => {
    if (!pauseSelector) return
    for (const node of queryControls(el, ctx, pauseSelector)) {
      let ledger = ledgers.get(node)
      if (!ledger) {
        ledger = createAttributeLedger(node)
        ledgers.set(node, ledger)
      }
      ledger.set('aria-pressed', String(paused))
    }
  }

  const motion = createAutoMotion({
    el,
    ctx,
    spinMs: spin,
    autoplayMs: autoplay,
    settleMs,
    pauseOnHover: !params.is('hover', 'none'),
    advance: request.spin?.advance ?? (() => {}),
    step,
    setSpinning: request.spin?.setSpinning ?? (() => {}),
    onPausedChange: reflectPaused,
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
    },
  }
}
