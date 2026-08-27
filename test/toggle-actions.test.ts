import { describe, expect, it, vi } from 'vitest'
import { createActivationBinder } from '../src/core/activation.js'
import type { ActivationBinder, ActivationRequest } from '../src/core/activation.js'
import { Animator } from '../src/core/animator.js'
import { ATTR } from '../src/core/attrs.js'
import { resolveConfig } from '../src/core/element-config.js'
import { parse } from '../src/core/parse.js'
import { collectingReporter } from '../src/core/reporter.js'
import { CAPS } from './support/animator-harness.js'
import { catalogRegistry } from './support/registry.js'
import {
  applyToggleVerb,
  parseToggleActions,
  validateToggleActions,
  warnAboutToggleActions,
} from '../src/core/toggle-actions.js'
import type { Crossing, ToggleTarget, ToggleVerb } from '../src/core/toggle-actions.js'
import type { InstanceControl } from '../src/core/types.js'

/** A four-way action table with everything unwritten defaulted, as the parser produces it. */
const actions = (value: string): ReturnType<typeof parseToggleActions> => parseToggleActions(value)

describe('parseToggleActions', () => {
  it('reads the four verbs in GSAP order', () => {
    expect(actions('play/pause/resume/reset')).toEqual({
      'enter': 'play',
      'leave': 'pause',
      'enter-back': 'resume',
      'leave-back': 'reset',
    })
  })

  it('defaults every slot the author left off to none', () => {
    // GSAP's own default, and this library's existing behaviour for an unpaired `on:enter`.
    expect(actions('play')).toEqual({
      'enter': 'play',
      'leave': 'none',
      'enter-back': 'none',
      'leave-back': 'none',
    })
  })

  it('skips an empty slot rather than reading it as a verb', () => {
    expect(actions('play//resume')['leave']).toBe('none')
    expect(actions('play//resume')['enter-back']).toBe('resume')
  })

  it('names an unrecognised verb and falls back to none for that crossing alone', () => {
    const warnings: string[] = []
    const parsed = parseToggleActions('play/pasue/resume', warnings)
    expect(parsed['leave']).toBe('none')
    expect(parsed['enter-back']).toBe('resume')
    expect(warnings.join()).toContain('unrecognised action "pasue" for the "leave" crossing')
  })

  it('names a fifth verb rather than silently dropping it', () => {
    const warnings: string[] = []
    parseToggleActions('play/pause/resume/reset/reverse', warnings)
    expect(warnings.join()).toContain('there are four crossings')
  })

  it('validates the shape without a document, the way validateActivation does', () => {
    expect(validateToggleActions('play/pause/resume/none')).toEqual([])
    expect(validateToggleActions('play/nope').join()).toContain('unrecognised action')
  })
})

describe('actions: as a hoisted key', () => {
  it('parses out of data-kui element-wide', () => {
    expect(parse('fade-up on:enter/leave actions:play/pause/resume/reset').actions).toBe(
      'play/pause/resume/reset',
    )
  })

  it('needs no quoting, because a slash is inert to the tokenizer', () => {
    // A space- or comma-separated spelling would have had to be quoted in every use.
    const parsed = parse('fade-up actions:play/pause/resume/reset, blur-in')
    expect(parsed.specs.map((spec) => spec.name)).toEqual(['fade-up', 'blur-in'])
  })

  it('warns at parse time for a verb that is not one', () => {
    const parsed = parse('fade-up actions:play/pasue')
    expect(parsed.warnings.join()).toContain('unrecognised action "pasue"')
    // Refused rather than half-applied, exactly as a malformed `on:` is.
    expect(parsed.actions).toBeUndefined()
  })

  it('reaches the element config as a resolved table', () => {
    const attributes = { source: '', on: null, timeline: null, threshold: null }
    const config = resolveConfig(attributes, parse('fade-up actions:play/pause'))
    expect(config.actions?.['leave']).toBe('pause')
  })

  it('is absent, not defaulted, when the author wrote none', () => {
    // Absent and "the default table" are different bindings: without it the observer keeps its
    // two-way delivery and its one-shot release.
    const attributes = { source: '', on: null, timeline: null, threshold: null }
    expect(resolveConfig(attributes, parse('fade-up')).actions).toBeUndefined()
  })
})

describe('applyToggleVerb', () => {
  function target(started: boolean): ToggleTarget & { calls: string[] } {
    const calls: string[] = []
    const control = {
      pause: () => calls.push('pause'),
      resume: () => calls.push('resume'),
      seek: (progress: number) => calls.push(`seek(${String(progress)})`),
      reverse: () => calls.push('control.reverse'),
      rate: () => calls.push('rate'),
      progress: 0,
      playState: 'idle',
    } as unknown as InstanceControl
    return {
      calls,
      started,
      controls: [control],
      activate: () => calls.push('activate'),
      reverse: () => calls.push('reverse'),
    }
  }

  const run = (verb: ToggleVerb, started = true): string[] => {
    const t = target(started)
    applyToggleVerb(verb, t)
    return t.calls
  }

  it('does nothing at all for none', () => {
    expect(run('none')).toEqual([])
  })

  it('routes the two directional verbs through the animator, not through a playhead', () => {
    // The whole architectural claim: this module adds no animation logic.
    expect(run('play')).toEqual(['activate'])
    expect(run('reverse')).toEqual(['reverse'])
  })

  it('pauses in place and resumes from there — the behaviour the gap was about', () => {
    expect(run('pause')).toEqual(['pause'])
    expect(run('resume')).toEqual(['resume'])
  })

  it('rewinds and stops for reset, rewinds and keeps going for restart', () => {
    expect(run('reset')).toEqual(['seek(0)', 'pause'])
    expect(run('restart')).toEqual(['activate', 'seek(0)', 'resume'])
  })

  it('jumps to the end for complete without pausing there', () => {
    // A paused animation sitting on its end never reaches `finished`, so the settle would hang and
    // `kui:finish` would never fire.
    expect(run('complete')).toEqual(['activate', 'seek(1)'])
  })

  it('leaves an element that never started exactly where it is for pause and reset', () => {
    // It is already stopped at its from-state, which is what both verbs ask for.
    expect(run('pause', false)).toEqual([])
    expect(run('reset', false)).toEqual([])
  })

  it('reads resume on an un-started element as "start", and touches no playhead', () => {
    // Writing the ledger's play-state directly would open the compiled gate behind the animator's
    // back — visibly running, `data-kui-state` still "ready", no `kui:start`.
    expect(run('resume', false)).toEqual(['activate'])
  })

  it('starts an un-started element for restart and complete without also seeking it', () => {
    expect(run('restart', false)).toEqual(['activate'])
    expect(run('complete', false)).toEqual(['activate'])
  })
})

describe('warnAboutToggleActions', () => {
  const base = {
    actions: actions('play/pause/resume/reset'),
    observed: true,
    activation: 'enter/leave',
    jsEffectNames: [] as string[],
    progressDriven: false,
  }

  it('says nothing when the element can honour every verb', () => {
    expect(warnAboutToggleActions(base)).toEqual([])
  })

  it('names an activation that has no crossings at all', () => {
    const problems = warnAboutToggleActions({ ...base, observed: false, activation: 'hover' })
    expect(problems.join()).toContain('activates on "hover"')
  })

  it('says nothing about a JS effect when no verb needs a playhead', () => {
    // `play` and `reverse` are element transitions; a JS effect participates in both.
    const problems = warnAboutToggleActions({
      ...base,
      actions: actions('play/reverse/play/reverse'),
      jsEffectNames: ['split-flap'],
    })
    expect(problems).toEqual([])
  })

  it('names the JS effects a playhead verb cannot reach', () => {
    const problems = warnAboutToggleActions({ ...base, jsEffectNames: ['split-flap'] })
    expect(problems.join()).toContain('split-flap')
    expect(problems.join()).toContain('rendered in JavaScript')
  })

  it('names a scroll-driven element, whose playhead belongs to the scroller', () => {
    const problems = warnAboutToggleActions({ ...base, progressDriven: true })
    expect(problems.join()).toContain('driven by scroll position')
  })
})

describe('four-way crossing delivery', () => {
  /**
   * Drive one element through a scripted sequence of observer entries and collect the crossings.
   *
   * The geometry is what the entry already carries — the element's box against the root's — so the
   * four crossings need no second observer and no scroll listener.
   */
  function crossings(boxes: { intersecting: boolean; top: number; bottom: number }[]): Crossing[] {
    let deliver: IntersectionObserverCallback = () => {}
    const createObserver = vi.fn((callback: IntersectionObserverCallback) => {
      deliver = callback
      return {
        observe: vi.fn(),
        unobserve: vi.fn(),
        disconnect: vi.fn(),
      } as unknown as IntersectionObserver
    })
    const binder = createActivationBinder({ createObserver })
    const el = document.createElement('div')
    const seen: Crossing[] = []
    binder.bind(el, 'enter/leave', {
      threshold: '0%',
      activate: () => seen.push('enter'),
      deactivate: () => seen.push('leave'),
      cross: (crossing) => seen.push(crossing),
    })
    for (const box of boxes) {
      deliver(
        [
          {
            target: el,
            isIntersecting: box.intersecting,
            boundingClientRect: { top: box.top, bottom: box.bottom, left: 0, right: 100 },
            rootBounds: { top: 0, bottom: 800, left: 0, right: 1000 },
          },
        ] as unknown as IntersectionObserverEntry[],
        {} as IntersectionObserver,
      )
    }
    return seen
  }

  const below = { intersecting: false, top: 900, bottom: 1000 }
  const inside = { intersecting: true, top: 100, bottom: 200 }
  const above = { intersecting: false, top: -200, bottom: -100 }

  it('tells a first entry from a re-entry, and a forward leave from a backward one', () => {
    // Scroll down past it, then back up through it, then down past it again.
    expect(crossings([below, inside, above, inside, below])).toEqual([
      'enter',
      'leave',
      'enter-back',
      'leave-back',
    ])
  })

  it('does not fire a leave for the observer’s opening report', () => {
    // The first delivery describes the element's *current* state, which below the fold is "not
    // intersecting". Acting on it would play an exit out of a from-state it had never left.
    expect(crossings([below])).toEqual([])
  })

  it('records the side even on the report it ignores, so the first entry is not a re-entry', () => {
    expect(crossings([below, inside])).toEqual(['enter'])
  })

  it('reads an element already scrolled past as re-entering when it comes back', () => {
    expect(crossings([above, inside])).toEqual(['enter-back'])
  })

  it('degrades to the two-way reading when the root bounds cannot be measured', () => {
    // `rootBounds` is null for a cross-origin iframe root; there is no side to be on, so a leave is
    // a leave and an entry is an entry — exactly what the library did before four crossings.
    let deliver: IntersectionObserverCallback = () => {}
    const binder = createActivationBinder({
      createObserver: (callback) => {
        deliver = callback
        return {
          observe: vi.fn(),
          unobserve: vi.fn(),
          disconnect: vi.fn(),
        } as unknown as IntersectionObserver
      },
    })
    const el = document.createElement('div')
    const seen: Crossing[] = []
    binder.bind(el, 'enter/leave', {
      threshold: '0%',
      activate: () => {},
      deactivate: () => {},
      cross: (crossing) => seen.push(crossing),
    })
    const send = (isIntersecting: boolean): void =>
      deliver(
        [{ target: el, isIntersecting, rootBounds: null }] as unknown as IntersectionObserverEntry[],
        {} as IntersectionObserver,
      )
    send(true)
    send(false)
    send(true)
    expect(seen).toEqual(['enter', 'leave', 'enter'])
  })

  it('keeps observing after the first entry, where a plain on:enter would have released', () => {
    // An element that named the other three crossings is asking to be told about them.
    expect(crossings([below, inside, above, inside])).toHaveLength(3)
  })
})

describe('the animator wires the crossings up', () => {
  /**
   * Build one element under a binder that records the request, so the four-way callback can be
   * driven directly — the shared `fakeBinder` only records `activate`, and what is being asserted
   * here is precisely the extra field.
   */
  function build(markup: string): {
    el: HTMLElement
    requests: ActivationRequest[]
    messages: string[]
  } {
    document.body.innerHTML = markup
    const requests: ActivationRequest[] = []
    const reporter = collectingReporter()
    const binder: ActivationBinder = {
      bind(_el, _activation, request) {
        requests.push(request)
        return () => {}
      },
      destroy() {},
    }
    new Animator({
      root: document.body,
      registry: catalogRegistry(),
      capabilities: CAPS,
      reporter,
      binder,
    }).start()
    return {
      el: document.body.querySelector('[data-kui]') as HTMLElement,
      requests,
      messages: reporter.messages,
    }
  }

  it('passes no crossing callback when the author wrote no actions', () => {
    // The default has to stay byte-for-byte the old two-way binding: `enter` is one-shot, and a
    // great deal of existing markup depends on that.
    expect(build('<div data-kui="fade-up"></div>').requests[0]?.cross).toBeUndefined()
  })

  it('passes one when the author did, and it drives the element', () => {
    const { el, requests } = build('<div data-kui="fade-up on:enter actions:play/pause"></div>')
    expect(el.getAttribute(ATTR.state)).toBe('ready')
    requests[0]?.cross?.('enter')
    expect(el.getAttribute(ATTR.state)).toBe('running')
  })

  it('does nothing for a crossing the author left as none', () => {
    const { el, requests } = build('<div data-kui="fade-up on:enter actions:none/play"></div>')
    requests[0]?.cross?.('enter')
    expect(el.getAttribute(ATTR.state)).toBe('ready')
  })

  it('warns about an activation with no crossings, even though it never reaches the binder', () => {
    // `on:load` resolves to an immediate gate, so `openGate` returns before it would ever bind —
    // which is exactly why the diagnostic has to run before that return rather than after it.
    const { requests, messages } = build('<div data-kui="fade-up on:load actions:play/pause"></div>')
    expect(requests).toHaveLength(0)
    expect(messages.join()).toContain('activates on "load"')
  })
})
