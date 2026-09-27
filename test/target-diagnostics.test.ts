// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { markUnmatched, warnNested3d, warnPageScopeCloak } from '../src/core/derived/diagnostics.js'
import type { AnimatorPort, DerivedBook } from '../src/core/derived/types.js'
import { createDerivedBook } from '../src/core/derived/book.js'
import { ATTR } from '../src/core/attrs.js'
import { compileTargets, type CompiledTarget } from '../src/core/compile.js'
import { parse } from '../src/core/parse.js'
import { createAttributeLedger, createLedgerSet } from '../src/core/owned-styles.js'
import { collectingReporter, type CollectingReporter } from '../src/core/reporter.js'
import type { InstanceState } from '../src/core/types.js'
import type { Registry } from '../src/core/registry.js'
import { CAPS, fakeBinder } from './support/animator-harness.js'
import { extendableRegistry } from './support/registry.js'

/**
 * A tiny catalog of its own rather than the real one: `warnNested3d`/`warnPageScopeCloak` react to
 * exactly two `Preset` fields (`establishes3d`, `cloak`), and asserting against real catalog names
 * (`flip-card`, `fold-panel`, …) would couple this suite to those names never changing meaning —
 * the `undelayable` fixture in `test/sequence.test.ts` is the existing precedent for this. One
 * shared primitive, three presets that isolate each field.
 */
function buildRegistry(): Registry {
  const registry = extendableRegistry()
  registry.registerPrimitive({
    id: 'fixture',
    renderer: 'css-keyframes',
    channels: ['rotate'],
    parameters: {},
    supportedTimelines: ['time'],
    supportedActivations: ['enter'],
    perfClass: 'compositor',
    reducedMotion: 'shorten',
  })
  registry.registerPreset({ name: 'fixture-3d', primitive: 'fixture', establishes3d: true })
  registry.registerPreset({ name: 'fixture-plain', primitive: 'fixture' })
  registry.registerPreset({ name: 'fixture-cloak', primitive: 'fixture', cloak: true })
  return registry
}

/** Compile `source` and return its one `target:` group — see `compile-targets.test.ts` for why a
 *  fully targeted source is exactly one `CompiledTarget`, not two. */
function targetFor(registry: Registry, source: string): CompiledTarget {
  const document = compileTargets(parse(source), registry, 'time')
  return document.targets.find((t) => t.selector !== '')!
}

/** A real, working `InstanceState` for `el`, with only the two fields `diagnostics.ts` reads
 *  (`fxNames`, `aggregate`) varying — everything else is a valid but inert fixture, built from the
 *  same `createLedgerSet` `animator.ts` itself uses so this is not a hand-rolled shape. */
function fakeState(el: Element, fxNames: string[], aggregate?: boolean): InstanceState {
  const ledgers = createLedgerSet(el)
  return {
    fingerprint: 'fixture',
    specs: [],
    activation: 'enter',
    timeline: 'time',
    fxNames,
    jsEffectNames: [],
    progressDriven: false,
    instances: [],
    ledger: ledgers.style(el),
    attributes: ledgers.attributes(el),
    ledgers,
    controller: new AbortController(),
    status: 'ready',
    aggregate,
  }
}

/** An `AnimatorPort` whose `registry`/`reporter`/`stateOf` are real and controllable, and whose
 *  other members throw if `diagnostics.ts` ever reaches for them — it shouldn't; none of the three
 *  functions under test install, activate, or bind anything. */
function fakePort(registry: Registry): {
  port: AnimatorPort
  reporter: CollectingReporter
  states: Map<Element, InstanceState>
  book: DerivedBook
} {
  const states = new Map<Element, InstanceState>()
  const reporter = collectingReporter()
  const book = createDerivedBook()
  const notUsed = (name: string) => (): never => {
    throw new Error(`fakePort: ${name} is not exercised by diagnostics.ts`)
  }
  const port: AnimatorPort = {
    registry,
    reporter,
    binder: fakeBinder(),
    capabilities: CAPS,
    respectReducedMotion: true,
    book,
    stateOf: (el) => states.get(el),
    install: notUsed('install'),
    installAggregate: notUsed('installAggregate'),
    resolveGroupMatches: notUsed('resolveGroupMatches'),
    resolveActivation: notUsed('resolveActivation'),
    release: notUsed('release'),
    activateOne: notUsed('activateOne'),
    deactivateOne: notUsed('deactivateOne'),
    writeStatus: notUsed('writeStatus'),
    emit: notUsed('emit'),
  }
  return { port, reporter, states, book }
}

describe('markUnmatched', () => {
  it('writes the joined selector list directly when the host has no ledger', () => {
    const host = document.createElement('div')
    markUnmatched(host, ['.a', '.b'])
    expect(host.getAttribute(ATTR.unmatched)).toBe('.a, .b')
  })

  it('removes a stale attribute directly when the list is empty and there is no ledger', () => {
    const host = document.createElement('div')
    host.setAttribute(ATTR.unmatched, '.stale')
    markUnmatched(host, [])
    expect(host.hasAttribute(ATTR.unmatched)).toBe(false)
  })

  it('writes through the ledger when given one, and restore() unwinds it', () => {
    const host = document.createElement('div')
    const ledger = createAttributeLedger(host)
    markUnmatched(host, ['h2'], ledger)
    expect(host.getAttribute(ATTR.unmatched)).toBe('h2')
    ledger.restore()
    expect(host.hasAttribute(ATTR.unmatched)).toBe(false)
  })

  it('never calls the ledger for an empty list — no empty attribute is ever written', () => {
    const host = document.createElement('div')
    const real = createAttributeLedger(host)
    const set = vi.fn(real.set)
    markUnmatched(host, [], { set, restore: real.restore })
    expect(set).not.toHaveBeenCalled()
    expect(host.hasAttribute(ATTR.unmatched)).toBe(false)
  })
})

describe('warnNested3d', () => {
  let registry: Registry
  beforeEach(() => {
    registry = buildRegistry()
  })

  it('warns when the host itself is already running a 3D-establishing effect', () => {
    const host = document.createElement('div')
    const match = document.createElement('div')
    host.appendChild(match)
    const { port, reporter, states } = fakePort(registry)
    states.set(host, fakeState(host, ['fixture-3d']))

    warnNested3d(port, host, match, targetFor(registry, 'fixture-3d target:div'))

    expect(reporter.messages).toHaveLength(1)
    expect(reporter.messages[0]).toContain('div')
    expect(reporter.messages[0]).toContain('nested inside')
  })

  it('does not warn when the match itself does not establish 3D', () => {
    const host = document.createElement('div')
    const match = document.createElement('div')
    host.appendChild(match)
    const { port, reporter, states } = fakePort(registry)
    states.set(host, fakeState(host, ['fixture-3d']))

    warnNested3d(port, host, match, targetFor(registry, 'fixture-plain target:div'))

    expect(reporter.messages).toHaveLength(0)
  })

  it('does not warn when nothing around the match is live and 3D', () => {
    const host = document.createElement('div')
    const match = document.createElement('div')
    host.appendChild(match)
    const { port, reporter } = fakePort(registry)
    // host has no state at all — an ordinary host with only derived matches installed so far.

    warnNested3d(port, host, match, targetFor(registry, 'fixture-3d target:div'))

    expect(reporter.messages).toHaveLength(0)
  })

  it('skips an aggregate host state — its fxNames mirror its own matches, not a real nesting', () => {
    const host = document.createElement('div')
    const match = document.createElement('div')
    host.appendChild(match)
    const { port, reporter, states } = fakePort(registry)
    // An aggregate host's fxNames is the union of every group it aggregates — including this very
    // match's group — so without the aggregate skip this would report the match nested inside
    // itself (2a's documented self-match false positive).
    states.set(host, fakeState(host, ['fixture-3d'], true))

    warnNested3d(port, host, match, targetFor(registry, 'fixture-3d target:div'))

    expect(reporter.messages).toHaveLength(0)
  })

  it('walks past the host to a live 3D ancestor further up the DOM', () => {
    const host = document.createElement('div')
    const wrapper = document.createElement('section')
    const match = document.createElement('div')
    host.appendChild(wrapper)
    wrapper.appendChild(match)
    const { port, reporter, states } = fakePort(registry)
    states.set(wrapper, fakeState(wrapper, ['fixture-3d']))

    warnNested3d(port, host, match, targetFor(registry, 'fixture-3d target:div'))

    expect(reporter.messages).toHaveLength(1)
    expect(reporter.messages[0]).toContain('section')
  })

  it('gives up beyond its ancestor-walk bound', () => {
    const host = document.createElement('div')
    const match = document.createElement('div')
    const { port, reporter, states } = fakePort(registry)
    // A live 3D ancestor placed two levels above the walk's bound (64): build 66 wrapper elements
    // between host and match, put the offending state on the one closest to host (element 1 of 66,
    // 65 hops from match) so it sits outside the checked range even though it IS a real ancestor.
    let current: Element = host
    const wrappers: Element[] = []
    for (let i = 0; i < 66; i++) {
      const wrapper = document.createElement('div')
      current.appendChild(wrapper)
      wrappers.push(wrapper)
      current = wrapper
    }
    current.appendChild(match)
    states.set(wrappers[1]!, fakeState(wrappers[1]!, ['fixture-3d']))

    warnNested3d(port, host, match, targetFor(registry, 'fixture-3d target:div'))

    expect(reporter.messages).toHaveLength(0)
  })
})

describe('warnPageScopeCloak', () => {
  let registry: Registry
  beforeEach(() => {
    registry = buildRegistry()
    document.documentElement.removeAttribute(ATTR.cloak)
  })

  it('warns for a cloaked scope:page group while <html data-kui-cloak> is present', () => {
    document.documentElement.setAttribute(ATTR.cloak, '')
    const host = document.createElement('div')
    const { port, reporter } = fakePort(registry)

    warnPageScopeCloak(port, host, targetFor(registry, 'fixture-cloak target:.foo scope:page'))

    expect(reporter.messages).toHaveLength(1)
    expect(reporter.messages[0]).toContain('scope:page')
    expect(reporter.messages[0]).toContain('scope:self')
  })

  it('does not warn for a scope:self group, even when cloaked and <html> is cloaking', () => {
    document.documentElement.setAttribute(ATTR.cloak, '')
    const host = document.createElement('div')
    const { port, reporter } = fakePort(registry)

    warnPageScopeCloak(port, host, targetFor(registry, 'fixture-cloak target:.foo'))

    expect(reporter.messages).toHaveLength(0)
  })

  it('does not warn when the scope:page group carries no cloaked preset', () => {
    document.documentElement.setAttribute(ATTR.cloak, '')
    const host = document.createElement('div')
    const { port, reporter } = fakePort(registry)

    warnPageScopeCloak(port, host, targetFor(registry, 'fixture-plain target:.foo scope:page'))

    expect(reporter.messages).toHaveLength(0)
  })

  it('does not warn when <html> is not cloaking', () => {
    const host = document.createElement('div')
    const { port, reporter } = fakePort(registry)

    warnPageScopeCloak(port, host, targetFor(registry, 'fixture-cloak target:.foo scope:page'))

    expect(reporter.messages).toHaveLength(0)
  })
})
