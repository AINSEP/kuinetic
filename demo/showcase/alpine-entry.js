/**
 * Self-hosted Alpine.js bootstrap for the showcase site's nav — bundled locally (esbuild, see the
 * `demo` npm script), never loaded from a CDN. This is the standard bundled-Alpine entry point:
 * import the module build, expose it on `window` (so `Alpine.data(...)` calls anywhere else and
 * the Alpine devtools can find it), then call `Alpine.start()` explicitly. The CDN build
 * (`alpinejs/dist/cdn.js`) self-starts on script load and is a different entry point entirely —
 * not used here.
 *
 * `Alpine.start()` defers its actual DOM scan to `DOMContentLoaded` if the document is still
 * loading, exactly like the old `docs-nav.js` / `section-nav.js` each did by hand
 * (`document.readyState === 'loading' ? addEventListener('DOMContentLoaded', mount) : mount()`).
 * That means where this script tag sits on the page matters far less than it existing on `window`
 * at all before Alpine tries to read `x-data` markup — see each page's `<head>` for placement.
 */
import Alpine from 'alpinejs'

/**
 * Shared nav state for every showcase page's `<header class="site">` (four dropdown triggers +
 * a hamburger) and for `demo/index.html`'s standalone Docs-only bar (same component, registered
 * once and reused — see the root-relative Docs links there for why that page still needs it).
 *
 * State shape: ONE `open` slot (`null | 'docs' | 'reveals-scroll' | 'interactive-data' |
 * 'feedback-chrome'`) rather than four independent booleans. That single slot is what makes
 * "only one dropdown open at a time" true *by construction* — there is only one value, so at most
 * one dropdown can ever equal it — instead of relying on a registry-and-loop that closes
 * everyone else on open (the old `window.__dsgNavDropdowns` array both files pushed `close`
 * callbacks into, which is what the original `stopPropagation()` bug slipped through).
 *
 * `pinned` tracks whether the *current* `open` dropdown was opened by a click (stays open on
 * mouseleave until outside-click/Escape/another trigger) versus by hover (closes on mouseleave
 * unless something pins it first). Because only one dropdown can be open at once, one shared
 * `pinned` flag is enough — it always describes whichever dropdown `open` currently names.
 */
Alpine.data('siteNav', () => ({
  open: null,
  pinned: false,
  mobileOpen: false,
  narrow: false,
  canHover: false,
  currentFile: '',

  init() {
    // Hover-driven open/close is desktop-only. Wiring it unconditionally hits the classic
    // touchscreen trap: the first tap only fires a synthesized `:hover`/`mouseenter`, and a
    // second tap is then needed for the actual click. `hoverOpen`/`hoverClose` below no-op
    // whenever `canHover` is false, so touch devices never get hover-driven state changes even
    // though the listeners are always bound (Alpine has no declarative way to conditionally bind
    // an event listener on a static media-query check, so the guard lives in the handler).
    const hoverCapable = window.matchMedia('(hover: hover) and (pointer: fine)')
    this.canHover = hoverCapable.matches

    // Which page we're on, for the active-trigger/aria-current indicator — same technique the old
    // section-nav.js used (docs-nav.js never implemented this for its own Docs trigger, and this
    // preserves that: the Docs trigger never gets an active state, even on docs.html).
    this.currentFile = location.pathname.split('/').pop()

    // Below 768px the nav row collapses behind the hamburger; matches style.css's
    // `@media (max-width: 768px)` breakpoint exactly (see the comment there — layout there is
    // CSS-owned, `display` stays JS/Alpine-owned).
    const narrowViewport = window.matchMedia('(max-width: 768px)')
    this.narrow = narrowViewport.matches
    narrowViewport.addEventListener('change', (event) => {
      this.narrow = event.matches
      this.mobileOpen = false
    })
  },

  isOpen(id) {
    return this.open === id
  },

  isActive(...files) {
    return files.includes(this.currentFile)
  },

  // A click on an already-pinned-open dropdown closes it; a click on a closed-or-merely-hovered
  // dropdown opens and pins it. Keyed off `pinned`, not just "is something open" — a real mouse
  // click is preceded by a real mouse move, which fires `mouseenter` (and hover-opens the menu)
  // *before* the click event itself arrives. Toggling on "is open" alone would see "already open"
  // on that first click and immediately close what hover had just opened.
  toggleDropdown(id) {
    if (this.pinned && this.open === id) {
      this.close(id)
    } else {
      this.open = id
      this.pinned = true
    }
  },

  hoverOpen(id) {
    if (!this.canHover) return
    if (this.open === id && this.pinned) return
    this.open = id
    this.pinned = false
  },

  hoverClose(id) {
    if (!this.canHover) return
    if (this.open === id && !this.pinned) this.close(id)
  },

  // Guarded by `this.open === id`: an outside click on dropdown A firing *after* a direct click on
  // trigger B (both listeners run in the same bubble phase, A's `@click.outside` resolves last)
  // must not clobber the `open = 'B'` that B's own `@click` just set. Comparing against `id` makes
  // that a no-op instead of a race.
  close(id) {
    if (this.open === id) {
      this.open = null
      this.pinned = false
    }
  },

  closeAll() {
    this.open = null
    this.pinned = false
    this.mobileOpen = false
  },
}))

window.Alpine = Alpine
Alpine.start()
