import type { Cleanup } from '../../core/types.js'
import { timeScaleOf } from '../../core/time-scale.js'
import { ROW_COPY_ATTR } from './row-copies.js'

/**
 * Changing a live deck's effect: the cards glide from where they are to where the new shape wants them.
 *
 * Setting `data-kui` reinstalls the effect, and between the two shapes three things change at once:
 * each card's transform, its layout box (a grid cell becomes a place in a flex row, a stack's padding
 * comes or goes), and the host's camera. A CSS transition can only ever see the first, and only when
 * nothing resolves style between teardown and install. So it flew some pairs by luck and jumped
 * others. This file is the one owner of that move, and the transition stays out of it.
 *
 * ## A pose, not a box
 *
 * `core/flip.ts` measures bounding boxes, and that is the wrong record here: the box of a card turned
 * sixty degrees on a ring says nothing about the turn, so a FLIP from it would flatten the picture on
 * the first frame. What is recorded is the card's whole mapping to the page: the host's camera and
 * scale, then the card's layout position, then its computed transform. On arrival that mapping is
 * re-expressed under the *new* camera and the new layout box, which gives the one transform that
 * paints the card exactly where it was. Computed values, so a card caught mid-glide or mid-step
 * records where it is right now.
 *
 * Layout positions are `offsetLeft` chains rather than rects. They ignore every transform, including
 * an ancestor's, so the arithmetic stays in one coordinate space whatever the page does above the deck.
 *
 * ## One start keyframe, no end keyframe
 *
 * Each animation names only its start and leaves the end to the underlying value. So a spin, a drag
 * or an arrow press during the glide changes the target and the card follows, and nothing has to
 * cancel anything. It also writes nothing inline: when it ends, the stylesheet is simply back.
 *
 * ## The transition has to sit out exactly one moment
 *
 * `arriving` holds `transition-property: none` while the new shape is stamped and committed, so the
 * install itself starts no transition. That also covers any forced style read during install, such as
 * the flattening check before a ring places its cards, which used to commit `transform: none` and fly
 * every card out from the host's centre. `flying` restores the transition before the first frame, so
 * a later step travels as usual underneath the glide. Two layers, never over the same change.
 *
 * ## A row's box and its copies
 *
 * A row clips, and it stops clipping for the length of the glide, because a ring's cards stand outside
 * its box. So a card past the row's edge is treated as out of sight at either end. Leaving a row it
 * fades in rather than popping into view when the clip lets go. Arriving at a row it fades out rather
 * than blinking away when the clip comes back. A card across the edge meets a clip that moves.
 *
 * Copies have no pose to glide between, since they exist in one shape only, so they cross-fade. The
 * new row's fade in where they stand. The old row's, already taken out by its teardown, go back in the
 * host out of flow for as long as they take to fade out where they stood. `deck.ts` never counts a copy
 * as a slide, so no deck picks one up.
 */

/** Attribute on the host, from the start of the install until the last card lands. */
export const GLIDE_ATTR = 'data-kui-deck-glide'

/** A 4x4 matrix in column order, as `matrix3d()` spells it. */
type Matrix = readonly number[]

const IDENTITY: Matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

function multiply(a: Matrix, b: Matrix): Matrix {
  return Array.from({ length: 16 }, (_, i) => {
    const column = i >> 2
    const row = i & 3
    return a[row]! * b[column * 4]! + a[row + 4]! * b[column * 4 + 1]! +
      a[row + 8]! * b[column * 4 + 2]! + a[row + 12]! * b[column * 4 + 3]!
  })
}

const compose = (...matrices: Matrix[]): Matrix => matrices.reduce(multiply)

const translation = (x: number, y: number, z = 0): Matrix => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]

const scaling = (x: number, y: number): Matrix => [x, 0, 0, 0, 0, y, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

/** `perspective(d)`. Its inverse is `lens(-d)`. */
const lens = (distance: number): Matrix => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, -1 / distance, 0, 0, 0, 1]

/**
 * A computed `transform` as a matrix: the browser only ever resolves one to these three spellings.
 *
 * @complexity O(1) time and space.
 */
export function matrixOf(value: string): Matrix {
  const numbers = value.slice(value.indexOf('(') + 1, -1).split(',').map(Number)
  if (value.startsWith('matrix3d(')) return numbers
  if (!value.startsWith('matrix(')) return IDENTITY
  const [a, b, c, d, e, f] = numbers as [number, number, number, number, number, number]
  return [a, b, 0, 0, c, d, 0, 0, 0, 0, 1, 0, e, f, 0, 1]
}

/** Computed `<x> <y> [<z>]` lengths or numbers, with anything missing as 0. */
function lengths(value: string): [number, number, number] {
  const [x, y, z] = value.split(' ').map(parseFloat)
  return [x || 0, y || 0, z || 0]
}

/** Computed `scale`: `none`, one number, or per-axis numbers. */
function scaleOf(value: string): [number, number] {
  const [x, y] = value.split(' ').map(Number)
  return x ? [x, y ?? x] : [1, 1]
}

/**
 * An element's layout position in page coordinates, with every transform ignored.
 *
 * @complexity O(d) time in offset ancestors; one layout read.
 */
function layoutOf(node: HTMLElement): [number, number] {
  let x = node.offsetLeft
  let y = node.offsetTop
  for (let at = node.offsetParent as HTMLElement | null; at; at = at.offsetParent as HTMLElement | null) {
    x += at.offsetLeft + at.clientLeft - at.scrollLeft
    y += at.offsetTop + at.clientTop - at.scrollTop
  }
  return [x, y]
}

/** What the host applies around its cards, and the undoing of it. */
interface Camera { forward: Matrix; inverse: Matrix }

/**
 * The host's `scale` (`shape:helix` and `shape:sphere` fit themselves with it) and `perspective`.
 *
 * Both inverted analytically rather than by a general matrix inverse: each factor has an exact one.
 *
 * @complexity O(d) time in the host's offset ancestors; one style read.
 */
function cameraOf(host: HTMLElement, win: Window): Camera {
  const style = win.getComputedStyle(host)
  const [left, top] = layoutOf(host)
  const [pivotX, pivotY] = lengths(style.getPropertyValue('transform-origin'))
  const [originX, originY] = lengths(style.getPropertyValue('perspective-origin'))
  const [scaleX, scaleY] = scaleOf(style.getPropertyValue('scale'))
  const distance = parseFloat(style.getPropertyValue('perspective'))
  const toPivot = translation(left + pivotX, top + pivotY)
  const fromPivot = translation(-left - pivotX, -top - pivotY)
  const toOrigin = translation(left + originX, top + originY)
  const fromOrigin = translation(-left - originX, -top - originY)
  return {
    forward: compose(toPivot, scaling(scaleX, scaleY), fromPivot,
      toOrigin, distance > 0 ? lens(distance) : IDENTITY, fromOrigin),
    inverse: compose(toOrigin, distance > 0 ? lens(-distance) : IDENTITY, fromOrigin,
      toPivot, scaling(1 / scaleX, 1 / scaleY), fromPivot),
  }
}

/** Where a card's transform origin sits in page coordinates. */
function originOf(node: HTMLElement, style: CSSStyleDeclaration): [number, number, number] {
  const [left, top] = layoutOf(node)
  const [x, y, z] = lengths(style.getPropertyValue('transform-origin'))
  return [left + x, top + y, z]
}

interface Pose {
  /** Card coordinates (about its transform origin) to page coordinates. */
  placed: Matrix
  /** A `facing:camera` card's turn on its child, which is part of how the picture faces. */
  billboard: Matrix
  /** Effective: a hidden card records as `0`, so it fades in rather than pops. */
  opacity: string
  filter: string
  shown: boolean
}

/** Only `facing:camera` keeps a card's child in the scene, so only then is its transform a turn. */
const turnsChild = (style: CSSStyleDeclaration): boolean => style.getPropertyValue('transform-style') === 'preserve-3d'

/** Wholly past a row's edge. A row clips sideways only. */
function pastEdge(node: Element, box: DOMRect | undefined): boolean {
  if (!box) return false
  const rect = node.getBoundingClientRect()
  return rect.right <= box.left || rect.left >= box.right
}

const copiesIn = (host: HTMLElement): HTMLElement[] =>
  (Array.from(host.children) as HTMLElement[]).filter(node => node.hasAttribute(ROW_COPY_ATTR))

function poseOf(node: HTMLElement, camera: Camera, clip: DOMRect | undefined, win: Window): Pose {
  const style = win.getComputedStyle(node)
  const [x, y, z] = originOf(node, style)
  const child = node.firstElementChild
  const shown = style.getPropertyValue('visibility') !== 'hidden' && !pastEdge(node, clip)
  return {
    placed: compose(camera.forward, translation(x, y, z), matrixOf(style.getPropertyValue('transform'))),
    billboard: child && turnsChild(style) ? matrixOf(win.getComputedStyle(child).getPropertyValue('transform')) : IDENTITY,
    opacity: shown ? style.getPropertyValue('opacity') : '0',
    filter: style.getPropertyValue('filter'),
    shown,
  }
}

/** Sub-pixel and rounding differences are not a move, and animating them costs a compositor layer. */
function samePlace(a: Matrix, b: Matrix): boolean {
  return a.every((value, i) => Math.abs(value - b[i]!) < (i >= 12 && i < 15 ? 0.5 : 0.001))
}

/** Returned rather than discarded so the read is a value, the same shape as `commitStyle` in `deck.ts`. */
function commitStyle(node: Element, win: Window): string {
  return win.getComputedStyle(node).getPropertyValue('transform')
}

const asTransform = (matrix: Matrix): string => `matrix3d(${matrix.join(',')})`

interface Recording {
  poses: Map<Element, Pose>
  /** The row copies on screen, which the row's teardown is about to take out of the host. */
  copies: Map<HTMLElement, Pose>
  /** Whether the host was clipping its cards to its box. */
  clipped: boolean
}

/** Filled by a deck going away and emptied by the deck replacing it, within one task. */
const recordings = new WeakMap<Element, Recording>()

/**
 * Note where a departing deck's cards are, for a deck that takes over this host in this same task.
 *
 * Call before anything is restored. The microtask is the expiry: a reinstall is synchronous, so a
 * recording still here afterwards means the new effect was not a deck, and it must not reach a deck
 * installed long after, when these poses describe nothing on screen. Skipped where the Web Animations
 * API is missing, since nothing could play it.
 *
 * @complexity O(n) time in cards; one forced layout.
 */
export function recordDeckPoses(host: HTMLElement, nodes: readonly Element[], win: Window): void {
  if (typeof host.animate !== 'function') return
  const camera = cameraOf(host, win)
  const clips = /clip|hidden|auto|scroll/.test(win.getComputedStyle(host).getPropertyValue('overflow-x'))
  const clip = clips ? host.getBoundingClientRect() : undefined
  const recording: Recording = { poses: new Map(), copies: new Map(), clipped: clips }
  for (const node of nodes) recording.poses.set(node, poseOf(node as HTMLElement, camera, clip, win))
  for (const copy of copiesIn(host)) {
    const pose = poseOf(copy, camera, clip, win)
    if (pose.shown) recording.copies.set(copy, pose)
  }
  recordings.set(host, recording)
  queueMicrotask(() => {
    if (recordings.get(host) === recording) recordings.delete(host)
  })
}

export interface GlideTiming {
  durationMs: number
  easing: string
  /** Land immediately: the new arrangement, with no travel. */
  reducedMotion: boolean
}

/** A deck taking over from another: land its cards once they are placed. */
export type DeckArrival = (nodes: readonly Element[], timing: GlideTiming, win: Window) => Cleanup

/**
 * The keyframes that carry one card from a recorded pose to wherever the stylesheet now puts it.
 *
 * A property that did not change is left out, so that it stays wholly the stylesheet's. A card the
 * new shape hides fades on the way, because `visibility` has no in-between. So does one a row leaves
 * past its edge. A shape that does not turn its cards' children has no child to hand the old billboard
 * to, so it is folded into the card's own start.
 *
 * @returns Empty when there is nothing to see: the card is unmoved, or hidden at both ends.
 * @complexity O(1) time and space.
 */
function keyframesFor(pose: Pose, node: HTMLElement, style: CSSStyleDeclaration, camera: Camera, clip: DOMRect | undefined): Keyframe[] {
  const [x, y, z] = originOf(node, style)
  const start = compose(translation(-x, -y, -z), camera.inverse, pose.placed, turnsChild(style) ? IDENTITY : pose.billboard)
  const from: Keyframe = { offset: 0 }
  if (!samePlace(start, matrixOf(style.getPropertyValue('transform')))) from.transform = asTransform(start)
  if (pose.opacity !== style.getPropertyValue('opacity')) from.opacity = pose.opacity
  if (pose.filter !== style.getPropertyValue('filter')) from.filter = pose.filter
  const past = pastEdge(node, clip)
  if (past || style.getPropertyValue('visibility') === 'hidden') {
    if (pose.shown) return [{ ...from, visibility: 'visible' }, { offset: 1, opacity: 0 }]
    return past ? UNSEEN : []
  }
  return Object.keys(from).length > 1 ? [from] : []
}

/** For the length of the glide: a row is not clipping, and this one has no business being seen. */
const UNSEEN: Keyframe[] = [{ offset: 0, opacity: 0 }, { offset: 1, opacity: 0 }]

/**
 * The new row's copies appear where they stand.
 *
 * @complexity O(n) time in copies, with one layout read each.
 */
function fadeCopiesIn(host: HTMLElement, clip: DOMRect | undefined, options: KeyframeAnimationOptions): Animation[] {
  return copiesIn(host).map(copy => copy.animate(pastEdge(copy, clip) ? UNSEEN : [{ offset: 0, opacity: 0 }], options))
}

/**
 * Bring a row's clip back gradually, so that a card standing across the edge is not cut off at once.
 *
 * `clip-path` rather than `overflow`, which has no in-between, and only for the second half of the
 * glide: while one applies the host is flat, and a ring's cards would stop sorting by depth. By then
 * they are nearly flat in their row. A row that was already clipping just goes on clipping.
 *
 * @complexity O(1) time and space; one layout read.
 */
function wipeRowClip(host: HTMLElement, clipped: { before: boolean; after: boolean }, durationMs: number): Animation[] {
  if (!clipped.after) return []
  const box = host.getBoundingClientRect()
  const shut = 'inset(0px)'
  const open = `inset(-${Math.max(box.width, box.height)}px)`
  if (clipped.before) return [host.animate([{ clipPath: shut }, { clipPath: shut }], { duration: durationMs })]
  return [host.animate([{ clipPath: open }, { clipPath: shut }], { duration: durationMs / 2, delay: durationMs / 2 })]
}

/**
 * Put an old row's copy back, out of flow, and fade it out where it stood.
 *
 * @complexity O(d) time in its offset ancestors.
 */
function fadeCopyOut(host: HTMLElement, copy: HTMLElement, pose: Pose, camera: Camera, options: KeyframeAnimationOptions, win: Window): Animation {
  Object.assign(copy.style, { position: 'absolute', left: '0', top: '0', margin: '0' })
  host.append(copy)
  const [x, y, z] = originOf(copy, win.getComputedStyle(copy))
  const transform = asTransform(compose(translation(-x, -y, -z), camera.inverse, pose.placed))
  return copy.animate([{ offset: 0, transform, opacity: pose.opacity }, { offset: 1, transform, opacity: 0 }], options)
}

/**
 * Start one card's glide, and its billboard child's. Returns what it started.
 *
 * @complexity O(1) time and space, with up to two style reads.
 */
function glideCard(node: HTMLElement, pose: Pose, camera: Camera, clip: DOMRect | undefined, options: KeyframeAnimationOptions, win: Window): Animation[] {
  const style = win.getComputedStyle(node)
  const keyframes = keyframesFor(pose, node, style, camera, clip)
  const started = keyframes.length > 0 ? [node.animate(keyframes, options)] : []
  const child = node.firstElementChild
  if (child && turnsChild(style) && !samePlace(pose.billboard, matrixOf(win.getComputedStyle(child).getPropertyValue('transform')))) {
    started.push(child.animate([{ offset: 0, transform: asTransform(pose.billboard) }], options))
  }
  return started
}

/**
 * Claim a recording for a deck installing on this host, and hold its transition off.
 *
 * Call before the deck writes anything. No recording means this is not a switch: a first load, or
 * a host that had some other effect, and those are exactly as they were.
 *
 * @returns How to land the cards once they are placed, or `undefined`.
 * @complexity O(1) time and space.
 */
export function claimDeckArrival(host: HTMLElement): DeckArrival | undefined {
  const recording = recordings.get(host)
  if (!recording) return undefined
  recordings.delete(host)
  host.setAttribute(GLIDE_ATTR, 'arriving')
  const land = (): void => {
    host.removeAttribute(GLIDE_ATTR)
    for (const copy of recording.copies.keys()) copy.remove()
  }

  return (nodes, timing, win) => {
    // Commits the new transforms while the transition is held off, so that none can start one once
    // it is released. Needed even with no glide to play.
    for (const node of nodes) commitStyle(node, win)
    const camera = cameraOf(host, win)
    const options = { duration: timing.durationMs, easing: timing.easing }
    const running: Animation[] = []
    if (!timing.reducedMotion) {
      // The glide's own rule takes the row's clip away, so its box is read from what it will clip again.
      const rowClips = host.getAttribute('data-kui-row-static') === 'false' && host.getAttribute('data-kui-row-shape') !== 'line'
      const clip = rowClips ? host.getBoundingClientRect() : undefined
      for (const node of nodes) {
        const pose = recording.poses.get(node)
        if (pose) running.push(...glideCard(node as HTMLElement, pose, camera, clip, options, win))
      }
      running.push(...fadeCopiesIn(host, clip, options))
      for (const [copy, pose] of recording.copies) running.push(fadeCopyOut(host, copy, pose, camera, options, win))
      if (running.length > 0) running.push(...wipeRowClip(host, { before: recording.clipped, after: rowClips }, timing.durationMs))
    }
    if (running.length === 0) {
      land()
      return () => {}
    }
    const rate = timeScaleOf(host)
    // Held at the start for the frame this install is part of. That frame can be long (blurred
    // cards, first raster), and a clock running through it would land the card far along its way
    // on the first thing the viewer sees.
    for (const animation of running) {
      animation.playbackRate = rate
      animation.pause()
    }
    const release = win.requestAnimationFrame(() => {
      for (const animation of running) animation.play()
    })
    host.setAttribute(GLIDE_ATTR, 'flying')
    let live = true
    void Promise.all(running.map(animation => animation.finished.catch(() => undefined))).then(() => {
      if (live) land()
    })
    return () => {
      live = false
      win.cancelAnimationFrame(release)
      for (const animation of running) animation.cancel()
      land()
    }
  }
}
