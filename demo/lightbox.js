/**
 * lightbox.js — click any demo image to open it full-size over a lightly dimmed page.
 *
 * Self-contained: injects its own stylesheet, binds itself on DOMContentLoaded, and needs no
 * markup changes. Drop the <script> on a page and every content image inside <main> becomes
 * openable. Opt a single image out with `data-no-lightbox`.
 *
 * Built on <dialog> + showModal() so the focus trap, Escape-to-close, inert background, and
 * focus restore are the browser's job rather than ours. The open/close transition is driven by
 * an `.is-open` class rather than @starting-style/allow-discrete so the animation is identical
 * in every engine, not just the ones shipping discrete-property transitions.
 */
;(function () {
  var DURATION = 280
  var STYLE_ID = 'kui-lightbox-style'

  var CSS = [
    /* Closed state MUST stay display:none. The UA rule that hides a closed dialog is
       `dialog:not([open])`, which a plain `dialog.kui-lightbox { display:grid }` outranks — that
       left a fixed, inset-0, opacity-0 panel painted over the entire document at all times,
       swallowing every click and scroll on the page underneath. Gate display on [open] instead.
       The exit transition still runs because close() is only called after it finishes, so the
       element keeps its [open] attribute for the whole fade-out. */
    'dialog.kui-lightbox{display:none;}',
    'dialog.kui-lightbox[open]{',
    '  position:fixed; inset:0; width:100%; height:100%; max-width:none; max-height:none;',
    '  margin:0; border:0; padding:clamp(1rem,4vw,3rem); overflow:auto; overscroll-behavior:contain;',
    '  display:grid; place-items:center; color:#fff;',
    /* the dim lives on the dialog, not ::backdrop — the dialog already fills the viewport, so
       one surface is enough and it is the one we can also blur and transition */
    '  background:rgb(8 9 10 / 0.58);',
    '  -webkit-backdrop-filter:blur(7px); backdrop-filter:blur(7px);',
    '  opacity:0; transition:opacity ' + DURATION + 'ms cubic-bezier(.22,1,.36,1);',
    '}',
    'dialog.kui-lightbox::backdrop{background:transparent;}',
    'dialog.kui-lightbox[open].is-open{opacity:1;}',
    'dialog.kui-lightbox figure{',
    '  margin:0; display:flex; flex-direction:column; gap:0.75rem; align-items:center;',
    '  opacity:0; scale:0.965; translate:0 8px;',
    '  transition:opacity ' + DURATION + 'ms ease, scale ' + DURATION + 'ms cubic-bezier(.22,1,.36,1), translate ' + DURATION + 'ms cubic-bezier(.22,1,.36,1);',
    '}',
    'dialog.kui-lightbox.is-open figure{opacity:1; scale:1; translate:0 0;}',
    'dialog.kui-lightbox img{',
    '  display:block; border-radius:10px; box-shadow:0 30px 80px rgb(0 0 0 / 0.45);',
    '  background:#0b0c0d;',
    '}',
    /* short/wide images fit the viewport whole; a full-page screenshot is many screens tall, so
       it gets capped on width instead and the dialog itself scrolls */
    'dialog.kui-lightbox img.is-fit{max-width:min(100%,1400px); max-height:86dvh; width:auto; height:auto;}',
    'dialog.kui-lightbox img.is-tall{width:min(100%,760px); height:auto;}',
    'dialog.kui-lightbox figcaption{',
    '  max-width:60ch; text-align:center; font-size:0.85rem; line-height:1.5;',
    '  color:rgb(255 255 255 / 0.72);',
    '}',
    '.kui-lightbox-close{',
    '  position:fixed; top:clamp(0.75rem,2vw,1.25rem); right:clamp(0.75rem,2vw,1.25rem);',
    '  width:40px; height:40px; display:grid; place-items:center; padding:0; cursor:pointer;',
    '  border-radius:50%; border:1px solid rgb(255 255 255 / 0.22); color:#fff;',
    '  background:rgb(255 255 255 / 0.1); -webkit-backdrop-filter:blur(8px); backdrop-filter:blur(8px);',
    '  transition:background-color 160ms ease, transform 160ms ease;',
    '}',
    '.kui-lightbox-close:hover{background:rgb(255 255 255 / 0.2); transform:scale(1.06);}',
    '.kui-lightbox-close:focus-visible{outline:2px solid #fff; outline-offset:2px;}',
    '[data-kui-lightbox-src]{cursor:zoom-in;}',
    '[data-kui-lightbox-src]:focus-visible{outline:2px solid var(--accent,#7c5cff); outline-offset:3px;}',
    '@media (prefers-reduced-motion: reduce){',
    '  dialog.kui-lightbox, dialog.kui-lightbox figure, .kui-lightbox-close{transition-duration:1ms;}',
    '  dialog.kui-lightbox figure{scale:1; translate:0 0;}',
    '}',
  ].join('\n')

  var CLOSE_ICON =
    '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" aria-hidden="true" focusable="false">' +
    '<line x1="5" y1="5" x2="19" y2="19"></line><line x1="19" y1="5" x2="5" y2="19"></line></svg>'

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return
    var style = document.createElement('style')
    style.id = STYLE_ID
    style.textContent = CSS
    document.head.appendChild(style)
  }

  function prefersReducedMotion() {
    try {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches
    } catch (e) {
      return false
    }
  }

  function build() {
    var dialog = document.createElement('dialog')
    dialog.className = 'kui-lightbox'
    dialog.setAttribute('aria-label', 'Image viewer')

    var figure = document.createElement('figure')
    var img = document.createElement('img')
    img.decoding = 'async'
    var caption = document.createElement('figcaption')
    figure.append(img, caption)

    var close = document.createElement('button')
    close.type = 'button'
    close.className = 'kui-lightbox-close'
    close.setAttribute('aria-label', 'Close image viewer')
    close.innerHTML = CLOSE_ICON

    dialog.append(close, figure)
    document.body.appendChild(dialog)

    var closing = false
    var closeTimer = null
    var locked = false
    var scrollLock = { overflow: '', paddingRight: '' }

    // Both halves are idempotent. Without the `locked` guard a second open() before the first
    // unlock would capture the *locked* value as the "original", and restoring it later would
    // leave the page permanently unscrollable.
    function lockScroll() {
      if (locked) return
      locked = true
      var el = document.documentElement
      // reserve the scrollbar's width so hiding it doesn't widen the page underneath
      var gap = window.innerWidth - el.clientWidth
      scrollLock.overflow = el.style.overflow
      scrollLock.paddingRight = el.style.paddingRight
      el.style.overflow = 'hidden'
      if (gap > 0) el.style.paddingRight = gap + 'px'
    }

    function unlockScroll() {
      if (!locked) return
      locked = false
      var el = document.documentElement
      el.style.overflow = scrollLock.overflow
      el.style.paddingRight = scrollLock.paddingRight
    }

    function open(source) {
      clearTimeout(closeTimer)
      closing = false

      var src = source.getAttribute('data-kui-lightbox-src') || source.currentSrc || source.src
      var alt = source.getAttribute('alt') || ''
      img.className = ''
      img.src = src
      img.alt = alt
      caption.textContent = alt
      caption.hidden = alt === ''

      // a full-page screenshot is far taller than the viewport — cap it on width and let the
      // dialog scroll, rather than shrinking a whole page down to thumbnail size to "fit"
      var ratio = source.naturalWidth ? source.naturalHeight / source.naturalWidth : 1
      img.classList.add(ratio > 1.5 ? 'is-tall' : 'is-fit')

      lockScroll()
      dialog.showModal()
      dialog.scrollTop = 0
      // Force the closed state to be computed before flipping the class, so the browser has two
      // distinct styles to interpolate between. A double-requestAnimationFrame is the usual way
      // to buy that, but rAF is throttled in background/unfocused tabs — there the callback can
      // be seconds late and the panel just sits invisible until the tab wakes up. Reading a
      // layout property flushes style synchronously and never depends on a frame being served.
      void dialog.offsetWidth
      dialog.classList.add('is-open')
    }

    function dismiss() {
      if (closing || !dialog.open) return
      closing = true
      dialog.classList.remove('is-open')
      closeTimer = setTimeout(
        function () {
          dialog.close()
          // Release the page directly rather than trusting the `close` event to arrive — a
          // stuck scroll lock leaves the whole document unscrollable, which is far worse than
          // the transition it guards. The `close` listener below still calls this too; both
          // paths are idempotent, so whichever runs first wins and the other no-ops.
          unlockScroll()
          closing = false
        },
        prefersReducedMotion() ? 0 : DURATION,
      )
    }

    // "click off" — anywhere that is not the image itself. The figure wraps a centered caption
    // too, so testing against the <img> box is what actually matches the user's intent.
    dialog.addEventListener('click', function (event) {
      if (event.target === img) return
      if (event.target === close || close.contains(event.target)) return
      dismiss()
    })

    // Escape fires `cancel` on a modal dialog; take it over so it plays the same exit transition
    // instead of snapping shut.
    dialog.addEventListener('cancel', function (event) {
      event.preventDefault()
      dismiss()
    })

    dialog.addEventListener('close', function () {
      dialog.classList.remove('is-open')
      unlockScroll()
      img.removeAttribute('src')
    })

    close.addEventListener('click', dismiss)

    return open
  }

  function isEligible(img) {
    if (img.hasAttribute('data-no-lightbox')) return false
    // a YouTube poster's job is to start the video, not to open a still of it
    if (img.closest('.video-frame')) return false
    if (img.closest('.kui-lightbox')) return false
    if (img.closest('header, footer, .site-header')) return false
    return true
  }

  function init() {
    var images = [].slice.call(document.querySelectorAll('main img')).filter(isEligible)
    if (images.length === 0) return

    injectStyle()
    var open = build()

    images.forEach(function (img) {
      img.setAttribute('data-kui-lightbox-src', img.getAttribute('src') || '')
      // an <img> is not focusable or operable on its own; give it the affordances of the button
      // it now behaves like, so it is reachable by keyboard and announced as actionable
      img.setAttribute('role', 'button')
      img.setAttribute('tabindex', '0')
      var alt = img.getAttribute('alt')
      img.setAttribute('aria-label', alt ? 'Open larger image: ' + alt : 'Open larger image')

      img.addEventListener('click', function () {
        open(img)
      })
      img.addEventListener('keydown', function (event) {
        if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'Spacebar') return
        event.preventDefault()
        open(img)
      })
    })
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }
})()
