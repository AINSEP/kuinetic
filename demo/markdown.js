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
        const cells = tableRow[1].split('|').map((c) => c.trim())
        if (!cells.every((c) => /^:?-{1,}:?$/.test(c))) tableRows.push(cells)
        continue
      }
      if (tableRows.length) flushTable()

      if (/^\s*---+\s*$/.test(line)) {
        flushList()
        out.push('<hr>')
        continue
      }

      const heading = line.match(/^(#{1,4})\s+(.*)$/)
      if (heading) {
        flushList()
        const level = heading[1].length
        const id = slugify(heading[2], seenIds)
        out.push(`<h${level} id="${id}">${inline(heading[2])}</h${level}>`)
        continue
      }

      const bullet = line.match(/^\s*[-*]\s+(.*)$/)
      if (bullet) {
        if (listType !== 'ul') {
          flushList()
          listType = 'ul'
        }
        listItems.push(bullet[1])
        continue
      }

      const numbered = line.match(/^\s*\d+\.\s+(.*)$/)
      if (numbered) {
        if (listType !== 'ol') {
          flushList()
          listType = 'ol'
        }
        listItems.push(numbered[1])
        continue
      }
      flushList()

      if (line.trim() === '') continue
      out.push(`<p>${inline(line)}</p>`)
    }
    flushList()
    flushTable()
    return out.join('\n')
  }

  window.renderMarkdown = renderMarkdown
})()
