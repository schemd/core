# @wiremd/core

[![npm version](https://img.shields.io/npm/v/@wiremd/core.svg?style=flat-square)](https://www.npmjs.com/package/@wiremd/core)
[![CI status](https://github.com/Sirneij/wiremd/actions/workflows/ci.yml/badge.svg?style=flat-square)](https://github.com/Sirneij/wiremd/actions/workflows/ci.yml)
[![bundle size](https://deno.bundlejs.com/badge?q=@wiremd/core@0.1.2&style=flat-square)](https://bundlejs.com/?q=@wiremd/core)
[![coverage](https://img.shields.io/badge/coverage-100%25-brightgreen?style=flat-square)](https://github.com/Sirneij/wiremd/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/@wiremd/core.svg?style=flat-square)](https://github.com/Sirneij/wiremd/blob/main/LICENSE)

**Compile bounded engineering diagrams into accessible inline SVG—without a browser runtime, DOM,
layout engine, or graphics dependency.**

`@wiremd/core` is a strict TypeScript compiler for coordinate-authored electrical, digital, quantum, and
system-architecture diagrams. It is designed for trusted server and build boundaries: validate a
small text DSL, produce intrinsically sized SVG, cache the result, and ship only markup to readers.
The generic `ic`, `port`, and connection primitives can express UML-style component and architecture
views; `@wiremd/core` does not claim to implement the full UML class, sequence, or state-machine grammar.

## Why @wiremd/core

- **Zero runtime dependencies.** `marked` is a type-only peer integration; emitted compiler
  JavaScript does not import it.
- **Zero browser compiler cost.** The package is declared `browser: false`. Parse on a server,
  content-ingestion worker, CLI, or static-build boundary.
- **Deterministic and bounded.** Every source, topology, output, coordinate, color, and option is
  validated before SVG is returned.
- **Zero layout shift by construction.** Required `bounds="WIDTHxHEIGHT"` metadata becomes static
  `width`, `height`, and `viewBox` attributes during compilation.
- **Engineering-aware routing.** Straight, cubic Bézier, and orthogonal routes share real component
  port coordinates; orthogonal traces avoid component AABBs and receive bridge arcs at crossings.
- **Accessible output.** Every diagram has `<title>` and `<desc>` metadata. Interactive mode adds
  keyboard targets and semantic event-delegation hooks.
- **Themeable without recompilation.** Semantic color tokens become CSS classes and safe aliases
  resolve through host-owned custom properties.
- **Tiny math labels.** A linear, zero-dependency micro-parser converts common engineering notation
  into SVG `<tspan>` runs—no TeX, MathML, font asset, or client hydration required.

## Installation

```sh
npm install @wiremd/core marked
```

`marked` is a peer because the host application owns its Markdown version. Direct parser/renderer
usage does not instantiate Marked.

```ts
import {
	parseSchematic,
	parseSchematicFence,
	renderSchematic,
	type WiremdOutputMode
} from '@wiremd/core';

const info = 'wiremd bounds="640x260" title="Sensor front end"';
const fence = parseSchematicFence(info);

if (!fence) throw new Error('Expected a wiremd fence');

const document = parseSchematic(
	`port:VIN "V_{in}" at (60, 130) #blue
resistor:R1 "10 k\\Omega" at (220, 130) #amber
capacitor:C1 "100 nF" at (400, 130) #cyan
VIN.out -> R1.in #blue [ortho]
R1.out -> C1.in #amber [ortho marker-end=dot]`,
	fence
);

const mode: WiremdOutputMode = 'default';
const trustedSvg = renderSchematic(document, { ...fence, mode });
```

## Compiler architecture

`@wiremd/core` is a staged compiler, not a browser drawing widget:

```text
Markdown host / direct API
          │
          ▼
fence metadata + bounded DSL source
          │
          ▼
lexer and semantic parser ──► frozen, provenance-checked AST
          │
          ▼
port resolution + geometry validation + deterministic routing
          │
          ▼
bounded SVG writer ──► trusted, intrinsically sized inline markup
```

- `parser` validates fence metadata, declarations, colors, component options, ports, and resource
  ceilings before producing an AST.
- `layout` computes component extents, dynamic IC pins, physical port coordinates, AABB avoidance,
  crossing bridges, and final bounds safety.
- `renderer` writes escaped SVG through a byte-capped sink and applies the selected output mode.
- `marked-extension` is an optional host adapter. It owns cumulative per-document budgets and
  delegates every non-`wiremd` code block back to the host renderer.
- `math-label` is a linear label preprocessor invoked by the renderer; it is not a general TeX
  interpreter.

Every stage is synchronous and deterministic. There is no DOM measurement, network access,
filesystem access, timer, random source, global mutable diagram cache, or client-side hydration
requirement in the package runtime.

## Deployment and footprint

The compiler belongs exclusively in a trusted server/build graph. Its generated SVG is the only
artifact that should cross into a browser application.

| Surface                   |                                                                                     Physical cost | Browser execution cost |
| ------------------------- | ------------------------------------------------------------------------------------------------: | ---------------------: |
| npm package tarball       |                                        41,386 B (40.4 KiB) in the current `1.0.0` workspace build |                    0 B |
| Unpacked package          | 156,011 B (152.4 KiB), including stripped ESM, documented declarations, metadata, and this README |                    0 B |
| Emitted server JavaScript |              92,453 B raw / 22,613 B as individually Gzip-compressed modules in the current build |            Server only |
| `default` SVG             |                                                       Diagram-dependent; smallest output contract |         0 B JavaScript |
| `embedded-css` SVG        |                               `default` plus compact CSS, grid, transitions, and glow definitions |         0 B JavaScript |
| `full` SVG                |                                 `embedded-css` plus per-node, wire, and port interaction metadata |      Host adapter only |

Those server-module figures are measurements, not bundle guarantees. Tree-shaking, minification,
README growth, and the package manager affect installed size. The build strips comments from
runtime JavaScript while retaining full TSDoc in `.d.ts` files; source maps are intentionally not
published. Before publishing, record the authoritative release artifact with:

```sh
npm run build
npm pack --dry-run --json
wc -c dist/*.js
```

Generated payload size is topology-dependent. `@wiremd/core` enforces a 2,097,152-byte compiled SVG cap,
and its renderer tests guarantee the relative ordering `default < embedded-css < full` for an
equivalent document.

## Security and resource contract

Compilation is deliberately finite:

| Budget                                 |                                     Limit |
| -------------------------------------- | ----------------------------------------: |
| Source per diagram                     |          131,072 UTF-16 source characters |
| Components per diagram/document pass   |                                       512 |
| Connections per diagram/document pass  |                                     2,048 |
| Compiled SVG per diagram/document pass |                     2,097,152 UTF-8 bytes |
| Bounds                                 | `64x64` through `4096x4096` integer units |
| Fence title                            |                            512 characters |
| IC pins                                |                               64 per side |

The Marked extension applies the same budgets cumulatively across every `wiremd` fence in one
Markdown parse. Its `preprocess` hook resets counters for the next document. Once a cumulative limit
is exhausted, later wiremd fences fail immediately without another parse or render. Ordinary prose
and unrelated code fences never consume these budgets.

IDs, labels, options, colors, and XML text are validated or escaped. Parsed ASTs are deeply frozen
and capability-branded; `renderSchematic` rejects forged or mutated document objects. The grammar
uses no recursive rule and no data-dependent unbounded loop.

> Treat compiler output as trusted only when it came directly from `@wiremd/core`. Never pass arbitrary
> user HTML through the framework examples below.

## Markdown fence

The canonical language identifier is `wiremd`:

````markdown
```wiremd bounds="960x560" title="Mixed-signal flight-control processor"
port:INPUT "Sensor bus" at (46, 140) #slate
resistor:R1 "10 k\Omega" at (150, 140) #amber
capacitor:C1 "100 nF" at (280, 140) #blue
inductor:L1 "22 \muH" at (410, 140) #cyan
diode:D1 "Clamp" at (540, 140) #cyan [type=schottky]
transistor:Q1 "Output switch" at (690, 140) #phosphor [type=nmos]
ground:GND "Signal ground" at (690, 250) #slate [style=signal]

nand:G1 "Voting logic" at (210, 360) #cyan [inputs=3 outputs=2 standard=ieee]
ic:U1 "Mux" at (480, 400) #blue [left="S0,S1,EN" right="Y0,Y1" top="VCC" bottom="GND"]
hadamard:H1 "H|0〉 = |+〉" at (690, 390) #purple
qgate:RZ1 "R_Z^{\pi/4}" at (850, 390) #quantum-optical [phase="π/4"]

INPUT.out -> R1.in #slate [line]
R1.out -> C1.in #amber [ortho]
C1.out -> L1.in #blue [bezier]
L1.out -> D1.anode #cyan
D1.cathode -> Q1.gate #phosphor [ortho]
Q1.source -> GND.in #slate
G1.out2 -> U1.S0 #emerald [ortho marker-end=arrow]
U1.Y1 -> H1.in #quantum-optical [bezier]
H1.out -> RZ1.in #purple [line marker-end=dot]
```
````

`wiremd` is case-insensitive in fence metadata, but the language identifier itself is canonical:
other fenced languages are delegated to the host Markdown renderer and are never compiled as
diagrams.

## DSL grammar

Blank lines and lines beginning with `//` are ignored. All other records are either components or
connections.

```text
kind:ID "label" at (x, y) color [key=value ...]
ID.port -> ID.port color [line|bezier|ortho marker-start=... marker-end=...]
```

### Coordinates, identifiers, and labels

- Coordinates use diagram units and must be finite values inside the declared bounds.
- The renderer reserves the physical component, terminal hotspot, external designator, and label
  gutters; a visually clipped declaration fails rather than producing partially hidden SVG.
- Component IDs and port names begin with a letter and may contain letters, digits, `_`, or `-`.
- IDs are unique within one diagram. IC pin names are case-sensitive and unique across all sides.
- Labels are quoted. Renderer-owned escaping prevents label text from creating markup.
- Component options use one trailing bracket list. Values containing punctuation or lists are
  quoted as shown in the IC and quantum examples.

### Complete component reference

| Kind                              | Options and defaults                                                             | Canonical ports and aliases                                                    |
| --------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `resistor`                        | none                                                                             | `in`, `out`; `left`/`l` → `in`, `right`/`r` → `out`                            |
| `capacitor`                       | none                                                                             | `in`, `out`; `left`/`l` → `in`, `right`/`r` → `out`                            |
| `inductor`                        | none                                                                             | `in`, `out`; `left`/`l` → `in`, `right`/`r` → `out`                            |
| `diode`                           | `type=standard\|schottky\|zener\|led`; default `standard`                        | `anode`/`a`, `cathode`/`k`/`c`                                                 |
| `transistor`                      | `type=npn\|pnp\|nmos\|pmos`; default `npn`                                       | `base`/`gate`/`b`/`g`, `collector`/`drain`/`c`/`d`, `emitter`/`source`/`e`/`s` |
| `port`                            | none                                                                             | `in`, `out`                                                                    |
| `ground`                          | `style=chassis\|earth\|signal`; default `signal`                                 | `in`                                                                           |
| `and`, `nand`, `or`, `nor`, `xor` | `inputs=1..32`, `outputs=1..32`, `standard=ieee\|iec`; defaults `2`, `1`, `ieee` | `in1`…`inN`, `out1`…`outM`; `in`/`out` alias pin 1                             |
| `not`                             | same gate options; default one input and one output                              | `in1`…`inN`, `out1`…`outM`; `in`/`out` alias pin 1                             |
| `hadamard`                        | none                                                                             | `in`, `out`                                                                    |
| `cnot`                            | none                                                                             | `in`, `out`, `control`, `target`                                               |
| `qgate`                           | optional quoted `parameter`, `matrix`, `phase`                                   | `in`, `out`                                                                    |
| `ic`                              | quoted comma-separated `left`, `right`, `top`, `bottom` lists                    | Every declared pin; stable `in`/`out` fallbacks described below                |

IEEE gates use conventional curved or triangular contours. IEC gates use rectangular logic blocks.
Input and output pins are distributed deterministically across the computed body height.

### Dynamic IC blocks and UML-style architecture views

An `ic` creates a general rectangular component whose pins are part of the addressable graph:

```wiremd
ic:U1 "Flight computer" at (420, 220) #blue [left="CLK,DATA,ENABLE" right="FILTERED,FAULT" top="VCC" bottom="GND,RESET"]
```

The body is calculated without a measurement API:

```text
bodyWidth  = max(88, max(topPins, bottomPins) * 22 + 24)
bodyHeight = max(64, max(leftPins, rightPins) * 18 + 24)
```

`U1.CLK`, `U1.DATA`, `U1.FAULT`, and every other declared pin are valid endpoints. The `in` alias
first resolves a declared `in1`, then the first left or first top pin. `out` first resolves `out1`,
then the first right or first bottom pin. Literal `in` and `out` pin names are reserved. At least one
pin must be declared.

Combined with `port` terminals and labeled connections, IC blocks can model deployment nodes,
services, processors, buses, and UML-style component boundaries. They are intentionally generic;
there is no implicit UML relationship, multiplicity, class member, lifeline, or sequence semantics.

### Connection routing

```text
SOURCE.port -> TARGET.port color [ortho marker-start=dot marker-end=arrow]
```

- `[line]` is the default direct segment.
- `[bezier]` emits a deterministic cubic curve.
- `[ortho]` emits axis-aligned 90-degree trace segments.
- `[arrow]` and `[dot]` are shorthand end markers.
- `marker-start=none|arrow|dot` and `marker-end=none|arrow|dot` configure each endpoint.

Routes begin and end at the exact resolved physical port coordinates. Orthogonal routing expands
every non-endpoint component into an Axis-Aligned Bounding Box with a **12-unit clearance**. A
deterministic segment splitter compares bounded detours and routes around intersected boxes. It does
not run a general graph-search library.

After all routes are known, the document router indexes orthogonal segments in a fixed spatial grid.
When unrelated horizontal and vertical traces cross without sharing a port or junction, the trace
that appears later in source order receives a **5-unit SVG elliptical arc** bridge. True shared
endpoints remain junctions and never receive a bridge. Control points, obstacle detours, bridge
extrema, and physical endpoints all participate in static bounds validation.

### Color and theme grammar

The color field accepts:

- semantic tokens with or without `#`: `amber`, `#blue`, `cyan`, `purple`, `slate`, `emerald`;
- strict hex literals: `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`;
- validated legacy and modern `rgb()` / `rgba()` values;
- validated legacy and modern `hsl()` / `hsla()` values;
- safe custom aliases such as `#phosphor`, `quantum-optical`, or `brand-vector`.

Known tokens emit classes such as `.schematic-token--amber`. Custom aliases emit sanitized classes
and resolve through `--schematic-color-<alias>`, then `--schematic-vector-fallback`, then
`currentColor`. Validated CSS literals are assigned only to the compiler-owned
`--schematic-vector` property. Semicolons, `url()`, `var()`, injected attributes, invalid channels,
and values outside the documented grammar are rejected.

```css
.wiremd-host {
	--schematic-vector-fallback: currentColor;
	--schematic-color-phosphor: oklch(88% 0.24 145deg);
	--schematic-color-quantum-optical: oklch(76% 0.2 300deg);
}

.wiremd-host .schematic-token--amber {
	--schematic-vector: oklch(72% 0.17 65deg);
}
```

### Micro-math labels

Labels support a deliberately bounded notation subset. It is linear-time and produces native SVG
text runs.

| Input                                        | Output meaning          |
| -------------------------------------------- | ----------------------- |
| `V_{in}` or `V_i`                            | subscript               |
| `x^{2}` or `x^2`                             | superscript             |
| `\alpha`, `\beta`, `\Delta`                  | `α`, `β`, `Δ`           |
| `\lambda`, `\mu`, `\sigma`, `\theta`, `\phi` | `λ`, `μ`, `σ`, `θ`, `φ` |
| `\pi`, `\omega`, `\Omega`                    | `π`, `ω`, `Ω`           |
| `\cdot`, `\times`, `\pm`                     | `·`, `×`, `±`           |
| `\le`, `\ge`, `\neq`                         | `≤`, `≥`, `≠`           |
| `\rightarrow`, `\sqrt`, `\infty`             | `→`, `√`, `∞`           |

```wiremd
port:VIN "V_{in} = V_0 \cdot e^{-t/\tau}" at (100, 100) #blue
resistor:R1 "R_{load} = 10 k\Omega" at (360, 100) #amber
qgate:RZ "R_Z^{\pi/4}" at (620, 100) #purple [phase="π/4"]
```

Subscripts use a 70% `<tspan>` with a positive baseline shift; superscripts use a negative shift.
Each shifted segment emits an explicit inverse shift so subsequent text returns to the original
baseline. Unknown backslash commands remain literal text. Unmatched braces are treated as grouping
text, not executable syntax. Use surrounding prose, KaTeX, MathML, or another document-level system
for fractions, stacked matrices, semantic equations, or line breaking.

## Compilation modes

The output mode is a capability and payload budget, not a visual-quality switch:

| Mode           | Embedded CSS, grid, transitions, glow | Interaction `data-*`, focus targets, port hotspots | Best fit                                              |
| -------------- | ------------------------------------- | -------------------------------------------------- | ----------------------------------------------------- |
| `default`      | No                                    | No                                                 | Articles, static sites, PDFs, email/image conversion  |
| `embedded-css` | Yes                                   | No                                                 | Responsive themed visuals with zero client JavaScript |
| `full`         | Yes                                   | Yes                                                | Diagnostics, simulations, tooltips, logic probes      |

All modes retain intrinsic dimensions, accessible title/description data, semantic color classes,
atomic SVG symbols, and a figure caption. `default` and `embedded-css` compound compatible connection
paths. `full` preserves one trace per connection because each owns distinct source and target data.

Full mode exposes:

```html
<g
	class="schematic-component"
	data-node-id="R1"
	data-node-kind="resistor"
	data-node-label="10 kΩ"
	tabindex="0"
>
	<!-- component vector and port hotspots -->
</g>
<g class="schematic-wire" data-wire-source="R1.out" data-wire-target="C1.in" tabindex="0">
	<!-- trace vector and opt-in glow copy -->
</g>
```

Port hotspots expose `data-port-id` and `data-parent-node`. Visual states are standardized as
`.is-hovered`, `.is-active`, `.is-selected`, and `.is-degraded`. Embedded transitions honor
`prefers-reduced-motion: reduce`.

## Public API

```ts
import {
	parseSchematic,
	parseSchematicColor,
	parseSchematicFence,
	renderMathLabelTspans,
	renderSchematic,
	routeConnection,
	routeConnections,
	schematicMarkedExtension,
	SCHEMATIC_LIMITS,
	WIREMD_OUTPUT_MODES,
	SchematicSyntaxError,
	type SchematicDocument,
	type WiremdOutputMode
} from '@wiremd/core';
```

- `parseSchematicFence(info, defaultTitle?)` validates fence metadata.
- `parseSchematic(source, fence)` returns a frozen, renderer-authorized AST.
- `parseSchematicColor(source, line)` validates semantic, CSS, or alias color input.
- `renderSchematic(document, options)` generates escaped accessible SVG.
- `schematicMarkedExtension(options?)` compiles canonical `wiremd` fences through Marked.
- `parseMathLabel`, `mathLabelText`, `mathLabelGlyphLength`, and `renderMathLabelTspans` expose the
  bounded label subsystem.
- `resolvePortPoint`, `positionIcPin`, `enumerateComponentPorts`, `componentTextAnchors`,
  `componentRectangle`, and `componentObstacleRectangle` expose deterministic layout data.
- `routeConnection` resolves one route; `routeConnections` applies document-level bridge crossings.
- `validateDocumentGeometry` verifies every component and route against the intrinsic viewBox.
- `SCHEMATIC_LIMITS`, the `MAX_SCHEMATIC_*` constants, `WIREMD_OUTPUT_MODES`, component-kind domains,
  marker domains, and strict AST/layout types expose the exact compiler contract.

## Marked integration

```ts
// Server-only module
import { Marked } from 'marked';
import { schematicMarkedExtension } from '@wiremd/core';

function escapeHtml(value: string): string {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;');
}

const markdown = new Marked();
markdown.use(
	schematicMarkedExtension({
		mode: 'default',
		onError(error, source) {
			console.error('wiremd compilation failed', { message: error.message, line: error.line });
			return `<pre><code class="language-wiremd">${escapeHtml(source)}</code></pre>`;
		}
	})
);

export async function compileDocument(source: string): Promise<string> {
	return await markdown.parse(source);
}
```

The built-in error renderer emits escaped source and an accessible diagnostic. A custom `onError`
handler is a trusted server boundary: escape any source it returns. Unrelated code fences return
`false` and continue through the host renderer unchanged.

## Framework integration

Compile once on the server, then pass the resulting SVG string as trusted data. Full-mode examples
attach one delegated listener to the host rather than one listener per SVG node.

### React

```tsx
import { useEffect, useRef } from 'react';

export function WiremdDiagram({ svg }: { readonly svg: string }) {
	const host = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const root = host.current;
		if (!root) return;

		const select = (event: Event) => {
			const target =
				event.target instanceof Element
					? event.target.closest<SVGGElement>('[data-node-id]')
					: null;
			if (!target) return;
			root.querySelector('.is-selected')?.classList.remove('is-selected');
			target.classList.add('is-selected');
		};

		root.addEventListener('click', select);
		return () => root.removeEventListener('click', select);
	}, [svg]);

	return <div ref={host} dangerouslySetInnerHTML={{ __html: svg }} />;
}
```

### Vue 3

```vue
<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';

defineProps<{ svg: string }>();
const host = ref<HTMLDivElement | null>(null);

const select = (event: Event) => {
	const target = event.target instanceof Element ? event.target.closest('[data-node-id]') : null;
	if (!target || !host.value) return;
	host.value.querySelector('.is-selected')?.classList.remove('is-selected');
	target.classList.add('is-selected');
};

onMounted(() => host.value?.addEventListener('click', select));
onBeforeUnmount(() => host.value?.removeEventListener('click', select));
</script>

<template><div ref="host" v-html="svg" /></template>
```

### Svelte 5

```svelte
<script lang="ts">
	let { svg }: { svg: string } = $props();
	let host: HTMLDivElement;

	$effect(() => {
		const select = (event: Event) => {
			const target =
				event.target instanceof Element ? event.target.closest('[data-node-id]') : null;
			if (!target) return;
			host.querySelector('.is-selected')?.classList.remove('is-selected');
			target.classList.add('is-selected');
		};

		host.addEventListener('click', select);
		return () => host.removeEventListener('click', select);
	});
</script>

<div bind:this={host}>{@html svg}</div>
```

### Angular

Angular sanitizes ordinary HTML bindings. Bypass sanitization only for a string returned directly
from your own server-side `@wiremd/core` compiler boundary.

```ts
import { Component, ElementRef, Input, OnChanges, ViewChild } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

@Component({
	selector: 'app-wiremd-diagram',
	template: '<div #host [innerHTML]="trustedSvg" (click)="select($event)"></div>'
})
export class WiremdDiagramComponent implements OnChanges {
	@Input({ required: true }) svg = '';
	@ViewChild('host', { static: true }) host!: ElementRef<HTMLDivElement>;
	trustedSvg!: SafeHtml;

	constructor(private readonly sanitizer: DomSanitizer) {}

	ngOnChanges(): void {
		this.trustedSvg = this.sanitizer.bypassSecurityTrustHtml(this.svg);
	}

	select(event: MouseEvent): void {
		const target = event.target instanceof Element ? event.target.closest('[data-node-id]') : null;
		if (!target) return;
		this.host.nativeElement.querySelector('.is-selected')?.classList.remove('is-selected');
		target.classList.add('is-selected');
	}
}
```

## Alternative Markdown parsers

`@wiremd/core` owns the DSL and SVG contracts, not Markdown tokenization. Adapters should intercept only
the canonical `wiremd` fence and delegate every other token to the host parser.

### markdown-it

```ts
import MarkdownIt from 'markdown-it';
import { parseSchematic, parseSchematicFence, renderSchematic } from '@wiremd/core';

export function createMarkdown(): MarkdownIt {
	const markdown = new MarkdownIt({ html: true });
	const fallback = markdown.renderer.rules.fence;
	let diagramIndex = 0;

	markdown.renderer.rules.fence = (tokens, index, options, environment, renderer) => {
		const token = tokens[index]!;
		const info = token.info.trim();
		if (!/^wiremd(?:\s|$)/i.test(info)) {
			return fallback
				? fallback(tokens, index, options, environment, renderer)
				: renderer.renderToken(tokens, index, options);
		}

		const fence = parseSchematicFence(info);
		if (!fence) return '';
		const document = parseSchematic(token.content, fence);
		diagramIndex += 1;
		return renderSchematic(document, {
			...fence,
			idPrefix: `wiremd-${diagramIndex}`,
			mode: 'default'
		});
	};

	return markdown;
}
```

Reset `diagramIndex` at your document boundary when a single parser instance compiles multiple
documents. Apply the exported source/component/connection/output limits cumulatively if untrusted
documents may contain multiple wiremd fences; the built-in Marked extension already does this.

### remark / rehype

This transformer is intentionally visitor-free. It walks MDAST, replaces only `code` nodes whose
language is `wiremd`, and creates trusted `html` nodes. Configure `remark-rehype` and the final HTML
serializer to preserve trusted raw HTML according to your pipeline's security model.

```ts
import type { Code, Html, Parent, Root, RootContent } from 'mdast';
import { parseSchematic, parseSchematicFence, renderSchematic } from '@wiremd/core';

function isParent(node: RootContent | Root): node is Parent {
	return 'children' in node && Array.isArray(node.children);
}

export function remarkWiremd() {
	return (tree: Root): void => {
		let diagramIndex = 0;

		const transform = (parent: Parent): void => {
			parent.children = parent.children.map((node) => {
				if (node.type === 'code' && node.lang?.toLowerCase() === 'wiremd') {
					const code = node as Code;
					const info = `wiremd${code.meta ? ` ${code.meta}` : ''}`;
					const fence = parseSchematicFence(info);
					if (!fence) return node;
					const document = parseSchematic(code.value, fence);
					diagramIndex += 1;
					return {
						type: 'html',
						value: renderSchematic(document, {
							...fence,
							idPrefix: `wiremd-${diagramIndex}`,
							mode: 'default'
						})
					} satisfies Html;
				}

				if (isParent(node)) transform(node);
				return node;
			});
		};

		transform(tree);
	};
}
```

## Responsive rendering

The SVG already owns intrinsic dimensions and a `viewBox`. Let CSS scale its box; do not mutate
coordinates after compilation.

```css
.wiremd-container {
	container-type: inline-size;
	inline-size: 100%;
}

.wiremd-container .schematic-frame,
.wiremd-container .schematic-svg {
	display: block;
	inline-size: 100%;
	max-inline-size: 100%;
	block-size: auto;
}

@container (inline-size < 36rem) {
	.wiremd-container .schematic-label,
	.wiremd-container .schematic-designator {
		font-size: 0.9em;
	}
}
```

Do not remove the generated `width`, `height`, or `viewBox`; together they reserve aspect ratio
before CSS loads and keep server-rendered pages at zero CLS.

## Diagnostics and observability

Syntax failures throw `SchematicSyntaxError`. When available, `error.line` identifies the DSL line.
Log bounded metadata—not entire potentially sensitive source—in production:

```ts
import { SchematicSyntaxError } from 'wiremd';

try {
	// parse and render
} catch (error) {
	if (error instanceof SchematicSyntaxError) {
		logger.warn('wiremd.compile_rejected', {
			line: error.line,
			message: error.message,
			sourceCharacters: source.length
		});
		return;
	}
	throw error;
}
```

Malformed declarations, duplicate IDs, duplicate IC pins, unknown endpoints, unsafe colors,
out-of-range bounds, invalid options, resource exhaustion, and geometry overflow all fail closed.

## Development and release

```sh
npm run check
npm run build
npm test
npm run test:coverage
npm pack --dry-run --json
```

TypeScript uses `strict`, `noUncheckedIndexedAccess`, and `exactOptionalPropertyTypes` with no `any`
fallback. Vitest coverage gates are 100% for statements, branches, functions, and lines. The
published artifact contains stripped ESM, documented declarations, this README, package metadata,
and the MIT license. Source maps are intentionally excluded; `.d.ts` files retain public TSDoc for
first-class editor support.

## License

MIT
