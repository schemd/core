# Contributing to `@schemd/core`

Thank you for considering it. `schemd` is a deterministic text-to-SVG compiler with zero runtime
dependencies, and nearly every rule below follows from those two words. Please read the invariants
even if you skip the rest — they are what a pull request is measured against.

## The invariants

1. **No runtime dependencies.** `package.json` has no `dependencies` key and will not grow one. If a
   change seems to need a library, open an issue before writing code — that is the interesting part
   of the conversation.
2. **No DOM, Canvas, browser layout, external font, raster asset, or `getBBox()`.** Every dimension
   is arithmetic; see `mathLabelTextWidth` for how text is measured without a font engine. Reaching
   for a measurement API is how the compiler stops running identically in Node, a worker, a
   serverless function, and a build step.
3. **Determinism.** The same input gives byte-identical output on every run and platform. So: no
   `Date.now()` or `Math.random()`; no locale-dependent comparison or formatting (`toLocaleString('en-US')`
   is fine because the locale is pinned, a bare one is not); coordinates reach the output through the
   three-decimal writer, never as raw interpolated numbers; and where a tie must be broken, break it
   on something in the document — usually source order — and pin the choice with a test.
4. **The size budgets hold.** Run `bun run size`. Read the numbers from `scripts/check-bundle-size.mjs`
   rather than from prose, including this file, which is why none are quoted here.
5. **Coverage stays at 100%** on statements, branches, functions, and lines. Enforced by
   `vitest.config.ts`, not by convention.
6. **Validate before emitting.** Invalid input fails with a line-accurate diagnostic and produces no
   SVG. There is no partial output and no best-effort rendering.

## Setup

Node 24 or newer, and Bun (pinned to `bun@1.3.14`).

```sh
bun install
bun run test:visual:install   # Chromium for the pixel goldens; once per machine
bun run release:check         # confirm a clean baseline before changing anything
```

If `release:check` fails on a fresh clone, that is a bug worth an issue.

## The loop

```sh
bun run check          # tsc --noEmit
bun run test           # all suites
bun run test -- parser # one suite while iterating
bun run size           # after anything that could move bytes
```

## The gates

Each one exists because something got through, and knowing which failure it remembers tells you
whether your change should be updating it.

| Command | Protects | In CI |
| --- | --- | --- |
| `bun run check` | Types across the repo, tests included | yes |
| `bun run test` | Behaviour; 20 suites under `tests/` | via coverage |
| `bun run test:coverage` | 100% on all four axes | yes |
| `bun run test:fuzz` | Bounded fuzzing — no hang, no unhandled throw | via `test` |
| `bun run test:mutation` | 24 named mutants, all of which must die | yes |
| `bun run test:visual` | Chromium pixel goldens | yes |
| `bun run size` | Both gzip budgets | yes |
| `node scripts/benchmark.mjs` | Latency ceilings and per-component scaling | no — local only |

The benchmark stays out of CI because shared runners are too noisy for latency numbers to mean
anything. Run it locally, and quote your own hardware if you report a figure.

### Coverage is a floor, not a goal

100% means every line ran, not that it is verified — a test that executes a branch without asserting
anything satisfies the gate and protects nothing. Write the assertion that would fail if the
behaviour inverted. If you are adding a test purely to reach a line, ask whether the line should
exist. Closing that gap is what the mutation gate is for.

### The mutation gate

`scripts/mutation.mjs` holds 24 named mutants: a precise source substitution plus the tests that must
fail when it is applied. Each is stated as a *property* rather than an edit:

```js
{
  name: 'a contact the validator rejects must cost the router infinity',
  file: 'src/layout.ts',
  from: "…if (!contact.strict || contact.overlap || !previous.orthogonal) {…",
  to:   '…if (false) {…',
  tests: ['tests/layout.test.ts', 'tests/regressions.test.ts']
}
```

If your change adds a load-bearing invariant, add a mutant for it. The bar: could this line be
weakened while every test stays green? `from` must match the source exactly, tabs included, so
mutants break when you reformat around them — deliberate friction that makes you re-read whether the
property still holds.

### Visual goldens

Six Chromium screenshots, the only place we check that emitted SVG *renders* correctly rather than
merely containing the right strings. Their known weakness: every marker fixture happened to give each
wire its own colour, putting each in a batch of its own and hiding a real defect — one arrowhead
shared across several wires — for releases. When you add a golden, ask what the existing ones
accidentally share.

### Rip-up can hide a router defect

Since 0.5 the router retries around a trace it cannot place. That is a new way for a test to quietly
stop protecting anything: a fixture asserting only that a diagram *compiles* keeps passing while
terminal-approach reservation or contact pricing regresses, because the retry absorbs the failure.

Not hypothetical — adding rip-up made the 0.4.0 mutant `terminal approaches are reserved before any
wire is placed` survive, and we strengthened the test rather than retiring the mutant. **If a fixture
is an ordinary figure, assert `routing.attempts === 0` too.**

## Public or internal — decide once

`tests/packaging.test.ts` requires every module under `src/` to be either exported through the
`exports` map or listed in `INTERNAL_MODULES`. There is no third state.

It exists because `@schemd/core/netlist` (0.3.4) and `@schemd/core/describe` (0.3.6) were announced
in a changelog and shipped in the tarball with no `exports` entry, so importing them failed while the
files sat unused in `dist`. The claim stood for three releases, uncaught because every test imports
from `../src`, where subpaths do not exist.

A public module needs, in one pull request: the module, an `exports` entry with `types` and `import`,
re-exports from `src/index.ts` if it belongs on the main entry, a suite covering it to 100%, and docs
plus a changelog entry naming the subpath. Anything else goes in `INTERNAL_MODULES` — if unsure, it
is internal, because promoting later is easy and un-promoting is breaking.

## Writing diagnostics

This is the project's most distinctive habit and the least obvious from the code. **A diagnostic says
how to fix the diagram, not only what is wrong with it.** Compare what 0.3.8 replaced:

```
before:  R2 overlaps R1.
after:   R2 overlaps R1 by 44 units horizontally; move R2 to x >= 284, or use a UML container
```

What makes the second sentence work:

- **Name the offenders**, by the id the author typed.
- **Quantify**, so the author knows whether this is a typo or a redesign.
- **Give a value that works** — `x >= 284`, not "move it further away".
- **Speak in the author's coordinates.** The overlap is computed on derived body rectangles; the
  advice is in the `at (x, y)` origin they actually type.
- **Follow the axis the author already used.** Two parts side by side move apart sideways, even when
  stacking them is a few units cheaper.
- **Offer the alternative** when there is one.
- **Carry the line.** `SchematicSyntaxError` takes a one-based line; pass it.

Where several call sites need the same sentence, it lives in one place — see how canvas and title
validation moved into `limits.ts` in 0.4.0. And a rule that has caught real bugs twice: **a misspelled
option must fail loudly.** A budget a host believes it set and did not is worse than no budget.

## The changelog

`CHANGELOG.md` is written for someone deciding whether to upgrade.

- Sections: `Fixed`, `Added`, `Removed`, `Changed`, `Verified`, `Performance`, `Documented`.
- **State the defect, not the patch** — what a user could observe, why it happened, and what now
  makes it impossible.
- Dates are actual npm publication dates; unpublished versions use `Unreleased`.
- Breaking changes say `Breaking` and say who is affected, by name.
- If your change moves a budget, say so and say what paid for it.

The release workflow feeds `scripts/changelog-section.mjs` straight into the GitHub release body, so
write it as the release notes, because it is.

## Roadmap items

`ROADMAP.md` is a queue of known limits, not a list of promises. **P1** affects correctness or
professional output; **P2** improves authoring, memory, or payload efficiency.

Open the claim link before starting anything large — that is how we agree on the algorithm and the
API impact before you have written code assuming one. The pull request that completes an item
**removes it** from `ROADMAP.md` and from the website timeline. Work that is not on the roadmap is
welcome; a bug fix needs no claim.

## Pull requests

- **One concern each.** A fix, its regression test, its mutant, and its changelog entry belong
  together; a second unrelated fix does not.
- **Say what you deliberately did not change.** It is usually the most informative part.
- **Run `bun run release:check` first.** It is what CI runs, minus the benchmark.
- **Behaviour changes need a changelog entry.** Internal refactors do not, though a `Changed` note
  explaining a deduplication is welcome.
- **If a test asserted the old, wrong behaviour, invert it and say so.** Two 0.4.0 fixes were pinned
  by the suite. Finding that is a good sign.

Commit messages are prose, lower-case, present tense, describing the effect. Match `git log`.

## Releasing

Maintainers only. Pushing a `v*` tag verifies the tag matches `package.json`, builds, re-checks the
size budgets, runs `npm pack --dry-run`, publishes to npm via trusted publishing, and cuts the GitHub
release from that version's changelog section. A tag containing `-` publishes as a prerelease.

Before tagging, run the full `release:check` locally including the benchmark, and update the version,
the changelog date, and the documentation version references together.

## What will not be merged

Stated plainly to save your time:

- A runtime dependency, or anything needing a DOM, Canvas, or font-metrics API.
- Automatic layout that computes positions the author did not ask for. A *constraint* system that
  lowers deterministically to absolute coordinates is a different and welcome proposal — that is what
  relative placement is.
- Electrical, timing, or functional simulation. `verifyNetlist` is structural linting over a flat
  connectivity model, and real analysis is a different product.
- Nondeterministic output, including anything varying with time, locale, or hash iteration order.
- A feature without tests, or with tests that reach coverage without asserting behaviour.
- Silent fallbacks. A misspelled option, an unroutable trace, and an out-of-bounds coordinate are all
  errors with a line number.

Not sure which side of one of these a proposal falls on? Open an issue and ask — that conversation is
cheaper for both of us than a closed pull request.

## Reporting a bug

The most useful report is a minimal source document plus its fence, because together they run:

````text
```schemd bounds="760x460" title="…"
resistor:R1 "1 k\Omega" at (280, 150) #amber
…
```
````

Include the compiler version, what you expected, and what happened. If it involves routing, say
whether reordering the declarations changes the outcome — with a greedy router that is frequently the
diagnosis. An [inspector](https://schemd.johnowolabiidogun.dev/inspector/0.5.0) link is even better,
since it carries the document in the URL.

[Issues](https://github.com/schemd/core/issues) · [Roadmap](./ROADMAP.md) ·
[Changelog](./CHANGELOG.md) · [MIT](./LICENSE)
