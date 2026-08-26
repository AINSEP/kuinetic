# Getting Started

This page is the fast path: install it, write one attribute, see it move. For the full list of
255 named effects see the [Catalog](?doc=catalog); for why the library is built the way it is —
the channel model, activation vs. timeline, the packaging strategy — see
[Architecture](?doc=design).

---

## Install

Two files, no build step, no bundler config.

```html
<link rel="stylesheet" href="./kuinetic.css">
<script src="./kuinetic.js"></script>
<script>
  kuinetic.kuinetic({ observe: true }).start()
</script>
```

`observe: true` keeps a `MutationObserver` running so elements added to the page later — by your
own app code, a CMS, or a client-side router — get picked up automatically. Drop it if you're
authoring a fully static page and want the smallest possible init.

From a CDN, the same two files without downloading anything:

```html
<link rel="stylesheet" href="https://unpkg.com/kuinetic/dist/kuinetic.css">
<script src="https://unpkg.com/kuinetic/dist/kuinetic.js"></script>
```

Or with a bundler, where the named export replaces the `kuinetic.kuinetic` global:

```js
import { kuinetic } from 'kuinetic'
import 'kuinetic/css'

kuinetic({ observe: true }).start()
```

---

## Your first animation

One attribute. No JS to write.

```html
<h1 data-kui="fade-up">Hello.</h1>
```

```live
<div class="doc-demo-box" data-kui="fade-up 700ms" data-kui-on="load">Hello.</div>
```

That box played once, on load. On a real page you'd normally leave the activation as its default —
`on:enter` — so it plays the moment the element scrolls into view instead. This demo pins it to
`on:load` (`data-kui-on="load"`) only because a small boxed example has no scroll runway of its
own to demonstrate "on:enter" with.

---

## Timing and easing

Three positional args, always in this order: duration, delay, easing.

```html
<div data-kui="fade-up 900ms 150ms ease-out">
```

```live
<div class="doc-demo-box" data-kui="fade-up 900ms 150ms ease-out" data-kui-on="load">900ms, 150ms delay</div>
<div class="doc-demo-box" data-kui="bounce-in-up 900ms 300ms" data-kui-on="load">bounce-in-up, 300ms delay</div>
```

---

## Hover and interaction effects

Not every effect is a scroll reveal. Some are driven by real interaction — the `on:` activation
switches from `enter` to `hover`, `click`, `focus`, or `manual`.

```html
<button data-kui="shine-sweep">Hover me</button>
```

```live
<button class="doc-demo-box" data-kui="shine-sweep" style="cursor: pointer;">shine-sweep — hover me</button>
<div class="doc-demo-box" data-kui="tilt-3d maxAngle:16" style="cursor: pointer;">tilt-3d — hover me</div>
```

---

## Text effects

Text-specific primitives split, type, or scramble the content — they still read correctly to
screen readers (see [Architecture §12](?doc=design#12-platform-considerations)).

```html
<span data-kui="typewriter">Typed on load.</span>
```

```live
<span class="doc-demo-box" data-kui="typewriter" data-kui-on="load">Typed on load.</span>
<span class="doc-demo-box">count-up: <b data-kui="count-up 1400ms to:237" data-kui-on="load">0</b></span>
```

---

## Parameters you'll actually reach for

Every effect accepts these; individual effects add their own on top (`distance:`, `to:`, `charset:`, …
— see each effect's entry in the [Catalog](?doc=catalog)).

| Param | What it does | Example |
|---|---|---|
| duration | first positional arg, or `duration:` | `fade-up 800ms` |
| delay | second positional arg, or `delay:` | `fade-up 800ms 200ms` |
| easing | third positional arg, or `ease:` | `fade-up 800ms 200ms ease-out` |
| `on:` | activation: `load` `enter` `hover` `focus` `click` `manual` | `fade-up on:hover` |
| `timeline:` | what drives progress: `time` `view` `scroll` `pin` | `parallax-rotate timeline:view` |
| `timeline:pin` | seek from a pinning primitive's own progress, for effects that must animate *while* pinned (a `view` timeline stalls when an element sticks) | `pin-section distance:200vh, parallax-rotate timeline:pin` |
| `data-kui-threshold` | how much of the element must be visible before `on:enter` fires | `data-kui-threshold="30%"` |
| `data-kui-stagger` | delay increment applied to matched children in a group | `data-kui-stagger="60ms"` |

Only the element-scoped settings have longhand attribute forms — `data-kui-on`,
`data-kui-timeline`, `data-kui-threshold`, and `data-kui-stagger`. Where an inline key also exists
it wins (`on:hover` beats `data-kui-on="click"`). Timing has no longhand: duration, delay, and
easing are read from the `data-kui` value only.

---

## Composing more than one effect

Comma-separate effects whose channels don't collide and they play together as one compiled
declaration — no extra markup, no wrapper element.

```html
<h1 data-kui="slide-up 800ms, blur-in 400ms">
```

```live
<div class="doc-demo-box" data-kui="slide-up 800ms, blur-in 400ms" data-kui-on="load">slide-up + blur-in</div>
```

If two effects in the same list *do* write the same CSS property, the library keeps the first and
warns in the console naming both — never a silent drop — see
[Architecture §4](?doc=design#4-composition-the-channel-model) for the full resolution order.

---

## Knowing when an animation finished

Every animated element dispatches three `CustomEvent`s at its own lifecycle points. They're plain
DOM events on the element itself, so you listen with `addEventListener` and write nothing
library-specific:

```js
document.querySelector('.hero').addEventListener('kui:finish', (event) => {
  console.log(event.detail.effects) // ['fade-up', 'blur-in']
})
```

| event | when |
|---|---|
| `kui:start` | the activation fired and the effects began |
| `kui:finish` | every finite effect on the element completed |
| `kui:cancel` | the effects were torn down or cancelled before completing |

They bubble, so one listener on `document` covers a whole page of animations:

```js
document.addEventListener('kui:finish', (event) => {
  event.target.classList.add('is-revealed')
})
```

`event.detail` carries `{ effects, activation, timeline, reason }`. `effects` is the same name list
`data-kui-fx` holds, so a delegated listener can tell which effect just finished without reading
the DOM. `reason` distinguishes routes to the same event — in particular, `kui:finish` arrives with
`reason: 'reduced-motion'`, and no preceding `kui:start`, for an effect that was skipped because
the visitor asked for reduced motion. The element really is at its end state, so anything you chain
off `kui:finish` still runs for those visitors.

There is deliberately **no per-frame event**. A `CustomEvent` for every animated element on every
frame would drag every compiled animation back onto the main thread, which is the one thing this
library is built to avoid. Read progress instead — see below.

---

## Controlling a running animation

`control()` hands you the playhead of anything already animating. It takes the same targets `play()`
does — a selector, an element, or any iterable of elements — and its methods chain:

```js
const kui = kuinetic({ observe: true }).start()

const hero = kui.control('.hero')
hero.pause()
hero.seek(0.5)        // progress is normalized 0..1, never milliseconds
hero.timeScale(0.25)  // quarter speed; a negative value runs backwards
hero.play()
hero.reverse()

hero.progress // 0..1, the least-advanced element in the selection
hero.state    // 'idle' | 'running' | 'paused' | 'finished'
```

Progress spans the element's **whole** timeline — from the instant the activation fired to the end
of its last composed effect, authored delays included. So for
`data-kui="fade-up 600ms, blur-in 400ms delay:600ms"`, `seek(0.5)` lands at 500 ms, halfway through
the second of the two.

Two kinds of effect have no playhead to hand you, and `control()` says so by name rather than
quietly doing nothing:

- **JavaScript-rendered effects** (drag, pin, scroll-spy, the counters). They have no `Animation`
  object and no shared notion of progress, so pause, seek and `timeScale` do not reach them.
- **Scroll-driven effects** (`timeline: view | scroll | pin`). Their playhead belongs to the
  scroller — pausing or seeking one would be overwritten on the next scroll frame.

Both are listed on `handle.uncontrolled`, and both are reported through the animator's reporter, so
`kuinetic({ reporter: consoleReporter() })` prints the reason during development. An element that
composes both kinds is still controlled as far as it can be: the CSS half responds, the rest is
named.

Want a value each frame? Read `progress` from your own loop, and pay only for the one element you
care about:

```js
const hero = kui.control('.hero')
const frame = () => {
  bar.style.width = `${hero.progress * 100}%`
  if (hero.state === 'running') requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
```

---

## Common mistakes

- **Mixing up `on:` and `timeline:`.** `on:enter` plays once and stays finished. `timeline: view()`
  is continuously scroll-linked and reverses on scroll-up. They're separate axes, not two tiers of
  the same thing — see [Architecture §5](?doc=design#5-activation-and-timeline-are-separate-axes).
- **Expecting a duration on a progress-timeline effect.** `800ms` is meaningful on `fade-up`; it's
  close to meaningless on `parallax-y` or `progress-ring 1200ms timeline:scroll` — progress there
  comes from scroll position, not a clock.
- **Two effects fighting over the same channel.** `fade-up` (opacity + translate) and `slide-left`
  (also translate) collide; compose `fade-up` with `blur-in` (filter) instead, or check the
  Channels column in the [Catalog](?doc=catalog) before combining two names.
- **Forgetting `data-kui-stagger` needs a group, not a target.** Put it on the *parent*
  (`data-kui-stagger="60ms"` on a list), not on each child — the stagger is a group behavior.

---

## Where next

- **[Catalog](?doc=catalog)** — all 255 named effects, grouped by category, with renderer and
  channel metadata for each.
- **[Architecture](?doc=design)** — the attribute grammar, the composition model, and why the
  library is built the way it is.
