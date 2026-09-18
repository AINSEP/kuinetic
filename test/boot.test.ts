import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import { boot } from '../src/browser/boot.js'
import type { BootOptions } from '../src/browser/boot.js'

/**
 * The self-start appended to every `<script src>` bundle (`src/browser/boot.ts`).
 *
 * `scripts/verify-tiers.mjs` already drives the *built* bundles through jsdom, which is the only
 * place tag order, `document.currentScript` and two independently-bundled copies of one class are
 * real. It is not part of `vitest run` because it needs `dist/`. This file is the other half: it
 * calls `boot()` directly with the exact option shapes `scripts/build-tiers.mjs` appends —
 *
 *   core:     boot({ tier: 'core', core: <ns>, globalName: 'kuinetic' })
 *   advanced: boot({ tier: 'advanced', register: <ns>.registerAdvanced })
 *
 * — so the arrangements that are awkward to stage as real files (a mixed-version page, a frozen
 * global, a tier whose `register` throws) are reachable, and the handshake's decisions are pinned
 * one at a time rather than only in aggregate.
 *
 * Importing boot.ts here does not put it in the library's module graph: `verify-tiers.mjs` proves
 * the ESM output is clean by grepping `dist/esm/**` for `__kuineticRuntime`, and `test/` is not
 * bundled into `dist/`. Nothing under `src/` may import this module, and nothing here does.
 */

type FakeAnimator = {
  options: Record<string, unknown> | undefined
  /** Kept separately because `adopt()` replaces `animator.start` with its own wrapper. */
  startSpy: Mock
  start: () => unknown
  scan: Mock
  reset: Mock
}

const scope = globalThis as unknown as Record<string, unknown>

function fakeAnimator(options?: Record<string, unknown>): FakeAnimator {
  const startSpy = vi.fn(() => 'started')
  return { options, startSpy, start: startSpy, scan: vi.fn(), reset: vi.fn() }
}

/**
 * esbuild's IIFE namespace object, faithfully: `__export` defines every entry as a getter-only,
 * non-configurable property. That is the whole reason `installGuard` copies rather than patches,
 * so the fake has to be able to refuse a patch the way the real one does.
 */
function namespace(entries: Record<string, unknown>): Record<string, unknown> {
  const ns: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(entries)) {
    Object.defineProperty(ns, key, { get: () => value, enumerable: true })
  }
  return ns
}

type FakeCore = {
  ns: Record<string, unknown>
  /** Every animator the factory has handed out, in order. */
  made: FakeAnimator[]
}

/** A core bundle's namespace, with `kuinetic` and the `default` alias esbuild also emits. */
function fakeCore(extra: Record<string, unknown> = {}): FakeCore {
  const made: FakeAnimator[] = []
  const factory = (options?: Record<string, unknown>): FakeAnimator => {
    const animator = fakeAnimator(options)
    made.push(animator)
    return animator
  }
  return { ns: namespace({ kuinetic: factory, default: factory, ...extra }), made }
}

function coreOptions(core: FakeCore, globalName: string | undefined = 'kuinetic'): BootOptions {
  return { tier: 'core', core: core.ns, globalName } as unknown as BootOptions
}

function tierOptions(tier: string, register: (animator: unknown) => unknown): BootOptions {
  return { tier, register } as unknown as BootOptions
}

/** The global the guard rebinds — what an author's inline `kuinetic.kuinetic(...)` would reach. */
function globalApi(): { kuinetic: (options?: Record<string, unknown>) => FakeAnimator } {
  return scope.kuinetic as { kuinetic: (options?: Record<string, unknown>) => FakeAnimator }
}

function adopted(): FakeAnimator | undefined {
  return scope.__kuinetic as FakeAnimator | undefined
}

function runtime(): Record<string, unknown> {
  return scope.__kuineticRuntime as Record<string, unknown>
}

function setReadyState(state: DocumentReadyState): void {
  Object.defineProperty(document, 'readyState', { value: state, configurable: true })
}

/** What `document.currentScript` returns while a bundle's own tag is executing. */
function setCurrentScript(manual: boolean | null): void {
  let script: HTMLScriptElement | null = null
  if (manual !== null) {
    script = document.createElement('script')
    if (manual) script.setAttribute('data-kui-manual', '')
  }
  Object.defineProperty(document, 'currentScript', { value: script, configurable: true })
}

function domContentLoaded(): void {
  document.dispatchEvent(new Event('DOMContentLoaded'))
}

let warnSpy: Mock

function warnings(): string[] {
  return warnSpy.mock.calls.map((call) => String(call[0]))
}

beforeEach(() => {
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {}) as unknown as Mock
  setReadyState('complete')
  setCurrentScript(null)
  document.body.innerHTML = ''
})

afterEach(() => {
  vi.unstubAllGlobals()
  // Flush any `DOMContentLoaded` listener a test deliberately left scheduled, so it cannot fire
  // against the next test's runtime.
  setReadyState('complete')
  domContentLoaded()
  delete (document as unknown as Record<string, unknown>).readyState
  delete (document as unknown as Record<string, unknown>).currentScript
  delete scope.__kuineticRuntime
  delete scope.__kuinetic
  delete scope.kuinetic
  vi.restoreAllMocks()
})

describe('the environments boot() declines to run in', () => {
  it('does nothing at all without a document', () => {
    const core = fakeCore()
    vi.stubGlobal('document', undefined)

    boot(coreOptions(core))

    expect(core.made).toHaveLength(0)
    expect(scope.__kuineticRuntime).toBeUndefined()
  })

  it('does nothing at all without a global scope', () => {
    const core = fakeCore()
    // Not `vi.stubGlobal`: while `globalThis` is undefined every free reference to it in the realm
    // resolves to `undefined`, vitest's own included, so the restore cannot go through anything
    // that looks it up by name. `realScope` is a captured local, and `boot()` is synchronous.
    const realScope = globalThis
    const descriptor = Object.getOwnPropertyDescriptor(realScope, 'globalThis')
    Object.defineProperty(realScope, 'globalThis', { value: undefined, writable: true, configurable: true })
    try {
      boot(coreOptions(core))
    } finally {
      Object.defineProperty(realScope, 'globalThis', descriptor ?? { value: realScope, writable: true, configurable: true })
    }

    expect(core.made).toHaveLength(0)
    expect(scope.__kuineticRuntime).toBeUndefined()
  })
})

describe('core is the sole animator creator', () => {
  it('creates one observing animator at parse time and starts it at DOMContentLoaded', () => {
    setReadyState('loading')
    const core = fakeCore()
    scope.kuinetic = core.ns

    boot(coreOptions(core))

    // Constructing touches nothing, so it happens synchronously — that is what keeps
    // `window.__kuinetic` readable by an inline script sitting right after the tag.
    expect(core.made).toHaveLength(1)
    expect(core.made[0]!.options).toEqual({ observe: true })
    expect(adopted()).toBe(core.made[0])
    expect(core.made[0]!.startSpy).not.toHaveBeenCalled()

    domContentLoaded()

    expect(core.made[0]!.startSpy).toHaveBeenCalledTimes(1)
    expect(runtime().booted).toBe(true)
    expect(runtime().started).toBe(true)
    expect(warnings()).toEqual([])
  })

  it('boots immediately when the document is already past parsing', () => {
    const core = fakeCore()
    scope.kuinetic = core.ns

    boot(coreOptions(core))

    expect(core.made[0]!.startSpy).toHaveBeenCalledTimes(1)
  })

  it('a second core tag does not create a second animator', () => {
    const core = fakeCore()
    scope.kuinetic = core.ns

    boot(coreOptions(core))
    boot(coreOptions(core))

    expect(core.made).toHaveLength(1)
    expect(core.made[0]!.startSpy).toHaveBeenCalledTimes(1)
  })

  it('the shared runtime is plain data, never an instance of anything', () => {
    const core = fakeCore()
    scope.kuinetic = core.ns

    boot(coreOptions(core))

    // The bug the whole scheme routes around is `instanceof` across two independently-bundled
    // copies of one class, so nothing on the handshake may be an instance of anything.
    expect(Object.getPrototypeOf(runtime())).toBe(Object.prototype)
    expect(runtime().v).toBe(1)
  })

  it('a bundle that contributes neither core nor a registration stays silent', () => {
    boot({ tier: 'mystery' } as unknown as BootOptions)

    expect(adopted()).toBeUndefined()
    expect(warnings()).toEqual([])
  })
})

describe('tag order is irrelevant by construction', () => {
  it('registers a tier that loaded before core', () => {
    setReadyState('loading')
    const core = fakeCore()
    const register = vi.fn()

    boot(tierOptions('advanced', register))
    scope.kuinetic = core.ns
    boot(coreOptions(core))
    domContentLoaded()

    expect(register).toHaveBeenCalledTimes(1)
    expect(register).toHaveBeenCalledWith(core.made[0])
    expect(core.made[0]!.startSpy).toHaveBeenCalledTimes(1)
    expect(warnings()).toEqual([])
  })

  it('registers a tier that loaded after core', () => {
    setReadyState('loading')
    const core = fakeCore()
    const register = vi.fn()
    scope.kuinetic = core.ns

    boot(coreOptions(core))
    boot(tierOptions('advanced', register))
    domContentLoaded()

    expect(register).toHaveBeenCalledWith(core.made[0])
    // Two tags, one scheduled boot: the second `schedule()` sees `scheduled` already set.
    expect(core.made[0]!.startSpy).toHaveBeenCalledTimes(1)
  })

  it('drains every queued tier into the one animator', () => {
    setReadyState('loading')
    const core = fakeCore()
    const first = vi.fn()
    const second = vi.fn()

    boot(tierOptions('advanced', first))
    boot(tierOptions('3d', second))
    scope.kuinetic = core.ns
    boot(coreOptions(core))
    domContentLoaded()

    expect(first).toHaveBeenCalledWith(core.made[0])
    expect(second).toHaveBeenCalledWith(core.made[0])
    expect(core.made).toHaveLength(1)
  })

  it('a tier with no core on the page names the missing tag', () => {
    boot(tierOptions('advanced', vi.fn()))

    const [message] = warnings()
    expect(message).toContain('"advanced"')
    expect(message).toContain('kuinetic.min.js')
  })

  it('names every waiting tier in that one warning', () => {
    setReadyState('loading')

    boot(tierOptions('advanced', vi.fn()))
    boot(tierOptions('3d', vi.fn()))
    domContentLoaded()

    expect(warnings()[0]).toContain('"advanced", "3d"')
  })

  it('adopts a core global that is present even though core never booted', () => {
    // An older core bundle, from before the self-start existed: the global is there, but no
    // `boot()` call ever ran for it. The tier's boot finds it rather than declaring core missing.
    const core = fakeCore()
    scope.kuinetic = core.ns
    const register = vi.fn()

    boot(tierOptions('advanced', register))

    expect(core.made).toHaveLength(1)
    expect(register).toHaveBeenCalledWith(core.made[0])
    expect(warnings()).toEqual([])
  })

  it('ignores a `kuinetic` global that is not a core namespace', () => {
    scope.kuinetic = { somethingElse: true }

    boot(tierOptions('advanced', vi.fn()))

    expect(warnings()[0]).toContain('core did not')
  })
})

describe('data-kui-manual', () => {
  it('on core, disables the whole chain', () => {
    const core = fakeCore()
    scope.kuinetic = core.ns
    setCurrentScript(true)

    boot(coreOptions(core))

    expect(core.made).toHaveLength(0)
    expect(adopted()).toBeUndefined()
    expect(scope.kuinetic).toBe(core.ns)
    expect(warnings()).toEqual([])
  })

  it('on a tier, takes only that tier out', () => {
    const core = fakeCore()
    scope.kuinetic = core.ns
    const register = vi.fn()

    setCurrentScript(true)
    boot(tierOptions('advanced', register))
    setCurrentScript(false)
    boot(coreOptions(core))

    expect(register).not.toHaveBeenCalled()
    expect(core.made[0]!.startSpy).toHaveBeenCalledTimes(1)
  })

  it('keeps a tier quiet about core when core is the one that opted out', () => {
    // Core goes manual *after* the tier queued itself, and the boot was already scheduled. The
    // tier has nothing to attach to, but core is not missing — so nothing is said.
    setReadyState('loading')
    const core = fakeCore()
    scope.kuinetic = core.ns
    const register = vi.fn()

    boot(tierOptions('advanced', register))
    setCurrentScript(true)
    boot(coreOptions(core))
    domContentLoaded()

    expect(core.made).toHaveLength(0)
    expect(register).not.toHaveBeenCalled()
    expect(warnings()).toEqual([])
  })

  it('stays off for a tier tag parsed after core went manual', () => {
    const core = fakeCore()
    scope.kuinetic = core.ns
    const register = vi.fn()

    setCurrentScript(true)
    boot(coreOptions(core))
    setCurrentScript(null)
    boot(tierOptions('advanced', register))

    expect(register).not.toHaveBeenCalled()
    expect(adopted()).toBeUndefined()
    expect(warnings()).toEqual([])
  })
})

describe('version skew', () => {
  it('warns once, naming the tier and both versions, and still boots', () => {
    scope.__kuineticRuntime = {
      v: 99,
      animator: null,
      pending: [],
      booted: false,
      started: false,
      manual: false,
      scheduled: false,
      warnedVersion: false,
      warnedManual: false,
    }
    const core = fakeCore()
    scope.kuinetic = core.ns

    boot(coreOptions(core))
    boot(tierOptions('advanced', vi.fn()))

    expect(warnings()).toHaveLength(1)
    expect(warnings()[0]).toContain('"core"')
    expect(warnings()[0]).toContain('v1')
    expect(warnings()[0]).toContain('v99')
    // A warning, never a hard failure: the page still gets its animator.
    expect(core.made).toHaveLength(1)
  })
})

describe('the double-animator guard', () => {
  it('rebinds the global to a complete flat copy, because the namespace cannot be patched', () => {
    const core = fakeCore({ consoleReporter: () => {} })
    scope.kuinetic = core.ns

    // The premise: esbuild's namespace properties are getter-only and non-configurable.
    expect(() => {
      ;(core.ns as Record<string, unknown>).kuinetic = () => {}
    }).toThrow()

    boot(coreOptions(core))

    expect(scope.kuinetic).not.toBe(core.ns)
    expect(new Set(Object.keys(scope.kuinetic as object))).toEqual(
      new Set(Object.getOwnPropertyNames(core.ns)),
    )
    const api = globalApi() as unknown as Record<string, unknown>
    expect(typeof api.kuinetic).toBe('function')
    // `export default kuinetic` lands on the namespace too, and it is the same function — it has
    // to go through the same guard or it becomes the way around it.
    expect(api.default).toBe(api.kuinetic)
  })

  it('leaves `default` alone when it is not the factory', () => {
    const core = fakeCore()
    const plain = namespace({ kuinetic: (core.ns as Record<string, unknown>).kuinetic })
    scope.kuinetic = plain

    boot({ tier: 'core', core: plain, globalName: 'kuinetic' } as unknown as BootOptions)

    expect('default' in (scope.kuinetic as object)).toBe(false)
  })

  it('does not rebind anything when the bundle names no global', () => {
    const core = fakeCore()
    scope.kuinetic = core.ns

    boot({ tier: 'core', core: core.ns } as unknown as BootOptions)

    expect(scope.kuinetic).toBe(core.ns)
    expect(core.made[0]!.startSpy).toHaveBeenCalledTimes(1)
  })

  it('does not invent a global the bundle never defined', () => {
    const core = fakeCore()

    boot(coreOptions(core, 'kuineticMissing'))

    expect('kuineticMissing' in scope).toBe(false)
    expect(core.made[0]!.startSpy).toHaveBeenCalledTimes(1)
  })

  it('survives a read-only global rather than breaking the page', () => {
    const core = fakeCore()
    Object.defineProperty(scope, 'kuinetic', { value: core.ns, writable: false, configurable: true })

    expect(() => boot(coreOptions(core))).not.toThrow()

    expect(scope.kuinetic).toBe(core.ns)
    // The guard is a courtesy; the auto-start above it happened either way.
    expect(core.made[0]!.startSpy).toHaveBeenCalledTimes(1)
  })

  it('lets a hand-built animator take over wholesale before the scan', () => {
    setReadyState('loading')
    const core = fakeCore()
    scope.kuinetic = core.ns
    boot(coreOptions(core))

    const mine = globalApi().kuinetic({ observe: true, reporter: 'mine' })

    // Nothing had been scanned yet, so the author's options win outright — reporter and all.
    expect(mine).not.toBe(core.made[0])
    expect(mine.options).toEqual({ observe: true, reporter: 'mine' })
    expect(adopted()).toBe(mine)
    expect(warnings()[0]).toContain('data-kui-manual')

    domContentLoaded()

    // The boot starts theirs, and never starts the one it made.
    expect(mine.startSpy).toHaveBeenCalledTimes(1)
    expect(core.made[0]!.startSpy).not.toHaveBeenCalled()
  })

  it('folds a tier into the adopted animator, not the abandoned one', () => {
    setReadyState('loading')
    const core = fakeCore()
    scope.kuinetic = core.ns
    const register = vi.fn()

    boot(coreOptions(core))
    const mine = globalApi().kuinetic({ observe: true })
    boot(tierOptions('advanced', register))
    domContentLoaded()

    expect(register).toHaveBeenCalledWith(mine)
  })

  it('hands back the existing animator for an option-free call after the scan', () => {
    const core = fakeCore()
    scope.kuinetic = core.ns
    boot(coreOptions(core))

    expect(globalApi().kuinetic()).toBe(core.made[0])
    expect(globalApi().kuinetic({})).toBe(core.made[0])
    // `{ observe: true }` is what the boot already asked for, so it is the same unambiguous intent.
    expect(globalApi().kuinetic({ observe: true })).toBe(core.made[0])
    expect(core.made).toHaveLength(1)
    expect(warnings()[0]).toContain('already made')
  })

  it('gives an explicit `{ observe: false }` its own animator, not the observing one', () => {
    // Regression. `wantsShared` used to look at option *names* only, so this call was handed the
    // animator the boot had built with `{ observe: true }` — the exact opposite of the request.
    // `observe` defaults to false (`shouldObserve`, src/core/animator.ts), so it is only ever
    // written down when its value is the whole point of writing it.
    const core = fakeCore()
    scope.kuinetic = core.ns
    boot(coreOptions(core))

    const mine = globalApi().kuinetic({ observe: false })

    expect(mine).not.toBe(core.made[0])
    expect(mine.options).toEqual({ observe: false })
    expect(core.made).toHaveLength(2)
    expect(warnings()[0]).toContain('a second animator')
  })

  it('still adopts an `{ observe: false }` call made before the scan', () => {
    // The value only decides the *post-scan* branch. Before anything has been scanned there is no
    // conflict to resolve, so the author's animator becomes the page's one, options and all —
    // including a non-observing one, which is precisely what the page did before auto-start.
    setReadyState('loading')
    const core = fakeCore()
    scope.kuinetic = core.ns
    boot(coreOptions(core))

    const mine = globalApi().kuinetic({ observe: false })

    expect(adopted()).toBe(mine)
    expect(mine.options).toEqual({ observe: false })
    expect(core.made).toHaveLength(2)

    domContentLoaded()

    expect(mine.startSpy).toHaveBeenCalledTimes(1)
    expect(core.made[0]!.startSpy).not.toHaveBeenCalled()
  })

  it('builds a genuine second animator for a call that names its own root', () => {
    const core = fakeCore()
    scope.kuinetic = core.ns
    boot(coreOptions(core))

    const second = globalApi().kuinetic({ root: document.body })

    expect(second).not.toBe(core.made[0])
    expect(core.made).toHaveLength(2)
    expect(warnings()[0]).toContain('a second animator')
  })

  it('says it once, however many times it happens', () => {
    const core = fakeCore()
    scope.kuinetic = core.ns
    boot(coreOptions(core))

    globalApi().kuinetic({ root: document.body })
    globalApi().kuinetic({ root: document.body })
    globalApi().kuinetic()

    expect(warnings()).toHaveLength(1)
  })

  it('builds a fresh animator if the runtime has been started but holds none', () => {
    // Defensive: the runtime is plain data shared across independently-bundled copies, so a
    // started runtime without an animator is a shape another bundle could hand this one.
    const core = fakeCore()
    scope.kuinetic = core.ns
    boot(coreOptions(core))
    runtime().animator = null

    const built = globalApi().kuinetic()

    expect(built).toBe(core.made[1])
    expect(warnings()[0]).toContain('a second animator')
  })
})

describe('a tier that registers after the document was scanned', () => {
  it('resets and rescans, so elements compiled without it are not left stale', () => {
    setReadyState('loading')
    document.body.innerHTML = '<div data-kui="fade-up"></div><div data-kui="particle-dissolve"></div>'
    const core = fakeCore()
    scope.kuinetic = core.ns

    boot(coreOptions(core))
    // The author's own `.start()`, sitting between the two bundle tags.
    const mine = globalApi().kuinetic({ observe: true })
    mine.start()
    boot(tierOptions('advanced', vi.fn()))
    domContentLoaded()

    expect(mine.reset).toHaveBeenCalledTimes(2)
    expect(mine.scan).toHaveBeenCalledTimes(1)
    // Its own `start()` already ran; the boot does not start it a second time.
    expect(mine.startSpy).toHaveBeenCalledTimes(1)
  })

  it('does not pay for a recompile when nothing registered late', () => {
    setReadyState('loading')
    document.body.innerHTML = '<div data-kui="fade-up"></div>'
    const core = fakeCore()
    scope.kuinetic = core.ns

    boot(coreOptions(core))
    const mine = globalApi().kuinetic({ observe: true })
    mine.start()
    domContentLoaded()

    expect(mine.reset).not.toHaveBeenCalled()
    expect(mine.scan).not.toHaveBeenCalled()
  })

  it('names a tier whose registration throws, and registers the rest anyway', () => {
    setReadyState('loading')
    const core = fakeCore()
    scope.kuinetic = core.ns
    const survivor = vi.fn()

    boot(
      tierOptions('advanced', () => {
        throw new Error('boom')
      }),
    )
    boot(tierOptions('3d', survivor))
    boot(coreOptions(core))
    domContentLoaded()

    expect(warnings()[0]).toContain('"advanced" tier failed to register')
    expect(warnings()[0]).toContain('boom')
    expect(survivor).toHaveBeenCalledWith(core.made[0])
    expect(core.made[0]!.startSpy).toHaveBeenCalledTimes(1)
  })
})

describe('warning on a page with no usable console', () => {
  it('stays silent rather than throwing when there is no console', () => {
    vi.stubGlobal('console', undefined)

    expect(() => boot(tierOptions('advanced', vi.fn()))).not.toThrow()
  })

  it('stays silent rather than throwing when console.warn is not callable', () => {
    vi.stubGlobal('console', { warn: 'not a function' })

    expect(() => boot(tierOptions('advanced', vi.fn()))).not.toThrow()
  })
})
