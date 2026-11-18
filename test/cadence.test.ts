// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createActivationBinder } from '../src/core/activation.js'
import { Animator } from '../src/core/animator.js'
import { defaultCapabilities } from '../src/core/capabilities.js'
import { everyToMs } from '../src/core/cadence.js'
import { PAUSE_SCOPE_ATTR, announcePauseScope } from '../src/core/pause-scope.js'
import { Registry } from '../src/core/registry.js'
import { collectingReporter } from '../src/core/reporter.js'
import type { ScrollRoot, ScrollScheduler } from '../src/core/scroll-scheduler.js'
import type { EffectInstance, Primitive } from '../src/core/types.js'

/**
 * `every:` — one demonstration step per period, through the shared scheduler.
 *
 * A probe primitive stands in for every renderer: its `finished` is a real pending promise the test
 * resolves, so "running", "finished" and "ready" are states the animator actually reaches, and its
 * optional `cycle` hook is the P4 contract (`Primitive.cycle`). Time is vitest's fake clock; the
 * observer is a stub the test drives, because jsdom has none and "offscreen" is otherwise
 * unreachable. Whether a real page loops visibly is the browser tier's question, not this file's.
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

const watchers: { all: FakeObserver[] } = { all: [] }

class FakeObserver {
  constructor(readonly callback: (entries: { isIntersecting: boolean }[]) => void) {
    watchers.all.push(this)
  }
  observe(): void {}
  disconnect(): void {}
  report(isIntersecting: boolean): void {
    this.callback([{ isIntersecting }])
  }
}

interface Probe {
  prepares: number
  activates: number
  cycles: number
  /** Resolve the current run, as an effect finishing. */
  finish(): void
}

function probeRegistry(probe: Probe, options: { cycle?: () => void } = {}): Registry {
  const primitive: Primitive = {
    id: 'probe',
    renderer: 'javascript',
    channels: ['probe'],
    parameters: {},
    supportedTimelines: ['time'],
    supportedActivations: ['load', 'enter', 'click', 'manual'],
    perfClass: 'continuous',
    reducedMotion: 'shorten',
    repeatable: true,
    ...(options.cycle ? { cycle: options.cycle } : {}),
    prepare(): EffectInstance {
      probe.prepares++
      let finished = Promise.resolve()
      let resolve: () => void = () => {}
      return {
        activate: () => {
          probe.activates++
          finished = new Promise<void>((r) => {
            resolve = r
            probe.finish = r
          })
        },
        cancel: () => resolve(),
        finish: () => resolve(),
        get finished() {
          return finished
        },
        destroy: () => {},
      }
    },
  }
  return new Registry().registerPrimitive(primitive).registerPresets([{ name: 'probe-effect', primitive: 'probe' }])
}

function newProbe(): Probe {
  return { prepares: 0, activates: 0, cycles: 0, finish: () => {} }
}

function mount(source: string, registry: Registry, extra: { reducedMotion?: boolean } = {}) {
  document.body.innerHTML = `<div id="host" data-kui="${source}"></div>`
  const reporter = collectingReporter()
  const animator = new Animator({
    root: document.body,
    registry,
    capabilities: defaultCapabilities({
      individualTransforms: true,
      intersectionObserver: true,
      motionPath: true,
      reducedMotion: extra.reducedMotion ?? false,
    }),
    binder: createActivationBinder({ createObserver: undefined }),
    scheduler: idleScheduler,
    rootResolver: () => fakeRoot,
    reporter,
    observe: false,
  })
  animator.start()
  return { animator, reporter, host: document.getElementById('host') as HTMLElement }
}

/** Advance the clock and let the promise chains the tick started settle. */
async function elapse(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms)
}

beforeEach(() => {
  vi.useFakeTimers()
  watchers.all = []
  ;(window as unknown as { IntersectionObserver: unknown }).IntersectionObserver = FakeObserver
  Object.defineProperty(document, 'hidden', { configurable: true, value: false })
})

afterEach(() => {
  vi.useRealTimers()
  delete (window as unknown as { IntersectionObserver?: unknown }).IntersectionObserver
  Reflect.deleteProperty(document, 'hidden')
  document.body.innerHTML = ''
})

describe('everyToMs', () => {
  it('reads the two time spellings', () => {
    expect(everyToMs('2.6s')).toBe(2600)
    expect(everyToMs('900ms')).toBe(900)
    expect(everyToMs('.5s')).toBe(500)
    expect(Number.isNaN(everyToMs('abc'))).toBe(true)
  })
})

describe('every: tick ordering', () => {
  it('activates an element that never started, then replays it once it has finished', async () => {
    const probe = newProbe()
    const { animator } = mount('probe-effect on:manual every:3s', probeRegistry(probe))
    expect(probe.activates).toBe(0)

    await elapse(3000)
    expect(probe.activates).toBe(1)
    expect(probe.prepares).toBe(1)

    probe.finish()
    await elapse(3000)
    // A replay: the effect was torn down and installed again, then activated.
    expect(probe.activates).toBe(2)
    expect(probe.prepares).toBe(2)
    animator.destroy()
  })

  it('keeps one scheduler across replays: no new observer per tick', async () => {
    const probe = newProbe()
    const { animator } = mount('probe-effect on:manual every:3s', probeRegistry(probe))
    expect(watchers.all).toHaveLength(1)
    await elapse(3000)
    probe.finish()
    await elapse(3000)
    probe.finish()
    await elapse(3000)
    expect(probe.activates).toBe(3)
    expect(watchers.all).toHaveLength(1)
    animator.destroy()
  })

  it('skips a tick while the previous run is still going', async () => {
    const probe = newProbe()
    const { animator } = mount('probe-effect on:manual every:3s', probeRegistry(probe))
    await elapse(3000)
    expect(probe.activates).toBe(1)
    await elapse(9000)
    expect(probe.activates).toBe(1)
    animator.destroy()
  })

  it('calls a cycle hook instead of replaying, once the element has started', async () => {
    const probe = newProbe()
    const { animator } = mount('probe-effect on:manual every:3s', probeRegistry(probe, { cycle: () => probe.cycles++ }))
    await elapse(3000)
    // First tick only activates: a cycle needs the first snapshot to have been taken.
    expect([probe.activates, probe.cycles]).toEqual([1, 0])
    await elapse(3000)
    expect([probe.activates, probe.cycles, probe.prepares]).toEqual([1, 1, 1])
    probe.finish()
    await elapse(3000)
    // Finished, but a cycle-capable element still cycles; it is never reset.
    expect([probe.activates, probe.cycles, probe.prepares]).toEqual([1, 2, 1])
    animator.destroy()
  })

  it('isolates a cycle hook that throws and keeps ticking', async () => {
    const probe = newProbe()
    const { animator, reporter } = mount(
      'probe-effect on:manual every:3s',
      probeRegistry(probe, {
        cycle: () => {
          probe.cycles++
          throw new Error('boom')
        },
      }),
    )
    await elapse(3000)
    await elapse(3000)
    await elapse(3000)
    expect(probe.cycles).toBe(2)
    expect(reporter.messages.join('\n')).toContain('failed to cycle')
    animator.destroy()
  })

  it('fires kui:start per replay', async () => {
    const probe = newProbe()
    const { animator, host } = mount('probe-effect on:manual every:3s', probeRegistry(probe))
    const starts = vi.fn()
    host.addEventListener('kui:start', starts)
    await elapse(3000)
    probe.finish()
    await elapse(3000)
    expect(starts).toHaveBeenCalledTimes(2)
    animator.destroy()
  })
})

describe('every: gating', () => {
  async function ticksOver(configure: (host: HTMLElement) => void | (() => void)): Promise<number> {
    const probe = newProbe()
    const { animator, host } = mount('probe-effect on:manual every:3s', probeRegistry(probe))
    const restore = configure(host)
    await elapse(9000)
    const quiet = probe.activates
    restore?.()
    animator.destroy()
    return quiet
  }

  it('does not tick while offscreen, and re-arms a full period on return', async () => {
    const probe = newProbe()
    const { animator } = mount('probe-effect on:manual every:3s', probeRegistry(probe))
    watchers.all[0]!.report(false)
    await elapse(9000)
    expect(probe.activates).toBe(0)
    watchers.all[0]!.report(true)
    await elapse(2999)
    expect(probe.activates).toBe(0)
    await elapse(1)
    expect(probe.activates).toBe(1)
    animator.destroy()
  })

  it('does not tick in a hidden tab', async () => {
    const quiet = await ticksOver(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: true })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(quiet).toBe(0)
  })

  it('never arms under reduced motion', async () => {
    const probe = newProbe()
    const { animator } = mount('probe-effect on:manual every:3s', probeRegistry(probe), { reducedMotion: true })
    // Reduced motion runs the shortened effect immediately. Finish it so a stray tick could replay it.
    expect(probe.activates).toBe(1)
    probe.finish()
    await elapse(12000)
    expect(probe.activates).toBe(1)
    animator.destroy()
  })

  it('stops under a paused scope and resumes when it lifts', async () => {
    const probe = newProbe()
    const { animator, host } = mount('probe-effect on:manual every:3s', probeRegistry(probe))
    host.parentElement!.setAttribute(PAUSE_SCOPE_ATTR, '')
    announcePauseScope(document, host)
    await elapse(9000)
    expect(probe.activates).toBe(0)
    host.parentElement!.removeAttribute(PAUSE_SCOPE_ATTR)
    announcePauseScope(document, host)
    await elapse(3000)
    expect(probe.activates).toBe(1)
    animator.destroy()
  })

  it('does not pause for the pointer resting on it', async () => {
    const probe = newProbe()
    const { animator, host } = mount('probe-effect on:manual every:3s', probeRegistry(probe))
    host.dispatchEvent(new Event('pointerenter'))
    await elapse(3000)
    expect(probe.activates).toBe(1)
    animator.destroy()
  })
})

describe('every: period and grammar', () => {
  it('clamps a period under two seconds, with a warning', async () => {
    const probe = newProbe()
    const { animator, reporter } = mount('probe-effect on:manual every:1s', probeRegistry(probe))
    expect(reporter.messages.join('\n')).toContain('every: minimum is 2s')
    await elapse(1999)
    expect(probe.activates).toBe(0)
    await elapse(1)
    expect(probe.activates).toBe(1)
    animator.destroy()
  })

  it('refuses an unreadable period with a parse warning and starts nothing', () => {
    const probe = newProbe()
    const { animator, reporter } = mount('probe-effect on:manual every:abc', probeRegistry(probe))
    expect(reporter.messages.join('\n')).toContain('every:abc')
    expect(vi.getTimerCount()).toBe(0)
    animator.destroy()
  })

  it('refuses a scroll-driven element', () => {
    const probe = newProbe()
    const { animator, reporter } = mount('probe-effect timeline:view on:load every:3s', probeRegistry(probe))
    expect(reporter.messages.join('\n')).toContain('every: needs a clock timeline')
    expect(watchers.all).toHaveLength(0)
    animator.destroy()
  })

  it('refuses an element whose every effect never finishes', () => {
    const probe = newProbe()
    const { animator, reporter } = mount('probe-effect repeat:infinite on:manual every:3s', probeRegistry(probe))
    expect(reporter.messages.join('\n')).toContain('nothing to replay')
    expect(watchers.all).toHaveLength(0)
    animator.destroy()
  })

  it('warns when every: is written twice', () => {
    const probe = newProbe()
    const { animator, reporter } = mount('probe-effect on:manual every:3s every:4s', probeRegistry(probe))
    expect(reporter.messages.join('\n')).toContain('conflicting replay cadences')
    animator.destroy()
  })
})

describe('every: lifecycle', () => {
  it('releases the cadence when the attribute drops every:', async () => {
    const probe = newProbe()
    const { animator, host } = mount('probe-effect on:manual every:3s', probeRegistry(probe))
    host.setAttribute('data-kui', 'probe-effect on:manual')
    animator.process(host)
    await elapse(12000)
    expect(probe.activates).toBe(0)
    animator.destroy()
  })

  it('re-arms when the period is edited', async () => {
    const probe = newProbe()
    const { animator, host } = mount('probe-effect on:manual every:3s', probeRegistry(probe))
    host.setAttribute('data-kui', 'probe-effect on:manual every:6s')
    animator.process(host)
    await elapse(3000)
    expect(probe.activates).toBe(0)
    await elapse(3000)
    expect(probe.activates).toBe(1)
    animator.destroy()
  })

  it('destroy() releases every cadence', async () => {
    const probe = newProbe()
    const { animator } = mount('probe-effect on:manual every:3s', probeRegistry(probe))
    animator.destroy()
    await elapse(12000)
    expect(probe.activates).toBe(0)
  })
})
