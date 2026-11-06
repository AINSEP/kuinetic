// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { acquireModalShell } from '../src/showcase/modal-shell.js'
import type { ModalContent } from '../src/showcase/modal-shell.js'

function content(label: string, node = document.createElement('div')): ModalContent {
  return { node, label, duration: 20, scale: '0.9', ease: 'linear', reducedMotion: false }
}

beforeEach(() => {
  vi.useFakeTimers()
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value(this: HTMLDialogElement) {
    this.setAttribute('open', '')
  } })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value(this: HTMLDialogElement) {
    this.removeAttribute('open')
    this.dispatchEvent(new Event('close'))
  } })
})

afterEach(() => {
  vi.useRealTimers()
  document.body.replaceChildren()
  document.documentElement.removeAttribute('style')
})

describe('shared modal shell', () => {
  it('owns flight cleanup across re-entry and another owner releasing', () => {
    const first = acquireModalShell(document)
    const second = acquireModalShell(document)
    const cancel = vi.fn()
    const motion = vi.fn(() => ({ cancel, dismiss: () => new Promise(() => {}) }))
    first.open({ ...content('Flight'), motion })
    expect(motion).toHaveBeenCalledWith(document.querySelector('dialog'))
    second.release()
    expect(cancel).not.toHaveBeenCalled()
    first.dismiss()
    first.open(content('Plain'))
    expect(cancel).toHaveBeenCalledOnce()
    expect(document.querySelector('.kui-lightbox-flight-layer')).toBeNull()
    expect(document.querySelector<HTMLElement>('dialog')!.style.getPropertyValue('--kui-flight-dim')).toBe('')
    vi.advanceTimersByTime(70)
    expect(document.querySelector('dialog')!.open).toBe(true)
    first.release()
  })

  it('bounds an unfinished flight close and cancels it exactly once', () => {
    const shell = acquireModalShell(document)
    const cancel = vi.fn()
    shell.open({ ...content('Flight'), motion: () => ({ cancel, dismiss: () => new Promise(() => {}) }) })
    shell.dismiss()
    vi.advanceTimersByTime(69)
    expect(document.querySelector('dialog')!.open).toBe(true)
    vi.advanceTimersByTime(1)
    expect(document.querySelector('dialog')!.open).toBe(false)
    expect(cancel).toHaveBeenCalledOnce()
    shell.release()
  })

  it('routes an actual Escape key through the same bounded dismiss for plain content', () => {
    const shell = acquireModalShell(document)
    shell.open(content('Plain'))
    const dialog = document.querySelector('dialog')!
    const key = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    dialog.dispatchEvent(key)
    expect(key.defaultPrevented).toBe(true)
    expect(dialog.open).toBe(true)
    vi.advanceTimersByTime(19)
    expect(dialog.open).toBe(true)
    vi.advanceTimersByTime(1)
    expect(dialog.open).toBe(false)
    shell.release()
  })

  it('keeps a reopened viewer open when the old close timer expires', () => {
    const shell = acquireModalShell(document)
    shell.open(content('First'))
    shell.dismiss()
    shell.open(content('Second'))
    vi.advanceTimersByTime(20)
    const dialog = document.querySelector('dialog')!
    expect(dialog.hasAttribute('open')).toBe(true)
    expect(dialog.getAttribute('aria-label')).toBe('Second')
    expect(dialog.querySelector('.kui-lightbox-slot')?.textContent).toBe('')
    shell.release()
  })

  it('cancels a pending dismissal on release and ignores a second release', () => {
    const shell = acquireModalShell(document)
    shell.open(content('Viewer'))
    shell.dismiss()
    shell.release()
    expect(vi.getTimerCount()).toBe(0)
    shell.release()
    vi.advanceTimersByTime(20)
    expect(document.querySelector('dialog')).toBeNull()
    expect(document.documentElement.style.overflow).toBe('')
  })

  it('keeps the other owner alive when one owner releases twice', () => {
    const first = acquireModalShell(document)
    const second = acquireModalShell(document)
    second.open(content('Shared'))
    first.release()
    first.release()
    expect(document.querySelector('dialog')?.getAttribute('aria-label')).toBe('Shared')
    expect(document.querySelector('dialog')!.open).toBe(true)
    second.release()
    expect(document.querySelector('dialog')).toBeNull()
  })

  it('dismisses a gallery on its figure while preserving image and button clicks', () => {
    const shell = acquireModalShell(document)
    const gallery = document.createElement('div')
    gallery.className = 'kui-lightbox-gallery'
    gallery.innerHTML = '<figure><img src="/a.png" alt="A"></figure><button>Next</button>'
    shell.open({ ...content('Gallery', gallery), inside: (target) => target.closest('img, button') !== null })
    const dialog = document.querySelector('dialog')!
    gallery.querySelector('img')!.click()
    gallery.querySelector('button')!.click()
    expect(dialog.classList.contains('is-open')).toBe(true)
    gallery.querySelector('figure')!.click()
    expect(dialog.classList.contains('is-open')).toBe(false)
    vi.advanceTimersByTime(20)
    expect(dialog.hasAttribute('open')).toBe(false)
    shell.release()
  })

  it('keeps content without an inside hook open on any click within its node', () => {
    const shell = acquireModalShell(document)
    const node = document.createElement('div')
    node.innerHTML = '<p>Text</p>'
    shell.open(content('Plain', node))
    const dialog = document.querySelector('dialog')!
    node.querySelector('p')!.click()
    expect(dialog.classList.contains('is-open')).toBe(true)
    dialog.click()
    expect(dialog.classList.contains('is-open')).toBe(false)
    shell.release()
  })
})
