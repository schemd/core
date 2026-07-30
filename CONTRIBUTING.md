# Contributing to `@schemd/core`

Thank you for considering it. This document is longer than most because the project has unusual
invariants, and a contributor who learns them from a failing CI run has already wasted an afternoon.
Read the first section even if you skip the rest.

`schemd` is a deterministic text-to-SVG compiler with zero runtime dependencies. Almost every rule
below follows from those two words.

---

## The invariants

These are not style preferences. A pull request that breaks one cannot be merged, however good the
feature is.

**1 · Zero runtime dependencies.** `package.json` has no `dependencies` key and will not grow one.
`devDependencies` are negotiable; runtime dependencies are not. If a change seems to need a library,
that is the interesting part of the discussion — open an issue before writing code.

**2 · No DOM, no Canvas, no browser layout, no external fonts, no raster assets, no `getBBox()`.**
Every dimension is computed arithmetically — see `mathLabelTextWidth` for how text is measured
without a font engine. The compiler runs identically in Node, in a worker, in a serverless function,
and at build time. Reaching for a measurement API is how that stops being true.

**3 · Determinism.** The same input produces byte-identical output on every run, every platform, and
every Node version we support. Concretely, in `src/`:

- No `Date.now()`, `Math.random()`, or anything else that varies between runs.
- No iteration over an unordered container where the order reaches the output. `Map` and `Set`
  preserve insertion order in JavaScript and are fine; object key order is not something to lean on.
- No locale-dependent comparison or formatting. `toLocaleString('en-US')` inside a diagnostic message
  is fine because the locale is pinned; a bare `toLocaleString()` or `localeCompare()` is not.
- Coordinates reach the output through the three-decimal writer. Interpolating a raw JavaScript
  number is a bug — it shipped once, in integrated-circuit pin stubs, and produced seventeen
  significant digits alongside neighbours rounded to three.
- Where a tie must be broken, break it on something in the document — source order, usually — and
  pin the choice with a test. "It happens to come out this way" is not a tie-break.

**4 · The size budgets hold.** Two budgets, both enforced by `scripts/check-bundle-size.mjs`: the
compiler tree-shaken to `compileSchematic`, and the whole public entry as registry tools measure it.
Run `bun run size`. Read the numbers from that script rather than from any prose — including this
file, which is why none are quoted here.

**5 · Coverage stays at 100%.** Statements, branches, functions, lines. Enforced by thresholds in
`vitest.config.ts`, not by convention.

**6 · The compiler validates before it emits.** Invalid input fails with a line-accurate diagnostic
and produces no SVG. Partial output, best-effort rendering, and "draw it anyway" are not behaviours
this compiler has.

---

## Setup

Node 24 or newer and Bun. The repository pins `bun@1.3.14` through `packageManager`.

```sh
git clone https://github.com/schemd/core.git
cd core
bun install
bun run test:visual:install   # provisions Chromium for the pixel goldens; once per machine
```

Then confirm a clean baseline before you change anything:

```sh
bun run release:check
```

That is the full gate and takes a few minutes. If it fails on a fresh clone, that is a bug in the
repository and worth an issue on its own.

---

## The loop

```sh
bun run check          # tsc --noEmit, no build
bun run test           # vitest, all suites
bun run test -- parser # one suite while iterating
bun run size           # after anything that could move bytes
```

`bun run build` runs `tsc` twice — once for JavaScript through `tsconfig.build.json`, once for
declarations through `tsconfig.types.json`. You rarely need it directly; `size`, `benchmark`, and
`prepack` call it themselves.

---

## The gates, and what each one is for

Every gate exists because something got through. Knowing which failure a gate remembers makes it
much easier to tell whether your change should be updating it.

| Command | Protects | In CI |
| --- | --- | --- |
| `bun run check` | Types across the whole repo, tests included | yes |
| `bun run test` | Behaviour; 20 suites under `tests/` | via coverage |
| `bun run test:coverage` | 100% on all four axes | yes |
| `bun run test:fuzz` | Bounded deterministic fuzzing — no hang, no unhandled throw | via `test` |
| `bun run test:mutation` | 24 named mutants, all of which must be killed | yes |
| `bun run test:visual` | Chromium pixel goldens under `tests/visual/goldens` | yes |
| `bun run size` | Both gzip budgets | yes |
| `node scripts/benchmark.mjs` | Latency ceilings and per-component scaling | no — local and release only |

The benchmark stays out of CI deliberately: shared runners are too noisy for latency numbers to mean
anything. Run it locally on the change you are making, and quote your own hardware if you report a
figure.

### Coverage at 100% is a floor, not a goal

The threshold means every line ran. It does not mean every line is verified — a test that executes a
branch without asserting anything about it satisfies the coverage gate and protects nothing. That gap
is what the mutation gate exists to close.

So write the assertion that would fail if the behaviour inverted, not the test that makes the number
green. If you find yourself adding a test purely to reach a line, ask whether the line should exist.

### The mutation gate

`scripts/mutation.mjs` holds a list of named mutants (24 of them). Each is a precise source substitution paired
with the test files that must fail when it is applied. Every one must be killed.

A mutant is stated as a *property*, not as an edit:

```js
{
  name: 'a contact the validator rejects must cost the router infinity',
  file: 'src/layout.ts',
  from: "…if (!contact.strict || contact.overlap || !previous.orthogonal) {…",
  to:   '…if (false) {…',
  tests: ['tests/layout.test.ts', 'tests/regressions.test.ts']
}
```

**If your change adds a load-bearing invariant, add a mutant for it.** The bar is: could this line be
weakened in a way that keeps every test green? If yes, that weakening is the mutant. The 0.4.0 work
added seven this way, one per fix, and each names the property rather than the diff.

Note that the `from` string must match the source exactly, including tabs. Mutants break when you
reformat the code around them — that is intended friction, because it forces you to re-read whether
the property still holds.

### Visual goldens

Six Chromium screenshots. They are the only place we verify that emitted SVG *renders* the way it is
supposed to, as opposed to containing the right strings.

Their known weakness is worth internalising: every marker fixture happened to give each wire a
distinct colour, which put every wire in a batch of its own and hid a real defect — a compound path
carrying one arrowhead for several wires — for several releases. **When you add a golden, ask what
the existing ones accidentally share, and cover that instead of adding another instance of the same
shape.**

Update a golden only when you intend the visual change, and say so in the changelog.

### Rip-up can hide a router defect — assert how hard it was

Since 0.5 the router retries around a trace it cannot place. That is the feature, and it is also a
new way for a test to stop protecting anything. A fixture asserting only that a diagram *compiles*
will keep passing while the reservation of terminal approaches, the channel-lane offer, or the
contact pricing regresses, because the retry loop quietly absorbs the failure.

This is not hypothetical: adding rip-up caused the 0.4.0 mutant `terminal approaches are reserved
before any wire is placed` to survive, and the fix was to strengthen the test rather than retire the
mutant. **If a fixture is an ordinary figure, assert `routing.attempts === 0` alongside whatever else
it checks.** Needing a retry is itself a fact worth pinning.

---

## Public or internal — decide once

`tests/packaging.test.ts` enforces that every module under `src/` is either exported through the
`exports` map or listed in its `INTERNAL_MODULES` set. There is no third state.

This exists because `@schemd/core/netlist` (0.3.4) and `@schemd/core/describe` (0.3.6) were both
announced in a changelog, both shipped in the tarball, and neither had an `exports` entry — so
importing them failed with `ERR_PACKAGE_PATH_NOT_EXPORTED` while the files sat unused in `dist`. The
claim stood for three releases. Nothing caught it because every test imports from `../src`, where
subpaths do not exist.

Adding a public module means, in one pull request:

1. The module in `src/`.
2. An `exports` entry with both `types` and `import`.
3. Re-exports from `src/index.ts` if the symbols belong on the main entry.
4. A `tests/` suite that covers it to 100%.
5. Documentation, and a changelog entry that names the subpath.

Adding an internal module means adding it to `INTERNAL_MODULES`. If you are unsure which it is, it is
internal — promoting later is easy, and un-promoting is a breaking change.

---

## Writing diagnostics

This is the project's most distinctive house style, and the least obvious from reading the code.

**A diagnostic says how to fix the diagram, not only what is wrong with it.** Compare what 0.3.8
replaced:

```
before:  R2 overlaps R1.
after:   R2 overlaps R1 by 44 units horizontally; move R2 to x >= 284, or use a UML container
```

The rules that produce the second sentence:

- **Name the offenders.** Both of them, by the id the author typed.
- **Quantify.** "By 44 units horizontally" tells the author whether this is a typo or a redesign.
- **Give a value that works.** `x >= 284`, not "move it further away".
- **Speak in the author's coordinate system.** The overlap is computed on derived body rectangles;
  the advice is expressed in the `at (x, y)` origin the author actually types. Reporting a derived
  rectangle makes the reader do the compiler's arithmetic.
- **Follow the axis the author already used.** Two parts side by side move apart sideways, even when
  stacking them happens to be a few units cheaper.
- **Offer the alternative when there is one.** "or use a UML container", "widening the fence is also
  an answer".
- **Carry the line.** `SchematicSyntaxError` takes a one-based line; pass it. A diagnostic without a
  line makes the author search.

Where several call sites need the same sentence, the sentence lives in one place. Canvas and title
validation were three near-identical copies before 0.4.0 pulled them into `limits.ts`; that is the
pattern to follow, and the reason `normalizeSchematicBounds` returns a snapshot instead of asserting.

And a rule that has already caught a real bug twice: **a misspelled option must fail loudly.** A
budget or attribute a host believes it set and did not is worse than no budget at all — see
`resolveSchematicLimits`, which rejects unknown fields precisely for this reason.

---

## The changelog

`CHANGELOG.md` is written for someone deciding whether to upgrade, which makes it different from a
commit log in three ways.

**Sections used:** `Fixed`, `Added`, `Removed`, `Changed`, `Verified`, `Performance`, `Documented`.
Not every release uses all of them.

**An entry states the defect, not the patch.** It describes what a user could observe, why it
happened, and what now makes it impossible:

> Port aliases address one terminal everywhere. `SchematicEndpoint.port` has always been documented
> as canonical, but the parser never normalized it, so topology resolution, contact validation, the
> netlist and the design rules each keyed on whichever spelling the author typed. `R1.out -> A.in`
> beside `R1.r -> B.in` was rejected as two nets colliding at a point they shared…

**Dates are actual npm publication dates.** An unpublished version uses `Unreleased`. Do not
pre-date a release.

**Breaking changes say `Breaking` and say who is affected** — "anyone importing the two constants or
reading `SCHEMATIC_LIMITS.components`", not "may affect some users".

**Growth is recorded rather than absorbed.** When 0.4.0 raised both size budgets, the changelog said
so and explained which additions paid for it. If your change moves a budget, that sentence is part of
the change.

Because the release workflow feeds `scripts/changelog-section.mjs` output straight into the GitHub
release body, the prose is written once. Write it as though it is the release notes, because it is.

---

## Roadmap items

`ROADMAP.md` is an active queue of known limits, not a list of promises. **P1** affects correctness or
professional output; **P2** improves authoring, memory, or payload efficiency.

Before starting anything large, open the claim link on the item. This is not ceremony — it is how we
agree on the algorithm and the API impact before you have written the code that assumes one.

The pull request that completes an item **removes it** from `ROADMAP.md` and from the website
timeline. Do not tick a box and leave the entry behind; Git history is the record.

Work that is not on the roadmap is welcome. A bug fix needs no claim.

---

## Pull requests

- **One concern per pull request.** A fix, its regression test, its mutant, and its changelog entry
  belong together. A second unrelated fix does not.
- **Say what you deliberately did not change.** The roadmap issue template asks for scope boundaries
  for the same reason: it is usually the most informative part.
- **Run `bun run release:check` before opening.** It is the same gate CI runs, minus the benchmark.
- **Behaviour changes need a changelog entry.** Internal refactors that no consumer can observe do
  not, though a `Changed` note explaining a deduplication is welcome.
- **When a test asserted the old, wrong behaviour, invert the assertion and say so.** Two 0.4.0 fixes
  were previously *pinned by the suite* — a compound path carrying one arrowhead, a transistor lead
  wired to itself. Finding that is a good sign, not an embarrassing one.

Commit messages are prose, lower-case, present tense, describing the effect. Look at `git log` and
match it.

---

## Releasing

Maintainers only. Pushing a `v*` tag runs the publish job, which:

1. Verifies the tag matches `package.json` `version` exactly, and fails if not.
2. Builds, re-checks the size budgets, and runs `npm pack --dry-run`.
3. Publishes to npm via trusted publishing — no long-lived token.
4. Extracts the changelog section for that tag and cuts the GitHub release from it.

A tag containing `-` is published as a prerelease. Before tagging, run the full `release:check`
locally, including the benchmark, and update the version, the changelog date, and the documentation
version references together.

---

## What will not be merged

Stated plainly to save your time, not to be discouraging:

- A runtime dependency.
- Anything requiring a DOM, Canvas, font metrics API, or measurement callback.
- Automatic layout that computes positions the author did not ask for. Coordinates are the author's;
  a *constraint* system that lowers deterministically to absolute coordinates is a different and
  welcome proposal.
- Electrical, timing, or functional simulation. `verifyNetlist` is structural linting over a flat
  connectivity model, and the README is careful about that boundary. Real analysis is a different
  product.
- Nondeterministic output, including anything that varies with time, locale, or hash iteration order.
- A feature without tests, or with tests that reach coverage without asserting behaviour.
- Silent fallbacks. A misspelled option, an unroutable trace, and an out-of-bounds coordinate are all
  errors with a line number.

If you are not sure which side of one of these a proposal falls on, open an issue and ask. That
conversation is cheaper for both of us than a closed pull request.

---

## Reporting a bug

The most useful report is a **minimal source document plus the fence**, since together they are
runnable:

````text
```schemd bounds="760x460" title="…"
resistor:R1 "1 k\Omega" at (280, 150) #amber
…
```
````

Include the compiler version, what you expected, and what happened. If it involves routing, say
whether reordering the declarations changes the outcome — with a greedy router that detail is
frequently the diagnosis.

---

[Issues](https://github.com/schemd/core/issues) · [Roadmap](./ROADMAP.md) ·
[Changelog](./CHANGELOG.md) · [MIT](./LICENSE)
