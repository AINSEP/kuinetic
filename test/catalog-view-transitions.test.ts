// View Transitions family (catalog section L) — `effects/catalog/view-transitions.ts` and
// `css/view-transitions.css`.
//
// Three groups of question, and they are not interchangeable:
//
//  1. **Registration shape.** The two names carry different channels on purpose, because a card
//     that is both the thing you click and the thing that morphs is the headline use case and
//     `data-kui="page-morph, view-swap"` on one element has to compose.
//  2. **What reaches the DOM.** `page-morph` puts an author-supplied string into a real CSS
//     declaration, which is the one thing `type: 'text'` is normally excused from — so every
//     rejection path is asserted by name, not just the happy one.
//  3. **What happens without support.** Every degradation branch (no API, no transition types,
//     reduced motion) is a silent success in production and therefore invisible unless a test
//     names it. All three are here.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { defaultCapabilities } from '../src/core/capabilities.js'
import type { PrepareContext } from '../src/core/effect-context.js'
import { createParams } from '../src/core/js-params.js'
import { createStyleLedger } from '../src/core/owned-styles.js'
import type { StyleLedger } from '../src/core/owned-styles.js'
import { Registry } from '../src/core/registry.js'
import type { EffectInstance } from '../src/core/types.js'
import {
  registerViewTransitions,
  VIEW_TRANSITION_PRESETS,
  VIEW_TRANSITION_PRIMITIVES,
} from '../src/effects/catalog/view-transitions.js'
import { extractKeyframes, stripComments } from './support/css-scan.js'
import { catalogRegistry } from './support/registry.js'

const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../src/css/view-transitions.css'),
  'utf8',
)
// Comment-stripped for every check that scans for a literal at-rule or declaration: this
// stylesheet's header quotes `@view-transition { navigation: auto }` while explaining why the
// library must *not* ship one, which would otherwise read as the very rule the check forbids.
// Same idiom `catalog-discrete.test.ts` uses.
const liveCss = stripComments(css)

/** A document that has the API, so the supported path is the default in these tests. */
const CAPABLE = defaultCapabilities({ viewTransitions: true })

interface Ctx {
  warnings: string[]
  ctx: PrepareContext
  style: StyleLedger
}

/** Same shape `catalog-discrete.test.ts` builds, plus the fields this family actually reads. */
function fakeCtx(el: Element, overrides: Partial<PrepareContext> = {}): Ctx {
  const warnings: string[] = []
  const style = createStyleLedger(el)
  return {
    warnings,
    style,
    ctx: {
      win: window,
      doc: window.document,
      capabilities: CAPABLE,
      reducedMotion: false,
      signal: new AbortController().signal,
      warn: (message: string) => warnings.push(message),
      style,
      ...overrides,
    } as unknown as PrepareContext,
  }
}

/** Prepare a name onto an element and activate it, which is when a deferred setup actually runs. */
function run(
  name: string,
  el: Element,
  values: Record<string, string> = {},
  overrides: Partial<PrepareContext> = {},
): { instance: EffectInstance; warnings: string[]; style: StyleLedger } {
  const resolved = catalogRegistry().resolve(name)!
  const { ctx, warnings, style } = fakeCtx(el, overrides)
  const instance = resolved.primitive.prepare!(el, createParams(values), ctx)
  instance.activate()
  return { instance, warnings, style }
}

function mount(html: string): HTMLElement {
  document.body.innerHTML = html
  return document.body.firstElementChild as HTMLElement
}

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('registration', () => {
  it('registers page-morph and view-swap, one primitive each', () => {
    expect(VIEW_TRANSITION_PRESETS.map((preset) => preset.name)).toEqual(['page-morph', 'view-swap'])
    expect(VIEW_TRANSITION_PRIMITIVES.map((primitive) => primitive.id)).toEqual([
      'view-morph',
      'view-swap',
    ])
    const registry = registerViewTransitions(new Registry())
    expect(VIEW_TRANSITION_PRESETS.every((preset) => registry.has(preset.name))).toBe(true)
  })

  it('is reachable from the full catalog', () => {
    expect(catalogRegistry().resolve('page-morph')?.primitive.id).toBe('view-morph')
    expect(catalogRegistry().resolve('view-swap')?.primitive.id).toBe('view-swap')
  })

  it('gives the two names disjoint channels, so one card can carry both', () => {
    // The regression this guards: filing both under one `view-transition` channel reads as a
    // clean model right up until `data-kui="page-morph, view-swap"` on a card is refused as a
    // collision — and that markup is the entire point of the family.
    const [morph, swap] = VIEW_TRANSITION_PRIMITIVES
    expect(morph!.channels).toEqual(['view-transition-name'])
    expect(swap!.channels).toEqual(['view-transition-run'])
    expect(morph!.channels.some((channel) => swap!.channels.includes(channel))).toBe(false)
  })

  it('refuses the enter activation on page-morph, which would leave half of every pair unnamed', () => {
    const morph = VIEW_TRANSITION_PRIMITIVES[0]!
    expect(morph.supportedActivations).toEqual(['load', 'manual'])
    expect(morph.defaultActivation).toBe('load')
  })

  it('keeps view-swap alive under reduced motion, so its control is never a dead button', () => {
    // `disable` would mean `activate()` is never called, the listener is never installed, and the
    // panel this control opens never opens. The reduction happens inside the shim instead.
    expect(VIEW_TRANSITION_PRIMITIVES[1]!.reducedMotion).toBe('shorten')
    expect(VIEW_TRANSITION_PRIMITIVES[0]!.reducedMotion).toBe('disable')
  })
})

describe('page-morph names the element', () => {
  it('derives the name from the element id, matching the native `auto` keyword', () => {
    const el = mount('<img id="hero-shot">')
    const { warnings } = run('page-morph', el)
    expect(el.style.getPropertyValue('view-transition-name')).toBe('hero-shot')
    expect(warnings).toEqual([])
  })

  it('takes an explicit name when the pair cannot share an id', () => {
    const el = mount('<img id="index-hero">')
    run('page-morph', el, { name: 'hero' })
    expect(el.style.getPropertyValue('view-transition-name')).toBe('hero')
  })

  it('restores the element exactly on teardown', () => {
    // The ledger is the animator's to unwind in production; this asserts the write went *through*
    // it rather than straight onto `element.style`, which is the difference between handing an
    // author's own `view-transition-name` back and eating it.
    const el = mount('<img id="hero-shot" style="view-transition-name: mine">')
    const { instance, style } = run('page-morph', el)
    expect(el.style.getPropertyValue('view-transition-name')).toBe('hero-shot')
    instance.destroy()
    style.restore()
    expect(el.style.getPropertyValue('view-transition-name')).toBe('mine')
  })

  it('warns and writes nothing when auto has no id to use', () => {
    const el = mount('<img>')
    const { warnings } = run('page-morph', el)
    expect(el.style.getPropertyValue('view-transition-name')).toBe('')
    expect(warnings.join('\n')).toContain('needs a name to morph')
  })

  it('rejects a name that is not a CSS identifier, rather than posting it into a declaration', () => {
    // The reason this path exists at all: `type: 'text'` is the "arbitrary characters" escape
    // hatch, and everywhere else it is safe because the value never reaches a stylesheet. Here it
    // does, so the check is this primitive's own to make.
    const el = mount('<div>')
    const { warnings } = run('page-morph', el, { name: 'red; position: fixed' })
    expect(el.style.getPropertyValue('view-transition-name')).toBe('')
    expect(warnings.join('\n')).toContain('must be a CSS identifier')
  })

  it('rejects an id that is not a CSS identifier just as firmly as an authored name', () => {
    // An id is author input too — `id="2-col"` is perfectly legal HTML and not a legal ident.
    const el = mount('<div id="2-col">')
    const { warnings } = run('page-morph', el)
    expect(el.style.getPropertyValue('view-transition-name')).toBe('')
    expect(warnings.join('\n')).toContain('must be a CSS identifier')
  })

  // `auto` is absent on purpose: it is the default and resolves to the element's id above, so it
  // is the happy path rather than a keyword no-op.
  it.each(['none', 'match-element'])('names the keyword %s as a no-op, not a name', (word) => {
    const el = mount('<div id="card">')
    const { warnings } = run('page-morph', el, { name: word })
    expect(el.style.getPropertyValue('view-transition-name')).toBe('')
    expect(warnings.join('\n')).toContain('is a keyword, not a name')
  })

  it('warns by name and writes nothing where the API does not exist', () => {
    const el = mount('<img id="hero-shot">')
    const { warnings } = run('page-morph', el, {}, { capabilities: defaultCapabilities() })
    expect(el.style.getPropertyValue('view-transition-name')).toBe('')
    expect(warnings.join('\n')).toContain('no View Transitions API')
  })

  it('refuses authored timing by name instead of accepting it and doing nothing', () => {
    // `page-morph 400ms` used to be the obvious thing to type. It cannot work — the pseudo-element
    // tree hangs off the document root — so the contract says so out loud.
    const el = mount('<img id="hero-shot">')
    const resolved = catalogRegistry().resolve('page-morph')!
    const { ctx, warnings } = fakeCtx(el)
    resolved.primitive
      .prepare!(el, createParams({}, { durationMs: 400, delayMs: 50, easing: 'linear' }), ctx)
      .activate()
    expect(warnings.join('\n')).toContain('--kui-vt-duration')
    for (const token of ['duration', 'delay', 'ease']) {
      expect(warnings.some((message) => message.includes(`cannot honour ${token}`))).toBe(true)
    }
  })
})

describe('view-swap starts a same-document transition', () => {
  let started: unknown[]

  beforeEach(() => {
    started = []
  })

  afterEach(() => {
    delete (document as { startViewTransition?: unknown }).startViewTransition
    delete (window as { ViewTransition?: unknown }).ViewTransition
  })

  /** Install a `startViewTransition` that records its argument and runs the update immediately. */
  function stubApi(withTypes: boolean): void {
    ;(document as { startViewTransition?: unknown }).startViewTransition = (
      arg: (() => void) | { update: () => void; types?: string[] },
    ) => {
      started.push(arg)
      if (typeof arg === 'function') arg()
      else arg.update()
      return {}
    }
    if (withTypes) {
      // A **getter**, not `types: string[] = []`. A class instance field is assigned in the
      // constructor and never lands on the prototype, so the first version of this stub made
      // `'types' in ViewTransition.prototype` false and quietly pushed every test through the
      // no-types path — the probe was right and the stub was lying to it. A WebIDL attribute is
      // an accessor on the prototype, which is what a real `ViewTransition` exposes and what this
      // now imitates.
      class FakeViewTransition {
        get types(): string[] {
          return []
        }
      }
      ;(window as { ViewTransition?: unknown }).ViewTransition = FakeViewTransition
    }
  }

  function swapPage(): { control: HTMLElement; panel: HTMLElement } {
    document.body.innerHTML =
      '<button id="go" aria-controls="detail" aria-expanded="false">Details</button>' +
      '<section id="detail"></section>'
    return {
      control: document.getElementById('go')!,
      panel: document.getElementById('detail')!,
    }
  }

  it('flips the aria-controls target inside a transition, and mirrors aria-expanded', () => {
    stubApi(false)
    const { control, panel } = swapPage()
    run('view-swap', control)

    control.click()
    expect(started).toHaveLength(1)
    expect(panel.hasAttribute('data-open')).toBe(true)
    expect(control.getAttribute('aria-expanded')).toBe('true')

    control.click()
    expect(panel.hasAttribute('data-open')).toBe(false)
    expect(control.getAttribute('aria-expanded')).toBe('false')
  })

  it('never invents an aria-expanded the control did not already declare', () => {
    // Adding one would be inventing an accessibility contract on the author's behalf; keeping an
    // existing one in step is the opposite — it stops the library making the two disagree.
    stubApi(false)
    document.body.innerHTML =
      '<button id="go" aria-controls="detail"></button><section id="detail"></section>'
    const control = document.getElementById('go')!
    run('view-swap', control)
    control.click()
    expect(control.hasAttribute('aria-expanded')).toBe(false)
    expect(document.getElementById('detail')!.hasAttribute('data-open')).toBe(true)
  })

  it('passes the authored type when the browser supports transition types', () => {
    stubApi(true)
    const { control } = swapPage()
    run('view-swap', control, { type: 'kui-page-slide' })
    control.click()
    expect(started[0]).toMatchObject({ types: ['kui-page-slide'] })
  })

  it('omits the type when the browser has no types, rather than passing an argument it rejects', () => {
    // The object form throws a TypeError on an implementation that only accepts a callback, and
    // the typed CSS could not have matched in that browser either — so the honest degradation is
    // the browser's own cross-fade, not a thrown error.
    stubApi(false)
    const { control, panel } = swapPage()
    run('view-swap', control, { type: 'kui-page-slide' })
    control.click()
    expect(typeof started[0]).toBe('function')
    expect(panel.hasAttribute('data-open')).toBe(true)
  })

  it('says so when it had to drop an authored type, instead of ignoring the parameter', () => {
    // The defect this closes: the type reached neither the browser nor the author, so
    // `type:kui-page-slide` read as a working knob while the page took the default cross-fade.
    // A parameter that configures nothing and says nothing is the no-op the grammar rejects
    // everywhere else.
    stubApi(false)
    const { control } = swapPage()
    const { warnings } = run('view-swap', control, { type: 'kui-page-slide' })
    expect(warnings.join('\n')).toContain('type:kui-page-slide')
    expect(warnings.join('\n')).toContain('needs View Transition types')
  })

  it('warns once at install, not once per click', () => {
    stubApi(false)
    const { control } = swapPage()
    const { warnings } = run('view-swap', control, { type: 'kui-page-slide' })
    const before = warnings.length
    control.click()
    control.click()
    expect(warnings).toHaveLength(before)
  })

  it('stays silent about the type when the author asked for none', () => {
    stubApi(false)
    const { control } = swapPage()
    const { warnings } = run('view-swap', control)
    expect(warnings).toEqual([])
  })

  it('sends the type without complaint once the browser can take it', () => {
    // The other half of the pair above: the warning must not fire on a capable browser, or it
    // becomes noise every author learns to ignore.
    stubApi(true)
    const { control } = swapPage()
    const { warnings } = run('view-swap', control, { type: 'kui-page-slide' })
    control.click()
    expect(started[0]).toMatchObject({ types: ['kui-page-slide'] })
    expect(warnings).toEqual([])
  })

  it('takes a controls: selector when aria-controls is not the right answer', () => {
    stubApi(false)
    document.body.innerHTML = '<button id="go"></button><section class="panel"></section>'
    const control = document.getElementById('go')!
    run('view-swap', control, { controls: '.panel' })
    control.click()
    expect(document.querySelector('.panel')!.hasAttribute('data-open')).toBe(true)
  })

  it('flips the attribute the author named', () => {
    stubApi(false)
    const { control, panel } = swapPage()
    run('view-swap', control, { attribute: 'data-expanded' })
    control.click()
    expect(panel.hasAttribute('data-expanded')).toBe(true)
    expect(panel.hasAttribute('data-open')).toBe(false)
  })

  it('warns instead of installing a listener when there is nothing to swap', () => {
    stubApi(false)
    const control = mount('<button></button>')
    const { warnings } = run('view-swap', control)
    control.click()
    expect(started).toEqual([])
    expect(warnings.join('\n')).toContain('nothing to swap')
  })

  it('warns when a controls: selector matches nothing', () => {
    stubApi(false)
    const control = mount('<button></button>')
    const { warnings } = run('view-swap', control, { controls: '#absent' })
    expect(warnings.join('\n')).toContain('matched nothing')
  })
})

describe('view-swap degrades without breaking the page', () => {
  afterEach(() => {
    delete (document as { startViewTransition?: unknown }).startViewTransition
  })

  function control(): HTMLElement {
    document.body.innerHTML =
      '<button id="go" aria-controls="detail"></button><section id="detail"></section>'
    return document.getElementById('go')!
  }

  it('applies the state change directly when the API is absent, and warns by name', () => {
    const el = control()
    const { warnings } = run('view-swap', el, {}, { capabilities: defaultCapabilities() })
    el.click()
    expect(document.getElementById('detail')!.hasAttribute('data-open')).toBe(true)
    expect(warnings.join('\n')).toContain('no View Transitions API')
  })

  it('does not pile a type warning on top of the missing-API one', () => {
    // Two messages about the same absence is worse than one: the type is moot precisely because
    // the API it configures is not there, and the first message already says so.
    const el = control()
    const { warnings } = run(
      'view-swap',
      el,
      { type: 'kui-page-slide' },
      { capabilities: defaultCapabilities() },
    )
    expect(warnings).toHaveLength(1)
  })

  it('stays silent under reduced motion, which is a preference being honoured', () => {
    const el = control()
    const { warnings } = run('view-swap', el, {}, { reducedMotion: true })
    el.click()
    expect(warnings).toEqual([])
  })

  it('applies the state change directly under reduced motion', () => {
    // The regression this guards is a dead button: refusing to run at all would mean a
    // reduced-motion user could never open the panel.
    let calls = 0
    ;(document as { startViewTransition?: unknown }).startViewTransition = () => {
      calls++
      return {}
    }
    const el = control()
    run('view-swap', el, {}, { reducedMotion: true })
    el.click()
    expect(calls).toBe(0)
    expect(document.getElementById('detail')!.hasAttribute('data-open')).toBe(true)
  })

  it('stops listening once the effect is torn down', () => {
    const el = control()
    const abort = new AbortController()
    run('view-swap', el, {}, { signal: abort.signal, capabilities: defaultCapabilities() })
    abort.abort()
    el.click()
    expect(document.getElementById('detail')!.hasAttribute('data-open')).toBe(false)
  })
})

describe('view-transitions.css', () => {
  it('ships no @view-transition at-rule of its own', () => {
    // The whole reason the cross-document opt-in is the author's line: an at-rule cannot be
    // scoped to a selector, so shipping one would opt every consuming site into animating every
    // same-origin navigation.
    expect(liveCss).not.toMatch(/@view-transition\b/)
  })

  it('gates every declaration behind an @supports probe', () => {
    expect(liveCss).toContain('@supports (view-transition-name: none)')
    // The `:root` custom-property defaults are the half that genuinely needs the gate — the
    // pseudo-element rules self-guard on an unparseable selector, but these are ordinary
    // declarations that would otherwise compute and inherit everywhere.
    const gate = liveCss.indexOf('@supports (view-transition-name: none)')
    expect(liveCss.indexOf('--kui-vt-duration')).toBeGreaterThan(gate)
  })

  it('sits inside the library cascade layer, so a page overrides it without !important', () => {
    expect(liveCss).toContain('@layer kui.effects')
  })

  it('names a type for each shipped page-transition look, in both snapshot halves', () => {
    for (const type of ['kui-page-fade', 'kui-page-slide', 'kui-curtain-wipe']) {
      expect(liveCss).toContain(`:active-view-transition-type(${type})::view-transition-old(root)`)
      expect(liveCss).toContain(`:active-view-transition-type(${type})::view-transition-new(root)`)
    }
  })

  it('defines every keyframe block it references, and references every one it defines', () => {
    // The orphan/dangling check `css-invariants.test.ts` runs over the rest of the catalog. This
    // stylesheet is outside its `EFFECT_FILES` list — every rule here paints the browser's own
    // pseudo-element tree rather than a `data-kui-fx` host box, so none of that file's joins
    // apply — which is exactly why the check has to exist here instead of nowhere.
    const defined = new Set(extractKeyframes(liveCss).keys())
    // One `\s`, unquantified, rather than `\s*`: an adjacent pair of quantifiers that can both
    // claim the same run is the shape `sonarjs/slow-regex` objects to, and this file writes every
    // declaration with exactly one space after the colon.
    const referenced = new Set(
      [...liveCss.matchAll(/animation-name:\s([\w-]+)/g)].map((match) => match[1]!),
    )
    expect(defined.size).toBeGreaterThan(0)
    expect([...referenced].filter((name) => !defined.has(name))).toEqual([])
    expect([...defined].filter((name) => !referenced.has(name))).toEqual([])
  })

  it('shortens rather than removes the animation under reduced motion', () => {
    // `animation: none` on a `::view-transition-group` does not mean "no morph" — it means the
    // snapshots sit at their un-animated positions for the transition's full length, which reads
    // as a broken page. 1ms resolves to the end state and the transition finishes.
    const media = liveCss.slice(liveCss.indexOf('@media (prefers-reduced-motion: reduce)'))
    expect(media).toContain('animation-duration: 1ms !important')
    expect(media).not.toContain('animation: none')
  })

  it('prefixes its document-level knobs so they cannot retint the rest of the catalog', () => {
    // Set on `:root`, so an unprefixed `--kui-duration`/`--kui-distance` here would inherit into
    // every effect on the page. Same reasoning as `--kui-ambient-c1` in ambient.css.
    for (const property of ['--kui-vt-duration', '--kui-vt-delay', '--kui-vt-ease']) {
      expect(liveCss).toContain(property)
    }
    // Substring, not a regex: `--kui-vt-duration:` does not contain `--kui-duration:`, so the
    // plain check is exact here and needs no anchoring.
    expect(liveCss).not.toContain('--kui-duration:')
    expect(liveCss).not.toContain('--kui-distance:')
  })
})
