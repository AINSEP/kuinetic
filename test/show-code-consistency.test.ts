// @vitest-environment jsdom
// Consistency check on the demo pages' "Show code" highlighting — nothing renders, nothing animates,
// no browser starts. It opts into jsdom rather than taking the default `node` the other static
// demo checks run under, because both halves execute the real `demo/show-code.js` and parse each
// page with `DOMParser`, the same parser that script runs a page through before printing it, so the
// tree asserted on and the tree a reader sees come out of one parse rather than two hand-rolled
// approximations of one. `process.cwd()` supplies the demo path for the same reason those other
// files reach for `fileURLToPath` — under jsdom `import.meta.url` is an http: URL and resolving
// against it lands nowhere.
import { readdirSync, readFileSync } from 'node:fs'
import process from 'node:process'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * Guard the rule the "Show code" popover highlights by: a class or id is marked **exactly** when
 * some `data-kui` in the printed markup names it in a selector-valued parameter, and nothing else
 * is.
 *
 * A highlight answers the reader's question "what argument in data-kui does this go to?". It used
 * to be answered by a hand-written `data-show-code-key` per demo, and that drifted in both
 * directions at once on `showcase.html`: the inside-ring band marked `ring-row` and `ring-slot`
 * although its `data-kui` named neither, and the swipe-y deck marked nothing although the carousel
 * nested inside it names `.vdeck-slide`, `.deck-dot`, `.vdeck-down` and `.vdeck-up`. Earlier still,
 * `scroll-spy`'s key named `data-kui-active` — a runtime attribute that is never in the printed
 * source. `demo/show-code.js` now derives the marks from the `data-kui` text itself, and this file
 * checks the derivation against an independent oracle on every demo on every page.
 */

const DEMO_DIR = `${process.cwd()}/demo`
const SRC_DIR = `${process.cwd()}/src`
const SHOW_CODE = readFileSync(`${DEMO_DIR}/show-code.js`, 'utf8')

/**
 * Classes `prettyPrint` refuses to descend into, plus the attribute marking a hand-authored opener.
 * Mirrored from `demo/show-code.js`'s `isChrome`: all three are that tool's own wiring, so a class
 * token inside one of them is not part of the demo and can never be marked.
 */
const SKIPPED_CLASSES = ['kui-show-code-toggle', 'kui-contract']

/**
 * The oracle's own list of selector-valued parameters. Deliberately restated rather than read out
 * of `show-code.js` — reading it would make the sweep below compare that script with itself. The
 * test after the sweep ties both lists to what the library actually resolves.
 */
const SELECTOR_PARAMS = ['target', 'sections', 'next', 'prev', 'jump', 'pause', 'mute', 'follow']

const SELECTOR_PARAM_RE = new RegExp(
  `(?:^|[\\s,])(${SELECTOR_PARAMS.join('|')})\\s*:\\s*(?:'([^']*)'|"([^"]*)"|([^\\s,]+))`,
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

interface Names {
  classes: Set<string>
  ids: Set<string>
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

/** `selector` with every `[…]` attribute selector blanked out, so the `.mp4` in `[href$=".mp4"]`
 * is never read as a class. A scan rather than a regex: nothing nests inside `[…]` here. */
function withoutAttributeSelectors(selector: string): string {
  let out = ''
  let inside = false
  for (const char of selector) {
    if (char === '[') inside = true
    out += inside ? ' ' : char
    if (char === ']') inside = false
  }
  return out
}

/** Class and id names inside a CSS selector. Combinators, commas, tag names, pseudo-classes and
 * attribute selectors all fall away: `target:'.story-lines > li, .story-dots > span'` contributes
 * `story-lines` and `story-dots` and says nothing about `li` or `span`, which no one can rename. */
function addSelectorNames(selector: string, names: Names): void {
  for (const match of withoutAttributeSelectors(selector).matchAll(/([.#])(-?[A-Za-z_][-\w]*)/g)) {
    ;(match[1] === '.' ? names.classes : names.ids).add(match[2]!)
  }
}

/** Every `param: selector` pair in the `data-kui` attributes of a printed subtree. */
function selectorParams(elements: Element[]): string[] {
  const found: string[] = []
  for (const el of elements) {
    const value = el.getAttribute('data-kui')
    if (!value) continue
    for (const match of value.matchAll(SELECTOR_PARAM_RE)) found.push(match[2] ?? match[3] ?? match[4]!)
  }
  return found
}

function referencedNames(elements: Element[]): Names {
  const names: Names = { classes: new Set(), ids: new Set() }
  for (const selector of selectorParams(elements)) addSelectorNames(selector, names)
  return names
}

/**
 * The marks the popover must show for `root`, as a sorted multiset: one per `data-kui` attribute,
 * one per whole class token whose class some selector names, one per id some selector names.
 */
function expectedMarks(root: Element): string[] {
  const elements = printedElements(root)
  const names = referencedNames(elements)
  return elements.flatMap((el) => marksOn(el, names)).sort(byText)
}

/** The marks one printed element's opening tag must carry. */
function marksOn(el: Element, names: Names): string[] {
  const marks = el.hasAttribute('data-kui') ? ['data-kui'] : []
  const classes = (el.getAttribute('class') ?? '').split(/\s+/)
  marks.push(...classes.filter((token) => token && names.classes.has(token)))
  const id = el.getAttribute('id')
  if (id && names.ids.has(id)) marks.push(id)
  return marks
}

function byText(a: string, b: string): number {
  return a.localeCompare(b)
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

// Pages this suite must not touch: `three-d.html` is owned elsewhere, and `index.html.bak` is not
// an `.html` file so the glob already skips it.
const EXCLUDED = new Set(['three-d.html'])
const PAGES = readdirSync(DEMO_DIR).filter((file) => file.endsWith('.html') && !EXCLUDED.has(file))
const PARSED = new Map(
  PAGES.map((page) => [page, readPage(readFileSync(`${DEMO_DIR}/${page}`, 'utf8'))]),
)

/** Let `show-code.js`'s async `init()` — a fetch, then `.text()` — run to completion. */
function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

/**
 * Load `bodyHtml` as the document, run the real `demo/show-code.js` against it, and hand the script
 * the same bytes as its "pristine" fetch — the invariant the real fetch relies on too.
 */
async function mountShowCode(bodyHtml: string): Promise<void> {
  document.body.innerHTML = bodyHtml
  const page = `<!doctype html><html><body>${bodyHtml}</body></html>`
  globalThis.fetch = (() =>
    Promise.resolve({ ok: true, text: () => Promise.resolve(page) })) as unknown as typeof fetch
  // `demo/show-code.js` is a classic script with no exports — an IIFE that wires itself to the
  // document it finds. Evaluating the real file is the point: a re-implementation here would
  // assert that the copy in this test matches itself.
  // eslint-disable-next-line sonarjs/code-eval -- see above; the input is a file in this repo, not user data
  new Function(SHOW_CODE)()
  await tick()
}

/** Text of every `<mark>` currently in the modal, in order. */
function currentMarks(): string[] {
  const code = document.querySelector('.kui-code-modal pre code')!
  return [...code.querySelectorAll('mark.kui-code-key')].map((mark) => mark.textContent!)
}

function marksAfterClicking(selector: string): string[] {
  document.querySelector<HTMLElement>(selector)!.click()
  return currentMarks()
}

function printedText(): string {
  return document.querySelector('.kui-code-modal pre code')!.textContent!
}

/**
 * Open the real popover on one demo, in isolation: the root alone becomes the document, carrying
 * `data-show-code` so exactly one toggle mounts for it (no `data-show-code*` attribute is ever
 * printed, so adding one changes nothing the reader sees), with any nested `data-show-code` removed
 * so it cannot mount a second.
 */
async function actualMarks(root: Element): Promise<string[]> {
  const clone = root.cloneNode(true) as Element
  for (const nested of clone.querySelectorAll('[data-show-code]')) nested.removeAttribute('data-show-code')
  clone.setAttribute('data-show-code', '')
  await mountShowCode(clone.outerHTML)
  const marks = marksAfterClicking('.kui-show-code-toggle:not([data-show-code-target])')
  return marks.map((mark) => (mark.startsWith('data-kui=') ? 'data-kui' : mark)).sort(byText)
}

describe('demo show-code contracts', () => {
  it('finds pages and demos, so the checks below cannot pass vacuously', () => {
    // Backstop against the glob matching nothing, or against every page losing its show-code
    // wiring at once — either would turn the checks below into assertions about an empty list.
    expect(PAGES.length).toBeGreaterThanOrEqual(5)
    const roots = [...PARSED.values()].flatMap((page) => page.roots)
    expect(roots.length).toBeGreaterThan(20)
    const withNames = roots.filter((root) => {
      const names = referencedNames(printedElements(root.el))
      return names.classes.size + names.ids.size > 0
    })
    expect(withNames.length).toBeGreaterThan(5)
  })

  it.each(PAGES)('%s opens the modal on an element that exists', (page) => {
    const found = PARSED.get(page)!.dangling.map(
      (id) => `${page}: data-show-code-target="${id}" — no element on the page has that id`,
    )
    expect(found).toEqual([])
  })

  /**
   * The hand-written key this file used to audit is retired: the highlight is derived from the
   * `data-kui` text now, so a leftover key does nothing — and a reader of the page source would
   * reasonably assume it still decides what lights up.
   */
  it.each(PAGES)('%s carries no retired data-show-code-key', (page) => {
    const found = [...PARSED.get(page)!.doc.querySelectorAll('[data-show-code-key]')].map(
      (el) => `${page} ${describeEl(el)}: data-show-code-key is retired; highlights derive from data-kui`,
    )
    expect(found).toEqual([])
  })

  /**
   * A card that prints no `data-kui` opens a modal with nothing marked and an empty "try it" box.
   * Ten shipped on `scroll.html` at once — a `data-show-code` on every `<figure>` of a
   * `horizontal-scroll` track whose effect lived on the container above them.
   */
  it.each(PAGES)('%s opens no card with nothing to highlight', (page) => {
    const found: string[] = []
    for (const root of PARSED.get(page)!.roots) {
      if (printedElements(root.el).some((el) => el.hasAttribute('data-kui'))) continue
      found.push(
        `${page} ${describeEl(root.el)} (${root.via}): prints no data-kui, so the modal opens ` +
          'with nothing highlighted and an empty value box',
      )
    }
    expect(found).toEqual([])
  })

  /**
   * Both directions at once, through the real script: a marked class or id that no `data-kui` in
   * the printed markup names fails (`ring-row` on the ring band), and a named one present in the
   * markup but left unmarked fails (the swipe-y deck's nested carousel). The comparison is a
   * multiset, so one stray mark or one missed occurrence of an otherwise-marked class both show.
   */
  it.each(PAGES)('%s highlights exactly what its data-kui selectors name', async (page) => {
    const found: string[] = []
    for (const root of PARSED.get(page)!.roots) {
      const expected = expectedMarks(root.el)
      const actual = await actualMarks(root.el)
      if (JSON.stringify(actual) === JSON.stringify(expected)) continue
      found.push(
        `${page} ${describeEl(root.el)} (${root.via}): marks ${JSON.stringify(actual)}, ` +
          `but its data-kui selectors name ${JSON.stringify(expected)}`,
      )
    }
    expect(found).toEqual([])
  })
})

/** Every `.ts` file under `dir`, tests excluded. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts'))
    .map((entry) => `${entry.parentPath}/${entry.name}`)
}

/**
 * Parameter names the library resolves as selectors: passed straight to `resolveTarget`, read into
 * a variable that is (`const sectionsAuthored = params.text('sections')`), or bound as a step
 * control (`bindControl('next', …)`).
 */
function librarySelectorParams(): Set<string> {
  const names = new Set<string>()
  for (const file of sourceFiles(SRC_DIR)) {
    const text = readFileSync(file, 'utf8')
    for (const match of text.matchAll(/resolveTarget\(\s*params\.text\('(\w+)'\)/g)) names.add(match[1]!)
    for (const match of text.matchAll(/const (\w+) = params\.text\('(\w+)'\)/g)) {
      if (new RegExp(`resolveTarget\\(\\s*${match[1]}\\b`).test(text)) names.add(match[2]!)
    }
    for (const match of text.matchAll(/bindControl\('(\w+)'/g)) names.add(match[1]!)
  }
  return names
}

describe('show-code selector parameter list', () => {
  it('covers every parameter the library resolves as a selector', () => {
    // A new selector-valued parameter in the library that neither list knows about would leave
    // its classes unmarked in the popover and unchecked here — the under-highlight bug again.
    const library = librarySelectorParams()
    expect(library.size).toBeGreaterThanOrEqual(6)
    const scriptList = /const SELECTOR_PARAMS = \[([^\]]*)\]/.exec(SHOW_CODE)![1]!
    const inScript = new Set([...scriptList.matchAll(/'(\w+)'/g)].map((match) => match[1]!))
    expect([...library].filter((name) => !inScript.has(name))).toEqual([])
    expect([...library].filter((name) => !SELECTOR_PARAMS.includes(name))).toEqual([])
    expect([...inScript].sort(byText)).toEqual([...SELECTOR_PARAMS].sort(byText))
  })
})

/**
 * The page sweep above compares the script with an oracle on real markup. These fixtures pin the
 * matcher's precision on the traps that markup happens not to contain today: substring near-misses,
 * captions that merely *say* `data-kui=`, the class/id namespaces, attribute selectors, and a
 * reference that only a nested `data-kui` makes.
 */
const FIXTURE_BODY = `
<div class="track-stage" id="reel-track" data-kui="horizontal-scroll distance:300vh target:.track">
  <p class="kui-contract"><code>data-kui="horizontal-scroll distance:300vh target:.track"</code></p>
  <div class="track">
    <figure class="demo-card"><img src="a.jpg" /><figcaption>data-kui="fade-up" — a caption</figcaption></figure>
  </div>
  <button type="button" class="hero-flip-code" data-show-code-target="reel-track">Show code</button>
</div>
<div class="panel" data-show-code data-kui="scroll-progress target:'#panel-body'">
  <div id="panel-body" class="panel-body" data-kui="fade-up 400ms">Body</div>
</div>
<div class="outer-shell" id="nested-demo" data-kui="swipe-y">
  <div class="inner-deck" data-kui="carousel target:'.slide, .dot' next:.down prev:.up jump:.dot">
    <figure class="slide"></figure>
    <button class="dot"></button>
    <button class="arrow up"></button><button class="arrow down"></button>
    <a class="mp4-link" href="x.mp4"></a>
  </div>
  <button type="button" class="kui-show-code-toggle" data-show-code-target="nested-demo">Show code</button>
</div>
<div class="attr-demo" id="attr-demo" data-kui="lightbox target:a[href$='.mp4']">
  <a class="mp4" href="x.mp4"></a>
  <button type="button" class="kui-show-code-toggle" data-show-code-target="attr-demo">Show code</button>
</div>
`

describe('show-code highlighting', () => {
  beforeAll(async () => {
    // jsdom reports `readyState: 'loading'` for the first tick after a document is built, and the
    // script branches on it: caught during that tick it registers a `DOMContentLoaded` listener
    // instead of initialising, and the event has already fired by the time anything clicks. One
    // tick puts the document past it either way.
    await tick()
    await mountShowCode(FIXTURE_BODY)
  })

  it('marks the data-kui attribute and whole class tokens, and nothing else', () => {
    expect(marksAfterClicking('[data-show-code-target="reel-track"]')).toEqual([
      'data-kui="horizontal-scroll distance:300vh target:.track"',
      'track',
    ])
  })

  it('leaves near-miss substrings of a referenced class alone', () => {
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
    expect(text).not.toContain('data-show-code')
  })

  it('marks an id an #id selector names, and not the same word as a class', () => {
    expect(marksAfterClicking('.panel .kui-show-code-toggle')).toEqual([
      "data-kui=\"scroll-progress target:'#panel-body'\"",
      'panel-body',
      'data-kui="fade-up 400ms"',
    ])
  })

  it('marks what a nested data-kui names, and leaves unnamed classes alone', () => {
    expect(marksAfterClicking('[data-show-code-target="nested-demo"]')).toEqual([
      'data-kui="swipe-y"',
      "data-kui=\"carousel target:'.slide, .dot' next:.down prev:.up jump:.dot\"",
      'slide',
      'dot',
      'up',
      'down',
    ])
  })

  it('does not read the inside of an attribute selector as a class', () => {
    expect(marksAfterClicking('[data-show-code-target="attr-demo"]')).toEqual([
      "data-kui=\"lightbox target:a[href$='.mp4']\"",
    ])
  })
})
