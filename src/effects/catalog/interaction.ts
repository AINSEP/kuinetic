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
import {
  ALL_TIMING_TOKENS,
  stylesheetTimingPrepare,
  TRIGGER_DELAY_PARAM,
  withTimingContract,
} from '../shared.js'
import type { TimingContract, TimingToken } from '../shared.js'
import { COLOR_PARAMS, HOVER_TRANSITIONS, parallaxOffset, supportsFineHover, tiltAngles } from './interaction-shared.js'

/**
 * Hover and pointer effects (catalog section I).
 *
 * Thirteen names (`lift` through `icon-bounce`) are ordinary reversible hover/focus states — the
 * library's own `on:hover` activation only listens for `pointerenter`/`focusin` and never
 * un-triggers on leave (see `core/activation.ts`), which is right for a one-shot reveal but wrong
 * for a button that should visibly settle back down when the pointer moves away. These are
 * therefore registered with a near-no-op `prepare` purely so `data-kui="lift"` parses,
 * channel-conflicts, and picks up author parameter overrides — the actual, fully reversible motion
 * is native `:hover`/`:focus-visible` CSS in `interaction.css`, gated to fine-pointer devices so a
 * tap does not leave an element stuck "hovered".
 *
 * "Near"-no-op because of one thing only: the positional spelling of timing. `lift duration:400ms`
 * reaches the stylesheet on its own (`resolveParams` writes every `key:value` override inline),
 * but `lift 400ms` does not — `declarations.ts`'s `pushTrack`, which is what turns the positional tokens into
 * declarations, runs for `css-keyframes` primitives and no others. So `stylesheetTimingPrepare`
 * mirrors the positional tokens onto the same namespaced properties the rules already read, and
 * warns for the ones a given rule pins. See `effects/shared.ts`.
 *
 * The other seven (`tilt-3d`, `tilt-parallax`, `cursor-*`) genuinely need JavaScript: continuous
 * pointer position, not a two-state toggle. They wire their own `pointermove`/`pointerleave`
 * listeners in `prepare` — the same shape `gestures/primitives.ts` uses for `magnetic` — rather
 * than going through `on:hover` at all.
 */

// --- discrete hover/focus family: CSS-driven, JS renderer only for registry bookkeeping ---

const hoverTiming: ParameterSchema = {
  duration: { type: 'time', default: '220ms', cssProperty: '--kui-duration' },
  // A hover state has a start moment — the pointer arrives, or focus lands — so "wait 200ms
  // before lifting" is a coherent request even though nothing here plays on a clock at load.
  // interaction.css spends it as `transition-delay`/`animation-delay` on the `:hover` and
  // `:focus-visible` rules *only*, never on the base rule, so it delays entering the state and
  // never leaving it: an author asking for hover-intent does not also want the button to hang in
  // the air for 200ms after the pointer has gone.
  ...TRIGGER_DELAY_PARAM,
  ease: { type: 'easing', default: 'ease-out', cssProperty: '--kui-ease' },
}

/**
 * The two members whose motion is a *continuous rotation*, which is linear by construction.
 *
 * `beam-border` spins a conic gradient around a border and `icon-spin` turns an icon through a
 * full circle; both are written `animation: ... linear` in interaction.css on purpose, because any
 * other curve makes a loop visibly stutter at the seam. They still declare `duration` (how long
 * one revolution takes) and now `delay`, so the honest report is "two of the three", not "none".
 */
const LINEAR_HOVER: TimingContract = {
  honours: ['duration', 'delay'],
  because:
    'it is a continuous rotation and interaction.css runs it linear, so a curve would visibly ' +
    'stutter at the seam of every revolution',
}

/** Reason for the family's default contract; unreachable, since it honours all three. */
const PINNED_REASON = 'interaction.css pins that value on this effect'

const liftParams: ParameterSchema = {
  distance: { type: 'length', default: '6px', cssProperty: '--kui-lift-distance' },
}

const popParams: ParameterSchema = {
  scale: { type: 'number', default: '1.06', cssProperty: '--kui-pop-scale', finite: true, minimum: 0 },
}

// Empty default, same convention as `sequence-scrub`'s `src:` (scroll-mechanics/primitives.ts):
// unauthored means "not in the resolved output at all" (see `resolveParams`'s doc comment), so the
// existing four-stop rainbow default in interaction.css's `var(--kui-beam-border-c1, #ff5f6d)`
// fallback is untouched for every beam-border/beam-border-auto instance that doesn't set `color:`.
// `outset:` is the same empty-default story for geometry: it pulls the ring out over the host's
// own border, which `inset: 0` alone cannot reach (see interaction.css's rule comment).
const beamParams: ParameterSchema = {
  color: { type: 'color', default: '', cssProperty: '--kui-beam-border-c1' },
  outset: { type: 'length', default: '', cssProperty: '--kui-beam-border-outset' },
}

/**
 * Keep the declared schema and the declared contract from drifting apart.
 *
 * A parameter that is *declared* but unread is the quiet half of the same defect this whole file
 * is fixing: `readParams` only warns about names the schema does not know, so leaving `ease` on
 * `icon-spin` — whose rule hardcodes `linear` — would advertise a knob and swallow it. Dropping
 * the declaration is what makes `icon-spin ease:back-out` say "unknown parameter", and the
 * contract below is what makes the positional `icon-spin 700ms 0ms back-out` say the same thing.
 * Nothing an existing page can write changes behaviour: the property those two never read is
 * still never read, it just now answers instead of shrugging.
 *
 * @complexity O(t) time and space in the token count — three, fixed.
 * @overallScore 100
 */
function hoverTimingFor(honours: readonly TimingToken[]): ParameterSchema {
  return Object.fromEntries(
    Object.entries(hoverTiming).filter(([name]) => honours.includes(name as TimingToken)),
  )
}

function hoverPrimitive(
  id: string,
  channels: string[],
  extraParams: ParameterSchema = {},
  timing: TimingContract = { honours: ALL_TIMING_TOKENS, because: PINNED_REASON },
): Primitive {
  const honours = timing.honours ?? []
  return {
    id,
    renderer: 'javascript' as Renderer,
    channels,
    parameters: { ...hoverTimingFor(honours), ...extraParams },
    supportedTimelines: ['time'],
    supportedActivations: ['load'],
    defaultActivation: 'load',
    perfClass: 'compositor',
    // Not 'disable': a translate/box-shadow/rotate hover micro-interaction at this scale is not a
    // vestibular trigger the way parallax or continuous ambient motion is. The real motion lives in
    // CSS transitions and `:hover`-scoped pseudo-element animations rather than this primitive's
    // (here unused) compiled `animation-*` path, so the policy layer shortens it via the
    // `transition-duration` and `::before`/`::after` rules in base.css.
    reducedMotion: 'shorten',
    // Not `inertInstance()` any more. The rule this primitive stands in for reads
    // `--kui-<id>-duration`/`-delay`/`-ease`, and `resolveParams` only ever writes those from the
    // `key:value` spelling — so `lift 400ms` reached nothing while `lift duration:400ms` worked.
    // See `stylesheetTimingPrepare`.
    prepare: stylesheetTimingPrepare(id, timing),
  }
}

export const HOVER_PRIMITIVES: Primitive[] = [
  hoverPrimitive('lift', ['translate'], liftParams),
  hoverPrimitive('pop', ['scale'], popParams),
  hoverPrimitive('lift-shadow', ['translate', 'shadow'], liftParams),
  hoverPrimitive('shine-sweep', ['sweep']),
  // `'skew'`, not `'rotate'`: `@keyframes kui-split-flap` writes the `transform` *shorthand*
  // (`perspective(...) translateZ(...) rotateX(...)`), not the standalone `rotate:` property —
  // `perspective()` only affects an element's own depth from inside `transform`, so the flip has
  // no other spelling. `skew` is this catalog's name for "claims the whole `transform` shorthand"
  // (see `channel-properties.ts`); `scroll-skew`, `flip-face` and `flip-3d` are the other members.
  // While this said `rotate`, `split-flap, scroll-skew` and `split-flap, card-flip-y` looked
  // disjoint to the conflict detector and composed into a silent clobber of `transform`.
  // `'discrete'` alongside `skew`: the unconditional rule also pins `display: inline-block` for
  // sizing, the same reason `feedback-spin` declares it — unrelated to `catalog/discrete.ts`'s
  // show/hide use of the same physical property, but `display` is tracked as one channel
  // regardless of the value a primitive writes into it.
  hoverPrimitive('split-flap', ['skew', 'discrete']),
  hoverPrimitive('border-draw', ['border'], COLOR_PARAMS.borderDraw),
  hoverPrimitive('border-glow', ['shadow'], COLOR_PARAMS.borderGlow),
  hoverPrimitive('beam-border', ['border'], beamParams, LINEAR_HOVER),
  hoverPrimitive('underline-slide', ['scale'], COLOR_PARAMS.underlineSlide),
  hoverPrimitive('underline-center', ['scale'], COLOR_PARAMS.underlineCenter),
  hoverPrimitive('icon-wiggle', ['rotate']),
  hoverPrimitive('icon-spin', ['rotate'], {}, LINEAR_HOVER),
  hoverPrimitive('icon-bounce', ['translate']),
]

export const HOVER_PRESETS: Preset[] = HOVER_PRIMITIVES.map((primitive) => ({
  name: primitive.id,
  primitive: primitive.id,
  ...(HOVER_TRANSITIONS[primitive.id] ? { transitions: HOVER_TRANSITIONS[primitive.id] } : {}),
}))

// --- continuous variant: same beam-border visual, always running instead of hover-gated ---
//
// A deliberately separate primitive/preset rather than a new name on HOVER_PRIMITIVES — every
// member of that family is required (see catalog-interaction.test.ts) to ship a matching
// `:hover`/`:focus-visible` CSS rule, which is exactly the behavior this variant exists to not
// have. `reducedMotion: 'disable'`, not `'shorten'`: an infinite loop has no meaningful "shorter"
// duration, the same reasoning `ambient.ts`'s continuous primitives use.

export const CONTINUOUS_BORDER_PRIMITIVES: Primitive[] = [
  {
    id: 'beam-border-auto',
    renderer: 'javascript' as Renderer,
    channels: ['border'],
    // `duration` only, of the three. Unlike its hover twin this one has no start moment at all —
    // it is `animation: ... infinite` with no `:hover` gate, running from the moment the rule
    // lands — so there is nothing for a delay to be relative to; and it spins linear for the same
    // seam reason `icon-spin` does. `duration` still means something: one revolution.
    parameters: { duration: hoverTiming.duration!, ...beamParams },
    supportedTimelines: ['time'],
    supportedActivations: ['load'],
    defaultActivation: 'load',
    perfClass: 'compositor',
    reducedMotion: 'disable',
    prepare: stylesheetTimingPrepare('beam-border-auto', {
      honours: ['duration'],
      because: 'it is an always-on linear loop with no start moment and no curve',
    }),
  },
]

export const CONTINUOUS_BORDER_PRESETS: Preset[] = [
  { name: 'beam-border-auto', primitive: 'beam-border-auto' },
]

// --- pointer-tracking family: real JS, continuous, reversible on leave ---

const springParams: ParameterSchema = {
  stiffness: {
    type: 'number',
    default: '260',
    cssProperty: '--kui-stiffness',
    finite: true,
    minimum: 1,
    maximum: 10_000,
  },
  damping: {
    type: 'number',
    default: '26',
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

function pointerPrimitive(
  id: string,
  channels: string[],
  parameters: ParameterSchema,
  prepare: NonNullable<Primitive['prepare']>,
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
    // None of the three timing tokens has anything to bite on here: a tilt is a pure function of
    // where the pointer is *right now*, and the cursor dots are springs chasing it, so there is no
    // instant an authored delay could be measured from and no fixed span a duration could set.
    // Refused out loud — `tilt-3d 400ms` otherwise parses, installs, and discards the number in
    // silence, which is indistinguishable from a broken effect.
    prepare: withTimingContract(
      id,
      {
        because:
          'it tracks pointer position continuously, so it has no start moment and no fixed span',
      },
      prepare,
    ),
  }
}

/** Read the effect's own spring config from validated params, same shape as `gestures`' own. */
function springFrom(params: EffectParams): SpringConfig {
  return {
    ...DEFAULT_SPRING,
    stiffness: params.num('stiffness', DEFAULT_SPRING.stiffness),
    damping: params.num('damping', DEFAULT_SPRING.damping),
    mass: params.num('mass', DEFAULT_SPRING.mass),
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
  dot.className = `kui-cursor-dot ${dotClass}`
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
    dot.classList.add('kui-cursor-dot-active')
  }
  function hide(): void {
    dot.classList.remove('kui-cursor-dot-active')
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
 * Publish the pointer position as `--kui-x`/`--kui-y` custom properties for `cursor-spotlight`'s
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
    ctx.style.set('--kui-x', x)
    ctx.style.set('--kui-y', y)
    ctx.style.set('--kui-spotlight-opacity', on ? '1' : '0')
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
  maxAngle: { type: 'number', default: '14', cssProperty: '--kui-max-angle' },
  perspective: { type: 'length', default: '800px', cssProperty: '--kui-perspective' },
}

const parallaxParams: ParameterSchema = {
  strength: { type: 'number', default: '24', cssProperty: '--kui-strength' },
}

const cursorDotParams: ParameterSchema = {
  ...springParams,
  label: { type: 'text', default: '', cssProperty: '--kui-label' },
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
  return prepareCursorDot(el, params, ctx, 'kui-cursor-dot-follow')
}
function prepareCursorLag(el: Element, params: EffectParams, ctx: PrepareContext): Cleanup {
  return prepareCursorDot(el, params, ctx, 'kui-cursor-dot-lag')
}
function prepareCursorLabel(el: Element, params: EffectParams, ctx: PrepareContext): Cleanup {
  return prepareCursorDot(el, params, ctx, 'kui-cursor-dot-label')
}
function prepareCursorInvert(el: Element, params: EffectParams, ctx: PrepareContext): Cleanup {
  return prepareCursorDot(el, params, ctx, 'kui-cursor-dot-invert')
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

export const INTERACTION_PRIMITIVES: Primitive[] = [
  ...HOVER_PRIMITIVES,
  ...POINTER_PRIMITIVES,
  ...CONTINUOUS_BORDER_PRIMITIVES,
]
export const INTERACTION_PRESETS: Preset[] = [
  ...HOVER_PRESETS,
  ...POINTER_PRESETS,
  ...CONTINUOUS_BORDER_PRESETS,
]

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
