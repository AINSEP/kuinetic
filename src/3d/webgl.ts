/**
 * Does this environment have WebGL 2 at all?
 *
 * **This deliberately does not request a context.** `getContext('webgl2')` is the only answer that
 * is true in every sense, and it is also an allocation: on a machine at its context limit it evicts
 * a live one, and in a browser with a blocklisted GPU it can take tens of milliseconds. A presence
 * check is cheap, synchronous, and wrong only in the direction that is safe — an environment that
 * has the constructor but refuses a context falls through to the renderer's own failure path, which
 * shows the same still image this one does.
 *
 * It is also the only probe that works before there is a renderer to fail. The skeleton has to
 * decide canvas-or-fallback in `prepare()`, and it has no GL code to ask.
 *
 * Not a field on `core/capabilities.ts`'s `Capabilities`, and not added to it: that record is the
 * *core* feature-detection surface, every entry of which gates something core renders. A tier that
 * is opt-in by subpath should not widen core's public type to hold a flag core never reads.
 *
 * @param win - The window to interrogate. Injected rather than read off the global so a test can
 *   drive both answers; jsdom defines no `WebGL2RenderingContext`, so the real one is always
 *   `false` there and the mounted-canvas path would otherwise be unreachable.
 * @returns Whether WebGL 2 is present.
 * @complexity O(1).
 */
export function detectWebGL(win: object | null | undefined): boolean {
  return Boolean(win) && 'WebGL2RenderingContext' in (win as object)
}
