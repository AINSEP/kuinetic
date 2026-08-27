# Getting Started

This page is the fast path: install it, write one attribute, see it move. For the full list of
267 named effects see the [Catalog](?doc=catalog); for why the library is built the way it is —
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

## Any event can start an animation

`on:` is not a list of six names. Anything you could pass to `addEventListener` works, so an
animation can be triggered by a form field, a submit, a drag, a media element, or an event your own
code dispatches — still without writing a line of JavaScript.

```html
<input data-kui="shake-error" data-kui-on="invalid">
<form data-kui="glow-pulse" data-kui-on="submit">
<div  data-kui="fade-up" data-kui-on="cart:updated">
```

The names the library adds on top are the ones the DOM has no event for, or where one name is
tidier than two: `load`, `enter` and `leave` (visibility), `manual` (API only), `hover`/`unhover`,
`focus`/`blur`, and `click`.

### Playing an animation back out

Write two activations separated by a slash and the effect plays forward on the first and backwards
on the second, landing exactly where it started.

```html
<div data-kui="fade-up" data-kui-on="pointerenter/pointerleave">
<div data-kui="fade-up" data-kui-on="hover/unhover">
<div data-kui="fade-up" data-kui-on="enter/leave">
```

`enter/leave` is the one worth knowing: plain `on:enter` fires once and stays, which is right for a
reveal, and the pair keeps the observer live so the element fades back out when it scrolls away and
in again when it returns. Existing markup is unaffected — `on:enter` on its own still fires exactly
once.

Reversing needs a real playhead, which only CSS-rendered effects have. Pair an exit with a
JavaScript-rendered effect (`split-flap`, `draggable`, `count-up`) and the library warns rather than
doing nothing quietly. And because the list is open, a misspelled event can no longer be rejected as
"unknown" — so `data-kui-on="clik"` warns that no such DOM event exists and suggests `click`
instead. Turn warnings on with `kuinetic({ reporter: consoleReporter() })` while developing.

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
| `at:` | position this effect relative to the previous one in the comma list | `blur-in at:-200ms` |
| `above:` | run this effect only from a breakpoint up | `parallax-y above:md` |
| `below:` | run this effect only below a breakpoint | `fade-up below:md` |
| `on:` | activation: a library name, any DOM event, or a `start/end` pair | `fade-up on:hover` |
| `timeline:` | what drives progress: `time` `view` `scroll` `pin` | `parallax-rotate timeline:view` |
| `timeline:pin` | seek from a pinning primitive's own progress, for effects that must animate *while* pinned (a `view` timeline stalls when an element sticks) | `pin-section distance:200vh, parallax-rotate timeline:pin` |
| `threshold:` | how much of the element must be visible before `on:enter` fires | `fade-up threshold:30%` |
| `cascade:` | delay increment applied to this element's animated children | `cascade:60ms` |
| `spread:` | total time the whole cascade may take, however many children there are | `spread:600ms` |
| `order:` | where the cascade starts | `cascade:60ms order:center` |
| `cols:` | the group's column count, so the ordering is 2D — or `auto` to measure it | `cols:6 order:center` |
| `along:` | restrict a grid cascade to one axis | `cols:6 along:x` |
| `rm:` | reduced-motion policy for this element; may only be made *stricter* | `spin rm:disable` |
| `func:` | name a global function to call when this element finishes — see [below](#calling-a-function-when-it-finishes) | `fade-up func:onReveal` |

Only the element-scoped settings have longhand attribute forms — `data-kui-on`,
`data-kui-timeline`, `data-kui-threshold`, and `data-kui-stagger`. Where an inline key also exists
it wins (`on:hover` beats `data-kui-on="click"`, `cascade:60ms` beats `data-kui-stagger="90ms"`).
Timing has no longhand: duration, delay, and easing are read from the `data-kui` value only.

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
[Architecture §4](?doc=design#4-composition-the-channel-model) for the full resolution order. The
one exception is two effects that can never run at the same viewport width (`fade-up below:md,
fade-left above:md`): they cannot collide, so they compose.

---

## Sequencing — `at:`

Comma-separated effects all start at the same instant. `at:` moves one of them **relative to the
one before it in the list**, so you stop hand-computing delays:

```html
<h1 data-kui="fade-up 600ms, blur-in 400ms at:-200ms">
```

`blur-in` starts 200ms *before* `fade-up` ends — a 400ms delay, which the compiler works out for
you and re-works if you change either number.

```live
<div class="doc-demo-box" data-kui="fade-up 600ms, blur-in 400ms at:-200ms" data-kui-on="load">overlapped by 200ms</div>
<div class="doc-demo-box" data-kui="fade-up 600ms, blur-in 400ms at:+100ms" data-kui-on="load">100ms gap after fade-up</div>
```

| Spelling | Where it starts |
|---|---|
| `at:-200ms` | 200ms **before** the previous effect ends — they overlap |
| `at:+100ms` | 100ms **after** the previous effect ends — a gap |
| `at:after` | exactly when the previous effect ends |
| `at:with` | the same instant the previous effect starts |
| `at:with+150ms` | 150ms after the previous effect *starts* |

Each `at:` chains off the one before it, so a three-effect list reads front to back:

```html
<h1 data-kui="fade-up 600ms, blur-in 400ms at:-200ms, zoom-in 300ms at:+50ms">
```

Three things worth knowing:

- **`at:` is always relative.** `at:200ms` is refused, with a warning, because it would be nothing
  but `delay:200ms` under a second name.
- **It positions against the previous *effect*, not the previous *element*.** Sequencing across
  sibling elements is not built yet; use `data-kui-stagger` on the parent for that.
- **It compiles to a delay**, so a scroll-driven `timeline:view`/`timeline:scroll` ignores it —
  position those with a range instead (`data-kui-timeline="view entry 0% cover 60%"`). It does work
  on `timeline:pin`, where the delay is the scrub head.

---

## Naming a composition — `data-kui-define`

Once an attribute is three effects long you don't want to retype it on twelve cards. Give it a
name once, in a `<template>`, and use the name:

```html
<template data-kui-define="card-in"
          data-kui="fade-up 700ms, blur-in 400ms at:-200ms"></template>

<article data-kui="card-in"></article>
<article data-kui="card-in"></article>
```

```live
<div class="doc-demo-box" data-kui="fade-up 700ms, blur-in 400ms at:-200ms" data-kui-on="load">card-in</div>
```

A `<template>` never renders, so the definition can sit anywhere in the page — including *below*
the elements that use it. It needs no `hidden`, no CSS, and no script.

**A local value overrides the bundle**, the way a more specific CSS rule wins:

```html
<article data-kui="card-in 300ms">   <!-- the whole bundle, but faster -->
```

Anything you write beside the name — a duration, a delay, an easing, a `key:value` — replaces that
field on every effect the bundle expands to.

You can compose a bundle with an effect the same way you compose two effects, and the same
channel rules apply — if the bundle already writes a property, an effect that also writes it is
refused with a warning naming both:

```html
<article data-kui="card-in, shine-sweep">
```

A bundle can also name another bundle. A bundle that reaches itself warns with the path it took
and drops that one reference, so nothing hangs.

Six things the library will tell you about in the console (with `consoleReporter()`), rather than
failing quietly:

| What you wrote | What you'll hear |
|---|---|
| `data-kui="crd-in"` | `unknown effect "crd-in"` — plus `did you mean the bundle "card-in"?` |
| two `<template>`s with the same name | the first definition wins |
| a name the catalog already uses | the built-in effect wins, your definition is ignored |
| `data-kui-define="card in"` | a name can't contain spaces, commas, colons, brackets or quotes |
| a definition with nothing in `data-kui` | it names no effect, so it animates nothing |
| `cascade:` inside a definition | stagger belongs on the group element, not in a bundle |

---

## Animating a different element — `target:` and `scope:`

`data-kui` normally animates the element it is written on. `target:` points it at something else
instead — a selector for what should actually move, authored on whichever element makes sense to
hold the attribute:

```html
<header data-kui="fade-up target:h1">
  <p class="eyebrow">New</p>
  <h1>The headline that actually animates</h1>
</header>
```

Only the `h1` moves. `header` never does — it just carries the instruction. Any effect can be
retargeted this way, not only the handful (`scroll-progress`, `scroll-spy`, `sequence-scrub`,
`step-progress`, and friends — catalog sections O/P) that already used `target:` for their own
reasons before this existed; those six still read it themselves and are unaffected by anything
below.

**`target:` always means "search inside myself"** — the element carrying the attribute, by
default. Add `scope:page` to search the whole document instead, for the case where what should
animate genuinely lives somewhere else on the page:

```html
<nav data-kui="glow-pulse target:'#cart-badge' scope:page"></nav>
```

Quote a selector containing spaces or commas, the same escape every other selector-taking
parameter in this library uses — `target:.stops > li` would otherwise parse `> li` as two stray
tokens.

Three things worth knowing:

- **A selector matching `<html>`/`<body>`, or one that does not parse, is refused with a warning**
  rather than stamping the whole document. So is a selector that simply matches nothing — check the
  console.
- **A handful of effects cannot be retargeted at all**, because their CSS assumes a child or
  sibling exists right next to the element it animates — `card-flip-x`, `hamburger-to-x`,
  `label-float`, and a dozen more in that shape. `target:` on one of these is dropped with a
  warning and the effect runs on the host as if you had not written it, rather than compiling to
  something that silently animates nothing.
- **Matching more than one element stamps and animates every one of them.** `fade-up target:li` on
  a list fades every `<li>` in — each independently, in document order, with `--kui-i` numbered the
  same way a `data-kui-stagger` group's children are (see the next section), so pairing it with
  `data-kui-stagger="90ms"` on the same host staggers the set.

**`target:` is resolved once, when the element is first processed — not kept live.** An element
matching the selector that is inserted afterwards is not picked up automatically, even with
`observe: true` watching the page for new `data-kui` attributes — that only catches a *new* host,
not a late arrival for an existing one's `target:`. If your page inserts matching content later,
re-run the two steps that install effects by hand on your animator instance (the `kui` from
[Controlling a running animation](#controlling-a-running-animation) below):

```js
kui.reset(headerEl)
kui.process(headerEl)
```

---

## Staggering a group

Declare the group on the **parent** and every direct child that carries `data-kui` animates one step
after the one before it. There are two spellings and they mean exactly the same thing.

Inside `data-kui`, as `cascade:` — use this when the parent is already animating, so everything you
write stays in one attribute:

```html
<div class="grid" data-kui="fade-up cascade:90ms">
  <article data-kui="fade-up"></article>
  <article data-kui="fade-up"></article>
  <article data-kui="fade-up"></article>
</div>
```

Or on the longhand `data-kui-stagger`, for the very common case where the parent is a bare wrapper
with no animation of its own:

```html
<div class="grid" data-kui-stagger="90ms">
```

### Budgeting the whole group — `spread:`

`cascade:` is a gap *per child*, so the group's total length grows with the child count: a
200-item list at `cascade:50ms` takes ten seconds to finish entering, and nobody ever intended
that. `spread:` states the total instead and lets the gap fall out of it:

```html
<div class="grid" data-kui="fade-up spread:600ms">
<div class="grid" data-kui-stagger="spread:600ms">
```

Three children or three hundred, the last one starts at 600ms. Adding children tightens the gaps
rather than lengthening the sequence.

- **They are alternatives, not a pair.** `spread:` is the budget; the step is what the budget
  divides out. An element that writes both gets the budget and a warning naming the step it
  ignored.
- **It composes with `order:`.** `order:center` puts the two middle children on the same beat, so
  a six-child group has three beats rather than six — `spread:600ms` still finishes at 600ms, with
  wider gaps.
- **A group with one animated child gets no gaps at all**, which is a step of `0ms` rather than a
  division by zero.
- The value is passed through to CSS, so `spread:var(--reveal-window)` works exactly as
  `cascade:var(--step)` does.

### Choosing where the stagger starts — `order:`

By default the group runs first child to last. Add `order:` to change where the wave begins:

```html
<div class="grid" data-kui="fade-up cascade:90ms order:center">
<div class="grid" data-kui-stagger="90ms order:center">
<div class="grid" data-kui-stagger="90ms from:center">
```

All three are the same request. `from:` is the original spelling on `data-kui-stagger` and keeps
working forever; `order:` works in both attributes, and is the only spelling `data-kui` accepts —
`from` is already a parameter name on eighteen effects (`count-up from:0`, `scale-in from:1`), so it
could not be given a second, element-wide meaning there without becoming ambiguous.

| `order:` | Order | Use it for |
|---|---|---|
| `start` | first child to last (the default) | a list reading top to bottom |
| `end` | last child to first | a list that should resolve *toward* the heading above it |
| `center` | outward from the middle | a grid blooming from its centre |
| `edges` | inward from both ends | a row closing on its middle |
| `random` | scattered | a wall of tiles with no reading order |
| a number | outward from that child index | drawing the eye to one card in the grid |

Both parts are optional and order-independent: `data-kui-stagger="from:edges"` orders the group and
leaves the step to CSS, and `data-kui-stagger="90ms"` is the plain stagger every example above uses.
The two attributes are merged **per key**, so a parent may carry the step on one and the ordering on
the other; where they disagree about the same key, `data-kui` wins and the displaced value is named
in a warning.

### Staggering across a grid — `cols:`

Everything above ranks children by **DOM index**, which is the right answer for a list and the
wrong one for a grid: on four rows of six, `order:center` fans out from child 11 — somewhere in the
middle of row two — rather than from the middle cell. Tell the group how wide it is and the same
orderings become real 2D proximity:

```html
<div class="grid" data-kui="fade-up cascade:60ms cols:6 order:center">
<div class="grid" data-kui-stagger="60ms order:center cols:auto">
```

`cols:auto` measures the laid-out children instead, which is the case a fixed number cannot serve —
a grid that is four columns wide on a desktop and two on a phone.

Once a group has a grid:

- **`center` and `edges` become concentric**: `center` blooms outward from the middle cell,
  `edges` closes inward from the border of the block. `end` is the bottom-right corner.
- **`order:` also takes a point**, as `x/y` fractions of the grid: `order:1/0` is the top-right
  corner, `order:0.5/0.5` the middle, `order:0/1` the bottom-left. A slash rather than a comma so
  it needs no quoting in either attribute. Fractions rather than cell coordinates so the same
  attribute keeps meaning the same thing when the grid reflows to a different width.
- **`along:x` or `along:y` restricts the wave to one axis** — `x` staggers strictly by column
  whatever row a child is in, so the grid wipes left to right in hard columns; `y` does the same by
  row. `data-kui-stagger` also accepts GSAP's word for it, `axis:`. Inside `data-kui` it has to be
  `along:`, because `axis` is already an effect parameter (`parallax-y axis:x`).
- **The step becomes a gap per unit of cell distance, not per item.** A child two columns and one
  row away starts `√5 × step` after the origin. `spread:` composes with this correctly — the budget
  is divided by the largest distance, so the group still finishes on time.
- **`cols:auto` is measured when the group is scanned, and a later resize does not re-measure it.**
  It re-measures on any `scan()`, which covers DOM changes but not a bare window resize. If the
  exact wave at every width matters more than convenience, write the number.
- **A group with no layout yet cannot be measured** — `display: none`, or a detached subtree — and
  says so rather than guessing; the ordering falls back to DOM index.
- `random` ignores the grid, because a scatter is a scatter in any shape.

Five things worth knowing:

- **`random` is the same scatter every time.** It is a deterministic function of the group's size,
  not `Math.random()`, so a re-render, a re-activation, or a page reload will not reshuffle a list
  under the reader — and an order you saw in a bug is an order you can reproduce. The trade-off is
  that two same-sized grids on one page scatter identically.
- **A number is a child index, counting from 0**, and it is *clamped* to the group with a warning if
  it falls outside — `from:0` is `from:start` and `from:<last>` is `from:end`, so the clamp lands on
  a real ordering rather than on a long delay before anything moves.
- **`cascade:` is not the same key as `stagger:`.** `split-lines stagger:320ms` is an *effect
  parameter* — the gap between the pieces `split-text` generates for itself — and several effects
  read it directly to know when they have finished. `cascade:` is the gap between the children
  *you* wrote. They land on the same CSS custom property, so writing both on one element is a
  conflict worth avoiding.
- **`from:` inside `data-kui` is never a group ordering.** `count-up from:0` and `scale-in from:1`
  are effect parameters; the group ordering there is always `order:`.
- **The order is DOM order, not visual order.** In RTL that is what you want — `start` is the child
  where its row begins. Under `flex-direction: row-reverse` you have separated the two yourself, and
  `from:end` is the fix.

---

## Breakpoints — `above:` and `below:`

"Fade up on desktop, nothing on mobile" is one token:

```html
<h1 data-kui="fade-up above:md">
```

Below `md` that element simply does not animate — it renders where it belongs, fully visible, as if
it carried no `data-kui` at all. From `md` up it fades in normally.

Each effect in the comma list carries its own condition, so one element can have two treatments:

```html
<h2 data-kui="fade-up below:md, fade-left above:md">
```

Those two would normally refuse to compose — both animate opacity and position — but because
neither can be live at a width the other is, they are not competing for anything.

| Spelling | When it runs |
|---|---|
| `above:md` | viewport is **at least** `md` wide |
| `below:md` | viewport is **narrower than** `md` |
| `above:md below:xl` | between the two — `md` up to, but not including, `xl` |

The two are exact complements, so `below:md` and `above:md` between them cover every possible width
with no overlap and no gap. The breakpoint itself belongs to `above`, the same way CSS's own
mobile-first `min-width` cascade works.

The scale is Tailwind's, in `rem` so it tracks the reader's font size:

| Name | Width |
|---|---|
| `sm` | `40rem` (640px) |
| `md` | `48rem` (768px) |
| `lg` | `64rem` (1024px) |
| `xl` | `80rem` (1280px) |
| `2xl` | `96rem` (1536px) |

Three things worth knowing:

- **It compiles to a media query, not to JavaScript.** A gated effect is a real `@media` rule in the
  shipped stylesheet, so resizing the window switches treatments instantly, with no script running
  and nothing to tear down — and the right thing happens even if the library's JS never loads. That
  is the whole reason there is no `kuinetic.matchMedia()` to call.
- **Only these five names.** A width you invent (`above:900px`) is refused with a console warning
  naming the five that work, because a stylesheet compiled ahead of time cannot hold a width that
  did not exist when it was compiled. Match your layout to the scale, or restyle the effect with
  your own media query.
- **A few effects are rendered in JavaScript** — pinning, counters, text splitting, dragging (the
  Catalog marks them). Those are gated too, and re-evaluated when the viewport crosses the
  breakpoint, but crossing one restarts the effect rather than morphing it.

---

## Knowing when an animation finished

Every animated element dispatches a `CustomEvent` at each of its own lifecycle points. They're plain
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
| `kui:reverse-finish` | the element finished playing *backwards* and is back at its from-state |
| `kui:cancel` | the effects were torn down or cancelled before completing |

`kui:finish` is the forward run only. An element playing out — the exit half of
`data-kui-on="pointerenter/pointerleave"`, or a `control().reverse()` — settles at
`data-kui-state="ready"` and reports `kui:reverse-finish` instead, so a listener that reveals the
next section on `kui:finish` doesn't fire it again on the way out.

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

### Calling a function when it finishes

`func:` names a global function to run when that element finishes. It is registered as an ordinary
`kui:finish` listener, so it fires at exactly the moment the event does and receives exactly what
the event gives a listener:

```html
<div data-kui="fade-up func:onReveal">…</div>
<script>
  function onReveal(event) {
    // `this` is the element; `event.detail` is the same payload a listener gets
    this.classList.add('is-revealed')
  }
</script>
```

**If your project has a build step, use `addEventListener('kui:finish', fn)` instead.** It works
with bundlers and ES modules, lets several listeners share one element, and needs no global at all.
`func:` exists as sugar for the no-build site — a page with a `<script>` block, an attribute, and no
module graph to hang a listener off — which is a real and large part of who this library is for.

Four things to know before you reach for it:

- **It only fires on `kui:finish`.** Not on start, not on cancel, and not on the `kui:reverse-finish`
  of an exit. Those have listeners; this key does not try to cover them.
- **The name has to be on `window`.** A top-level `function onReveal() {}` in a classic `<script>`
  puts it there, and so does `window.onReveal = …`. `const`, `let`, and anything inside a
  `<script type="module">` deliberately do not — that is a JavaScript rule, not a library one.
  A name that resolves to nothing warns (with `consoleReporter()`; the default reporter is silent)
  and the animation is otherwise unaffected.
- **It is looked up when the animation finishes, not when the page is scanned**, so a `<script>`
  that runs after kUInetic started still works.
- **Never build a `func:` value out of untrusted input.** The attribute names a function and the
  library calls it, so whoever controls the attribute controls which global function runs. On a
  hand-written page that is you. On a page where `data-kui` is assembled from a CMS field, a URL
  parameter, or anything an end user can influence, it is them — and any function the page put on
  `window` becomes reachable by name. There is no `eval` here and the value can never *be* code, but
  it can *name* code. For templated markup, keep the callback in an `addEventListener` and leave
  `func:` out.

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
hero.reverse()       // plays out to the from-state; calling it twice is still one exit

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

`reverse()` is the one method here that isn't a playhead call — it tells the animator which way the
element is travelling, so the element settles at `data-kui-state="ready"` and reports
`kui:reverse-finish`, and a later `pointerleave` won't play it out a second time. To travel forwards
again, activate the element (`play()`, `kui.activate()`, or its own entrance event): the animator
turns a reversing playhead around rather than restarting it. `handle.play()` is the counterpart to
`pause()` and does not change direction.

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
- **Forgetting a cascade needs a group, not a target.** Put it on the *parent*
  (`cascade:60ms` or `data-kui-stagger="60ms"` on a list), not on each child — it is a group
  behavior.
- **Reaching for `from:` inside `data-kui` to order a group.** It means something else there —
  `count-up from:0`, `scale-in from:1` — and fourteen effects use it as their own parameter. Group
  ordering is `order:` (or `from:`) on the parent, beside the step.

---

## Where next

- **[Catalog](?doc=catalog)** — all 267 named effects, grouped by category, with renderer and
  channel metadata for each.
- **[Architecture](?doc=design)** — the attribute grammar, the composition model, and why the
  library is built the way it is.
