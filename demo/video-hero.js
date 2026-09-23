/**
 * video-hero.js — the dot-switched slide carousel behind the video hero at the top of index.html.
 *
 * Every slide is a `data-kui="bg ..."` layer that autoplays unconditionally the moment the page
 * loads (`autoplay:always`), so switching slides is never waiting on a clip to buffer — this
 * script only ever toggles which one is *visible*, via the `.is-active` class the stylesheet
 * cross-fades on. No dependency on the animator: plain classList/attribute writes, same register
 * as nav.js's own mobile-panel toggle.
 *
 * Also wires each slide's own `.video-hero-audio` mute toggle, where present. `bg` (`background-
 * media`) always builds its `<video>` as `muted` — that's a hard-coded browser-autoplay
 * requirement, not an authored choice, so there's no `data-kui` parameter to flip. Unmuting for
 * real only ever happens from an actual click, which is exactly what this button is.
 *
 * The one place this file does lean on the library: the hero root carries `data-kui="swipe-x"`, and
 * `initSwipe` below turns the `data-kui-swipe` attribute that primitive publishes into the same
 * `activate(index)` call the dots make. Recognition is the library's; what a direction *means* is
 * this file's. Nothing about the slide switch itself changed to accommodate it.
 *
 * `activate` also sets `inert` on every slide but the active one — not `aria-hidden`, which the
 * inactive slides' own controls (`.kui-show-code-toggle`, `.video-hero-source`) would otherwise
 * stay reachable through, since the cross-fade keeps them laid out (`opacity:0` only). `inert` pulls
 * the whole subtree out of both the tab order and the accessibility tree in one attribute.
 */
;(function () {
  var MUTED_ICON =
    '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M4 9v6h4l5 5V4L8 9H4Z"/><path stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M16 9l6 6m0-6-6 6"/></svg>'
  var UNMUTED_ICON =
    '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M4 9v6h4l5 5V4L8 9H4Z"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M16.5 8.5a5 5 0 0 1 0 7M19.5 6a9 9 0 0 1 0 12"/></svg>'

  function initAudioToggle(slide) {
    var button = slide.querySelector('.video-hero-audio')
    if (!button) return
    button.addEventListener('click', function () {
      // Looked up at click time rather than cached at init — `bg`'s own `<video>` is built by the
      // animator asynchronously, and this button living inside the same slide is the only
      // guarantee the element exists by the time anyone can actually click it.
      var video = slide.querySelector('video')
      if (!video) return
      video.muted = !video.muted
      if (!video.muted) video.volume = 1
      button.setAttribute('aria-pressed', String(!video.muted))
      button.setAttribute('aria-label', video.muted ? 'Unmute video' : 'Mute video')
      button.innerHTML = video.muted ? MUTED_ICON : UNMUTED_ICON
    })
  }

  /**
   * Wire the touch half of the switch: `data-kui="swipe-x"` on the same root.
   *
   * `swipeable` (src/effects/gestures/primitives.ts) owns recognition only — it publishes the
   * direction as `data-kui-swipe="left"`/`"right"` on the element and moves nothing, which is the
   * pairing `docs/catalog.md` names for carousels. So the direction arrives as an attribute write,
   * and a MutationObserver is how you hear one; there is no callback to subscribe to, deliberately.
   *
   * The value is re-read from the element rather than taken from `record.oldValue`, because two
   * swipes the same way in a row write the identical value. `setAttribute` still queues a mutation
   * record for an unchanged value (the DOM spec's "change an attribute" runs either way), so the
   * observer does fire — but only the current value is trustworthy, never the diff.
   *
   * Left is next, right is previous: the flick moves the content the way your finger goes, the same
   * direction sense as any native pager. It wraps, because three slides with a dot row that can
   * already jump anywhere has no meaningful "end".
   */
  function initSwipe(root, step) {
    if (typeof MutationObserver !== 'function') return
    new MutationObserver(function () {
      var direction = root.getAttribute('data-kui-swipe')
      if (direction === 'left') step(1)
      else if (direction === 'right') step(-1)
    }).observe(root, { attributes: true, attributeFilter: ['data-kui-swipe'] })
  }

  function initCarousel(root) {
    var slides = [].slice.call(root.querySelectorAll('.video-hero-slide'))
    var dots = [].slice.call(root.querySelectorAll('.video-hero-dot'))
    slides.forEach(initAudioToggle)
    if (slides.length === 0 || dots.length === 0) return

    // Tracked here rather than re-derived from `.is-active` at swipe time: `activate` is the single
    // writer of that class, so the index it was last called with is the honest current slide.
    var current = 0

    function activate(index) {
      current = index
      slides.forEach(function (slide, i) {
        var active = i === index
        slide.classList.toggle('is-active', active)
        // `inert`, not `aria-hidden`: the inactive slides are only `opacity:0;pointer-events:none`
        // (the cross-fade needs both to still be laid out), so their own `.kui-show-code-toggle`
        // button and `.video-hero-source` link stay focusable — `aria-hidden="true"` only claims
        // they're hidden from the accessibility tree, it does nothing about the tab order (axe's
        // `aria-hidden-focus`). `inert` removes the subtree from both at once. Explicitly removing
        // any stale `aria-hidden` too, since the two attributes disagreeing would be worse than
        // either alone.
        slide.inert = !active
        slide.removeAttribute('aria-hidden')
      })
      dots.forEach(function (dot, i) {
        var active = i === index
        dot.classList.toggle('is-active', active)
        dot.setAttribute('aria-selected', String(active))
        // Roving tabindex: only the selected dot sits in the tab order, same contract the nav
        // dropdown's own active-item pattern uses elsewhere on this page.
        dot.tabIndex = active ? 0 : -1
      })
    }

    dots.forEach(function (dot, i) {
      dot.addEventListener('click', function () {
        activate(i)
      })
    })

    initSwipe(root, function step(delta) {
      activate((current + delta + slides.length) % slides.length)
    })
  }

  document.querySelectorAll('[data-video-carousel]').forEach(initCarousel)
})()
