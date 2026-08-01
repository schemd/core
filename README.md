<p align="center">
  <img src="https://github.com/schemd/web/blob/main/src/lib/assets/brand/schemd-logo.svg" alt="Schemd — engineering vectors" width="640" />
</p>

# @schemd/core

`schemd` — pronounced like “skemd” (`/skɛmd/`) — is a strict, deterministic text-to-SVG compiler for electrical, digital, quantum, and UML diagrams. It has no runtime dependencies and never touches a DOM, Canvas, browser layout, external font, raster asset, or `getBBox()`.

**The [documentation site](https://schemd.johnowolabiidogun.dev/docs/0.7/overview) is the reference.** Every page there is versioned per release line and every example is compiled by the real engine. This file is the short tour.

Version 0.7.0 needs Node.js 24 or newer.

[Docs](https://schemd.johnowolabiidogun.dev/docs/0.7/overview) · [Playground](https://schemd.johnowolabiidogun.dev/playground) · [Inspector](https://schemd.johnowolabiidogun.dev/inspector/0.7.0) · [Changelog](./CHANGELOG.md) · [Roadmap](./ROADMAP.md)

## Install

```sh
npm i @schemd/core # or bun add / pnpm add / yarn add
```

## Compile

```ts
import { compileSchematic, parseSchematicFence } from "@schemd/core";

const fence = parseSchematicFence('schemd bounds="760x460" title="RC low-pass filter"')!;

const { svg, metrics } = compileSchematic(
  `source:VIN "AC" at (90, 150) #blue [type=voltage-ac]
resistor:R1 "1 k\\Omega" right-of VIN by 190 #amber
junction:VOUT "V_{out}" right-of R1 by 190 #cyan
capacitor:C1 "100 nF" below VOUT by 140 #cyan [orientation=down]

VIN.positive -> R1.in #blue [line]
R1.out -> VOUT.node #amber [line]
VOUT.node -> C1.in #cyan [ortho]`,
  { ...fence, mode: "full" },
);
```

Two kinds of line, and a part may state its position either way:

```text
kind:ID "label" at (x, y) #color [options]
kind:ID "label" right-of REF by 190 #color [options]
SOURCE.port -> TARGET.port #color [line|bezier|ortho options]
```

Bad variants, duplicate options, unknown ports, mismatched bus widths, unsafe colours, and out-of-bounds geometry all fail with a line-accurate diagnostic before any SVG is written.

## What it compiles

Electrical, digital, quantum, and UML families — the full vocabulary is in the [component reference](https://schemd.johnowolabiidogun.dev/docs/0.7/component-reference).

A compiled diagram is also a model. `buildNetlist` gives you nodes, nets, and edges; `verifyNetlist` runs seven design rules over them; `describeSchematic` turns the same connectivity into prose for a screen reader. The compilation also hands back its own working: `sourceMap` (every vector's declaration line), `placements` (what each relation resolved to), and `routing` (retries, torn-up traces, per-cell congestion).

And the output is readable back. `snapshotSchematic` writes a text digest of the geometry, so a routing change reviews as a handful of moved coordinates rather than an image diff; `parseSchematicSvg` reads a `full`-mode SVG back into declarations, naming what the markup does not carry rather than guessing at it.

## Before you rely on it

Please read the [limitations](https://schemd.johnowolabiidogun.dev/docs/0.7/overview#limitations) before treating a clean compile as an engineering result. The short version:

- **`verifyNetlist` is structural linting, not verification.** It cannot tell you anything about analog correctness, timing, impedance, drive strength, metastability, or quantum validity. A clean result means no rule fired.
- **Routing is greedy and bounded.** Traces are placed one at a time and retried around contention, which takes a full reversal bus to twelve wires. Past that the bundle is laid out as a set instead, which reaches thirty-two. A document that needs the bundle path reports `routing.nudged`. **Correction:** 0.5 documented thirteen wires as a limit of the channel model rather than of declaration order. That was wrong — reordering genuinely cannot reach it, but the model was never full.
- **The model is flat.** No hierarchy, no sub-sheets, no simulation, no timing analysis, no certification. It suits documentation, teaching, and schematics rather than large engineering designs.
- **Compiling source you did not write?** Pass [`limits`](https://schemd.johnowolabiidogun.dev/docs/0.7/limits) and a timeout of your own.
- **Published performance figures are narrow.** Warm medians on one machine. Run `bun run benchmark` on yours.

## Compatibility

0.2.x through 0.6.x documents still compile. 0.7 adds one field — `routing.nudged` — and one rescue path that only runs after the retry budget is exhausted, so every document that compiled before it reaches the same routes through the same code; all 261 corpus drawings are byte-identical. As with 0.5's retry path, the thing you may notice is that a document which used to be rejected as unroutable can now compile, having been laid out as a bundle. 0.6 before it only added two modules behind their own subpaths, and 0.5 added relative placement as new syntax plus `placements` and `routing` as fields that stay empty for documents that do not use them. Every existing entry point keeps its signature throughout.

Upgrading across 0.4 as well? See [migration](https://schemd.johnowolabiidogun.dev/docs/0.7/overview#migrate) — port aliases now report their canonical terminal, and the component and connection ceilings are gone.

## Contributing

`bun install`, then `bun run test:visual:install` once, then `bun run release:check`. [CONTRIBUTING.md](./CONTRIBUTING.md) covers the invariants and what each gate protects.

[Issues](https://github.com/schemd/core/issues) · [MIT](./LICENSE)
