<p align="center">
  <img src="./assets/brand/schemd-logo.svg" alt="Schemd — engineering vectors" width="640" />
</p>

# @schemd/core

Write schematics and UML as text. Get accessible, deterministic SVG.

Schemd has no runtime dependencies, browser layout pass, or DOM requirement. It works on a server or during a build.

## Install

```sh
npm install @schemd/core
```

Node.js 24+ is required.

## Quick start

```ts
import { compileSchematic, parseSchematicFence } from "@schemd/core";

const fence = parseSchematicFence(
  'schemd bounds="640x260" title="Sensor input"',
)!;

const { svg, document, metrics } = compileSchematic(`
port:VIN "Input" at (60, 130) #blue
resistor:R1 "10 k\\Omega" at (220, 130) #amber
capacitor:C1 "100 nF" at (400, 130) #cyan

VIN.out -> R1.in #blue [ortho]
R1.out -> C1.in #amber [ortho]
`, fence);
```

The DSL is intentionally small:

```text
kind:ID "label" at (x, y) color [options]
ID.port -> ID.port color [line|bezier|ortho]
```

It includes electrical parts, analog devices, logic and quantum gates, configurable ICs, math labels, collision-aware routing, and wire bridges.

UML nodes and relations use the same syntax:

```text
class:User "User" at (160, 120) #slate [attributes="- id: UUID" operations="+ save(): void"]
class:Admin "Admin" at (460, 120) #blue

Admin.left -> User.right #blue [ortho generalization]
```

Class, actor, use-case, state, lifeline, note, package, initial, and final nodes are built in. Relations include association, dependency, generalization, realization, aggregation, composition, message, transition, include, and extend.

Use `mode: "embedded-css"` for built-in styling or `mode: "full"` for interaction metadata. The default output stays compact and static.

On a colored surface, set `--schematic-surface` to that background color so hollow UML markers and connector-label halos match it.

Markdown belongs at the host boundary. Detect `schemd` fences in your server-side Markdown renderer and pass their text to `compileSchematic`; core does not ship or require a Markdown parser.

## Roadmap

**Now: topology and routing** → **Next: visual precision** → **Later: language and footprint**

Known limits and contributor-sized work live in the [active roadmap](./ROADMAP.md). Pick an item, open its claim link, and agree on the approach before starting a large change. Completed items are removed after merge.

[Documentation](https://johnowolabiidogun.dev/tools/schemd/docs/overview) · [Roadmap](./ROADMAP.md) · [Issues](https://github.com/Sirneij/schemd/issues) · [MIT](https://github.com/Sirneij/schemd/blob/main/LICENSE)
