/**
 * Toggle-button mounting and click/persistence logic for the shared showcase theme.
 *
 * Initial theme *resolution* (reading storage/OS preference and setting
 * `document.documentElement.dataset.theme`) happens synchronously in an inline `<head>` script on
 * each page, before any stylesheet paints — see the FOUC note there. By the time this file runs,
 * `dataset.theme` is already correct; this file only has to read it, not recompute it.
 */
;(function () {
  const STORAGE_KEY = 'designimation-showcase-theme'

  const SUN_ICON =
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
    '<circle cx="12" cy="12" r="5"></circle>' +
    '<line x1="12" y1="1" x2="12" y2="3"></line>' +
    '<line x1="12" y1="21" x2="12" y2="23"></line>' +
    '<line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>' +
    '<line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>' +
    '<line x1="1" y1="12" x2="3" y2="12"></line>' +
    '<line x1="21" y1="12" x2="23" y2="12"></line>' +
    '<line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>' +
    '<line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>' +
    '</svg>'

  const MOON_ICON =
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
    '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z"></path>' +
    '</svg>'

  function saveTheme(theme) {
    try {
      localStorage.setItem(STORAGE_KEY, theme)
    } catch {
      // A blocked storage API should not prevent the in-page toggle from working.
    }
  }

  function currentTheme() {
    return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'
  }

  // The icon shown is the mode a click switches *to* — a sun in dark mode invites you toward
  // light, a moon in light mode invites you toward dark.
  function applyTheme(theme, button) {
    document.documentElement.dataset.theme = theme
    button.innerHTML = theme === 'dark' ? SUN_ICON : MOON_ICON
    button.setAttribute('aria-label', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode')
    button.setAttribute('aria-pressed', String(theme === 'light'))
  }

  function mountThemeToggle() {
    const header = document.querySelector('header.site')
    if (!header) return
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'dsg-theme-toggle'
    applyTheme(currentTheme(), button)
    button.addEventListener('click', () => {
      const next = currentTheme() === 'light' ? 'dark' : 'light'
      applyTheme(next, button)
      saveTheme(next)
    })
    header.appendChild(button)
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountThemeToggle)
  } else {
    mountThemeToggle()
  }
})()
