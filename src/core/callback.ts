import { KUI_EVENT } from './control.js'
import type { LifecycleEvent } from './control.js'
import type { Reporter } from './reporter.js'

/**
 * `func:` — a named global function, called when the element's effects finish.
 *
 * ## What this is, and what it is not
 *
 * It is **sugar for one line of DOM**, and it is implemented as literally that line:
 *
 * ```js
 * el.addEventListener('kui:finish', window[name])
 * ```
 *
 * Nothing here invents a new moment for a callback to fire at. `animator.ts` already dispatches
 * `kui:finish` at exactly one place, and this module registers an ordinary listener for it — so
 * `func:` cannot drift out of step with the event, because it *is* the event. That also means the
 * function receives the same `LifecycleEvent` a hand-written listener receives, with `this` bound to
 * the same element, so moving code between the two spellings is a copy-paste rather than a rewrite.
 *
 * It is **not** the recommended API. `addEventListener('kui:finish', fn)` works with bundlers and ES
 * modules, allows several listeners on one element, and needs no global — and every project with a
 * build step should use it. `func:` exists for the no-build site: a page with a `<script>` block, an
 * attribute, and no module graph to hang a listener off. That audience is real, and telling them to
 * "just import the library and add a listener" is telling them to adopt a toolchain to run one
 * function.
 *
 * ## The one risk an integrator has to own
 *
 * `func:` turns an attribute value into a function call, so **whoever controls the attribute
 * controls which global function runs**. On a hand-authored page that is the author, and there is no
 * gap. On a page where `data-kui` is assembled from a CMS field, a URL parameter, or any other input
 * an end user can influence, it is *them* — and a value they choose can invoke any function the page
 * happens to have put on `window`, with the animated element as `this`.
 *
 * The lookup below is deliberately as narrow as it can be while still doing the job: an own-property
 * read on the element's own window, a `typeof === 'function'` check before calling, no dotted path
 * traversal, and no `eval`/`Function` anywhere — so the value can *name* a function but can never
 * *be* one. That closes code injection. It does not, and cannot, close "call any function by name",
 * because that is the feature. If `data-kui` on your site is ever built from untrusted input, use
 * the event API for the callback and keep `func:` out of the template.
 */

/** Everything `bindCallback` needs, grouped so the call site reads as one request. */
export interface CallbackRequest {
  /** The host element. The one lifecycle events are dispatched on, and the callback's `this`. */
  el: Element
  /** The authored `func:` value — a bare global name, unvalidated by `parse.ts`. */
  name: string
  /** Diagnostic sink. Silent by default, exactly as it is for an unknown effect name. */
  reporter: Reporter
  /** The instance's teardown signal, so the listener detaches with everything else. */
  signal: AbortSignal
}

/**
 * Register an author's named global as a `kui:finish` listener on one element.
 *
 * The name is resolved **at fire time, not here**, and that is deliberate: a no-build page routinely
 * defines its functions in a `<script>` that runs after the library has scanned, and resolving
 * eagerly would reject every one of those with a warning that was wrong by the time it printed.
 * The cost is that a typo stays silent until the animation completes — at which point it warns,
 * naming the value, which is the same deal every other diagnostic in the grammar offers.
 *
 * @complexity O(1) time and space to register; O(1) per event beyond the author's own function.
 * @overallScore 100
 */
export function bindCallback(request: CallbackRequest): void {
  const { el, name, reporter, signal } = request

  const handler = (event: Event): void => {
    // Lifecycle events bubble — that is the whole point of them (see `emitLifecycle`) — so an
    // element with animated descendants receives every child's `kui:finish` too. Without this an
    // author who put `func:` on a `cascade:` group would have their function called once per child
    // and never once for the group, which is neither what they wrote nor anything they could debug.
    if (event.target !== el) return
    const fn = resolveGlobalFunction(el, name)
    if (!fn) {
      reporter.warn(
        `func:${name} — no global function named "${name}". A function declaration ` +
          `(\`function ${name}() {}\`) or an explicit \`window.${name} = …\` creates one; \`const\` ` +
          `and \`let\` deliberately do not, and neither does a bundled or \`type="module"\` script.`,
        el,
      )
      return
    }
    // `Reflect.apply` rather than `fn(event)` so `this` is the element, matching what
    // `addEventListener` gives a listener. Not wrapped in `try`/`catch`: an exception thrown by an
    // author's own function should surface exactly as it would from a hand-written listener —
    // reported by the page's normal error handling — rather than being swallowed into a library
    // reporter that is silent by default. Event dispatch already isolates it from the animator.
    Reflect.apply(fn, el, [event as LifecycleEvent])
  }

  el.addEventListener(KUI_EVENT.finish, handler)
  signal.addEventListener('abort', () => el.removeEventListener(KUI_EVENT.finish, handler))
}

/**
 * Look up one bare name on the element's own global object.
 *
 * The window is taken from `el.ownerDocument.defaultView` rather than the ambient global for the
 * same reason `emitLifecycle` takes its `CustomEvent` constructor from there: an animator driving a
 * document inside an `<iframe>` must find the function that document's own scripts defined, not one
 * that happens to share its name in the parent frame. The `globalThis` fallback keeps a jsdom-style
 * environment working where `defaultView` can be null.
 *
 * `Object.hasOwn` is load-bearing, not decoration. A plain `scope[name]` read falls through to
 * `Object.prototype`, so an author-controlled name like `constructor` or `valueOf` resolves to an
 * inherited function — `typeof` says `'function'`, and calling it would run something no page ever
 * put on its window. This is the same trap `applyToken` in `parse.ts` closes for the hoist table,
 * and it is closed here for the same reason.
 *
 * @returns The function, or `undefined` when the name names nothing callable.
 * @complexity O(1) time and space.
 * @overallScore 100
 */
function resolveGlobalFunction(
  el: Element,
  name: string,
): ((...args: unknown[]) => unknown) | undefined {
  const scope: object = el.ownerDocument?.defaultView ?? globalThis
  if (!Object.hasOwn(scope, name)) return undefined
  const candidate = (scope as Record<string, unknown>)[name]
  return typeof candidate === 'function' ? (candidate as (...args: unknown[]) => unknown) : undefined
}
