/**
 * Vanilla-JS replacement for the former Alpine `siteNav` component. Shared by every showcase page
 * plus the standalone Docs-only bar on demo/index.html — pages without a mobile panel/hamburger
 * (e.g. index.html) simply don't have those elements, and every DOM lookup here is null-checked.
 *
 * One shared `open` slot (`null` | a `data-nav-group` id) makes "only one dropdown open at a time"
 * true by construction. `pinned` distinguishes a real click (stays open past mouseleave) from
 * hover (closes on mouseleave unless pinned) — checked against `open === id`, not "is something
 * open", so a click on an already-hover-opened trigger still registers as the pin it is. `canHover`
 * keeps hover-driven open/close off touch devices, which would otherwise hit the classic
 * first-tap-only-synthesizes-hover trap.
 *
 * Dropdown menus and the mobile nav panel start `hidden` in markup (this file's equivalent of
 * Alpine's `x-cloak`: hidden from first paint, corrected the instant this script — loaded with
 * `defer`, so it already runs post-parse before paint — takes over). Opening one calls
 * `window.__kui.play(el, 'dropdown-open' | 'menu-stagger-open')` against its `data-kui="...
 * on:manual"` markup, in the same synchronous step as clearing `hidden`: the effect's keyframes
 * only declare a `from` state (see src/css/navigation.css), so the element's un-animated resting
 * style already *is* the open state — the reveal only reads as motion if playback starts before
 * the first paint after `hidden` is cleared. Closing is an instant hide, matching the nav's
 * previous behavior (no exit transition existed under Alpine either).
 */
;(function () {
  function initNav(root) {
    var groupEls = root.querySelectorAll('[data-nav-group]')
    if (!groupEls.length) return

    var navPanel = root.querySelector('[data-nav-panel]')
    var hamburger = root.querySelector('[data-nav-hamburger]')
    var backdrop = root.querySelector('[data-nav-backdrop]')
    var currentFile = location.pathname.split('/').pop()

    var groups = Array.prototype.map.call(groupEls, function (el) {
      return {
        id: el.getAttribute('data-nav-group'),
        el: el,
        trigger: el.querySelector('.kui-nav-dropdown-trigger'),
        menu: el.querySelector('.kui-nav-dropdown-menu'),
      }
    })

    function findGroup(id) {
      for (var i = 0; i < groups.length; i++) if (groups[i].id === id) return groups[i]
      return null
    }

    function kui() {
      return window.__kui
    }

    // --- static, computed once: active-page indicator ---
    var activeName = currentFile === '' ? 'index.html' : currentFile
    groups.forEach(function (g) {
      var pages = (g.trigger.getAttribute('data-nav-pages') || '').split(',').filter(Boolean)
      if (pages.indexOf(activeName) !== -1 || pages.indexOf(currentFile) !== -1) g.trigger.classList.add('is-active')
      var links = g.menu.querySelectorAll('[data-nav-link]')
      Array.prototype.forEach.call(links, function (a) {
        var linkTarget = a.getAttribute('data-nav-link')
        if (linkTarget === activeName || linkTarget === currentFile) a.setAttribute('aria-current', 'page')
      })
    })

    // --- dropdown state ---
    var open = null
    var pinned = false

    function closeDropdownDom(g) {
      g.trigger.setAttribute('aria-expanded', 'false')
      g.menu.hidden = true
    }

    function openDropdown(id) {
      if (open === id) return
      var previous = open ? findGroup(open) : null
      if (previous) closeDropdownDom(previous)
      var g = findGroup(id)
      if (!g) return
      open = id
      g.trigger.setAttribute('aria-expanded', 'true')
      g.menu.hidden = false
      if (kui()) kui().play(g.menu, 'dropdown-open')
    }

    function closeDropdown(id) {
      if (open !== id) return
      var g = findGroup(id)
      if (g) closeDropdownDom(g)
      open = null
      pinned = false
    }

    function toggleDropdown(id) {
      if (pinned && open === id) {
        closeDropdown(id)
      } else {
        openDropdown(id)
        pinned = true
      }
    }

    function hoverOpenDropdown(id) {
      if (!canHover) return
      if (open === id && pinned) return
      openDropdown(id)
      pinned = false
    }

    function hoverCloseDropdown(id) {
      if (!canHover) return
      if (open === id && !pinned) closeDropdown(id)
    }

    // --- mobile panel + hamburger breakpoint ---
    var narrow = false
    var mobileOpen = false

    function setMobileOpen(value) {
      if (!hamburger || !navPanel) return
      if (mobileOpen === value) return
      mobileOpen = value
      hamburger.setAttribute('aria-expanded', String(mobileOpen))
      if (!narrow) return // desktop: nav panel visibility isn't driven by mobileOpen at all
      if (mobileOpen) {
        navPanel.hidden = false
        if (backdrop) backdrop.hidden = false
        if (kui()) kui().play(navPanel, 'menu-stagger-open')
      } else {
        navPanel.hidden = true
        if (backdrop) backdrop.hidden = true
      }
    }

    function applyNarrow(isNarrow) {
      narrow = isNarrow
      mobileOpen = false
      if (hamburger) hamburger.setAttribute('aria-expanded', 'false')
      if (navPanel) navPanel.hidden = narrow
      if (backdrop) backdrop.hidden = true
    }

    function closeAll() {
      if (open) closeDropdown(open)
      setMobileOpen(false)
    }

    // --- wiring ---
    var canHover = false
    try {
      var hoverCapable = window.matchMedia('(hover: hover) and (pointer: fine)')
      canHover = hoverCapable.matches
    } catch (e) {}

    if (navPanel || hamburger) {
      // Must match the CSS mobile-nav breakpoint exactly (`@media (max-width: 720px)`) — a
      // mismatch here previously left a dead zone where JS treated the layout as mobile
      // (hamburger-controlled, panel hidden by default) while CSS still rendered the desktop
      // inline nav row, which opacity:1!important couldn't undo since it doesn't touch display.
      var narrowViewport = window.matchMedia('(max-width: 720px)')
      applyNarrow(narrowViewport.matches)
      narrowViewport.addEventListener('change', function (event) {
        applyNarrow(event.matches)
      })
    }

    groups.forEach(function (g) {
      g.trigger.addEventListener('click', function () {
        toggleDropdown(g.id)
      })
      g.el.addEventListener('mouseenter', function () {
        hoverOpenDropdown(g.id)
      })
      g.el.addEventListener('mouseleave', function () {
        hoverCloseDropdown(g.id)
      })
    })

    if (hamburger) {
      hamburger.addEventListener('click', function (event) {
        event.stopPropagation()
        setMobileOpen(!mobileOpen)
      })
    }

    // Backdrop is the primary close-on-outside-click mechanism: a full-viewport layer behind the
    // panel and in front of the page, so every click outside the panel has one unambiguous target
    // to hit regardless of what's rendered underneath (fixes the panel appearing to sit over page
    // content with nothing to click through to close it). The document-level listener below is
    // kept as a fallback for pages that don't render a backdrop element.
    if (backdrop) {
      backdrop.addEventListener('click', function () {
        setMobileOpen(false)
      })
    }

    document.addEventListener('click', function (event) {
      if (open) {
        var g = findGroup(open)
        if (g && !g.el.contains(event.target)) closeDropdown(open)
      }
      if (mobileOpen && navPanel && !navPanel.contains(event.target) && event.target !== backdrop) {
        setMobileOpen(false)
      }
    })

    window.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') closeAll()
    })
  }

  var roots = document.querySelectorAll('[data-nav-root]')
  Array.prototype.forEach.call(roots, initNav)
})()
