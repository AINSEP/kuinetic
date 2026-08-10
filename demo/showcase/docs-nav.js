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
 */
;(function () {
  const LINKS = [
    { label: 'Catalog', href: '/demo/showcase/docs.html?doc=catalog' },
    { label: 'Architecture', href: '/demo/showcase/docs.html?doc=design' },
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
