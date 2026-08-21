# Why 100% coverage did not catch a real bug

Written 2026-08-21, after the coverage/quality audit. The owner asked for this to be logged so the
next session can act on it rather than re-derive it.

## The bug

`src/core/path-morph.ts` destroys every shape with more than one subpath.

Source — a square with a square hole, two closed subpaths:

```
M10,10 L90,10 L90,90 L10,90 Z  M30,30 L70,30 L70,70 L30,70 Z
```

Morph output — one `M`, zero `Z`:

```
M15,15 C38.33,15 … C15,38.33 15,15  C46.67,40 … C40,53.33 40,40
```

Two subpaths went in. One open outline came out. In practice: `blob-morph` and `icon-morph` break on
any icon with a hole or a counter — the inside of an `o`, `a`, `e`, `p`, or any two-piece glyph.
That is most icons worth morphing.

`test/browser/svg-morph-subpath.test.mjs` has been failing this the whole time. It is not in
`npm test`, so the gate never went red. Full write-up: `docs/live-testing-backlog.md` D7.

## `path-morph.ts` is at 100% coverage

Statements 100. Branches 100. Functions 100. Lines 100. It is not an exception in the file — the
whole library is at 100/100/100/100 and the threshold in `vitest.config.ts` enforces it.

## Why that is not a contradiction

**Coverage measures which lines ran. It cannot measure what was asserted about them.**

That is the entire explanation, and it is worth stating in its most uncomfortable form: a test suite
that calls every function and asserts nothing scores 100%. Coverage is a *lower bound on effort* —
it proves you did not forget a whole region of code. It is not evidence of correctness, and it never
was.

Three specific failure modes, all present here:

### 1. The uncovered case is not a line, it is an input

Every line of the subpath parser and the resampler runs when you morph a one-subpath shape. Morphing
a two-subpath shape runs **exactly the same lines** — it just produces a wrong answer at the end.
There is no branch to cover, because the code does not branch on subpath count. It flattens
unconditionally. Coverage has nothing to point at, because the defect is a missing concept, not a
missing path.

This is the general shape of it: **coverage finds code you forgot to test, not behaviour you forgot
to implement.** A missing `if` is invisible to a line counter.

### 2. The assertions were about mechanics, not about outcomes

`path-morph`'s unit tests check that the parser reads `M L H V C Z`, that `Z` closes a subpath, that
sampling produces the right number of points. All true, all passing, all necessary. None of them
asserts *what the output path string should be for a shape with a hole*. The tests describe how the
machine works. They do not describe what the user should get.

The one test that does assert the outcome is the browser test, and it fails.

### 3. The gate does not run the layer that could tell

`npm test` — 877 unit tests, jsdom, 100% coverage, green.
`npm run test:browser` — 59 checks, real Chromium, **57 passing, 2 failing since before this session.**

Only the first one runs by default. The suite that exercises real geometry, real layout, real
`getComputedStyle`, and real SVG path serialisation is opt-in, so a red result there is invisible
until somebody types the command. Nobody had.

## What coverage *did* do in this audit

It should not be written off. Running it with the 100% threshold on found five genuine gaps in an
hour:

- `smooth-scroll-to` — a shipped, documented catalog effect with **zero tests**
- the scrubbed-instance early return in `instances.ts`
- `card-toggle`'s `prepare` — a test asserted its *metadata* claimed inertness, and never called it
- two gaps in code written the same day (`domPosition`'s no-window fallback, `step-progress`'s
  `target:` branch)

All five are now tested. None of them was unreachable code. Coverage is a good smoke alarm; it is
not a fire inspection.

## Would mutation testing have caught it?

**Partly, and it is worth doing — but not for this bug.**

Mutation testing (Stryker is the practical option for TS) works by breaking the source on purpose —
flipping `<` to `<=`, deleting statements, swapping `+` for `-` — and checking whether any test
fails. A mutant nothing kills is a line your suite executes but does not constrain. That is exactly
the "100% coverage, zero assertions" blind spot, and it would have found real weaknesses here:
`card-toggle`'s uncalled `prepare`, the metadata-only assertions, probably several catalog tests
that assert a preset exists without asserting what it does.

But it would **not** have found the subpath bug, for the same reason coverage did not: mutation
testing mutates code that exists. There is no `if (subpaths.length > 1)` to mutate. You cannot mutate
an absent concept into a test failure.

The honest hierarchy:

| Technique | Catches | Misses |
|---|---|---|
| Coverage | Code no test reaches | Code reached but unasserted; behaviour never implemented |
| Mutation testing | Code reached but unasserted | Behaviour never implemented |
| Property-based testing | Whole classes of input the author did not think of | Properties nobody thought to state |
| Real-browser output assertions | Wrong output, whatever the cause | Anything not rendered |

The subpath bug is caught by exactly one row of that table, and it is the row already sitting in the
repo, already failing, and not wired into the gate.

### On the owner's worry about cost

The concern was that mutation testing "would take forever if you have to see every animation effect
and screen." That worry does not apply, and the reason matters: **Stryker never renders anything.**
It runs the vitest suite, which is jsdom and has no visual component at all. The cost is
`mutants × suite runtime`, and the suite is ~45s. That is real — a full run over `src/` would be
hours — but it is a CI-overnight problem, not a watch-every-animation problem. It is also
parallelisable and can be scoped to one directory at a time.

The sequencing that follows from the table above:

1. **Put `npm run test:browser` in the gate.** Highest value, near-zero cost, and there is a known
   real bug sitting behind it right now.
2. **Fix D7.**
3. **Then** run mutation testing on `src/core/` only, overnight, and read the surviving mutants as a
   list of tests that assert nothing. Do not chase a mutation score; use it as a report.

## The one-line version

100% coverage means every line was executed. It says nothing about whether anything checked the
result, and nothing at all about code that was never written. The suite that could have caught this
existed, was already failing, and was not in the gate.
