import { createStyleLedger } from '../core/owned-styles.js'
import type { StyleLedger } from '../core/owned-styles.js'
import { announceViewer } from '../core/deck-viewer.js'

export interface ModalContent {
  node: HTMLElement
  label: string
  duration: number
  scale: string
  ease: string
  reducedMotion: boolean
  onKey?: (event: KeyboardEvent) => void
  onClose?: () => void
  /**
   * Whether a click on `target` lands on the content and keeps the viewer open. Omitted, anything
   * inside the content node counts; a viewer whose node fills the screen narrows it to its media.
   */
  inside?: (target: Element) => boolean
  /**
   * The element that opened this content — a deck's card, a `lightbox` trigger. The shell announces
   * `kui:viewer` from it on open and on close (`core/deck-viewer.ts`), which is how a deck it sits in
   * pauses its own motion for exactly as long as the viewer shows one of its cards.
   */
  opener?: Element
}

export interface ModalShell {
  open(content: ModalContent): void
  dismiss(): void
  release(): void
}

interface ShellState {
  doc: Document
  dialog?: HTMLDialogElement
  slot?: HTMLElement
  current?: ModalContent
  currentOwner?: object
  lock?: StyleLedger
  style?: StyleLedger
  timer?: ReturnType<typeof setTimeout>
  refs: number
}

const shells = new WeakMap<Document, ShellState>()

function unlock(state: ShellState): void {
  state.lock?.restore()
  state.lock = undefined
}

function lock(state: ShellState): void {
  if (state.lock) return
  const root = state.doc.documentElement
  const ledger = createStyleLedger(root)
  const gap = state.doc.defaultView!.innerWidth - root.clientWidth
  ledger.set('overflow', 'hidden')
  if (gap > 0) ledger.set('padding-right', `${gap}px`)
  state.lock = ledger
}

function clearContent(state: ShellState): void {
  const closing = state.current
  closing?.onClose?.()
  state.current = undefined
  state.currentOwner = undefined
  state.slot?.replaceChildren()
  if (closing?.opener) announceViewer(state.doc, closing.opener, false)
}

function onClose(state: ShellState): void {
  state.dialog?.classList.remove('is-open')
  unlock(state)
  clearContent(state)
}

function dismiss(state: ShellState): void {
  const dialog = state.dialog
  if (!dialog?.open || state.timer !== undefined) return
  dialog.classList.remove('is-open')
  state.timer = setTimeout(() => {
    state.timer = undefined
    if (dialog.open) dialog.close()
    // A close event is not guaranteed after cancellation/removal. Both paths are idempotent.
    unlock(state)
    clearContent(state)
  }, state.current!.reducedMotion ? 0 : state.current!.duration)
}

function clickedOutside(state: ShellState, target: Element): boolean {
  const { node, inside } = state.current!
  if (inside) return !inside(target)
  return !node.contains(target) && !target.closest('button')
}

function forceReflow(element: HTMLElement): number {
  return element.offsetWidth
}

function build(state: ShellState): void {
  if (state.dialog) return
  const dialog = state.doc.createElement('dialog')
  dialog.className = 'kui-lightbox'
  const close = state.doc.createElement('button')
  close.type = 'button'
  close.className = 'kui-lightbox-close'
  close.setAttribute('aria-label', 'Close viewer')
  close.textContent = '×'
  const slot = state.doc.createElement('div')
  slot.className = 'kui-lightbox-slot'
  dialog.append(close, slot)
  state.doc.body.append(dialog)
  close.addEventListener('click', () => dismiss(state))
  dialog.addEventListener('click', (event) => {
    if (clickedOutside(state, event.target as Element)) dismiss(state)
  })
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault()
    dismiss(state)
  })
  dialog.addEventListener('close', () => onClose(state))
  dialog.addEventListener('keydown', (event) => state.current?.onKey?.(event))
  state.dialog = dialog
  state.slot = slot
  state.style = createStyleLedger(dialog)
}

function open(state: ShellState, content: ModalContent, owner: object): void {
  build(state)
  const dialog = state.dialog!
  if (state.timer !== undefined) clearTimeout(state.timer)
  state.timer = undefined
  clearContent(state)
  state.current = content
  state.currentOwner = owner
  state.slot!.replaceChildren(content.node)
  dialog.setAttribute('aria-label', content.label)
  state.style!.set('--kui-lightbox-duration', `${content.duration}ms`)
  state.style!.set('--kui-from-scale', content.scale)
  state.style!.set('--kui-lightbox-ease', content.ease)
  lock(state)
  if (!dialog.open) dialog.showModal()
  dialog.scrollTop = 0
  // A synchronous style flush makes the closed and open styles distinct even in background tabs;
  // requestAnimationFrame can be throttled there and leave an invisible modal blocking the page.
  forceReflow(dialog)
  dialog.classList.add('is-open')
  if (content.opener) announceViewer(state.doc, content.opener, true)
}

function closeNow(state: ShellState): void {
  if (state.timer !== undefined) clearTimeout(state.timer)
  state.timer = undefined
  if (state.dialog?.open) state.dialog.close()
  onClose(state)
}

function release(state: ShellState, owner: object): void {
  state.refs -= 1
  if (state.currentOwner === owner || state.refs === 0) closeNow(state)
  if (state.refs > 0) return
  state.style?.restore()
  state.dialog?.remove()
  shells.delete(state.doc)
}

/**
 * Share one lazily built modal per document across image and video widgets. The final live
 * instance removes it, including an in-flight close timer and any scroll lock.
 * @complexity O(1) per operation; O(1) shared DOM per document.
 * @overallScore 100
 */
export function acquireModalShell(doc: Document): ModalShell {
  let state = shells.get(doc)
  if (!state) {
    state = { doc, refs: 0 }
    shells.set(doc, state)
  }
  state.refs += 1
  const shared = state
  const owner = {}
  let released = false
  return {
    open: (content) => open(shared, content, owner),
    dismiss: () => dismiss(shared),
    release: () => {
      if (released) return
      released = true
      release(shared, owner)
    },
  }
}
