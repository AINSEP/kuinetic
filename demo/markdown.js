/**
 * Minimal, dependency-free Markdown → HTML renderer for the docs viewer.
 *
 * Not a general-purpose parser — covers exactly what docs/catalog.md, docs/design.md, and
 * docs/getting-started.md use: headings (#-####), bold, inline code, links, fenced code blocks,
 * a `live` fence for real (unescaped) HTML demos, pipe tables, hr, and bullet/numbered lists. No
 * external library, consistent with the rest of this showcase.
 */
;(function () {
  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  }

  function inline(s) {
    return escapeHtml(s)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
  }

  function slugify(text, seen) {
    var base = text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'section'
    var slug = base
    var n = 2
    while (seen.has(slug)) slug = base + '-' + n++
    seen.add(slug)
    return slug
  }

  function renderMarkdown(markdown) {
    const lines = markdown.split('\n')
    const out = []
    const seenIds = new Set()

    let inCode = false
    let codeLang = ''
    let codeBuf = []
    let listType = null
    let listItems = []
    let tableRows = []
    let paraLines = []

    /*
     * A paragraph is a *run* of lines, not one line.
     *
     * Every non-blank line used to be emitted as its own `<p>`, so a hard-wrapped source paragraph
     * came out as four or five separate blocks. Nothing separated them visually — no rule sets a
     * paragraph margin here — so it read as one paragraph that broke in the wrong places: on a
     * 390px screen the getting-started intro wrapped to seven ragged lines, four of them ending
     * well short of the margin. Wide enough and each source line still fits on one rendered line,
     * which is why it only ever looked wrong on a phone.
     *
     * Markdown's own rule is the fix: single newlines are just whitespace inside a paragraph, and a
     * blank line (or any other block starting) is what ends one. `inline()` still runs per line so
     * the inline pass behaves exactly as before; only the block structure changes.
     */
    function flushPara() {
      if (!paraLines.length) return
      out.push(`<p>${paraLines.join('\n')}</p>`)
      paraLines = []
    }

    function flushList() {
      if (!listItems.length) return
      const items = listItems.map((item) => `<li>${inline(item)}</li>`).join('')
      out.push(`<${listType}>${items}</${listType}>`)
      listItems = []
      listType = null
    }

    function flushTable() {
      if (!tableRows.length) return
      const [head, ...body] = tableRows
      const thead = `<thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead>`
      const tbody = `<tbody>${body
        .map((row) => `<tr>${row.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`)
        .join('')}</tbody>`
      out.push(`<div class="doc-table-wrap"><table>${thead}${tbody}</table></div>`)
      tableRows = []
    }

    for (const line of lines) {
      const fence = line.match(/^```\s*(\S*)/)
      if (fence) {
        if (!inCode) {
          flushPara()
          flushList()
          flushTable()
          inCode = true
          codeLang = fence[1] || ''
          codeBuf = []
        } else {
          // `live` is the one deliberate escape hatch: everything else always renders as inert,
          // escaped example text (the whole rest of this parser assumes untrusted markdown), but
          // docs/getting-started.md needs a way to drop real `data-kui`-bearing markup into the
          // page so the already-running animator picks it up and the example actually plays.
          if (codeLang === 'live') {
            out.push(`<div class="doc-live">${codeBuf.join('\n')}</div>`)
          } else {
            out.push(`<pre><code>${escapeHtml(codeBuf.join('\n'))}</code></pre>`)
          }
          inCode = false
          codeLang = ''
        }
        continue
      }
      if (inCode) {
        codeBuf.push(line)
        continue
      }

      const tableRow = line.match(/^\s*\|(.+)\|\s*$/)
      if (tableRow) {
        flushPara()
        const cells = tableRow[1].split('|').map((c) => c.trim())
        if (!cells.every((c) => /^:?-{1,}:?$/.test(c))) tableRows.push(cells)
        continue
      }
      if (tableRows.length) flushTable()

      if (/^\s*---+\s*$/.test(line)) {
        flushPara()
        flushList()
        out.push('<hr>')
        continue
      }

      const heading = line.match(/^(#{1,4})\s+(.*)$/)
      if (heading) {
        flushPara()
        flushList()
        const level = heading[1].length
        const id = slugify(heading[2], seenIds)
        out.push(`<h${level} id="${id}">${inline(heading[2])}</h${level}>`)
        continue
      }

      const bullet = line.match(/^\s*[-*]\s+(.*)$/)
      if (bullet) {
        flushPara()
        if (listType !== 'ul') {
          flushList()
          listType = 'ul'
        }
        listItems.push(bullet[1])
        continue
      }

      const numbered = line.match(/^\s*\d+\.\s+(.*)$/)
      if (numbered) {
        flushPara()
        if (listType !== 'ol') {
          flushList()
          listType = 'ol'
        }
        listItems.push(numbered[1])
        continue
      }
      if (line.trim() === '') {
        flushPara()
        flushList()
        continue
      }
      /*
       * Lazy continuation: a plain line under an open list belongs to the item above it.
       *
       * Same bug as the paragraph one and it hid behind it. A hard-wrapped bullet only ever became
       * an `<li>` as far as its first line; the rest fell out of the list and rendered at full
       * width beside it, so "It refines `on:`, so it needs one of the observed activations (enter,
       * leave, or a pair" was a bullet and "containing one)." was not. With every line its own
       * zero-margin `<p>` that misalignment was easy to miss; with real paragraphs it is a hanging
       * block sitting outside the bullet it belongs to. A blank line still ends the list, and a
       * bullet still starts the next item, so only the continuation case changes.
       */
      if (listItems.length) {
        listItems[listItems.length - 1] += '\n' + line
        continue
      }
      flushList()
      paraLines.push(inline(line))
    }
    flushPara()
    flushList()
    flushTable()
    return out.join('\n')
  }

  window.renderMarkdown = renderMarkdown
})()
