/**
 * "Show code" button, shared by every showcase page. Opens a modal with the exact authored
 * markup — tag, structure, and every data-kui* attribute — pretty-printed with real indentation.
 *
 * By the time this script runs, the animator has already mutated every [data-kui] element
 * (added data-kui-fx/data-kui-state, an inline animation-* style, etc.), so reading the live DOM
 * would show that runtime noise instead of what was actually authored. Instead this re-fetches
 * the page's own raw HTML (same technique docs.html uses for markdown) and pulls the pristine
 * element for each button from that untouched copy, matched by document order — independent of
 * where this script tag sits relative to the animator's own script tag.
 */
;(function () {
  const VOID_TAGS = new Set(['img', 'br', 'hr', 'input', 'meta', 'link'])
  const COPY_ICON =
    '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M5 2h6a2 2 0 0 1 2 2v6h-1.5V4a.5.5 0 0 0-.5-.5H5V2Zm-2 3h6a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm.5 1.5v7h6v-7h-6Z"/></svg>'
  const CHECK_ICON =
    '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M13.7 4.3a1 1 0 0 1 0 1.4l-6.5 6.5a1 1 0 0 1-1.4 0L2.3 8.7a1 1 0 1 1 1.4-1.4L6.5 10.1l5.8-5.8a1 1 0 0 1 1.4 0Z"/></svg>'

  function prettyPrint(el, depth) {
    const indent = '  '.repeat(depth)
    const tag = el.tagName.toLowerCase()
    const attrs = [...el.attributes].map((a) => `${a.name}="${a.value}"`).join(' ')
    const openTag = attrs ? `<${tag} ${attrs}>` : `<${tag}>`

    if (VOID_TAGS.has(tag)) return `${indent}${openTag.slice(0, -1)} />`

    const childLines = []
    for (const node of el.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent.trim()
        if (text) childLines.push('  '.repeat(depth + 1) + text)
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        childLines.push(prettyPrint(node, depth + 1))
      }
    }
    if (childLines.length === 0) return `${indent}${openTag}</${tag}>`
    return [indent + openTag, ...childLines, `${indent}</${tag}>`].join('\n')
  }

  function buildModal() {
    const backdrop = document.createElement('div')
    backdrop.className = 'kui-code-modal-backdrop'
    // Toggled via inline `display`, never the `hidden` attribute — the CSS below sets
    // `display: grid` on this class, which has equal specificity to the UA's `[hidden] {
    // display: none }` rule and wins by source order, leaving the modal visibly stuck open
    // regardless of `hidden` (same trap already documented in docs-nav.js's dropdown).
    backdrop.style.display = 'none'

    const dialog = document.createElement('div')
    dialog.className = 'kui-code-modal'
    dialog.setAttribute('role', 'dialog')
    dialog.setAttribute('aria-modal', 'true')
    dialog.setAttribute('aria-label', 'Element source')

    const closeBtn = document.createElement('button')
    closeBtn.type = 'button'
    closeBtn.className = 'kui-code-modal-close'
    closeBtn.setAttribute('aria-label', 'Close')
    closeBtn.textContent = '×'

    const header = document.createElement('div')
    header.className = 'kui-code-modal-header'
    header.appendChild(closeBtn)

    const tryIt = document.createElement('div')
    tryIt.className = 'kui-code-tryit'

    const input = document.createElement('input')
    input.type = 'text'
    input.className = 'kui-code-tryit-input'
    input.spellcheck = false
    input.setAttribute('aria-label', 'data-kui value')

    const copyBtn = document.createElement('button')
    copyBtn.type = 'button'
    copyBtn.className = 'kui-code-tryit-copy'
    copyBtn.setAttribute('aria-label', 'Copy value')
    copyBtn.innerHTML = COPY_ICON

    const applyBtn = document.createElement('button')
    applyBtn.type = 'button'
    applyBtn.className = 'kui-code-tryit-apply'
    applyBtn.textContent = 'Apply'

    const resetBtn = document.createElement('button')
    resetBtn.type = 'button'
    resetBtn.className = 'kui-code-tryit-reset'
    resetBtn.textContent = 'Reset'

    tryIt.append(input, copyBtn, applyBtn, resetBtn)

    const pre = document.createElement('pre')
    const code = document.createElement('code')
    pre.appendChild(code)

    dialog.append(header, tryIt, pre)
    backdrop.appendChild(dialog)
    document.body.appendChild(backdrop)

    let targetEl = null
    let originalValue = ''

    function applyValue(value) {
      if (!targetEl) return
      targetEl.setAttribute('data-kui', value)
      // Not window.__kui.play() — it rebuilds data-kui itself from a bare effect name and would
      // silently drop the trigger/duration/params just typed above. reset()+process()+activate()
      // is the same replay sequence play() uses internally, minus that attribute rewrite, so the
      // edited value survives and the effect still reruns immediately regardless of its trigger.
      window.__kui.reset(targetEl)
      window.__kui.process(targetEl)
      window.__kui.activate(targetEl)
    }

    function close() {
      backdrop.style.display = 'none'
    }
    function open(liveEl, sourceEl) {
      targetEl = liveEl
      originalValue = sourceEl.getAttribute('data-kui') ?? ''
      code.textContent = prettyPrint(sourceEl, 0)
      input.value = originalValue
      backdrop.style.display = 'grid'
      closeBtn.focus()
    }
    closeBtn.addEventListener('click', close)
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) close()
    })
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !backdrop.hidden) close()
    })

    applyBtn.addEventListener('click', () => applyValue(input.value))
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') applyValue(input.value)
    })
    resetBtn.addEventListener('click', () => {
      input.value = originalValue
      applyValue(originalValue)
    })

    let copyResetTimer = null
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(input.value)
      } catch (e) {
        return
      }
      copyBtn.innerHTML = CHECK_ICON
      copyBtn.classList.add('is-copied')
      clearTimeout(copyResetTimer)
      copyResetTimer = setTimeout(() => {
        copyBtn.innerHTML = COPY_ICON
        copyBtn.classList.remove('is-copied')
      }, 1200)
    })

    return { open }
  }

  function mountToggle(liveEl, sourceEl, modal) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'kui-show-code-toggle'
    button.textContent = 'Show code'
    button.addEventListener('click', () => modal.open(liveEl, sourceEl))

    // Append inside the card's own container (figure, .text-demo, or whatever wraps it), not as
    // a sibling of the animated element itself — in a CSS grid layout (every showcase page's
    // .grid), a sibling insertion becomes its own independent grid cell instead of sitting under
    // the card it belongs to.
    const card = liveEl.closest('figure, .text-demo') ?? liveEl.parentElement
    card.appendChild(button)
  }

  async function init() {
    const liveEls = [...document.querySelectorAll('[data-kui]')]
    if (liveEls.length === 0) return

    let sourceEls
    try {
      const res = await fetch(location.pathname)
      if (!res.ok) throw new Error('HTTP ' + res.status)
      const html = await res.text()
      const doc = new DOMParser().parseFromString(html, 'text/html')
      sourceEls = [...doc.querySelectorAll('[data-kui]')]
    } catch (e) {
      return // no pristine source available — fail quiet, no broken buttons
    }

    const modal = buildModal()
    liveEls.forEach((liveEl, i) => {
      const source = sourceEls[i]
      if (source) mountToggle(liveEl, source, modal)
    })
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }
})()
