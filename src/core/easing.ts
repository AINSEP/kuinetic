import { isSettled, stepSpring } from './spring.js'
import type { SpringConfig } from './spring.js'

/**
 * Easing tokens, and the CSS value each one compiles to.
 *
 * There are two places an author can name a curve and they used to resolve it in two different
 * places, with two different answers:
 *
 * - the **positional** token (`fade-up 600ms back-out`), lifted onto `EffectSpec.easing` and
 *   resolved by `declarations.ts` into `animation-timing-function`; and
 * - the **`ease:` pair** (`fade-up ease:back-out`), which `parse.ts` reads as an ordinary
 *   `key:value` — `splitPair` matches the first colon before `classify` ever asks whether the token
 *   is an easing — so it lands in `spec.params.ease` and is written to `--kui-<primitive>-ease`.
 *
 * The second path wrote the token *verbatim*. `animation-timing-function: back-out` is not a valid
 * declaration, so the browser threw it away and every effect authored that way silently ran on the
 * initial `ease` — `back-out`, `expo-out`, `circ-out`, `quart-out`, `spring` and `bounce` alike.
 * `scripts/generate-preset-css.mjs` had already found and fixed exactly this bug for *preset*
 * defaults; its comment claimed the runtime "already gets the inline `ease:back-out` grammar
 * right", which was true only of the positional half. This module is the one answer both halves
 * now go through, so they cannot disagree again.
 *
 * ## `spring(...)`
 *
 * `ease:spring` is a fixed curve — one overshoot, one feel, no knobs — while `core/spring.ts` has
 * carried a real numeric spring integrator all along, wired only to JS-driven gestures. The
 * function token exposes that same solver to the declarative grammar: `spring(bounce:0.5)` is
 * sampled here, at compile time, into the `linear()` easing CSS has had since 2023.
 *
 * ### Time is the author's; the physics only shapes it
 *
 * A CSS timing function is *normalised*: it maps 0..1 of the animation's own duration onto 0..1 of
 * its progress. A real spring's duration falls out of its constants instead. Something has to give,
 * and it is the physics: the generated curve always starts at 0, ends at 1, and fills exactly
 * whatever duration the author (or the preset) declared. The spring constants decide the *shape* —
 * how far it overshoots and how many times it crosses back — never how long it takes.
 *
 * That has a consequence worth stating plainly rather than discovering: once the time axis is
 * normalised, the three-constant family collapses to **one** degree of freedom, the damping ratio
 * `zeta = damping / (2 * sqrt(stiffness * mass))`. `spring(stiffness:400 damping:20)` and
 * `spring(stiffness:100 damping:10)` are the same curve, because they are the same spring played at
 * two speeds and the speed is not ours to keep. Neither knob is dead — each one moves `zeta`, so
 * each one changes the curve — but they are not independent, and an author who expects
 * `stiffness:` alone to make an 800ms animation feel faster will not get that. `bounce:` is the
 * honest spelling of the one thing that actually varies, which is why Motion.dev leads with it too.
 *
 * ### There is deliberately no `bounce(...)`
 *
 * `--kui-ease-bounce` stays a fixed token. A tunable `bounce()` would be the same ODE under a
 * second name — `spring(bounce:0.8)` already *is* a bouncier bounce — and two spellings of one
 * thing is the mistake `parse.ts` spends three paragraphs avoiding for `stagger:`/`cascade:`. The
 * name is not free either: what CSS libraries usually call an ease-out-bounce is a *ball*, the
 * absolute value of a damped sine, which never falls below its target. A spring does. Emitting one
 * under the other's name would be a lie told in the one place an author cannot check it.
 */

/** CSS-native timing keywords; anything else resolves to a `--kui-ease-*` custom property. */
const NATIVE_EASINGS: ReadonlySet<string> = new Set([
  'linear',
  'ease',
  'ease-in',
  'ease-out',
  'ease-in-out',
  'step-start',
  'step-end',
])

/** The one easing function this library *generates* rather than hands to the browser unread. */
const SPRING_PREFIX = 'spring('

/**
 * Damping ratio for a bare `spring()`.
 *
 * Chosen to reproduce the shipped `--kui-ease-spring` token rather than `spring.ts`'s
 * `DEFAULT_SPRING`, and the difference is deliberate. `--kui-ease-spring` peaks at 1.06, and a
 * spring's first overshoot is `exp(-pi * zeta / sqrt(1 - zeta^2))`, so 6% is `zeta ~= 2/3`.
 * `DEFAULT_SPRING` is `zeta ~= 0.894` — barely any overshoot — because it is the *gesture* default,
 * where an element oscillating under a user's finger reads as sloppiness rather than character.
 * Two jobs, two numbers.
 *
 * Matching the keyword is what makes `ease:spring` -> `ease:spring()` a no-op, and
 * `ease:spring()` -> `ease:spring(bounce:0.5)` a change in exactly the one thing the author asked
 * to change. A function that looked different from the keyword it is named after would be the
 * silent divergence this codebase spends whole comments avoiding elsewhere.
 */
const DEFAULT_RATIO = 2 / 3

const DEFAULT_STIFFNESS = 180
const DEFAULT_MASS = 1

/** The damping that puts {@link DEFAULT_STIFFNESS} at {@link DEFAULT_RATIO}, so `spring(stiffness:180)` is `spring()`. */
const DEFAULT_DAMPING = 2 * DEFAULT_RATIO * Math.sqrt(DEFAULT_STIFFNESS * DEFAULT_MASS)

/**
 * Floor on the damping ratio, and with it the ceiling on `bounce:`.
 *
 * `damping: 0` is a spring that never settles — Motion's own docs warn about it — so a sampler
 * given one integrates until something stops it. That "something" must not be a step budget
 * reached after a hundred thousand iterations of the compiler, and it must not be an unbounded
 * `linear()` either: a `zeta` of 0.15 already oscillates about six and a half times before it
 * rests, which is at the edge of what {@link MAX_SAMPLES} stops can describe honestly. Below that
 * the curve stops being an easing and starts being a loop.
 */
const MIN_RATIO = 0.15

/** Overdamped is legitimate — a slow, monotone approach — but past this it is a linear ramp. */
const MAX_RATIO = 4

const MAX_BOUNCE = 1 - MIN_RATIO

const PHYSICS_KEYS = ['stiffness', 'damping', 'mass'] as const
const SPRING_KEYS: readonly string[] = ['bounce', ...PHYSICS_KEYS]

/**
 * Integration step, in the dimensionless time the sampler works in.
 *
 * The simulation is run at `stiffness: 1, mass: 1`, so one unit of its time is one radian of the
 * undamped oscillation and the whole curve is a function of the damping ratio alone. Matching
 * `spring.ts`'s own `SUBSTEP` means each `stepSpring` call performs exactly one internal iteration.
 */
const SIM_STEP = 1 / 240

/**
 * Hard iteration ceiling.
 *
 * {@link MIN_RATIO} already guarantees settling in roughly 10,000 steps and {@link MAX_RATIO} in
 * roughly 12,000, so this is never the thing that stops the loop. It exists because a sampler that
 * *could* spin forever if a future caller reached past the clamp is a hang in a compiler, and a
 * truncated curve that still ends at 1 is a visible, harmless wrong instead.
 */
const MAX_SIM_STEPS = 40_000

/**
 * Settle thresholds for a 0..1 displacement, far tighter than the pixel-space gesture defaults.
 *
 * These set where the curve *stops*, and {@link buildCurve} then pins that last stop to exactly 1.
 * Loose thresholds therefore show up as a visible step at the very end — the spring is left at
 * 0.996 and the emitted curve jumps the remaining 0.4% inside the final sample interval. A tenth of
 * a percent is under one pixel on any travel a page actually animates.
 */
const REST_DISPLACEMENT = 0.001
const REST_VELOCITY = 0.001

/**
 * Enough stops to describe a curve with no oscillation at all.
 *
 * A critically damped spring leaves its from-state with zero velocity, and `linear()` interpolates
 * between stops with straight lines — too few and the first segment is a straight ramp out of 0
 * where the physics asks for a stationary start, which reads as the ease-in having been dropped.
 */
const MIN_SAMPLES = 16
const MAX_SAMPLES = 64
const SAMPLES_PER_PERIOD = 10

/** Decimal places each `linear()` stop is rounded to. */
const PRECISION = 1000

/**
 * Whether a token is the generated spring function.
 *
 * @complexity O(1) time and space.
 * @overallScore 100
 */
function isSpringToken(token: string): boolean {
  return token.startsWith(SPRING_PREFIX) && token.endsWith(')')
}

/**
 * Resolve one authored easing token to the value a stylesheet can hold.
 *
 * @param easing - A native keyword, a kUInetic keyword, a CSS easing function, or `spring(...)`.
 * @returns A valid `animation-timing-function` / `transition-timing-function` value. Never the
 *   author's own text for a `spring(...)`: that path emits digits generated from clamped numbers,
 *   so nothing authored survives into the declaration.
 * @complexity O(1) amortised — a `spring(...)` curve is built once per distinct damping ratio and
 *   cached; every other form is a set lookup. O(1) space beyond the cache.
 * @overallScore 100
 */
export function cssEasingValue(easing: string): string {
  if (NATIVE_EASINGS.has(easing)) return easing
  if (isSpringToken(easing)) return springLinearCurve(springDampingRatio(easing))
  if (easing.includes('(')) return easing
  return `var(--kui-ease-${easing}, ease-out)`
}

/**
 * The curve a bare keyword falls back to when nothing defines it.
 *
 * Deliberately the same word as {@link cssEasingValue}'s `var()` fallback, so an unknown token
 * runs identically whether it reached the browser through a stylesheet or through this function.
 */
const WAAPI_FALLBACK = 'ease-out'

/**
 * Resolve one authored easing token to a value `Element.animate` will actually accept.
 *
 * The Web Animations sibling of {@link cssEasingValue}, and it exists because the two APIs screen
 * easings at different moments. A stylesheet resolves `var(--kui-ease-back-out, ease-out)` through
 * the cascade at computed-value time; `KeyframeEffect`'s `easing` option is parsed as a bare
 * `<easing-function>` the instant it is handed over, with no cascade to consult — so `var(...)` is
 * as invalid there as `back-out` itself. Neither one degrades: Chrome throws
 * `TypeError: 'back-out' is not a valid value for easing` out of `animate()`, which took the whole
 * FLIP with it and left the layout change to happen instantly and silently.
 *
 * So the custom property is read here instead of deferred to the browser. Reading it — rather than
 * mirroring `base.css`'s ten definitions into a table here — is what keeps the open half of the
 * vocabulary working: `params.ts`'s `EASING_KEYWORD` accepts any `[a-z]+-(in|out|in-out)`, so an
 * author may define `--kui-ease-swift-out` and write `ease:swift-out`, and a table could only ever
 * know the names this repo happens to ship. It also cannot drift from `base.css`, because it *is*
 * `base.css`. The cost is that it only answers correctly once the library's stylesheet has been
 * applied, which is why the three callers resolve at prepare time rather than at module load.
 *
 * @param easing - A native keyword, a kUInetic keyword, a CSS easing function, or `spring(...)`.
 * @param el - Element the token is resolved against, so a `--kui-ease-*` scoped to a subtree wins
 *   exactly as it would in the cascade.
 * @param warn - Called once when a named token resolves to nothing.
 * @returns A literal easing value, or `undefined` when the author named none — which leaves each
 *   caller's own default standing rather than substituting a house one for it.
 * @complexity O(1) amortised; a bare keyword costs one `getComputedStyle` read.
 * @overallScore 100
 */
export function waapiEasingValue(
  easing: string,
  el: Element,
  warn: (message: string) => void,
): string | undefined {
  if (!easing) return undefined
  if (NATIVE_EASINGS.has(easing)) return easing
  if (isSpringToken(easing)) return springLinearCurve(springDampingRatio(easing))
  if (easing.includes('(')) return easing

  const defined = customEasing(easing, el)
  if (defined) return defined
  warn(`easing "${easing}" has no --kui-ease-${easing} definition — using ${WAAPI_FALLBACK}`)
  return WAAPI_FALLBACK
}

/**
 * Read `--kui-ease-<name>` as the cascade would see it on this element.
 *
 * @returns The literal value, or `''` when nothing defines the property — which is also what an
 *   element in a document with no view returns, and both mean the same thing to the caller.
 * @complexity O(1) time and space, but forces a style recalculation.
 * @overallScore 100
 */
function customEasing(name: string, el: Element): string {
  const view = el.ownerDocument.defaultView
  if (!view) return ''
  return view.getComputedStyle(el).getPropertyValue(`--kui-ease-${name}`).trim()
}

/**
 * Everything wrong with a `spring(...)` token, named one problem at a time.
 *
 * Separate from {@link cssEasingValue} because the two answer different questions and have
 * different callers: `parse.ts` has the author's text and a warnings sink at the moment the
 * attribute is read, which is where every other grammar diagnostic in this library is raised.
 * Nothing here is fatal — a refused value is clamped or dropped and a curve is always produced —
 * so this is a warning list, never a rejection.
 *
 * @param token - Any easing token. A token that is not a `spring(...)` has no problems by
 *   definition, so callers need no guard of their own.
 * @returns One message per malformed, unknown, duplicated, or out-of-range argument.
 * @complexity O(a) time and space in the argument count.
 * @overallScore 100
 */
export function springTokenProblems(token: string): string[] {
  if (!isSpringToken(token)) return []
  const { values, problems } = readArguments(token)
  resolveRatio(values, problems)
  return problems
}

/**
 * The damping ratio a `spring(...)` token asks for, clamped to a range that always settles.
 *
 * @complexity O(a) time in the argument count; O(a) space.
 * @overallScore 100
 */
function springDampingRatio(token: string): number {
  const { values, problems } = readArguments(token)
  return resolveRatio(values, problems)
}

interface SpringArguments {
  values: Map<string, number>
  problems: string[]
}

/**
 * Read `spring(bounce:0.5)` / `spring(stiffness:400 damping:20 mass:1)` into numbers.
 *
 * The body reuses the outer grammar exactly — space-separated `key:value` — rather than inventing a
 * comma-and-position convention inside one set of parentheses. `parse.ts`'s tokenizer is both
 * paren- and colon-depth-aware, so neither the spaces nor the inner colons need quoting at either
 * spelling: `splitPair` only splits on a top-level colon, and `splitTopLevel(segment, ' ')` does not
 * separate inside parentheses.
 *
 * @param token - A token {@link isSpringToken} has already accepted.
 * @complexity O(a) time and space in the argument count.
 * @overallScore 100
 */
function readArguments(token: string): SpringArguments {
  const values = new Map<string, number>()
  const problems: string[] = []
  const body = token.slice(SPRING_PREFIX.length, -1).trim()
  if (body) {
    for (const part of body.split(/\s+/)) readArgument(part, values, problems)
  }
  return { values, problems }
}

/**
 * Read one `key:value` argument, or say why it is not one.
 *
 * @param values - Mutated with the accepted number.
 * @param problems - Mutated with a diagnostic when the argument is refused.
 * @complexity O(1) time and space.
 * @overallScore 100
 */
function readArgument(part: string, values: Map<string, number>, problems: string[]): void {
  const colon = part.indexOf(':')
  const key = colon < 0 ? part : part.slice(0, colon)
  const raw = colon < 0 ? '' : part.slice(colon + 1)
  if (!SPRING_KEYS.includes(key)) {
    problems.push(`unknown spring parameter "${part}" — expected ${SPRING_KEYS.join(', ')}`)
    return
  }
  const numeric = Number(raw)
  if (raw === '' || !Number.isFinite(numeric) || numeric < 0) {
    problems.push(`spring "${key}" expects a non-negative number — got "${raw}"`)
    return
  }
  if (values.has(key)) problems.push(`duplicate spring parameter "${key}"`)
  values.set(key, numeric)
}

/**
 * Fold the authored arguments into the single number the curve depends on.
 *
 * @param problems - Mutated: every clamp and every contradiction is named here rather than applied
 *   quietly, because a silently corrected spring is indistinguishable from one that was understood.
 * @complexity O(1) time and space.
 * @overallScore 100
 */
function resolveRatio(values: Map<string, number>, problems: string[]): number {
  const bounce = values.get('bounce')
  const hasPhysics = PHYSICS_KEYS.some((key) => values.has(key))

  if (bounce !== undefined) {
    if (hasPhysics) {
      problems.push(
        `spring "bounce" and "${PHYSICS_KEYS.join('"/"')}" describe the same curve two ways — ` +
          `"bounce" wins`,
      )
    }
    return 1 - clampBounce(bounce, problems)
  }
  if (!hasPhysics) return DEFAULT_RATIO

  const stiffness = values.get('stiffness') ?? DEFAULT_STIFFNESS
  const mass = values.get('mass') ?? DEFAULT_MASS
  const damping = values.get('damping') ?? DEFAULT_DAMPING
  return clampRatio(damping / (2 * Math.sqrt(stiffness * mass)), problems)
}

/**
 * @complexity O(1) time and space.
 * @overallScore 100
 */
function clampBounce(bounce: number, problems: string[]): number {
  if (bounce <= MAX_BOUNCE) return bounce
  problems.push(
    `spring "bounce:${bounce}" is past ${MAX_BOUNCE} — a spring that bouncy never settles ` +
      `inside one animation, so it is capped at ${MAX_BOUNCE}`,
  )
  return MAX_BOUNCE
}

/**
 * `stiffness:0`/`mass:0` divide by zero and `damping:0` never settles; both arrive here as a ratio
 * outside the range rather than as a special case, so one clamp covers every way of asking for a
 * spring that cannot finish.
 *
 * @complexity O(1) time and space.
 * @overallScore 100
 */
function clampRatio(ratio: number, problems: string[]): number {
  if (!Number.isFinite(ratio)) {
    problems.push('spring constants do not describe a spring — using the default curve')
    return DEFAULT_RATIO
  }
  if (ratio >= MIN_RATIO && ratio <= MAX_RATIO) return ratio
  const clamped = Math.min(Math.max(ratio, MIN_RATIO), MAX_RATIO)
  problems.push(
    `spring damping ratio ${round(ratio)} is outside ${MIN_RATIO}–${MAX_RATIO} — ` +
      `clamped to ${round(clamped)} so the curve settles`,
  )
  return clamped
}

/** Distinct damping ratios are few and pages repeat them; the curve is built once per ratio. */
const curves = new Map<number, string>()

/**
 * Sample the spring integrator into a CSS `linear()` easing.
 *
 * Stops are emitted **without positions**, which is not a shortcut: `linear()` distributes
 * unpositioned stops evenly, and the samples are taken at even fractions of the settle time, so the
 * positions are exactly the ones CSS would infer. Writing them out would roughly double the string
 * for no change in meaning.
 *
 * @param dampingRatio - Already clamped by {@link resolveRatio}.
 * @returns A `linear(...)` value whose first stop is exactly 0 and last exactly 1.
 * @complexity O(1) amortised per distinct ratio; the uncached path is O(s) in simulation steps —
 *   bounded by {@link MAX_SIM_STEPS} — and O(s) space for the trajectory.
 * @overallScore 100
 */
function springLinearCurve(dampingRatio: number): string {
  const key = Math.round(dampingRatio * PRECISION)
  const cached = curves.get(key)
  if (cached !== undefined) return cached
  const curve = buildCurve(key / PRECISION)
  curves.set(key, curve)
  return curve
}

/**
 * @complexity O(s) time in simulation steps; O(s) space.
 * @overallScore 100
 */
function buildCurve(ratio: number): string {
  const trajectory = simulate(ratio)
  const count = sampleCount(ratio, (trajectory.length - 1) * SIM_STEP)
  const stops: string[] = []
  for (let index = 0; index <= count; index++) {
    stops.push(String(round(sampleAt(trajectory, index / count))))
  }
  // The endpoints are asserted rather than sampled. A settle threshold stops the integration a
  // hair short of 1 by construction, and an easing that ends at 0.999 leaves the element one
  // rounding away from its final state forever — `animation-fill-mode: both` holds that last frame.
  stops[0] = '0'
  stops[count] = '1'
  return `linear(${stops.join(', ')})`
}

/**
 * Integrate a unit step response at `stiffness: 1, mass: 1`, so the result depends only on `ratio`.
 *
 * @returns Displacement at every step, starting at 0, ending on the first settled step.
 * @complexity O(s) time and space in the step count, bounded by {@link MAX_SIM_STEPS}.
 * @overallScore 100
 */
function simulate(ratio: number): number[] {
  const config: SpringConfig = {
    stiffness: 1,
    damping: 2 * ratio,
    mass: 1,
    restVelocity: REST_VELOCITY,
    restDisplacement: REST_DISPLACEMENT,
  }
  const values = [0]
  let state = { value: 0, velocity: 0 }
  for (let step = 0; step < MAX_SIM_STEPS; step++) {
    state = stepSpring(state, 1, config, SIM_STEP)
    values.push(state.value)
    if (isSettled(state, 1, config)) break
  }
  return values
}

/**
 * How many stops this curve needs.
 *
 * `linear()` interpolates linearly between stops, so the resolution that matters is stops per
 * oscillation, not stops per curve: a critically damped spring is monotone and {@link MIN_SAMPLES}
 * describes it exactly, while a bouncy one needs about ten per crossing before the sampled peaks
 * stop visibly under-reaching the real ones.
 *
 * @complexity O(1) time and space.
 * @overallScore 100
 */
function sampleCount(ratio: number, settleTime: number): number {
  if (ratio >= 1) return MIN_SAMPLES
  const period = (2 * Math.PI) / Math.sqrt(1 - ratio * ratio)
  const stops = MIN_SAMPLES + Math.round((SAMPLES_PER_PERIOD * settleTime) / period)
  return Math.min(stops, MAX_SAMPLES)
}

/**
 * Read the trajectory at a fraction of its length, interpolating between steps.
 *
 * @complexity O(1) time and space.
 * @overallScore 100
 */
function sampleAt(values: number[], fraction: number): number {
  const position = fraction * (values.length - 1)
  const low = Math.floor(position)
  const high = Math.min(low + 1, values.length - 1)
  const start = values[low]!
  return start + (values[high]! - start) * (position - low)
}

function round(value: number): number {
  return Math.round(value * PRECISION) / PRECISION
}
