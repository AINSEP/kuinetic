import { attributeChannel, SUBTREE_CHANNEL } from '../core/types.js'
import type { EffectParams, ParameterSchema, PrepareContext, Preset, Primitive } from '../core/types.js'
import { continuousSetup, deferPrepare } from '../core/instances.js'
import type { SetupResult } from '../core/instances.js'
import { createAttributeLedger, createStyleLedger } from '../core/owned-styles.js'
import { withTimingContract } from '../effects/shared.js'
import { widgetPrimitive } from './shared.js'

/**
 * `compare` — before/after media comparison slider (Phase 3).
 *
 * Stacks two media elements (img, picture, or video) in a grid and lays a full-size
 * native range input over them. Moving the slider adjusts `--kui-compare`, which clips
 * the "after" media element via `clip-path: inset(...)` and translates the visible handle
 * divider on the compositor thread.
 *
 * Three or more media children make one frame split by N−1 dividers — see `buildMulti`. Two stay
 * exactly the slider described above (`buildPair`).
 *
 * `autoplay:` makes the divider sweep by itself (`duration`, `reverse`, `loop`) until someone grabs
 * it — see `bindAutoDrag`.
 */

const COMPARE_AXES = ['x', 'y'] as const

export const COMPARE_AXIS_ATTR = 'data-kui-compare-axis'
/** Stamped only on a frame of three or more media: the number of dividers. Absent for a pair. */
export const COMPARE_DIVIDERS_ATTR = 'data-kui-compare-dividers'

const compareParams: ParameterSchema = {
  position: {
    type: 'percentage',
    default: '50%',
    cssProperty: '--kui-compare',
  },
  /*
   * Where each divider of a three-or-more frame starts, as one quoted, space-separated list —
   * `positions:'20% 45% 80%'` — because a comma would start a new step, not a new value. Default
   * (empty) is an even split. `position:` stays the two-media spelling: it is a single percentage
   * and every existing page relies on it validating as one.
   */
  positions: { type: 'text', default: '', cssProperty: '--kui-compare-positions' },
  axis: {
    type: 'keyword',
    default: 'x',
    cssProperty: '--kui-compare-axis',
    keywords: [...COMPARE_AXES],
  },
  /*
   * The auto-drag, in `background-media`'s words (`src/effects/catalog/media.ts`): `always` starts
   * at load, `in-view` the first time the slider is on screen, `never` (default) not at all.
   *
   * Not `on:load` / `on:enter`, because the activation grammar already has a job here: it is what
   * *builds* the slider, and a widget accepts only `on:load` (`src/showcase/shared.ts`) so the
   * control exists before a keyboard user tabs to it. `on:enter` would defer the widget, not the
   * motion — so the motion's start is its own parameter.
   */
  autoplay: {
    type: 'keyword',
    default: 'never',
    cssProperty: '--kui-compare-autoplay',
    keywords: ['never', 'in-view', 'always'],
  },
  /** One edge-to-edge sweep. The positional spelling (`compare 4s`) means the same thing. */
  duration: { type: 'time', default: '3s', cssProperty: '--kui-compare-duration' },
  /** Head toward 0% first instead of 100%. */
  reverse: { type: 'keyword', default: 'false', cssProperty: '--kui-compare-reverse', keywords: ['true', 'false'] },
  /** Sweep back and forth until someone takes the handle, instead of one pass. */
  loop: { type: 'keyword', default: 'false', cssProperty: '--kui-compare-loop', keywords: ['true', 'false'] },
}

/** Below this a sweep is a flicker between the two images, not a comparison. */
export const MIN_SWEEP_MS = 250
/**
 * The longest step one frame may take. A tab returning from the background hands the next frame a
 * gap of however long it was hidden; integrating that whole gap would jump the divider.
 */
export const MAX_FRAME_MS = 100

const VERTICAL_KEY_DELTA: Readonly<Record<string, number | undefined>> = { ArrowUp: -1, ArrowDown: 1 }

function getMediaName(item: Element, fallback: string): string {
  const alt = item.localName === 'picture'
    ? item.querySelector('img')?.getAttribute('alt')
    : item.getAttribute('alt')
  return alt?.trim() || item.getAttribute('aria-label')?.trim() ||
    item.getAttribute('title')?.trim() || fallback
}

function resolveCompareLabel(el: Element, media: Element[]): string {
  const authored = el.getAttribute('aria-label')?.trim()
  if (authored) return authored
  const first = media[0]
  const second = media[1]
  if (first && second) {
    return `Compare: ${getMediaName(first, 'Before')} / ${getMediaName(second, 'After')}`
  }
  return 'Compare'
}

function createRange(
  doc: Document,
  label: { name: string; valueText: string },
  value: number,
  axis: string,
): HTMLInputElement {
  const range = doc.createElement('input')
  range.type = 'range'
  range.className = 'kui-compare-range'
  range.min = '0'
  range.max = '100'
  range.step = '1'
  range.value = String(value)
  range.setAttribute('aria-label', label.name)
  range.setAttribute('aria-valuetext', label.valueText)
  // The y range is laid out vertical-lr (0 at the top) in CSS; say so to AT as well.
  if (axis === 'y') range.setAttribute('aria-orientation', 'vertical')
  return range
}

function createHandle(doc: Document): HTMLElement {
  const handle = doc.createElement('span')
  handle.className = 'kui-compare-handle'
  handle.setAttribute('aria-hidden', 'true')
  return handle
}

/**
 * Browsers disagree on which way ArrowUp moves a vertical range, so the y axis pins it: ArrowUp
 * moves the divider up (value toward 0, the top), ArrowDown moves it down.
 */
function verticalKeys(range: HTMLInputElement, axis: string, onInput: () => void): (event: KeyboardEvent) => void {
  return (event) => {
    const delta = VERTICAL_KEY_DELTA[event.key]
    if (axis !== 'y' || delta === undefined) return
    event.preventDefault()
    if (delta < 0) range.stepDown()
    else range.stepUp()
    onInput()
  }
}

/**
 * Where the divider sits after travelling `phase` along the sweep.
 *
 * One cycle is `phase` 0→200: 0% out to 100% and back, eased at each edge (a cosine), so the
 * divider slows into a turn the way a hand would rather than bouncing off the frame.
 */
function sweepPercent(phase: number): number {
  return 50 - 50 * Math.cos((Math.PI * phase) / 100)
}

/** The phase at which the sweep passes `percent` heading toward 100% (or 0% when `reverse`). */
function startPhase(percent: number, reverse: boolean): number {
  const outbound = (100 / Math.PI) * Math.acos(1 - percent / 50)
  return reverse ? 200 - outbound : outbound
}

/** The authored sweep length — positional first, as `lightbox` reads it — floored at `MIN_SWEEP_MS`. */
function sweepDuration(params: EffectParams, ctx: PrepareContext): number {
  const authored = params.timing.durationMs ?? params.ms('duration', 3000)
  if (authored >= MIN_SWEEP_MS) return authored
  ctx.warn(`compare duration: minimum is ${MIN_SWEEP_MS}ms; clamped to ${MIN_SWEEP_MS}ms`)
  return MIN_SWEEP_MS
}

interface AutoDragTiming {
  mode: string
  durationMs: number
  reverse: boolean
  loop: boolean
}

interface AutoDragOptions extends AutoDragTiming {
  host: Element
  /** Anything a person presses or focuses to take over. Grabbing any one stops the motion. */
  grab: readonly Element[]
  ctx: PrepareContext
  /** Move divider `index`: its style variable and its range's own value. */
  write(index: number, percent: number): void
  /** Each divider's resting place, which its sweep starts from and returns to. */
  homes: readonly number[]
  /** Each divider's travel: its neighbours' resting places, or the frame's edges. */
  bounds: readonly (readonly [number, number])[]
}

/**
 * Move the dividers by themselves until someone takes one.
 *
 * Each divider in turn runs one full cycle from its resting place — out to its far neighbour,
 * across to the near one, home again — then the next divider goes. With one divider that is the
 * whole frame, edge to edge. In sequence rather than all together because a comparison is between
 * two neighbours: one moving wipe says "this against that", several at once say nothing a viewer
 * can follow. `reverse` starts from the last divider heading toward 0%; `loop` keeps cycling.
 *
 * A `pointerdown` or focus on any of `grab` ends the motion for good: the moment a person is holding
 * a handle, nothing else may move it. Off screen it pauses and resumes where it left off —
 * `carousel`'s spin rule — and under reduced motion it never starts.
 *
 * @returns A teardown that cancels any pending frame and disconnects the observer.
 * @complexity O(1) per frame.
 */
function bindAutoDrag(options: AutoDragOptions): () => void {
  const { host, grab, ctx, mode, loop } = options
  if (mode === 'never' || ctx.reducedMotion) return () => {}
  // `stop` is declared below; the run only calls this once a frame has played, long after.
  const run = runAutoDrag(options, () => stop())
  /*
   * Only `in-view` and a loop need to know where the slider is: a single `always` pass runs its
   * course whether or not anyone scrolled to it, which is what "starts at load" means. A realm with
   * no observer is treated as always on screen — the motion still runs, it just never pauses.
   */
  let observer: IntersectionObserver | null = null
  if (mode === 'in-view' || loop) {
    observer = observeOnscreen(ctx.win, host, run.setOnscreen)
  }

  const stop = (): void => {
    run.stop()
    observer?.disconnect()
    observer = null
    for (const target of grab) {
      target.removeEventListener('pointerdown', stop)
      target.removeEventListener('focus', stop)
    }
  }
  for (const target of grab) {
    target.addEventListener('pointerdown', stop)
    target.addEventListener('focus', stop)
  }
  run.setOnscreen(mode === 'always' || observer === null)
  return stop
}

/**
 * The sweep as a function of time: which divider is moving, and where it is.
 *
 * @returns `show(elapsed)`, which writes the moving divider for that moment — or, past the end of a
 *   single pass, parks it home and reports `false`.
 */
function sweepPlan(options: AutoDragOptions): { show(elapsed: number): boolean } {
  const { write, homes, bounds, durationMs, reverse, loop } = options
  const order = homes.map((_, index) => index)
  if (reverse) order.reverse()
  const cycleMs = 2 * durationMs
  const totalMs = cycleMs * order.length
  const phases = homes.map((home, index) => {
    const [lo, hi] = bounds[index]!
    return hi > lo ? startPhase((100 * (home - lo)) / (hi - lo), reverse) : 0
  })
  const park = (slot: number): void => write(order[slot]!, homes[order[slot]!]!)
  let slot = 0

  return {
    show(elapsed) {
      if (!loop && elapsed >= totalMs) {
        park(slot)
        return false
      }
      const into = elapsed % totalMs
      const next = Math.floor(into / cycleMs)
      // Handing over to the next divider: park the last one exactly home, not a frame short of it.
      if (next !== slot) park(slot)
      slot = next
      const index = order[slot]!
      const [lo, hi] = bounds[index]!
      const phase = phases[index]! + (100 * (into - slot * cycleMs)) / durationMs
      write(index, lo + ((hi - lo) * sweepPercent(phase)) / 100)
      return true
    },
  }
}

/**
 * Report on-screen changes for `host`, or `null` in a realm with no observer.
 *
 * @complexity O(1) time and space.
 */
function observeOnscreen(win: Window, host: Element, onChange: (onscreen: boolean) => void): IntersectionObserver | null {
  const Observer = (win as Window & { IntersectionObserver?: typeof IntersectionObserver })
    .IntersectionObserver
  if (!Observer) return null
  const observer = new Observer((entries) => {
    for (const entry of entries) onChange(entry.isIntersecting)
  })
  observer.observe(host)
  return observer
}

interface AutoDragRun {
  /** Run while on screen, pause while not. Nothing moves until the first call. */
  setOnscreen(onscreen: boolean): void
  /** Stop for good, cancelling any pending frame. */
  stop(): void
}

/**
 * The frame loop: advances the clock while running, freezes it while paused.
 *
 * @complexity O(1) per frame.
 */
function runAutoDrag(options: AutoDragOptions, finish: () => void): AutoDragRun {
  const win = options.ctx.win
  const plan = sweepPlan(options)
  let elapsed = 0
  let lastFrameAt: number | null = null
  let frame = 0
  let done = false
  let onscreen = false

  const update = (): void => {
    const active = !done && onscreen
    if (active && frame === 0) {
      // The first frame after a start or a resume only records the clock, so a pause is not a jump.
      lastFrameAt = null
      frame = win.requestAnimationFrame(tick)
    } else if (!active && frame !== 0) {
      win.cancelAnimationFrame(frame)
      frame = 0
    }
  }
  function tick(now: number): void {
    frame = 0
    if (lastFrameAt !== null) elapsed += Math.min(now - lastFrameAt, MAX_FRAME_MS)
    lastFrameAt = now
    if (plan.show(elapsed)) frame = win.requestAnimationFrame(tick)
    else finish()
  }

  return {
    setOnscreen(next) {
      onscreen = next
      update()
    },
    stop() {
      done = true
      update()
    },
  }
}

interface BuildOptions {
  el: Element
  media: Element[]
  params: EffectParams
  ctx: PrepareContext
  axis: string
  timing: AutoDragTiming
}

/** The two-media slider: one full-size native range, one handle, `--kui-compare` on the host. */
function buildPair({ el, media, params, ctx, axis, timing }: BuildOptions): () => void {
  const initialPercent = Math.round(params.num('position', 0.5) * 100)
  const style = createStyleLedger(el)
  style.set('--kui-compare', params.text('position', '50%'))

  const doc = el.ownerDocument
  const range = createRange(
    doc,
    { name: resolveCompareLabel(el, media), valueText: `${initialPercent}% after` },
    initialPercent,
    axis,
  )
  const handle = createHandle(doc)

  const onInput = (): void => {
    const val = range.value
    style.set('--kui-compare', `${val}%`)
    range.setAttribute('aria-valuetext', `${val}% after`)
  }
  // The auto-drag writes the variable unrounded, so the divider glides rather than stepping a
  // whole percent at a time; the range itself only holds whole steps.
  const writeAuto = (_index: number, percent: number): void => {
    range.value = String(Math.round(percent))
    style.set('--kui-compare', `${Number(percent.toFixed(3))}%`)
    range.setAttribute('aria-valuetext', `${range.value}% after`)
  }
  const onKeyDown = verticalKeys(range, axis, onInput)
  range.addEventListener('input', onInput)
  range.addEventListener('keydown', onKeyDown)

  el.appendChild(range)
  el.appendChild(handle)

  const stopAutoDrag = bindAutoDrag({
    ...timing,
    host: el,
    grab: [range],
    ctx,
    write: writeAuto,
    homes: [params.num('position', 0.5) * 100],
    bounds: [[0, 100]],
  })

  return () => {
    stopAutoDrag()
    range.removeEventListener('input', onInput)
    range.removeEventListener('keydown', onKeyDown)
    range.remove()
    handle.remove()
    style.restore()
  }
}

const PERCENT_TOKEN = /^(\d+(?:\.\d+)?)%$/

/**
 * The starting dividers of an N-media frame: the authored `positions:` list when it is usable, an
 * even split otherwise. Whole percents, because each divider is also a `step="1"` range whose
 * `min`/`max` are its neighbours — a fractional neighbour would shift that range's step base.
 */
function resolvePositions(authored: string, count: number, warn: (message: string) => void): number[] {
  const even = Array.from({ length: count }, (_, k) => Math.round((100 * (k + 1)) / (count + 1)))
  if (authored.trim() === '') return even
  const tokens = authored.trim().split(/\s+/)
  const values = tokens.map((token) => PERCENT_TOKEN.exec(token)?.[1])
  const numbers = values.map(Number)
  const usable =
    tokens.length === count &&
    values.every((value) => value !== undefined) &&
    numbers.every((value, k) => value <= 100 && (k === 0 || value >= numbers[k - 1]!))
  if (usable) return numbers.map(Math.round)
  const example = even.map((value) => String(value) + '%').join(' ')
  warn(
    `compare positions: expected ${count} ascending percentages between 0% and 100% for ` +
      `${count + 1} media (e.g. positions:'${example}'); using an even split`,
  )
  return even
}

/**
 * Three or more media in one frame, split by N−1 dividers.
 *
 * Media k (k ≥ 1) is clipped to start at divider k, so with every later medium stacked on top, the
 * strip between dividers k and k+1 shows medium k. Each divider is its own `step="1"` range — the
 * keyboard and assistive-tech control — whose `min`/`max` are its neighbours, so dividers never
 * cross. There is no minimum gap: two dividers may meet, closing a strip to nothing, which is how a
 * viewer hides one image to see its neighbours meet directly.
 *
 * Pointer input is not the ranges'. N full-size ranges stacked in one cell would leave only the top
 * one reachable, and a range sized to its travel overlaps both neighbours'. So one transparent
 * surface takes the pointer, grabs the nearest divider (a tie, where dividers meet, goes to the one
 * on the side the press landed), and drags it in frame coordinates, clamped the same way.
 *
 * The clip is written inline on each medium rather than in `showcase.css`: the stylesheet clips the
 * second medium only, which is the two-media slider's contract and stays exactly as it was.
 */
function buildMulti({ el, media, params, ctx, axis, timing }: BuildOptions): () => void {
  if (params.text('position', '50%') !== '50%') {
    ctx.warn(`compare position: sets the one divider of two media; with ${media.length}, use positions:`)
  }
  const positions = resolvePositions(params.text('positions', ''), media.length - 1, ctx.warn)
  const homes = [...positions]

  const attrs = createAttributeLedger(el)
  attrs.set(COMPARE_DIVIDERS_ATTR, String(homes.length))
  const dividers = createDividers(el, media, axis, positions)
  const surface = bindSurface(el, axis, dividers)

  const stopAutoDrag = bindAutoDrag({
    ...timing,
    host: el,
    grab: [surface.node, ...dividers.ranges],
    ctx,
    write: dividers.render,
    homes,
    bounds: homes.map((_, k) => boundsOf(homes, k)),
  })

  return () => {
    stopAutoDrag()
    surface.destroy()
    dividers.destroy()
    attrs.restore()
  }
}

/** Divider `k`'s travel: its neighbours, or the frame's edges for the first and last. */
function boundsOf(positions: readonly number[], k: number): readonly [number, number] {
  return [k > 0 ? positions[k - 1]! : 0, k < positions.length - 1 ? positions[k + 1]! : 100]
}

interface Dividers {
  ranges: HTMLInputElement[]
  /** Show divider `k` at `shown` (unrounded while it glides) and settle its logical place. */
  render(k: number, shown: number): void
  /** Move divider `k` toward `percent`, stopping at its neighbours. */
  moveTo(k: number, percent: number): void
  /** The divider a press at `percent` grabs. */
  nearest(percent: number): number
  destroy(): void
}

function dividerLabel(el: Element, media: Element[], k: number): string {
  const count = media.length - 1
  const authored = el.getAttribute('aria-label')?.trim()
  if (authored) return `${authored}: divider ${k + 1} of ${count}`
  const before = getMediaName(media[k]!, `Image ${k + 1}`)
  const after = getMediaName(media[k + 1]!, `Image ${k + 2}`)
  return `Divider ${k + 1} of ${count}: ${before} / ${after}`
}

/**
 * The N−1 dividers: a range and a handle each, plus the inline clip on every medium after the first.
 *
 * @param positions - Mutated in place as dividers move; the one source of truth for the clamp.
 * @complexity O(N) to build; O(1) per move.
 */
function createDividers(el: Element, media: Element[], axis: string, positions: number[]): Dividers {
  const doc = el.ownerDocument
  const count = positions.length
  const clip = axis === 'y' ?'inset(var(--kui-compare) 0 0 0)' : 'inset(0 0 0 var(--kui-compare))'
  const mediaStyles = media.slice(1).map((item) => createStyleLedger(item))
  for (const ledger of mediaStyles) ledger.set('clip-path', clip)
  const ranges: HTMLInputElement[] = []
  const handles: HTMLElement[] = []
  const cleanups: (() => void)[] = []

  const render = (k: number, shown: number): void => {
    positions[k] = Math.round(shown)
    const css = `${Number(shown.toFixed(3))}%`
    handles[k]!.style.setProperty('--kui-compare', css)
    mediaStyles[k]!.set('--kui-compare', css)
    ranges[k]!.value = String(positions[k])
    ranges[k]!.setAttribute('aria-valuetext', `${positions[k]}%`)
    if (k > 0) ranges[k - 1]!.max = String(positions[k])
    if (k < count - 1) ranges[k + 1]!.min = String(positions[k])
  }

  for (let k = 0; k < count; k++) {
    const range = createRange(doc, { name: dividerLabel(el, media, k), valueText: `${positions[k]}%` }, positions[k]!, axis)
    const handle = createHandle(doc)
    ranges.push(range)
    handles.push(handle)
    // Range then its handle, so `:focus-visible + .kui-compare-handle` rings the right one and the
    // tab order runs divider 1, 2, 3 across the frame.
    el.append(range, handle)
    const onInput = (): void => render(k, Number(range.value))
    const onKeyDown = verticalKeys(range, axis, onInput)
    range.addEventListener('input', onInput)
    range.addEventListener('keydown', onKeyDown)
    cleanups.push(() => {
      range.removeEventListener('input', onInput)
      range.removeEventListener('keydown', onKeyDown)
    })
  }
  for (let k = 0; k < count; k++) {
    const [lo, hi] = boundsOf(positions, k)
    ranges[k]!.min = String(lo)
    ranges[k]!.max = String(hi)
    render(k, positions[k]!)
  }

  return {
    ranges,
    render,
    moveTo(k, percent) {
      const [lo, hi] = boundsOf(positions, k)
      render(k, Math.min(hi, Math.max(lo, percent)))
    },
    nearest: (percent) => nearestDivider(positions, percent),
    destroy() {
      for (const cleanup of cleanups) cleanup()
      for (const node of [...ranges, ...handles]) node.remove()
      for (const ledger of mediaStyles) ledger.restore()
    },
  }
}

/**
 * The divider closest to `percent`. Where dividers meet, the press's side decides: at or past the
 * shared point takes the later divider (which can move right), before it the earlier (which can
 * move left) — so two dividers that have closed a strip can always be pulled apart again.
 */
function nearestDivider(positions: readonly number[], percent: number): number {
  let best = 0
  for (let k = 1; k < positions.length; k++) {
    const distance = Math.abs(positions[k]! - percent)
    const bestDistance = Math.abs(positions[best]! - percent)
    if (distance < bestDistance || (distance === bestDistance && percent >= positions[k]!)) best = k
  }
  return best
}

/**
 * The one transparent layer that takes the pointer for every divider.
 *
 * @complexity O(N) per press (nearest divider); O(1) per move.
 */
function bindSurface(el: Element, axis: string, dividers: Dividers): { node: HTMLElement; destroy(): void } {
  const surface = el.ownerDocument.createElement('div')
  surface.className = 'kui-compare-surface'
  surface.setAttribute('aria-hidden', 'true')
  el.appendChild(surface)
  let dragging = -1
  let pointerId: number | null = null

  const percentAt = (event: PointerEvent): number => {
    const rect = el.getBoundingClientRect()
    const along = axis === 'y' ?event.clientY - rect.top : event.clientX - rect.left
    const size = axis === 'y' ? rect.height : rect.width
    return size > 0 ? (100 * along) / size : 0
  }
  const onPointerDown = (event: PointerEvent): void => {
    // One pointer owns the drag; another finger must not replace its divider or release it.
    if (event.button > 0 || pointerId !== null) return
    pointerId = event.pointerId
    const percent = percentAt(event)
    dragging = dividers.nearest(percent)
    event.preventDefault()
    surface.setPointerCapture?.(event.pointerId)
    dividers.ranges[dragging]!.focus({ preventScroll: true })
    dividers.moveTo(dragging, percent)
  }
  const onPointerMove = (event: PointerEvent): void => {
    if (dragging >= 0 && event.pointerId === pointerId) dividers.moveTo(dragging, percentAt(event))
  }
  const onPointerUp = (event: PointerEvent): void => {
    if (event.pointerId !== pointerId) return
    dragging = -1
    pointerId = null
  }
  const onLostCapture = (event: PointerEvent): void => {
    // Capture loss ends our drag, but a child losing its own capture does not.
    if (event.target !== surface) return
    onPointerUp(event)
  }
  const listeners = [
    ['pointerdown', onPointerDown],
    ['pointermove', onPointerMove],
    ['pointerup', onPointerUp],
    ['pointercancel', onPointerUp],
    ['lostpointercapture', onLostCapture],
  ] as const
  for (const [type, listener] of listeners) surface.addEventListener(type, listener)

  return {
    node: surface,
    destroy() {
      for (const [type, listener] of listeners) surface.removeEventListener(type, listener)
      surface.remove()
    },
  }
}

function prepareCompare(el: Element, params: EffectParams, ctx: PrepareContext): SetupResult {
  const media = Array.from(el.querySelectorAll(':scope > :is(img, picture, video)'))
  if (media.length < 2) {
    ctx.warn('compare requires at least two media children (img, picture, or video)')
  }

  const axis = params.text('axis', 'x')
  const attrs = createAttributeLedger(el)
  attrs.set(COMPARE_AXIS_ATTR, axis)

  const build = media.length > 2 ? buildMulti : buildPair
  const teardown = build({
    el,
    media,
    params,
    ctx,
    axis,
    timing: {
      mode: params.text('autoplay', 'never'),
      durationMs: sweepDuration(params, ctx),
      reverse: params.is('reverse'),
      loop: params.is('loop'),
    },
  })

  return continuousSetup(() => {
    teardown()
    attrs.restore()
  })
}

export const COMPARE_PRIMITIVE: Primitive = widgetPrimitive(
  'compare',
  {
    // The layers it stacks and the range, handle and surface it appends; the axis and divider
    // markers it writes on the host. Not `clip`: its `clip-path` is on the after layer, never the
    // host, so a `wipe-up` revealing the whole slider is not a fight over one property.
    channels: [SUBTREE_CHANNEL, attributeChannel(COMPARE_AXIS_ATTR), attributeChannel(COMPARE_DIVIDERS_ATTR)],
    parameters: compareParams,
    perfClass: 'paint',
  },
  withTimingContract(
    'compare',
    {
      honours: ['duration'],
      because:
        'its only motion is the autoplay: sweep, which starts on autoplay: rather than after a ' +
        'delay and eases into each edge on its own curve',
    },
    deferPrepare(prepareCompare),
  ),
)

export const COMPARE_PRESETS: Preset[] = [
  {
    name: 'compare',
    primitive: 'compare',
    requiresOwnSubtree: true,
  },
]
