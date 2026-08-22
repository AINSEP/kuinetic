// @vitest-environment node
//
// Static structural check on the demo pages — no DOM, no browser. The node environment is not
// optional: under jsdom, `import.meta.url` is an http: URL and `fileURLToPath` throws.
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Guard against unbalanced container tags in the demo pages.
 *
 * HTML is error-tolerant, which is the problem: one stray `</div>` closes an ancestor early, the
 * browser silently re-parents everything after it, and the page still renders. It just renders
 * wrong. A real instance of this shipped — an extra `</div>` closed `main > .wrap` two thirds of
 * the way down `scroll.html`, so every section after that point lost the 1200px max-width and the
 * 2.5rem gutter and ran full-bleed. It also broke the page horizontally: `.pin-section-stage`
 * pulls `margin-inline: -2.5rem` to reclaim `.wrap`'s own gutter, and outside `.wrap` there was no
 * gutter to reclaim, so it overhung the viewport by 40px and gave the whole document a horizontal
 * scrollbar.
 *
 * Nothing caught it. Not the effect-install check, which counts `data-kui` attributes and does not
 * care where they sit; not the tests, which never load a page; not review, because the diff was a
 * plausible-looking block of markup. The owner caught it by eye, from a screenshot, two sessions
 * later. This is the cheap check that would have caught it in seconds.
 */

const DEMO_DIR = fileURLToPath(new URL('../demo', import.meta.url))

/** Containers whose nesting carries layout meaning. Deliberately not every element — `<p>` and
 * `<li>` have optional end tags in HTML, so an unclosed one is legal and asserting on them would
 * produce noise rather than signal. */
const TRACKED = new Set(['div', 'section', 'figure', 'main', 'aside', 'header', 'footer', 'nav'])

/** Elements that never have a closing tag, so an opening one must not be pushed onto the stack. */
const VOID = new Set(['img', 'br', 'hr', 'input', 'meta', 'link', 'source', 'track', 'area'])

interface Imbalance {
  line: number
  detail: string
}

/**
 * Walk one document's tracked container tags, returning every place the nesting is wrong.
 *
 * Script and style bodies are blanked first — both can contain `<div>` inside a string literal or
 * a comment, and counting those would report failures on correct files. Comments go too, for the
 * same reason: a commented-out block is not markup.
 */
function imbalances(html: string): Imbalance[] {
  const cleaned = html
    .replace(/<!--[\s\S]*?-->/g, (match) => match.replace(/[^\n]/g, ' '))
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, (match) => match.replace(/[^\n]/g, ' '))
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, (match) => match.replace(/[^\n]/g, ' '))

  const stack: Array<{ tag: string; line: number }> = []
  const found: Imbalance[] = []

  const close = (tag: string, line: number): void => {
    const open = stack.pop()
    if (!open) found.push({ line, detail: `stray </${tag}> — nothing was open` })
    else if (open.tag !== tag) {
      found.push({ line, detail: `</${tag}> closes <${open.tag}> opened on line ${open.line}` })
    }
  }

  for (const match of cleaned.matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b[^>]*?(\/?)>/g)) {
    const tag = match[2]!.toLowerCase()
    if (!TRACKED.has(tag) || VOID.has(tag) || match[3] === '/') continue
    const line = cleaned.slice(0, match.index).split('\n').length
    if (match[1] === '/') close(tag, line)
    else stack.push({ tag, line })
  }

  for (const open of stack) {
    found.push({ line: open.line, detail: `<${open.tag}> is never closed` })
  }
  return found
}

const PAGES = readdirSync(DEMO_DIR).filter((file) => file.endsWith('.html'))

describe('demo page markup', () => {
  it('finds the demo pages', () => {
    // Backstop against the glob silently matching nothing, which would make the check below pass
    // vacuously — the same guard the other static tests use.
    expect(PAGES.length).toBeGreaterThanOrEqual(5)
  })

  it.each(PAGES)('%s nests its containers correctly', (page) => {
    const html = readFileSync(`${DEMO_DIR}/${page}`, 'utf8')
    const found = imbalances(html).map((entry) => `${page}:${entry.line} ${entry.detail}`)
    expect(found).toEqual([])
  })
})

/**
 * A demo page that re-plans an effect must also trigger it.
 *
 * `Animator.process()` plans an effect and leaves it **gated** on its activation trigger. For an
 * entrance that gate is `on:enter`, opened by an IntersectionObserver. That is fine on load and
 * fine for `replay.js` — but a page that swaps an element's `data-kui` in response to a click has
 * a problem: the element never left the viewport, so the observer never fires again, and the new
 * animation sits installed at `playState: 'paused', currentTime: 0` indefinitely.
 *
 * The failure is silent and, worse, *partial*. Frame 0 of `blur-in` is the picture slightly soft
 * and frame 0 of `fade-blur-up` is the picture slightly offset, so both look like they worked.
 * Frame 0 of `wipe-up` is `inset(100% 0 0)` — nothing at all. The owner reported "wipe-up and
 * wipe-right are broken" when in truth not one of the seventeen chips was ever running.
 *
 * Nothing else in the suite covers demo-page JavaScript, so this is a deliberately blunt static
 * check: in any script that calls `.process(`, `.activate(` must appear too. It cannot prove the
 * call is correct; it can only stop the pairing being dropped again, which is the thing that
 * actually happened.
 */
describe('demo pages activate what they re-process', () => {
  const pages = readdirSync(DEMO_DIR).filter(
    (file) => file.endsWith('.html') && !file.endsWith('-old.html'),
  )

  /** Comments stripped first. A substring scan cannot otherwise tell a live call from a
   * commented-out one, and `// kui.activate(target)` would satisfy the assertion while doing
   * nothing — which is exactly the state this test exists to reject. */
  const stripComments = (source: string): string =>
    source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

  const scriptsCallingProcess = pages.flatMap((file) => {
    const html = readFileSync(`${DEMO_DIR}/${file}`, 'utf8')
    return [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)]
      .map((match, index) => ({ file, index, body: stripComments(match[1]!) }))
      .filter((script) => script.body.includes('.process('))
  })

  it('has a page to guard, so this suite cannot pass vacuously', () => {
    expect(scriptsCallingProcess.length).toBeGreaterThan(0)
  })

  it.each(scriptsCallingProcess.map((s) => [`${s.file} script#${s.index}`, s] as const))(
    '%s pairs process() with activate()',
    (_label, script) => {
      expect(script.body).toContain('.activate(')
    },
  )
})
