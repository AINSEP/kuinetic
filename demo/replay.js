/**
 * Replay-all FAB, shared by every demo/showcase/*.html page.
 *
 * Resets and reprocesses every `data-kui` element in place through the animator's own
 * `reset()` + `process()` cycle — the same pair the library's own `play()` helper uses
 * internally. `process()` short-circuits when an element's configuration hasn't changed, so
 * `reset()` (which releases the installed state) is what actually makes replaying the same
 * effect twice not a no-op.
 *
 * Elements driven by a native scroll/view CSS timeline (parallax-y and friends) are skipped:
 * they're already continuously live, driven by scroll position rather than a discrete trigger —
 * there's nothing to "replay". Elements gated on hover/focus/click are reset but not
 * synthetically activated: forcing them to play without the real interaction that defines them
 * (a flip nobody hovered, a sweep nobody's cursor triggered) would read as broken, not replayed.
 * Resetting still clears their state so the next real hover/click looks fresh.
 *
 * For everything else, `process()` re-opens the gate: elements on screen right now replay
 * immediately, elements still off-screen just rebind their enter-observer and play the next time
 * the user scrolls to them — the same as a fresh load, without reloading or moving the scroll
 * position.
 */
;(function () {
  // Material Design's "replay" glyph: a circular arrow with a rewind-style arrowhead.
  const REPLAY_ICON =
    '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">' +
    '<path fill="currentColor" d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8Z"/>' +
    '</svg>'

  function replayInPlace() {
    var kui = window.__kui
    if (!kui || typeof kui.reset !== 'function' || typeof kui.process !== 'function') return
    var els = document.querySelectorAll('[data-kui]')
    for (var i = 0; i < els.length; i++) {
      var el = els[i]
      var state = typeof kui.stateOf === 'function' ? kui.stateOf(el) : null
      if (state && (state.timeline === 'view' || state.timeline === 'scroll')) continue
      kui.reset(el)
      kui.process(el)
    }
  }

  function mountReplayButton() {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'kui-replay-fab'
    button.setAttribute('aria-label', 'Replay every effect on this page')
    button.innerHTML = REPLAY_ICON
    button.addEventListener('click', replayInPlace)
    document.body.appendChild(button)
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountReplayButton)
  } else {
    mountReplayButton()
  }
})()
