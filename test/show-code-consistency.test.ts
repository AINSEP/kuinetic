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
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import * as kuinetic from '../src/index.js'
import { PARAM_NOTES } from '../src/notes/index.js'

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
    // `bindControl(request, 'next', …)` — the shared one in `effects/step-index.ts`, whose first
    // argument is the deck's context and whose second is the parameter name.
    for (const match of text.matchAll(/bindControl\(\s*\w+,\s*'(\w+)'/g)) names.add(match[1]!)
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

/* ------------------------------------------------------------------------------------------------
 * Code | Args tabs.
 *
 * The Args tab draws everything from the runtime's `kuinetic.describeSteps()`. These tests hand the
 * script that API straight from `src/` rather than from the built `demo/kuinetic.js`, so they need
 * no build and always test the source the bundle would be built from. The oracles below read the
 * registry directly, not through `describe()`, so a wrong default in either place shows up.
 * ---------------------------------------------------------------------------------------------- */

const REGISTRY = kuinetic.createRegistry()

interface RuntimeWindow {
  kuinetic?: unknown
  kuineticNotes?: unknown
  __kui?: unknown
}

/** What a page has after `kuinetic.js` (and, once Args has opened, `kuinetic.notes.js`) loaded. */
function installRuntime({ notes }: { notes: boolean }): void {
  const win = window as unknown as RuntimeWindow
  win.kuinetic = {
    describe: kuinetic.describe,
    describeSteps: kuinetic.describeSteps,
    describeElement: kuinetic.describeElement,
  }
  if (notes) win.kuineticNotes = { PARAM_NOTES }
  else delete win.kuineticNotes
  // Apply's replay sequence; the tests only care that Args follows the applied value.
  win.__kui = { reset() {}, process() {}, activate() {} }
}

function uninstallRuntime(): void {
  const win = window as unknown as RuntimeWindow
  delete win.kuinetic
  delete win.kuineticNotes
  delete win.__kui
}

/** A step's own effect-arg rows — not the reserved-key rows nested in the same step block. */
const ARG_ROWS = ':scope > .kui-args-list > .kui-args-param'

function tab(id: 'code' | 'args'): HTMLElement {
  return document.getElementById(`kui-code-tab-${id}`)!
}

function panel(id: 'code' | 'args'): HTMLElement {
  return document.getElementById(`kui-code-panel-${id}`)!
}

function press(key: string): void {
  document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
}

/** The effect names the Args panel lists, in order: known ones by their summary, unknown by the
 * name its message quotes. */
function listedEffects(): string[] {
  return [...panel('args').querySelectorAll('.kui-args-step')].map((step) =>
    step.classList.contains('is-unknown')
      ? step.querySelector('.kui-args-unknown code')!.textContent!
      : step.querySelector(':scope > summary .kui-args-effect')!.textContent!,
  )
}

/** The registry's own default for `param` on `name`: the preset's override, else the primitive's. */
function registryDefault(name: string, param: string): string | undefined {
  const resolved = REGISTRY.resolve(name)
  if (!resolved) return undefined
  return resolved.preset.params?.[param] ?? resolved.primitive.parameters[param]?.default
}

/**
 * Every parameter row the Args panel shows that disagrees with the registry: a declared parameter
 * missing, one listed that is not declared, or a default other than the registry's.
 */
function argsMismatches(label: string): string[] {
  const found: string[] = []
  for (const step of panel('args').querySelectorAll('.kui-args-step:not(.is-unknown)')) {
    const name = step.querySelector(':scope > summary .kui-args-effect')!.textContent!
    const resolved = REGISTRY.resolve(name)
    if (!resolved) continue // a tier effect this registry does not carry; the page's own registry does
    const rows = [...step.querySelectorAll(`${ARG_ROWS}:not(.is-stray)`)]
    const shown = rows.map((row) => row.querySelector('.kui-args-name')!.textContent!)
    const declared = Object.keys(resolved.primitive.parameters)
    if (JSON.stringify([...shown].sort(byText)) !== JSON.stringify([...declared].sort(byText))) {
      found.push(`${label} ${name}: lists ${JSON.stringify(shown)}, registry declares ${JSON.stringify(declared)}`)
    }
    found.push(...defaultMismatches(`${label} ${name}`, name, rows))
  }
  return found
}

/** Rows whose "defaults to …" is not the registry's default (or that claim one where it is empty). */
function defaultMismatches(label: string, name: string, rows: Element[]): string[] {
  const found: string[] = []
  for (const row of rows) {
    const param = row.querySelector('.kui-args-name')!.textContent!
    const status = row.querySelector('.kui-args-status')!.textContent!
    const expected = registryDefault(name, param)!
    const ok = expected === '' ? !status.includes('defaults to') : status.includes(`defaults to ${expected}`)
    if (!ok) found.push(`${label}.${param}: shows "${status}", registry default is "${expected}"`)
  }
  return found
}

describe('show-code Code | Args tabs', () => {
  beforeEach(async () => {
    installRuntime({ notes: true })
    await mountShowCode(FIXTURE_BODY)
  })
  afterEach(uninstallRuntime)

  it('opens on Code, with the ARIA tab wiring in place', () => {
    document.querySelector<HTMLElement>('.panel .kui-show-code-toggle')!.click()
    const list = document.querySelector('.kui-code-modal [role="tablist"]')!
    expect(list.getAttribute('aria-label')).toBeTruthy()
    const tabs = [...list.querySelectorAll('[role="tab"]')]
    expect(tabs.map((t) => t.textContent)).toEqual(['Code', 'Args'])
    for (const t of tabs) {
      const p = document.getElementById(t.getAttribute('aria-controls')!)!
      expect(p.getAttribute('role')).toBe('tabpanel')
      expect(p.getAttribute('aria-labelledby')).toBe(t.id)
    }
    expect(tab('code').getAttribute('aria-selected')).toBe('true')
    expect(tab('args').getAttribute('aria-selected')).toBe('false')
    expect([tab('code').tabIndex, tab('args').tabIndex]).toEqual([0, -1])
    expect(panel('code').hidden).toBe(false)
    expect(panel('args').hidden).toBe(true)
    // The Code tab is the view this file's highlighting tests already pin.
    expect(panel('code').querySelector('pre code')).not.toBeNull()
  })

  it('moves between tabs with Left/Right/Home/End and keeps one tab stop', () => {
    document.querySelector<HTMLElement>('.panel .kui-show-code-toggle')!.click()
    tab('code').focus()
    const state = () => [document.activeElement!.id, tab('code').tabIndex, tab('args').tabIndex, panel('args').hidden]
    press('ArrowRight')
    expect(state()).toEqual(['kui-code-tab-args', -1, 0, false])
    press('ArrowRight') // wraps
    expect(state()).toEqual(['kui-code-tab-code', 0, -1, true])
    press('ArrowLeft') // wraps the other way
    expect(state()).toEqual(['kui-code-tab-args', -1, 0, false])
    press('Home')
    expect(state()).toEqual(['kui-code-tab-code', 0, -1, true])
    press('End')
    expect(state()).toEqual(['kui-code-tab-args', -1, 0, false])
    expect(tab('args').getAttribute('aria-selected')).toBe('true')
  })

  it('goes back to Code on the next open', () => {
    document.querySelector<HTMLElement>('.panel .kui-show-code-toggle')!.click()
    tab('args').click()
    expect(panel('args').hidden).toBe(false)
    document.querySelector<HTMLElement>('[data-show-code-target="nested-demo"]')!.click()
    expect(tab('code').getAttribute('aria-selected')).toBe('true')
    expect(panel('args').hidden).toBe(true)
  })

  it('lists every preset of every data-kui in the printed markup, nested ones included', () => {
    document.querySelector<HTMLElement>('[data-show-code-target="nested-demo"]')!.click()
    tab('args').click()
    expect(listedEffects()).toEqual(['swipe-y', 'carousel'])
    expect(panel('args').querySelectorAll('.kui-args-group')).toHaveLength(2)
    expect(argsMismatches('fixture')).toEqual([])
  })

  it('re-renders Args from the applied value, and Reset brings the original back', () => {
    document.querySelector<HTMLElement>('.panel .kui-show-code-toggle')!.click()
    tab('args').click()
    expect(listedEffects()).toEqual(['scroll-progress', 'fade-up'])
    const input = document.querySelector<HTMLInputElement>('.kui-code-tryit-input')!
    input.value = 'fade-up 900ms, lift'
    document.querySelector<HTMLElement>('.kui-code-tryit-apply')!.click()
    expect(listedEffects()).toEqual(['fade-up', 'lift', 'fade-up'])
    document.querySelector<HTMLElement>('.kui-code-tryit-reset')!.click()
    expect(listedEffects()).toEqual(['scroll-progress', 'fade-up'])
    expect(input.value).toBe("scroll-progress target:'#panel-body'")
  })

  it('names the likely effect for an unknown name', () => {
    document.querySelector<HTMLElement>('.panel .kui-show-code-toggle')!.click()
    tab('args').click()
    const input = document.querySelector<HTMLInputElement>('.kui-code-tryit-input')!
    input.value = 'fade-upp'
    document.querySelector<HTMLElement>('.kui-code-tryit-apply')!.click()
    const unknown = panel('args').querySelector('.kui-args-step.is-unknown')!
    expect(unknown.textContent).toBe('fade-upp is not an effect name. Did you mean fade-up?')
  })

  it('phrases required, defaulted and empty-default rows the way the brief asks', () => {
    document.querySelector<HTMLElement>('.panel .kui-show-code-toggle')!.click()
    tab('args').click()
    const status = (effect: string, param: string) => {
      const step = [...panel('args').querySelectorAll('.kui-args-step')].find(
        (s) => s.querySelector('summary .kui-args-effect')!.textContent === effect,
      )!
      const row = [...step.querySelectorAll(ARG_ROWS)].find(
        (r) => r.querySelector('.kui-args-name')!.textContent === param,
      )!
      return row.querySelector('.kui-args-status')!.textContent
    }
    expect(status('fade-up', 'duration')).toBe(`optional, defaults to ${registryDefault('fade-up', 'duration')}`)
    expect(registryDefault('scroll-progress', 'target')).toBe('')
    expect(status('scroll-progress', 'target')).toBe('optional')
  })

  it('highlights the args the markup sets, with their values, first', () => {
    document.querySelector<HTMLElement>('.panel .kui-show-code-toggle')!.click()
    tab('args').click()
    const input = document.querySelector<HTMLInputElement>('.kui-code-tryit-input')!
    input.value = 'fade-up 900ms 120ms distance:40px'
    document.querySelector<HTMLElement>('.kui-code-tryit-apply')!.click()
    const step = panel('args').querySelector('.kui-args-step')!
    const set = [...step.querySelectorAll(`${ARG_ROWS}.is-set`)].map((row) => [
      row.querySelector('.kui-args-name')!.textContent,
      row.querySelector('.kui-args-set mark')!.textContent,
    ])
    set.sort((a, b) => byText(a[0]!, b[0]!))
    expect(set).toEqual([
      ['delay', '120ms'],
      ['distance', '40px'],
      ['duration', '900ms'],
    ])
    // Set rows lead the list.
    const names = [...step.querySelectorAll(ARG_ROWS)].map((row) => row.querySelector('.kui-args-name')!.textContent)
    expect(names.slice(0, 3).sort(byText)).toEqual(['delay', 'distance', 'duration'])
  })

  /** Apply `value` on the fixture's `.panel` demo with Args open. */
  function applyOnPanel(value: string): void {
    document.querySelector<HTMLElement>('.panel .kui-show-code-toggle')!.click()
    tab('args').click()
    document.querySelector<HTMLInputElement>('.kui-code-tryit-input')!.value = value
    document.querySelector<HTMLElement>('.kui-code-tryit-apply')!.click()
  }

  /** `[name, value]` for every set row in a keys block; value is '' for an unset row. */
  function keyRows(block: Element): [string, string][] {
    return [...block.querySelectorAll(':scope > .kui-args-list > .kui-args-param')].map((row) => [
      row.querySelector('.kui-args-name')!.textContent!,
      row.querySelector('.kui-args-set mark')?.textContent ?? '',
    ])
  }

  function stepNamed(name: string): Element {
    return [...panel('args').querySelectorAll('.kui-args-step')].find(
      (s) => s.querySelector(':scope > summary .kui-args-effect')?.textContent === name,
    )!
  }

  const KEYS = kuinetic.describeKeys(PARAM_NOTES)
  const ELEMENT_KEYS = KEYS.filter((key) => key.scope === 'element').map((key) => key.name)
  const STEP_KEYS = KEYS.filter((key) => key.scope === 'step').map((key) => key.name)

  it('lists the element keys once per element and the step keys in each step, marking what is set', () => {
    applyOnPanel('fade-up on:click, lift at:-200ms')
    const group = panel('args').querySelector('.kui-args-group')!
    const elementBlocks = group.querySelectorAll(':scope > .kui-args-keys')
    expect(elementBlocks).toHaveLength(1)
    const elementRows = keyRows(elementBlocks[0]!)
    expect(elementRows.map(([name]) => name).sort(byText)).toEqual([...ELEMENT_KEYS].sort(byText))
    // Set rows lead, with the value the markup wrote.
    expect(elementRows[0]).toEqual(['on', 'click'])
    expect(elementRows.slice(1).every(([, value]) => value === '')).toBe(true)
    expect((elementBlocks[0] as HTMLDetailsElement).open).toBe(true)

    const liftKeys = stepNamed('lift').querySelector(':scope > .kui-args-keys')!
    expect(keyRows(liftKeys).map(([name]) => name).sort(byText)).toEqual([...STEP_KEYS].sort(byText))
    expect(keyRows(liftKeys)[0]).toEqual(['at', '-200ms'])
    const fadeKeys = stepNamed('fade-up').querySelector(':scope > .kui-args-keys') as HTMLDetailsElement
    expect(keyRows(fadeKeys).every(([, value]) => value === '')).toBe(true)
    expect(fadeKeys.open).toBe(false)
    // A reserved key is never reported as an ignored arg.
    expect(panel('args').querySelector('.is-stray')).toBeNull()
  })

  it('lists a key a target: step scopes to itself in that step, not on the element', () => {
    applyOnPanel('carousel target:.slide on:click')
    const stepKeys = keyRows(stepNamed('carousel').querySelector(':scope > .kui-args-keys')!)
    expect(stepKeys).toContainEqual(['on', 'click'])
    const elementRows = keyRows(panel('args').querySelector('.kui-args-group > .kui-args-keys')!)
    expect(elementRows).toContainEqual(['on', ''])
  })

  it('prints whenOmitted for a key, never "defaults to"', () => {
    applyOnPanel('fade-up')
    const on = KEYS.find((key) => key.name === 'on')!
    expect(on.whenOmitted).toBeTruthy()
    const row = [...panel('args').querySelectorAll('.kui-args-group > .kui-args-keys .kui-args-param')].find(
      (r) => r.querySelector('.kui-args-name')!.textContent === 'on',
    )!
    expect(row.querySelector('.kui-args-status')!.textContent).toBe('optional')
    expect(row.querySelector('.kui-args-omitted')!.textContent).toBe(`Left out: ${on.whenOmitted}`)
    expect(row.querySelector('.kui-args-spell')!.textContent).toMatch(/^Write it as /)
  })

  it('marks a bare slot the effect ignores, with the runtime reason', () => {
    // Found, not named: whichever registered effect the timing contract says ignores a slot.
    const name = REGISTRY.names().find((n) =>
      kuinetic.describe(n)!.positionalOrder.some((slot) => slot.honoured === false),
    )!
    const described = kuinetic.describe(name)!
    const ignored = described.positionalOrder.filter((slot) => slot.honoured === false).map((slot) => slot.slot)
    expect(described.unhonouredBecause).toBeTruthy()
    applyOnPanel(name)
    const line = stepNamed(name).querySelector('.kui-args-positional')!
    expect([...line.querySelectorAll('s.kui-args-ignored')].map((s) => s.textContent!.split(' → ')[1])).toEqual(ignored)
    expect(line.textContent).toContain(described.unhonouredBecause)
    // An honoured effect strikes nothing.
    applyOnPanel('fade-up')
    expect(panel('args').querySelector('s.kui-args-ignored')).toBeNull()
  })

  it('reads fine without notes, and fetches them once, next to show-code.js', () => {
    installRuntime({ notes: false })
    document.querySelector<HTMLElement>('.panel .kui-show-code-toggle')!.click()
    tab('args').click()
    tab('code').click()
    tab('args').click()
    const scripts = [...document.querySelectorAll('script[src$="kuinetic.notes.js"]')]
    expect(scripts).toHaveLength(1)
    expect(panel('args').querySelector('.kui-args-note')).toBeNull()
    expect(panel('args').querySelectorAll('.kui-args-param').length).toBeGreaterThan(0)
    expect(argsMismatches('no-notes')).toEqual([])
  })
})

describe('show-code Args on every page', () => {
  beforeAll(() => installRuntime({ notes: true }))

  /**
   * Through the real script, on every demo: the Args panel lists one group per printed `data-kui`
   * and, in each, one block per comma step, named as the runtime parses it — and every row's
   * default is the registry's. A preset the panel skipped, or a default it got wrong, fails here.
   */
  it.each(PAGES)('%s lists every preset its printed markup uses, with registry defaults', async (page) => {
    const found: string[] = []
    for (const root of PARSED.get(page)!.roots) {
      const clone = root.el.cloneNode(true) as Element
      for (const nested of clone.querySelectorAll('[data-show-code]')) nested.removeAttribute('data-show-code')
      clone.setAttribute('data-show-code', '')
      await mountShowCode(clone.outerHTML)
      document.querySelector<HTMLElement>('.kui-show-code-toggle:not([data-show-code-target])')!.click()
      const label = `${page} ${describeEl(root.el)} (${root.via})`
      if (tab('code').getAttribute('aria-selected') !== 'true') found.push(`${label}: did not open on Code`)
      tab('args').click()
      const printed = printedElements(root.el).filter((el) => el.hasAttribute('data-kui'))
      const expected = printed.flatMap((el) =>
        kuinetic.describeSteps(el.getAttribute('data-kui')!).map((step) => step.name),
      )
      const groups = panel('args').querySelectorAll('.kui-args-group').length
      if (groups !== printed.length) found.push(`${label}: ${groups} groups for ${printed.length} data-kui`)
      const listed = listedEffects()
      if (JSON.stringify(listed) !== JSON.stringify(expected)) {
        found.push(`${label}: lists ${JSON.stringify(listed)}, markup has ${JSON.stringify(expected)}`)
      }
      found.push(...argsMismatches(label))
    }
    expect(found).toEqual([])
  })
})
