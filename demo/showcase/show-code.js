/**
 * "Show code" button, shared by every showcase page. Opens a modal with the exact authored
 * markup — tag, structure, and every data-dsg* attribute — pretty-printed with real indentation.
 *
 * By the time this script runs, the animator has already mutated every [data-dsg] element
 * (added data-dsg-fx/data-dsg-state, an inline animation-* style, etc.), so reading the live DOM
 * would show that runtime noise instead of what was actually authored. Instead this re-fetches
 * the page's own raw HTML (same technique docs.html uses for markdown) and pulls the pristine
 * element for each button from that untouched copy, matched by document order — independent of
 * where this script tag sits relative to the animator's own script tag.
 */
;(function () {
  const VOID_TAGS = new Set(['img', 'br', 'hr', 'input', 'meta', 'link'])

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
    backdrop.className = 'dsg-code-modal-backdrop'
    backdrop.hidden = true

    const dialog = document.createElement('div')
    dialog.className = 'dsg-code-modal'
    dialog.setAttribute('role', 'dialog')
    dialog.setAttribute('aria-modal', 'true')
    dialog.setAttribute('aria-label', 'Element source')

    const closeBtn = document.createElement('button')
    closeBtn.type = 'button'
    closeBtn.className = 'dsg-code-modal-close'
    closeBtn.setAttribute('aria-label', 'Close')
    closeBtn.textContent = '×'

    const pre = document.createElement('pre')
    const code = document.createElement('code')
    pre.appendChild(code)

    dialog.append(closeBtn, pre)
    backdrop.appendChild(dialog)
    document.body.appendChild(backdrop)

    function close() {
      backdrop.hidden = true
    }
    function open(text) {
      code.textContent = text
      backdrop.hidden = false
      closeBtn.focus()
    }
    closeBtn.addEventListener('click', close)
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) close()
    })
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !backdrop.hidden) close()
    })

    return { open }
  }

  function mountToggle(liveEl, sourceEl, modal) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'dsg-show-code-toggle'
    button.textContent = 'Show code'
    button.addEventListener('click', () => modal.open(prettyPrint(sourceEl, 0)))

    // Append inside the card's own container (figure, .text-demo, or whatever wraps it), not as
    // a sibling of the animated element itself — in a CSS grid layout (every showcase page's
    // .grid), a sibling insertion becomes its own independent grid cell instead of sitting under
    // the card it belongs to.
    const card = liveEl.closest('figure, .text-demo') ?? liveEl.parentElement
    card.appendChild(button)
  }

  async function init() {
    const liveEls = [...document.querySelectorAll('[data-dsg]')]
    if (liveEls.length === 0) return

    let sourceEls
    try {
      const res = await fetch(location.pathname)
      if (!res.ok) throw new Error('HTTP ' + res.status)
      const html = await res.text()
      const doc = new DOMParser().parseFromString(html, 'text/html')
      sourceEls = [...doc.querySelectorAll('[data-dsg]')]
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
