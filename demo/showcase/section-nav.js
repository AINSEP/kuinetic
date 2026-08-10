/**
 * Section-group dropdowns for the 7 demo pages ("Reveals & Scroll", "Interactive & Data",
 * "Feedback & Chrome"), plus the hamburger that collapses the whole `header.site nav` row below
 * the narrow-viewport breakpoint.
 *
 * Deliberately a separate file from docs-nav.js: that one is explicitly the "Docs" menu and is
 * also shared by demo/index.html, which carries none of this showcase chrome (no header, no
 * style.css). This script only ever runs on the 8 showcase pages, all at one directory depth, so
 * — unlike docs-nav.js — hrefs here are plain same-directory relative (`./reveals.html`).
 *
 * Dropdown behavior/markup mirrors docs-nav.js exactly: same `.dsg-nav-dropdown` /
 * `-trigger` / `-menu` classes, same inline-`style.display`-only toggling (never `hidden` — an
 * authored `display` rule on these classes would beat the UA `[hidden]` rule at equal specificity
 * by source order, leaving a menu stuck open), same hover-opens/click-pins behavior, and both
 * files' dropdowns share one `window.__dsgNavDropdowns` registry so opening any one of the four
 * closes the rest.
 */
;(function () {
  const GROUPS = [
    {
      label: 'Reveals & Scroll',
      links: [
        { label: 'Reveals', href: './reveals.html' },
        { label: 'Scroll', href: './scroll.html' },
      ],
    },
    {
      label: 'Interactive & Data',
      links: [
        { label: 'Interactive', href: './interactive.html' },
        { label: 'Text', href: './text.html' },
        { label: 'Data & Hover', href: './data-hover.html' },
      ],
    },
    {
      label: 'Feedback & Chrome',
      links: [
        { label: 'Ambient & Feedback', href: './ambient-feedback.html' },
        { label: 'Nav & Forms', href: './nav-forms.html' },
      ],
    },
  ]

  const NARROW = window.matchMedia('(max-width: 768px)')
  const currentFile = location.pathname.split('/').pop()

  // Shared with docs-nav.js — every showcase page loads both, and only one dropdown should ever
  // be open at once. Each dropdown registers its own `close` here, so opening one can force-close
  // every other regardless of which file built it.
  window.__dsgNavDropdowns = window.__dsgNavDropdowns || []

  // Hover open/close is desktop-only. Wiring it unconditionally would hit the classic touchscreen
  // trap: first tap only fires the synthesized `:hover`/mouseenter, second tap is needed for the
  // click.
  const CAN_HOVER = window.matchMedia('(hover: hover) and (pointer: fine)').matches

  function buildDropdown(group) {
    const wrap = document.createElement('div')
    wrap.className = 'dsg-nav-dropdown'

    const trigger = document.createElement('button')
    trigger.type = 'button'
    trigger.className = 'dsg-nav-dropdown-trigger'
    trigger.textContent = group.label
    trigger.setAttribute('aria-haspopup', 'true')
    trigger.setAttribute('aria-expanded', 'false')

    const menu = document.createElement('div')
    menu.className = 'dsg-nav-dropdown-menu'
    menu.style.display = 'none'
    for (const { label, href } of group.links) {
      const a = document.createElement('a')
      a.href = href
      a.textContent = label
      if (href === './' + currentFile) {
        a.setAttribute('aria-current', 'page')
        trigger.classList.add('is-active')
      }
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

  const HAMBURGER_ICON =
    '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" aria-hidden="true" focusable="false">' +
    '<line x1="3" y1="6" x2="21" y2="6"></line>' +
    '<line x1="3" y1="12" x2="21" y2="12"></line>' +
    '<line x1="3" y1="18" x2="21" y2="18"></line>' +
    '</svg>'

  // Owns nav's inline `display` for the narrow layout the same way each dropdown owns its own
  // menu's — visibility here is never left to a CSS media query alone, so there's nothing for an
  // authored `display` rule to race against.
  function buildToggle(nav) {
    const toggle = document.createElement('button')
    toggle.type = 'button'
    toggle.className = 'dsg-nav-toggle'
    toggle.setAttribute('aria-haspopup', 'true')
    toggle.setAttribute('aria-expanded', 'false')
    toggle.setAttribute('aria-label', 'Toggle navigation menu')
    toggle.innerHTML = HAMBURGER_ICON

    let isOpen = false
    function sync() {
      nav.style.display = NARROW.matches && !isOpen ? 'none' : 'flex'
      toggle.setAttribute('aria-expanded', String(NARROW.matches && isOpen))
    }
    toggle.addEventListener('click', (event) => {
      event.stopPropagation()
      isOpen = !isOpen
      sync()
    })
    document.addEventListener('click', (event) => {
      if (isOpen && !nav.contains(event.target)) {
        isOpen = false
        sync()
      }
    })
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && isOpen) {
        isOpen = false
        sync()
      }
    })
    NARROW.addEventListener('change', () => {
      isOpen = false
      sync()
    })

    sync()
    return toggle
  }

  function mount() {
    const header = document.querySelector('header.site')
    const nav = header && header.querySelector('nav')
    if (!header || !nav) return
    for (const group of GROUPS) nav.append(buildDropdown(group))
    header.appendChild(buildToggle(nav))
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount)
  } else {
    mount()
  }
})()
