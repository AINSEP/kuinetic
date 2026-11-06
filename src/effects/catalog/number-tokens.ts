import type { PrepareContext } from '../../core/effect-context.js'
import { createFlipEngine } from '../../core/flip.js'
import type { Box } from '../../core/flip.js'
import type { ContinuousSetup } from '../../core/instances.js'
import { effectDurationMs } from '../../core/js-params.js'
import { timeScaleOf } from '../../core/time-scale.js'
import { waapiEasingValue } from '../../core/easing.js'
import type { Cleanup, EffectParams } from '../../core/types.js'
import { pinDeparture } from '../layout/departures.js'
import { effectDelayMs, effectEasing } from '../shared.js'
import { installCountLayers } from './numbers-shared.js'
import { hasInteractiveDescendant } from './text-shared.js'

/** Reuse matching characters from the right, including repeated digits, without changing their text. */
function characters(value: string, previous: HTMLElement[], doc: Document): HTMLElement[] {
  const pool = new Map<string, HTMLElement[]>()
  for (const node of previous) {
    const char = node.textContent!
    if (!pool.has(char)) pool.set(char, [])
    pool.get(char)!.push(node)
  }
  return Array.from(value).reverse().map((char) => {
    const survivor = pool.get(char)?.pop()
    if (survivor) return survivor
    const node = doc.createElement('span')
    node.className = 'kui-number-token'
    node.textContent = char
    return node
  }).reverse()
}

function tokenPlayer(el: Element, params: EffectParams, ctx: PrepareContext): {
  play(node: HTMLElement, frames: Keyframe[], done?: Cleanup): void
  cancel(): void
  timing: { durationMs: number; delayMs: number; easing: string | undefined }
} {
  const timing = { durationMs: effectDurationMs(params, 400), delayMs: effectDelayMs(params),
    easing: waapiEasingValue(effectEasing(params, 'ease-out'), el, ctx.warn) }
  const runs = new Map<Animation, Cleanup>()
  return {
    timing,
    play(node, frames, done = () => {}) {
      if (ctx.reducedMotion || !node.animate) { done(); return }
      const run = node.animate(frames, { duration: timing.durationMs, delay: timing.delayMs,
        easing: timing.easing, fill: 'backwards' })
      run.playbackRate = timeScaleOf(el)
      runs.set(run, done)
      const settle = (): void => {
        if (!runs.delete(run)) return
        run.cancel()
        done()
      }
      void run.finished.then(settle, settle)
    },
    cancel() {
      for (const [run, done] of runs) { run.cancel(); done() }
      runs.clear()
    },
  }
}

/** App-formatted LTR characters: O(n) matching, boundary reads only, no animation-frame loop. */
export function prepareNumberTokens(el: Element, params: EffectParams, ctx: PrepareContext): ContinuousSetup | Cleanup {
  if (hasInteractiveDescendant(el)) {
    ctx.warn('number-formatting needs a leaf element without interactive children')
    return () => {}
  }
  const authored = el.textContent!
  const layers = installCountLayers(el, ctx.doc)
  const host = layers.decorative
  host.classList.add('kui-number-tokens')
  const player = tokenPlayer(el, params, ctx)
  const engine = createFlipEngine({ ...(ctx.reducedMotion ? { animate: () => null } : {}) })
  let flip = (): void => {}
  let tokens: HTMLElement[] = []
  let value: string | undefined
  const update = (): void => {
    const next = el.getAttribute(params.text('attribute')) ?? authored
    if (next === value) return
    const width = host.getBoundingClientRect().width
    const before = engine.snapshot(tokens)
    player.cancel()
    flip()
    const previous = tokens
    tokens = characters(next, previous, ctx.doc)
    const survivors = new Set(tokens)
    const removed = previous.filter((node) => !survivors.has(node))
    for (const node of removed) node.remove()
    for (const node of tokens) host.append(node)
    const toWidth = host.getBoundingClientRect().width
    if (value !== undefined) player.play(host, [{ width: `${width}px` }, { width: `${toWidth}px` }])
    for (const node of removed) {
      pinDeparture(node, before.boxes.get(node) as Box, host)
      host.append(node)
    }
    if (value !== undefined) animateTokens(tokens, removed, before.boxes, player)
    const run = engine.play(before, tokens, player.timing)
    flip = run.cancel
    layers.srOnly.textContent = next
    value = next
  }
  update()
  const observer = new MutationObserver(update)
  observer.observe(el, { attributes: true, attributeFilter: [params.text('attribute')] })
  return { continuous: true, cleanup() { observer.disconnect(); player.cancel(); flip(); layers.restore() } }
}

function animateTokens(
  tokens: HTMLElement[],
  removed: HTMLElement[],
  before: Map<Element, Box>,
  player: ReturnType<typeof tokenPlayer>,
): void {
  for (const node of removed) player.play(node, [{ opacity: 1 }, { opacity: 0 }], () => node.remove())
  for (const node of tokens) if (!before.has(node)) player.play(node, [{ opacity: 0 }, { opacity: 1 }])
}
