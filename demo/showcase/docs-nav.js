/**
 * "Docs" dropdown, shared by every showcase page and the root demo page.
 *
 * On the three showcase pages it prepends into the existing `header.site nav` as the first
 * item. `demo/index.html` carries no showcase chrome at all (no header, no style.css), so there
 * it mounts a minimal standalone bar instead — see `mount()`.
 *
 * Links are root-relative (`/docs/...`) because they only resolve when the whole repo is served
 * from its root (`npm run showcase`, not `cd demo && python3 -m http.server`) — `demo/` alone has
 * no `docs/` subtree to serve.
 */
;(function () {
  const LINKS = [
    { label: 'Catalog', href: '/docs/catalog.md' },
    { label: 'Architecture', href: '/docs/design.md' },
  ]

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

    function close() {
      menu.style.display = 'none'
      trigger.setAttribute('aria-expanded', 'false')
    }
    function open() {
      menu.style.display = 'flex'
      trigger.setAttribute('aria-expanded', 'true')
    }
    trigger.addEventListener('click', (event) => {
      event.stopPropagation()
      if (menu.style.display === 'none') open()
      else close()
    })
    document.addEventListener('click', (event) => {
      if (!wrap.contains(event.target)) close()
    })
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') close()
    })

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
