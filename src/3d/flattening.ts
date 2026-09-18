/**
 * Dev-mode diagnostic: which ancestor is clipping the scene.
 *
 * Adapted from `warnFlatteningAncestor` in `src/effects/carousel/index.ts:129-175` — copied rather
 * than imported, for the bundle reason `src/3d/register.ts` sets out.
 *
 * **Why this tier needs one at all.** A canvas is a canvas: an ancestor cannot flatten what it
 * renders the way it flattens a CSS `preserve-3d` subtree. But the *host* is an ordinary element,
 * and an ancestor that clips it clips the render with it. The symptom — "the 3D scene is cut in
 * half, or gone" — points squarely at this effect while the cause is three levels up, and that gap
 * is the whole value of naming the element. So: yes, its own copy.
 *
 * **But a narrower table than the carousel's.** The original tests five properties, because all
 * five defeat `transform-style: preserve-3d`. Only two of them clip a canvas. `opacity` below 1, a
 * `filter` and a `backdrop-filter` are ordinary compositing on an ordinary element here — a dimmed
 * or blurred 3D hero is a design, not a bug, and warning about it would be a false positive on a
 * deliberate choice. Firing on things that are fine is how a diagnostic teaches people to ignore
 * it, which is the same reason the original stops at `<body>`.
 */

/**
 * The slice of `PrepareContext` this needs. A real one satisfies it structurally.
 *
 * Declared narrow rather than importing `PrepareContext` so a test can drive the walk with a fake
 * `getComputedStyle` and no realm, which is the only way to reach the guilty-ancestor branches
 * under jsdom.
 */
export interface FlatteningContext {
  win: { getComputedStyle?: (el: Element) => CSSStyleDeclaration | null }
  warn(message: string): void
}

/**
 * Properties on an ancestor that clip the host, and the value that is safe.
 *
 * Each entry is `[property, isClipping]`. A predicate per property rather than a set of bad values
 * because the two questions genuinely differ: `overflow` is "anything but visible", `clip-path` is
 * "anything but none". The empty-string arm is the "this realm has no layout" answer, not a value.
 */
const CLIPPING: readonly [string, (value: string) => boolean][] = [
  ['overflow', (value) => value !== '' && value !== 'visible'],
  ['clip-path', (value) => value !== '' && value !== 'none'],
]

/**
 * The first clipping declaration on one element, or `null`.
 *
 * Split out from the walk so each has one job — "which ancestor" and "is this one guilty" — and so
 * the guilt test is a lookup a fake `getComputedStyle` can drive directly.
 *
 * `getComputedStyle` is optional-chained: a primitive can be prepared against a document whose
 * realm has no layout at all, and a diagnostic must never be the thing that throws.
 *
 * @complexity O(1) time — two fixed properties; one forced style resolution.
 */
function clippingDeclaration(
  node: Element,
  ctx: FlatteningContext,
): { property: string; value: string } | null {
  const style = ctx.win.getComputedStyle?.(node)
  if (!style) return null
  for (const [property, clips] of CLIPPING) {
    const value = style.getPropertyValue(property)
    if (clips(value)) return { property, value }
  }
  return null
}

/**
 * Walk the ancestors and warn about the first one that clips the scene.
 *
 * A diagnostic, not a fix: there is nothing this library can safely do about an ancestor it does
 * not own — removing an `overflow: hidden` a page relies on to clip something else would trade a
 * cropped model for a broken layout. Naming the element is the whole value.
 *
 * Stops at the first offender rather than listing all of them: the first one already clips
 * everything below it, so the rest are consequences of a page the author has yet to change. Stops
 * at `<body>` because a page-level `overflow-x: hidden` on `<html>`/`<body>` — which is on a large
 * fraction of all sites — would otherwise fire on every model ever authored.
 *
 * @param el - The model host.
 * @param ctx - Effect context, for the window (`getComputedStyle`) and the warning sink.
 * @complexity O(d) time in tree depth, once per instance; O(1) space.
 */
export function warnClippingAncestor(el: Element, ctx: FlatteningContext): void {
  // `Node.ownerDocument` is typed nullable because it is null for a `Document`, which cannot reach
  // here — an Element always has one. `body`, on the other hand, genuinely can be absent (an XML
  // document has none), and the walk needs no default for that: a `body` of `null` simply never
  // matches, so it runs to the root, which is the right answer when there is no body to stop at.
  const body: Element | null = (el.ownerDocument as Document).body
  let node = el.parentElement
  while (node && node !== body) {
    const found = clippingDeclaration(node, ctx)
    if (found) {
      ctx.warn(
        `model-3d: an ancestor <${node.localName}> has ${found.property}: ${found.value}, which ` +
          'clips the host — the scene will render cropped or not at all. Move the model out of ' +
          'it, or drop that property on the ancestor.',
      )
      return
    }
    node = node.parentElement
  }
}
