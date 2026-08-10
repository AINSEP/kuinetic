/**
 * Minimal, dependency-free Markdown → HTML renderer for the docs viewer.
 *
 * Not a general-purpose parser — covers exactly what docs/catalog.md and docs/design.md use:
 * headings (#-####), bold, inline code, links, fenced code blocks, pipe tables, hr, and bullet/
 * numbered lists. No external library, consistent with the rest of this showcase.
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

  function renderMarkdown(markdown) {
    const lines = markdown.split('\n')
    const out = []

    let inCode = false
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
      const fence = line.match(/^```/)
      if (fence) {
        if (!inCode) {
          flushList()
          flushTable()
          inCode = true
          codeBuf = []
        } else {
          out.push(`<pre><code>${escapeHtml(codeBuf.join('\n'))}</code></pre>`)
          inCode = false
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
        out.push(`<h${level}>${inline(heading[2])}</h${level}>`)
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
