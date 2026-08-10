/** Shared, persistent color-scheme toggle for every showcase page. */
;(function () {
  const STORAGE_KEY = 'designimation-showcase-theme'

  function savedTheme() {
    try {
      return localStorage.getItem(STORAGE_KEY) === 'light' ? 'light' : 'dark'
    } catch {
      return 'dark'
    }
  }

  function saveTheme(theme) {
    try {
      localStorage.setItem(STORAGE_KEY, theme)
    } catch {
      // A blocked storage API should not prevent the in-page toggle from working.
    }
  }

  function applyTheme(theme, button) {
    document.documentElement.dataset.theme = theme
    button.textContent = theme === 'dark' ? 'Light mode' : 'Dark mode'
    button.setAttribute('aria-pressed', String(theme === 'light'))
  }

  function mountThemeToggle() {
    const header = document.querySelector('header.site')
    if (!header) return
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'dsg-theme-toggle'
    button.setAttribute('aria-label', 'Toggle showcase color scheme')
    applyTheme(savedTheme(), button)
    button.addEventListener('click', () => {
      const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light'
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
