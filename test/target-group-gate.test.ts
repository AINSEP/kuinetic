// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { compile } from '../src/core/compile.js'
import type { CompiledTarget } from '../src/core/compile.js'
import { resolveConfig } from '../src/core/element-config.js'
import type { ElementAttributes } from '../src/core/element-config.js'
import { parse } from '../src/core/parse.js'
import { silentReporter } from '../src/core/reporter.js'
import type { InstanceState } from '../src/core/types.js'
import type { AnimatorPort, DerivedBook, DerivedInstallContext, LiveTargetGroup } from '../src/core/derived/types.js'
import { catalogRegistry } from './support/registry.js'
import { CAPS, fakeBinder } from './support/animator-harness.js'

/**
 * 3a (`stagger-keys.ts`) is being written in parallel by another phase agent, so `groupGateOwner`
 * is tested against a hand-built double rather than the real `isGroupedKeys`/`staggerKeysFor` —
 * real-shaped (same argument order, same "presence decides" contract) but independently
 * controlled, so this file never depends on 3a's own progress.
 */
vi.mock('../src/core/stagger-keys.js', () => ({
  elementStaggerKeys: vi.fn((parsed: unknown) => parsed),
  staggerKeysFor: vi.fn((scoped: unknown, elementWide: unknown) => scoped ?? elementWide),
  isGroupedKeys: vi.fn((keys: unknown) => keys !== undefined),
}))

const { groupGateOwner, skipsOwnBinding, bindGroups } = await import('../src/core/derived/group-gate.js')

const registry = catalogRegistry()

function attributes(overrides: Partial<ElementAttributes> = {}): ElementAttributes {
  return { source: '', on: null, timeline: null, threshold: null, ...overrides }
}

/** A live group compiled from a real `data-kui` source, the same recipe `style-plan.test.ts` uses,
 *  so `planStyles` inside `bindGroups` sees a realistic plan instead of a hand-built stub. */
function makeGroup(source: string, gateOwner: Element | undefined): LiveTargetGroup {
  const parsed = parse(source)
  const config = resolveConfig(attributes({ source }), parsed)
  const target: CompiledTarget = {
    selector: '.item',
    scope: 'self',
    specs: [],
    plan: compile(parsed, registry, config.timeline),
  }
  return { target, config, gateOwner, members: [] }
}

function fakeState(status: InstanceState['status']): InstanceState {
  return { status } as unknown as InstanceState
}

/**
 * `toEqual` compares DOM elements structurally, not by reference — two empty `<li>` elements are
 * indistinguishable to it, so an ordering or identity bug between structurally-identical members
 * would pass silently under `toEqual`. This asserts both length and per-index *identity* instead.
 */
function expectOrder(actual: Element[], ...expected: Element[]): void {
  expect(actual).toHaveLength(expected.length)
  expected.forEach((el, i) => expect(actual[i]).toBe(el))
}

interface Harness {
  port: AnimatorPort
  book: DerivedBook
  binder: ReturnType<typeof fakeBinder>
  activated: Element[]
  deactivated: Element[]
  states: Map<Element, InstanceState>
}

function makeHarness(): Harness {
  const binder = fakeBinder()
  const book: DerivedBook = {
    derived: new WeakMap(),
    hosts: new WeakMap(),
    groups: new WeakMap(),
    contexts: new WeakMap(),
    unions: new WeakMap(),
    cleanups: new WeakMap(),
  }
  const activated: Element[] = []
  const deactivated: Element[] = []
  const states = new Map<Element, InstanceState>()
  const port: AnimatorPort = {
    registry,
    reporter: silentReporter(),
    binder,
    capabilities: CAPS,
    respectReducedMotion: true,
    book,
    stateOf: (el) => states.get(el),
    install: vi.fn(),
    installAggregate: vi.fn(),
    resolveGroupMatches: vi.fn(() => []),
    resolveActivation: vi.fn((_el, config) => config.activation),
    release: vi.fn(),
    activateOne: (el) => activated.push(el),
    deactivateOne: (el) => deactivated.push(el),
    writeStatus: vi.fn(),
    emit: vi.fn(),
  }
  return { port, book, binder, activated, deactivated, states }
}

describe('groupGateOwner', () => {
  it('names the host when the group reads as grouped', () => {
    const host = document.createElement('div')
    const context: DerivedInstallContext = {
      host,
      fingerprint: 'fp',
      parsed: { specs: [], warnings: [] } as never,
      baseConfig: {} as never,
      timeline: 'time',
    }
    const target = { selector: '.item', scope: 'self', specs: [], plan: {} as never, hoists: { cascade: '90ms' } } as CompiledTarget
    expect(groupGateOwner({} as AnimatorPort, context, target)).toBe(host)
  })

  it('returns undefined when neither scope declares a grouped key', () => {
    const host = document.createElement('div')
    const context: DerivedInstallContext = {
      host,
      fingerprint: 'fp',
      parsed: undefined as never,
      baseConfig: {} as never,
      timeline: 'time',
    }
    const target = { selector: '.item', scope: 'self', specs: [], plan: {} as never } as CompiledTarget
    expect(groupGateOwner({} as AnimatorPort, context, target)).toBeUndefined()
  })
})

describe('skipsOwnBinding', () => {
  it('is true once a state carries a gateOwner', () => {
    expect(skipsOwnBinding({ gateOwner: document.createElement('div') } as unknown as InstanceState)).toBe(true)
  })

  it('is false for a state with no gateOwner', () => {
    expect(skipsOwnBinding({} as unknown as InstanceState)).toBe(false)
  })
})

describe('bindGroups', () => {
  let harness: Harness
  let host: Element

  beforeEach(() => {
    harness = makeHarness()
    host = document.createElement('div')
  })

  it('binds a grouped group whose style plan defers', () => {
    const group = makeGroup('fade-up', host)
    harness.book.groups.set(host, [group])
    bindGroups(harness.port, host)
    expect(harness.binder.bindings).toHaveLength(1)
    expect(harness.binder.bindings[0]?.el).toBe(host)
  })

  it('does nothing for a host with no book.groups entry at all', () => {
    // The real (only) caller, `finalizeInstall`, always sets `book.groups` for `host` first — this
    // guard is defensive, for a caller (or a future one) that reaches `bindGroups` without having
    // gone through it.
    expect(() => bindGroups(harness.port, host)).not.toThrow()
    expect(harness.binder.bindings).toHaveLength(0)
  })

  it('does not bind a group whose style plan does not defer (on:load runs immediately)', () => {
    const group = makeGroup('fade-up on:load', host)
    harness.book.groups.set(host, [group])
    bindGroups(harness.port, host)
    expect(harness.binder.bindings).toHaveLength(0)
  })

  it('does not bind a group this host does not own (ungrouped)', () => {
    const group = makeGroup('fade-up', undefined)
    harness.book.groups.set(host, [group])
    bindGroups(harness.port, host)
    expect(harness.binder.bindings).toHaveLength(0)
  })

  it('one-shot: activates only ready members on fire, skipping finished ones', () => {
    const group = makeGroup('fade-up', host) // default activation: enter — one-shot
    const ready = document.createElement('li')
    const finished = document.createElement('li')
    group.members.push(ready, finished)
    harness.states.set(ready, fakeState('ready'))
    harness.states.set(finished, fakeState('finished'))
    harness.book.groups.set(host, [group])

    bindGroups(harness.port, host)
    harness.binder.fire(host)

    expectOrder(harness.activated, ready)
  })

  it('toggle: activates every member regardless of status', () => {
    const group = makeGroup('fade-up on:click', host) // click is not one-shot
    const ready = document.createElement('li')
    const finished = document.createElement('li')
    group.members.push(ready, finished)
    harness.states.set(ready, fakeState('ready'))
    harness.states.set(finished, fakeState('finished'))
    harness.book.groups.set(host, [group])

    bindGroups(harness.port, host)
    harness.binder.fire(host)

    expectOrder(harness.activated, ready, finished)
  })

  it('deactivate reaches every member', () => {
    const group = makeGroup('fade-up on:enter/leave', host) // paired — not one-shot
    const a = document.createElement('li')
    const b = document.createElement('li')
    group.members.push(a, b)
    harness.book.groups.set(host, [group])

    const bindSpy = vi.spyOn(harness.binder, 'bind')
    bindGroups(harness.port, host)
    const request = bindSpy.mock.calls[0]?.[2]
    request?.deactivate?.()

    expectOrder(harness.deactivated, a, b)
  })

  it('reads group.members live: a member pushed after binding still fires', () => {
    const group = makeGroup('fade-up on:click', host)
    const first = document.createElement('li')
    group.members.push(first)
    harness.states.set(first, fakeState('ready'))
    harness.book.groups.set(host, [group])

    bindGroups(harness.port, host)

    const late = document.createElement('li')
    harness.states.set(late, fakeState('ready'))
    group.members.push(late) // Phase 6 would splice this in later

    harness.binder.fire(host)

    expectOrder(harness.activated, first, late)
  })

  it('registers a release that the fake binder counts as unbound', () => {
    const group = makeGroup('fade-up', host)
    harness.book.groups.set(host, [group])
    bindGroups(harness.port, host)

    const cleanups = harness.book.cleanups.get(host) ?? []
    expect(cleanups).toHaveLength(1)
    cleanups[0]?.()

    expect(harness.binder.unbound).toBe(1)
  })
})
