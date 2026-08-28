/**
 * Vanilla-JS replacement for the former Alpine `siteNav` component. Shared by every showcase page.
 * Every DOM lookup here is null-checked, which used to matter for a reduced Docs-only variant of
 * demo/index.html — that variant is gone (index.html's header is the same 4-group structure as
 * every other page now, just with self-referential logo/CTA hrefs), but the null-checks stay
 * because they're cheap insurance and this file is still the one place a future stripped-down
 * header would need to keep working without extra wiring.
 *
 * As of the nav-consolidation pass, this file owns the dropdown-group MARKUP as well as its
 * behavior. It used to only wire up behavior against 14 hand-duplicated copies of the same
 * ~60-line `<nav data-nav-panel>…</nav>` block (docs/basic/advanced/designs groups) — one edit to
 * the link list meant editing all 14 files, and it was only a matter of time before one drifted.
 * `NAV_GROUPS` below is now the single source of truth for that block's content, and
 * `buildNavGroups()` renders it into any page's empty `<nav data-nav-panel></nav>` mount point
 * before the behavior wiring below ever runs. A page that still carries the old hand-authored
 * groups (mid-migration) is left alone — generation only fires when the mount point has no
 * `[data-nav-group]` children yet, so the two forms coexist safely while pages migrate one at a
 * time. `kuinetic()`'s `observe: true` watcher (see src/core/animator.ts) is what makes markup
 * inserted here after `.start()` still pick up its own `data-kui="dropdown-open on:manual"` effect
 * — the same MutationObserver-backed path every other dynamically-inserted `data-kui` element on
 * these pages already relies on.
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
  /**
   * The four dropdown groups, verbatim content for every page. `pages` becomes each trigger's
   * `data-nav-pages` (comma list `initNav`'s active-highlighting already reads — see below); a
   * group with no `pages` (Docs) never gets `is-active` styling, matching the original hand-authored
   * markup, which never gave the Docs trigger that attribute either. Each link's `page`, when
   * present, becomes its `data-nav-link`, the other half of that same active-highlighting pass.
   */
  var NAV_GROUPS = [
    {
      id: 'docs',
      label: 'Docs',
      links: [
        { href: './docs.html?doc=getting-started', label: 'Getting Started' },
        { href: './docs.html?doc=catalog', label: 'Catalog' },
        { href: './docs.html?doc=design', label: 'Architecture' },
      ],
    },
    {
      id: 'basic',
      label: 'Basic',
      pages: ['reveals.html', 'text.html', 'ambient-feedback.html', 'tween.html'],
      links: [
        { href: './reveals.html', label: 'Reveals', page: 'reveals.html' },
        { href: './text.html', label: 'Text', page: 'text.html' },
        { href: './ambient-feedback.html', label: 'Ambient & Feedback', page: 'ambient-feedback.html' },
        { href: './tween.html', label: 'Tween', page: 'tween.html' },
      ],
    },
    {
      id: 'advanced',
      label: 'Advanced',
      pages: ['scroll.html', 'interactive.html', 'data-hover.html', 'tween-advanced.html'],
      links: [
        { href: './scroll.html', label: 'Scroll', page: 'scroll.html' },
        { href: './interactive.html', label: 'Interactive', page: 'interactive.html' },
        { href: './data-hover.html', label: 'Data & Hover', page: 'data-hover.html' },
        { href: './tween-advanced.html', label: 'Tween Advanced', page: 'tween-advanced.html' },
      ],
    },
    {
      id: 'designs',
      label: 'Designs',
      pages: ['index.html'],
      links: [{ href: './index.html', label: 'Premium', page: 'index.html' }],
      comingSoon: true,
    },
  ]

  /**
   * Render `NAV_GROUPS` into an empty `<nav data-nav-panel>` mount point.
   *
   * Built with `createElement`/`textContent`, never `innerHTML` — same reasoning as
   * `show-code.js`'s `renderSource`: nothing here is untrusted input, but a plain-DOM builder can't
   * accidentally reinterpret a label as markup either, so there's no reason to reach for the riskier
   * tool. Caller is responsible for only invoking this on a panel that doesn't already have groups.
   *
   * @complexity O(g·l) time in groups × links; one-time cost per page load.
   */
  function buildNavGroups(navPanel) {
    NAV_GROUPS.forEach(function (group) {
      var wrap = document.createElement('div')
      wrap.className = 'kui-nav-dropdown'
      wrap.setAttribute('data-nav-group', group.id)

      var trigger = document.createElement('button')
      trigger.type = 'button'
      trigger.className = 'kui-nav-dropdown-trigger'
      trigger.setAttribute('aria-haspopup', 'true')
      trigger.setAttribute('aria-expanded', 'false')
      if (group.pages) trigger.setAttribute('data-nav-pages', group.pages.join(','))
      trigger.textContent = group.label

      var menu = document.createElement('div')
      menu.className = 'kui-nav-dropdown-menu'
      menu.setAttribute('data-kui', 'dropdown-open on:manual')
      menu.hidden = true

      group.links.forEach(function (link) {
        var a = document.createElement('a')
        a.setAttribute('href', link.href)
        if (link.page) a.setAttribute('data-nav-link', link.page)
        a.textContent = link.label
        menu.appendChild(a)
      })

      if (group.comingSoon) {
        var soon = document.createElement('span')
        soon.className = 'kui-nav-coming-soon'
        soon.textContent = 'Coming soon'
        menu.appendChild(soon)
      }

      wrap.appendChild(trigger)
      wrap.appendChild(menu)
      navPanel.appendChild(wrap)
    })
  }

  function initNav(root) {
    var navPanel = root.querySelector('[data-nav-panel]')
    if (navPanel && !navPanel.querySelector('[data-nav-group]')) buildNavGroups(navPanel)

    var groupEls = root.querySelectorAll('[data-nav-group]')
    if (!groupEls.length) return

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
    var closeTimer = null
    var HOVER_CLOSE_DELAY = 5000

    function clearCloseTimer() {
      if (closeTimer) {
        clearTimeout(closeTimer)
        closeTimer = null
      }
    }

    function closeDropdownDom(g) {
      g.trigger.setAttribute('aria-expanded', 'false')
      g.menu.hidden = true
    }

    function openDropdown(id) {
      clearCloseTimer()
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
      clearCloseTimer()
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
      clearCloseTimer()
      if (open === id) return
      openDropdown(id)
      pinned = false
    }

    // Mouse leaving the trigger/menu doesn't close right away — it waits HOVER_CLOSE_DELAY in
    // case that was just the small gap between the trigger and the menu below it, or the user
    // glancing away for a second. Moving back in (hoverOpenDropdown) cancels this timer. A
    // click-pinned dropdown is left alone here — it only closes on an explicit outside click
    // or Escape, same as before.
    function hoverCloseDropdown(id) {
      if (!canHover) return
      if (open !== id || pinned) return
      clearCloseTimer()
      closeTimer = setTimeout(function () {
        closeDropdown(id)
      }, HOVER_CLOSE_DELAY)
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

  /**
   * Theme toggle — the button lives inside the same `[data-nav-root]` header as the nav groups
   * above, and until this pass its full behavior script (paint the icon, flip
   * `document.documentElement.dataset.theme`, persist to storage) was duplicated verbatim as an
   * inline `<script>` at the bottom of every page. Consolidated here for the same reason as
   * `NAV_GROUPS`: one place to fix instead of 13.
   *
   * `THEME_STORAGE_KEY` deliberately matches the key name the FOUC-prevention bootstrap script
   * still inline in each page's `<head>` uses (see reveals.html) — that script resolves the
   * *initial* `dataset.theme` from storage/OS preference before first paint, synchronously, which
   * cannot move here without reintroducing the flash this file's `defer` timing exists to avoid.
   * This code only has to read the value that bootstrap already set, and persist the next one.
   */
  var THEME_STORAGE_KEY = 'kuinetic-showcase-theme'
  var THEME_SUN_ICON =
    '<circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line>' +
    '<line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>' +
    '<line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line>' +
    '<line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>' +
    '<line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>'
  var THEME_MOON_ICON = '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z"></path>'

  /**
   * Build the toggle button, matching the markup every page hand-authored before this pass byte
   * for byte: `class="theme-toggle" id="theme-toggle"` is what `system.css`'s circular-button rule
   * selects, and the child `<svg id="theme-icon">` is what `wireThemeToggle` repaints on click.
   * The svg needs `createElementNS` — a plain `createElement('svg')` yields an unstyled
   * `HTMLUnknownElement`, not something the browser renders as a vector icon.
   */
  function buildThemeToggle() {
    var btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'theme-toggle'
    btn.id = 'theme-toggle'
    btn.setAttribute('aria-label', 'Switch to dark mode')
    btn.setAttribute('aria-pressed', 'false')

    var icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    icon.setAttribute('id', 'theme-icon')
    icon.setAttribute('viewBox', '0 0 24 24')
    icon.setAttribute('width', '16')
    icon.setAttribute('height', '16')
    icon.setAttribute('fill', 'none')
    icon.setAttribute('stroke', 'currentColor')
    icon.setAttribute('stroke-width', '2')
    icon.setAttribute('stroke-linecap', 'round')
    icon.setAttribute('stroke-linejoin', 'round')
    icon.setAttribute('aria-hidden', 'true')

    btn.appendChild(icon)
    return btn
  }

  /** Paint/click/persistence behavior — the part of every page's old inline script that wasn't markup. */
  function wireThemeToggle(btn) {
    var icon = btn.querySelector('#theme-icon')
    if (!icon) return

    function current() {
      return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
    }
    function paint(theme) {
      icon.innerHTML = theme === 'dark' ? THEME_SUN_ICON : THEME_MOON_ICON
      btn.setAttribute('aria-label', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode')
      btn.setAttribute('aria-pressed', String(theme === 'dark'))
    }

    paint(current())
    btn.addEventListener('click', function () {
      var next = current() === 'dark' ? 'light' : 'dark'
      document.documentElement.dataset.theme = next
      paint(next)
      try {
        localStorage.setItem(THEME_STORAGE_KEY, next)
      } catch (e) {}
    })
  }

  /**
   * Only acts on a migrated page's empty `<span data-theme-toggle-mount>`. A page still carrying
   * its own hand-authored `#theme-toggle` button and inline script (mid-migration) is left
   * completely alone — wiring a second click handler on top of its still-present original would
   * double-fire the toggle and flip the theme twice per click.
   */
  function initThemeToggle(root) {
    var mount = root.querySelector('[data-theme-toggle-mount]')
    if (!mount) return
    var btn = buildThemeToggle()
    mount.replaceWith(btn)
    wireThemeToggle(btn)
  }

  /**
   * Footer — pure static content, no behavior, but the same byte-identical duplication problem as
   * the nav groups: 12 of the 13 in-scope pages hand-authored the same five lines (`docs.html` has
   * no footer at all and carries no mount, so it's untouched). Same conditional-fill pattern as
   * `buildNavGroups`: only acts on an empty `<footer data-footer-mount>`.
   */
  function buildFooterContent() {
    var wrap = document.createElement('div')
    wrap.className = 'wrap foot-row'

    var note = document.createElement('p')
    note.className = 'foot-note'
    note.textContent = 'kUInetic — MIT licensed. Declarative web animation from HTML attributes.'

    var back = document.createElement('a')
    back.setAttribute('href', '#top')
    back.className = 'back-top'
    back.textContent = 'Back to top ↑'

    wrap.appendChild(note)
    wrap.appendChild(back)
    return wrap
  }

  function initFooter(footer) {
    if (footer.querySelector('.foot-row')) return
    footer.appendChild(buildFooterContent())
  }

  var roots = document.querySelectorAll('[data-nav-root]')
  Array.prototype.forEach.call(roots, function (root) {
    initNav(root)
    initThemeToggle(root)
  })

  var footerMounts = document.querySelectorAll('[data-footer-mount]')
  Array.prototype.forEach.call(footerMounts, initFooter)
})()
