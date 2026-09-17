/**
 * Build input for `demo/kuinetic-advanced.js`. Not shipped, not part of the package, not imported
 * by anything in `src/` — the demo-page equivalent of `demo/tailwind-entry.css`.
 *
 * Why this file exists at all, rather than the page loading `kuinetic.js` and a second bundle of
 * `src/advanced/index.ts` beside it: `registerInto` (src/advanced/base.ts) gates on
 * `target instanceof Registry` / `target.registry instanceof Registry`. Two independent esbuild
 * IIFE bundles each inline their own copy of `src/core/registry.ts`, so the `Registry` class the
 * advanced bundle tests against is a different class object from the one the core bundle
 * constructed the animator's registry with. `instanceof` is identity, not shape, so it fails and
 * `registerAdvanced` throws `requires a Registry or Animator instance` — with an animator that is
 * in every observable way a valid animator.
 *
 * Bundling core and advanced from one entry point puts both in one module graph, so there is one
 * `Registry` class and the check passes. That is also what the real shipping form will do: a
 * `kuinetic/advanced` subpath export resolves to the same package instance as `kuinetic`, one
 * module graph, same class identity. It is only the two-separate-script-tags form that cannot
 * work, and `test/browser/fixtures/advanced-webgl-entry.ts` already bundles the two together for
 * this same reason.
 *
 * Build (see demo/shaders-audio.html's #load section):
 *   npx esbuild demo/kuinetic-advanced-entry.ts --bundle --format=iife \
 *     --global-name=kuineticLab --outfile=demo/kuinetic-advanced.js
 */

export * from '../src/index.js'
export { registerAdvanced } from '../src/advanced/index.js'
