import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createParams } from '../src/core/js-params.js'
import { createStyleLedger } from '../src/core/owned-styles.js'
import type { PrepareContext } from '../src/core/effect-context.js'
import {
  appendCharSpans,
  appendLineSpans,
  appendSpansFor,
  appendWordSpans,
  installSplitLayers,
  nextTypeState,
  scrambledFrame,
  segmentGraphemes,
  splitRevealFinishMs,
} from '../src/effects/catalog/text-shared.js'
import { catalogRegistry } from './support/registry.js'

/**
 * A real per-element `StyleLedger` alongside `win` — `scramble`/`decode`/`glitch` read `ctx.style`
 * to reserve their resting-state box size; every other JS-tier text primitive still reads nothing
 * off `ctx` beyond `win` (timers for typewriter/word-cycler, nothing at all for
 * split-text/split-text-motion), but they all take the same `PrepareContext` shape, so one fake
 * covers the lot through the real registered `prepare` function, the same call shape
 * `js-effect-preparer.ts` uses in production.
 */
function fakeCtx(el: Element, win: Window & typeof globalThis = window): PrepareContext {
  return { win, doc: win.document, style: createStyleLedger(el) } as unknown as PrepareContext
}

/** jsdom never lays anything out, so `getBoundingClientRect` is always all zeros without this. */
function stubRect(el: Element, box: { width: number; height: number }): void {
  Object.defineProperty(el, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ ...box, top: 0, left: 0, right: box.width, bottom: box.height }),
  })
}

const registry = catalogRegistry()

describe('segmentGraphemes', () => {
  it('treats a ZWJ emoji sequence as one grapheme, not five code points', () => {
    expect(segmentGraphemes('a👩‍👩‍👧‍👦b')).toEqual(['a', '👩‍👩‍👧‍👦', 'b'])
  })

  it('keeps a combining accent attached to its base letter', () => {
    // "café" spelled with a combining acute accent (U+0301) rather than the precomposed é.
    expect(segmentGraphemes('café')).toEqual(['c', 'a', 'f', 'é'])
  })
})

describe('installSplitLayers', () => {
  it('exposes exactly one accessible reading representation and restores plain text on cleanup', () => {
    const el = document.createElement('p')
    el.textContent = 'Hi there'
    const layers = installSplitLayers(el, document)

    expect(layers.decorative.getAttribute('aria-hidden')).toBe('true')
    const srOnly = el.querySelector('.kui-sr-only')!
    expect(srOnly.textContent).toBe('Hi there')
    // The decorative layer starts empty — a11y correctness only requires the sr-only twin to hold
    // the real text; callers are free to populate the decorative layer with anything afterwards.
    expect(el.textContent).toBe('Hi there') // sr-only text is still real DOM text content

    layers.restore()
    expect(el.textContent).toBe('Hi there')
    expect(el.querySelector('.kui-split-decorative')).toBeNull()
    expect(el.querySelector('.kui-sr-only')).toBeNull()
    expect(el.childNodes).toHaveLength(1)
  })
})

describe('appendCharSpans', () => {
  it('leaves whitespace graphemes as plain text nodes rather than zero-width spans', () => {
    const container = document.createElement('span')
    const spans = appendCharSpans(container, document, 'a b')
    expect(spans).toHaveLength(2) // 'a' and 'b' only — the space is not one of them
    expect(container.textContent).toBe('a b')
    expect(container.querySelectorAll('.kui-split-item')).toHaveLength(2)
  })

  it('groups each word\'s char-spans inside their own .kui-split-word wrapper', () => {
    // A bare run of adjacent inline-block spans gets a browser line-break opportunity between
    // any two of them, even with no whitespace — so 'ab' could wrap between 'a' and 'b'. Each
    // word's chars share one inline-block wrapper so the only break opportunity left is the
    // real space between words.
    const container = document.createElement('span')
    appendCharSpans(container, document, 'ab cd')
    expect(container.textContent).toBe('ab cd')

    const words = container.querySelectorAll('.kui-split-word')
    expect(words).toHaveLength(2)

    const firstWord = words[0]!
    const secondWord = words[1]!
    expect(firstWord.querySelectorAll('.kui-split-item')).toHaveLength(2)
    expect(secondWord.querySelectorAll('.kui-split-item')).toHaveLength(2)
    expect(firstWord).not.toBe(secondWord)

    const aSpan = firstWord.querySelector('.kui-split-item')!
    const bSpan = firstWord.querySelectorAll('.kui-split-item')[1]!
    expect(aSpan.parentElement).toBe(firstWord)
    expect(bSpan.parentElement).toBe(firstWord)

    const cSpan = secondWord.querySelector('.kui-split-item')!
    expect(cSpan.parentElement).toBe(secondWord)
    expect(cSpan.parentElement).not.toBe(firstWord)
  })
})

describe('appendWordSpans', () => {
  it('wraps words but leaves whitespace as plain text nodes', () => {
    const container = document.createElement('span')
    appendWordSpans(container, document, 'one  two')
    expect(container.textContent).toBe('one  two')
    expect(container.querySelectorAll('.kui-split-item')).toHaveLength(2)
  })
})

describe('appendSpansFor', () => {
  it('dispatches to appendWordSpans for the "words" unit', () => {
    const container = document.createElement('span')
    const spans = appendSpansFor('words', container, document, 'one two')
    expect(spans).toHaveLength(2)
    expect(container.querySelectorAll('.kui-split-item')).toHaveLength(2)
  })

  it('dispatches to appendLineSpans for the "lines" unit', () => {
    const container = document.createElement('span')
    const spans = appendSpansFor('lines', container, document, 'one two')
    expect(spans.length).toBeGreaterThan(0)
    expect(container.querySelectorAll('.kui-split-line').length).toBeGreaterThan(0)
  })

  it('dispatches to appendCharSpans for the "chars" unit', () => {
    const container = document.createElement('span')
    const spans = appendSpansFor('chars', container, document, 'ab')
    expect(spans).toHaveLength(2)
  })
})

describe('appendLineSpans', () => {
  it('wraps every word into some line container without losing content', () => {
    const container = document.createElement('span')
    appendLineSpans(container, document, 'one two three')
    expect(container.textContent).toBe('one two three')
    expect(container.querySelectorAll('.kui-split-line').length).toBeGreaterThan(0)
  })

  it('starts a bucket for leading whitespace that precedes the first word span', () => {
    // appendWordSpans emits the leading space as a plain text node, so bucketByLine's very first
    // child is not an HTMLElement — it must still open a bucket for it rather than dropping it.
    const container = document.createElement('span')
    appendLineSpans(container, document, ' one two')
    expect(container.textContent).toBe(' one two')
  })

  it('does not leave the intermediate word spans marked as their own split item', () => {
    // appendLineSpans builds word spans first (each marked .kui-split-item by appendWordSpans)
    // purely to measure offsetTop for bucketing, then moves them inside a .kui-split-line. Left
    // marked, a line and the words nested inside it both get the reveal keyframe: opacity
    // compounds (parent and child both animate 0->1 at once) and the words replay their own
    // per-word --kui-i stagger on top of the line's, instead of the line revealing as one unit.
    const container = document.createElement('span')
    appendLineSpans(container, document, 'one two three')
    const lines = container.querySelectorAll('.kui-split-line')
    for (const line of lines) {
      expect(line.querySelectorAll('.kui-split-item')).toHaveLength(0)
    }
  })
})

describe('split-chars / split-text', () => {
  it('splits by grapheme cluster and restores original text on destroy', () => {
    const resolved = registry.resolve('split-chars')!
    const el = document.createElement('p')
    el.textContent = 'a👩‍👩‍👧‍👦b'
    const instance = resolved.primitive.prepare!(
      el,
      createParams({ unit: 'chars', direction: 'fade', duration: '500ms', stagger: '30ms' }),
      fakeCtx(el),
    )

    // Deferred: nothing happens until activate().
    expect(el.textContent).toBe('a👩‍👩‍👧‍👦b')

    instance.activate()
    const items = el.querySelectorAll('.kui-split-item')
    expect(items).toHaveLength(3)
    expect(el.querySelector('.kui-sr-only')?.textContent).toBe('a👩‍👩‍👧‍👦b')

    instance.destroy()
    expect(el.textContent).toBe('a👩‍👩‍👧‍👦b')
    expect(el.querySelector('.kui-split-decorative')).toBeNull()
  })

  it('finish() clears the pending completion timer and resolves finished immediately', async () => {
    vi.useFakeTimers()
    const resolved = registry.resolve('split-chars')!
    const el = document.createElement('p')
    el.textContent = 'hello'
    const instance = resolved.primitive.prepare!(
      el,
      createParams({ unit: 'chars', direction: 'fade', duration: '2s', stagger: '30ms' }),
      fakeCtx(el),
    )

    instance.activate()
    instance.finish()
    await expect(instance.finished).resolves.toBeUndefined()

    // The timer that would have settled `finished` on its own is now dead — advancing well past
    // it must not throw or double-resolve.
    expect(() => vi.advanceTimersByTime(10_000)).not.toThrow()
    vi.useRealTimers()
  })
})

describe('typewriter', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('reveals text incrementally behind an aria-hidden layer and restores it on destroy', () => {
    const resolved = registry.resolve('typewriter')!
    const el = document.createElement('p')
    el.textContent = 'Hi'
    const instance = resolved.primitive.prepare!(
      el,
      createParams({ step: '50ms', loop: 'false' }),
      fakeCtx(el),
    )

    instance.activate()
    const decorative = el.querySelector('.kui-typewriter')!
    expect(decorative.getAttribute('aria-hidden')).toBe('true')
    expect(el.querySelector('.kui-sr-only')?.textContent).toBe('Hi')

    vi.advanceTimersByTime(50)
    expect(decorative.textContent).toBe('H')
    vi.advanceTimersByTime(50)
    expect(decorative.textContent).toBe('Hi')

    instance.destroy()
    expect(el.textContent).toBe('Hi')
  })

  it('honors delay: — typewriter has no authored duration to carry a positional delay, so the keyword spelling is the only one that reaches it', () => {
    const resolved = registry.resolve('typewriter')!
    const el = document.createElement('p')
    el.textContent = 'Hi'
    const instance = resolved.primitive.prepare!(
      el,
      createParams({ step: '50ms', loop: 'false', delay: '200ms' }),
      fakeCtx(el),
    )

    instance.activate()
    const decorative = el.querySelector('.kui-typewriter')!

    vi.advanceTimersByTime(200)
    expect(decorative.textContent).toBe('')

    vi.advanceTimersByTime(50)
    expect(decorative.textContent).toBe('H')

    instance.destroy()
  })
})

describe('scramble/decode/glitch', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  /**
   * A two-grapheme `scramble` resolving one grapheme per 10ms tick, so it is half-done at 10ms and
   * finished at 20ms, over the laid-out box jsdom will never compute on its own.
   *
   * @param authoredMinWidth - Inline `min-width` the author set, present before the effect runs.
   */
  function startScramble(authoredMinWidth?: string) {
    const el = document.createElement('p')
    el.textContent = 'ok'
    if (authoredMinWidth) el.style.minWidth = authoredMinWidth
    stubRect(el, { width: 42, height: 21 })
    const params = createParams({ step: '10ms', revealEvery: '1', charset: 'upper' })
    return { el, instance: registry.resolve('scramble')!.primitive.prepare!(el, params, fakeCtx(el)) }
  }

  it('renders nonsense behind an aria-hidden layer while a real twin holds the true text', () => {
    const { el, instance } = startScramble()

    instance.activate()
    expect(el.querySelector('.kui-scramble')?.getAttribute('aria-hidden')).toBe('true')
    expect(el.querySelector('.kui-sr-only')?.textContent).toBe('ok')

    vi.advanceTimersByTime(10)
    // First character resolved, second still scrambled from the fixed 'ok' charset text.
    expect(el.querySelector('.kui-scramble')!.textContent!.charAt(0)).toBe('o')

    vi.advanceTimersByTime(10)
    expect(el.querySelector('.kui-scramble')?.textContent).toBe('ok')

    instance.destroy()
    expect(el.textContent).toBe('ok')
  })

  it('reserves the resting-state box before the first scrambled frame paints, so a resolve cannot shrink its layout', () => {
    const { el, instance } = startScramble()

    instance.activate()
    expect(el.style.minWidth).toBe('42px')
    expect(el.style.minHeight).toBe('21px')
  })

  it('unpins the reserved box when the run is cancelled part-way, not only when it resolves', () => {
    const { el, instance } = startScramble()

    instance.activate()
    vi.advanceTimersByTime(10)
    expect(el.style.minWidth).toBe('42px')

    instance.cancel()
    expect(el.style.minWidth).toBe('')
    expect(el.style.minHeight).toBe('')
  })

  it('does not mistake a pin left by a previous run for an authored min-width when re-triggered', () => {
    const { el, instance } = startScramble()

    // An `on:hover`/`on:click` scramble restarts on the same instance. A pin surviving the cancel
    // would be read back as the author's own value and written straight out again by the second
    // run's release, so even this natural completion would leave the element pinned.
    instance.activate()
    vi.advanceTimersByTime(10)
    instance.cancel()
    instance.activate()
    vi.advanceTimersByTime(20)

    expect(el.querySelector('.kui-scramble')?.textContent).toBe('ok')
    expect(el.style.minWidth).toBe('')
    expect(el.style.minHeight).toBe('')
  })

  it('hands a cancelled element back its authored inline min-width rather than deleting it', () => {
    const { el, instance } = startScramble('10rem')

    instance.activate()
    vi.advanceTimersByTime(10)
    instance.cancel()
    expect(el.style.minWidth).toBe('10rem')
  })
})

describe('word-cycler', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('cycles through real words on an interval and restores the original text on destroy', () => {
    const resolved = registry.resolve('word-cycler')!
    const el = document.createElement('span')
    el.textContent = 'placeholder'
    const instance = resolved.primitive.prepare!(
      el,
      createParams({ words: 'alpha|beta', interval: '1000ms' }),
      fakeCtx(el),
    )

    instance.activate()
    expect(el.textContent).toBe('alpha')

    vi.advanceTimersByTime(1000 + 150)
    expect(el.textContent).toBe('beta')

    instance.destroy()
    expect(el.textContent).toBe('placeholder')
  })

  it('is a harmless no-op when no words were authored at all', () => {
    const resolved = registry.resolve('word-cycler')!
    const el = document.createElement('span')
    el.textContent = 'placeholder'
    const instance = resolved.primitive.prepare!(el, createParams({}), fakeCtx(el))

    expect(() => instance.activate()).not.toThrow()
    expect(el.textContent).toBe('placeholder')
    expect(() => instance.destroy()).not.toThrow()
    expect(el.textContent).toBe('placeholder')
  })

  it('finish() stops the cycle without throwing', () => {
    const resolved = registry.resolve('word-cycler')!
    const el = document.createElement('span')
    el.textContent = 'placeholder'
    const instance = resolved.primitive.prepare!(
      el,
      createParams({ words: 'alpha|beta', interval: '1000ms' }),
      fakeCtx(el),
    )
    instance.activate()
    expect(() => instance.finish()).not.toThrow()
    instance.destroy()
  })

  it('wraps a single-word list back to itself rather than getting stuck', () => {
    const resolved = registry.resolve('word-cycler')!
    const el = document.createElement('span')
    el.textContent = 'placeholder'
    const instance = resolved.primitive.prepare!(
      el,
      createParams({ words: 'alone', interval: '1000ms' }),
      fakeCtx(el),
    )

    instance.activate()
    expect(el.textContent).toBe('alone')

    vi.advanceTimersByTime(1000 + 150)
    expect(el.textContent).toBe('alone')
    expect(el.classList.contains('kui-word-cycler-swap')).toBe(false)

    instance.destroy()
  })
})

describe('nextTypeState', () => {
  it('advances forward and stops at the end when not looping', () => {
    const first = nextTypeState({ index: 0, deleting: false }, 2, false)
    expect(first).toEqual({ index: 1, deleting: false, done: false })
    const last = nextTypeState(first, 2, false)
    expect(last).toEqual({ index: 2, deleting: false, done: true })
  })

  it('reverses and retypes when looping', () => {
    const atEnd = nextTypeState({ index: 1, deleting: false }, 2, true)
    expect(atEnd).toEqual({ index: 2, deleting: true, done: false })
    const deleting = nextTypeState(atEnd, 2, true)
    expect(deleting).toEqual({ index: 1, deleting: true, done: false })
    const bottomed = nextTypeState(deleting, 2, true)
    expect(bottomed).toEqual({ index: 0, deleting: false, done: false })
  })
})

describe('scrambledFrame', () => {
  it('renders resolved graphemes verbatim and draws unresolved ones from the charset', () => {
    expect(scrambledFrame(['a', 'b', 'c'], 1, 'XYZ', () => 0)).toBe('aXX')
  })

  it('never scrambles whitespace, so word boundaries stay legible mid-resolve', () => {
    expect(scrambledFrame(['a', ' ', 'b'], 0, 'XYZ', () => 0)).toBe('X X')
  })

  it('falls back to the original grapheme when the charset is empty', () => {
    expect(scrambledFrame(['a', 'b'], 0, '', () => 0)).toBe('ab')
  })
})

describe('splitRevealFinishMs', () => {
  it('is zero for an empty split — nothing was ever going to animate', () => {
    expect(splitRevealFinishMs(createParams({}), 0)).toBe(0)
  })
})

/**
 * Teardown's contract is the *subtree*, not the text.
 *
 * Every restore test above authors plain text, which is the one input where "put the text back"
 * and "put the DOM back" are the same operation — so a restore that flattens markup passed all of
 * them. These author element children instead. The effects are not expected to *animate* nested
 * markup well; they are expected never to leave the document worse than they found it.
 */
describe('destroy() restores the authored subtree, not merely its text', () => {
  it('split-text puts back element children it never owned', () => {
    const resolved = registry.resolve('split-words')!
    const el = document.createElement('p')
    el.innerHTML = '<strong>one</strong> two three'
    const authored = el.innerHTML

    const instance = resolved.primitive.prepare!(
      el,
      createParams({ unit: 'words', direction: 'fade' }),
      fakeCtx(el),
    )
    instance.activate()
    expect(el.querySelector('.kui-split-decorative')).not.toBeNull()

    instance.destroy()
    expect(el.innerHTML).toBe(authored)
  })

  it('split-text preserves whitespace it trimmed for display', () => {
    const el = document.createElement('p')
    el.textContent = '  padded  '
    const layers = installSplitLayers(el, document)
    // The SR-only layer is trimmed on purpose — authored source indentation is not content.
    expect(layers.originalText).toBe('padded')

    layers.restore()
    expect(el.textContent).toBe('  padded  ')
  })

  it('word-cycler puts back element children it never owned', () => {
    vi.useFakeTimers()
    const resolved = registry.resolve('word-cycler')!
    const el = document.createElement('span')
    el.innerHTML = '<em>placeholder</em>'
    const authored = el.innerHTML

    const instance = resolved.primitive.prepare!(
      el,
      createParams({ words: 'alpha|beta', interval: '1000ms' }),
      fakeCtx(el),
    )
    instance.activate()
    expect(el.textContent).toBe('alpha')

    instance.destroy()
    expect(el.innerHTML).toBe(authored)
    vi.useRealTimers()
  })
})
