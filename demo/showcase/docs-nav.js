/**
 * "Docs" dropdown, shared by every showcase page and the root demo page.
 *
 * On the three showcase pages it prepends into the existing `header.site nav` as the first
 * item. `demo/index.html` carries no showcase chrome at all (no header, no style.css), so there
 * it mounts a minimal standalone bar instead — see `mount()`.
 *
 * Links are root-relative (`/demo/showcase/docs.html`) because this script is shared by pages at
 * two different depths (demo/showcase/*.html and demo/index.html) — a relative `./docs.html`
 * would resolve differently depending on which page loaded it. docs.html renders docs/*.md
 * client-side via markdown.js (a raw .md URL has no stylesheet, so a browser just dumps unstyled
 * plain text). Both the root-relative link and docs.html's own fetch() of docs/*.md require the
 * whole repo served from its root (`npm run showcase`, not `cd demo && python3 -m http.server`).
 *
 * On pointer/hover-capable devices the menu also opens/closes on hover; a click "pins" whatever
 * state it produces so hover can't immediately reverse it — see the `pinned` comment inside
 * `buildDropdown()`. Every dropdown (this one and the three in section-nav.js) registers into the
 * shared `window.__dsgNavDropdowns` so opening any one of them closes all the others.
 */
;(function () {
  const LINKS = [
    { label: 'Catalog', href: '/demo/showcase/docs.html?doc=catalog' },
    { label: 'Architecture', href: '/demo/showcase/docs.html?doc=design' },
  ]

  // Shared with section-nav.js — every showcase page loads both, and only one dropdown should
  // ever be open at once. Each dropdown registers its own `close` here, so opening one can
  // force-close every other regardless of which file built it.
  window.__dsgNavDropdowns = window.__dsgNavDropdowns || []

  // Hover open/close is desktop-only. Wiring it unconditionally would hit the classic touchscreen
  // trap: first tap only fires the synthesized `:hover`/mouseenter, second tap is needed for the
  // click.
  const CAN_HOVER = window.matchMedia('(hover: hover) and (pointer: fine)').matches

  function buildDropdown() {
    const wrap = document.createElement('div')
    wrap.className = 'dsg-nav-dropdown'

    const trigger = document.createElement('button')
    trigger.type = 'button'
    trigger.className = 'dsg-nav-dropdown-trigger'
    trigger.textContent = 'Docs'
    trigger.setAttribute('aria-haspopup', 'true')
    trigger.setAttribute('aria-expanded', 'false')

    const menu = document.createElement('div')
    menu.className = 'dsg-nav-dropdown-menu'
    // Toggled via inline `display`, never the `hidden` attribute — an author `display` rule on
    // this class would silently beat the UA `[hidden]` rule at equal specificity and later
    // source order, leaving the menu visibly stuck open regardless of `hidden`.
    menu.style.display = 'none'
    for (const { label, href } of LINKS) {
      const a = document.createElement('a')
      a.href = href
      a.textContent = label
      menu.appendChild(a)
    }

    // Once a click has set the open/closed state explicitly, hover stops driving the menu until
    // an outside click, Escape, or another trigger click changes it again. Without this, clicking
    // the trigger and then moving the mouse into the menu (or away from it) would immediately
    // flip the state right back via the hover handlers below.
    let pinned = false

    function close() {
      pinned = false
      menu.style.display = 'none'
      trigger.setAttribute('aria-expanded', 'false')
    }
    function open() {
      for (const closeOther of window.__dsgNavDropdowns) {
        if (closeOther !== close) closeOther()
      }
      menu.style.display = 'flex'
      trigger.setAttribute('aria-expanded', 'true')
    }
    window.__dsgNavDropdowns.push(close)

    trigger.addEventListener('click', (event) => {
      event.stopPropagation()
      // Keyed off `pinned`, not raw `display` — a real mouse click is preceded by a real mouse
      // move, which fires `mouseenter` and hover-opens the menu *before* the click event itself
      // arrives. Toggling on `display` alone would see "already open" on that first click and
      // immediately close what hover had just opened. Only a click on an already-pinned-open menu
      // should close it; a click on a closed-or-merely-hovered menu should open and pin it.
      if (pinned && menu.style.display !== 'none') {
        close()
      } else {
        open()
        pinned = true
      }
    })
    document.addEventListener('click', (event) => {
      if (!wrap.contains(event.target)) close()
    })
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') close()
    })
    if (CAN_HOVER) {
      wrap.addEventListener('mouseenter', () => {
        if (!pinned) open()
      })
      wrap.addEventListener('mouseleave', () => {
        if (!pinned) close()
      })
    }

    wrap.append(trigger, menu)
    return wrap
  }

  function mount() {
    const nav = document.querySelector('header.site nav')
    if (nav) {
      nav.prepend(buildDropdown())
      return
    }
    const bar = document.createElement('div')
    bar.className = 'dsg-standalone-nav'
    bar.appendChild(buildDropdown())
    document.body.prepend(bar)
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount)
  } else {
    mount()
  }
})()
