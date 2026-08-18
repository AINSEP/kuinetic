# kUInetic

Declarative web animation from HTML attributes. Native CSS where possible, JS only where necessary.

The common 80% of web motion — scroll reveals, hover/click micro-interactions, text effects,
counters, SVG morphs — authored as a single `data-kui` attribute, executed natively by the browser
wherever CSS can do it. Standalone, MIT, npm + CDN, framework-agnostic. No product or CMS coupling.

```html
<h1 data-kui="fade-up">Hello.</h1>
```

~237 named effects across scroll reveals, hover/interaction, text, numbers, layout, SVG, 3D, and
gesture-driven motion. 100% branch/statement/function/line test coverage, 788 tests.

## Install

Pick whichever fits — no build step, no bundler config required for any of these.

**Split bundle** (recommended: the CSS keeps working even if the JS is slow, blocked, or fails to
load) — download `kuinetic.js` + `kuinetic.css`, or use them straight from the CDN:

```html
<link rel="stylesheet" href="./kuinetic.css">
<script src="./kuinetic.js"></script>
<script>
  kuinetic.kuinetic({ observe: true }).start()
</script>
```

**One tag, self-hosted** — CSS embedded, auto-started with `observe: true`:

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

### CDN reference

Every file is mirrored on jsDelivr and unpkg — both update automatically from every npm release,
no separate action needed — and additionally self-hosted on Cloudflare at **`kuinetic.pages.dev`**:

| File | jsDelivr | unpkg | Cloudflare |
|---|---|---|---|
| `kuinetic.js` | [`cdn.jsdelivr.net/npm/kuinetic`](https://cdn.jsdelivr.net/npm/kuinetic) (shorthand) | [`unpkg.com/kuinetic`](https://unpkg.com/kuinetic) (shorthand) | [`kuinetic.pages.dev/kuinetic.js`](https://kuinetic.pages.dev/kuinetic.js) |
| `kuinetic.css` | [`cdn.jsdelivr.net/npm/kuinetic/dist/kuinetic.css`](https://cdn.jsdelivr.net/npm/kuinetic/dist/kuinetic.css) | [`unpkg.com/kuinetic/dist/kuinetic.css`](https://unpkg.com/kuinetic/dist/kuinetic.css) | [`kuinetic.pages.dev/kuinetic.css`](https://kuinetic.pages.dev/kuinetic.css) |
| `kuinetic.all.js` | [`cdn.jsdelivr.net/npm/kuinetic/dist/kuinetic.all.js`](https://cdn.jsdelivr.net/npm/kuinetic/dist/kuinetic.all.js) | [`unpkg.com/kuinetic/dist/kuinetic.all.js`](https://unpkg.com/kuinetic/dist/kuinetic.all.js) | [`kuinetic.pages.dev/kuinetic.all.js`](https://kuinetic.pages.dev/kuinetic.all.js) |

The shorthand (no path) only works for `kuinetic.js` — jsDelivr/unpkg resolve it from the
`"jsdelivr"`/`"unpkg"` fields in `package.json`; `.css` and `.all.js` need the explicit `/dist/`
path since only one default file can be designated that way. `kuinetic.js` is the split bundle —
side-effect-free on load, pair it with `kuinetic.css`, which keeps working even if the JS is slow,
blocked, or fails to load. `kuinetic.all.js` is the one-tag drop-in — CSS embedded, auto-started
with `observe: true` — trading that CSS-independence guarantee for one less step.

## Your first animation

```html
<div data-kui="fade-up 900ms 150ms ease-out">Hello.</div>
```

Three positional args, always duration → delay → easing. Compose effects that don't collide by
comma-separating them — no wrapper element, no extra markup:

```html
<h1 data-kui="slide-up 800ms, blur-in 400ms">
```

Not every effect is a scroll reveal — switch `on:` to drive it from hover, click, focus, or call it
manually:

```html
<button data-kui="shine-sweep">Hover me</button>
```

## Docs

- **Getting Started** — install, first animation, timing, composition, common mistakes.
- **Catalog** — all ~237 named effects, grouped by category, with renderer and channel metadata.
- **Architecture** — the attribute grammar, the composition model, and why the library is built
  the way it is (`docs/design.md` in this repo).

## Repository

Source, issues, and contributions: [github.com/AINSEP/kuinetic](https://github.com/AINSEP/kuinetic)

## License

MIT
