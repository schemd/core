<p align="center">
  <img src="https://github.com/schemd/web/blob/main/src/lib/assets/brand/schemd-logo.svg" alt="Schemd — engineering vectors" width="640" />
</p>

# @schemd/core

`schemd`—pronounced like “skemd” (`/skɛmd/`)—is a strict, deterministic text-to-SVG compiler for electrical, digital, quantum, and UML diagrams. It has zero runtime dependencies and does not use a DOM, Canvas, browser layout, external fonts, raster assets, or `getBBox()`.

Version 0.3.2 requires Node.js 24 or newer. The compiler is held below an enforced 30 KiB gzip ceiling.

## Install

```sh
npm i @schemd/core # or bun add @schemd/core or pnpm add @schemd/core or yarn add @schemd/core or jspm install @schemd/core
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
junction:RETURN "return" at (470, 380) #slate
ground:GND "0 V" at (650, 380) #slate

VIN.positive -> R1.in #blue [line]
R1.out -> VOUT.node #amber [line]
VOUT.node -> C1.in #cyan [ortho]
C1.out -> RETURN.node #slate [line]
VIN.negative -> RETURN.node #slate [ortho]
RETURN.node -> GND.in #slate [line]`,
  { ...fence, mode: "full", semanticHooks: ["nodes", "ports", "wires"] },
);

console.log(result.svg, result.metrics);
```

Declarations and connections are line-oriented:

```text
kind:ID "label" at (x, y) color [options]
SOURCE.port -> TARGET.port color [line|bezier|ortho options]
```

Invalid component variants, duplicate options, unsupported rotations, bad ports, incompatible bus widths, unsafe colors, malformed markup, and out-of-bounds geometry fail with stable diagnostics before SVG emission.

Signal segments that share an exact terminal are one net. Use `net=NAME` to join disconnected segments explicitly; the compiler assigns deterministic `$1`, `$2`, … identities to unnamed nets. Separate orthogonal nets receive bridge arcs at strict crossings, while same-net crossings remain continuous and every unbridgeable contact fails before rendering.

Orthogonal routes reuse one document-level spatial index instead of rescanning component geometry. Earlier source-ordered wires contribute soft channel occupancy, and component/connector labels contribute hard readability bounds; shared-net channels remain free. Open arrow, triangle, and diamond markers are genuinely transparent on arbitrary host backgrounds, with the visible trace trimmed away beneath their interiors.

## Component inventory

- Electrical: passives, diode and transistor families, ports, grounds, sources, junctions, test points, connectors, power symbols, switches, protection, amplifiers, resonators, meters, loads, and arbitrary side-pinned ICs.
- Digital: IEEE/ANSI- or IEC-style gates, buffers, logic states, clocks, latches and flip-flops, mux/demux blocks, encoders, decoders, registers, counters, adders, comparators, and bus taps/splitters/joiners.
- Quantum: Hadamard, polished general `qgate`, named single-qubit gates, measurement, reset, preparation, controls, swaps, controlled operators, barriers, delays, and classical bit/register nodes.
- UML: structural, component/deployment, activity, sequence/interaction, and state-machine nodes with first-class relation semantics.

The single source of documentation truth is the official site — versioned per release line, with every example compiled by the real engine:

- [Component reference](https://schemd.johnowolabiidogun.dev/docs/0.3/component-reference)
- [Grammar and options](https://schemd.johnowolabiidogun.dev/docs/0.3/grammar)
- [Orientation and geometry](https://schemd.johnowolabiidogun.dev/docs/0.3/responsive-svg)
- [SVG output modes](https://schemd.johnowolabiidogun.dev/docs/0.3/output-modes)
- [Performance and size](https://schemd.johnowolabiidogun.dev/docs/0.3/performance)
- [Migration from 0.2.x](./docs/MIGRATION-0.3.md)

## Digital example

```text
port:DIN "D[7:0]" at (80, 130) #blue [width=8]
register:REG "Q[7:0]" at (390, 130) #purple [width=8]
clock:CLK "CLK" at (390, 300) #amber
port:OUT "Q[7:0]" at (720, 130) #emerald [width=8 orientation=left]

DIN.out -> REG.in #blue [digital width=8]
CLK.out -> REG.clock #amber [digital ortho]
REG.out -> OUT.in #emerald [digital width=8]
```

## Quantum example

`qgate` uses the same calibrated shell, centered operator typography, port geometry, upright labels, and semantic hooks as `hadamard`; optional parameter, phase, and matrix rows expand it deterministically.

```text
prepare:Q0 "|0\\rangle" at (80, 150) #blue
hadamard:H "H" at (260, 150) #cyan
qgate:U "U" at (480, 150) #purple [parameter="\\theta" phase="\\pi/2" matrix="[[a,b],[c,d]]"]
measure:M "M" at (720, 150) #emerald

Q0.out -> H.in #blue [quantum]
H.out -> U.in #cyan [quantum]
U.out -> M.in #purple [quantum]
```

## UML example

```text
device:EDGE "Edge device" at (170, 140) #blue [width=180 height=100]
artifact:FW "firmware.bin" at (480, 140) #amber [width=170 height=90]
action:DEPLOY "Deploy" at (480, 340) #cyan [width=150 height=70]

EDGE.right -> FW.left #blue [assembly]
DEPLOY.top -> FW.bottom #cyan [control-flow]
```

## Output modes

- `default`: compact, accessible, static SVG.
- `embedded-css`: the same geometry plus isolated built-in styles and state classes.
- `full`: node, port, wire, source-line, and topology metadata for delegated interaction.

All modes are deterministic and use diagram-local IDs. Hosts should use a unique `idPrefix` when more than one generated SVG can share a document.

## Compatibility

Omitting `orientation` is byte-identical to the explicit legacy default `orientation=right`. Existing 0.2.x syntax, port aliases, UML stereotypes, output modes, and compiler entry points remain supported. New AST members are additive; consumers with exhaustive component-kind switches must handle the new discriminants. The 0.3.2 geometry contract is intentionally stricter: documents that previously rendered overlapping bodies, body-clipping manual routes, or ambiguous separate-net contacts now fail with diagnostics and must be repositioned, routed orthogonally, or assigned a shared net.

## Release verification

After `bun install`, run `bun run test:visual:install` once to provision Chromium, then `bun run release:check` for type checking, 100% code coverage, bounded deterministic fuzzing, a 100%-kill targeted mutation gate, pixel goldens, build, gzip budget, and latency regression ceilings.

[Official versioned documentation](https://schemd.johnowolabiidogun.dev/docs/0.3.0/overview) · [Changelog](./CHANGELOG.md) · [Roadmap](./ROADMAP.md) · [Issues](https://github.com/schemd/core/issues) · [MIT](./LICENSE)
