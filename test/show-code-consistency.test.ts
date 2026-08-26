// Consistency check on the demo pages' "Show code" contracts — nothing renders, nothing animates,
// no browser starts. It runs under the default jsdom environment rather than the `node` one the
// other static demo checks use, for two reasons: the static half parses each page with `DOMParser`,
// the same parser `demo/show-code.js` runs a page through before printing it, so the tree asserted
// on and the tree a reader sees come out of one parse rather than two hand-rolled approximations of
// one; and the behavioural half at the bottom actually executes that script. `process.cwd()`
// supplies the demo path for the same reason those other files reach for `fileURLToPath` — under
// jsdom `import.meta.url` is an http: URL and resolving against it lands nowhere.
import { readdirSync, readFileSync } from 'node:fs'
import process from 'node:process'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * Guard the `data-show-code-key` contract against tokens that highlight nothing.
 *
 * `demo/show-code.js` prints an element's authored markup into a modal and wraps the parts that
 * matter in `<mark class="kui-code-key">`: the `data-kui="..."` attribute, plus whatever class or
 * id tokens the element names in `data-show-code-key`. A token counts as a match only when it is
 * the *whole* value of an `id="..."`, or one whole space-delimited piece of a `class="..."` — never
 * a substring, because a `\b`-bounded search says yes to `track` inside both `id="reel-track"` and
 * `class="track-stage"`. That precision is what makes the attribute easy to get silently wrong: a
 * token matching nothing produces no mark, no warning, and nothing to tell it apart from a page
 * that never declared a contract at all.
 *
 * Both failure directions have shipped here. `scroll-spy`'s key listed `data-kui-active` — an
 * attribute the effect writes at *runtime*, never present in the authored source the modal prints,
 * so it could not ever have highlighted anything. In the other direction `sequence-scrub`'s
 * `target:'.scrub-viewport img'` named a class the reader had to find by eye, because that element
 * declared no key at all. Nothing caught either; both were found by opening the modal and looking.
 */

const DEMO_DIR = `${process.cwd()}/demo`

/**
 * Classes `prettyPrint` refuses to descend into, plus the attribute marking a hand-authored opener.
 * Mirrored from `demo/show-code.js`: all three are that tool's own wiring, so a class token inside
 * one of them is not part of the demo and must not be able to satisfy a contract.
 */
const SKIPPED_CLASSES = ['kui-show-code-toggle', 'kui-contract']

/** Params whose value is a CSS selector. Every other `text` param the library defines is a URL, an
 * attribute name, a length or path data — none of them name markup on the page. */
const SELECTOR_PARAMS = ['target', 'sections', 'follow']

const SELECTOR_PARAM_RE = new RegExp(
  `\\b(${SELECTOR_PARAMS.join('|')})\\s*:\\s*(?:'([^']*)'|"([^"]*)"|(\\S+))`,
  'g',
)

interface Root {
  el: Element
  /** How the modal reaches this element, so a failure names the button to press. */
  via: string
}

interface Page {
  doc: Document
  roots: Root[]
  /** `data-show-code-target` values naming an id that is not on the page. */
  dangling: string[]
}

/** The elements `prettyPrint` would emit for `root`, in document order, `root` included. */
function printedElements(root: Element): Element[] {
  const out = [root]
  for (const child of root.children) {
    if (SKIPPED_CLASSES.some((name) => child.classList.contains(name))) continue
    if (child.hasAttribute('data-show-code-target')) continue
    out.push(...printedElements(child))
  }
  return out
}

/** Every whole class token and whole id value across `elements` — the only things a key token can
 * legitimately match. Read with `getAttribute`, not `.className`, which on the `<svg>` and `<path>`
 * nodes these pages are full of is an `SVGAnimatedString` with no `.split`. */
function markupTokens(elements: Element[]): Set<string> {
  const tokens = new Set<string>()
  for (const el of elements) {
    for (const token of (el.getAttribute('class') ?? '').split(/\s+/)) {
      if (token) tokens.add(token)
    }
    const id = el.getAttribute('id')
    if (id) tokens.add(id)
  }
  return tokens
}

function keyTokens(el: Element): string[] {
  return (el.getAttribute('data-show-code-key') ?? '').trim().split(/\s+/).filter(Boolean)
}

/** Class and id names inside a CSS selector. Combinators, commas, tag names and pseudo-classes all
 * fall away: `target:'.story-lines > li, .story-dots > span'` contributes `story-lines` and
 * `story-dots` and says nothing about `li` or `span`, which are not names anyone can rename. */
function selectorTokens(selector: string): string[] {
  return [...selector.matchAll(/[.#]([A-Za-z_][-\w]*)/g)].map((match) => match[1]!)
}

/** Every `param: selector` pair in the `data-kui` attributes of a printed subtree. */
function selectorParams(elements: Element[]): Array<{ param: string; selector: string }> {
  const found: Array<{ param: string; selector: string }> = []
  for (const el of elements) {
    const value = el.getAttribute('data-kui')
    if (!value) continue
    for (const match of value.matchAll(SELECTOR_PARAM_RE)) {
      found.push({ param: match[1]!, selector: match[2] ?? match[3] ?? match[4]! })
    }
  }
  return found
}

/**
 * Every element the modal can be opened on: an auto-mounted `[data-show-code]` card, or the
 * container a hand-authored `[data-show-code-target]` button names by id.
 *
 * Markup inside an HTML comment parses to a comment node, not an element, so a commented-out demo
 * (there is one in `index.html`) drops out here with no stripping pass — which is right, because
 * `show-code.js` parses the same bytes with the same parser and cannot see it either.
 */
function readPage(html: string): Page {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const roots: Root[] = [...doc.querySelectorAll('[data-show-code]')].map((el) => ({
    el,
    via: 'data-show-code',
  }))
  const dangling: string[] = []
  for (const button of doc.querySelectorAll('[data-show-code-target]')) {
    const id = button.getAttribute('data-show-code-target')!
    const target = doc.getElementById(id)
    if (target) roots.push({ el: target, via: `data-show-code-target="${id}"` })
    else dangling.push(id)
  }
  return { doc, roots, dangling }
}

function describeEl(el: Element): string {
  const id = el.getAttribute('id')
  const cls = el.getAttribute('class')
  const classes = cls ? '.' + cls.trim().split(/\s+/).join('.') : ''
  return `<${el.tagName.toLowerCase()}${id ? '#' + id : ''}${classes}>`
}

/** Selector tokens a card's own effects resolve inside its own printed markup without the key
 * naming them. Split out of the `it()` body so the three nested loops stay inside `max-depth`. */
function unmarkedSelectorTokens(page: string, root: Root): string[] {
  const elements = printedElements(root.el)
  const present = markupTokens(elements)
  const declared = keyTokens(root.el)
  const found: string[] = []
  for (const { param, selector } of selectorParams(elements)) {
    const missing = selectorTokens(selector).filter(
      (token) => present.has(token) && !declared.includes(token),
    )
    for (const token of missing) {
      found.push(
        `${page} ${describeEl(root.el)} (${root.via}): ${param}:${selector} resolves ` +
          `"${token}" inside this card's own markup, but data-show-code-key does not list it ` +
          `(key="${declared.join(' ')}")`,
      )
    }
  }
  return found
}

const PAGES = readdirSync(DEMO_DIR).filter((file) => file.endsWith('.html'))
const PARSED = new Map(
  PAGES.map((page) => [page, readPage(readFileSync(`${DEMO_DIR}/${page}`, 'utf8'))]),
)

describe('demo show-code contracts', () => {
  it('finds pages and contracts, so the checks below cannot pass vacuously', () => {
    // Backstop against the glob matching nothing, or against every page losing its show-code
    // wiring at once — either would turn the checks below into assertions about an empty list.
    expect(PAGES.length).toBeGreaterThanOrEqual(5)
    const roots = [...PARSED.values()].flatMap((page) => page.roots)
    expect(roots.length).toBeGreaterThan(20)
    expect(roots.filter((root) => keyTokens(root.el).length > 0).length).toBeGreaterThan(0)
  })

  it.each(PAGES)('%s opens the modal on an element that exists', (page) => {
    const found = PARSED.get(page)!.dangling.map(
      (id) => `${page}: data-show-code-target="${id}" — no element on the page has that id`,
    )
    expect(found).toEqual([])
  })

  it.each(PAGES)('%s declares no dead data-show-code-key token', (page) => {
    const found: string[] = []
    for (const root of PARSED.get(page)!.roots) {
      const present = markupTokens(printedElements(root.el))
      const dead = keyTokens(root.el).filter((token) => !present.has(token))
      for (const token of dead) {
        found.push(
          `${page} ${describeEl(root.el)} (${root.via}): data-show-code-key names "${token}", ` +
            'which is not a whole class token or id anywhere in the markup this card prints, so ' +
            'it highlights nothing',
        )
      }
    }
    expect(found).toEqual([])
  })

  it.each(PAGES)('%s puts data-show-code-key only where it is read', (page) => {
    const { doc, roots } = PARSED.get(page)!
    const found: string[] = []
    for (const el of doc.querySelectorAll('[data-show-code-key]')) {
      if (roots.some((root) => root.el === el)) continue
      found.push(
        `${page} ${describeEl(el)}: carries data-show-code-key, but the modal never opens on it — ` +
          'the attribute is read only off a [data-show-code] card or the container a ' +
          '[data-show-code-target] button names, so this one does nothing',
      )
    }
    expect(found).toEqual([])
  })

  /**
   * The other direction: a selector the effect resolves against markup the reader is looking at,
   * whose class or id is left unmarked.
   *
   * Scoped to tokens present *in the printed subtree*, which is what stops it firing on a selector
   * that legitimately reaches elsewhere on the page. Tag-only selectors (`target:figure`)
   * contribute no tokens and are silently fine: there is no rename hazard in a tag name, and
   * marking one would light up every `<figure>` in the block instead of explaining anything.
   */
  it.each(PAGES)('%s marks the tokens its own selectors resolve', (page) => {
    const found = PARSED.get(page)!.roots.flatMap((root) => unmarkedSelectorTokens(page, root))
    expect(found).toEqual([])
  })

  /**
   * A card that prints no `data-kui` and declares no contract opens a modal with nothing marked and
   * an empty "try it" box. Ten shipped on `scroll.html` at once — a `data-show-code` on every
   * `<figure>` of a `horizontal-scroll` track whose effect lived on the container above them.
   */
  it.each(PAGES)('%s opens no card with nothing to highlight', (page) => {
    const found: string[] = []
    for (const root of PARSED.get(page)!.roots) {
      if (keyTokens(root.el).length > 0) continue
      if (printedElements(root.el).some((el) => el.hasAttribute('data-kui'))) continue
      found.push(
        `${page} ${describeEl(root.el)} (${root.via}): prints no data-kui and declares no ` +
          'data-show-code-key, so the modal opens with nothing highlighted and an empty value box',
      )
    }
    expect(found).toEqual([])
  })
})

/**
 * The checks above audit the *data* — that every declared token names something real. They cannot
 * see a bug in the *matcher*, and the matcher is where this went wrong: it used to mark the entire
 * opening tag, then a `\b`-bounded substring search that lit up `track` inside `id="reel-track"`
 * and `class="track-stage"`. Both bugs pass every static check on this page, because the markup was
 * always correct.
 *
 * So this half runs the real `demo/show-code.js` against a fixture built to contain each trap at
 * once, and asserts on the marks it actually produces. No animation is involved, so jsdom is the
 * whole environment this needs.
 */
const FIXTURE_BODY = `
<div class="track-stage" id="reel-track" data-kui="horizontal-scroll distance:300vh target:.track" data-show-code-key="track">
  <p class="kui-contract"><code>data-kui="horizontal-scroll distance:300vh target:.track"</code></p>
  <div class="track">
    <figure class="demo-card"><img src="a.jpg" /><figcaption>data-kui="fade-up" — a caption</figcaption></figure>
  </div>
  <button type="button" class="hero-flip-code" data-show-code-target="reel-track">Show code</button>
</div>
<div class="panel" data-show-code data-show-code-key="panel-body">
  <div id="panel-body" data-kui="fade-up 400ms">Body</div>
</div>
`

/** Text of every `<mark>` currently in the modal, in order. */
function marksAfterClicking(selector: string): string[] {
  document.querySelector<HTMLElement>(selector)!.click()
  const code = document.querySelector('.kui-code-modal pre code')!
  return [...code.querySelectorAll('mark.kui-code-key')].map((mark) => mark.textContent!)
}

function printedText(): string {
  return document.querySelector('.kui-code-modal pre code')!.textContent!
}

describe('show-code highlighting', () => {
  beforeAll(async () => {
    // jsdom reports `readyState: 'loading'` for the first tick after a document is built, and the
    // script branches on it: caught during that tick it registers a `DOMContentLoaded` listener
    // instead of initialising, and the event has already fired by the time anything clicks. One
    // tick puts the document past it either way.
    await new Promise((resolve) => setTimeout(resolve, 0))
    document.body.innerHTML = FIXTURE_BODY
    // The script re-fetches the page's own HTML so it prints authored markup rather than whatever
    // the animator has since written onto the live DOM. Nothing is being served here, so hand it
    // the fixture directly — the same bytes the live DOM was built from, which is the invariant the
    // real fetch relies on too.
    const page = `<!doctype html><html><body>${FIXTURE_BODY}</body></html>`
    globalThis.fetch = (() =>
      Promise.resolve({ ok: true, text: () => Promise.resolve(page) })) as unknown as typeof fetch
    // `demo/show-code.js` is a classic script with no exports — an IIFE that wires itself to the
    // document it finds. Evaluating the real file is the point: a re-implementation here would
    // assert that the copy in this test matches itself.
    // eslint-disable-next-line sonarjs/code-eval -- see above; the input is a file in this repo, not user data
    new Function(readFileSync(`${DEMO_DIR}/show-code.js`, 'utf8'))()
    // `init()` awaits that fetch and its `.text()`, so the toggles exist a macrotask later.
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

  it('marks the data-kui attribute and whole class tokens, and nothing else', () => {
    expect(marksAfterClicking('[data-show-code-target="reel-track"]')).toEqual([
      'data-kui="horizontal-scroll distance:300vh target:.track"',
      'track',
    ])
  })

  it('leaves near-miss substrings of a key token alone', () => {
    // `track-stage` and `reel-track` both contain `track` between non-word characters, so a
    // `\b`-bounded search marks both. Neither is the token; the token is never `track-stage`.
    const marks = marksAfterClicking('[data-show-code-target="reel-track"]')
    expect(printedText()).toContain('class="track-stage" id="reel-track"')
    expect(marks.filter((mark) => mark.includes('track'))).toEqual([
      'data-kui="horizontal-scroll distance:300vh target:.track"',
      'track',
    ])
  })

  it('leaves a caption that merely says data-kui= alone', () => {
    const marks = marksAfterClicking('[data-show-code-target="reel-track"]')
    expect(printedText()).toContain('data-kui="fade-up" — a caption')
    expect(marks.some((mark) => mark.includes('fade-up'))).toBe(false)
  })

  it('prints the demo markup without any of this tool’s own wiring', () => {
    marksAfterClicking('[data-show-code-target="reel-track"]')
    const text = printedText()
    expect(text).not.toContain('kui-contract')
    expect(text).not.toContain('kui-show-code-toggle')
    // The opener itself, which on the hero cards sits *inside* the container it names.
    expect(text).not.toContain('hero-flip-code')
  })

  it('marks a key token that is a whole id value', () => {
    expect(marksAfterClicking('.panel .kui-show-code-toggle')).toEqual([
      'panel-body',
      'data-kui="fade-up 400ms"',
    ])
  })
})
