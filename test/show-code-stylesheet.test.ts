import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The show-code dialog's CSS has exactly one source: `demo/show-code.css`, which `show-code.js`
 * links itself. index.html once carried a hand copy that predated the Code | Args tabs and drifted
 * into an unstyled dialog; this pins that a second copy cannot come back.
 *
 * Static on purpose: every file is read whole with readFileSync, never through a filtered grep.
 */
const DEMO = join(process.cwd(), 'demo')
const read = (name: string): string => readFileSync(join(DEMO, name), 'utf8')

const DIALOG_SELECTOR = /\.kui-(code-|args)/
const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '')

function styleBlocks(html: string): string[] {
  return [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1] ?? '')
}

describe('show-code dialog stylesheet', () => {
  const sheet = stripComments(read('show-code.css'))

  it('show-code.css defines the dialog, its tabs, panels, args rows and key band', () => {
    for (const selector of [
      '.kui-code-modal',
      '.kui-code-tabs',
      ".kui-code-tab[aria-selected='true']",
      '.kui-code-panel',
      '.kui-args-param',
      '.kui-code-key',
    ]) {
      expect(sheet, selector).toContain(selector)
    }
  })

  it('show-code.js links the sheet itself, before the page\'s first <style>', () => {
    const js = read('show-code.js')
    expect(js).toContain("'show-code.css'")
    expect(js).toContain('insertBefore')
  })

  it('no other sheet or page <style> block restates a dialog selector', () => {
    const offenders: string[] = []
    for (const file of ['system.css', 'style.css']) {
      if (DIALOG_SELECTOR.test(stripComments(read(file)))) offenders.push(file)
    }
    // index-old.html is exempt: a historical reference page, deliberately left untouched.
    for (const file of readdirSync(DEMO).filter((f) => f.endsWith('.html') && f !== 'index-old.html')) {
      const css = styleBlocks(read(file)).map(stripComments).join('\n')
      if (DIALOG_SELECTOR.test(css)) offenders.push(file)
    }
    expect(offenders).toEqual([])
  })
})
