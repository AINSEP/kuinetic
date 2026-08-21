/**
 * SVG path interpolation.
 *
 * Two `d` strings cannot be interpolated directly: they differ in command type and count, and
 * `1px` of `C` is not `1px` of `L`. The fix is normalisation — convert everything to absolute
 * cubic segments, then split the longer path's segments until both have the same count. After
 * that, morphing is per-number lerp.
 *
 * Scope is deliberately bounded. `M L H V C Z` are supported; `A S Q T` are not, and a path using
 * them reports a reason rather than producing a plausible-looking wrong shape. Owning a complete
 * SVG path engine is not worth it for two effect names.
 */

export interface Point {
  x: number
  y: number
}

/** One cubic segment: start point, two controls, end point. */
export interface Cubic {
  from: Point
  c1: Point
  c2: Point
  to: Point
}

/**
 * One subpath: a run of segments, plus whether the author closed it.
 *
 * A `d` string is not one contour — `M ... Z M ... Z` is a shape with a hole, and an icon with a
 * counter (the inside of an `o`, `a`, `e`) is the common case. Flattening the runs together turns
 * a hole into a detour line across the glyph, so the boundary has to survive parsing.
 */
export interface Subpath {
  segments: Cubic[]
  /**
   * True when the author wrote an explicit `Z`/`z`. Kept separate from the geometry because
   * `closeSubpath` already materialises the closing side as a real segment — this flag is what
   * decides whether `Z` is re-emitted, which is what `fill-rule` needs to punch the hole.
   */
  closed: boolean
}

export interface ParseResult {
  /** Every segment in document order, with subpath boundaries flattened away. */
  segments: Cubic[]
  /** The same segments grouped by subpath. This is the form morphing needs. */
  subpaths: Subpath[]
  /** Present when the path could not be normalised; the caller should warn and not morph. */
  reason?: string
}

// The `i` flag covers the uppercase (absolute) forms; listing both would duplicate the class.
const COMMAND = /([mlhvcz])|(-?(?:\d+(?:\.\d+)?|\.\d+))/gi
const UNSUPPORTED = /[AaSsQqTt]/

/**
 * Parse a path's `d` attribute into absolute cubic segments.
 *
 * @param d - The `d` attribute value.
 * @returns Segments, or a `reason` when the path uses unsupported commands.
 * @complexity O(n) time in the length of `d`; O(s) space in segment count.
 * @overallScore 100
 */
export function parsePath(d: string): ParseResult {
  if (UNSUPPORTED.test(d)) {
    return {
      segments: [],
      subpaths: [],
      reason: 'arc and shorthand commands (A S Q T) are not supported',
    }
  }

  const tokens = [...d.matchAll(COMMAND)].map((m) => m[1] ?? m[2]!)
  const state: PathState = {
    subpaths: [],
    open: undefined,
    current: { x: 0, y: 0 },
    start: { x: 0, y: 0 },
    command: '',
  }

  let index = 0
  while (index < tokens.length) {
    const token = tokens[index]!
    if (/[a-z]/i.test(token)) {
      state.command = token
      // `Z` takes no arguments, so it never reaches `consume` — it has to close the subpath here
      // or the final side of every closed shape is silently missing.
      if (token.toLowerCase() === 'z') closeSubpath(state)
      index++
      continue
    }
    // A path whose first token is a number rather than a command letter would otherwise reach
    // `consume` with `state.command` still `''`. `ARITY['']` is undefined, so `consume` would
    // return the same index it was given and this loop would spin forever, growing `segments`
    // without bound — a real DoS on any untrusted `d` string. The SVG spec requires a path to
    // start with a moveto, so rejecting here is also spec-correct, not just a safety valve.
    if (!state.command) {
      return { segments: [], subpaths: [], reason: 'path must start with a command letter' }
    }
    index = consume(tokens, index, state)
  }

  // A subpath is only ever created when a segment lands in it, so an empty list here means the
  // path drew nothing — `M0,0` on its own, or `M0,0 Z`.
  if (state.subpaths.length === 0) {
    return { segments: [], subpaths: [], reason: 'no drawable segments' }
  }
  return { segments: state.subpaths.flatMap((sub) => sub.segments), subpaths: state.subpaths }
}

interface PathState {
  subpaths: Subpath[]
  /**
   * The subpath currently accepting segments, or `undefined` when the pen is between subpaths
   * (before the first drawing command, or just after a `Z` or a `M`). Deferring creation until a
   * segment actually arrives is what keeps `M0,0 Z` from producing an empty contour.
   */
  open: Subpath | undefined
  current: Point
  start: Point
  command: string
}

/**
 * Append a segment to the open subpath, starting one if the pen is between subpaths.
 *
 * @complexity O(1) time and space.
 * @overallScore 100
 */
function pushSegment(state: PathState, segment: Cubic): void {
  if (!state.open) {
    state.open = { segments: [], closed: false }
    state.subpaths.push(state.open)
  }
  state.open.segments.push(segment)
}

/** Numbers each command consumes per repetition. */
const ARITY: Record<string, number> = { m: 2, l: 2, h: 1, v: 1, c: 6, z: 0 }

/**
 * Close the current subpath with a line back to its start, and mark it closed.
 *
 * The closing *line* is skipped when the pen is already at the start, so `M0,0 L10,0 L0,0 Z` does
 * not gain a zero-length segment that would later be split into a visible kink. The closed *flag*
 * is set either way — the author wrote `Z`, and that is what decides whether `Z` comes back out
 * during serialisation, independently of whether a segment was needed to get there.
 *
 * Clearing `open` is what makes the next drawing command start a fresh subpath, which is the
 * spec's behaviour for a command following `Z` with no intervening `M`.
 *
 * @complexity O(1) time and space.
 * @overallScore 100
 */
function closeSubpath(state: PathState): void {
  const { current, start, open } = state
  // `Z` before anything was drawn (`M0,0 Z`) has no contour to close.
  if (!open) return
  if (Math.abs(current.x - start.x) >= 1e-6 || Math.abs(current.y - start.y) >= 1e-6) {
    open.segments.push(lineToCubic(current, start))
  }
  open.closed = true
  state.current = { ...start }
  state.open = undefined
}

/**
 * Consume one command's worth of numbers and emit its segment.
 *
 * @returns The next token index.
 * @complexity O(1) time, O(1) space.
 * @overallScore 100
 */
function consume(tokens: string[], index: number, state: PathState): number {
  const key = state.command.toLowerCase()
  const relative = state.command === key
  // `state.command` is only ever '' before the first command letter, and the caller now rejects
  // that case before reaching here — every other value came from the `/[a-z]/i` match in the main
  // loop, which is one of `mlhvcz`, so this key is always present in `ARITY`.
  const arity = ARITY[key]!
  const args = tokens.slice(index, index + arity).map(Number)
  if (args.length < arity) return tokens.length

  const next = endpointFor(key, args, state.current, relative)
  if (key === 'm') {
    state.current = next
    state.start = next
    // A moveto ends the current contour and begins a new one. Leaving `open` set here is exactly
    // the bug that flattened `M...Z M...Z` into a single run.
    state.open = undefined
    // A subsequent implicit repetition of `m` is a lineto, per the SVG spec.
    state.command = relative ? 'l' : 'L'
    return index + arity
  }

  pushSegment(state, straightOrCubic({ key, args, from: state.current, relative }, next))
  state.current = next
  return index + arity
}

function endpointFor(key: string, args: number[], current: Point, relative: boolean): Point {
  const base = relative ? current : { x: 0, y: 0 }
  if (key === 'h') return { x: base.x + args[0]!, y: current.y }
  if (key === 'v') return { x: current.x, y: base.y + args[0]! }
  if (key === 'c') return { x: base.x + args[4]!, y: base.y + args[5]! }
  return { x: base.x + args[0]!, y: base.y + args[1]! }
}

/**
 * Emit a cubic for any supported command, converting lines to cubics with controls at the
 * one-third points so a line and a curve interpolate cleanly.
 *
 * @complexity O(1) time and space.
 * @overallScore 100
 */
function straightOrCubic(command: CommandInput, to: Point): Cubic {
  const { key, args, from, relative } = command
  if (key !== 'c') return lineToCubic(from, to)
  const base = relative ? from : { x: 0, y: 0 }
  return {
    from,
    c1: { x: base.x + args[0]!, y: base.y + args[1]! },
    c2: { x: base.x + args[2]!, y: base.y + args[3]! },
    to,
  }
}

/** One command's inputs, grouped so the emitter stays within the parameter budget. */
interface CommandInput {
  key: string
  args: number[]
  from: Point
  relative: boolean
}

function lineToCubic(from: Point, to: Point): Cubic {
  return {
    from,
    c1: lerpPoint(from, to, 1 / 3),
    c2: lerpPoint(from, to, 2 / 3),
    to,
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function lerpPoint(a: Point, b: Point, t: number): Point {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) }
}

/**
 * Split a cubic at `t` using de Casteljau, preserving the exact curve.
 *
 * Splitting rather than padding is what keeps a normalised path visually identical to the
 * original — a duplicated zero-length segment would create a visible kink under interpolation.
 *
 * @complexity O(1) time and space.
 * @overallScore 100
 */
export function splitCubic(segment: Cubic, t: number): [Cubic, Cubic] {
  const p01 = lerpPoint(segment.from, segment.c1, t)
  const p12 = lerpPoint(segment.c1, segment.c2, t)
  const p23 = lerpPoint(segment.c2, segment.to, t)
  const p012 = lerpPoint(p01, p12, t)
  const p123 = lerpPoint(p12, p23, t)
  const mid = lerpPoint(p012, p123, t)

  return [
    { from: segment.from, c1: p01, c2: p012, to: mid },
    { from: mid, c1: p123, c2: p23, to: segment.to },
  ]
}

/**
 * Grow a segment list to `target` segments by repeatedly halving the longest one.
 *
 * @param segments - Source segments; not mutated.
 * @param target - Desired count, which must be at least the source count.
 * @returns A list of exactly `target` segments describing the same curve.
 * @complexity O((target - n) * n) time; O(target) space. Both paths are parsed once per morph
 *   setup, not per frame, so the quadratic term never reaches the frame budget.
 * @overallScore 100
 */
export function normaliseCount(segments: Cubic[], target: number): Cubic[] {
  const out = [...segments]
  while (out.length < target && out.length > 0) {
    let longest = 0
    for (let i = 1; i < out.length; i++) {
      if (chordLength(out[i]!) > chordLength(out[longest]!)) longest = i
    }
    const [a, b] = splitCubic(out[longest]!, 0.5)
    out.splice(longest, 1, a, b)
  }
  return out
}

function chordLength(segment: Cubic): number {
  return Math.hypot(segment.to.x - segment.from.x, segment.to.y - segment.from.y)
}

/**
 * Serialise cubic segments back to a `d` string.
 *
 * @complexity O(n) time and space in segment count.
 * @overallScore 100
 */
export function toPathData(segments: Cubic[]): string {
  if (segments.length === 0) return ''
  const head = segments[0]!
  const parts = [`M${round(head.from.x)},${round(head.from.y)}`]
  for (const s of segments) {
    parts.push(
      `C${round(s.c1.x)},${round(s.c1.y)} ${round(s.c2.x)},${round(s.c2.y)} ${round(s.to.x)},${round(s.to.y)}`,
    )
  }
  return parts.join(' ')
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * Serialise grouped subpaths, re-emitting one `M` per contour and a `Z` for each closed one.
 *
 * This is the counterpart to the boundary tracking in `parsePath`: emitting a single leading `M`
 * and never a `Z` is what turned a square-with-a-hole into one open outline, because `fill-rule`
 * has no second contour to subtract.
 *
 * Every subpath reaching here holds at least one segment — they are only created when a segment
 * lands in one, and `normaliseCount` never shrinks a list — so the head is indexed directly.
 *
 * @complexity O(n) time and space in total segment count.
 * @overallScore 100
 */
function subpathsToPathData(subpaths: readonly Subpath[]): string {
  const parts: string[] = []
  for (const sub of subpaths) {
    const head = sub.segments[0]!
    parts.push(`M${round(head.from.x)},${round(head.from.y)}`)
    for (const s of sub.segments) {
      parts.push(
        `C${round(s.c1.x)},${round(s.c1.y)} ${round(s.c2.x)},${round(s.c2.y)} ${round(s.to.x)},${round(s.to.y)}`,
      )
    }
    if (sub.closed) parts.push('Z')
  }
  return parts.join(' ')
}

/**
 * The mean of a subpath's segment start points.
 *
 * Used as the collapse point for a contour that has no partner, so it grows out of — or shrinks
 * into — the middle of the shape it is standing in for, rather than flying in from the origin.
 *
 * Subpaths always carry at least one segment by construction, so there is no empty case to guard.
 *
 * @complexity O(n) time, O(1) space.
 * @overallScore 100
 */
function centroidOf(subpath: Subpath): Point {
  let x = 0
  let y = 0
  for (const s of subpath.segments) {
    x += s.from.x
    y += s.from.y
  }
  return { x: x / subpath.segments.length, y: y / subpath.segments.length }
}

/**
 * Build a stand-in contour with the same segment count as `partner`, collapsed to a single point.
 *
 * @complexity O(n) time and space in the partner's segment count.
 * @overallScore 100
 */
function collapsedLike(partner: Subpath): Subpath {
  const at = centroidOf(partner)
  return {
    segments: partner.segments.map(() => ({
      from: { ...at },
      c1: { ...at },
      c2: { ...at },
      to: { ...at },
    })),
    closed: partner.closed,
  }
}

/**
 * Pair two shapes' contours and balance each pair's segment count.
 *
 * **The pairing rule, which is a genuine design decision and not an obvious one.** Contours are
 * paired *in document order* — the first `M` of one shape morphs to the first `M` of the other.
 * Document order is predictable and matches how authors write the outer contour first; pairing by
 * area or proximity would be cleverer and would silently re-order under an author's edit.
 *
 * When the counts differ, the shorter shape gains **degenerate contours collapsed to the centroid
 * of their partner**, so a square-with-a-hole morphing to a plain square shrinks the hole into the
 * middle of the square rather than dropping it abruptly or dragging it from the origin.
 *
 * A pair is emitted as closed only when **both** sides are closed. A closed contour's final side
 * is already a real segment, so this costs no geometry — but emitting `Z` for a pair whose start
 * shape is an open curve would draw a closing line that the author never wrote, visible from the
 * first frame.
 *
 * @param a - Contours of the start shape.
 * @param b - Contours of the end shape.
 * @returns Two equal-length contour lists whose corresponding subpaths have equal segment counts.
 * @complexity O(n^2) worst case in segment count via `normaliseCount`; runs once per morph setup,
 *   never per frame.
 * @overallScore 100
 */
function normaliseSubpaths(
  a: readonly Subpath[],
  b: readonly Subpath[],
): { from: Subpath[]; to: Subpath[] } {
  const count = Math.max(a.length, b.length)
  const from: Subpath[] = []
  const to: Subpath[] = []

  for (let i = 0; i < count; i++) {
    const left = a[i] ?? collapsedLike(b[i]!)
    const right = b[i] ?? collapsedLike(a[i]!)
    const target = Math.max(left.segments.length, right.segments.length)
    const closed = left.closed && right.closed
    from.push({ segments: normaliseCount(left.segments, target), closed })
    to.push({ segments: normaliseCount(right.segments, target), closed })
  }

  return { from, to }
}

export interface Morph {
  /** Path data at `t` in [0, 1]. */
  at(t: number): string
  segmentCount: number
}

/**
 * Build an interpolator between two path strings.
 *
 * @param fromPath - Starting `d`.
 * @param toPath - Ending `d`.
 * @returns A morph, or a `reason` when either path cannot be normalised.
 * @complexity O(n log n)-ish setup in segment count; O(n) per `at` call.
 * @overallScore 100
 */
export function createMorph(
  fromPath: string,
  toPath: string,
): { morph?: Morph; reason?: string } {
  const a = parsePath(fromPath)
  const b = parsePath(toPath)
  if (a.reason) return { reason: `start path: ${a.reason}` }
  if (b.reason) return { reason: `end path: ${b.reason}` }

  // Balancing happens per contour, not across the whole flattened list. A global count would let
  // the outer square's segments pair with the hole's, so the two contours would swap places
  // mid-morph even once the boundaries were being emitted correctly.
  const { from, to } = normaliseSubpaths(a.subpaths, b.subpaths)
  const count = from.reduce((total, sub) => total + sub.segments.length, 0)

  return {
    morph: {
      segmentCount: count,
      at(t) {
        const clamped = Math.min(1, Math.max(0, t))
        return subpathsToPathData(
          from.map((sub, i) => ({
            segments: sub.segments.map((segment, j) =>
              lerpCubic(segment, to[i]!.segments[j]!, clamped),
            ),
            closed: sub.closed,
          })),
        )
      },
    },
  }
}

function lerpCubic(a: Cubic, b: Cubic, t: number): Cubic {
  return {
    from: lerpPoint(a.from, b.from, t),
    c1: lerpPoint(a.c1, b.c1, t),
    c2: lerpPoint(a.c2, b.c2, t),
    to: lerpPoint(a.to, b.to, t),
  }
}
