/**
 * video-hero-sources.js — swaps individual hero slides to portrait clips on phones.
 *
 * The hero's default clips are 16:9. On a phone the hero is a tall `100svh` box, so `fit:cover`
 * has to crop a landscape frame down to a portrait window — it discards most of the width and
 * lands wherever the subject isn't. The fix is different footage, not different CSS.
 *
 * **This file only ever swaps. It never removes a slide, and it is a no-op on any slide that does
 * not opt in.** An earlier version inverted that — it treated a missing `data-mobile-src` as
 * "this slide has no phone counterpart, drop it" — and since the attribute had not been added to
 * the markup yet, the first thing it did on a phone was delete every slide in the carousel and
 * leave an empty hero. A default that destroys content when an attribute is absent is the wrong
 * default: absent should mean "leave this alone", so that the failure mode of forgetting an
 * attribute is the unchanged page rather than a blank one.
 *
 * **Why this runs as its own file, loaded immediately before `kuinetic.js`, and not from
 * `video-hero.js` with the rest of the carousel.** `background-media` reads `src:` out of the
 * `data-kui` attribute once, when the animator processes the element, and it activates `on:load`
 * — so the only window in which rewriting that attribute has any effect at all is after the
 * markup is parsed and before the bundle runs. `video-hero.js` loads at the very bottom of the
 * page, long after; anything it rewrote would be rewriting an attribute the animator had already
 * read, and the phone would have downloaded the landscape clip first regardless. The placement is
 * load-bearing, not stylistic.
 *
 * **Why not two sets of slides hidden by a media query.** `bg` carries `autoplay:always` and
 * activates on load, so every slide in the DOM starts fetching its clip whether or not CSS has
 * hidden it. A phone would pull five files down to display three. Rewriting one attribute in
 * place is the only version of this that does not cost the visitor the bandwidth it means to save.
 *
 * A slide opts in with `data-mobile-src`, plus whichever of `data-mobile-poster`,
 * `data-mobile-credit` and `data-mobile-source-url` actually differ. Everything else is inherited
 * from the slide's authored markup.
 */
;(function () {
  // Matches the `max-width: 640px` breakpoint index.html's own hero rules use. Read once, not
  // watched: `background-media` cannot re-read `src:` after activation, so reacting to a later
  // resize would change the attribute and nothing else. A phone that is rotated keeps the clip it
  // already loaded, which is the honest outcome — the alternative is a second full download
  // mid-session for a visitor who is already looking at a working hero.
  if (!window.matchMedia('(max-width: 640px)').matches) return

  document.querySelectorAll('.video-hero-slide[data-mobile-src]').forEach(function (slide) {
    var mobileSrc = slide.getAttribute('data-mobile-src')
    if (!mobileSrc) return

    var spec = slide.getAttribute('data-kui') || ''
    // Value-scoped replace, not a global one: `src:` and `poster:` are two parameters of the same
    // `bg` effect and both hold paths into the same directory, so an unanchored match on the path
    // would rewrite whichever came first twice. `[^\s,]+` stops at the space before the next
    // parameter and at the comma before the next effect in the list (`, blur-in ...`), which is
    // exactly the extent of one value in this grammar.
    spec = spec.replace(/(\bsrc:)[^\s,]+/, '$1' + mobileSrc)

    var mobilePoster = slide.getAttribute('data-mobile-poster')
    if (mobilePoster) spec = spec.replace(/(\bposter:)[^\s,]+/, '$1' + mobilePoster)

    slide.setAttribute('data-kui', spec)

    var credit = slide.getAttribute('data-mobile-credit')
    if (credit) {
      var creditEl = slide.querySelector('.video-hero-credit')
      if (creditEl) creditEl.textContent = credit
    }

    // `data-source-url` on the slide is what the "Show code" panel and the lightbox read; the
    // anchor is what a reader clicks. Both are updated, and both are optional — slide 1 carries no
    // `.video-hero-source` anchor at all, so the guard is load-bearing rather than defensive.
    var sourceUrl = slide.getAttribute('data-mobile-source-url')
    if (sourceUrl) {
      var sourceEl = slide.querySelector('.video-hero-source')
      if (sourceEl) sourceEl.href = sourceUrl
      slide.setAttribute('data-source-url', sourceUrl)
    }
  })
})()
