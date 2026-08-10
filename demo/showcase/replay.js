/**
 * Replay-all FAB, shared by every demo/showcase/*.html page.
 *
 * Each page boots the animator as `window.__dsg`. On click, this re-triggers every effect
 * currently on the page via `__dsg.play()` (the same programmatic API demonstrated in
 * interactive.html's "Programmatic API" section) — regardless of how it was originally activated
 * — so a load- or scroll-triggered effect that already fired can be reviewed again without
 * reloading or re-scrolling. One script, one button, so a new showcase page gets this for free by
 * adding the same `<script src="./replay.js"></script>` tag; nothing here is copy-pasted per page.
 */
;(function () {
  // Material Design's "replay" glyph: a circular arrow with a rewind-style arrowhead.
  const REPLAY_ICON =
    '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">' +
    '<path fill="currentColor" d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8Z"/>' +
    '</svg>'

  function replayEveryEffect() {
    const anim = window.__dsg
    if (!anim) return
    for (const el of document.querySelectorAll('[data-dsg]')) {
      // `process()` intentionally ignores an unchanged configuration. Tear the installed
      // instance down through the public API first so an already-finished load effect gets a
      // fresh animation rather than hitting that identity short-circuit.
      anim.reset(el)
      anim.play(el, el.getAttribute('data-dsg'))
    }
  }

  function mountReplayButton() {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'dsg-replay-fab'
    button.setAttribute('aria-label', 'Replay every effect on this page')
    button.innerHTML = REPLAY_ICON
    button.addEventListener('click', replayEveryEffect)
    document.body.appendChild(button)
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountReplayButton)
  } else {
    mountReplayButton()
  }
})()
