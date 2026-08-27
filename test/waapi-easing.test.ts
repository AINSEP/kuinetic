import { describe, expect, it, vi } from 'vitest'
import type { PrepareContext } from '../src/core/effect-context.js'
import { cssEasingValue, waapiEasingValue } from '../src/core/easing.js'
import { createParams } from '../src/core/js-params.js'
import { LAYOUT_PRIMITIVES } from '../src/effects/layout/primitives.js'

/**
 * Regression coverage for the easing the three layout primitives hand to `Element.animate`.
 *
 * `effectEasing` returns the author's token verbatim, and all three layout primitives fed it
 * straight into the Web Animations API. `Element.animate` parses `easing` as a bare
 * `<easing-function>` with no cascade to consult, so every kUInetic-named curve was a hard throw
 * rather than a wrong-looking animation. Confirmed in Chrome before the fix:
 *
 *   data-kui="flip-shuffle ease:back-out", then reorder a child
 *   -> uncaught TypeError: Failed to execute 'animate' on 'Element':
 *      'back-out' is not a valid value for easing
 *   -> zero animations created; the reorder happened instantly, with nothing said.
 *
 * The same throw for `expo-out`, `circ-out`, `quart-out`, `spring`, `bounce`, for the positional
 * spelling (`flip-shuffle 400ms back-out`), and for `spring(bounce:0.5)`. Wrapping the token in
 * `var(--kui-ease-back-out, ease-out)` — which is what a stylesheet gets — throws there too, so
 * reusing `cssEasingValue` was never the fix.
 *
 * ## What jsdom cannot prove here
 *
 * jsdom resolves a custom property on the element that declares it but does **not inherit** it to
 * descendants, and it implements no Web Animations API at all. So these tests declare
 * `--kui-ease-*` inline on the element under test and stub `animate`. The two things that leaves
 * unproven — that `base.css`'s `:root` tokens inherit down to an arbitrary element, and that the
 * resolved values are ones the real WAAPI accepts — were verified in Chrome instead:
 * `ease:back-out` installs `cubic-bezier(0.34, 1.56, 0.64, 1)`, `ease:bounce` installs the
 * `linear(...)` from `base.css`, `ease:spring(bounce:0.5)` installs a generated `linear(...)`, and
 * an author's own subtree-scoped `--kui-ease-swift-out` installs that author's curve.
 */

const BACK_OUT = 'cubic-bezier(0.34, 1.56, 0.64, 1)'

/** The bare keywords `base.css` defines, all of which threw before the fix. */
const KUI_KEYWORDS = [
  'expo-in',
  'expo-out',
  'expo-in-out',
  'back-in',
  'back-out',
  'back-in-out',
  'quart-out',
  'circ-out',
  'spring',
  'bounce',
]

function fakeCtx(warn: (message: string) => void = vi.fn()): PrepareContext {
  return {
    doc: document,
    win: window,
    warn,
    style: { set: vi.fn(), claim: vi.fn(), restore: vi.fn(), owned: () => [] },
    invalidate: vi.fn(),
  } as unknown as PrepareContext
}

/** An element carrying every `base.css` token inline, so jsdom can resolve them without inheriting. */
function tokenBearer(): HTMLElement {
  const el = document.createElement('div')
  for (const name of KUI_KEYWORDS) el.style.setProperty(`--kui-ease-${name}`, BACK_OUT)
  document.body.append(el)
  return el
}

describe('waapiEasingValue', () => {
  it('never returns a var(), which Element.animate rejects as hard as the bare keyword', () => {
    const el = tokenBearer()
    for (const keyword of KUI_KEYWORDS) {
      // The contrast with the CSS path is the whole point of the function existing.
      expect(cssEasingValue(keyword)).toContain('var(')
      expect(waapiEasingValue(keyword, el, vi.fn())).toBe(BACK_OUT)
    }
    el.remove()
  })

  it('passes native keywords and literal easing functions through untouched', () => {
    const el = tokenBearer()
    const warn = vi.fn()
    for (const value of [
      'linear',
      'ease',
      'ease-in',
      'ease-out',
      'ease-in-out',
      'step-start',
      'step-end',
      'cubic-bezier(0.2, 0, 0, 1)',
      'steps(4)',
      'linear(0, 0.5, 1)',
    ]) {
      expect(waapiEasingValue(value, el, warn)).toBe(value)
    }
    expect(warn).not.toHaveBeenCalled()
    el.remove()
  })

  it('samples spring(...) into a literal linear() rather than passing the token on', () => {
    const el = tokenBearer()
    const resolved = waapiEasingValue('spring(bounce:0.5)', el, vi.fn())!
    expect(resolved).toMatch(/^linear\([\d., ]+\)$/)
    expect(resolved).not.toContain('spring')
    expect(resolved).not.toContain('var(')
    // A bare `spring` keyword resolves from the token, `spring(...)` from the integrator; both are
    // literal, which is all `Element.animate` requires of either.
    expect(waapiEasingValue('spring', el, vi.fn())).toBe(BACK_OUT)
    el.remove()
  })

  it('resolves a custom --kui-ease-* the author defined themselves', () => {
    // The reason this reads the cascade instead of mirroring `base.css` into a table:
    // `params.ts`'s EASING_KEYWORD accepts any `[a-z]+-(in|out|in-out)`, so the vocabulary is open
    // and a table could only ever know the names this repo happens to ship.
    const el = document.createElement('div')
    el.style.setProperty('--kui-ease-swift-out', 'cubic-bezier(0.11, 0.22, 0.33, 0.99)')
    document.body.append(el)
    const warn = vi.fn()
    expect(waapiEasingValue('swift-out', el, warn)).toBe('cubic-bezier(0.11, 0.22, 0.33, 0.99)')
    expect(warn).not.toHaveBeenCalled()
    el.remove()
  })

  it('names an undefined keyword rather than passing a value that would throw', () => {
    const el = document.createElement('div')
    document.body.append(el)
    const warn = vi.fn()
    expect(waapiEasingValue('swift-out', el, warn)).toBe('ease-out')
    expect(warn).toHaveBeenCalledOnce()
    expect(warn.mock.calls[0]![0]).toContain('swift-out')
    el.remove()
  })

  it('returns undefined for an unauthored easing, leaving the caller default standing', () => {
    // `flip.ts` picks `cubic-bezier(0.2, 0, 0, 1)` via `?? `, which `''` defeated and `undefined`
    // does not. Unreachable through the animator today — `readParams` seeds `ease` with the
    // primitive's own `'ease-out'` default — but `Element.animate` rejects the empty string with
    // its own dedicated message, so nothing may hand one on.
    const warn = vi.fn()
    expect(waapiEasingValue('', document.createElement('div'), warn)).toBeUndefined()
    expect(warn).not.toHaveBeenCalled()
  })
})

/** Capture the timing every `Element.animate` call is made with. */
function recordAnimate(el: HTMLElement): KeyframeAnimationOptions[] {
  const options: KeyframeAnimationOptions[] = []
  el.animate = ((_frames: unknown, timing: KeyframeAnimationOptions) => {
    options.push(timing)
    return { cancel: vi.fn(), finished: Promise.resolve() } as unknown as Animation
  }) as unknown as typeof el.animate
  return options
}

describe('layout primitives hand Element.animate a literal easing', () => {
  const autoHeight = LAYOUT_PRIMITIVES.find((primitive) => primitive.id === 'auto-height')!

  function fireToggle(el: HTMLElement, ease: string, warn = vi.fn()): KeyframeAnimationOptions[] {
    const observers: Array<{ fire: () => void }> = []
    class ControllableMutationObserver {
      private readonly callback: MutationCallback
      constructor(callback: MutationCallback) {
        this.callback = callback
        observers.push(this)
      }
      observe(): void {}
      disconnect(): void {}
      fire(): void {
        this.callback([], this as unknown as MutationObserver)
      }
    }
    vi.stubGlobal('MutationObserver', ControllableMutationObserver)
    const options = recordAnimate(el)
    const params = createParams({ attribute: 'data-open', duration: '400ms', ease })
    const instance = autoHeight.prepare!(el, params, fakeCtx(warn))
    instance.activate()
    observers[observers.length - 1]!.fire()
    instance.destroy()
    vi.unstubAllGlobals()
    return options
  }

  it('resolves an authored kUInetic keyword instead of forwarding it verbatim', () => {
    const el = tokenBearer()
    const options = fireToggle(el, 'back-out')
    expect(options).toHaveLength(1)
    expect(options[0]!.easing).toBe(BACK_OUT)
    el.remove()
  })

  it('never forwards a value Element.animate rejects', () => {
    for (const keyword of KUI_KEYWORDS) {
      const el = tokenBearer()
      const easing = fireToggle(el, keyword)[0]!.easing as string
      expect(easing).not.toBe(keyword)
      expect(easing).not.toContain('var(')
      expect(easing).not.toBe('')
      el.remove()
    }
  })

  it('leaves an unauthored effect on its own ease-out default', () => {
    const el = tokenBearer()
    const warn = vi.fn()
    expect(fireToggle(el, 'ease-out', warn)[0]!.easing).toBe('ease-out')
    expect(warn).not.toHaveBeenCalled()
    el.remove()
  })
})
