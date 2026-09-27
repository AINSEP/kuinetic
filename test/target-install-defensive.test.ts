// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import type { CompiledTarget } from '../src/core/compile.js'
import type { AnimatorPort, DerivedBook } from '../src/core/derived/types.js'
import { installDerivedMatches, releaseDerived, restageTargets } from '../src/core/derived/install.js'

/**
 * `install.ts`'s exported functions each open with a guard against a `book` that does not match
 * the shape the module's own internal callers always hand it — `restageTargets` against a host
 * with no live derived-host bookkeeping at all, `releaseDerived` against a `book.hosts`/`book`
 * pairing that is out of sync. Every internal caller keeps `book.hosts`/`book.groups`/
 * `book.derived`/`book.cleanups` in lockstep, so none of today's call sites can produce the states
 * exercised below — but the guards are on the module's exported surface, not private helpers, so a
 * caller outside this module (a test, or a future one) can. This file builds exactly the
 * inconsistent `book` each guard defends against and confirms it degrades to a no-op rather than
 * throwing.
 */

function makeBook(): DerivedBook {
  return {
    derived: new WeakMap(),
    hosts: new WeakMap(),
    groups: new WeakMap(),
    contexts: new WeakMap(),
    unions: new WeakMap(),
    cleanups: new WeakMap(),
  }
}

function makePort(book: DerivedBook, overrides: Partial<AnimatorPort> = {}): AnimatorPort {
  return {
    registry: {} as never,
    reporter: { warn: vi.fn(), error: vi.fn() } as never,
    binder: {} as never,
    capabilities: {} as never,
    respectReducedMotion: true,
    book,
    stateOf: () => undefined,
    install: vi.fn(),
    installAggregate: vi.fn(),
    resolveGroupMatches: vi.fn(() => []),
    resolveActivation: vi.fn(),
    release: vi.fn(),
    activateOne: vi.fn(),
    deactivateOne: vi.fn(),
    writeStatus: vi.fn(),
    emit: vi.fn(),
    ...overrides,
  }
}

function makeTarget(selector: string): CompiledTarget {
  return { selector, scope: 'self', specs: [], plan: { fxNames: [] } as never }
}

describe('restageTargets against a non-host element', () => {
  it('does nothing for an element with no live derived-host bookkeeping at all', () => {
    const book = makeBook()
    const port = makePort(book)
    const plain = document.createElement('div')

    expect(() => restageTargets(port, plain)).not.toThrow()
  })
})

describe('releaseDerived against an inconsistent book', () => {
  it('unclaims a match whose host has no live groups entry, without throwing', () => {
    const book = makeBook()
    const host = document.createElement('div')
    const match = document.createElement('p')
    // `book.hosts` claims `match` for `host`, but `host` was never given a `book.groups` entry —
    // every real caller sets both together (`installWithTargets`); this is the state
    // `releaseMatch`'s own defensive read guards against.
    book.hosts.set(match, host)
    const port = makePort(book)

    expect(() => releaseDerived(port, match)).not.toThrow()
    expect(book.hosts.has(match)).toBe(false)
  })

  it('releases a host with a live matches entry but no recorded cleanups, without throwing', () => {
    const book = makeBook()
    const host = document.createElement('div')
    const match = document.createElement('p')
    // `book.derived.has(host)` is what routes `releaseDerived` into the host branch; a real install
    // always pairs it with at least one `registerCleanup` call in the same `finalizeInstall` pass,
    // so `book.cleanups` never actually goes missing here — this constructs that gap directly.
    book.derived.set(host, new Set([match]))
    const port = makePort(book)

    expect(() => releaseDerived(port, host)).not.toThrow()
    expect(book.derived.has(host)).toBe(false)
  })

  it('releases a host whose own matches entry is present but empty of any real value, without throwing', () => {
    const book = makeBook()
    const host = document.createElement('div')
    // `has()` true with `get()` returning `undefined` is impossible through `Set`-typed writes —
    // every real caller only ever stores an actual `Set` — but `WeakMap.set` itself does not
    // enforce that, so a caller that skips this module's own writers entirely can still produce it.
    // The cast mirrors that: it is the shape `releaseHost`'s own `?? []` defends, not a shape any
    // internal caller produces today.
    book.derived.set(host, undefined as unknown as Set<Element>)
    const port = makePort(book)

    expect(() => releaseDerived(port, host)).not.toThrow()
    expect(book.derived.has(host)).toBe(false)
  })
})

describe('installDerivedMatches against a host with no live groups entry', () => {
  it('records the claimed match without updating any group membership, without throwing', () => {
    const book = makeBook()
    const host = document.createElement('div')
    const match = document.createElement('p')
    const target = makeTarget('.item')
    const port = makePort(book)
    const context = {
      host,
      fingerprint: 'fp',
      parsed: {} as never,
      baseConfig: {} as never,
      timeline: 'time' as never,
    }
    const claims = new Map([[match, [target]]])

    // No `book.groups.set(host, ...)` — `recordClaim`'s own membership loop reads it with a
    // fallback for exactly this reason.
    expect(() => installDerivedMatches(port, context, claims)).not.toThrow()
    expect(book.hosts.get(match)).toBe(host)
  })
})
