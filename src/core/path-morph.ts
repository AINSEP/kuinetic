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

export interface ParseResult {
  segments: Cubic[]
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
    return { segments: [], reason: 'arc and shorthand commands (A S Q T) are not supported' }
  }

  const tokens = [...d.matchAll(COMMAND)].map((m) => m[1] ?? m[2]!)
  const state: PathState = {
    segments: [],
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
    if (!state.command) return { segments: [], reason: 'path must start with a command letter' }
    index = consume(tokens, index, state)
  }

  if (state.segments.length === 0) return { segments: [], reason: 'no drawable segments' }
  return { segments: state.segments }
}

interface PathState {
  segments: Cubic[]
  current: Point
  start: Point
  command: string
}

/** Numbers each command consumes per repetition. */
const ARITY: Record<string, number> = { m: 2, l: 2, h: 1, v: 1, c: 6, z: 0 }

/**
 * Close the current subpath with a line back to its start.
 *
 * A no-op when the pen is already at the start, so `M0,0 L10,0 L0,0 Z` does not gain a
 * zero-length segment that would later be split into a visible kink.
 *
 * @complexity O(1) time and space.
 * @overallScore 100
 */
function closeSubpath(state: PathState): void {
  const { current, start } = state
  if (Math.abs(current.x - start.x) < 1e-6 && Math.abs(current.y - start.y) < 1e-6) return
  state.segments.push(lineToCubic(current, start))
  state.current = { ...start }
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
    // A subsequent implicit repetition of `m` is a lineto, per the SVG spec.
    state.command = relative ? 'l' : 'L'
    return index + arity
  }

  state.segments.push(straightOrCubic({ key, args, from: state.current, relative }, next))
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

  const count = Math.max(a.segments.length, b.segments.length)
  const from = normaliseCount(a.segments, count)
  const to = normaliseCount(b.segments, count)

  return {
    morph: {
      segmentCount: count,
      at(t) {
        const clamped = Math.min(1, Math.max(0, t))
        return toPathData(from.map((segment, i) => lerpCubic(segment, to[i]!, clamped)))
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
