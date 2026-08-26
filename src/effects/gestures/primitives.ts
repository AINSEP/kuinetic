import type { PrepareContext } from '../../core/effect-context.js'
import { deferPrepare } from '../../core/instances.js'
import { effectDurationMs } from '../../core/js-params.js'
import { recognise, rubberBand } from '../../core/gesture.js'
import type { GestureVector } from '../../core/gesture.js'
import { createSpringRunner, defaultSpringDeps, DEFAULT_SPRING } from '../../core/spring.js'
import type { SpringConfig, SpringDeps, SpringRunner } from '../../core/spring.js'
import type { Cleanup, EffectParams, ParameterSchema, Primitive } from '../../core/types.js'
import { withTimingContract } from '../shared.js'
import type { TimingToken } from '../shared.js'

/**
 * Gesture and physics primitives.
 *
 * This is the one category where the library genuinely has to own the frame loop. A throw starts
 * at whatever velocity the user's finger had, and no duration-plus-easing formulation can express
 * that — only a spring seeded with an initial velocity can.
 *
 * All are `reducedMotion: 'disable'`: a gesture that responds to touch is not decoration, and
 * shortening it would break the interaction rather than calm it. Under reduced motion the element
 * still moves with the finger; only the physics settle is skipped.
 */

const springParams: ParameterSchema = {
  stiffness: {
    type: 'number',
    default: '180',
    cssProperty: '--kui-stiffness',
    finite: true,
    minimum: 1,
    maximum: 10_000,
  },
  damping: {
    type: 'number',
    default: '24',
    cssProperty: '--kui-damping',
    finite: true,
    minimum: 0.1,
    maximum: 1_000,
  },
  mass: {
    type: 'number',
    default: '1',
    cssProperty: '--kui-mass',
    finite: true,
    minimum: 0.1,
  },
}

/**
 * What a gesture can and cannot be told about timing.
 *
 * `pressable` is the only member with a `duration`, and it does not mean what `duration` means
 * anywhere else in the catalog: it is the hold threshold — how long a press must last to count —
 * not how long a motion runs. Everything else here is driven by the finger's own position and
 * velocity, which is the point of the category (see this file's header on why no
 * duration-plus-easing formulation can express a flick). None of them has a start moment ahead of
 * the pointer arriving, so a `delay` has nothing to be relative to, and none of them runs on a
 * curve the author picks.
 */
const GESTURE_TIMING_REASON =
  'it is driven by pointer position and velocity, so it has no start moment and no authored curve'

function gesturePrimitive(
  id: string,
  channels: string[],
  parameters: ParameterSchema,
  prepare: NonNullable<Primitive['prepare']>,
): Primitive {
  // Read off the schema rather than passed in, because for this category the schema is already the
  // honest record: `pressable` is the one member that declares `duration` and the one member that
  // reads it. Nothing here declares `delay` or `ease`, so both are always refused.
  const honours: readonly TimingToken[] = Object.hasOwn(parameters, 'duration') ? ['duration'] : []
  return {
    id,
    renderer: 'javascript',
    channels,
    parameters,
    supportedTimelines: ['time', 'pointer'],
    supportedActivations: ['load', 'manual'],
    defaultActivation: 'load',
    perfClass: 'continuous',
    reducedMotion: 'disable',
    prepare: withTimingContract(id, { honours, because: GESTURE_TIMING_REASON }, prepare),
  }
}

function springFrom(params: EffectParams): SpringConfig {
  return {
    ...DEFAULT_SPRING,
    stiffness: params.num('stiffness', DEFAULT_SPRING.stiffness),
    damping: params.num('damping', DEFAULT_SPRING.damping),
    mass: params.num('mass', DEFAULT_SPRING.mass),
  }
}

/**
 * Use the effect reporter for defensive spring aborts as well as schema failures.
 *
 * @param ctx - Owning effect context.
 * @returns Realm frame dependencies connected to the effect warning sink.
 * @complexity O(1) time and space.
 * @overallScore 100
 */
function springDeps(ctx: PrepareContext): SpringDeps {
  return { ...defaultSpringDeps(), warn: ctx.warn }
}

/** Write a translation without touching the `transform` shorthand, so channels stay honest. */
function writeOffset(ctx: PrepareContext, x: number, y: number): void {
  ctx.style.set('translate', `${x.toFixed(2)}px ${y.toFixed(2)}px`)
}

interface DragRunners {
  x: SpringRunner
  y: SpringRunner
}

/**
 * Drag an element, optionally with bounds resistance, release inertia, and a spring return.
 *
 * Two independent springs rather than one two-dimensional solver: axis-locked drags then fall out
 * for free, and each axis can settle at its own rate without coupling.
 *
 * @complexity O(1) per pointer event and per frame; O(1) space.
 * @overallScore 100
 */
function prepareDraggable(el: Element, params: EffectParams, ctx: PrepareContext): Cleanup {
  const config = springFrom(params)
  const bounds = params.num('bounds', 0)
  const returns = params.is('return')
  const inertia = params.is('inertia')
  const resistance = params.num('resistance', 0.55)
  const momentum = params.num('momentum', 0.2)

  const offset = { x: 0, y: 0 }
  /*
   * Where the element already was when this gesture picked it up.
   *
   * `recognise` measures `dx`/`dy` from the current `pointerdown`, so they describe *this* drag,
   * not the element's position. Writing them straight into the offset therefore threw away every
   * previous drag: the first pickup worked, and the second snapped the element back to the origin
   * and ran from there — it stopped holding the point under the cursor. Only the three names that
   * do not spring back (`drag`, `drag-inertia`, `throwable`) showed it; `elastic-pull`,
   * `rubber-band` and `snap-back` return to zero on release, so their pickup offset is always zero
   * and the bug was invisible in exactly half the family.
   */
  const pickup = { x: 0, y: 0 }
  const deps = springDeps(ctx)
  const runners: DragRunners = {
    x: createSpringRunner(config, (value) => write({ ...offset, x: value }), deps),
    y: createSpringRunner(config, (value) => write({ ...offset, y: value }), deps),
  }

  function write(next: { x: number; y: number }): void {
    offset.x = next.x
    offset.y = next.y
    writeOffset(ctx, offset.x, offset.y)
  }

  const stopRecognising = recognise(
    el,
    {
      onStart() {
        runners.x.stop()
        runners.y.stop()
        // Read after `stop()`: a drag begun mid-throw picks up from where the spring had got to,
        // which is the position under the cursor, not where the throw was heading.
        pickup.x = offset.x
        pickup.y = offset.y
        el.setAttribute('data-kui-dragging', 'true')
      },
      onMove(vector) {
        // Resistance applies to total displacement from rest, not to this gesture's own delta —
        // a bounded element already pulled to its limit must not get a fresh budget on re-pickup.
        write({
          x: resist(pickup.x + vector.dx, bounds, resistance),
          y: resist(pickup.y + vector.dy, bounds, resistance),
        })
      },
      onEnd(vector) {
        el.setAttribute('data-kui-dragging', 'false')
        settle(runners, offset, vector, { returns, inertia, momentum })
      },
    },
    { axis: params.text('axis', 'both') as 'x' | 'y' | 'both' },
  )

  ctx.invalidate()

  return () => {
    stopRecognising()
    runners.x.stop()
    runners.y.stop()
    el.removeAttribute('data-kui-dragging')
  }
}

/** Past the bound, movement is damped rather than blocked; hard clamping reads as broken. */
function resist(delta: number, bounds: number, tension: number): number {
  return bounds > 0 ? rubberBand(delta, bounds, tension) : delta
}

/**
 * Decide where a released drag goes.
 *
 * @complexity O(1) time and space.
 * @overallScore 100
 */
function settle(
  runners: DragRunners,
  offset: { x: number; y: number },
  vector: GestureVector,
  mode: { returns: boolean; inertia: boolean; momentum: number },
): void {
  runners.x.set(offset.x, mode.inertia ? vector.vx : 0)
  runners.y.set(offset.y, mode.inertia ? vector.vy : 0)

  if (mode.returns) {
    runners.x.to(0)
    runners.y.to(0)
    return
  }
  /*
   * Free throw: target the position momentum would carry it to, so the spring decelerates instead
   * of snapping back.
   *
   * Gated on `inertia`, which it was not. The spring's *initial velocity* was already gated, but
   * the target was not, so `drag`, `drag-x` and `drag-y` — the three names whose whole contract is
   * "it stays where you put it" — still glided `vx * momentum` past the release point. Only a slow
   * release hid it, which is exactly what the browser suite happened to do: it paused 150ms before
   * `pointerup`, letting the velocity samples decay to nothing, and so asserted "rests exactly
   * where it was released" against the one release speed where the bug cannot show.
   */
  const carry = mode.inertia ? mode.momentum : 0
  runners.x.to(offset.x + vector.vx * carry)
  runners.y.to(offset.y + vector.vy * carry)
}

/**
 * Publish swipe direction as an attribute.
 *
 * An attribute rather than a callback keeps the whole category declarative: authors style
 * `[data-kui-swipe="left"]` instead of subscribing to anything.
 *
 * @complexity O(1) per pointer event; O(1) space.
 * @overallScore 100
 */
function prepareSwipeable(el: Element, params: EffectParams): Cleanup {
  const stop = recognise(
    el,
    {
      onSwipe(direction) {
        el.setAttribute('data-kui-swipe', direction)
      },
    },
    {
      axis: params.text('axis', 'both') as 'x' | 'y' | 'both',
      swipeVelocity: params.num('velocity', 300),
    },
  )

  return () => {
    stop()
    el.removeAttribute('data-kui-swipe')
  }
}

/**
 * Mark an element while it is being held.
 *
 * @complexity O(1) per pointer event; O(1) space.
 * @overallScore 100
 */
function preparePressable(el: Element, params: EffectParams): Cleanup {
  const stop = recognise(
    el,
    {
      onLongPress() {
        el.setAttribute('data-kui-pressed', 'true')
      },
      onEnd() {
        el.setAttribute('data-kui-pressed', 'false')
      },
    },
    { longPressMs: effectDurationMs(params, 500) },
  )

  return () => {
    stop()
    el.removeAttribute('data-kui-pressed')
  }
}

/**
 * Drift an element toward the pointer while it is within range.
 *
 * The spring is what separates this from a jittery `translate` written per mousemove: the element
 * lags slightly and settles, which is the entire effect.
 *
 * @complexity O(1) per pointer event and per frame; O(1) space.
 * @overallScore 100
 */
function prepareMagnetic(el: Element, params: EffectParams, ctx: PrepareContext): Cleanup {
  const node = el as HTMLElement
  const radius = params.num('radius', 120)
  const strength = params.num('strength', 0.35)
  const config = springFrom(params)
  const deps = springDeps(ctx)

  const offset = { x: 0, y: 0 }
  const runnerX = createSpringRunner(config, (value) => {
    offset.x = value
    writeOffset(ctx, offset.x, offset.y)
  }, deps)
  const runnerY = createSpringRunner(config, (value) => {
    offset.y = value
    writeOffset(ctx, offset.x, offset.y)
  }, deps)

  const onPointerMove = (event: PointerEvent): void => {
    const box = node.getBoundingClientRect()
    const dx = event.clientX - (box.left + box.width / 2)
    const dy = event.clientY - (box.top + box.height / 2)
    const inRange = Math.hypot(dx, dy) < radius
    runnerX.to(inRange ? dx * strength : 0)
    runnerY.to(inRange ? dy * strength : 0)
  }

  ctx.win.addEventListener('pointermove', onPointerMove as EventListener, { passive: true })

  return () => {
    ctx.win.removeEventListener('pointermove', onPointerMove as EventListener)
    runnerX.stop()
    runnerY.stop()
  }
}

export const GESTURE_PRIMITIVES: Primitive[] = [
  gesturePrimitive(
    'draggable',
    ['translate'],
    {
      ...springParams,
      axis: { type: 'keyword', default: 'both', cssProperty: '--kui-axis', values: ['x', 'y', 'both'] },
      bounds: { type: 'number', default: '0', cssProperty: '--kui-bounds' },
      return: {
        type: 'keyword',
        default: 'false',
        cssProperty: '--kui-return',
        values: ['true', 'false'],
      },
      inertia: {
        type: 'keyword',
        default: 'false',
        cssProperty: '--kui-inertia',
        values: ['true', 'false'],
      },
      resistance: {
        type: 'number',
        default: '0.55',
        cssProperty: '--kui-resistance',
        finite: true,
        minimum: 0,
        maximum: 1,
      },
      momentum: { type: 'number', default: '0.2', cssProperty: '--kui-momentum', finite: true },
    },
    deferPrepare(prepareDraggable),
  ),

  gesturePrimitive(
    'swipeable',
    ['state'],
    {
      axis: { type: 'keyword', default: 'both', cssProperty: '--kui-axis', values: ['x', 'y', 'both'] },
      velocity: { type: 'number', default: '300', cssProperty: '--kui-velocity' },
    },
    deferPrepare(prepareSwipeable),
  ),

  gesturePrimitive(
    'pressable',
    ['state'],
    { duration: { type: 'time', default: '500ms', cssProperty: '--kui-duration' } },
    // `duration` here is the hold threshold, not a span of motion — `long-press 800ms` means
    // "count it once the finger has been down for 800ms". It is read (see `preparePressable`), so
    // declaring it is what stops the contract above from warning about it.
    deferPrepare(preparePressable),
  ),

  gesturePrimitive(
    'magnetic',
    ['translate'],
    {
      ...springParams,
      radius: { type: 'number', default: '120', cssProperty: '--kui-radius' },
      strength: { type: 'number', default: '0.35', cssProperty: '--kui-strength' },
    },
    deferPrepare(prepareMagnetic),
  ),
]
