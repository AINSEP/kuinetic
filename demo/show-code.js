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
  // Read now, while this script is the one executing: `currentScript` is null again by the time
  // any click handler runs. The notes file sits next to this one, wherever the page loads it from.
  const SCRIPT_URL = document.currentScript ? document.currentScript.src : ''

  // The dialog is this script's DOM, so this script brings its sheet: a page that loads
  // show-code.js cannot forget the CSS. Before the first <style> = where system.css sits, so a
  // page's own same-specificity override still wins. Skipped when a page already links it.
  function ensureStylesheet() {
    if (document.querySelector('link[rel="stylesheet"][href$="show-code.css"]')) return
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = new URL('show-code.css', SCRIPT_URL || document.baseURI).href
    document.head.insertBefore(link, document.head.querySelector('style'))
  }
  ensureStylesheet()

  /**
   * Split on top-level commas only — a comma inside quotes (`'…'`/`"…"`) or parens is data, not a
   * separator (`target:'.yt-play, .x'`, `ease:cubic-bezier(.2, .8, .2, 1)`). Mirrors
   * `splitTopLevel(input, ',')`'s scanner in `src/core/parse.ts` (same precedence: an open quote
   * wins over paren-depth, which wins over the delimiter check) minus the warnings this printer
   * has no use for. The demo is plain JS, so this is a small reimplementation, not an import.
   */
  function splitTopLevelCommas(input) {
    const parts = []
    let buffer = ''
    let depth = 0
    let quote = null
    let escaped = false
    for (const char of input) {
      if (quote) {
        if (escaped) escaped = false
        else if (char === '\\') escaped = true
        else if (char === quote) quote = null
        buffer += char
        continue
      }
      if (char === '"' || char === "'") {
        quote = char
        buffer += char
        continue
      }
      if (char === '(') depth++
      else if (char === ')') depth = Math.max(0, depth - 1)
      if (depth === 0 && char === ',') {
        if (buffer.trim()) parts.push(buffer.trim())
        buffer = ''
        continue
      }
      buffer += char
    }
    if (buffer.trim()) parts.push(buffer.trim())
    return parts
  }

  /**
   * A `data-kui` value prints on one line unless it's "long": 3 or more comma-separated effects,
   * or 2+ effects where the one-line value already runs past 80 characters. A long value gets one
   * effect per line, each continuation indented `column` spaces — the tag's own indent plus one
   * step. It used to align under the value's first character instead, but that column sits after
   * `<tag`, `class`, `id` and every attribute before it: ~50 spaces on `#deck-demo`, so the popup
   * soft-wrapped the first line and the continuation floated in the middle of the panel (the
   * owner's "why is it still on the next line"). A shallow fixed indent reads as a list at any width.
   *
   * Only the printed text changes: this never touches the real attribute, so the Apply input (fed
   * from `element.getAttribute('data-kui')`) and the live DOM stay single-line. The embedded `\n`s
   * this returns are legal inside an HTML attribute value and copy-paste back in fine — the
   * library's own tokenizer treats whitespace (newlines included) as an ordinary separator.
   */
  function formatDataKuiValue(value, column) {
    const parts = splitTopLevelCommas(value)
    const isLong = parts.length >= 3 || (parts.length >= 2 && value.length > 80)
    if (!isLong) return value
    const pad = ' '.repeat(column)
    return parts
      .map((part, i) => (i < parts.length - 1 ? `${part},` : part))
      .map((line, i) => (i === 0 ? line : pad + line))
      .join('\n')
  }

  /**
   * Returns an array of `{ text, isTag }` line records rather than a plain string. `isTag` marks
   * a line that came from an element's own opening tag (or a collapsed void/empty element) — the
   * only place a real `data-kui` *attribute* or a class-token contract can ever live. Every other
   * line is a text node a human typed as a caption.
   *
   * That distinction is what `renderSource`'s highlighting needs. A caption like `<figcaption>data-kui="flip-shuffle"
   * — flick to reorder</figcaption>` prints a text line that reads `data-kui="flip-shuffle" —
   * flick to reorder` — a plain string match for `data-kui=` lights that up exactly like the real
   * attribute on the real tag, because to a string search the two are identical text. Keeping the
   * line's origin (tag vs. text) alongside it is what lets the highlighter tell them apart; a
   * caption can say anything it wants about `data-kui` without ever being mistaken for it.
   */
  /**
   * Tool chrome that sits inside a demo container but is not demo markup: `prettyPrint` skips it,
   * and so does `referencedTokens`, so a class on one of these can never be highlighted. See the
   * long comment in `prettyPrint` for why each of the three is chrome.
   */
  function isChrome(node) {
    return (
      node.classList.contains('kui-show-code-toggle') ||
      node.classList.contains('kui-contract') ||
      node.hasAttribute('data-show-code-target')
    )
  }

  function prettyPrint(el, depth) {
    const indent = '  '.repeat(depth)
    const tag = el.tagName.toLowerCase()
    const attrList = [...el.attributes]
      // Every `data-show-code*` attribute is this tool's own wiring — `data-show-code`,
      // `-target`. None of it belongs in the markup someone is about to copy.
      .filter(a => !a.name.startsWith('data-show-code'))

    // The column the next attribute starts printing at — `<tag ` plus every attribute already
    // emitted before it — so a long `data-kui` value (below) knows where its own first character
    // lands and can indent its continuation lines to match.
    let column = indent.length + 1 + tag.length + 1
    const attrStrings = attrList.map((a) => {
      if (a.name === 'data-kui') {
        const str = `data-kui="${formatDataKuiValue(a.value, indent.length + 4)}"`
        column += str.slice(str.lastIndexOf('\n') + 1).length + 1
        return str
      }
      const str = `${a.name}="${a.value}"`
      column += str.length + 1
      return str
    })
    const attrs = attrStrings.join(' ')
    const openTag = attrs ? `<${tag} ${attrs}>` : `<${tag}>`

    if (VOID_TAGS.has(tag)) return [{ text: `${indent}${openTag.slice(0, -1)} />`, isTag: true }]

    const childLines = []
    for (const node of el.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent.trim()
        if (text) childLines.push({ text: '  '.repeat(depth + 1) + text, isTag: false })
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        // A hand-authored `.kui-show-code-toggle` is page chrome, not demo markup. When the
        // button sits *inside* the container it targets — which is the natural place for it
        // when the container is a two-column layout and the button belongs beside the copy —
        // printing it makes the source look like the effect requires its own button.
        //
        // `.kui-contract` is the same category one level up: the bar that *displays* the
        // `data-kui` string next to that button. Printing it puts a second copy of the attribute
        // in the source as literal text.
        //
        // `data-show-code-target` is the same thing by definition: an element carrying it exists
        // only to open this modal. It is checked separately from the class because a page is free
        // to give that button its own look — `.hero-flip-code` in the hero is an outline variant
        // parked in the opposite corner from the flip control — and those buttons sit *inside* the
        // container they name, so without this they printed as if the demo required them.
        if (isChrome(node)) continue
        childLines.push(...prettyPrint(node, depth + 1))
      }
    }
    if (childLines.length === 0) return [{ text: `${indent}${openTag}</${tag}>`, isTag: true }]
    return [
      { text: indent + openTag, isTag: true },
      ...childLines,
      { text: `${indent}</${tag}>`, isTag: false },
    ]
  }

  /**
   * Parameters whose value is a CSS selector — every name the library passes through
   * `resolveTarget` (`src/core/target.ts`): `target:` (universal), `sections:` (scroll-story,
   * scroll-spy), `next:`/`prev:`/`jump:` (the step decks), `pause:` (spin/autoplay decks), `mute:`
   * (slideshow), plus `follow:` (layout's tab indicator, which queries directly). Every other
   * `text` parameter is a URL, an attribute name, a colour or a length, none of which name markup.
   */
  const SELECTOR_PARAMS = ['target', 'sections', 'next', 'prev', 'jump', 'pause', 'mute', 'follow']
  const SELECTOR_PARAM_RE = new RegExp(
    `(?:^|[\\s,])(?:${SELECTOR_PARAMS.join('|')})\\s*:\\s*(?:'([^']*)'|"([^"]*)"|([^\\s,]+))`,
    'g',
  )

  /** Class and id names inside one selector. Attribute selectors are dropped first, so the `.mp4`
   * in `[href$=".mp4"]` is not read as a class; tag names, combinators and pseudo-classes carry no
   * name anyone could rename and contribute nothing. */
  function selectorNames(selector, out) {
    const bare = selector.replace(/\[[^\]]*\]/g, ' ')
    for (const match of bare.matchAll(/([.#])(-?[A-Za-z_][-\w]*)/g)) {
      ;(match[1] === '.' ? out.classes : out.ids).add(match[2])
    }
  }

  /**
   * Which class and id names the printed markup's own `data-kui` values reference — derived, not
   * declared.
   *
   * A highlight answers "what argument in data-kui does this go to?", so the only honest source for
   * it is the data-kui text itself. This used to be a hand-written `data-show-code-key` per demo,
   * and hand keys drifted in both directions: `ring-row` stayed marked on a ring band after nothing
   * named it any more, and the swipe-y deck marked nothing although its nested carousel names four
   * classes. Reading every selector-valued parameter of every `data-kui` in the printed subtree —
   * nested ones included — makes the highlight exactly what the effect resolves, by construction.
   *
   * A name only lights up where it actually appears in the printed markup; a `pause:.band-pause
   * scope:page` control that lives outside the block has nothing here to mark.
   */
  function referencedTokens(sourceEl) {
    const out = { classes: new Set(), ids: new Set() }
    const visit = (el) => {
      const value = el.getAttribute('data-kui')
      if (value) {
        for (const match of value.matchAll(SELECTOR_PARAM_RE)) {
          selectorNames(match[1] ?? match[2] ?? match[3], out)
        }
      }
      for (const child of el.children) if (!isChrome(child)) visit(child)
    }
    visit(sourceEl)
    return out
  }

  /**
   * Byte ranges within a key line worth marking — the `data-kui="..."` attribute itself, and every
   * class or id that `referencedTokens` found a `data-kui` naming. Scoped to the match, not the whole line:
   * `<figure class="demo-card" data-kui="fade-in 2000ms" data-show-code>` is mostly plumbing a
   * reader doesn't need lit up, and marking the entire opening tag buries the one attribute that
   * actually explains the effect under five others that don't.
   *
   * Only an element's own opening tag can carry `data-kui` or a class-token contract, so a text
   * line never reaches this function — see `prettyPrint`'s `isTag` for why a caption that merely
   * *says* `data-kui=` must never be treated as the real thing.
   *
   * A selector can name a class (`.track`) or an id (`#ring-landing`), and the two namespaces are
   * kept apart: `.foo` marks only `class="… foo …"`, `#foo` only `id="foo"`. Either way a token
   * only counts as a match when it is the *whole* value (an
   * id can't hold more than one) or one whole, space-delimited piece of a `class="..."` value —
   * never a bare `\b`-bounded substring search across the line. `\b` alone still says yes to
   * `track` inside `id="reel-track"` and inside `class="track-stage"`, because `-` and `"` are
   * both non-word characters and a boundary only needs a `\w`/non-`\w` transition; the token is
   * never `track-stage`. Scoping to whitespace-split pieces of a real `class` value, or the whole
   * of a real `id` value, is what a "class/id-token contract" actually means. Tag-agnostic by
   * construction — a `<ul class="…">` or `<li id="…">` matches exactly like a `<div>` would.
   */
  function classTokenRangesFor(text, tokens) {
    if (tokens.classes.size === 0 && tokens.ids.size === 0) return []
    const ranges = []
    const classAttrRe = /class\s*=\s*"([^"]*)"/g
    let attrMatch
    while ((attrMatch = classAttrRe.exec(text))) {
      const value = attrMatch[1]
      const valueStart = attrMatch.index + attrMatch[0].length - value.length - 1
      let cursor = 0
      for (const part of value.split(/(\s+)/)) {
        if (part && !/^\s/.test(part) && tokens.classes.has(part)) {
          ranges.push([valueStart + cursor, valueStart + cursor + part.length])
        }
        cursor += part.length
      }
    }
    const idAttrRe = /\bid\s*=\s*"([^"]*)"/g
    while ((attrMatch = idAttrRe.exec(text))) {
      const value = attrMatch[1]
      if (!tokens.ids.has(value)) continue
      const valueStart = attrMatch.index + attrMatch[0].length - value.length - 1
      ranges.push([valueStart, valueStart + value.length])
    }
    return ranges
  }

  function keyRangesFor(text, tokens) {
    const ranges = []
    const dataKuiRe = /\bdata-kui\s*=\s*"[^"]*"/g
    let match
    while ((match = dataKuiRe.exec(text))) ranges.push([match.index, match.index + match[0].length])
    ranges.push(...classTokenRangesFor(text, tokens))
    ranges.sort((a, b) => a[0] - b[0])
    const merged = []
    for (const range of ranges) {
      const last = merged[merged.length - 1]
      if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1])
      else merged.push(range)
    }
    return merged
  }

  /**
   * Write the printed source into the `<code>` node as text nodes and `<mark>`s.
   *
   * Never `innerHTML`: this string is built from real page markup, so injecting it as HTML would
   * both re-parse the demo's own tags and hand any authored attribute value a way into the DOM.
   * One node per line/segment keeps it plain text all the way down.
   */
  function renderSource(code, lines, tokens) {
    code.replaceChildren()
    let marked = 0
    lines.forEach((line, index) => {
      const suffix = index < lines.length - 1 ? '\n' : ''
      const ranges = line.isTag ? keyRangesFor(line.text, tokens) : []
      if (ranges.length === 0) {
        code.append(document.createTextNode(line.text + suffix))
        return
      }
      marked += 1
      let cursor = 0
      for (const [start, end] of ranges) {
        if (start > cursor) code.append(document.createTextNode(line.text.slice(cursor, start)))
        const mark = document.createElement('mark')
        mark.className = 'kui-code-key'
        mark.textContent = line.text.slice(start, end)
        code.append(mark)
        cursor = end
      }
      code.append(document.createTextNode(line.text.slice(cursor) + suffix))
    })
    return marked
  }

  /* ---------------------------------------------------------------------------------------------
   * The Args tab: every parameter each preset in the printed markup accepts.
   *
   * Nothing here knows a single parameter name. The list, the types, the defaults and the accepted
   * spellings all come from the runtime's own `kuinetic.describeSteps()`, which reads the registry
   * the page is actually running (`window.__kuinetic.registry`, so tier effects are covered) and
   * parses the value with the same parser the animator uses. A hand-written table here would be
   * the drifting `data-show-code-key` all over again. The plain-words notes live in a separate
   * `kuinetic.notes.js` that is fetched the first time Args opens, so a page that never opens it
   * pays nothing, and every row reads correctly while a note is still missing.
   * ------------------------------------------------------------------------------------------- */

  const ORDINALS = ['1st', '2nd', '3rd']

  /** A plain-text element. Every string below is data from the page or the registry, so nothing is
   * ever parsed as HTML — the same rule `renderSource` follows. */
  function node(tag, className, ...children) {
    const el = document.createElement(tag)
    if (className) el.className = className
    for (const child of children) {
      if (child == null || child === false) continue
      el.append(typeof child === 'string' ? document.createTextNode(child) : child)
    }
    return el
  }

  /** `a | b | c`, each a `<code>`, so a reader can see where one spelling ends. */
  function codeList(values) {
    const out = document.createDocumentFragment()
    values.forEach((value, i) => {
      if (i > 0) out.append(document.createTextNode(' | '))
      out.append(node('code', null, value))
    })
    return out
  }

  /** `<div#deck.vdeck>` — which element in the printed markup a group of steps belongs to. */
  function elementLabel(el) {
    const id = el.getAttribute('id')
    const cls = (el.getAttribute('class') || '').trim()
    return `<${el.tagName.toLowerCase()}${id ? '#' + id : ''}${cls ? '.' + cls.split(/\s+/).join('.') : ''}>`
  }

  /** Every printed element carrying `data-kui`, in document order — the same walk `prettyPrint`
   * and `referencedTokens` make, so Args lists exactly the presets the Code tab shows. */
  function dataKuiElements(sourceEl) {
    const out = []
    const visit = (el) => {
      if (el.hasAttribute('data-kui')) out.push(el)
      for (const child of el.children) if (!isChrome(child)) visit(child)
    }
    visit(sourceEl)
    return out
  }

  /**
   * The runtime's answer for one `data-kui` value, as `{ steps, keys, written }` — or `null` when
   * this page's bundle predates `describeSteps()`. A bundle with `describeSteps()` but not yet
   * `describeElement()` still lists every step; it just has no reserved-key rows.
   */
  function describeValue(value) {
    const api = window.kuinetic
    if (!api || typeof api.describeSteps !== 'function') return null
    const options = {}
    const registry = window.__kuinetic && window.__kuinetic.registry
    if (registry) options.registry = registry
    const notes = window.kuineticNotes && window.kuineticNotes.PARAM_NOTES
    if (notes) options.notes = notes
    try {
      if (typeof api.describeElement === 'function') return api.describeElement(value, options)
      return { steps: api.describeSteps(value, options), keys: [], written: {} }
    } catch (e) {
      console.warn('show-code.js: describing data-kui failed', e)
      return { steps: [], keys: [], written: {} }
    }
  }

  let notesRequested = false
  /** Fetch the notes table once, on the first Args open; `onLoad` re-renders with the text. A
   * failed load is fine: every row already reads correctly without a note. */
  function loadNotes(onLoad) {
    if (notesRequested || (window.kuineticNotes && window.kuineticNotes.PARAM_NOTES)) return
    notesRequested = true
    const script = document.createElement('script')
    script.src = new URL('kuinetic.notes.js', SCRIPT_URL || document.baseURI).href
    script.async = true
    script.addEventListener('load', onLoad)
    document.head.appendChild(script)
  }

  /** "optional, defaults to 12deg" / "required" — the API's phrasing hints, applied. */
  function statusText(param, effectName) {
    if (param.required) return 'required'
    if (param.default === '') return 'optional'
    return `optional, defaults to ${param.default}${param.presetDefault ? ` for ${effectName}` : ''}`
  }

  /** "from 0 to 1, whole number" — only when the declaration carries bounds. */
  function boundsText(param) {
    const parts = []
    if (param.minimum !== undefined && param.maximum !== undefined) parts.push(`from ${param.minimum} to ${param.maximum}`)
    else if (param.minimum !== undefined) parts.push(`at least ${param.minimum}`)
    else if (param.maximum !== undefined) parts.push(`at most ${param.maximum}`)
    if (param.integer) parts.push('whole number')
    return parts.join(', ')
  }

  /** The "how do I write it" line: spellings, then the closed word list, then bounds. */
  function spellingLine(param) {
    const line = node('p', 'kui-args-spell')
    // A free-text param has no grammar to show; a reserved key typed `text` (`on:`, `at:`) does
    // carry example spellings, and those say more than the quoting hint.
    if (param.type === 'text' && param.spellings.length === 0) {
      line.append('Any text. Quote it if it has spaces or commas: ', node('code', null, `${param.name}:'…'`))
      return line
    }
    const words = param.keywords || []
    const forms = param.spellings.filter((value) => !words.includes(value))
    if (forms.length) line.append('Write it as ', codeList(forms))
    if (words.length) line.append(forms.length ? '; or one of ' : 'One of ', codeList(words))
    const bounds = boundsText(param)
    if (bounds) line.append(` (${bounds})`)
    return line.childNodes.length ? line : null
  }

  /** "Bare values: `hover-intent 160ms 1000ms ease-out` — 1st time → duration, …". The example is
   * the effect's own defaults, so pasting it changes nothing; a slot the primitive does not declare
   * still gets an example, since the grammar assigns it all the same.
   *
   * A slot the effect cannot act on (`honoured: false`, the same contract that makes the runtime
   * warn `"pin" cannot honour delay`) stays in the example, because a later token's meaning depends
   * on its position, but is marked ignored, with the runtime's own reason after the line. */
  function positionalLine(step) {
    const byName = new Map(step.params.map((param) => [param.name, param]))
    const FALLBACK = { duration: '600ms', delay: '200ms', ease: 'ease-out' }
    let times = 0
    const tokens = []
    const line = node('p', 'kui-args-positional', 'Bare values, no name needed: ')
    const meanings = document.createDocumentFragment()
    const ignored = []
    step.positionalOrder.forEach((slot, i) => {
      const declared = slot.param ? byName.get(slot.param) : undefined
      tokens.push(declared && declared.default ? declared.spellings[0] || declared.default : FALLBACK[slot.slot])
      const which = slot.accepts === 'time' ? `${ORDINALS[times++]} time` : 'an easing'
      meanings.append(i === 0 ? ' — ' : ', ')
      if (slot.honoured === false) {
        ignored.push(slot.slot)
        meanings.append(node('s', 'kui-args-ignored', `${which} → ${slot.slot}`), ' (ignored)')
      } else {
        meanings.append(`${which} → ${slot.slot}`)
      }
    })
    line.append(node('code', null, `${step.name} ${tokens.join(' ')}`), meanings, '.')
    if (ignored.length) {
      line.append(
        ` ${step.name} ignores a bare ${ignored.join(' and ')}`,
        step.unhonouredBecause ? `: ${step.unhonouredBecause}.` : '.',
      )
    }
    return line
  }

  /**
   * One row: a parameter of `step`, or a reserved key (same row shape; `step` is then just the
   * owner's name with no positional slots). `written` is what the markup set, by name.
   */
  function paramRow(param, step, written) {
    const isSet = Object.hasOwn(written, param.name)
    const row = node('li', isSet ? 'kui-args-param is-set' : 'kui-args-param')
    if (param.scope) row.dataset.scope = param.scope
    const name = node(isSet ? 'mark' : 'code', isSet ? 'kui-code-key kui-args-name' : 'kui-args-name', param.name)
    const head = node(
      'p',
      'kui-args-head',
      name,
      node('span', 'kui-args-type', param.type),
      node('span', 'kui-args-status', statusText(param, step.name)),
    )
    row.append(head)
    if (isSet) {
      row.append(node('p', 'kui-args-set', 'This markup sets ', node('mark', 'kui-code-key', written[param.name])))
    }
    if (param.note) row.append(node('p', 'kui-args-note', param.note))
    row.append(spellingLine(param) || '')
    if (param.positionalIndex !== undefined) {
      const slot = step.positionalOrder[param.positionalIndex]
      // No standalone example: a lone bare time is always the duration, so `name 1s` would teach
      // the delay row the wrong thing. The full positional example sits at the top of the step.
      const which = slot && slot.accepts === 'easing' ? 'any easing' : `the ${ORDINALS[param.positionalIndex]} time`
      if (slot && slot.honoured === false) {
        row.append(node('p', 'kui-args-omitted', `${step.name} ignores this one bare${step.unhonouredBecause ? `: ${step.unhonouredBecause}` : ''}.`))
      } else {
        row.append(node('p', 'kui-args-spell', `Or bare, without the name: ${which} after `, node('code', null, step.name), '.'))
      }
    }
    if (param.whenOmitted) row.append(node('p', 'kui-args-omitted', `Left out: ${param.whenOmitted}`))
    return row
  }

  /** Set rows first, then the rest in declaration order. */
  function setFirst(rows, written) {
    return [...rows.filter((row) => Object.hasOwn(written, row.name)), ...rows.filter((row) => !Object.hasOwn(written, row.name))]
  }

  /**
   * The reserved keys (`on:`, `at:` …) as a collapsible list under their own heading, so a page with
   * many presets keeps its effect args in front. Open when the markup sets one of them.
   */
  function keysBlock(title, keys, written, ownerName) {
    const setCount = keys.filter((key) => Object.hasOwn(written, key.name)).length
    const details = node('details', 'kui-args-keys')
    details.open = setCount > 0
    details.append(
      node(
        'summary',
        null,
        node('span', 'kui-args-keys-title', title),
        node('span', 'kui-args-count', `${keys.length} ${keys.length === 1 ? 'key' : 'keys'}${setCount ? ` · ${setCount} set here` : ''}`),
      ),
    )
    const list = node('ul', 'kui-args-list')
    const owner = { name: ownerName, positionalOrder: [] }
    for (const key of setFirst(keys, written)) list.append(paramRow(key, owner, written))
    details.append(list)
    return details
  }

  function stepBlock(step, keys) {
    // `written` is the API's record of what this step's own text set, bare tokens mapped to the
    // slot they fill; `writtenKeys` the reserved keys it set. Absent on a bundle that predates them:
    // then nothing is marked as set.
    const written = step.written || {}
    const writtenKeys = step.writtenKeys || {}
    if (step.unknown) {
      const block = node('div', 'kui-args-step is-unknown')
      block.append(
        node(
          'p',
          'kui-args-unknown',
          node('code', null, step.name),
          ' is not an effect name.',
          step.suggestion ? ' Did you mean ' : null,
          step.suggestion ? node('code', null, step.suggestion) : null,
          step.suggestion ? '?' : null,
        ),
      )
      return block
    }
    const declared = new Set(step.params.map((param) => param.name))
    const setCount = step.params.filter((param) => Object.hasOwn(written, param.name)).length
    const details = node('details', 'kui-args-step')
    details.open = true
    details.append(
      node(
        'summary',
        null,
        node('code', 'kui-args-effect', step.name),
        step.primitive !== step.name ? node('span', 'kui-args-type', `→ ${step.primitive}`) : null,
        node(
          'span',
          'kui-args-count',
          `${step.params.length} ${step.params.length === 1 ? 'arg' : 'args'}${setCount ? ` · ${setCount} set here` : ''}`,
        ),
      ),
    )
    details.append(positionalLine(step))
    // What the markup set first: that is the question a reader arrives with. The rest follow in the
    // order the effect declares them, which is the order its docs use.
    const list = node('ul', 'kui-args-list')
    for (const param of setFirst(step.params, written)) list.append(paramRow(param, step, written))
    // Only an effect arg the effect does not declare is ignored (the runtime warns about it too).
    // Reserved keys are never in `written`; they are `writtenKeys`, listed with their own rows below.
    for (const key of Object.keys(written)) {
      if (declared.has(key)) continue
      list.append(
        node(
          'li',
          'kui-args-param is-stray',
          node('p', 'kui-args-head', node('code', 'kui-args-name', key), node('span', 'kui-args-status', `not an arg of ${step.name}; it is ignored`)),
          node('p', 'kui-args-set', 'This markup sets ', node('code', null, written[key])),
        ),
      )
    }
    details.append(list)
    // This step's own keys (`at:`, `repeat:`, `above:` …), plus any element key it scoped to its
    // target group (`on:` on a step with `target:`), which is why the row comes from `writtenKeys`
    // as well as from scope.
    const stepKeys = keys.filter((key) => key.scope === 'step' || Object.hasOwn(writtenKeys, key.name))
    if (stepKeys.length) details.append(keysBlock(`Step keys for ${step.name}`, stepKeys, writtenKeys, step.name))
    return details
  }

  /** Fill the Args panel for `sourceEl`'s printed markup. `overrides` maps an element to the value
   * Apply put on it, so the tab follows the try-it box instead of the page's first default. */
  function renderArgs(panel, sourceEl, overrides) {
    panel.replaceChildren()
    const elements = dataKuiElements(sourceEl)
    for (const el of elements) {
      const value = overrides.has(el) ? overrides.get(el) : el.getAttribute('data-kui') || ''
      const described = describeValue(value)
      if (described === null) {
        panel.append(
          node('p', 'kui-args-empty', 'This page’s kuinetic.js predates describeSteps(); rebuild it to list the args.'),
        )
        return
      }
      // A div, not a <section>: every demo stylesheet pads `section` as a page band.
      const group = node('div', 'kui-args-group')
      group.append(
        node(
          'h3',
          'kui-args-element',
          elements.length > 1 ? `${elementLabel(el)} ` : null,
          node('code', null, `data-kui="${value}"`),
        ),
      )
      for (const step of described.steps) group.append(stepBlock(step, described.keys))
      // Element keys once per element, after its steps: one value per element, whichever step wrote it.
      const elementKeys = described.keys.filter((key) => key.scope === 'element')
      if (elementKeys.length) group.append(keysBlock('Element keys', elementKeys, described.written || {}, 'data-kui'))
      panel.append(group)
    }
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

    // Code | Args, as WAI-ARIA tabs: one tab stop for the strip (roving tabindex), arrows move
    // between tabs, and a tab activates as it takes focus — two cheap panels, so there is no reason
    // to make keyboard users press Enter as well. The strip sits below the header, outside the drag
    // handle, so a click on a tab is only ever a click.
    const tabList = node('div', 'kui-code-tabs')
    tabList.setAttribute('role', 'tablist')
    tabList.setAttribute('aria-label', 'Source view')
    const codePanel = node('div', 'kui-code-panel', pre)
    const argsPanel = node('div', 'kui-code-panel kui-args')
    const tabs = [
      { id: 'code', label: 'Code', panel: codePanel },
      { id: 'args', label: 'Args', panel: argsPanel },
    ].map(({ id, label, panel }) => {
      const tab = node('button', 'kui-code-tab', label)
      tab.type = 'button'
      tab.id = `kui-code-tab-${id}`
      tab.setAttribute('role', 'tab')
      panel.id = `kui-code-panel-${id}`
      panel.setAttribute('role', 'tabpanel')
      panel.setAttribute('aria-labelledby', tab.id)
      // Focusable, so a keyboard user can reach and scroll a panel with no focusable content.
      panel.tabIndex = 0
      tab.setAttribute('aria-controls', panel.id)
      tabList.append(tab)
      return { id, tab, panel }
    })

    dialog.append(header, tryIt, tabList, codePanel, argsPanel)
    backdrop.appendChild(dialog)
    document.body.appendChild(backdrop)

    let targetEl = null
    let originalValue = ''
    let sourceRoot = null
    let targetSourceEl = null
    // The value Apply last put on the target, so Args describes what is running, not what loaded.
    const overrides = new Map()

    function renderArgsPanel() {
      if (sourceRoot) renderArgs(argsPanel, sourceRoot, overrides)
    }

    function selectTab(id, focus) {
      for (const entry of tabs) {
        const selected = entry.id === id
        entry.tab.setAttribute('aria-selected', String(selected))
        entry.tab.tabIndex = selected ? 0 : -1
        entry.panel.hidden = !selected
        if (selected && focus) entry.tab.focus()
      }
      if (id === 'args') {
        renderArgsPanel()
        loadNotes(() => {
          if (!argsPanel.hidden) renderArgsPanel()
        })
      }
    }
    selectTab('code', false)

    tabList.addEventListener('click', (e) => {
      const entry = tabs.find(({ tab }) => tab === e.target.closest('[role="tab"]'))
      if (entry) selectTab(entry.id, true)
    })
    tabList.addEventListener('keydown', (e) => {
      const current = tabs.findIndex(({ tab }) => tab === document.activeElement)
      if (current < 0) return
      const last = tabs.length - 1
      const next = {
        ArrowRight: current === last ? 0 : current + 1,
        ArrowLeft: current === 0 ? last : current - 1,
        Home: 0,
        End: last,
      }[e.key]
      if (next === undefined) return
      e.preventDefault()
      selectTab(tabs[next].id, true)
    })

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
      if (targetSourceEl) overrides.set(targetSourceEl, value)
      if (!argsPanel.hidden) renderArgsPanel()
    }

    // The backdrop itself is `pointer-events: none` (see show-code.css) so the page stays
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
      targetSourceEl = sourceEl.hasAttribute('data-kui') ? sourceEl : (sourceEl.querySelector('[data-kui]') || sourceEl)
      sourceRoot = sourceEl
      overrides.clear()

      // A chip-picker page rewrites `data-kui` itself on click (#lab, #vocab-target) — that is a
      // real, intentional value, unlike the data-kui-fx/data-kui-state noise the pristine-fetch
      // trick above exists to strip. The runtime never touches `data-kui`'s own value, so for every
      // other (static) demo this is a no-op; for a chip-picker it keeps the modal in sync with
      // whichever chip is actually selected instead of always showing the page's first default.
      targetSourceEl.setAttribute('data-kui', targetEl.getAttribute('data-kui') ?? '')

      originalValue = targetSourceEl.getAttribute('data-kui') ?? ''
      // Derived after the chip-picker sync above, so a rewritten `data-kui` highlights what *it*
      // names rather than what the page's first default named.
      const tokens = referencedTokens(sourceEl)
      // The legend sentence that used to sit here is gone at the owner's request. It restated the
      // same thirty words above every single code block on every page, which is how a caption stops
      // being read at all. The highlight itself stays and does the work: a marked line is visibly a
      // marked line, and one legend repeated forty times teaches nobody anything the fortieth time.
      renderSource(code, prettyPrint(sourceEl, 0), tokens)
      input.value = originalValue
      // Every open starts on Code, the default; Args is one click or one arrow key away.
      selectTab('code', false)
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
