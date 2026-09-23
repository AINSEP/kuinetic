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
 * there's nothing to "replay", because scrolling back up already replays them, backwards.
 * Elements gated on hover/focus/click are reset but not
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
    // Progress-linked effects are skipped, not reset. Resetting one in place does nothing — its
    // position IS the scroll position, so it resolves straight back to where it already was — and
    // moving the page under the reader is not what a replay button means.
  }

  function mountReplayButton() {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'kui-replay-fab'
    // Grow-on-hover comes from the library's `pop` preset rather than a hand-written
    // `transition: transform` + `:hover { transform: scale() }` pair in each page's CSS. `drag`
    // (plain, no `bounds:`/`return:`) rides alongside it on the same attribute — `pop`'s scale and
    // `drag`'s translate are different channels, so the two compose instead of fighting — so the
    // fab can be pulled clear of whatever it's floating over instead of being stuck in one corner.
    button.setAttribute('data-kui', 'pop, drag')
    button.setAttribute('aria-label', 'Replay every effect on this page')
    button.innerHTML = REPLAY_ICON

    // A real press-drag-release still fires a native `click` on the same element afterward —
    // the browser doesn't care that the pointer moved in between, only that both ends landed on
    // this button — so without this, every drag also replayed the page. `draggable`'s own prepare
    // writes `data-kui-dragging="true"` the moment the gesture crosses its drag threshold
    // (`recognise()`, `core/gesture.ts`) and back to "false" on release, which lands *before* the
    // click that follows — so latching `dragged` on the way up to `"true"` and checking it in the
    // click handler is what tells "this click ended a drag" apart from "this click was a click".
    let dragged = false
    new MutationObserver(() => {
      if (button.getAttribute('data-kui-dragging') === 'true') dragged = true
    }).observe(button, { attributes: true, attributeFilter: ['data-kui-dragging'] })
    button.addEventListener('click', () => {
      if (dragged) {
        dragged = false
        return
      }
      replayInPlace()
    })
    // Always `<body>`, at every width. This was briefly mounted inside `.video-hero` on phones so
    // that a `position: absolute` rule could hold it level with the hero's caption at every scroll
    // position — which it did, and which was the wrong trade: an element inside the hero scrolls
    // away with the hero, so the replay control was reachable only in the first screenful and
    // absent from every section below it. A replay-everything button that is only present at the
    // top of the page is not much of a replay-everything button.
    //
    // So it stays out of the document flow and pinned to the viewport instead. The cost is that it
    // is level with the caption only at scroll 0 and floats free after that. That is inherent, not
    // a bug to tune out: one element is anchored to the viewport and the other to the page, and no
    // set of offsets can make those two agree at more than one scroll position.
    document.body.appendChild(button)
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountReplayButton)
  } else {
    mountReplayButton()
  }
})()
