/**
 * The self-start shared by every distributed browser bundle.
 *
 * ## Why this file imports nothing
 *
 * The npm/ESM path's guarantee is that importing kUInetic has no side effects — nothing is scanned
 * and the document is not touched until `.start()` is called (see `src/index.ts`'s doc comment and
 * `docs/design.md` §1a). That guarantee is for module consumers, and it still holds absolutely.
 *
 * The `<script src="...">` path has the opposite need: zero lines of JavaScript from the author.
 * Loading the file is the entire integration.
 *
 * Both come out of one source because **this module is not in the library's module graph**. It
 * imports nothing — not from `src/`, not from anywhere — and is reached only by
 * `scripts/build-tiers.mjs`, which bundles it separately and *appends* it to the IIFE outputs. No
 * ESM entry point references `src/browser/`, and nothing under `src/` imports this file, so the
 * side effect is not "tree-shaken away" from `dist/esm/*` — it is unreachable from it.
 * `scripts/verify-tiers.mjs` fails the build if that ever stops being true.
 *
 * Everything it needs, it reads off globals. Everything it is told, it is told through `boot()`'s
 * options by the one call line the build script appends after it.
 *
 * ## The handshake
 *
 * `window.__kuineticRuntime` is a plain data object on purpose. The bug this whole scheme exists to
 * route around is `instanceof` across two independently-bundled copies of the same class (see
 * `asRegistry` in `src/advanced/base.ts`), so nothing here is ever an instance of anything, and no
 * bundle ever tests another bundle's object against its own class.
 *
 * - **Core is the sole animator creator.** Tiers only queue a registration. A tier without core
 *   cannot do anything useful, so instead of half-working it names the missing tag in a warning.
 * - **The boot runs at `DOMContentLoaded`** (or immediately, if the document is already past
 *   parsing). Plain and `defer` script tags are all guaranteed to have executed by then, in any tag
 *   order — which is what makes tag order irrelevant by construction rather than by luck. No bundle
 *   reads a global at parse time and gives up, and nothing polls.
 * - The pre-JS cloak (`html[data-kui-cloak]` plus the `kui.cloak` layer, `src/css/base.css`) is
 *   pure CSS and covers the window between first paint and the boot, so deferring `start()` this
 *   far introduces no flash of un-animated content.
 *
 * ## Opt-out
 *
 * `data-kui-manual` on a bundle's own `<script>` tag means "this bundle does not auto-init". Put it
 * on every tag to get exactly the pre-auto-start behaviour back. Marking *core* manual necessarily
 * disables the whole chain, because core is the only thing that creates an animator — so a tier
 * that sees core go manual stays quiet rather than complaining that core is missing.
 */

/** Only what this file calls. Structural, because it cannot import the real types. */
interface AnimatorLike {
  start(): unknown
  scan(root?: ParentNode): unknown
  reset(el: Element): void
}

type Options = Record<string, unknown>

/** The IIFE namespace object a bundle built with `--global-name=kuinetic` exposes. */
interface CoreNamespace {
  kuinetic(options?: Options): AnimatorLike
}

interface TierRegistration {
  tier: string
  register: (animator: AnimatorLike) => unknown
}

interface Runtime {
  v: number
  animator: AnimatorLike | null
  pending: TierRegistration[]
  /** The boot has run at least once with an animator in hand. */
  booted: boolean
  /** `start()` has been called on the animator — by the boot, or by hand through the guard. */
  started: boolean
  /** Core's tag carried `data-kui-manual`, so nothing auto-inits. */
  manual: boolean
  scheduled: boolean
  warnedVersion: boolean
  warnedManual: boolean
}

export interface BootOptions {
  /** Names the bundle in warnings: `'core'`, `'advanced'`, `'3d'`. */
  tier: string
  /** Core passes its own IIFE namespace; a tier passes nothing. */
  core?: CoreNamespace | null
  /** The global the bundle was built under, so the double-animator guard can rebind it. */
  globalName?: string
  /** A tier passes its `registerX` function; core passes nothing. */
  register?: ((animator: AnimatorLike) => unknown) | null
}

const RUNTIME_KEY = '__kuineticRuntime'
const VERSION = 1

function globalScope(): Record<string, unknown> {
  return globalThis as unknown as Record<string, unknown>
}

function getRuntime(): Runtime {
  const scope = globalScope()
  const existing = scope[RUNTIME_KEY] as Runtime | undefined
  if (existing) return existing
  const created: Runtime = {
    v: VERSION,
    animator: null,
    pending: [],
    booted: false,
    started: false,
    manual: false,
    scheduled: false,
    warnedVersion: false,
    warnedManual: false,
  }
  scope[RUNTIME_KEY] = created
  return created
}

/**
 * `document.currentScript` is the script being executed *right now*, which is correct for classic,
 * `defer` and `async` tags alike — and it is the only way to read an attribute off one's own tag
 * without the author writing any JavaScript.
 */
function taggedManual(): boolean {
  const script = document.currentScript
  return !!script && (script as Element).hasAttribute('data-kui-manual')
}

function warn(message: string): void {
  if (typeof console !== 'undefined' && typeof console.warn === 'function') {
    console.warn(`kuinetic: ${message}`)
  }
}

/**
 * Mixed versions on one page — two different CDN pins, most likely. Worth saying out loud, never
 * worth hard-failing a page over: the runtime object is plain data and its shape has to stay
 * additive precisely so this stays a warning.
 */
function checkVersion(runtime: Runtime, tier: string): void {
  if (runtime.v === VERSION || runtime.warnedVersion) return
  runtime.warnedVersion = true
  warn(
    `the "${tier}" bundle expects runtime v${VERSION} but found v${runtime.v} on this page — ` +
      `the bundles are from different releases. Serve them all from the same version.`,
  )
}

/**
 * Replace the bundle's global with a flat copy whose factory is wrapped.
 *
 * It has to be a copy. esbuild's IIFE namespace object is built by `__toCommonJS`, whose properties
 * are getter-only and non-configurable, so `ns.kuinetic = wrapper` is a silent no-op at best and a
 * TypeError under the `"use strict"` esbuild puts at the top of the file. The global binding
 * itself, though, is an ordinary writable `var`, so rebinding it to a plain object carrying the
 * same own property names is both possible and observably identical — `verify-tiers.mjs` asserts
 * that key set has not drifted.
 */
function installGuard(runtime: Runtime, core: CoreNamespace, globalName?: string): void {
  if (!globalName) return
  const scope = globalScope()
  if (!(globalName in scope)) return

  const source = core as unknown as Record<string, unknown>
  const original = core.kuinetic
  const flat: Record<string, unknown> = {}
  for (const key of Object.getOwnPropertyNames(source)) flat[key] = source[key]

  const wrapped = (options?: Options): AnimatorLike => guarded(runtime, original, core, options)
  flat.kuinetic = wrapped
  // `export default kuinetic` lands on the namespace as `default`, and it is the same function, so
  // it has to go through the same guard or it becomes the way around it.
  if (source.default === original) flat.default = wrapped

  try {
    scope[globalName] = flat
  } catch {
    // A frozen or read-only global is not worth breaking a page over. The guard is a courtesy; the
    // auto-start above it has already happened either way.
  }
}

/**
 * The kind half of a breaking change.
 *
 * Before auto-start existed, the documented script-tag integration was a `<script>` tag followed by
 * the author's own `kuinetic.kuinetic({ observe: true }).start()`. That call now arrives when this
 * bundle has already made an animator, and two animators observing one document is a confusing,
 * silent mess: doubled instances, doubled observers, effects installed twice.
 *
 * The resolution turns on one fact: at the moment such an inline script runs — immediately after
 * the tag, before `DOMContentLoaded` — the auto-started animator **has not done anything yet**.
 * Nothing scanned, nothing observed, no state anywhere. So the author's call simply *becomes* the
 * animator, built with their exact options, and the boot starts theirs instead. That is not a
 * compromise: it reproduces, precisely, what the page did before auto-start existed, including a
 * custom `reporter`, a scoped `root`, or a registry of their own. Tiers still register into it,
 * because the runtime only ever knows about one animator, and their `.start()` makes the boot's a
 * no-op. All they get is one line telling them the call is now redundant.
 *
 * Only a call arriving *after* the document has been scanned is a genuine conflict, and only then
 * does this hand back the existing animator — for a call that asks for nothing, or for exactly the
 * `{ observe: true }` the boot already built, both of which are unambiguously the same request —
 * or build a real second one and say plainly that two are now live.
 */
function guarded(
  runtime: Runtime,
  original: (options?: Options) => AnimatorLike,
  core: CoreNamespace,
  options?: Options,
): AnimatorLike {
  if (!runtime.started) {
    const replacement = original.call(core, options)
    adopt(runtime, replacement)
    warnManualCall(
      runtime,
      'yours is now the one this page uses, exactly as it would have been before the script tag ' +
        'started one, so the call is safe to delete',
    )
    return replacement
  }

  const shared = runtime.animator
  // Values, not just key names. The boot built its animator with exactly `{ observe: true }`, so
  // that is the one option a call can name and still be asking for the same thing. `observe`
  // defaults to *false* (`shouldObserve` in `src/core/animator.ts`), which makes an explicit
  // `{ observe: false }` a request for the opposite of what the shared animator is — handing that
  // caller a `MutationObserver`-backed animator would be answering a different question.
  const wantsShared =
    !options || Object.entries(options).every(([key, value]) => key === 'observe' && value === true)
  if (shared && wantsShared) {
    warnManualCall(runtime, 'you have been handed the one it already made, so this call is safe to delete')
    return shared
  }
  warnManualCall(
    runtime,
    'a second animator is now observing the same document, because this call arrived after the ' +
      'page was scanned and named its own root/registry/reporter',
  )
  return original.call(core, options)
}

function warnManualCall(runtime: Runtime, consequence: string): void {
  if (runtime.warnedManual) return
  runtime.warnedManual = true
  warn(
    `an animator was created by hand, and the script tag had already started one — ${consequence}. ` +
      `To turn the auto-start off entirely, put data-kui-manual on the <script> tag.`,
  )
}

/**
 * Make `animator` the one animator this page has.
 *
 * The `start` wrapper is an own property on an object this file created or was handed, and it is
 * the only exact way to know whether the document has been scanned yet. That answer decides two
 * things: whether a tier registering later needs the `recompile` pass, and whether a hand-built
 * animator can simply take over (above).
 */
function adopt(runtime: Runtime, animator: AnimatorLike): void {
  const start = animator.start.bind(animator)
  animator.start = (): unknown => {
    runtime.started = true
    return start()
  }
  runtime.animator = animator
  globalScope().__kuinetic = animator
}

/**
 * Created at parse time, started at `DOMContentLoaded`. Constructing an `Animator` touches nothing
 * — that is `src/index.ts`'s own guarantee — so this is safe in `<head>`, and it is what keeps
 * `window.__kuinetic` readable by an inline script placed immediately after the tag, exactly as it
 * was when `kuinetic.all.js` self-started synchronously.
 */
function createAnimator(runtime: Runtime, core: CoreNamespace): void {
  adopt(runtime, core.kuinetic({ observe: true }))
}

function schedule(runtime: Runtime): void {
  if (document.readyState !== 'loading') {
    runBoot(runtime)
    return
  }
  if (runtime.scheduled) return
  runtime.scheduled = true
  document.addEventListener('DOMContentLoaded', () => runBoot(runtime), { once: true })
}

/**
 * An element whose effect name was unknown when the page was first scanned is not retried by
 * `scan()` alone: `Animator.process()` short-circuits on an unchanged configuration fingerprint, so
 * the element keeps the "unknown effect" answer forever. `reset()` is the public, documented way to
 * clear that ("tear an element's effects down so the next `process()` reinstalls from scratch") and
 * it returns immediately for an element it never tracked, so this is safe over the whole document.
 *
 * Only reached when the page was already scanned before a tier registered — an `async` tag, a tier
 * injected after load, or an author's own `.start()` sitting between two bundle tags. Honest cost:
 * animations already in flight restart.
 */
function recompile(animator: AnimatorLike): void {
  for (const el of document.querySelectorAll('[data-kui]')) animator.reset(el)
  animator.scan()
}

function resolveCore(): CoreNamespace | null {
  const candidate = globalScope().kuinetic as CoreNamespace | undefined
  return candidate && typeof candidate.kuinetic === 'function' ? candidate : null
}

/**
 * A tier reached the boot with no core on the page at all. Name the missing tag rather than fail
 * silently — this is the one arrangement that genuinely cannot work.
 */
function reportMissingCore(runtime: Runtime): void {
  const names = runtime.pending.map((entry) => `"${entry.tier}"`).join(', ')
  if (!names) return
  warn(
    `the ${names} tier bundle loaded but core did not — add ` +
      `<script src=".../kuinetic.min.js"></script> to the page (in any order).`,
  )
}

function drain(runtime: Runtime, animator: AnimatorLike): number {
  const pending = runtime.pending.splice(0, runtime.pending.length)
  for (const entry of pending) {
    try {
      entry.register(animator)
    } catch (error) {
      warn(`the "${entry.tier}" tier failed to register: ${String(error)}`)
    }
  }
  return pending.length
}

function runBoot(runtime: Runtime): void {
  if (runtime.manual) return
  if (!runtime.animator) {
    const core = resolveCore()
    if (core) createAnimator(runtime, core)
  }
  const animator = runtime.animator
  if (!animator) {
    reportMissingCore(runtime)
    return
  }

  const registered = drain(runtime, animator)
  runtime.booted = true

  if (!runtime.started) {
    animator.start()
    return
  }
  if (registered) recompile(animator)
}

/**
 * Core going manual disables the whole chain, because core is the only thing that creates an
 * animator; a tier going manual takes only itself out. Checked on the runtime rather than only on
 * this tag, so it holds whichever order the tags are in — a tier that already queued itself is
 * still called off by a core tag parsed after it.
 */
function optedOut(runtime: Runtime, options: BootOptions): boolean {
  if (taggedManual()) {
    if (options.core) runtime.manual = true
    return true
  }
  return runtime.manual
}

function enlist(runtime: Runtime, options: BootOptions): void {
  if (options.core) {
    if (runtime.animator) return
    createAnimator(runtime, options.core)
    installGuard(runtime, options.core, options.globalName)
    return
  }
  if (options.register) runtime.pending.push({ tier: options.tier, register: options.register })
}

/**
 * Called once per bundle, by the single line `scripts/build-tiers.mjs` appends after this file.
 */
export function boot(options: BootOptions): void {
  if (typeof document === 'undefined' || typeof globalThis === 'undefined') return

  const runtime = getRuntime()
  checkVersion(runtime, options.tier)
  if (optedOut(runtime, options)) return

  enlist(runtime, options)
  schedule(runtime)
}
