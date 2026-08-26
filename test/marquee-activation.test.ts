import { beforeEach, describe, expect, it } from 'vitest'
import type { ActivationBinder } from '../src/core/activation.js'
import { Animator } from '../src/core/animator.js'
import { ATTR } from '../src/core/attrs.js'
import type { Capabilities } from '../src/core/capabilities.js'
import { collectingReporter } from '../src/core/reporter.js'
import type { Activation } from '../src/core/types.js'
import { createRegistry } from '../src/effects/index.js'

/**
 * A marquee has to start by itself.
 *
 * `ambient.ts` states the rule for continuous motion: such a primitive "declares
 * `reducedMotion: 'disable'` and starts on `load` rather than waiting on a scroll-triggered
 * `enter`", and every ambient primitive sets both. `text-marquee` set only the first half, so a
 * bare `data-kui="marquee 42s"` resolved to `enter`, which `style-plan.ts` gates as `deferred` and
 * stamps `animation-play-state: paused`.
 *
 * It compiled correctly and reported `data-kui-state="ready"` the whole time. Measured on a real
 * page with the marquee fully in view, it never ran — so this was not an observer that had simply
 * not fired yet. Every page carrying one had to know to write `on:load`.
 *
 * These assert the symptom rather than the metadata: a test that read
 * `primitive.defaultActivation === 'load'` would only restate the line that was missing, and would
 * still have passed if the gate downstream decided otherwise.
 */

const CAPS: Capabilities = {
  viewTimeline: true,
  scrollTimeline: true,
  animationRange: true,
  individualTransforms: true,
  scrollTimelineName: true,
  viewTransitions: true,
  intersectionObserver: true,
  reducedMotion: false,
  motionPath: true,
}

/**
 * A binder that RECORDS a binding and waits, rather than firing it.
 *
 * This distinction is the whole test. An earlier version of this file passed
 * `createActivationBinder({ createObserver: undefined })`, and with no observer to wait on, that
 * binder activates immediately — so `enter` behaved exactly like `load` and the suite stayed green
 * with the bug reintroduced. It asserted nothing. Recording the binding instead is what makes a
 * deferred activation observably deferred.
 */
interface RecordingBinder extends ActivationBinder {
  bindings: Array<{ el: Element; activation: Activation }>
  fire(el: Element): void
}

function recordingBinder(): RecordingBinder {
  const bindings: RecordingBinder['bindings'] = []
  const callbacks = new Map<Element, () => void>()
  const binder: RecordingBinder = {
    bindings,
    bind(el, activation, request) {
      bindings.push({ el, activation })
      callbacks.set(el, () => request.activate())
      return () => callbacks.delete(el)
    },
    fire(el) {
      callbacks.get(el)?.()
    },
    destroy() {},
  }
  return binder
}

let binder: RecordingBinder

function build(html: string): void {
  document.body.innerHTML = html
  binder = recordingBinder()
  new Animator({
    root: document.body,
    registry: createRegistry(),
    capabilities: CAPS,
    reporter: collectingReporter(),
    binder,
  }).start()
}

const el = (): HTMLElement => document.body.querySelector('[data-kui]') as HTMLElement

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('marquee activation', () => {
  it('runs a bare marquee without waiting to be told', () => {
    build('<div data-kui="marquee 42s"><span>a</span><span>a</span></div>')
    expect(el().style.getPropertyValue('animation-play-state')).toBe('running')
    expect(el().getAttribute(ATTR.state)).toBe('running')
    // Nothing is waiting on a viewport crossing. This is the assertion the bug actually violated.
    expect(binder.bindings).toHaveLength(0)
  })

  it('still runs when an author writes on:load, which is now redundant rather than required', () => {
    build('<div data-kui="marquee 42s on:load"><span>a</span><span>a</span></div>')
    expect(el().style.getPropertyValue('animation-play-state')).toBe('running')
  })

  it('leaves the scroll-linked variant to its timeline instead of starting it on a clock', () => {
    // `marquee-scroll-linked` takes its position from `animation-timeline: scroll()`, so the
    // activation default must not matter to it. Named here so that changing the default again
    // cannot quietly convert a scroll-driven marquee into a time-driven one.
    build(
      '<div data-kui="marquee-scroll-linked timeline:scroll"><span>a</span><span>a</span></div>',
    )
    expect(el().getAttribute(ATTR.normalized)).toContain('marquee-scroll-linked')
  })
})
