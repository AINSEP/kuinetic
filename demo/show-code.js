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
    const attrs = [...el.attributes]
      // Every `data-show-code*` attribute is this tool's own wiring — `data-show-code`,
      // `-target`, `-key`. None of it belongs in the markup someone is about to copy.
      .filter(a => !a.name.startsWith('data-show-code'))
      .map((a) => `${a.name}="${a.value}"`).join(' ')
    const openTag = attrs ? `<${tag} ${attrs}>` : `<${tag}>`

    if (VOID_TAGS.has(tag)) return `${indent}${openTag.slice(0, -1)} />`

    const childLines = []
    for (const node of el.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent.trim()
        if (text) childLines.push('  '.repeat(depth + 1) + text)
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        // A hand-authored `.kui-show-code-toggle` is page chrome, not demo markup. When the
        // button sits *inside* the container it targets — which is the natural place for it
        // when the container is a two-column layout and the button belongs beside the copy —
        // printing it makes the source look like the effect requires its own button.
        //
        // `.kui-contract` is the same category one level up: the bar that *displays* the
        // `data-kui` string next to that button. Printing it puts a second copy of the attribute
        // in the source as literal text, on a line that then matches `isKeyLine` and gets
        // highlighted — so the reader is told the page's own caption is part of the contract.
        if (node.classList.contains('kui-show-code-toggle')) continue
        if (node.classList.contains('kui-contract')) continue
        childLines.push(prettyPrint(node, depth + 1))
      }
    }
    if (childLines.length === 0) return `${indent}${openTag}</${tag}>`
    return [indent + openTag, ...childLines, `${indent}</${tag}>`].join('\n')
  }

  /**
   * Which lines in a printed source block are load-bearing.
   *
   * Always the `data-kui` line, because that is the whole effect. Beyond that, an effect with a
   * markup contract can name the tokens that matter with `data-show-code-key` on its container —
   * `flip-card` needs `kui-face-front`, `kui-face-back`, and a `kui-flip-control` outside both, and
   * nothing in a wall of monospace tells you which of those class names you are allowed to rename
   * and which one the stylesheet is actually selecting on.
   */
  function keyTokensFor(sourceEl) {
    const declared = (sourceEl.getAttribute('data-show-code-key') || '').trim()
    return declared ? declared.split(/\s+/) : []
  }

  function isKeyLine(line, tokens) {
    if (/\bdata-kui\s*=/.test(line)) return true
    return tokens.some((token) => line.includes(token))
  }

  /**
   * Write the printed source into the `<code>` node as text nodes and `<mark>`s.
   *
   * Never `innerHTML`: this string is built from real page markup, so injecting it as HTML would
   * both re-parse the demo's own tags and hand any authored attribute value a way into the DOM.
   * One node per line keeps it plain text all the way down.
   */
  function renderSource(code, text, tokens) {
    code.replaceChildren()
    const lines = text.split('\n')
    let marked = 0
    lines.forEach((line, index) => {
      const suffix = index < lines.length - 1 ? '\n' : ''
      if (isKeyLine(line, tokens)) {
        marked += 1
        const mark = document.createElement('mark')
        mark.className = 'kui-code-key'
        mark.textContent = line
        code.append(mark, document.createTextNode(suffix))
      } else {
        code.append(document.createTextNode(line + suffix))
      }
    })
    return marked
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
    // Deliberately NOT `aria-modal`. The panel is draggable precisely so the page behind it stays
    // watchable while you edit a `data-kui` value — claiming modality would tell assistive tech the
    // rest of the document is inert when it is still live, scrollable, and hoverable.
    dialog.setAttribute('aria-modal', 'false')
    dialog.setAttribute('aria-label', 'Element source')

    const closeBtn = document.createElement('button')
    closeBtn.type = 'button'
    closeBtn.className = 'kui-code-modal-close'
    closeBtn.setAttribute('aria-label', 'Close')
    closeBtn.textContent = '×'

    const grip = document.createElement('span')
    grip.className = 'kui-code-modal-grip'
    grip.textContent = 'Element source — drag to move'

    const header = document.createElement('div')
    header.className = 'kui-code-modal-header'
    header.append(grip, closeBtn)

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

    /**
     * Drag-to-move, so the panel can be parked off to one side and the effect it edits stays in
     * view. The offset is a `transform` rather than `left`/`top` because the dialog is centred by
     * the backdrop's grid — writing `left` would first have to undo that centring, while a
     * translate composites on top of whatever the grid resolved and survives a viewport resize.
     * It persists across opens on purpose: once parked clear of the demo, it stays parked.
     */
    let dragX = 0
    let dragY = 0
    // How much of the panel must stay on screen, so it can never be dragged fully out of reach.
    const KEEP_VISIBLE = 140

    function applyOffset() {
      dialog.style.transform = dragX || dragY ? `translate(${dragX}px, ${dragY}px)` : ''
    }

    function startDrag(e) {
      // The close button lives in the same header; let it be a button first and a handle never.
      if (e.target.closest('button')) return

      const rect = dialog.getBoundingClientRect()
      // getBoundingClientRect() reports the *transformed* box, so back the current offset out to
      // recover where the grid actually placed the panel. That base never moves during a drag.
      const baseLeft = rect.left - dragX
      const baseTop = rect.top - dragY
      const grabX = e.clientX - dragX
      const grabY = e.clientY - dragY

      const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi)

      function onMove(ev) {
        dragX = clamp(
          ev.clientX - grabX,
          KEEP_VISIBLE - baseLeft - rect.width,
          window.innerWidth - KEEP_VISIBLE - baseLeft,
        )
        dragY = clamp(ev.clientY - grabY, -baseTop, window.innerHeight - 44 - baseTop)
        applyOffset()
      }
      function onUp() {
        header.classList.remove('is-dragging')
        header.removeEventListener('pointermove', onMove)
        header.removeEventListener('pointerup', onUp)
        header.removeEventListener('pointercancel', onUp)
      }

      header.setPointerCapture(e.pointerId)
      header.classList.add('is-dragging')
      header.addEventListener('pointermove', onMove)
      header.addEventListener('pointerup', onUp)
      header.addEventListener('pointercancel', onUp)
      // Without this a drag that starts on the label text selects it instead of moving the panel.
      e.preventDefault()
    }
    header.addEventListener('pointerdown', startDrag)

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

    // The backdrop itself is `pointer-events: none` (see system.css/style.css) so the page stays
    // clickable underneath — which means a plain `backdrop.addEventListener('click', ...)` would
    // never fire; the backdrop never receives the click to begin with. Closing on an outside click
    // instead listens on `document` for any pointerdown that lands outside the dialog. It's added
    // only while open and removed on close, so it never runs the rest of the time.
    function onOutsidePointerDown(e) {
      if (!dialog.contains(e.target)) close()
    }

    function close() {
      backdrop.style.display = 'none'
      document.removeEventListener('pointerdown', onOutsidePointerDown, true)
    }
    function open(liveEl, sourceEl) {
      targetEl = liveEl.hasAttribute('data-kui') ? liveEl : (liveEl.querySelector('[data-kui]') || liveEl)
      const targetSourceEl = sourceEl.hasAttribute('data-kui') ? sourceEl : (sourceEl.querySelector('[data-kui]') || sourceEl)
      
      originalValue = targetSourceEl.getAttribute('data-kui') ?? ''
      const tokens = keyTokensFor(sourceEl)
      // The legend sentence that used to sit here is gone at the owner's request. It restated the
      // same thirty words above every single code block on every page, which is how a caption stops
      // being read at all. The highlight itself stays and does the work: a marked line is visibly a
      // marked line, and one legend repeated forty times teaches nobody anything the fortieth time.
      renderSource(code, prettyPrint(sourceEl, 0), tokens)
      input.value = originalValue
      backdrop.style.display = 'grid'
      // The stored offset was clamped against the viewport it was dragged in; re-clamp against the
      // current one so a resize between opens can't leave the panel parked past the edge.
      const rect = dialog.getBoundingClientRect()
      const baseLeft = rect.left - dragX
      const baseTop = rect.top - dragY
      dragX = Math.min(Math.max(dragX, KEEP_VISIBLE - baseLeft - rect.width), window.innerWidth - KEEP_VISIBLE - baseLeft)
      dragY = Math.min(Math.max(dragY, -baseTop), window.innerHeight - 44 - baseTop)
      applyOffset()
      closeBtn.focus()
      // Deferred one tick: the click that opened the modal (on the "Show code" button, which sits
      // outside `dialog`) is still bubbling when `open()` runs. Adding this listener synchronously
      // would risk it seeing that same click's mouseup/pointerdown pair on some browsers and
      // closing the modal it just opened.
      setTimeout(() => document.addEventListener('pointerdown', onOutsidePointerDown, true))
    }
    closeBtn.addEventListener('click', close)
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && backdrop.style.display !== 'none') close()
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

    const caption = liveEl.querySelector('figcaption, .demo-card-caption')
    if (caption) {
      // A class, not three inline styles. Inline styles sit above every stylesheet selector, so
      // the old version made the caption's layout unrestylable — a page could not lay its own
      // caption out as a row without `!important`. Same reasoning the preset defaults use: put
      // it in the cascade and an ordinary selector can win. `.kui-has-toggle` in system.css
      // reproduces exactly what these three lines used to set.
      caption.classList.add('kui-has-toggle')
      caption.appendChild(button)
    } else {
      const card = liveEl.closest('figure, .text-demo, .pillar, .g-card, [data-show-code]') ?? liveEl.parentElement
      card.appendChild(button)
    }
  }

  /**
   * A hand-authored button (`data-show-code-target="some-id"`) that opens the modal for a whole
   * container — the demo grid it names, not itself — instead of the auto-mounted per-card
   * toggle. For a container whose children each carry their own click behavior (flip-reorder's
   * "click to bring forward", expand-to-modal's "click to expand"), a per-card toggle nested
   * inside that same card double-fires: the click bubbles to the card's own listener too, so
   * "Show code" also reorders or expands the card underneath it. One button outside every card
   * sidesteps that entirely, and shows the whole block's markup at once instead of just one card.
   */
  function mountTargetButton(button, doc) {
    const targetId = button.getAttribute('data-show-code-target')
    const liveTarget = document.getElementById(targetId)
    if (!liveTarget) return null
    const sourceTarget = doc.getElementById(targetId) || liveTarget
    return { button, liveTarget, sourceTarget }
  }

  async function init() {
    const liveEls = [...document.querySelectorAll('[data-show-code]')]
    const targetButtons = [...document.querySelectorAll('[data-show-code-target]')]
    if (liveEls.length === 0 && targetButtons.length === 0) return

    let doc
    try {
      const res = await fetch(location.pathname)
      if (!res.ok) throw new Error('HTTP ' + res.status)
      const html = await res.text()
      doc = new DOMParser().parseFromString(html, 'text/html')
    } catch (e) {
      console.warn('show-code.js: Failed to fetch pristine source, falling back to live DOM.', e)
      doc = document // fallback: getElementById/querySelectorAll both still work against it
    }
    const sourceEls = [...doc.querySelectorAll('[data-show-code]')]

    const modal = buildModal()
    liveEls.forEach((liveEl, i) => {
      const source = sourceEls[i] || liveEl
      if (source) mountToggle(liveEl, source, modal)
    })

    targetButtons.forEach((button) => {
      const mounted = mountTargetButton(button, doc)
      if (!mounted) return
      mounted.button.addEventListener('click', () => modal.open(mounted.liveTarget, mounted.sourceTarget))
    })
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }
})()
