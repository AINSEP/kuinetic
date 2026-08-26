/**
 * motif-controller.js — the "click a name, watch the attribute recompile" playground, shared by
 * the four motif pages (swiss, blueprint, editorial, kinetic).
 *
 * Each of those pages carried its own copy of this, and each copy restated the same paragraph
 * about the same three calls. The mechanism is `reset()` + `process()` + `activate()`, exactly as
 * demo/index.html's playground uses it, and for the same three reasons:
 *
 *   reset()     releases the installed state. Without it `process()` short-circuits, because the
 *               element's configuration object is cached and "has it changed" is what it tests —
 *               so a second name written onto the same element would be a no-op.
 *   process()   re-plans and re-writes the compiled declaration for the new attribute value.
 *   activate()  opens the gate. `process()` leaves the effect GATED on its activation trigger,
 *               which is `on:enter` by default. The element never left the viewport, so the
 *               observer never re-fires and the animation would sit installed and paused at
 *               currentTime 0 forever — invisible for `blur-in`, whose frame 0 still shows the
 *               picture only soft, and total for `wipe-up`, whose frame 0 is `inset(100% ...)`,
 *               nothing at all. A click IS the activation here; this says so.
 *
 * Markup contract. Everything is scoped to a `[data-playground]` root, so a page may carry
 * more than one and two playgrounds cannot claim each other's triggers:
 *
 *   [data-playground]              the root
 *   [data-playground-target]       the element whose `data-kui` gets rewritten
 *   [data-fx="<attribute value>"]      a trigger — the same hook demo/index.html's playground
 *                                      already uses; `aria-pressed` tracks the selection
 *   [data-playground-attr]         optional — prints the authored string
 *   [data-playground-replay]       optional — re-runs the current selection
 *   [data-playground-readout=KEY]  optional — `keyframes`, `duration`, `easing` or `source`.
 *
 * Deliberately NOT `data-kui-playground-*`. The `data-kui*` namespace belongs to the library, and
 * `show-code.js` prints an element's authored attributes verbatim into its modal — a demo-only
 * hook wearing the library's prefix would be read there as part of the attribute grammar by
 * someone copying the markup. `data-fx`, the trigger hook demo/index.html already uses, keeps out
 * of that namespace for the same reason.
 *
 * The readout is deliberately *measured*, not mirrored: it reads the declaration the runtime just
 * wrote onto the element rather than restating the string the trigger holds. A blueprint that
 * prints its own inputs back at you is not an instrument.
 */
;(function () {
  const READOUT_KEYS = ['keyframes', 'duration', 'easing', 'source']

  /**
   * Prefer the inline style the runtime wrote; fall back to the computed value. A `prep` or `js`
   * renderer emits no `animation` declaration on the host element at all — that reads back as ''
   * or 'none', which is information rather than a failure, so the caller says so.
   */
  function readDecl(el, prop) {
    const inline = el.style.getPropertyValue(prop)
    if (inline) return inline
    const computed = getComputedStyle(el).getPropertyValue(prop)
    return computed && computed !== 'none' ? computed : ''
  }

  function initPlayground(root) {
    const target = root.querySelector('[data-playground-target]')
    const triggers = [...root.querySelectorAll('[data-fx]')]
    if (!target || triggers.length === 0) return

    const label = root.querySelector('[data-playground-attr]')
    const replay = root.querySelector('[data-playground-replay]')
    const readout = {}
    for (const key of READOUT_KEYS) {
      readout[key] = root.querySelector('[data-playground-readout="' + key + '"]')
    }

    function paint(fx) {
      if (label) label.textContent = fx
      const name = readDecl(target, 'animation-name')
      const css = !!name
      if (readout.keyframes) readout.keyframes.textContent = css ? name : '— none on this element'
      if (readout.duration) {
        readout.duration.textContent = css ? readDecl(target, 'animation-duration') : '—'
      }
      if (readout.easing) {
        readout.easing.textContent = css ? readDecl(target, 'animation-timing-function') : '—'
      }
      if (readout.source) {
        readout.source.textContent = css
          ? 'measured — css renderer, keyframes on this element'
          : 'measured — prep/js renderer, keyframes live on generated children'
      }
    }

    function run(fx) {
      target.setAttribute('data-kui', fx)
      const kui = window.__kui
      if (kui && typeof kui.reset === 'function') {
        kui.reset(target)
        kui.process(target)
        kui.activate(target)
      }
      // After the three calls, never before: the readout is measured off what the runtime has just
      // written onto the element.
      paint(fx)
    }

    for (const trigger of triggers) {
      trigger.addEventListener('click', function () {
        for (const other of triggers) {
          other.setAttribute('aria-pressed', String(other === trigger))
        }
        run(trigger.getAttribute('data-fx'))
      })
    }

    if (replay) {
      replay.addEventListener('click', function () {
        const active = triggers.find((t) => t.getAttribute('aria-pressed') === 'true')
        run(active ? active.getAttribute('data-fx') : target.getAttribute('data-kui'))
      })
    }

    // Seed from whatever the runtime installed for the target's authored attribute. One frame of
    // delay: `start()` walks the document synchronously, but reading straight after it in the same
    // task can beat the style write on some paths.
    requestAnimationFrame(function () {
      paint(target.getAttribute('data-kui') || '')
    })
  }

  function init() {
    for (const root of document.querySelectorAll('[data-playground]')) initPlayground(root)
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }
})()
