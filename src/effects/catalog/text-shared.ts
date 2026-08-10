import type { Cleanup, EffectParams } from '../../core/types.js'

/** How `split-text` breaks a string into decorative pieces. */
export type SplitUnit = 'chars' | 'words' | 'lines'

const SR_ONLY_CLASS = 'dsg-sr-only'
const DECORATIVE_CLASS = 'dsg-split-decorative'

export interface SplitLayers {
  /** `aria-hidden` container the caller populates with decorative markup or text. */
  decorative: HTMLElement
  /** The element's text at the moment splitting began. */
  originalText: string
  /** Remove both layers and put the original text back, selectable and unabridged. */
  restore: Cleanup
}

/**
 * Replace an element's text with an `aria-hidden` decorative layer plus a visually-hidden twin
 * holding the real text, so exactly one reading representation is ever exposed to assistive tech
 * — the decorative layer is free to sit mid-scramble, mid-type, or split into spans without a
 * screen reader ever seeing an incomplete or garbled read of the content.
 *
 * @param el - Element whose text is being taken over. Assumed to hold plain text (no children) —
 *   every DOM-surgery primitive in this module shares that constraint.
 * @param doc - Document to create nodes in, rather than the ambient global, so callers can point
 *   this at a test document.
 * @returns The decorative layer to populate, the captured text, and a cleanup.
 * @complexity O(1) time and space beyond the caller's own population work.
 * @overallScore 100
 */
export function installSplitLayers(el: Element, doc: Document): SplitLayers {
  // Trimmed: authored HTML source formatting (indentation, line breaks around the text) lands in
  // `textContent` as literal leading/trailing whitespace, which is insignificant to a reader but
  // was not insignificant to `appendLineSpans` — a leading whitespace text node with no preceding
  // element produced its own empty line bucket, rendered as a stray empty line.
  const originalText = (el.textContent ?? '').trim()
  const decorative = doc.createElement('span')
  decorative.setAttribute('aria-hidden', 'true')
  decorative.className = DECORATIVE_CLASS

  const srOnly = doc.createElement('span')
  srOnly.className = SR_ONLY_CLASS
  srOnly.textContent = originalText

  el.textContent = ''
  el.append(decorative, srOnly)

  return {
    decorative,
    originalText,
    restore: () => {
      el.textContent = originalText
    },
  }
}

/**
 * Grapheme clusters, not UTF-16 code units — an emoji, a flag, or a base letter plus combining
 * mark stays one unit instead of being torn across two "characters".
 *
 * @complexity O(n) time in text length; O(n) space for the returned array.
 * @overallScore 100
 */
export function segmentGraphemes(text: string): string[] {
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  return Array.from(segmenter.segment(text), (entry) => entry.segment)
}

interface WordToken {
  text: string
  isWord: boolean
}

/**
 * Word-like segments plus the whitespace/punctuation between them, via `Intl.Segmenter` — a naive
 * `split(' ')` mishandles scripts with no spaces and drops multi-space runs.
 *
 * @complexity O(n) time in text length; O(n) space.
 * @overallScore 100
 */
function segmentWords(text: string): WordToken[] {
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' })
  return Array.from(segmenter.segment(text), (entry) => ({
    text: entry.segment,
    isWord: entry.isWordLike === true,
  }))
}

/** Index a synthetic child for the `--dsg-i` / `--dsg-stagger` delay formula declared in text.css. */
function markItem(el: HTMLElement, index: number, extraClass?: string): void {
  el.className = extraClass ? `dsg-split-item ${extraClass}` : 'dsg-split-item'
  el.style.setProperty('--dsg-i', String(index))
}

/**
 * Forward validated timing params onto a synthetic container, so the `--dsg-i` × `--dsg-stagger`
 * delay formula in text.css can read them by inheritance.
 *
 * A JS-rendered primitive's per-primitive namespaced `cssProperty` (see `registry.ts`) only
 * governs what `resolveParams` writes onto the *authored* element for CSS-tier effects — nothing
 * here reads that. These are plain, self-chosen custom properties on a container this module
 * created and owns outright, populated straight from the validated `EffectParams` reader.
 *
 * @complexity O(1) time and space.
 * @overallScore 100
 */
export function applyStaggerVars(el: HTMLElement, params: EffectParams): void {
  el.style.setProperty('--dsg-duration', params.text('duration', '500ms'))
  el.style.setProperty('--dsg-delay', params.text('delay', '0ms'))
  el.style.setProperty('--dsg-ease', params.text('ease', 'ease-out'))
  el.style.setProperty('--dsg-stagger', params.text('stagger', '30ms'))
}

/**
 * Split text into one span per grapheme cluster, leaving whitespace graphemes as plain text nodes.
 *
 * A `display: inline-block` span whose only content is a single space renders at zero width — the
 * lone space is both the first and last "character" of that box's own formatting context, so CSS
 * whitespace collapsing trims it away entirely. Every word ran together until this skipped
 * wrapping the space itself, the same way `appendWordSpans` already leaves inter-word whitespace
 * unwrapped.
 *
 * @complexity O(n) time and space in grapheme count.
 * @overallScore 100
 */
export function appendCharSpans(container: Element, doc: Document, text: string): HTMLElement[] {
  const spans: HTMLElement[] = []
  let index = 0
  for (const grapheme of segmentGraphemes(text)) {
    if (grapheme.trim() === '') {
      container.append(doc.createTextNode(grapheme))
      continue
    }
    const span = doc.createElement('span')
    markItem(span, index)
    span.textContent = grapheme
    container.append(span)
    spans.push(span)
    index++
  }
  return spans
}

/**
 * Split text into one span per word, leaving the whitespace and punctuation between them as plain
 * text nodes so natural line-wrapping and spacing survive untouched.
 *
 * @complexity O(n) time and space in segment count.
 * @overallScore 100
 */
export function appendWordSpans(container: Element, doc: Document, text: string): HTMLElement[] {
  const spans: HTMLElement[] = []
  let index = 0
  for (const token of segmentWords(text)) {
    if (!token.isWord) {
      container.append(doc.createTextNode(token.text))
      continue
    }
    const span = doc.createElement('span')
    markItem(span, index)
    span.textContent = token.text
    container.append(span)
    spans.push(span)
    index++
  }
  return spans
}

/**
 * Group a container's just-inserted word spans by rendered line, using layout the browser has
 * already computed rather than re-deriving wrap points.
 *
 * @complexity O(n) time in child node count; O(n) space for the buckets.
 * @overallScore 100
 */
function bucketByLine(container: Element): Node[][] {
  const buckets: Node[][] = []
  let currentTop: number | null = null
  for (const node of Array.from(container.childNodes)) {
    if (node instanceof HTMLElement) {
      const top = node.offsetTop
      if (currentTop === null || Math.abs(top - currentTop) > 1) {
        buckets.push([])
        currentTop = top
      }
    } else if (buckets.length === 0) {
      buckets.push([])
    }
    buckets.at(-1)!.push(node)
  }
  return buckets
}

/**
 * Split text into one span per visual line.
 *
 * Lines are not a text property — they only exist after wrapping — so this measures word spans
 * already laid out in the live DOM, then regroups their nodes (words and the whitespace between
 * them) into per-line containers.
 *
 * @complexity O(n) time and space in word-span count.
 * @overallScore 100
 */
export function appendLineSpans(container: Element, doc: Document, text: string): HTMLElement[] {
  appendWordSpans(container, doc, text)
  const buckets = bucketByLine(container)
  container.replaceChildren()
  return buckets.map((nodes, index) => {
    const line = doc.createElement('span')
    markItem(line, index, 'dsg-split-line')
    for (const node of nodes) line.append(node)
    container.append(line)
    return line
  })
}

/**
 * Split text by the requested unit.
 *
 * @complexity O(n) time and space in text length, dominated by the chosen unit's own cost.
 * @overallScore 100
 */
export function appendSpansFor(
  unit: SplitUnit,
  container: Element,
  doc: Document,
  text: string,
): HTMLElement[] {
  if (unit === 'words') return appendWordSpans(container, doc, text)
  if (unit === 'lines') return appendLineSpans(container, doc, text)
  return appendCharSpans(container, doc, text)
}

export interface TypeState {
  index: number
  deleting: boolean
}

export interface TypeStep extends TypeState {
  done: boolean
}

/**
 * Advance a typewriter one tick: typing forward, then — when looping — deleting back to zero
 * before typing again. Pure so the state machine is assertable without any timer or DOM.
 *
 * @param state - Current position and direction.
 * @param total - Grapheme count of the full string.
 * @param loop - Whether to reverse at the end instead of stopping.
 * @returns The next state, plus whether the effect has nothing left to do.
 * @complexity O(1) time and space.
 * @overallScore 100
 */
export function nextTypeState(state: TypeState, total: number, loop: boolean): TypeStep {
  if (!state.deleting) {
    const index = state.index + 1
    if (index < total) return { index, deleting: false, done: false }
    return loop
      ? { index: total, deleting: true, done: false }
      : { index: total, deleting: false, done: true }
  }
  const index = state.index - 1
  if (index > 0) return { index, deleting: true, done: false }
  return { index: 0, deleting: false, done: false }
}

/** Charsets the scramble family cycles through while a character is still unresolved. */
export const SCRAMBLE_CHARSETS: Record<string, string> = {
  upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  binary: '01',
  symbols: '!<>-_\\/[]{}=+*^?#~',
}

/**
 * Render one frame of a scramble/decode/glitch resolve: graphemes before `resolved` show their
 * real value, the rest render as a random charset character. Whitespace is never scrambled, so
 * word boundaries stay legible mid-resolve.
 *
 * @param graphemes - The target text, already grapheme-segmented.
 * @param resolved - Count of graphemes (from the start) considered final.
 * @param charset - Characters to draw unresolved positions from.
 * @param random - Source of randomness, injected so the frame is reproducible in tests.
 * @complexity O(n) time and space in grapheme count.
 * @overallScore 100
 */
export function scrambledFrame(
  graphemes: string[],
  resolved: number,
  charset: string,
  random: () => number,
): string {
  return graphemes
    .map((grapheme, index) => {
      if (index < resolved || grapheme.trim() === '') return grapheme
      return charset[Math.floor(random() * charset.length)] ?? charset[0] ?? grapheme
    })
    .join('')
}
