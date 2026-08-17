import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRegistry } from '../src/effects/index.js'
import { createParams } from '../src/core/js-params.js'
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

/**
 * None of the JS-tier text primitives read anything off `ctx` beyond `win` — timers for
 * typewriter/scramble/word-cycler, nothing at all for split-text/split-text-motion — so a partial
 * fake covering just that is enough to exercise them through the real registered `prepare`
 * function, the same call shape `js-effect-preparer.ts` uses in production.
 */
function fakeCtx(win: Window & typeof globalThis = window): PrepareContext {
  return { win, doc: win.document } as unknown as PrepareContext
}

const registry = createRegistry()

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
})

describe('split-chars / split-text', () => {
  it('splits by grapheme cluster and restores original text on destroy', () => {
    const resolved = registry.resolve('split-chars')!
    const el = document.createElement('p')
    el.textContent = 'a👩‍👩‍👧‍👦b'
    const instance = resolved.primitive.prepare!(
      el,
      createParams({ unit: 'chars', direction: 'fade', duration: '500ms', stagger: '30ms' }),
      fakeCtx(),
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
      fakeCtx(),
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
      fakeCtx(),
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
})

describe('scramble/decode/glitch', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('renders nonsense behind an aria-hidden layer while a real twin holds the true text', () => {
    const resolved = registry.resolve('scramble')!
    const el = document.createElement('p')
    el.textContent = 'ok'
    const instance = resolved.primitive.prepare!(
      el,
      createParams({ step: '10ms', revealEvery: '1', charset: 'upper' }),
      fakeCtx(),
    )

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
      fakeCtx(),
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
    const instance = resolved.primitive.prepare!(el, createParams({}), fakeCtx())

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
      fakeCtx(),
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
      fakeCtx(),
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
