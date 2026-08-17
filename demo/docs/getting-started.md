# Getting Started

This page is the fast path: install it, write one attribute, see it move. For the full list of
~237 named effects see the [Catalog](?doc=catalog); for why the library is built the way it is —
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
| `data-kui-threshold` | how much of the element must be visible before `on:enter` fires | `data-kui-threshold="30%"` |
| `data-kui-stagger` | delay increment applied to matched children in a group | `data-kui-stagger="60ms"` |

Longhand attributes (`data-kui-duration`, `data-kui-delay`, …) exist as an alias for templating
contexts where building one inline attribute string is awkward — both forms compile to the same
internal spec.

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

If two effects in the same list *do* write the same CSS property, the library warns in the
console rather than silently dropping one — see
[Architecture §4](?doc=design#4-composition-the-channel-model) for the full resolution order.

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

- **[Catalog](?doc=catalog)** — all ~237 named effects, grouped by category, with renderer and
  channel metadata for each.
- **[Architecture](?doc=design)** — the attribute grammar, the composition model, and why the
  library is built the way it is.
