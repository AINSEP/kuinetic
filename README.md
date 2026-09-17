# kUInetic

Declarative web animation from HTML attributes. Native CSS where possible, JS only where necessary.

The common 80% of web motion — scroll reveals, hover/click micro-interactions, text effects,
counters, SVG morphs — authored as a single `data-kui` attribute, executed natively by the browser
wherever CSS can do it. Standalone, MIT, npm + CDN, framework-agnostic. No product or CMS coupling.

```html
<h1 data-kui="fade-up">Hello.</h1>
```

292 named effects across scroll reveals, hover/interaction, text, numbers, layout, SVG, 3D, and
gesture-driven motion. 100% branch/statement/function/line test coverage, over 800 tests.

## Install

Pick whichever fits — no build step, no bundler config required for any of these.

**Split bundle** (recommended: the CSS keeps working even if the JS is slow, blocked, or fails to
load) — download `kuinetic.js` + `kuinetic.css`, or use them straight from the CDN:

```html
<link rel="stylesheet" href="./kuinetic.css">
<script src="./kuinetic.js"></script>
```

That is the whole integration — no JavaScript of your own. The script starts itself once the
document is ready, with `observe: true`, so elements added later by your app, a CMS or a
client-side router are picked up automatically.

To drive it by hand instead, put `data-kui-manual` on the tag and the script does nothing until you
say so:

```html
<script src="./kuinetic.js" data-kui-manual></script>
<script>
  kuinetic.kuinetic({ observe: true }).start()
</script>
```

**One tag, self-hosted** — same auto-start, CSS embedded so there is no `<link>` either:

```html
<script src="./kuinetic.all.js"></script>
```

**One tag, zero download** — served from Cloudflare's CDN:

```html
<!-- one-tag convenience -->
<script src="https://kuinetic.pages.dev/kuinetic.all.js"></script>
```

Or via npm, with a bundler:

```bash
npm install kuinetic
```

```js
import { kuinetic } from 'kuinetic'
import 'kuinetic/css'

kuinetic({ observe: true }).start()
```

### Experimental: the advanced tier

A separate, opt-in set of WebGL, CSS-3D and Web-Audio primitives — shader surfaces, a depth camera,
particle dissolve, a fluid cursor trail, and an audio-reactive driver. It is a **tier**: a second
file you add beside core, never a different build of core.

```html
<script src="./kuinetic.js"></script>
<script src="./kuinetic.advanced.js"></script>
```

In either order, with nothing else. Core is not shipped twice — the tier externalises it — and the
two find each other and share one animator. A later tier (`kuinetic.3d.js`, when it exists) is
another tag on the same terms, never a combined bundle.

Or via npm, where the subpath resolves to the same package instance:

```js
import { kuinetic } from 'kuinetic'
import { registerAdvanced } from 'kuinetic/advanced'

const k = kuinetic()
registerAdvanced(k) // or one module at a time: registerShaders, registerCamera, …
k.start()
```

It is **unstable and not covered by the guarantees the rest of this README makes** — the API can
change without a major version, and nothing here is CSS-first or zero-JS. Nothing is imported
unless you write that import: the default entry is byte-for-byte the same whether or not this
subpath exists. See `docs/advanced-modules.md` for what each module does and what it costs.

### CDN reference

Every file is mirrored on jsDelivr and unpkg — both update automatically from every npm release,
no separate action needed — and additionally self-hosted on Cloudflare at **`kuinetic.pages.dev`**:

| File | cdn.jsdelivr.net | unpkg.com | kuinetic.pages.dev |
|---|---|---|---|
| `kuinetic.js` | [`/npm/kuinetic`](https://cdn.jsdelivr.net/npm/kuinetic) † | [`/kuinetic`](https://unpkg.com/kuinetic) † | [`/kuinetic.js`](https://kuinetic.pages.dev/kuinetic.js) |
| `kuinetic.css` | [`/npm/kuinetic/dist/kuinetic.css`](https://cdn.jsdelivr.net/npm/kuinetic/dist/kuinetic.css) | [`/kuinetic/dist/kuinetic.css`](https://unpkg.com/kuinetic/dist/kuinetic.css) | [`/kuinetic.css`](https://kuinetic.pages.dev/kuinetic.css) |
| `kuinetic.all.js` | [`/npm/kuinetic/dist/kuinetic.all.js`](https://cdn.jsdelivr.net/npm/kuinetic/dist/kuinetic.all.js) | [`/kuinetic/dist/kuinetic.all.js`](https://unpkg.com/kuinetic/dist/kuinetic.all.js) | [`/kuinetic.all.js`](https://kuinetic.pages.dev/kuinetic.all.js) |
| `kuinetic.advanced.min.js` | [`/npm/kuinetic/dist/kuinetic.advanced.min.js`](https://cdn.jsdelivr.net/npm/kuinetic/dist/kuinetic.advanced.min.js) | [`/kuinetic/dist/kuinetic.advanced.min.js`](https://unpkg.com/kuinetic/dist/kuinetic.advanced.min.js) | — |

† shorthand — resolves via the `"jsdelivr"`/`"unpkg"` fields in `package.json`; only `kuinetic.js`
gets one, since a package can only designate a single default file that way.

`kuinetic.js` is the split bundle — pair it with `kuinetic.css`, which keeps working even if the JS
is slow, blocked, or fails to load. `kuinetic.all.js` is the one-tag drop-in, the same thing with
the CSS embedded, trading that CSS-independence guarantee for one less step.
`kuinetic.advanced.min.js` is a tier: it needs core on the page, in either order, and never carries
a copy of it.

Every one of those browser bundles starts itself once the document is ready. `data-kui-manual` on a
`<script>` tag turns that off for that file. Importing from npm does **not** start anything — a
module import stays side-effect-free, which is the guarantee the bundler path is built on.

> **Changed in 0.2.** These bundles used to do nothing until you called
> `kuinetic.kuinetic({ observe: true }).start()` yourself, and `kuinetic.all.js` started itself the
> instant it parsed rather than at `DOMContentLoaded`. If you already write that call, it keeps
> working and your animator is still the one the page uses — you will see one console line saying
> the call is now redundant. Add `data-kui-manual` to the tag to silence it and go back to driving
> everything by hand.

## Your first animation

```html
<div data-kui="fade-up 900ms 150ms ease-out">Hello.</div>
```

Three positional args, always duration → delay → easing. Compose effects that don't collide by
comma-separating them — no wrapper element, no extra markup:

```html
<h1 data-kui="slide-up 800ms, blur-in 400ms">
```

A composition worth repeating gets a name, with no build step. Define it once in a `<template>` —
which never renders, so it can sit anywhere on the page, including below the elements that use it:

```html
<template data-kui-define="card-in" data-kui="fade-up 700ms, blur-in 400ms at:-200ms"></template>

<article data-kui="card-in"></article>
<article data-kui="card-in 300ms">…the same bundle, faster</article>
```

Not every effect is a scroll reveal — switch `on:` to drive it from hover, click, focus, or call it
manually:

```html
<button data-kui="shine-sweep">Hover me</button>
```

Every animated element dispatches `kui:start` / `kui:finish` / `kui:reverse-finish` / `kui:cancel`
as ordinary bubbling DOM events, so `addEventListener('kui:finish', fn)` is all you need to chain
work off an animation — and it is what any project with a build step should use. On a no-build page,
`func:` names a global function to run at that same moment instead:

```html
<div data-kui="fade-up func:onReveal">…</div>
```

`func:` is a lookup by name on `window`, so never build its value from a CMS field or any other
untrusted input — see Getting Started for the full note.

## Docs

- **Getting Started** — install, first animation, timing, composition, common mistakes.
- **Catalog** — all 292 named effects, grouped by category, with renderer and channel metadata.
- **Architecture** — the attribute grammar, the composition model, and why the library is built
  the way it is (`docs/design.md` in this repo).

## Repository

Source, issues, and contributions: [github.com/AINSEP/kuinetic](https://github.com/AINSEP/kuinetic)

## License

MIT
