<p align="center">
  <img src="https://github.com/schemd/web/blob/main/src/lib/assets/brand/schemd-logo.svg" alt="Schemd — engineering vectors" width="640" />
</p>

# @schemd/core

`schemd`—pronounced like “skemd” (`/skɛmd/`)—is a strict, deterministic text-to-SVG compiler for electrical, digital, quantum, and UML diagrams. It has zero runtime dependencies and does not use a DOM, Canvas, browser layout, external fonts, raster assets, or `getBBox()`.

Version 0.3.8 requires Node.js 24 or newer.

Two size budgets are enforced on every release. Tree-shaken to `compileSchematic` — what a host that only compiles actually ships — the bundle stays below 32 KiB gzip. The whole public entry with nothing shaken away, which is what registry size tools report, stays below 35 KiB gzip.

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

Orthogonal routes reuse one document-level spatial index instead of rescanning component geometry. A strict crossing between earlier source-ordered wires costs a soft penalty and earns a bridge; a contact that cannot be bridged — a shared channel, a shared corner — is priced as impossible, so the router never returns a route the contact rules would reject. Every trace reserves the approach to its own terminals before any wire is placed, and a blocked channel offers a lane a pitch to either side. Component and connector labels contribute hard readability bounds; shared-net channels remain free. Open arrow, triangle, and diamond markers are genuinely transparent on arbitrary host backgrounds, with the visible trace trimmed away beneath their interiors.

## Resource budgets

A document may declare as many components and connections as it can place. When
the source is not yours — a Markdown fence from a comment, a pull request, a CMS
— pass a budget and the compiler rejects an oversized document at the line that
crosses it, before routing or rendering any of it.

```ts
compileSchematic(source, {
  ...fence,
  limits: { components: 400, connections: 1_500, sourceCharacters: 64_000 },
});
// SchematicSyntaxError: Line 401: Schematic exceeds the 400 component limit.
```

Every field is optional and every omitted field keeps the default, so passing
nothing compiles exactly as before. `Infinity` means no limit, which is what
`components` and `connections` default to.

| Field | Default | Bounds |
| ----- | ------- | ------ |
| `components` | unlimited | component declarations |
| `connections` | unlimited | directed connections |
| `sourceCharacters` | 16,777,216 | UTF-16 characters read in one pass |
| `wireCrossings` | 32,768 | orthogonal intersections before routing gives up |
| `svgOutputBytes` | 268,435,456 | UTF-8 bytes of generated markup |

The budget is resolved once per compilation and is not clamped to the defaults:
a host that raises one has decided it can afford the allocation. A misspelled
field is an error rather than a silent no-op, because a limit you think you set
and did not is worse than no limit at all. `SCHEMATIC_LIMITS` reports the
defaults; note that its two unlimited counts are `Infinity`, which
`JSON.stringify` renders as `null`, so pass a replacer if you expose them.

A budget is not a timeout. It rejects a document by size, at the declaration
that crosses the ceiling; a small document can still be expensive to route, so
pair it with a time limit of your own.

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

`cnot` is intrinsically a two-qubit gate. Its canonical through-rail ports are
`in1`/`out1` for the control qubit and `in2`/`out2` for the target qubit. The
legacy `in` and `out` spellings remain aliases of the first rail, while
`control` and `target` address the two gate markers.

```text
prepare:Q0 "|0\\rangle" at (80, 120) #blue
prepare:Q1 "|0\\rangle" at (80, 220) #blue
cnot:CX "CX" at (360, 170) #purple
measure:M0 "q0" at (650, 120) #emerald
measure:M1 "q1" at (650, 220) #emerald

Q0.out -> CX.in1 #blue [quantum line]
Q1.out -> CX.in2 #blue [quantum line]
CX.out1 -> M0.in #purple [quantum line]
CX.out2 -> M1.in #purple [quantum line]
```

## UML example

```text
device:EDGE "Edge device" at (170, 140) #blue [width=180 height=100]
artifact:FW "firmware.bin" at (480, 140) #amber [width=170 height=90]
action:DEPLOY "Deploy" at (480, 340) #cyan [width=150 height=70]

EDGE.right -> FW.left #blue [assembly]
DEPLOY.top -> FW.bottom #cyan [control-flow]
```

## Netlist and design rules

A compiled diagram is not only a picture. The parser already resolves net topology and the layout pass already enumerates ports, so the same source can be inspected: what is connected to what, and which of those connections are mistakes.

```ts
import {
  inspectSchematic,
  parseSchematic,
  parseSchematicFence,
} from "@schemd/core";

const fence = parseSchematicFence('schemd bounds="900x400" title="Supply"')!;
const document = parseSchematic(
  `source:V1 "AC" at (100, 150) #blue [type=voltage-ac]
resistor:R1 "1 k" at (360, 150) #amber
ground:GND "0 V" at (620, 150) #slate

V1.positive -> R1.in #blue [line net=rail]
R1.out -> GND.in #slate [line net=rail]`,
  fence,
);

const { netlist, diagnostics } = inspectSchematic(document);
// netlist.nets[0].terminals -> V1.positive, R1.in, R1.out, GND.in
// diagnostics[0] -> error shorted-supply on line 5
```

`buildNetlist` returns the model — nodes with their stable ports, nets with their terminals, domains, widths, and source lines, and one edge per declared connection. `verifyNetlist` runs the rules over that model, and `inspectSchematic` does both.

| Code                      | Severity  | Fails when                                                                       |
| ------------------------- | --------- | -------------------------------------------------------------------------------- |
| `shorted-supply`          | `error`   | Two supply rails — a source positive, a power rail, or a ground — share one net. |
| `width-mismatch`          | `error`   | One net carries connections declaring different bus widths.                      |
| `domain-mismatch`         | `error`   | One net mixes signal domains, such as quantum and digital.                       |
| `unconnected-component`   | `warning` | A declared component takes part in no connection.                                |
| `duplicate-connection`    | `warning` | The same pair of terminals is connected more than once.                          |
| `multiple-drivers`        | `warning` | Two digital outputs drive the same net.                                          |
| `disconnected-subcircuit` | `info`    | The diagram contains more than one independent connected group.                  |

Rules are deliberately narrow. A source's `negative` terminal sharing a node with ground is the return path of almost every circuit ever drawn, so only two _rails_ on one net short; two analog terminals sharing a node is ordinary topology, so contention is reported for digital domains only. `SCHEMATIC_RULES` publishes each code with its severity and summary, and diagnostics arrive ordered by severity, then source line, then code — stable enough to assert against in a test or print in a CI log.

## Output modes

- `default`: compact, accessible, static SVG.
- `embedded-css`: the same geometry plus isolated built-in styles and state classes.
- `full`: node, port, wire, source-line, and topology metadata for delegated interaction.

All modes are deterministic and use diagram-local IDs. Hosts should use a unique `idPrefix` when more than one generated SVG can share a document.

## Limitations and operational risks

Read this before treating a clean compile as an engineering result.

- **`verifyNetlist` is structural linting, not verification.** It runs deterministic design rules over a flat connectivity model. It cannot establish analog correctness, timing, impedance, drive strength, metastability, quantum validity, or functional behaviour. A clean result means no rule fired — not that a circuit is correct or safe. The name is older than that distinction and is kept for compatibility.
- **Routing is deterministic but bounded.** A one-channel fast path falls back to a sparse compressed-grid A\*, and both are heuristics with limits. Dense but valid arrangements can still be rejected, and conservative body, label, marker, and occupancy rules refuse some diagrams that would have looked fine. Rejections are line-accurate and now suggest a coordinate that resolves them, but the compiler will not move a component you placed.
- **Routing is greedy and in source order, with no rip-up.** Each trace is placed against the ones already laid and is never moved to make room for a later one, so congestion is order-dependent: a trace can be unroutable because of a choice an earlier one made, not because no arrangement exists. Terminal approaches are reserved before any wire is placed, which removes the common cases; a full reversal bus compiles to ten wires and is rejected beyond that. Reordering the declarations, spreading the endpoints, or widening the fence resolves it.
- **The model is flat.** No hierarchy, no sub-sheets, no behavioural simulation, no timing analysis, no analog solving, and no standards certification. A document may declare as many components and connections as it can place — the compiler is linear in both, and sixty-four thousand components compile in about a second — but a flat drawing is still a drawing, and this suits documentation, teaching, and schematics rather than large engineering designs.
- **The remaining ceilings bound allocation, not diagram size, and are yours to tighten.** By default one call reads at most 16,777,216 source characters and hands back at most 256 MiB of markup, a canvas may be 64 to 1,048,576 units on a side, and the crossing pass gives up after 32,768 intersections. Those sit far past any readable diagram, so a host compiling source it did not write should set its own through the `limits` option above — including the component and connection counts, which are unlimited by default. A budget rejects a document at the declaration that crosses it, which is far cheaper than routing it; it is not a time limit, and a small document can still be expensive to route, so pair it with a timeout.
- **Descriptions report connectivity, not intent.** `@schemd/core/describe` states what the netlist proves and deliberately names no circuit archetypes. `headline` is one sentence and is what belongs in an `alt` attribute; `text` includes one sentence per net and can become long, so expose it as a separate long description rather than pasting it wholesale.
- **Legacy CNOT spellings address different things.** `control` and `target` name gate-marker positions; `in1`/`out1` and `in2`/`out2` are the composable rails. Both are accepted, and mixing the two models produces valid syntax with a topology you did not intend.
- **Coverage numbers describe the source, not the package.** 100% statement, branch, function, and line coverage, a fourteen-mutant kill gate, and six Chromium goldens all exercise the implementation. They said nothing about whether the published tarball could be imported: `@schemd/core/netlist` was unusable from 0.3.4 through 0.3.6 and `@schemd/core/describe` in 0.3.6, because no test crossed the installed-package boundary. A packaging test now does. **Consumers of those releases should upgrade to 0.3.7 or later.**
- **Published performance figures are narrow.** Warm medians on one Apple Silicon / Node configuration. There are no published cold-start, memory, pathological-input, browser-runtime, or multi-platform results. Run `bun run benchmark` on your own hardware.

## Compatibility

Omitting `orientation` is byte-identical to the explicit legacy default `orientation=right`. Existing 0.2.x syntax, port aliases, UML stereotypes, output modes, and compiler entry points remain supported. Every alias spelling is still accepted, but the AST now reports the canonical terminal it addresses, as `SchematicEndpoint.port` has always documented: a document written `R1.r` parses to `R1.out`, and `data-wire-source`, the source map, and the netlist agree with it. Hosts that echo the author's own spelling should read it from the source line rather than the AST; `canonicalPortName` resolves any spelling the way the compiler does. New AST members are additive; consumers with exhaustive component-kind switches must handle the new discriminants. The 0.3.2 geometry contract is intentionally stricter: documents that previously rendered overlapping bodies, body-clipping manual routes, or ambiguous separate-net contacts now fail with diagnostics and must be repositioned, routed orthogonally, or assigned a shared net.

## Release verification

After `bun install`, run `bun run test:visual:install` once to provision Chromium, then `bun run release:check` for type checking, 100% code coverage, bounded deterministic fuzzing, a 100%-kill targeted mutation gate, pixel goldens, build, gzip budget, and latency regression ceilings.

[Official versioned documentation](https://schemd.johnowolabiidogun.dev/docs/0.3/overview) · [Changelog](./CHANGELOG.md) · [Roadmap](./ROADMAP.md) · [Issues](https://github.com/schemd/core/issues) · [MIT](./LICENSE)
