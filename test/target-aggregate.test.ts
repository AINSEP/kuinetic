// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { bindCallback } from '../src/core/callback.js'
import { compileTargets } from '../src/core/compile.js'
import type { CompiledTarget } from '../src/core/compile.js'
import { emitLifecycle, KUI_EVENT } from '../src/core/control.js'
import { createLedgerSet } from '../src/core/owned-styles.js'
import { collectingReporter } from '../src/core/reporter.js'
import type { EffectSpec, InstanceState } from '../src/core/types.js'
import { compileUnion, syncAggregate } from '../src/core/derived/aggregate.js'
import { createDerivedBook } from '../src/core/derived/book.js'
import type { AnimatorPort, DerivedInstallContext } from '../src/core/derived/types.js'
import { CAPS, fakeBinder } from './support/animator-harness.js'
import { catalogRegistry } from './support/registry.js'

/**
 * Phase 2b: an aggregate host's `data-kui-state` (D-A, `syncAggregate`) and multi-group union
 * compilation (`compileUnion`). Both take an `AnimatorPort`, so they are driven directly against a
 * hand-built fake rather than through a real `Animator` — the fake's `writeStatus`/`emit` do the
 * same work the real ones do (a status write; a real bubbling DOM event), so assertions read the
 * DOM the way a listener would rather than inspecting the fake's internals.
 */

function makeState(el: Element, overrides: Partial<InstanceState> = {}): InstanceState {
  const ledgers = createLedgerSet(el)
  return {
    fingerprint: 'fp',
    specs: [],
    activation: 'enter',
    timeline: 'time',
    fxNames: [],
    jsEffectNames: [],
    progressDriven: false,
    instances: [],
    ledger: ledgers.style(el),
    attributes: ledgers.attributes(el),
    ledgers,
    controller: new AbortController(),
    status: 'ready',
    ...overrides,
  }
}

function makePort(): {
  port: AnimatorPort
  states: Map<Element, InstanceState>
  reporter: ReturnType<typeof collectingReporter>
} {
  const states = new Map<Element, InstanceState>()
  const reporter = collectingReporter()
  const port: AnimatorPort = {
    registry: catalogRegistry(),
    reporter,
    binder: fakeBinder(),
    capabilities: CAPS,
    respectReducedMotion: true,
    book: createDerivedBook(),
    stateOf: (el) => states.get(el),
    install: () => {},
    installAggregate: () => {},
    resolveGroupMatches: () => [],
    resolveActivation: () => 'enter',
    release: () => {},
    activateOne: () => {},
    deactivateOne: () => {},
    writeStatus: (_el, state, next) => {
      state.status = next
    },
    emit: (el, state, type, reason) => {
      emitLifecycle(el, type, {
        effects: state.fxNames,
        activation: state.activation,
        timeline: state.timeline,
        reason,
        ...(state.host ? { host: state.host } : {}),
      })
    },
  }
  return { port, states, reporter }
}

describe('syncAggregate', () => {
  function setup() {
    const { port, states, reporter } = makePort()
    const host = document.createElement('div')
    return { port, states, reporter, host }
  }

  /** One derived match, appended under `host` so a real `kui:*` event bubbles through it. */
  function match(host: Element, states: Map<Element, InstanceState>, overrides: Partial<InstanceState>): Element {
    const el = document.createElement('li')
    host.append(el)
    states.set(el, makeState(el, overrides))
    return el
  }

  function fires(host: Element, type: string): string[] {
    const seen: string[] = []
    host.addEventListener(type, () => seen.push(type))
    return seen
  }

  it('is a no-op when the host has no known state at all', () => {
    const { port, host } = setup()
    expect(() => syncAggregate(port, host)).not.toThrow()
  })

  it('is a no-op for a host whose state is not an aggregate', () => {
    const { port, states, host } = setup()
    const hostState = makeState(host, { status: 'ready' })
    states.set(host, hostState)
    syncAggregate(port, host)
    expect(hostState.status).toBe('ready')
  })

  it('leaves an aggregate host unchanged with no known derived states', () => {
    const { port, states, host } = setup()
    const hostState = makeState(host, { status: 'running', aggregate: true })
    states.set(host, hostState)
    syncAggregate(port, host)
    expect(hostState.status).toBe('running')
  })

  it('any running derived -> host running, kui:start when a match is entering forward', () => {
    const { port, states, host } = setup()
    const hostState = makeState(host, { status: 'ready', aggregate: true })
    states.set(host, hostState)
    const li = match(host, states, { status: 'running', direction: 'forward' })
    port.book.derived.set(host, new Set([li]))
    const starts = fires(host, KUI_EVENT.start)

    syncAggregate(port, host)

    expect(hostState.status).toBe('running')
    expect(starts).toEqual([KUI_EVENT.start])
  })

  it('does not emit kui:start when the only running derived is reversing', () => {
    const { port, states, host } = setup()
    const hostState = makeState(host, { status: 'ready', aggregate: true })
    states.set(host, hostState)
    const li = match(host, states, { status: 'running', direction: 'reverse' })
    port.book.derived.set(host, new Set([li]))
    const starts = fires(host, KUI_EVENT.start)

    syncAggregate(port, host)

    expect(hostState.status).toBe('running')
    expect(starts).toEqual([])
  })

  it('is idempotent while a match keeps running: a second call does not re-emit kui:start', () => {
    const { port, states, host } = setup()
    const hostState = makeState(host, { status: 'ready', aggregate: true })
    states.set(host, hostState)
    const li = match(host, states, { status: 'running', direction: 'forward' })
    port.book.derived.set(host, new Set([li]))
    const starts = fires(host, KUI_EVENT.start)

    syncAggregate(port, host)
    syncAggregate(port, host)

    expect(starts).toEqual([KUI_EVENT.start])
  })

  it('every derived failed -> host failed, no event', () => {
    const { port, states, host } = setup()
    const hostState = makeState(host, { status: 'ready', aggregate: true })
    states.set(host, hostState)
    const a = match(host, states, { status: 'failed' })
    const b = match(host, states, { status: 'failed' })
    port.book.derived.set(host, new Set([a, b]))
    const starts = fires(host, KUI_EVENT.start)
    const finishes = fires(host, KUI_EVENT.finish)

    syncAggregate(port, host)

    expect(hostState.status).toBe('failed')
    expect(starts).toEqual([])
    expect(finishes).toEqual([])
  })

  it('every derived settled (mixed finished/failed) -> host finished, reason complete when it was running', () => {
    const { port, states, host } = setup()
    const hostState = makeState(host, { status: 'running', aggregate: true })
    states.set(host, hostState)
    const a = match(host, states, { status: 'finished' })
    const b = match(host, states, { status: 'failed' })
    port.book.derived.set(host, new Set([a, b]))
    let reason: string | undefined
    host.addEventListener(KUI_EVENT.finish, (event) => {
      reason = (event as CustomEvent).detail.reason
    })

    syncAggregate(port, host)

    expect(hostState.status).toBe('finished')
    expect(reason).toBe('complete')
  })

  it('reports reduced-motion when the host had never run', () => {
    const { port, states, host } = setup()
    const hostState = makeState(host, { status: 'ready', aggregate: true })
    states.set(host, hostState)
    const a = match(host, states, { status: 'finished' })
    port.book.derived.set(host, new Set([a]))
    let reason: string | undefined
    host.addEventListener(KUI_EVENT.finish, (event) => {
      reason = (event as CustomEvent).detail.reason
    })

    syncAggregate(port, host)

    expect(hostState.status).toBe('finished')
    expect(reason).toBe('reduced-motion')
  })

  it('suppresses kui:finish when every derived was cancelled, but still settles the host', () => {
    const { port, states, host } = setup()
    const hostState = makeState(host, { status: 'running', aggregate: true })
    states.set(host, hostState)
    const a = match(host, states, { status: 'finished', cancelled: true })
    const b = match(host, states, { status: 'failed', cancelled: true })
    port.book.derived.set(host, new Set([a, b]))
    const finishes = fires(host, KUI_EVENT.finish)

    syncAggregate(port, host)

    expect(hostState.status).toBe('finished')
    expect(finishes).toEqual([])
  })

  it('is idempotent once finished: a second call does not re-emit kui:finish', () => {
    const { port, states, host } = setup()
    const hostState = makeState(host, { status: 'running', aggregate: true })
    states.set(host, hostState)
    const a = match(host, states, { status: 'finished' })
    port.book.derived.set(host, new Set([a]))
    const finishes = fires(host, KUI_EVENT.finish)

    syncAggregate(port, host)
    syncAggregate(port, host)

    expect(finishes).toEqual([KUI_EVENT.finish])
  })

  it('every derived ready -> host ready, no event', () => {
    const { port, states, host } = setup()
    const hostState = makeState(host, { status: 'running', aggregate: true })
    states.set(host, hostState)
    const a = match(host, states, { status: 'ready' })
    const b = match(host, states, { status: 'ready' })
    port.book.derived.set(host, new Set([a, b]))
    const finishes = fires(host, KUI_EVENT.finish)

    syncAggregate(port, host)

    expect(hostState.status).toBe('ready')
    expect(finishes).toEqual([])
  })

  it('a mixed set that is neither all-running, all-settled nor all-ready leaves the host unchanged', () => {
    const { port, states, host } = setup()
    const hostState = makeState(host, { status: 'running', aggregate: true })
    states.set(host, hostState)
    const a = match(host, states, { status: 'finished' })
    const b = match(host, states, { status: 'ready' })
    port.book.derived.set(host, new Set([a, b]))
    const events = [...fires(host, KUI_EVENT.start), ...fires(host, KUI_EVENT.finish)]

    syncAggregate(port, host)

    expect(hostState.status).toBe('running')
    expect(events).toEqual([])
  })
})

describe('syncAggregate x func: — one host-level kui:finish is one callback call', () => {
  it('does not double-fire func: when a derived match\'s own kui:finish bubbles through the host', () => {
    const { port, states } = makePort()
    const host = document.createElement('div')
    const hostState = makeState(host, { status: 'running', aggregate: true })
    states.set(host, hostState)
    const li = document.createElement('li')
    host.append(li)
    states.set(li, makeState(li, { status: 'finished' }))
    port.book.derived.set(host, new Set([li]))

    const controller = new AbortController()
    const calls: Element[] = []
    const globals = window as unknown as Record<string, unknown>
    globals.__kuiAggregateFuncTest = (event: Event) => {
      calls.push(event.target as Element)
    }
    bindCallback({ el: host, name: '__kuiAggregateFuncTest', reporter: port.reporter, signal: controller.signal })

    // The match's own finish, dispatched exactly as `Animator.settleWhen` would on the match
    // itself — it bubbles through `host` on its way up the tree.
    emitLifecycle(li, KUI_EVENT.finish, { effects: [], activation: 'enter', timeline: 'time', reason: 'complete', host })
    // The host's own aggregate finish, from `syncAggregate` — targeted at `host` directly.
    syncAggregate(port, host)

    expect(calls).toEqual([host])
    controller.abort()
    delete globals.__kuiAggregateFuncTest
  })
})

describe('compileUnion', () => {
  const registry = catalogRegistry()

  function group(spec: Partial<EffectSpec> & { name: string }): CompiledTarget {
    return compileTargets(
      { specs: [{ params: {}, ...spec }], warnings: [] },
      registry,
      'time',
    ).targets[0]!
  }

  function setup() {
    const { port, states, reporter } = makePort()
    const host = document.createElement('div')
    const context: DerivedInstallContext = {
      host,
      fingerprint: 'fp',
      parsed: { specs: [], warnings: [] },
      baseConfig: { activation: 'enter', activationAuthored: false, timeline: 'time', range: '', threshold: '0' },
      timeline: 'time',
    }
    return { port, states, reporter, host, context }
  }

  it('recompiles the concatenated specs as one target', () => {
    const { port, context } = setup()
    const a = group({ name: 'fade-up' })
    const b = group({ name: 'count-up' })

    const union = compileUnion(port, context, [a, b])

    expect([...union.plan.fxNames].sort((a, b) => a.localeCompare(b))).toEqual(['count-up', 'fade-up'])
  })

  it("restores plan.reducedMotion from the first claiming group, not the recompile's own", () => {
    const { port, context } = setup()
    const a = group({ name: 'fade-up' })
    // A sentinel a fresh compile of fade-up+blur-in would never itself produce, so a match here
    // can only mean the value was copied from `a`, not recomputed.
    a.plan.reducedMotion = 'disable'
    const b = group({ name: 'blur-in' })

    const union = compileUnion(port, context, [a, b])

    expect(union.plan.reducedMotion).toBe('disable')
  })

  it('re-filters plan.jsEffects through the current viewport gate', () => {
    const { port, context } = setup()
    const original = window.matchMedia
    // `above:md` never satisfied — every JS effect carrying it must be dropped from the union.
    window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as unknown as typeof window.matchMedia
    try {
      const a = group({ name: 'count-up', gate: { above: 'md' } })
      // Sanity: a lone compile never gates at compile time — `process()` would have done that.
      expect(a.plan.jsEffects).toHaveLength(1)
      const b = group({ name: 'fade-up' })

      const union = compileUnion(port, context, [a, b])

      expect(union.plan.jsEffects).toHaveLength(0)
    } finally {
      window.matchMedia = original
    }
  })

  it('keeps a gated jsEffect when the host\'s document has no view to test the gate against', () => {
    // `document.implementation.createHTMLDocument()` has no `defaultView` at all (see
    // `callback.test.ts`'s own use of the same fixture) — `compileUnion`'s `context.host
    // .ownerDocument?.defaultView ?? undefined` chain exists for exactly this case, which every
    // other test in this file never reaches: `setup()`'s `host` is a live-document element, whose
    // `ownerDocument.defaultView` is always the real `window`, attached to the tree or not.
    const { port, context } = setup()
    const inert = document.implementation.createHTMLDocument()
    expect(inert.defaultView).toBeNull()
    context.host = inert.createElement('div')

    const a = group({ name: 'count-up', gate: { above: 'md' } })
    const b = group({ name: 'fade-up' })

    // `gateMatches` fails open with no `matchMedia` to ask, so the gated effect survives rather
    // than being silently dropped for a viewport this union has no way to measure.
    const union = compileUnion(port, context, [a, b])

    expect(union.plan.jsEffects).toHaveLength(1)
  })

  it('reports a union-only composition warning against the host, once', () => {
    const { port, reporter, context } = setup()
    const a = group({ name: 'fade-up' })
    const b = group({ name: 'slide-left' })
    const conflict = '"fade-up" and "slide-left" both animate translate'
    expect(a.plan.warnings.some((w) => w.includes(conflict))).toBe(false)
    expect(b.plan.warnings.some((w) => w.includes(conflict))).toBe(false)

    const union = compileUnion(port, context, [a, b])

    expect(union.plan.warnings.some((w) => w.includes(conflict))).toBe(true)
    const reported = reporter.messages.filter((m) => m.includes(conflict))
    expect(reported).toHaveLength(1)
  })

  it('does not re-report a warning a claiming group already carried', () => {
    // Per-entry, not per-composition, so it reads back identically whatever else is unioned in —
    // unlike a channel conflict, whose "Dropped …" list names every entry in the recompile and so
    // can never come back byte-identical once a second group adds a third spec to it.
    const { port, reporter, context } = setup()
    const a = group({ name: 'fade-up', params: { bogus: 'x' } })
    const warning = a.plan.warnings.find((w) => w.startsWith('unknown parameter "bogus"'))
    expect(warning).toBeDefined()
    const b = group({ name: 'count-up' })

    compileUnion(port, context, [a, b])

    expect(reporter.messages.filter((m) => m === warning)).toHaveLength(0)
  })

  it("returns the first claiming group's selector and scope, never the recompile's own", () => {
    const { port, context } = setup()
    const a = group({ name: 'fade-up' })
    a.selector = '.card'
    a.scope = 'page'
    const b = group({ name: 'count-up' })

    const union = compileUnion(port, context, [a, b])

    expect(union.selector).toBe('.card')
    expect(union.scope).toBe('page')
  })

  it('caches the compiled union per host, order-independently, and reports warnings only once', () => {
    const { port, reporter, context, host } = setup()
    const a = group({ name: 'fade-up' })
    a.selector = '.a'
    const b = group({ name: 'slide-left' })
    b.selector = '.b'

    const first = compileUnion(port, context, [a, b])
    const second = compileUnion(port, context, [b, a])

    expect(second).toBe(first)
    expect(port.book.unions.get(host)?.size).toBe(1)
    const conflict = '"fade-up" and "slide-left" both animate translate'
    expect(reporter.messages.filter((m) => m.includes(conflict))).toHaveLength(1)
  })
})
