import { fileURLToPath } from 'node:url'
import { createChecker } from '../../scripts/browser-harness.mjs'

/**
 * Every CSS-rendered effect in the catalog, applied to a real element in a real browser, sampled
 * across its own timeline.
 *
 * **This is the tier the repo did not have.** 973 unit tests at 100% coverage all assert on the
 * registry, on CSS *text*, or on jsdom attributes — and jsdom has no layout, no compositor and no
 * animation clock. So the suite could prove an effect was registered, that its keyframe existed,
 * and that the runtime stamped `data-kui-fx`, and stay green while the effect did nothing at all.
 * Five real bugs shipped through that gap in one night (2026-08-21): nine `clip-path` keyframes
 * that hard-cut instead of wiping, and twenty-two lab chips silently paused at frame 0 among them.
 *
 * Three assertions per effect, which is what that class of bug needed:
 *
 *   1. an animation is actually installed on the element;
 *   2. something *changes* between the start and the end of the timeline;
 *   3. the animation is running, not parked at frame 0.
 *
 * The properties sampled are read off each animation's own `getKeyframes()` rather than a fixed
 * list. That matters: a hand-written probe list read `transform` and reported `zoom-in`, `roll-in`
 * and `flip-in-y` as dead, because those keyframes animate the *individual* `scale` / `rotate` /
 * `translate` properties and leave `transform` at `none`. Deriving the list from the effect cannot
 * make that mistake — the probe can only be blind to a property the effect never declares.
 */
export const name = 'effect-sweep'

const FIXTURE_URL = `file://${fileURLToPath(new URL('./fixtures/effect-sweep.html', import.meta.url))}`

/**
 * An effect that waits for a pointer, a focus, or a click is *supposed* to sit paused on a probe
 * nobody touches — `grayscale-hover` starting on its own would be the bug. Which effects those are
 * is already declared, on the primitive, as `defaultActivation`; deriving the exclusion from that
 * beats a hand-kept list of names, which would go stale the first time a preset changes trigger.
 *
 * Everything else resolves to `enter` (`src/core/element-config.ts`) and must start by itself.
 */
const SELF_STARTING = new Set([undefined, 'load', 'enter'])

/**
 * Effects whose properties come from the attribute, so a bare name is not a spelling of them at all.
 *
 * Every other name in the catalog means something on its own — `fade-up 400ms` is a complete
 * animation. The generic tween is the one family where the author supplies the properties
 * (`tween x:120`), so `tween 400ms` correctly compiles to no animation and warns. Driving it bare
 * would report the probe's own empty attribute as a dead effect.
 *
 * This is a sample attribute, not an exclusion: the tween is swept exactly like everything else,
 * and has to install an animation, move across its timeline, interpolate rather than hard-cut, and
 * start by itself. What keeps the map from going stale is that it is checked in both directions
 * against the registry below: whether an effect needs parameters is derivable — its primitive
 * declares `variantFor` — so a third one arriving without an entry here fails the sweep rather than
 * being silently driven bare, and an entry left behind by a removed effect fails it too.
 */
const PARAMETERIZED = new Map([
  ['tween', 'x:120 opacity:0.2'],
  ['tween-from', 'y:40 opacity:0.2'],
])

/**
 * The two effects this probe genuinely cannot read, each with the reason. Both were checked by hand
 * before being excused — "the probe saw nothing" is not evidence that nothing happened, and six
 * effects were wrongly called dead that way once already.
 *
 * The count is reported in the check detail rather than quietly subtracted, so an exclusion cannot
 * grow into a blind spot nobody notices.
 */
const UNSAMPLEABLE = new Map([
  [
    'gradient-stroke',
    'animates the SVG `stroke` property; a <div> probe has no stroke to interpolate',
  ],
  [
    'redaction-reveal',
    'animates a registered custom property that a ::before reads back through var(), and ' +
      'getKeyframes() reports no properties at all — see src/css/text.css',
  ],
])

export async function run({ browser }) {
  const { check, results } = createChecker()

  const context = await browser.newContext({ viewport: { width: 900, height: 700 } })
  const page = await context.newPage()
  await page.goto(FIXTURE_URL)
  await page.waitForFunction(() => window.__kui !== undefined)

  const catalog = await page.evaluate(() => {
    const registry = window.__registry
    return registry
      .names()
      .map((effect) => ({ effect, ...registry.resolve(effect) }))
      .filter((entry) => entry.primitive?.renderer === 'css-keyframes')
      .map((entry) => ({
        effect: entry.effect,
        activation: entry.primitive.defaultActivation,
        // A primitive that refines itself per spec reads its properties off the attribute, so the
        // probe cannot drive it by name alone. See `PARAMETERIZED`.
        parameterDriven: typeof entry.primitive.variantFor === 'function',
      }))
  })
  const cssNames = catalog.map((entry) => entry.effect)
  const selfStarting = new Set(
    catalog.filter((entry) => SELF_STARTING.has(entry.activation)).map((entry) => entry.effect),
  )

  check('the fixture sees a populated CSS catalog to sweep', cssNames.length > 100, `${cssNames.length} css-keyframes effects`)

  // Both directions, so the map can neither miss a new parameter-driven effect nor keep an entry
  // for one that stopped being parameter-driven and should now be swept bare like everything else.
  const parameterDriven = catalog.filter((entry) => entry.parameterDriven).map((entry) => entry.effect)
  const undriven = parameterDriven.filter((effect) => !PARAMETERIZED.has(effect))
  const stale = [...PARAMETERIZED.keys()].filter((effect) => !parameterDriven.includes(effect))
  check(
    'every parameter-driven effect has a sample attribute, and no entry outlives its effect',
    undriven.length === 0 && stale.length === 0 && parameterDriven.length > 0,
    undriven.length === 0 && stale.length === 0
      ? `${parameterDriven.length} driven with sample properties`
      : `no sample for: ${undriven.join(', ') || 'none'}; stale entry: ${stale.join(', ') || 'none'}`,
  )

  const specs = cssNames.map((effect) => ({
    effect,
    attribute: PARAMETERIZED.has(effect) ? `${effect} ${PARAMETERIZED.get(effect)} 400ms` : `${effect} 400ms`,
  }))

  const report = await page.evaluate(async (probes) => {
    const stage = document.getElementById('stage')
    const frame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    const rows = []

    for (const { effect, attribute } of probes) {
      // A fresh element each time: a reused one keeps the previous effect's inline properties and
      // its `data-kui-fx`, and the runtime would be diffing rather than compiling from scratch.
      // `replaceChildren` and not `probe.remove()` — a reference captured once outside the loop
      // goes stale after the first swap, the stage silently fills up with 157 probes, and every
      // effect past the first screenful gets reported as paused because it is genuinely off-screen.
      const el = document.createElement('div')
      el.id = 'probe'
      el.textContent = 'probe'
      // The attribute goes on *before* the element enters the document. The runtime's watcher
      // compiles on insertion; an element added bare and decorated a tick later is simply never
      // seen, which reads exactly like a catalog of dead effects.
      el.setAttribute('data-kui', attribute)
      stage.replaceChildren(el)

      // Poll rather than wait a fixed tick. `on:enter` runs off an IntersectionObserver, whose
      // first callback can be a frame or two behind insertion — sampling too early reports a
      // perfectly healthy effect as "installed but paused", which is the exact symptom of the bug
      // this suite exists to catch. Bounded, so a genuinely parked effect still fails.
      const deadline = 500
      let animations = []
      for (let waited = 0; waited <= deadline; waited += 40) {
        animations = [el, ...el.querySelectorAll('*')].flatMap((node) => node.getAnimations())
        if (animations.length > 0 && animations.every((animation) => animation.playState !== 'paused')) break
        await new Promise((resolve) => setTimeout(resolve, 40))
      }
      if (animations.length === 0) {
        rows.push({ effect, installed: false })
        continue
      }

      const playStates = [...new Set(animations.map((animation) => animation.playState))]

      // The property list comes from the effects themselves, so the probe cannot be blind to a
      // property some keyframe animates but a hand-written list forgot.
      const properties = new Set()
      for (const animation of animations) {
        for (const keyframe of animation.effect.getKeyframes()) {
          for (const property of Object.keys(keyframe)) {
            if (!['offset', 'computedOffset', 'easing', 'composite'].includes(property)) {
              properties.add(property)
            }
          }
        }
      }
      const read = () =>
        animations
          .map((animation) => {
            const style = getComputedStyle(animation.effect.target)
            return [...properties]
              .map((property) => (property.startsWith('--') ? style.getPropertyValue(property) : style[property]))
              .join('|')
          })
          .join('#')

      const duration = Math.max(...animations.map((a) => a.effect.getComputedTiming().duration || 0)) || 400
      const samples = []
      for (const fraction of [0, 0.25, 0.5, 0.75, 1]) {
        for (const animation of animations) {
          try {
            animation.pause()
            animation.currentTime = duration * fraction
          } catch {
            // A scroll-driven or otherwise unseekable timeline; its other samples still count.
          }
        }
        await frame()
        samples.push(read())
      }
      for (const animation of animations) {
        try {
          animation.cancel()
        } catch {
          // Already detached by its own cleanup.
        }
      }

      rows.push({
        effect,
        installed: true,
        playStates,
        distinct: new Set(samples).size,
        // Not "first differs from last": an infinite effect's last frame *is* its first, so a
        // healthy `spinner` or `marquee` would read as dead. What matters is that the timeline
        // passes through more than one state at all.
        moves: new Set(samples).size > 1,
        // The signature of a non-interpolable keyframe pair: the browser falls back to discrete
        // interpolation, so the value holds, swaps once at exactly 50%, and holds again. Counting
        // distinct frames alone is not enough — `copy-confirm` legitimately reads 0,1,1,1,0.
        discreteSwap:
          new Set(samples).size === 2 &&
          samples.filter((sample, index) => index > 0 && sample !== samples[index - 1]).length === 1 &&
          samples[2] !== samples[1],
      })
    }

    return rows
  }, specs)

  const missing = report.filter((row) => !row.installed).map((row) => row.effect)
  check(
    'every CSS effect installs an animation when its attribute is written',
    missing.length === 0,
    missing.length === 0 ? `${report.length} effects` : `no animation for: ${missing.join(', ')}`,
  )

  // "Distinct" rather than "endpoints differ": a `clip-path` keyframe with no `to` interpolates
  // discretely and swaps at 50%, so its endpoints *do* differ while every frame in between is one
  // of two values. Counting distinct samples is what catches the hard cut.
  const live = report.filter((row) => row.installed && !UNSAMPLEABLE.has(row.effect))
  const dead = live.filter((row) => !row.moves).map((row) => row.effect)
  check(
    'every CSS effect passes through more than one state across its timeline',
    dead.length === 0 && live.length > 100,
    dead.length === 0
      ? `${live.length} effects move, ${UNSAMPLEABLE.size} excluded as unsampleable`
      : `no visible change: ${dead.join(', ')}`,
  )

  const stepped = live.filter((row) => row.discreteSwap).map((row) => row.effect)
  check(
    'no CSS effect swaps discretely at the midpoint instead of interpolating',
    stepped.length === 0 && live.length > 100,
    stepped.length === 0
      ? 'no timeline changes exactly once, exactly halfway'
      : `hard cut at 50% (a non-interpolable endpoint pair): ${stepped.join(', ')}`,
  )

  const shouldRun = live.filter((row) => selfStarting.has(row.effect))
  const paused = shouldRun.filter((row) => row.playStates.includes('paused')).map((row) => row.effect)
  check(
    'no self-starting CSS effect is installed and then left parked at frame 0',
    paused.length === 0 && shouldRun.length > 100,
    paused.length === 0
      ? `${shouldRun.length} self-starting effects running, ${live.length - shouldRun.length} waiting on a trigger`
      : `installed but paused: ${paused.join(', ')}`,
  )

  await context.close()
  return results
}
