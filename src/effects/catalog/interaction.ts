import { inertInstance } from '../../core/types.js'
import type {
  Cleanup,
  EffectParams,
  ParameterSchema,
  Preset,
  Primitive,
  Renderer,
} from '../../core/types.js'
import type { PrepareContext } from '../../core/effect-context.js'
import type { Registry } from '../../core/registry.js'
import { deferPrepare } from '../../core/instances.js'
import { createStyleLedger } from '../../core/owned-styles.js'
import type { StyleLedger } from '../../core/owned-styles.js'
import { DEFAULT_SPRING, createSpringRunner, defaultSpringDeps } from '../../core/spring.js'
import type { SpringConfig, SpringDeps } from '../../core/spring.js'
import { parallaxOffset, supportsFineHover, tiltAngles } from './interaction-shared.js'

/**
 * Hover and pointer effects (catalog section I).
 *
 * Twelve names (`lift` through `icon-bounce`) are ordinary reversible hover/focus states — the
 * library's own `on:hover` activation only listens for `pointerenter`/`focusin` and never
 * un-triggers on leave (see `core/activation.ts`), which is right for a one-shot reveal but wrong
 * for a button that should visibly settle back down when the pointer moves away. These are
 * therefore registered with a no-op `prepare` purely so `data-dsg="lift"` parses, channel-conflicts,
 * and picks up author parameter overrides — the actual, fully reversible motion is native
 * `:hover`/`:focus-visible` CSS in `interaction.css`, gated to fine-pointer devices so a tap does
 * not leave an element stuck "hovered".
 *
 * The other seven (`tilt-3d`, `tilt-parallax`, `cursor-*`) genuinely need JavaScript: continuous
 * pointer position, not a two-state toggle. They wire their own `pointermove`/`pointerleave`
 * listeners in `prepare` — the same shape `gestures/primitives.ts` uses for `magnetic` — rather
 * than going through `on:hover` at all.
 */

// --- discrete hover/focus family: CSS-driven, JS renderer only for registry bookkeeping ---

const hoverTiming: ParameterSchema = {
  duration: { type: 'time', default: '220ms', cssProperty: '--dsg-duration' },
  ease: { type: 'easing', default: 'ease-out', cssProperty: '--dsg-ease' },
}

function hoverPrimitive(id: string, channels: string[]): Primitive {
  return {
    id,
    renderer: 'javascript' as Renderer,
    channels,
    parameters: hoverTiming,
    supportedTimelines: ['time'],
    supportedActivations: ['load'],
    defaultActivation: 'load',
    perfClass: 'compositor',
    // Not 'disable': a translate/box-shadow/rotate hover micro-interaction at this scale is not a
    // vestibular trigger the way parallax or continuous ambient motion is, and 'disable' would be
    // a no-op here regardless — the real motion lives in CSS transitions/`:hover`-scoped
    // animations, entirely outside this primitive's compiled (and here, unused) `animation-*` path.
    reducedMotion: 'shorten',
    prepare: () => inertInstance(),
  }
}

export const HOVER_PRIMITIVES: Primitive[] = [
  hoverPrimitive('lift', ['translate']),
  hoverPrimitive('lift-shadow', ['translate', 'shadow']),
  hoverPrimitive('shine-sweep', ['sweep']),
  hoverPrimitive('split-flap', ['rotate']),
  hoverPrimitive('border-draw', ['border']),
  hoverPrimitive('border-glow', ['shadow']),
  hoverPrimitive('beam-border', ['border']),
  hoverPrimitive('underline-slide', ['scale']),
  hoverPrimitive('underline-center', ['scale']),
  hoverPrimitive('icon-wiggle', ['rotate']),
  hoverPrimitive('icon-spin', ['rotate']),
  hoverPrimitive('icon-bounce', ['translate']),
]

export const HOVER_PRESETS: Preset[] = HOVER_PRIMITIVES.map((primitive) => ({
  name: primitive.id,
  primitive: primitive.id,
}))

// --- pointer-tracking family: real JS, continuous, reversible on leave ---

const springParams: ParameterSchema = {
  stiffness: {
    type: 'number',
    default: '260',
    cssProperty: '--dsg-stiffness',
    finite: true,
    minimum: 1,
    maximum: 10_000,
  },
  damping: {
    type: 'number',
    default: '26',
    cssProperty: '--dsg-damping',
    finite: true,
    minimum: 0.1,
    maximum: 1_000,
  },
}

function pointerPrimitive(
  id: string,
  channels: string[],
  parameters: ParameterSchema,
  prepare: Primitive['prepare'],
): Primitive {
  return {
    id,
    renderer: 'javascript' as Renderer,
    channels,
    parameters,
    supportedTimelines: ['time', 'pointer'],
    supportedActivations: ['load', 'manual'],
    defaultActivation: 'load',
    perfClass: 'continuous',
    // A tilt or cursor-follow effect only exists while the pointer is present; there is no
    // meaningful "shortened" version of tracking a position. `prepare` itself checks
    // `supportsFineHover` and no-ops on touch, which is the coarse-pointer half of this rule.
    reducedMotion: 'disable',
    prepare,
  }
}

/** Read the effect's own spring config from validated params, same shape as `gestures`' own. */
function springFrom(params: EffectParams): SpringConfig {
  return {
    ...DEFAULT_SPRING,
    stiffness: params.num('stiffness', DEFAULT_SPRING.stiffness),
    damping: params.num('damping', DEFAULT_SPRING.damping),
  }
}

function springDepsFor(ctx: PrepareContext): SpringDeps {
  return { ...defaultSpringDeps(), warn: ctx.warn }
}

/**
 * Rotate a card in 3D toward the pointer, and back to flat on leave or blur.
 *
 * The rotation is written directly (no spring) while the pointer is moving — a follower that lags
 * behind the cursor reads as sluggish for a tilt, unlike a magnetic pull, which is supposed to
 * lag. The CSS `transition` on `transform`, toggled between a short "tracking" duration and a
 * longer "settle" duration, is what gives the reset its own distinct, softer motion.
 *
 * @complexity O(1) per pointer event; O(1) space.
 * @overallScore 100
 */
function prepareTilt3d(el: Element, params: EffectParams, ctx: PrepareContext): Cleanup {
  if (!supportsFineHover(ctx.win)) return () => {}
  const node = el as HTMLElement
  const maxAngle = params.num('maxAngle', 14)
  const perspective = params.text('perspective', '800px')

  function writeAngles(rotateX: number, rotateY: number, transitionMs: number): void {
    ctx.style.set('transition', `transform ${transitionMs}ms ease-out`)
    ctx.style.set(
      'transform',
      `perspective(${perspective}) rotateX(${rotateX.toFixed(2)}deg) rotateY(${rotateY.toFixed(2)}deg)`,
    )
  }

  function onMove(event: PointerEvent): void {
    const rect = node.getBoundingClientRect()
    const point = { x: event.clientX - rect.left, y: event.clientY - rect.top }
    const { rotateX, rotateY } = tiltAngles(point, rect, maxAngle)
    writeAngles(rotateX, rotateY, 100)
  }
  function reset(): void {
    writeAngles(0, 0, 400)
  }
  function onFocus(): void {
    writeAngles(-maxAngle / 2, maxAngle / 2, 250)
  }

  node.addEventListener('pointermove', onMove, { passive: true })
  node.addEventListener('pointerleave', reset, { passive: true })
  node.addEventListener('focus', onFocus)
  node.addEventListener('blur', reset)

  return () => {
    node.removeEventListener('pointermove', onMove)
    node.removeEventListener('pointerleave', reset)
    node.removeEventListener('focus', onFocus)
    node.removeEventListener('blur', reset)
  }
}

interface ParallaxLayer {
  ledger: StyleLedger
  depth: number
}

/** Read every `[data-depth]` descendant once, each getting its own restore ledger. */
function collectParallaxLayers(node: HTMLElement): ParallaxLayer[] {
  return [...node.querySelectorAll<HTMLElement>('[data-depth]')].map((layer) => ({
    ledger: createStyleLedger(layer),
    depth: Number(layer.dataset.depth) || 0,
  }))
}

function writeParallaxLayers(layers: ParallaxLayer[], x: number, y: number, transitionMs: number): void {
  for (const layer of layers) {
    layer.ledger.set('transition', `translate ${transitionMs}ms ease-out`)
    layer.ledger.set('translate', `${(x * layer.depth).toFixed(2)}px ${(y * layer.depth).toFixed(2)}px`)
  }
}

/**
 * Move a card's `[data-depth]` children opposite the pointer, each scaled by its own depth, for a
 * multi-layer parallax tilt. Layers are discovered once at prepare time — the same one-time-query
 * shape `flip.ts`'s snapshot model uses, rather than re-querying the DOM on every pointer event.
 *
 * @complexity O(1) time per pointer event in a fixed layer count; O(d) space in layer count.
 * @overallScore 100
 */
function prepareTiltParallax(el: Element, params: EffectParams, ctx: PrepareContext): Cleanup {
  if (!supportsFineHover(ctx.win)) return () => {}
  const node = el as HTMLElement
  const strength = params.num('strength', 24)
  const layers = collectParallaxLayers(node)

  function onMove(event: PointerEvent): void {
    const rect = node.getBoundingClientRect()
    const point = { x: event.clientX - rect.left, y: event.clientY - rect.top }
    const offset = parallaxOffset(point, rect, strength)
    writeParallaxLayers(layers, offset.x, offset.y, 120)
  }
  function reset(): void {
    writeParallaxLayers(layers, 0, 0, 400)
  }

  node.addEventListener('pointermove', onMove, { passive: true })
  node.addEventListener('pointerleave', reset, { passive: true })
  node.addEventListener('focus', reset)
  node.addEventListener('blur', reset)

  return () => {
    node.removeEventListener('pointermove', onMove)
    node.removeEventListener('pointerleave', reset)
    node.removeEventListener('focus', reset)
    node.removeEventListener('blur', reset)
    for (const layer of layers) layer.ledger.restore()
  }
}

interface CursorDotRunners {
  x: ReturnType<typeof createSpringRunner>
  y: ReturnType<typeof createSpringRunner>
}

function writeDotPosition(dot: HTMLElement, x: number, y: number): void {
  dot.style.translate = `${x.toFixed(1)}px ${y.toFixed(1)}px`
}

/** Build the synthetic follower element shared by `cursor-follow`/`-lag`/`-label`/`-invert`. */
function createCursorDot(doc: Document, dotClass: string, labelText: string): HTMLElement {
  const dot = doc.createElement('span')
  dot.className = `dsg-cursor-dot ${dotClass}`
  dot.setAttribute('aria-hidden', 'true')
  if (labelText) dot.textContent = labelText
  doc.body.append(dot)
  return dot
}

function createCursorRunners(dot: HTMLElement, config: SpringConfig, deps: SpringDeps): CursorDotRunners {
  const position = { x: 0, y: 0 }
  const onAxis = (axis: 'x' | 'y') => (value: number) => {
    position[axis] = value
    writeDotPosition(dot, position.x, position.y)
  }
  return {
    x: createSpringRunner(config, onAxis('x'), deps),
    y: createSpringRunner(config, onAxis('y'), deps),
  }
}

/**
 * Spring a synthetic dot toward the pointer while hovering, powering `cursor-follow` (tight
 * spring), `cursor-lag` (loose spring, a visible trail), `cursor-label` (same follow, with text),
 * and `cursor-invert` (same follow, a `mix-blend-mode` CSS class). One function, four presets that
 * differ only in spring stiffness/damping and a CSS class — the spring itself is `core/spring.ts`,
 * not reimplemented here.
 *
 * On focus the dot jumps to the element's centre instead of tracking, since a keyboard has no
 * pointer position to follow — the nearest equivalent state a focus can offer.
 *
 * @complexity O(1) per pointer event and per spring frame; O(1) space beyond the one dot element.
 * @overallScore 100
 */
function prepareCursorDot(el: Element, params: EffectParams, ctx: PrepareContext, dotClass: string): Cleanup {
  if (!supportsFineHover(ctx.win)) return () => {}
  const doc = el.ownerDocument
  const node = el as HTMLElement
  const dot = createCursorDot(doc, dotClass, params.text('label', ''))
  const runners = createCursorRunners(dot, springFrom(params), springDepsFor(ctx))

  function show(): void {
    dot.classList.add('dsg-cursor-dot-active')
  }
  function hide(): void {
    dot.classList.remove('dsg-cursor-dot-active')
  }
  function onMove(event: PointerEvent): void {
    show()
    runners.x.to(event.clientX)
    runners.y.to(event.clientY)
  }
  function onFocus(): void {
    const rect = node.getBoundingClientRect()
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    show()
    runners.x.set(cx)
    runners.y.set(cy)
    writeDotPosition(dot, cx, cy)
  }

  node.addEventListener('pointermove', onMove, { passive: true })
  node.addEventListener('pointerleave', hide, { passive: true })
  node.addEventListener('focus', onFocus)
  node.addEventListener('blur', hide)

  return () => {
    node.removeEventListener('pointermove', onMove)
    node.removeEventListener('pointerleave', hide)
    node.removeEventListener('focus', onFocus)
    node.removeEventListener('blur', hide)
    runners.x.stop()
    runners.y.stop()
    dot.remove()
  }
}

/**
 * Publish the pointer position as `--dsg-x`/`--dsg-y` custom properties for `cursor-spotlight`'s
 * `radial-gradient` to read — direct 1:1 tracking rather than a spring, since a light source
 * lagging behind the cursor reads as broken rather than smooth.
 *
 * @complexity O(1) per pointer event; O(1) space.
 * @overallScore 100
 */
function prepareSpotlight(el: Element, params: EffectParams, ctx: PrepareContext): Cleanup {
  if (!supportsFineHover(ctx.win)) return () => {}
  const node = el as HTMLElement
  // The glow overlay is `position: absolute; inset: 0`, keyed off `::before` in CSS — it needs a
  // positioned ancestor to anchor to. Only claimed when the author left `position` at its
  // default: an already-positioned element (absolute/fixed/sticky, used for the author's own
  // layout) is left alone rather than silently overridden.
  if (ctx.win.getComputedStyle(node).position === 'static') ctx.style.set('position', 'relative')

  function writeSpot(x: string, y: string, on: boolean): void {
    ctx.style.set('--dsg-x', x)
    ctx.style.set('--dsg-y', y)
    ctx.style.set('--dsg-spotlight-opacity', on ? '1' : '0')
  }
  function onMove(event: PointerEvent): void {
    const rect = node.getBoundingClientRect()
    writeSpot(`${(event.clientX - rect.left).toFixed(1)}px`, `${(event.clientY - rect.top).toFixed(1)}px`, true)
  }
  function hide(): void {
    writeSpot('50%', '50%', false)
  }
  function onFocus(): void {
    writeSpot('50%', '50%', true)
  }

  node.addEventListener('pointermove', onMove, { passive: true })
  node.addEventListener('pointerleave', hide, { passive: true })
  node.addEventListener('focus', onFocus)
  node.addEventListener('blur', hide)

  return () => {
    node.removeEventListener('pointermove', onMove)
    node.removeEventListener('pointerleave', hide)
    node.removeEventListener('focus', onFocus)
    node.removeEventListener('blur', hide)
  }
}

const tiltParams: ParameterSchema = {
  maxAngle: { type: 'number', default: '14', cssProperty: '--dsg-max-angle' },
  perspective: { type: 'length', default: '800px', cssProperty: '--dsg-perspective' },
}

const parallaxParams: ParameterSchema = {
  strength: { type: 'number', default: '24', cssProperty: '--dsg-strength' },
}

const cursorDotParams: ParameterSchema = {
  ...springParams,
  label: { type: 'text', default: '', cssProperty: '--dsg-label' },
}

export const POINTER_PRIMITIVES: Primitive[] = [
  pointerPrimitive('tilt-3d', ['rotate'], tiltParams, deferPrepare(prepareTilt3d)),
  pointerPrimitive('tilt-parallax', ['translate'], parallaxParams, deferPrepare(prepareTiltParallax)),
  pointerPrimitive('cursor-follow', ['translate'], cursorDotParams, deferPrepare(prepareCursorFollow)),
  pointerPrimitive('cursor-lag', ['translate'], cursorDotParams, deferPrepare(prepareCursorLag)),
  pointerPrimitive('cursor-label', ['translate'], cursorDotParams, deferPrepare(prepareCursorLabel)),
  pointerPrimitive('cursor-invert', ['translate'], cursorDotParams, deferPrepare(prepareCursorInvert)),
  pointerPrimitive('cursor-spotlight', ['spotlight'], {}, deferPrepare(prepareSpotlight)),
]

function prepareCursorFollow(el: Element, params: EffectParams, ctx: PrepareContext): Cleanup {
  return prepareCursorDot(el, params, ctx, 'dsg-cursor-dot-follow')
}
function prepareCursorLag(el: Element, params: EffectParams, ctx: PrepareContext): Cleanup {
  return prepareCursorDot(el, params, ctx, 'dsg-cursor-dot-lag')
}
function prepareCursorLabel(el: Element, params: EffectParams, ctx: PrepareContext): Cleanup {
  return prepareCursorDot(el, params, ctx, 'dsg-cursor-dot-label')
}
function prepareCursorInvert(el: Element, params: EffectParams, ctx: PrepareContext): Cleanup {
  return prepareCursorDot(el, params, ctx, 'dsg-cursor-dot-invert')
}

export const POINTER_PRESETS: Preset[] = [
  { name: 'tilt-3d', primitive: 'tilt-3d' },
  { name: 'tilt-parallax', primitive: 'tilt-parallax' },
  { name: 'cursor-follow', primitive: 'cursor-follow', params: { stiffness: '300', damping: '30' } },
  { name: 'cursor-lag', primitive: 'cursor-lag', params: { stiffness: '80', damping: '14' } },
  { name: 'cursor-label', primitive: 'cursor-label', params: { stiffness: '260', damping: '26', label: 'View' } },
  { name: 'cursor-spotlight', primitive: 'cursor-spotlight' },
  { name: 'cursor-invert', primitive: 'cursor-invert', params: { stiffness: '260', damping: '26' } },
]

export const INTERACTION_PRIMITIVES: Primitive[] = [...HOVER_PRIMITIVES, ...POINTER_PRIMITIVES]
export const INTERACTION_PRESETS: Preset[] = [...HOVER_PRESETS, ...POINTER_PRESETS]

/**
 * Register the hover and pointer catalog (section I).
 *
 * A standalone top-level registration, the same shape as `registerGestures`/`registerThreeD`, so
 * wiring it into `createRegistry()` never has to touch the shared `catalog/index.ts` aggregator.
 *
 * @param registry - Registry to populate.
 * @returns The same registry, for chaining.
 * @complexity O(n) time in registered primitives and presets.
 * @overallScore 100
 */
export function registerInteraction(registry: Registry): Registry {
  return registry.registerPrimitives(INTERACTION_PRIMITIVES).registerPresets(INTERACTION_PRESETS)
}
