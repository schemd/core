<p align="center">
  <img src="https://github.com/schemd/web/blob/main/src/lib/assets/brand/schemd-logo.svg" alt="Schemd — engineering vectors" width="640" />
</p>

# @schemd/core

`schemd`—pronounced like “skemd” (`/skɛmd/`)—is a strict, deterministic text-to-SVG compiler for electrical, digital, quantum, and UML diagrams. It has zero runtime dependencies and does not use a DOM, Canvas, browser layout, external fonts, raster assets, or `getBBox()`.

Version 0.4.0 requires Node.js 24 or newer. Tree-shaken to `compileSchematic` the bundle stays below 32 KiB gzip; the whole public entry, which is what registry size tools report, stays below 35 KiB gzip.

**[Documentation](https://schemd.johnowolabiidogun.dev/docs/0.4/overview)** · [Playground](https://schemd.johnowolabiidogun.dev/playground) · [Changelog](./CHANGELOG.md) · [Roadmap](./ROADMAP.md)

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
SOURCE.port -> TARGET.port color [line|bezier|ortho options]
```

Invalid variants, duplicate options, bad ports, incompatible bus widths, unsafe colors, and out-of-bounds geometry fail with line-accurate diagnostics before any SVG is emitted.

## What it compiles

- **Electrical** — passives, diode and transistor families, ports, grounds, sources, junctions, test points, connectors, power symbols, switches, protection, amplifiers, resonators, meters, loads, and arbitrary side-pinned ICs.
- **Digital** — IEEE/ANSI- or IEC-style gates, buffers, logic states, clocks, latches and flip-flops, mux/demux blocks, encoders, decoders, registers, counters, adders, comparators, and bus taps/splitters/joiners.
- **Quantum** — Hadamard, general `qgate`, named single-qubit gates, measurement, reset, preparation, controls, swaps, controlled operators, barriers, delays, and classical bit/register nodes.
- **UML** — structural, component/deployment, activity, sequence/interaction, and state-machine nodes with first-class relation semantics.

A compiled diagram is also a model: `buildNetlist` returns nodes, nets, and edges; `verifyNetlist` runs seven design rules over them; `describeSchematic` derives prose for a screen reader from the same connectivity.

## Documentation

Every page is versioned per release line, and every example on the site is compiled by the real engine.

| | |
| --- | --- |
| [Quickstart](https://schemd.johnowolabiidogun.dev/docs/0.4/overview) | Install and compile your first diagram |
| [Grammar and options](https://schemd.johnowolabiidogun.dev/docs/0.4/grammar) | The full two-line language |
| [Component reference](https://schemd.johnowolabiidogun.dev/docs/0.4/component-reference) | Every kind, variant, and port |
| [Netlist and design rules](https://schemd.johnowolabiidogun.dev/docs/0.4/netlist) | Inspect connectivity, not just the picture |
| [Resource budgets](https://schemd.johnowolabiidogun.dev/docs/0.4/limits) | Compiling source you did not write |
| [Output modes](https://schemd.johnowolabiidogun.dev/docs/0.4/output-modes) | `default`, `embedded-css`, `full` |
| [Orientation and geometry](https://schemd.johnowolabiidogun.dev/docs/0.4/responsive-svg) | Quarter turns and layout |
| [Performance and size](https://schemd.johnowolabiidogun.dev/docs/0.4/performance) | Measured throughput and gzip budgets |
| [Migration from 0.2.x](./docs/MIGRATION-0.3.md) | Upgrading older documents |

## Before you rely on it

Read the [full limitations page](https://schemd.johnowolabiidogun.dev/docs/0.4/overview#limitations) before treating a clean compile as an engineering result. The short version:

- **`verifyNetlist` is structural linting, not verification.** It cannot establish analog correctness, timing, impedance, drive strength, metastability, or quantum validity. A clean result means no rule fired.
- **Routing is greedy, in source order, with no rip-up.** A trace can be unroutable because of a choice an earlier one made. A full reversal bus compiles to ten wires and is rejected beyond that; reorder the declarations, spread the endpoints, or widen the fence.
- **The model is flat.** No hierarchy, no sub-sheets, no simulation, no timing analysis, no standards certification. It suits documentation, teaching, and schematics — not large engineering designs.
- **Compiling source you did not write?** Components and connections are unlimited by default. Pass [`limits`](https://schemd.johnowolabiidogun.dev/docs/0.4/limits) to reject an oversized document before it is routed, and pair it with a timeout of your own.
- **Published performance figures are narrow.** Warm medians on one Apple Silicon / Node configuration. Run `bun run benchmark` on your own hardware.

## Compatibility

0.2.x and 0.3.x syntax, port aliases, UML stereotypes, output modes, and compiler entry points all still work. Two things changed in 0.4 that a host may observe:

- **`SchematicEndpoint.port` now reports the canonical terminal**, as it has always documented. `R1.r` parses to `R1.out`, and `data-wire-source`, the source map, and the netlist agree with it. Use `canonicalPortName` to resolve any spelling the way the compiler does; read the source line if you need the author's own.
- **`MAX_SCHEMATIC_COMPONENTS` and `MAX_SCHEMATIC_CONNECTIONS` are gone**, along with their `SCHEMATIC_LIMITS` entries. Both are unlimited by default and configurable per call through `limits`.

New AST members are additive; consumers with exhaustive component-kind switches must handle the new discriminants.

## Release verification

After `bun install`, run `bun run test:visual:install` once to provision Chromium, then `bun run release:check` — type checking, 100% statement/branch/function/line coverage, bounded deterministic fuzzing, a 14-mutant 100%-kill gate, six Chromium pixel goldens, build, gzip budgets, and latency regression ceilings.

[Issues](https://github.com/schemd/core/issues) · [MIT](./LICENSE)
