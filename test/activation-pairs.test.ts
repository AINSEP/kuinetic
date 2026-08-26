import { describe, expect, it } from 'vitest'
import { warnAboutActivation } from '../src/core/activation-diagnostics.js'
import { resolveActivationSpec } from '../src/core/activation-vocabulary.js'
import { Animator } from '../src/core/animator.js'
import { ATTR } from '../src/core/attrs.js'
import type { Capabilities } from '../src/core/capabilities.js'
import { Registry } from '../src/core/registry.js'
import { collectingReporter } from '../src/core/reporter.js'
import type { CollectingReporter } from '../src/core/reporter.js'
import { createRegistry } from '../src/effects/index.js'
import type { EffectInstance, Primitive } from '../src/core/types.js'

/**
 * End-to-end behaviour of paired activations, at the animator.
 *
 * These assert state transitions and which instance method ran, not pixels — jsdom implements no
 * `getAnimations()`, so nothing here proves an animation visibly plays backwards. What it does
 * prove is that the exit half reaches the right instance, that a JS-rendered effect is told it
 * cannot participate rather than silently doing nothing, and that a re-entry mid-exit turns the
 * playhead around instead of being swallowed. The visual half belongs to a browser test.
 */

const CAPS: Capabilities = {
  viewTimeline: false,
  scrollTimeline: false,
  animationRange: false,
  individualTransforms: true,
  scrollTimelineName: false,
  viewTransitions: false,
  intersectionObserver: true,
  reducedMotion: false,
}

interface Recorder {
  activated: number
  played: number
  reversed: number
  /**
   * One resolver per `finished` promise the instance has handed out, oldest first.
   *
   * A list rather than a single "settle the current one" callback, because the point of half these
   * tests is what happens when a *superseded* run resolves late. A single callback closing over a
   * reassigned variable would always resolve the newest promise, which is exactly the case that
   * cannot go wrong.
   */
  settles: Array<() => void>
}

/**
 * A registry of one primitive whose instance records every lifecycle call and lets the test decide
 * when its `finished` resolves.
 *
 * @param reversible - Whether the instance exposes `play`/`reverse`. `false` models a JS-rendered
 * effect, which has no playhead at all.
 * @complexity O(1) time and space.
 * @overallScore 100
 */
function recordingRegistry(recorder: Recorder, reversible: boolean): Registry {
  const primitive: Primitive = {
    id: 'recorder',
    renderer: 'javascript',
    channels: ['recorder'],
    parameters: {},
    supportedTimelines: ['time'],
    supportedActivations: ['load', 'enter', 'hover', 'focus', 'click', 'manual'],
    perfClass: 'compositor',
    reducedMotion: 'shorten',
    prepare(): EffectInstance {
      const fresh = (): Promise<void> =>
        new Promise<void>((resolve) => {
          recorder.settles.push(() => resolve())
        })
      let finished = fresh()
      const rearm = (): void => {
        finished = fresh()
      }
      const instance: EffectInstance = {
        activate: () => {
          recorder.activated++
        },
        cancel: () => {},
        finish: () => {},
        get finished() {
          return finished
        },
        destroy: () => {},
      }
      if (!reversible) return instance
      return {
        ...instance,
        get finished() {
          return finished
        },
        play: () => {
          recorder.played++
          rearm()
        },
        reverse: () => {
          recorder.reversed++
          rearm()
        },
      }
    },
  }
  return new Registry()
    .registerPrimitive(primitive)
    .registerPresets([{ name: 'recorder-effect', primitive: 'recorder' }])
}

/** Resolve the most recently handed-out `finished`, then drain the microtask queue. */
async function settleLatest(recorder: Recorder): Promise<void> {
  recorder.settles.at(-1)?.()
  await Promise.resolve()
  await Promise.resolve()
}

function harness(reversible: boolean): {
  el: Element
  recorder: Recorder
  reporter: CollectingReporter
} {
  const recorder: Recorder = { activated: 0, played: 0, reversed: 0, settles: [] }
  const reporter = collectingReporter()
  const root = document.createElement('div')
  const el = document.createElement('div')
  el.setAttribute(ATTR.source, 'recorder-effect')
  el.setAttribute(ATTR.on, 'pointerenter/pointerleave')
  root.append(el)

  const animator = new Animator({
    root,
    registry: recordingRegistry(recorder, reversible),
    capabilities: CAPS,
    reporter,
  })
  animator.start()
  return { el, recorder, reporter }
}

describe('paired activations at the animator', () => {
  it('starts on the first event and plays out on the second', async () => {
    const { el, recorder } = harness(true)
    expect(el.getAttribute(ATTR.state)).toBe('ready')

    el.dispatchEvent(new Event('pointerenter'))
    expect(recorder.activated).toBe(1)
    expect(el.getAttribute(ATTR.state)).toBe('running')

    await settleLatest(recorder)
    expect(el.getAttribute(ATTR.state)).toBe('finished')

    el.dispatchEvent(new Event('pointerleave'))
    expect(recorder.reversed).toBe(1)
    expect(el.getAttribute(ATTR.state)).toBe('running')

    // `ready`, not `finished`: the effect has run back to the from-state it started from, so the
    // element is exactly as it was before it was ever activated.
    await settleLatest(recorder)
    expect(el.getAttribute(ATTR.state)).toBe('ready')
  })

  it('treats two exits in a row as one exit', () => {
    const { el, recorder } = harness(true)
    el.dispatchEvent(new Event('pointerenter'))
    el.dispatchEvent(new Event('pointerleave'))
    el.dispatchEvent(new Event('pointerleave'))
    expect(recorder.reversed).toBe(1)
  })

  it('never plays out an element that never started', () => {
    const { el, recorder } = harness(true)
    el.dispatchEvent(new Event('pointerleave'))
    expect(recorder.reversed).toBe(0)
    expect(el.getAttribute(ATTR.state)).toBe('ready')
  })

  it('turns the playhead around when the entrance fires during the exit', () => {
    // A pointer leaving an element and coming straight back is the commonest thing a pointer
    // does. `activate`'s re-entrancy guard would swallow it, because a reversing element is still
    // `running`.
    const { el, recorder } = harness(true)
    el.dispatchEvent(new Event('pointerenter'))
    el.dispatchEvent(new Event('pointerleave'))
    el.dispatchEvent(new Event('pointerenter'))

    expect(recorder.reversed).toBe(1)
    expect(recorder.played).toBe(1)
    // Not a second `activate()`: the instances are already started, only the direction changed.
    expect(recorder.activated).toBe(1)
    expect(el.getAttribute(ATTR.state)).toBe('running')
  })

  it('does not let the abandoned exit report ready over the entrance that replaced it', async () => {
    const { el, recorder } = harness(true)
    el.dispatchEvent(new Event('pointerenter'))
    el.dispatchEvent(new Event('pointerleave'))
    const staleExit = recorder.settles.at(-1)!
    el.dispatchEvent(new Event('pointerenter'))

    staleExit()
    await Promise.resolve()
    await Promise.resolve()
    expect(el.getAttribute(ATTR.state)).toBe('running')
  })

  it('ignores both halves for an element it does not know', () => {
    const animator = new Animator({ registry: createRegistry(), capabilities: CAPS })
    const stranger = document.createElement('div')
    expect(() => animator.activate(stranger)).not.toThrow()
    expect(() => animator.deactivate(stranger)).not.toThrow()
  })

  it('warns by name when an effect has no playhead to run backwards', () => {
    // The alternative was inventing a shim that misbehaves differently per primitive. An author
    // whose `pointerleave` does nothing should learn it from a warning, not from a browser.
    const { el, recorder, reporter } = harness(false)
    el.dispatchEvent(new Event('pointerenter'))
    el.dispatchEvent(new Event('pointerleave'))

    expect(recorder.reversed).toBe(0)
    expect(reporter.messages.join()).toContain('cannot play backwards')
    // The state is left where it was rather than being reported as an exit that did not happen.
    expect(el.getAttribute(ATTR.state)).toBe('running')
  })
})

describe('activation diagnostics', () => {
  function warningsFor(attribute: string, effect = 'fade-up'): string[] {
    const reporter = collectingReporter()
    const root = document.createElement('div')
    const el = document.createElement('div')
    el.setAttribute(ATTR.source, effect)
    el.setAttribute(ATTR.on, attribute)
    root.append(el)
    new Animator({ root, registry: createRegistry(), capabilities: CAPS, reporter }).start()
    return reporter.messages
  }

  it('says nothing about an exit twin the effect implicitly supports', () => {
    // `supportedActivations` predates the exit twins, so `leave` is in nobody's declared list. A
    // literal check would warn about `enter/leave` for every effect in the catalog.
    expect(warningsFor('enter/leave')).toEqual([])
    expect(warningsFor('hover/unhover')).toEqual([])
    expect(warningsFor('focus/blur')).toEqual([])
  })

  it('says nothing about a raw event on an effect that supports listener activations', () => {
    expect(warningsFor('pointerleave')).toEqual([])
    expect(warningsFor('input/change')).toEqual([])
  })

  it('still warns when the effect genuinely cannot be event-driven', () => {
    // `pin-section` declares `manual`/`load`/`enter` — it has no listener activation at all, so a
    // raw event on it is exactly the mistake `supportedActivations` was added to catch.
    expect(warningsFor('pointerdown', 'pin-section').join()).toContain('is not supported')
  })

  it('names an event no document has ever heard of, and suggests the near miss', () => {
    // Opening the list traded a parse-time warning for silence: `clik` is now a legal event type,
    // so it binds a listener that never fires. This is the replacement diagnostic.
    const messages = warningsFor('clik').join()
    expect(messages).toContain('no DOM event named "clik"')
    expect(messages).toContain('did you mean "click"')
  })

  it('names the event without guessing when nothing is close enough to be a correction', () => {
    const messages = warningsFor('teleport').join()
    expect(messages).toContain('no DOM event named "teleport"')
    expect(messages).not.toContain('did you mean')
  })

  it('keeps quiet about real events this environment happens not to implement', () => {
    // jsdom has no `onpointerenter`, `onfocusin` or `onanimationend`. A probe alone would call
    // three working activations broken, which is how a warning channel becomes noise.
    expect(warningsFor('pointerleave/pointerenter')).toEqual([])
    expect(warningsFor('animationend')).toEqual([])
  })

  it('keeps quiet about a namespaced custom event nothing could recognise', () => {
    expect(warningsFor('cart:updated')).toEqual([])
    expect(warningsFor('htmx-after-swap')).toEqual([])
  })

  it('says nothing about support when no primitive claimed any activation', () => {
    // An empty list is an abstention, not a claim that nothing is supported — the same distinction
    // `compile.ts`'s `intersect` keeps between `undefined` and `[]`.
    const reporter = collectingReporter()
    warnAboutActivation({
      el: document.createElement('div'),
      spec: resolveActivationSpec('pointerdown'),
      supported: [],
      reporter,
    })
    expect(reporter.messages).toEqual([])
  })

  it('does not accuse anything when the element exposes no handler properties at all', () => {
    // A plain namespaced `Element` — not an `HTMLElement` or `SVGElement` — has no
    // `GlobalEventHandlers` mixin, so the probe would fail for every name including real ones. It
    // has to establish that it works before it is allowed to accuse anything.
    const reporter = collectingReporter()
    const root = document.createElement('div')
    const el = document.createElementNS('urn:x-kuinetic-test', 'thing')
    expect('onclick' in el).toBe(false)
    // The ledger writes through `element.style`, which the generic `Element` interface has no
    // business carrying; borrowing one keeps the test about the handler-property probe.
    Object.defineProperty(el, 'style', { value: document.createElement('div').style })
    el.setAttribute(ATTR.source, 'fade-up')
    el.setAttribute(ATTR.on, 'teleport')
    root.append(el)

    new Animator({ root, registry: createRegistry(), capabilities: CAPS, reporter }).start()
    expect(reporter.messages).toEqual([])
  })
})
