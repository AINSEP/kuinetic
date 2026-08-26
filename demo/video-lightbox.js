/**
 * video-lightbox.js — click a video card to open a large, theater-style click-to-embed player
 * over a dimmed page.
 *
 * Deliberately its own file rather than a mode added to `lightbox.js`: that script auto-binds to
 * every content image inside <main>, which is right for its pages but would also start
 * lightbox-ing every plain image on a page that only wants the video modal — including images
 * inside `<a>` cards, where a lightbox opening and the link navigating on the same click is a
 * real, confusing double action. This file only ever reacts to an explicit opt-in marker, so
 * dropping the <script> tag on a page cannot change how any of that page's other images behave.
 *
 * Trigger: put `data-kui-lightbox-video="<youtube id>"` on the same element scroll.html's own
 * `.video-frame` cards use as their poster wrapper, with a `.yt-play` button inside it — that
 * button is the actual click target, same as every other click-to-embed video on this site.
 * `data-kui-lightbox-title` names the video for the iframe's accessible title.
 *
 * Built on <dialog> + showModal(), same shell/transition approach as `lightbox.js`'s image
 * viewer, for the same reasons: the focus trap, Escape-to-close, inert background, and focus
 * restore are the browser's job rather than ours.
 */
;(function () {
  var DURATION = 280
  var STYLE_ID = 'kui-video-lightbox-style'

  var CSS = [
    'dialog.kui-video-lightbox{display:none;}',
    'dialog.kui-video-lightbox[open]{',
    '  position:fixed; inset:0; width:100%; height:100%; max-width:none; max-height:none;',
    '  margin:0; border:0; padding:clamp(1rem,4vw,3rem); overflow:auto; overscroll-behavior:contain;',
    '  display:grid; place-items:center; color:#fff;',
    '  background:rgb(8 9 10 / 0.58);',
    '  -webkit-backdrop-filter:blur(7px); backdrop-filter:blur(7px);',
    '  opacity:0; transition:opacity ' + DURATION + 'ms cubic-bezier(.22,1,.36,1);',
    '}',
    'dialog.kui-video-lightbox::backdrop{background:transparent;}',
    'dialog.kui-video-lightbox[open].is-open{opacity:1;}',
    'dialog.kui-video-lightbox .kui-video-lightbox-frame{',
    '  width:min(92vw,1100px); aspect-ratio:16/9; border-radius:12px; overflow:clip;',
    '  box-shadow:0 30px 80px rgb(0 0 0 / 0.45); background:#000;',
    '  opacity:0; scale:0.965; translate:0 8px;',
    '  transition:opacity ' + DURATION + 'ms ease, scale ' + DURATION + 'ms cubic-bezier(.22,1,.36,1), translate ' + DURATION + 'ms cubic-bezier(.22,1,.36,1);',
    '}',
    'dialog.kui-video-lightbox.is-open .kui-video-lightbox-frame{opacity:1; scale:1; translate:0 0;}',
    'dialog.kui-video-lightbox .kui-video-lightbox-frame iframe{display:block; width:100%; height:100%; border:0;}',
    '.kui-video-lightbox-close{',
    '  position:fixed; top:clamp(0.75rem,2vw,1.25rem); right:clamp(0.75rem,2vw,1.25rem);',
    '  width:40px; height:40px; display:grid; place-items:center; padding:0; cursor:pointer;',
    '  border-radius:50%; border:1px solid rgb(255 255 255 / 0.22); color:#fff;',
    '  background:rgb(255 255 255 / 0.1); -webkit-backdrop-filter:blur(8px); backdrop-filter:blur(8px);',
    '  transition:background-color 160ms ease, transform 160ms ease;',
    '}',
    '.kui-video-lightbox-close:hover{background:rgb(255 255 255 / 0.2); transform:scale(1.06);}',
    '.kui-video-lightbox-close:focus-visible{outline:2px solid #fff; outline-offset:2px;}',
    '@media (prefers-reduced-motion: reduce){',
    '  dialog.kui-video-lightbox, .kui-video-lightbox-close{transition-duration:1ms;}',
    '  dialog.kui-video-lightbox .kui-video-lightbox-frame{transition-duration:1ms; scale:1; translate:0 0;}',
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
    dialog.className = 'kui-video-lightbox'
    dialog.setAttribute('aria-label', 'Video player')

    var frame = document.createElement('div')
    frame.className = 'kui-video-lightbox-frame'

    var close = document.createElement('button')
    close.type = 'button'
    close.className = 'kui-video-lightbox-close'
    close.setAttribute('aria-label', 'Close video player')
    close.innerHTML = CLOSE_ICON

    dialog.append(close, frame)
    document.body.appendChild(dialog)

    var closing = false
    var closeTimer = null
    var locked = false
    var scrollLock = { overflow: '', paddingRight: '' }

    function lockScroll() {
      if (locked) return
      locked = true
      var el = document.documentElement
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

    function open(id, title) {
      clearTimeout(closeTimer)
      closing = false

      var iframe = document.createElement('iframe')
      iframe.src = 'https://www.youtube.com/embed/' + id + '?autoplay=1'
      iframe.title = title || 'Video'
      iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture'
      iframe.allowFullscreen = true
      frame.replaceChildren(iframe)

      lockScroll()
      dialog.showModal()
      dialog.scrollTop = 0
      // Flush layout before flipping the class, so the browser has two distinct styles to
      // interpolate between rather than starting and ending the transition in the same frame.
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
          unlockScroll()
          closing = false
        },
        prefersReducedMotion() ? 0 : DURATION,
      )
    }

    dialog.addEventListener('click', function (event) {
      if (frame.contains(event.target)) return
      if (event.target === close || close.contains(event.target)) return
      dismiss()
    })

    dialog.addEventListener('cancel', function (event) {
      event.preventDefault()
      dismiss()
    })

    // The teardown is not optional: a YouTube iframe on a closed-but-not-cleared dialog keeps
    // playing — and keeps playing audio — out of sight, the same rule every other click-to-embed
    // video on this site already follows.
    dialog.addEventListener('close', function () {
      dialog.classList.remove('is-open')
      unlockScroll()
      frame.replaceChildren()
    })

    close.addEventListener('click', dismiss)

    return open
  }

  function init() {
    var frames = [].slice.call(document.querySelectorAll('main [data-kui-lightbox-video]'))
    if (frames.length === 0) return

    injectStyle()
    var open = build()

    frames.forEach(function (frame) {
      var play = frame.querySelector('.yt-play')
      if (!play) return
      var id = frame.getAttribute('data-kui-lightbox-video')
      var title = frame.getAttribute('data-kui-lightbox-title') || ''
      play.addEventListener('click', function () {
        open(id, title)
      })
    })
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }
})()
