# @schemd/core

[![npm version](https://img.shields.io/npm/v/@schemd/core.svg?style=flat-square)](https://www.npmjs.com/package/@schemd/core)
[![CI status](https://github.com/Sirneij/schemd/actions/workflows/ci.yml/badge.svg?style=flat-square)](https://github.com/Sirneij/schemd/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/@schemd/core.svg?style=flat-square)](https://github.com/Sirneij/schemd/blob/main/LICENSE)

Write engineering diagrams as text and compile them to accessible inline SVG.

Schemd supports electrical components, logic gates, quantum gates, and general system diagrams. It runs on the server or during a build, so the browser only receives SVG—no diagram runtime, DOM, or layout engine.

## Why Schemd?

- Small, readable text format
- Deterministic SVG output with fixed dimensions
- Straight, curved, and obstacle-aware orthogonal connections
- Accessible titles and descriptions
- No runtime dependencies

## Install

Schemd requires Node.js 24 or newer. Install `marked` if you want to use Markdown fences.

```sh
npm install @schemd/core marked
```

## Use with Markdown

```ts
import { Marked } from "marked";
import { schematicMarkedExtension } from "@schemd/core";

const markdown = new Marked();
markdown.use(schematicMarkedExtension());

const html = await markdown.parse(`
\`\`\`schemd bounds="640x260" title="Sensor input"
port:VIN "Input" at (60, 130) #blue
resistor:R1 "10 k\\Omega" at (220, 130) #amber
capacitor:C1 "100 nF" at (400, 130) #cyan

VIN.out -> R1.in #blue [ortho]
R1.out -> C1.in #amber [ortho]
\`\`\`
`);
```

## Use the compiler directly

```ts
import {
  parseSchematic,
  parseSchematicFence,
  renderSchematic,
} from "@schemd/core";

const fence = parseSchematicFence(
  'schemd bounds="640x260" title="Sensor input"',
);

if (!fence) throw new Error("Expected a schemd fence");

const diagram = parseSchematic(
  `port:VIN "Input" at (60, 130) #blue
resistor:R1 "10 k\\Omega" at (220, 130) #amber
VIN.out -> R1.in #blue [ortho]`,
  fence,
);

const svg = renderSchematic(diagram, fence);
```

## The language

A diagram has component declarations and connections:

```text
kind:ID "label" at (x, y) color [options]
ID.port -> ID.port color [line|bezier|ortho]
```

Available components include resistors, capacitors, inductors, diodes, transistors, grounds, ports, logic gates, quantum gates, and configurable IC blocks.

Use `line`, `bezier`, or `ortho` to choose a connection style. Arrow and dot markers are also supported:

```text
U1.out -> U2.in #emerald [ortho marker-end=arrow]
```

See the [full documentation](https://johnowolabiidogun.dev/tools/schemd/docs/overview) for component ports, options, colors, math labels, and framework integrations.

## Output modes

| Mode | Use it for |
| --- | --- |
| `default` | Small, static SVG |
| `embedded-css` | Built-in styles and responsive visuals |
| `full` | Interactive diagrams with node and wire metadata |

Pass a mode to `renderSchematic` or `schematicMarkedExtension`:

```ts
const svg = renderSchematic(diagram, { ...fence, mode: "embedded-css" });
```

## Security

Schemd validates input, escapes labels, limits diagram size, and returns bounded SVG. Compile diagrams on a trusted server or build system, then send the generated SVG to the browser. Do not treat arbitrary HTML as Schemd output.

## Development

```sh
npm install
npm run check
npm test
npm run build
```

Schemd is available under the [MIT License](https://github.com/Sirneij/schemd/blob/main/LICENSE).
