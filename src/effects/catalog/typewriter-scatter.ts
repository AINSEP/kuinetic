import type { PrepareContext } from '../../core/effect-context.js'
import type { SetupResult } from '../../core/instances.js'
import type { EffectParams } from '../../core/types.js'
import { createStepRunner, naturalTypeDelay, segmentGraphemes, stepMsFor } from './text-shared.js'
import type { SplitLayers } from './text-shared.js'

const SCATTER_MS = 400

function appendLetter(container: HTMLElement, grapheme: string, index: number): void {
  const doc = container.ownerDocument
  if (grapheme.trim() === '') {
    container.append(doc.createTextNode(grapheme))
    return
  }
  let word = container.lastElementChild
  if (!word || word !== container.lastChild) {
    word = container.appendChild(doc.createElement('span'))
    word.className = 'kui-split-word'
  }
  const letter = word.appendChild(doc.createElement('span'))
  letter.className = 'kui-typewriter-letter'
  letter.textContent = grapheme
  letter.style.setProperty('--kui-scatter-x', `${((index * 17) % 11 - 5) * .35}em`)
  letter.style.setProperty('--kui-scatter-y', `${((index * 7) % 9 - 4) * .45}em`)
  letter.style.setProperty('--kui-scatter-rotate', `${((index * 29) % 13 - 6) * 9}deg`)
}

export function prepareScatterTypewriter(
  layers: SplitLayers,
  params: EffectParams,
  ctx: PrepareContext,
  words: string[],
): SetupResult {
  const { decorative } = layers
  const loop = params.is('loop') || words.length > 0
  let wordIndex = 0
  let graphemes = segmentGraphemes(words[0] ?? layers.originalText)
  let count = 0
  const step = Math.max(1, stepMsFor(params, graphemes.length, 55))
  const pace = (): number => params.is('rhythm', 'natural') ? naturalTypeDelay(graphemes, count, step) : step
  let wait = pace()
  decorative.style.setProperty('--kui-scatter-duration', `${SCATTER_MS}ms`)
  const next = (): boolean => {
    decorative.replaceChildren()
    delete decorative.dataset.kuiTypewriterPhase
    wordIndex = (wordIndex + 1) % Math.max(1, words.length)
    graphemes = segmentGraphemes(words[wordIndex] ?? layers.originalText)
    count = 0
    action = type
    wait = pace()
    return false
  }
  const scatter = (): boolean => {
    decorative.dataset.kuiTypewriterPhase = 'scatter'
    action = next
    wait = SCATTER_MS
    return false
  }
  const type = (): boolean => {
    if (count < graphemes.length) appendLetter(decorative, graphemes[count]!, count++)
    wait = pace()
    if (count < graphemes.length) return false
    if (!loop) return true
    action = scatter
    wait = params.ms('interval', 1500)
    return false
  }
  let action = type
  const run = createStepRunner(ctx.win, {
    delayMs: params.timing.delayMs ?? params.ms('delay', 0),
    stepMs: step,
    nextDelay: () => wait,
    tick: () => action(),
  })
  return {
    finished: run.finished,
    cleanup: () => {
      run.stop()
      layers.restore()
    },
    finish: () => {
      run.stop()
      delete decorative.dataset.kuiTypewriterPhase
      while (count < graphemes.length) appendLetter(decorative, graphemes[count]!, count++)
    },
  }
}
