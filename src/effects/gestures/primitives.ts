import type { PrepareContext } from '../../core/effect-context.js'
import { deferredInstance } from '../../core/instances.js'
import { recognise, rubberBand } from '../../core/gesture.js'
import type { GestureVector } from '../../core/gesture.js'
import { createSpringRunner, defaultSpringDeps, DEFAULT_SPRING } from '../../core/spring.js'
import type { SpringConfig, SpringRunner } from '../../core/spring.js'
import type { Cleanup, EffectParams, ParameterSchema, Primitive } from '../../core/types.js'

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
  stiffness: { type: 'number', default: '180', cssProperty: '--dsg-stiffness' },
  damping: { type: 'number', default: '24', cssProperty: '--dsg-damping' },
}

function gesturePrimitive(
  id: string,
  channels: string[],
  parameters: ParameterSchema,
  prepare: Primitive['prepare'],
): Primitive {
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
    prepare,
  }
}

function springFrom(params: EffectParams): SpringConfig {
  return {
    ...DEFAULT_SPRING,
    stiffness: params.num('stiffness', DEFAULT_SPRING.stiffness),
    damping: params.num('damping', DEFAULT_SPRING.damping),
  }
}

/** Write a translation without touching the `transform` shorthand, so channels stay honest. */
function writeOffset(node: HTMLElement, x: number, y: number): void {
  node.style.translate = `${x.toFixed(2)}px ${y.toFixed(2)}px`
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
  const node = el as HTMLElement
  const config = springFrom(params)
  const bounds = params.num('bounds', 0)
  const returns = params.is('return')
  const inertia = params.is('inertia')

  const offset = { x: 0, y: 0 }
  const deps = defaultSpringDeps()
  const runners: DragRunners = {
    x: createSpringRunner(config, (value) => write({ ...offset, x: value }), deps),
    y: createSpringRunner(config, (value) => write({ ...offset, y: value }), deps),
  }

  function write(next: { x: number; y: number }): void {
    offset.x = next.x
    offset.y = next.y
    writeOffset(node, offset.x, offset.y)
  }

  const stopRecognising = recognise(
    el,
    {
      onStart() {
        runners.x.stop()
        runners.y.stop()
        el.setAttribute('data-dsg-dragging', 'true')
      },
      onMove(vector) {
        write({ x: resist(vector.dx, bounds), y: resist(vector.dy, bounds) })
      },
      onEnd(vector) {
        el.setAttribute('data-dsg-dragging', 'false')
        settle(runners, offset, vector, { returns, inertia })
      },
    },
    { axis: params.text('axis', 'both') as 'x' | 'y' | 'both' },
  )

  ctx.invalidate()

  return () => {
    stopRecognising()
    runners.x.stop()
    runners.y.stop()
    node.style.removeProperty('translate')
    el.removeAttribute('data-dsg-dragging')
  }
}

/** Past the bound, movement is damped rather than blocked; hard clamping reads as broken. */
function resist(delta: number, bounds: number): number {
  return bounds > 0 ? rubberBand(delta, bounds) : delta
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
  mode: { returns: boolean; inertia: boolean },
): void {
  runners.x.set(offset.x, mode.inertia ? vector.vx : 0)
  runners.y.set(offset.y, mode.inertia ? vector.vy : 0)

  if (mode.returns) {
    runners.x.to(0)
    runners.y.to(0)
    return
  }
  // Free throw: target the position momentum would carry it to, so the spring decelerates
  // instead of snapping back.
  runners.x.to(offset.x + vector.vx * 0.2)
  runners.y.to(offset.y + vector.vy * 0.2)
}

/**
 * Publish swipe direction as an attribute.
 *
 * An attribute rather than a callback keeps the whole category declarative: authors style
 * `[data-dsg-swipe="left"]` instead of subscribing to anything.
 *
 * @complexity O(1) per pointer event; O(1) space.
 * @overallScore 100
 */
function prepareSwipeable(el: Element, params: EffectParams): Cleanup {
  const stop = recognise(
    el,
    {
      onSwipe(direction) {
        el.setAttribute('data-dsg-swipe', direction)
      },
    },
    {
      axis: params.text('axis', 'both') as 'x' | 'y' | 'both',
      swipeVelocity: params.num('velocity', 300),
    },
  )

  return () => {
    stop()
    el.removeAttribute('data-dsg-swipe')
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
        el.setAttribute('data-dsg-pressed', 'true')
      },
      onEnd() {
        el.setAttribute('data-dsg-pressed', 'false')
      },
    },
    { longPressMs: params.ms('duration', 500) },
  )

  return () => {
    stop()
    el.removeAttribute('data-dsg-pressed')
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
  const deps = defaultSpringDeps()

  const offset = { x: 0, y: 0 }
  const runnerX = createSpringRunner(config, (value) => {
    offset.x = value
    writeOffset(node, offset.x, offset.y)
  }, deps)
  const runnerY = createSpringRunner(config, (value) => {
    offset.y = value
    writeOffset(node, offset.x, offset.y)
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
    node.style.removeProperty('translate')
  }
}

export const GESTURE_PRIMITIVES: Primitive[] = [
  gesturePrimitive(
    'draggable',
    ['translate'],
    {
      ...springParams,
      axis: { type: 'keyword', default: 'both', cssProperty: '--dsg-axis', values: ['x', 'y', 'both'] },
      bounds: { type: 'number', default: '0', cssProperty: '--dsg-bounds' },
      return: {
        type: 'keyword',
        default: 'false',
        cssProperty: '--dsg-return',
        values: ['true', 'false'],
      },
      inertia: {
        type: 'keyword',
        default: 'false',
        cssProperty: '--dsg-inertia',
        values: ['true', 'false'],
      },
    },
    (el, params, ctx) => deferredInstance(() => prepareDraggable(el, params, ctx)),
  ),

  gesturePrimitive(
    'swipeable',
    ['state'],
    {
      axis: { type: 'keyword', default: 'both', cssProperty: '--dsg-axis', values: ['x', 'y', 'both'] },
      velocity: { type: 'number', default: '300', cssProperty: '--dsg-velocity' },
    },
    (el, params) => deferredInstance(() => prepareSwipeable(el, params)),
  ),

  gesturePrimitive(
    'pressable',
    ['state'],
    { duration: { type: 'time', default: '500ms', cssProperty: '--dsg-duration' } },
    (el, params) => deferredInstance(() => preparePressable(el, params)),
  ),

  gesturePrimitive(
    'magnetic',
    ['translate'],
    {
      ...springParams,
      radius: { type: 'number', default: '120', cssProperty: '--dsg-radius' },
      strength: { type: 'number', default: '0.35', cssProperty: '--dsg-strength' },
    },
    (el, params, ctx) => deferredInstance(() => prepareMagnetic(el, params, ctx)),
  ),
]
