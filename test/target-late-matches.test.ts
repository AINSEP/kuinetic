// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CompiledTarget } from '../src/core/compile.js'
import type { AnimatorPort, DerivedBook, DerivedInstallContext, LiveTargetGroup, ResolvedGroup } from '../src/core/derived/types.js'
import type { InstanceState } from '../src/core/types.js'

/**
 * 2a's `claimMatches`/`installDerivedMatches`/`restageTargets` (`src/core/derived/install.ts`) are
 * real, already-tested logic (`target-derived.test.ts`). This file mocks them with small,
 * real-shaped doubles that reproduce the one behaviour phase 6's own logic depends on —
 * `installDerivedMatches` appends a claimed match onto its claiming group's `members`, exactly
 * like `install.ts`'s own `recordClaim` — so this suite exercises only phase 6's own logic: the
 * ancestor walk, the `ATTR.part` skip, which matches ever reach `claimMatches` at all, the
 * document-order reinsertion, and the already-fired immediate activation.
 */
const claimMatchesMock = vi.fn((_port: AnimatorPort, _host: Element, resolved: ResolvedGroup[]) => {
  const claims = new Map<Element, CompiledTarget[]>()
  for (const group of resolved) {
    for (const match of group.matches) claims.set(match, [group.target])
  }
  return claims
})
const installDerivedMatchesMock = vi.fn((port: AnimatorPort, context: DerivedInstallContext, claims: Map<Element, CompiledTarget[]>) => {
  const groups = port.book.groups.get(context.host) ?? []
  const installed: Element[] = []
  for (const [match, targets] of claims) {
    for (const target of targets) {
      groups.find((group) => group.target === target)?.members.push(match)
    }
    installed.push(match)
  }
  return installed
})
const restageTargetsMock = vi.fn()

vi.mock('../src/core/derived/install.js', () => ({
  claimMatches: (...args: Parameters<typeof claimMatchesMock>) => claimMatchesMock(...args),
  installDerivedMatches: (...args: Parameters<typeof installDerivedMatchesMock>) => installDerivedMatchesMock(...args),
  restageTargets: (...args: Parameters<typeof restageTargetsMock>) => restageTargetsMock(...args),
}))

const { adoptLateMatches } = await import('../src/core/derived/late-matches.js')
const { ATTR } = await import('../src/core/attrs.js')

function makeTarget(selector: string, scope: 'self' | 'page' = 'self'): CompiledTarget {
  return { selector, scope, specs: [], plan: { fxNames: [] } as never }
}

function makeGroup(target: CompiledTarget, gateOwner: Element | undefined, members: Element[] = []): LiveTargetGroup {
  return { target, config: {} as never, gateOwner, members }
}

function makeContext(host: Element): DerivedInstallContext {
  return { host, fingerprint: 'fp', parsed: {} as never, baseConfig: {} as never, timeline: 'time' as never }
}

interface Harness {
  port: AnimatorPort
  book: DerivedBook
  activated: Element[]
  states: Map<Element, InstanceState>
}

function makeHarness(): Harness {
  const book: DerivedBook = {
    derived: new WeakMap(),
    hosts: new WeakMap(),
    groups: new WeakMap(),
    contexts: new WeakMap(),
    unions: new WeakMap(),
    cleanups: new WeakMap(),
  }
  const activated: Element[] = []
  const states = new Map<Element, InstanceState>()
  const port: AnimatorPort = {
    registry: {} as never,
    reporter: { warn: vi.fn(), error: vi.fn() } as never,
    binder: {} as never,
    capabilities: {} as never,
    respectReducedMotion: true,
    book,
    stateOf: (el) => states.get(el),
    install: vi.fn(),
    installAggregate: vi.fn(),
    resolveGroupMatches: vi.fn(() => []),
    resolveActivation: vi.fn(),
    release: vi.fn(),
    activateOne: (el) => activated.push(el),
    deactivateOne: vi.fn(),
    writeStatus: vi.fn(),
    emit: vi.fn(),
  }
  return { port, book, activated, states }
}

function item(): Element {
  const el = document.createElement('div')
  el.className = 'item'
  return el
}

/**
 * `toEqual` compares DOM elements structurally, not by reference — two empty `<div class="item">`
 * elements are indistinguishable to it, so an ordering bug between structurally-identical elements
 * would pass silently under `toEqual`. This asserts both length and per-index *identity* instead.
 */
function expectOrder(actual: Element[], ...expected: Element[]): void {
  expect(actual).toHaveLength(expected.length)
  expected.forEach((el, i) => expect(actual[i]).toBe(el))
}

describe('adoptLateMatches', () => {
  let harness: Harness
  let host: Element

  beforeEach(() => {
    vi.clearAllMocks()
    harness = makeHarness()
    host = document.createElement('div')
  })

  it('adopts a newly-inserted descendant into a live scope:self group', () => {
    const target = makeTarget('.item')
    const group = makeGroup(target, undefined)
    harness.book.groups.set(host, [group])
    harness.book.contexts.set(host, makeContext(host))

    const child = item()
    host.appendChild(child)

    adoptLateMatches(harness.port, child)

    expect(claimMatchesMock).toHaveBeenCalledWith(harness.port, host, [{ target, matches: [child] }])
    expectOrder(group.members, child)
    expect(restageTargetsMock).toHaveBeenCalledWith(harness.port, host)
  })

  it('ignores a scope:page group entirely (not even offered to claimMatches)', () => {
    const target = makeTarget('.item', 'page')
    const group = makeGroup(target, undefined)
    harness.book.groups.set(host, [group])
    harness.book.contexts.set(host, makeContext(host))

    const child = item()
    host.appendChild(child)

    adoptLateMatches(harness.port, child)

    expect(claimMatchesMock).not.toHaveBeenCalled()
    expect(group.members).toEqual([])
    expect(restageTargetsMock).not.toHaveBeenCalled()
  })

  it('only ever queries the inserted subtree — a pre-existing match elsewhere in the host is left alone', () => {
    const target = makeTarget('.item')
    const existing = item()
    host.appendChild(existing)
    const group = makeGroup(target, undefined, [existing])
    harness.book.groups.set(host, [group])
    harness.book.contexts.set(host, makeContext(host))

    const sibling = document.createElement('div') // does not match '.item', no matching descendants
    host.appendChild(sibling)

    adoptLateMatches(harness.port, sibling)

    expect(claimMatchesMock).not.toHaveBeenCalled()
    expectOrder(group.members, existing)
  })

  it('stops at the ancestor-walk bound: a host exactly 64 ancestors up is never reached', () => {
    const target = makeTarget('.item')
    const group = makeGroup(target, undefined)
    harness.book.groups.set(host, [group])
    harness.book.contexts.set(host, makeContext(host))

    let current: Element = host
    for (let i = 0; i < 64; i++) {
      const wrapper = document.createElement('div')
      current.appendChild(wrapper)
      current = wrapper
    }
    const child = item()
    current.appendChild(child)

    adoptLateMatches(harness.port, child)

    expect(group.members).toEqual([])
  })

  it('within the bound: a host 63 ancestors up is still reached', () => {
    const target = makeTarget('.item')
    const group = makeGroup(target, undefined)
    harness.book.groups.set(host, [group])
    harness.book.contexts.set(host, makeContext(host))

    let current: Element = host
    for (let i = 0; i < 63; i++) {
      const wrapper = document.createElement('div')
      current.appendChild(wrapper)
      current = wrapper
    }
    const child = item()
    current.appendChild(child)

    adoptLateMatches(harness.port, child)

    expectOrder(group.members, child)
  })

  it('never adopts the inserted node itself when it carries ATTR.part', () => {
    const target = makeTarget('.item')
    const group = makeGroup(target, undefined)
    harness.book.groups.set(host, [group])
    harness.book.contexts.set(host, makeContext(host))

    const injected = item()
    injected.setAttribute(ATTR.part, 'control')
    host.appendChild(injected)

    adoptLateMatches(harness.port, injected)

    expect(claimMatchesMock).not.toHaveBeenCalled()
    expect(group.members).toEqual([])
  })

  it('excludes a matching descendant that carries ATTR.part, even when the inserted node itself does not', () => {
    const target = makeTarget('.item')
    const group = makeGroup(target, undefined)
    harness.book.groups.set(host, [group])
    harness.book.contexts.set(host, makeContext(host))

    const wrapper = document.createElement('div') // not itself a match, no ATTR.part
    const partChild = item()
    partChild.setAttribute(ATTR.part, 'control')
    wrapper.appendChild(partChild)
    host.appendChild(wrapper)

    adoptLateMatches(harness.port, wrapper)

    expect(claimMatchesMock).not.toHaveBeenCalled()
    expect(group.members).toEqual([])
  })

  it('splices a late match into its correct document-order position', () => {
    const target = makeTarget('.item')
    const first = item()
    const last = item()
    host.appendChild(first)
    host.appendChild(last)
    const group = makeGroup(target, undefined, [first, last])
    harness.book.groups.set(host, [group])
    harness.book.contexts.set(host, makeContext(host))

    const middle = item()
    host.insertBefore(middle, last)

    adoptLateMatches(harness.port, middle)

    expectOrder(group.members, first, middle, last)
  })

  it('activates a new member immediately when the grouped binding already fired (a sibling is not ready)', () => {
    const target = makeTarget('.item')
    const finished = item()
    host.appendChild(finished)
    const group = makeGroup(target, host, [finished]) // gateOwner === host: grouped
    harness.book.groups.set(host, [group])
    harness.book.contexts.set(host, makeContext(host))
    harness.states.set(finished, { status: 'finished' } as InstanceState)

    const late = item()
    host.appendChild(late)

    adoptLateMatches(harness.port, late)

    expectOrder(harness.activated, late)
  })

  it('does not activate a new member when every sibling is still ready', () => {
    const target = makeTarget('.item')
    const ready = item()
    host.appendChild(ready)
    const group = makeGroup(target, host, [ready]) // gateOwner === host: grouped
    harness.book.groups.set(host, [group])
    harness.book.contexts.set(host, makeContext(host))
    harness.states.set(ready, { status: 'ready' } as InstanceState)

    const late = item()
    host.appendChild(late)

    adoptLateMatches(harness.port, late)

    expect(harness.activated).toEqual([])
  })

  it('never immediately activates for an ungrouped group, even with a non-ready sibling', () => {
    const target = makeTarget('.item')
    const finished = item()
    host.appendChild(finished)
    const group = makeGroup(target, undefined, [finished]) // gateOwner undefined: ungrouped
    harness.book.groups.set(host, [group])
    harness.book.contexts.set(host, makeContext(host))
    harness.states.set(finished, { status: 'finished' } as InstanceState)

    const late = item()
    host.appendChild(late)

    adoptLateMatches(harness.port, late)

    expect(harness.activated).toEqual([])
  })

  it('is a no-op for a plain DOM ancestor that is not a target: host', () => {
    const child = item()
    host.appendChild(child)

    expect(() => adoptLateMatches(harness.port, child)).not.toThrow()
    expect(claimMatchesMock).not.toHaveBeenCalled()
    expect(installDerivedMatchesMock).not.toHaveBeenCalled()
    expect(restageTargetsMock).not.toHaveBeenCalled()
  })
})
