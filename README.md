<p align="center">
  <img src="https://github.com/schemd/web/blob/main/src/lib/assets/brand/schemd-logo.svg" alt="Schemd — engineering vectors" width="640" />
</p>

# @schemd/core

`schemd`—pronounced like “skemd” (`/skɛmd/`)—is a strict, deterministic text-to-SVG compiler for electrical, digital, quantum, and UML diagrams. It has zero runtime dependencies and does not use a DOM, Canvas, browser layout, external fonts, raster assets, or `getBBox()`.

Version 0.5.0 requires Node.js 24 or newer. Tree-shaken to `compileSchematic` the bundle stays below 34 KiB gzip; the whole public entry, which is what registry size tools report, stays below 37 KiB gzip.

**[Documentation](https://schemd.johnowolabiidogun.dev/docs/0.5/overview)** · [Playground](https://schemd.johnowolabiidogun.dev/playground) · [Changelog](./CHANGELOG.md) · [Roadmap](./ROADMAP.md)

## Install

```sh
npm i @schemd/core # or bun add @schemd/core or pnpm add @schemd/core or yarn add @schemd/core
```

## Compile

```ts
import { compileSchematic, parseSchematicFence } from "@schemd/core";

const fence = parseSchematicFence(
  'schemd bounds="760x460" title="RC low-pass filter"',
)!;

const result = compileSchematic(
  `source:VIN "AC" at (90, 150) #blue [type=voltage-ac]
resistor:R1 "1 k\\Omega" at (280, 150) #amber
junction:VOUT "V_{out}" at (470, 150) #cyan
capacitor:C1 "100 nF" at (470, 290) #cyan [orientation=down]
ground:GND "0 V" at (650, 380) #slate

VIN.positive -> R1.in #blue [line]
R1.out -> VOUT.node #amber [line]
VOUT.node -> C1.in #cyan [ortho]
C1.out -> GND.in #slate [ortho]`,
  { ...fence, mode: "full", semanticHooks: ["nodes", "ports", "wires"] },
);

console.log(result.svg, result.metrics);
```

Declarations and connections are line-oriented:

```text
kind:ID "label" at (x, y) color [options]
kind:ID "label" <relation>+ color [options]
SOURCE.port -> TARGET.port color [line|bezier|ortho options]
```

Invalid variants, duplicate options, bad ports, incompatible bus widths, unsafe colors, and out-of-bounds geometry fail with line-accurate diagnostics before any SVG is emitted.

## Placement without arithmetic

A declaration can state where it goes instead of computing it. The same filter, without the coordinates:

```text
source:VIN "AC" at (90, 150) #blue [type=voltage-ac]
resistor:R1 "1 k\Omega" right-of VIN by 190 #amber
junction:VOUT "V_{out}" right-of R1 by 190 #cyan
capacitor:C1 "100 nF" below VOUT by 140 #cyan [orientation=down]
```

Six relations — `right-of`, `left-of`, `above`, `below`, `aligned-x with`, `aligned-y with` — each optionally carrying a `by` distance, each addressing a component or one of its terminals (`below U1.pin3`). Directions measure from the referenced *body*, so `by 190` is 190 units of clear space between facing edges. An axis no relation constrains inherits it from the first reference, so `right-of A` means beside A and level with it; an explicit alignment overrides that, which is how a part takes its column from one component and its row from another.

**This is a lowering pass, not a layout engine.** Relations resolve to exactly one `at (x, y)` before the AST is finished — the netlist, the design rules, the source map, and the renderer never learn that relative placement exists. The suite pins that as a property: a relative document and the absolute one it lowers to compile to byte-identical SVG. Nothing decides where a part goes except a relation you wrote.

Forward references resolve, so declaration order is free. A cycle is a compile error that names its members. `compileSchematic` returns `placements` with the coordinates each declaration resolved to, for hosts that want to offer "freeze to absolute".

## What it compiles

- **Electrical** — passives, diode and transistor families, ports, grounds, sources, junctions, test points, connectors, power symbols, switches, protection, amplifiers, resonators, meters, loads, and arbitrary side-pinned ICs.
- **Digital** — IEEE/ANSI- or IEC-style gates, buffers, logic states, clocks, latches and flip-flops, mux/demux blocks, encoders, decoders, registers, counters, adders, comparators, and bus taps/splitters/joiners.
- **Quantum** — Hadamard, general `qgate`, named single-qubit gates, measurement, reset, preparation, controls, swaps, controlled operators, barriers, delays, and classical bit/register nodes.
- **UML** — structural, component/deployment, activity, sequence/interaction, and state-machine nodes with first-class relation semantics.

A compiled diagram is also a model: `buildNetlist` returns nodes, nets, and edges; `verifyNetlist` runs seven design rules over them; `describeSchematic` derives prose for a screen reader from the same connectivity. `compileSchematic` also hands back the work it did — `sourceMap` maps every vector to its declaration line, `placements` the coordinates each relation resolved to, and `routing` the retries, torn-up traces, and per-cell congestion of the router.

## Documentation

Every page is versioned per release line, and every example on the site is compiled by the real engine.

| | |
| --- | --- |
| [Quickstart](https://schemd.johnowolabiidogun.dev/docs/0.5/overview) | Install and compile your first diagram |
| [Grammar and options](https://schemd.johnowolabiidogun.dev/docs/0.5/grammar) | The full two-line language |
| [Component reference](https://schemd.johnowolabiidogun.dev/docs/0.5/component-reference) | Every kind, variant, and port |
| [Netlist and design rules](https://schemd.johnowolabiidogun.dev/docs/0.5/netlist) | Inspect connectivity, not just the picture |
| [Resource budgets](https://schemd.johnowolabiidogun.dev/docs/0.5/limits) | Compiling source you did not write |
| [Output modes](https://schemd.johnowolabiidogun.dev/docs/0.5/output-modes) | `default`, `embedded-css`, `full` |
| [Orientation and geometry](https://schemd.johnowolabiidogun.dev/docs/0.5/responsive-svg) | Quarter turns and layout |
| [Performance and size](https://schemd.johnowolabiidogun.dev/docs/0.5/performance) | Measured throughput and gzip budgets |
| [Migration from 0.2.x](./docs/MIGRATION-0.3.md) | Upgrading older documents |

## Before you rely on it

Read the [full limitations page](https://schemd.johnowolabiidogun.dev/docs/0.5/overview#limitations) before treating a clean compile as an engineering result. The short version:

- **`verifyNetlist` is structural linting, not verification.** It cannot establish analog correctness, timing, impedance, drive strength, metastability, or quantum validity. A clean result means no rule fired.
- **Routing is greedy and bounded.** The first pass is source order; when a trace cannot be placed, the router tears up what it has and retries with the failed trace first, up to `limits.routingAttempts`. That takes a full reversal bus to twelve wires. **Thirteen is unroutable, and reordering cannot reach it** — that width is a limit of the channel model, not of declaration order: widening the fence changes nothing, and twenty thousand random orders were searched at that width without finding one that routes. Spread the endpoints or split the bus.
- **The model is flat.** No hierarchy, no sub-sheets, no simulation, no timing analysis, no standards certification. It suits documentation, teaching, and schematics — not large engineering designs.
- **Compiling source you did not write?** Components and connections are unlimited by default. Pass [`limits`](https://schemd.johnowolabiidogun.dev/docs/0.5/limits) to reject an oversized document before it is routed, and pair it with a timeout of your own. Note that a document which *fails* to route pays for every retry before the diagnostic is raised, so keep `routingAttempts` low for untrusted input — `1` disables retries entirely.
- **Published performance figures are narrow.** Warm medians on one Apple Silicon / Node configuration. Run `bun run benchmark` on your own hardware.

## Compatibility

0.2.x through 0.4.x syntax, port aliases, UML stereotypes, output modes, and compiler entry points all still work. **0.5 adds and does not remove**: relative placement is new syntax, `placements` and `routing` are new result fields that are empty and zeroed for documents that do not use the features, and `routeConnections` and `validateDocumentGeometry` keep their exact signatures. One behaviour a host may observe is that a document which used to be rejected as unroutable may now compile, having been retried.

Two things changed in 0.4 that a host upgrading across it may still observe:

- **`SchematicEndpoint.port` now reports the canonical terminal**, as it has always documented. `R1.r` parses to `R1.out`, and `data-wire-source`, the source map, and the netlist agree with it. Use `canonicalPortName` to resolve any spelling the way the compiler does; read the source line if you need the author's own.
- **`MAX_SCHEMATIC_COMPONENTS` and `MAX_SCHEMATIC_CONNECTIONS` are gone**, along with their `SCHEMATIC_LIMITS` entries. Both are unlimited by default and configurable per call through `limits`.

New AST members are additive; consumers with exhaustive component-kind switches must handle the new discriminants.

## Release verification

After `bun install`, run `bun run test:visual:install` once to provision Chromium, then `bun run release:check` — type checking, 100% statement/branch/function/line coverage, bounded deterministic fuzzing, a 24-mutant 100%-kill gate, six Chromium pixel goldens, build, gzip budgets, and latency regression ceilings.

[Issues](https://github.com/schemd/core/issues) · [Contributing](./CONTRIBUTING.md) · [MIT](./LICENSE)
