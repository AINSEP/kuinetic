// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createActivationBinder } from '../src/core/activation.js'
import { Animator } from '../src/core/animator.js'
import { defaultCapabilities } from '../src/core/capabilities.js'
import { Registry } from '../src/core/registry.js'
import { collectingReporter } from '../src/core/reporter.js'
import type { ScrollRoot, ScrollScheduler } from '../src/core/scroll-scheduler.js'
import type { EffectInstance, Primitive } from '../src/core/types.js'

/**
 * `animator.replay(el)` — reset, recompile, activate: the one route that starts a finished element
 * over (a second `activate()` of a finished CSS element reverses it, and `process()` short-circuits
 * on an unchanged fingerprint). `play()` and the `every:` cadence both go through it.
 *
 * A probe primitive records its lifecycle so the assertions are about what the animator did to the
 * instance, not about what any one real effect looks like.
 */

const idleScheduler: ScrollScheduler = {
  subscribe: () => () => {},
  invalidate: () => {},
  rootCount: () => 0,
  destroy: () => {},
}
const fakeRoot: ScrollRoot = {
  key: 'fake',
  metrics: () => ({ scrollTop: 0, scrollLeft: 0, viewportWidth: 800, viewportHeight: 600, viewportTop: 0, viewportLeft: 0 }),
  onScroll: () => () => {},
  onResize: () => () => {},
}

const observed = { count: 0 }

class FakeObserver {
  constructor() {
    observed.count++
  }
  observe(): void {}
  disconnect(): void {}
}

interface Log {
  events: string[]
  finish(): void
}

function registryWith(log: Log): Registry {
  let serial = 0
  const primitive: Primitive = {
    id: 'probe',
    renderer: 'javascript',
    channels: ['probe'],
    parameters: {},
    supportedTimelines: ['time'],
    supportedActivations: ['load', 'enter', 'click', 'manual'],
    perfClass: 'continuous',
    reducedMotion: 'shorten',
    prepare(): EffectInstance {
      const id = ++serial
      log.events.push(`prepare#${id}`)
      let finished = Promise.resolve()
      let resolve: () => void = () => {}
      return {
        activate: () => {
          log.events.push(`activate#${id}`)
          finished = new Promise<void>((r) => {
            resolve = r
            log.finish = r
          })
        },
        cancel: () => resolve(),
        finish: () => resolve(),
        get finished() {
          return finished
        },
        destroy: () => {
          log.events.push(`destroy#${id}`)
        },
      }
    },
  }
  return new Registry().registerPrimitive(primitive).registerPresets([{ name: 'probe-effect', primitive: 'probe' }])
}

function mount(source: string, log: Log) {
  document.body.innerHTML = `<div id="host" data-kui="${source}"></div>`
  const reporter = collectingReporter()
  const animator = new Animator({
    root: document.body,
    registry: registryWith(log),
    capabilities: defaultCapabilities({ individualTransforms: true, intersectionObserver: true, motionPath: true }),
    binder: createActivationBinder({ createObserver: undefined }),
    scheduler: idleScheduler,
    rootResolver: () => fakeRoot,
    reporter,
    observe: false,
  })
  animator.start()
  return { animator, reporter, host: document.getElementById('host') as HTMLElement }
}

function newLog(): Log {
  return { events: [], finish: () => {} }
}

beforeEach(() => {
  vi.useFakeTimers()
  observed.count = 0
  ;(window as unknown as { IntersectionObserver: unknown }).IntersectionObserver = FakeObserver
})

afterEach(() => {
  vi.useRealTimers()
  delete (window as unknown as { IntersectionObserver?: unknown }).IntersectionObserver
  document.body.innerHTML = ''
})

describe('animator.replay', () => {
  it('starts a never-activated element', () => {
    const log = newLog()
    const { animator, host } = mount('probe-effect on:manual', log)
    animator.replay(host)
    expect(log.events).toEqual(['prepare#1', 'destroy#1', 'prepare#2', 'activate#2'])
    expect(host.getAttribute('data-kui-state')).toBe('running')
    animator.destroy()
  })

  it('starts a finished element over with a freshly installed instance', async () => {
    const log = newLog()
    const { animator, host } = mount('probe-effect on:manual', log)
    animator.activate(host)
    log.finish()
    await vi.advanceTimersByTimeAsync(0)
    expect(host.getAttribute('data-kui-state')).toBe('finished')

    log.events.length = 0
    animator.replay(host)
    expect(log.events).toEqual(['destroy#1', 'prepare#2', 'activate#2'])
    expect(host.getAttribute('data-kui-state')).toBe('running')
    animator.destroy()
  })

  it('cancels a run in progress, then starts over', () => {
    const log = newLog()
    const { animator, host } = mount('probe-effect on:manual', log)
    const cancels = vi.fn()
    host.addEventListener('kui:cancel', cancels)
    animator.activate(host)
    animator.replay(host)
    expect(cancels).toHaveBeenCalledTimes(1)
    expect(log.events.at(-1)).toBe('activate#2')
    animator.destroy()
  })

  it('announces kui:start for the replayed run', async () => {
    const log = newLog()
    const { animator, host } = mount('probe-effect on:manual', log)
    animator.activate(host)
    log.finish()
    await vi.advanceTimersByTimeAsync(0)
    const starts = vi.fn()
    host.addEventListener('kui:start', starts)
    animator.replay(host)
    expect(starts).toHaveBeenCalledTimes(1)
    animator.destroy()
  })

  it('does not throw for an element the animator never installed', () => {
    const log = newLog()
    const { animator } = mount('probe-effect on:manual', log)
    const stray = document.createElement('div')
    document.body.append(stray)
    expect(() => animator.replay(stray)).not.toThrow()
    animator.destroy()
  })
})

describe('animator.replay and the every: cadence', () => {
  it('keeps the cadence across a replay: same scheduler, still ticking', async () => {
    const log = newLog()
    const { animator, host } = mount('probe-effect on:manual every:3s', log)
    expect(observed.count).toBe(1)

    animator.replay(host)
    animator.replay(host)
    expect(observed.count).toBe(1)

    log.finish()
    await vi.advanceTimersByTimeAsync(0)
    log.events.length = 0
    await vi.advanceTimersByTimeAsync(3000)
    // The cadence survived two resets and still replays on its own tick.
    expect(log.events).toContain('activate#4')
    expect(observed.count).toBe(1)
    animator.destroy()
  })
})
