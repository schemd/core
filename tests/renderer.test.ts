/** SVG safety, accessibility, output-mode, interaction-hook, and payload-bound verification. */
import { describe, expect, test } from 'vitest';
import {
	parseSchematic,
	renderSchematic,
	type CompileSchematicOptions,
	type SchematicFence
} from '../src/index.js';
import { BoundedSvgWriter, MAX_SVG_OUTPUT_BYTES } from '../src/renderer.js';

const fence: SchematicFence = {
	bounds: { width: 640, height: 260 },
	title: 'Classical < quantum & optical'
};

const source = `resistor:R1 "10k & stable" at (50, 70) #amber
capacitor:C1 "100nF" at (150, 70) #blue
nand:G1 "74HC00" at (260, 100) #cyan
xor:G2 "Parity" at (360, 100) #slate
hadamard:Q1 "H Gate" at (470, 100) #purple
cnot:Q2 "CNOT" at (570, 100) #emerald
R1.out -> C1.in #slate
C1.out -> G1.in1 #blue
G1.out -> G2.in2 #cyan [bezier]
G2.out -> Q1.in #purple
Q1.out -> Q2.control #emerald
Q2.target -> Q2.in #amber`;

describe('renderSchematic', () => {
	test('emits intrinsic SSR SVG, semantic classes, every symbol, and lightweight bloom', () => {
		const html = renderSchematic(parseSchematic(source, fence), {
			...fence,
			idPrefix: 'article diagram/1',
			mode: 'full'
		});
		expect(html).toContain('viewBox="0 0 640 260" width="640" height="260"');
		expect(html).toContain('id="article-diagram-1-schematic-glow-filter"');
		expect(html).toContain('<feGaussianBlur');
		expect(html).toContain('<style>.schematic-token{fill:none');
		expect(html).toContain('.schematic-component.is-hovered>.schematic-glow-layer');
		expect(html).toContain('.schematic-component.is-active>.schematic-glow-layer');
		expect(html).toContain('.schematic-component.is-selected>.schematic-glow-layer');
		expect(html).toContain('.schematic-component.is-degraded');
		expect(html).toContain('transition:stroke .2s ease');
		expect(html).toContain('schematic-token--amber');
		expect(html).toContain('schematic-token--emerald');
		expect(html).toContain('M 308 100 C 310 100, 310 108, 312 108');
		expect(html).toContain('Classical &lt; quantum &amp; optical');
		expect(html).toContain('10k &amp; stable');
		expect(html).not.toMatch(/(?:fill|stroke)=["']#[A-Fa-f0-9]/);
		expect(html.match(/class="schematic-component"/g)).toHaveLength(6);
		expect(html.match(/class="schematic-glow-layer"/g)).toHaveLength(12);
		expect(html.match(/data-port-id=/g)).toHaveLength(16);
		expect(html).toContain(
			'data-node-id="R1" data-node-kind="resistor" data-node-label="10k &amp; stable"'
		);
		expect(html).toContain('data-component="R1" data-kind="resistor"');
		expect(html).toContain(
			'data-wire-source="R1.out" data-wire-target="C1.in" data-source-line="7" data-net-id="$1" tabindex="0"'
		);
		expect(html).toContain('data-port-id="out" data-parent-node="R1" tabindex="0" role="button"');
		expect(html).toContain('role="group" aria-labelledby=');
		expect(html).not.toMatch(/class="schematic-component"[^>]*tabindex=/);
		expect(html).toContain('stroke-width:8;vector-effect:non-scaling-stroke');
		expect(html).not.toContain('<script');
	});

	test('defaults to compact, accessible, static output without interaction payloads', () => {
		const html = renderSchematic(parseSchematic(source, fence), fence);
		expect(html).toContain('role="img" aria-labelledby=');
		expect(html).toContain('<title');
		expect(html).toContain('<desc');
		expect(html).not.toContain('<style>');
		expect(html).not.toContain('schematic-glow-filter');
		expect(html).not.toContain('schematic-glow-layer');
		expect(html).not.toContain('data-node-id');
		expect(html).not.toContain('data-wire-source');
		expect(html).not.toContain('data-port-id');
		expect(html).not.toContain('tabindex=');
		expect(html).not.toContain('transition:');
	});

	test('enables embedded visual styles and full semantic hooks independently', () => {
		const document = parseSchematic(
			'resistor:R1 "A" at (80, 80) #amber\ncapacitor:C1 "B" at (200, 80) #blue\nR1.out -> C1.in #slate',
			fence
		);
		const styles = renderSchematic(document, { ...fence, mode: 'embedded-css' });
		expect(styles).toContain('schematic-glow-filter');
		expect(styles).toContain('schematic-glow-layer');
		/* role="img" flattens descendants for assistive tech, so nothing inside may take focus. */
		expect(styles).not.toContain('tabindex=');
		expect(styles).toContain('role="img" aria-labelledby=');
		expect(styles).not.toContain('data-node-id');
		expect(styles).not.toContain('data-port-id');

		const hooks = renderSchematic(document, { ...fence, mode: 'full' });
		expect(hooks).toContain('data-node-id="R1"');
		expect(hooks).toContain('data-wire-source="R1.out"');
		expect(hooks).toContain('data-port-id="in"');
		expect(hooks).toContain('role="group" aria-labelledby=');
		expect(hooks).not.toMatch(/class="schematic-component"[^>]*tabindex=/);
		expect(hooks).toContain(
			'.schematic-port-hotspot{fill:transparent!important;stroke:transparent!important'
		);
		expect(hooks).toContain('.schematic-port-hotspot:focus-visible');
		expect(hooks).toContain('fill-opacity:.22!important');
		expect(hooks).toContain('schematic-glow-filter');
		expect(hooks).toContain('schematic-glow-layer');
		expect(hooks).toContain('transition:');
	});

	test('emits only the requested full-mode semantic hooks', () => {
		const document = parseSchematic(
			'resistor:R1 "A" at (80, 80) #amber\ncapacitor:C1 "B" at (200, 80) #blue\nR1.out -> C1.in #slate',
			fence
		);
		const html = renderSchematic(document, {
			...fence,
			mode: 'full',
			semanticHooks: ['nodes', 'wires']
		});
		expect(html).toContain('data-node-id="R1"');
		expect(html).toContain('data-wire-source="R1.out"');
		expect(html).not.toContain('data-port-id');
		expect(html).not.toContain('.schematic-port-hotspot:focus-visible');

		const visualsOnly = renderSchematic(document, {
			...fence,
			mode: 'full',
			semanticHooks: []
		});
		expect(visualsOnly).not.toContain('data-node-id');
		expect(visualsOnly).not.toContain('data-wire-source');
		expect(visualsOnly).not.toContain('data-port-id');
		expect(visualsOnly).toContain('schematic-glow-filter');
	});

	test('rejects unknown semantic hooks at the JavaScript boundary', () => {
		const document = parseSchematic('resistor:R1 "A" at (80, 80) #amber', fence);
		expect(() =>
			renderSchematic(document, {
				...fence,
				mode: 'full',
				semanticHooks: 'ports'
			} as unknown as CompileSchematicOptions)
		).toThrow('semanticHooks must be an array');
		expect(() =>
			renderSchematic(document, {
				...fence,
				mode: 'full',
				semanticHooks: ['unknown']
			} as unknown as CompileSchematicOptions)
		).toThrow('semanticHooks may contain only');
	});

	test('renders every analog variant and a ports-only semantic payload', () => {
		const variantFence = { bounds: { width: 1800, height: 320 }, title: 'Analog variants' };
		const document = parseSchematic(
			`inductor:L1 "Coil" at (90, 150) #amber
diode:D0 "Standard" at (215, 150) #blue [type=standard]
diode:D1 "Schottky" at (340, 150) #blue [type=schottky]
diode:D2 "Zener" at (465, 150) #blue [type=zener]
diode:D3 "LED" at (590, 150) #blue [type=led]
transistor:Q0 "NPN" at (715, 150) #cyan [type=npn]
transistor:Q1 "PNP" at (840, 150) #cyan [type=pnp]
transistor:Q2 "NMOS" at (965, 150) #cyan [type=nmos]
transistor:Q3 "PMOS" at (1090, 150) #cyan [type=pmos]
ground:G0 "Signal" at (1215, 150) #slate [style=signal]
ground:G1 "Earth" at (1340, 150) #slate [style=earth]
ground:G2 "Chassis" at (1465, 150) #slate [style=chassis]
port:P1 "Port" at (1590, 150) #purple
ic:U1 "IC" at (1710, 150) #emerald [left="A" right="Y"]`,
			variantFence
		);
		const html = renderSchematic(document, {
			...variantFence,
			mode: 'full',
			semanticHooks: ['ports']
		});
		expect(html).toContain('data-port-id="anode"');
		expect(html).not.toContain('data-node-id');
		expect(html).not.toContain('data-wire-source');
		expect(html).toContain('aria-label="D1, diode, Schottky, schottky"');
		expect(html).toContain('aria-label="Q3, transistor, PMOS, pmos"');
		expect(html).toContain('aria-label="G2, ground, Chassis, chassis"');
		expect(html).toContain('aria-label="U1, ic, IC, 2 pins"');
	});

	test('keeps both interaction payloads measurably absent until requested', () => {
		const document = parseSchematic(source, fence);
		const bytes = (mode: Exclude<CompileSchematicOptions['mode'], undefined>): number =>
			new TextEncoder().encode(renderSchematic(document, { ...fence, mode })).byteLength;
		const staticBytes = new TextEncoder().encode(renderSchematic(document, fence)).byteLength;
		const styleBytes = bytes('embedded-css');
		const fullBytes = bytes('full');

		expect(styleBytes).toBeGreaterThan(staticBytes);
		expect(fullBytes).toBeGreaterThan(styleBytes);
	});

	test('reuses atomic symbols, compounds static traces, and emits only requested markers', () => {
		const markerFence = { bounds: { width: 520, height: 240 }, title: 'Signal markers' };
		const document = parseSchematic(
			`resistor:R1 "A" at (80, 100) #amber
resistor:R2 "B" at (240, 100) #amber
resistor:R3 "C" at (420, 100) #amber
R1.out -> R2.in #blue [ortho marker-start=dot marker-end=arrow]
R2.out -> R3.in #blue [ortho marker-start=dot marker-end=arrow]`,
			markerFence
		);
		const minimal = renderSchematic(document, markerFence);
		expect(minimal.match(/id="[^"]+-symbol-resistor"/g)).toHaveLength(1);
		expect(minimal.match(/href="#[^"]+-symbol-resistor"/g)).toHaveLength(3);
		expect(
			minimal.match(/class="schematic-token schematic-token--blue schematic-trace"/g)
		).toHaveLength(1);
		expect(minimal).toContain('marker-start="url(#');
		expect(minimal).toContain('-marker-dot)"');
		expect(minimal).toContain('marker-end="url(#');
		expect(minimal).toContain('-marker-arrow)"');
		expect(minimal.match(/<marker /g)).toHaveLength(2);
		const responsive = renderSchematic(document, { ...markerFence, mode: 'embedded-css' });
		/* Hover-only wire groups stay out of the tab order under the root's role="img". */
		expect(responsive).toContain('<g class="schematic-wire"><path');
		expect(responsive).not.toContain('tabindex=');
		expect(responsive).toContain('wire-batch-0-vector');
		expect(responsive).toContain('schematic-glow-layer');

		const interactive = renderSchematic(document, { ...markerFence, mode: 'full' });
		expect(interactive.match(/data-wire-source=/g)).toHaveLength(2);
		expect(interactive.match(/class="schematic-wire"/g)).toHaveLength(2);
	});

	test('renders open markers without surface fills or visible traces through their interiors', () => {
		const markerFence = { bounds: { width: 480, height: 240 }, title: 'Transparent markers' };
		const document = parseSchematic(
			`port:L "L" at (80,120) #blue
port:R "R" at (400,120) #blue
L.out -> R.in #blue [line marker-start=diamond marker-end=triangle]`,
			markerFence
		);
		const html = renderSchematic(document, markerFence);
		expect(html).toContain('marker-triangle');
		expect(html).toContain('marker-diamond');
		expect(html).toContain('d="M0 1 11 6 0 11Z" fill="none"');
		expect(html).not.toContain('fill="var(--schematic-surface');
		expect(html).toContain('schematic-marker-carrier"');
		expect(html).toContain('d="M 122 120 L 358 120" stroke-width="0"');
		expect(html).toContain('d="M 134 120 L 346 120"');
		const vertical = renderSchematic(
			parseSchematic(
				`port:T "T" at (240,68) #cyan [orientation=down]
port:B "B" at (240,252) #cyan [orientation=down]
T.out -> B.in #cyan [ortho marker-start=open-arrow marker-end=open-arrow]`,
				{ bounds: { width: 480, height: 320 }, title: 'Vertical transparent markers' }
			),
			{ bounds: { width: 480, height: 320 }, title: 'Vertical transparent markers', mode: 'embedded-css' }
		);
		expect(vertical).toContain('.schematic-marker-carrier{stroke-width:0!important}');
		expect(vertical).toContain('d="M 240 110 V 210" stroke-width="0"');
		expect(vertical).toContain('d="M 240 119 V 201"');
	});

	test('reuses the polished qgate shell through one canonical definition', () => {
		const minimal = renderSchematic(
			parseSchematic('qgate:Q1 "RX" at (120, 100) #purple', fence),
			fence
		);
		expect(minimal).toContain('<defs>');
		expect(minimal).toContain('symbol-quantum-shell-50-50');
	});

	test('namespaces every interactive definition and vector reference per diagram', () => {
		const first = renderSchematic(parseSchematic('resistor:R1 "A" at (80, 80) #amber', fence), {
			...fence,
			mode: 'embedded-css'
		});
		const second = renderSchematic(parseSchematic('resistor:R2 "B" at (180, 80) #blue', fence), {
			...fence,
			mode: 'embedded-css'
		});
		const firstFilter = first.match(/<filter id="([^"]+-schematic-glow-filter)"/)?.[1];
		const secondFilter = second.match(/<filter id="([^"]+-schematic-glow-filter)"/)?.[1];
		expect(firstFilter).toBeDefined();
		expect(secondFilter).toBeDefined();
		expect(firstFilter).not.toBe(secondFilter);
		expect(first).toContain(`filter="url(#${firstFilter})"`);
		expect(first).toMatch(/<use id="[^"]+-node-0-vector" class="[^"]*schematic-component-vector"/);
		expect(first).toMatch(/<use class="schematic-glow-layer" href="#[^"]+-node-0-vector"/);
	});

	test('generates IEEE and IEC N-input/M-output gates plus centered universal qgate metadata', () => {
		const document = parseSchematic(
			`and:G1 "Consensus" at (120, 130) #112233 [inputs=4 outputs=2 standard=ieee]
nor:G2 "Interlock" at (300, 130) rgba(10, 20, 30, 0.5) [inputs=3 outputs=2 standard=iec]
or:G3 "Route" at (450, 130) #brand-vector [inputs=2 outputs=1]
not:G4 "Invert" at (560, 130) #amber [inputs=1 outputs=2]
qgate:QX "Pauli & X" at (760, 130) hsl(270 80% 60%) [parameter="θ&lt;π" matrix="[[0,1],[1,0]]" phase="π/2"]`,
			{ bounds: { width: 850, height: 300 }, title: 'Polymorphic gates' }
		);
		const html = renderSchematic(document, {
			bounds: { width: 850, height: 300 },
			title: 'Polymorphic gates',
			mode: 'full'
		});
		expect(html).toContain('d="M -48 -19.2 H -32"');
		expect(html).toContain(
			'<text class="schematic-gate-symbol" fill="currentColor" stroke="none" x="0" y="4" text-anchor="middle" font-size="14">≥1</text>'
		);
		expect(html).toContain('style="color:#112233;--schematic-vector:#112233"');
		expect(html).toContain(
			'style="color:rgb(10 20 30 / 0.5);--schematic-vector:rgb(10 20 30 / 0.5)"'
		);
		expect(html).toContain(
			'var(--schematic-color-brand-vector,var(--schematic-vector-fallback,currentColor))'
		);
		expect(html).toContain('aria-label="QX, qgate, Pauli &amp; X, θ&amp;lt;π, π/2');
		expect(html).toContain(
			'class="schematic-gate-symbol" fill="currentColor" stroke="none" x="0" y="-18.5"'
		);
		expect(html).toContain('θ&amp;lt;π');
	});

	test('joins arbitrary IEEE pins and inversion bubbles exactly to each gate contour', () => {
		const gateFence = { bounds: { width: 900, height: 300 }, title: 'Continuous gates' };
		const document = parseSchematic(
			`and:A1 "AND" at (100, 150) #cyan [inputs=3 outputs=3]
nand:N1 "NAND" at (230, 150) #cyan [inputs=3 outputs=3]
or:O1 "OR" at (360, 150) #cyan [inputs=3 outputs=3]
nor:NO1 "NOR" at (490, 150) #cyan [inputs=3 outputs=3]
xor:X1 "XOR" at (620, 150) #cyan [inputs=3 outputs=3]
not:I1 "NOT" at (750, 150) #cyan [inputs=3 outputs=3]`,
			gateFence
		);
		const html = renderSchematic(document, gateFence);
		expect(html).toContain('d="M 27.713 -12 H 48"');
		expect(html).toContain('cx="31.713" cy="-12" r="4"');
		expect(html).toContain('d="M 35.713 -12 H 48"');
		expect(html).toContain('d="M -48 0 H -22"');
		expect(html).toContain('d="M 14.497 -12 H 48"');
		expect(html).toContain('cx="18.497" cy="-12" r="4"');
		expect(html).toContain('d="M 22.497 -12 H 48"');
		expect(html).toContain('d="M -48 0 H -28"');
		expect(html).toContain('d="M -48 0 H -30"');
		expect(html).toContain('cx="4" cy="-12" r="4"');
		expect(html).toContain('d="M 8 -12 H 48"');
	});

	test('fits quantum metadata and every IC pin label inside static component geometry', () => {
		const document = parseSchematic(
			`qgate:Q1 "Long quantum operator" at (130, 130) #purple [parameter="parameter-value" matrix="matrix-value" phase="phase-value"]
ic:U1 "Flight control multiplexer" at (390, 130) #cyan [left="SELECT_LONG" right="OUTPUT_LONG" top="CLOCK_LONG" bottom="GROUND_LONG"]`,
			{ bounds: { width: 600, height: 300 }, title: 'Fitted labels' }
		);
		const html = renderSchematic(document, {
			bounds: { width: 600, height: 300 },
			title: 'Fitted labels'
		});

		expect(html).toContain('textLength="92" lengthAdjust="spacingAndGlyphs">Long quantum operator');
		expect(html).toContain('textLength="34" lengthAdjust="spacingAndGlyphs">SELECT_LONG');
		expect(html).toContain('transform="rotate(90 0 -27)"');
		expect(html).toContain('transform="rotate(-90 0 27)"');
		expect(html).toContain('textLength="76" lengthAdjust="spacingAndGlyphs">Flight control');
	});

	test('uses a deterministic generated prefix and singular accessible counts', () => {
		const document = parseSchematic('hadamard:Q1 "H Gate" at (100, 100) #purple', fence);
		const first = renderSchematic(document, fence);
		const second = renderSchematic(document, fence);
		expect(first).toBe(second);
		expect(first).toMatch(/id="schematic-[a-z0-9]+-title"/);
		expect(first).toContain('1 component and 0 connections.');
	});

	test('describes a singular connection', () => {
		const document = parseSchematic(
			'resistor:R1 "A" at (80, 80) #amber\ncapacitor:C1 "B" at (200, 80) #blue\nR1.out -> C1.in #slate',
			fence
		);
		expect(renderSchematic(document, fence)).toContain('2 components and 1 connection.');
	});

	test('exposes rendered micro-math text instead of raw source syntax to assistive technology', () => {
		const document = parseSchematic('port:VOUT "V_{out} \\Omega" at (100, 80) #emerald', fence);
		const html = renderSchematic(document, { ...fence, mode: 'full' });
		expect(html).toContain('aria-label="VOUT, port, Vout Ω"');
		expect(html).not.toContain('aria-label="VOUT, port, V_{out}');
	});

	test('guards renderer input when a caller bypasses parser validation', () => {
		expect(() =>
			renderSchematic(
				{
					components: [],
					connections: [
						{
							from: { componentId: 'missing', port: 'out' },
							to: { componentId: 'missing', port: 'in' },
							color: { kind: 'token', value: 'slate' },
							curve: 'line',
							markerStart: 'none',
							markerEnd: 'none',
							line: 1
						}
					]
				},
				fence
			)
		).toThrow(/immutable document returned by parseSchematic/);
	});

	test('falls back to a deterministic safe ID when a caller supplies only punctuation', () => {
		const document = parseSchematic('resistor:R1 "A" at (80, 80) #amber', fence);
		const html = renderSchematic(document, { ...fence, idPrefix: '///' });
		expect(html).toMatch(/id="schematic-[a-z0-9]+-title"/);
	});

	test('normalizes hostile options once and escapes invalid XML characters', () => {
		const invalidXml = '\u0000\u000b\u000c\u001f\ufffe\uffff\ud800';
		const document = parseSchematic(
			`resistor:R1 "A\té€\ue000😀${invalidXml}" at (100, 80) #amber`,
			fence
		);
		let boundsReads = 0;
		let widthReads = 0;
		let heightReads = 0;
		let titleReads = 0;
		let prefixReads = 0;
		const volatileOptions = {
			get bounds() {
				boundsReads += 1;
				return {
					get width() {
						widthReads += 1;
						return widthReads === 1 ? 640 : 0;
					},
					get height() {
						heightReads += 1;
						return heightReads === 1 ? 260 : 0;
					}
				};
			},
			get title() {
				titleReads += 1;
				return titleReads === 1 ? `Safe <& é€\ue000😀${invalidXml}` : '"><script>alert(1)</script>';
			},
			get idPrefix() {
				prefixReads += 1;
				return prefixReads === 1 ? 'x" onload="alert' : '"><script>';
			}
		} as CompileSchematicOptions;
		const html = renderSchematic(document, volatileOptions);
		expect({ boundsReads, widthReads, heightReads, titleReads, prefixReads }).toEqual({
			boundsReads: 1,
			widthReads: 1,
			heightReads: 1,
			titleReads: 1,
			prefixReads: 1
		});
		expect(html).toContain('<title id="x--onload--alert-title">Safe &lt;&amp; é€\ue000😀');
		expect(html).toContain('A\té€\ue000😀');
		expect(html).toContain('\ufffd');
		expect(
			Array.from(html).filter((character) => {
				const codePoint = character.codePointAt(0) ?? 0;
				return (
					codePoint <= 0x08 ||
					codePoint === 0x0b ||
					codePoint === 0x0c ||
					(codePoint >= 0x0e && codePoint <= 0x1f) ||
					codePoint === 0xfffe ||
					codePoint === 0xffff
				);
			})
		).toEqual([]);
		expect(html).not.toContain('onload="');
		expect(html).not.toContain('<script>');
	});

	test('rejects malformed options and revalidates geometry against the render viewBox', () => {
		const document = parseSchematic('resistor:R1 "R" at (200, 100) #amber', {
			bounds: { width: 400, height: 240 },
			title: 'Parsed'
		});
		const invalidOptions: unknown[] = [
			undefined,
			null,
			{},
			{ bounds: null, title: 'x' },
			{ bounds: '100x100', title: 'x' },
			{ bounds: { width: '100', height: 100 }, title: 'x' },
			{ bounds: { width: 100.5, height: 100 }, title: 'x' },
			{ bounds: { width: 100, height: '100' }, title: 'x' },
			{ bounds: { width: 100, height: 100.5 }, title: 'x' },
			{ bounds: { width: 63, height: 100 }, title: 'x' },
			{ bounds: { width: 100, height: 63 }, title: 'x' },
			{ bounds: { width: 4097, height: 100 }, title: 'x' },
			{ bounds: { width: 100, height: 4097 }, title: 'x' },
			{ bounds: { width: 400, height: 240 }, title: 10 },
			{ bounds: { width: 400, height: 240 }, title: '   ' },
			{ bounds: { width: 400, height: 240 }, title: 'x'.repeat(513) },
			{ bounds: { width: 400, height: 240 }, title: 'x', idPrefix: 10 },
			{ bounds: { width: 400, height: 240 }, title: 'x', idPrefix: 'x'.repeat(129) },
			{ bounds: { width: 400, height: 240 }, title: 'x', mode: true },
			{ bounds: { width: 400, height: 240 }, title: 'x', mode: 'interactive' }
		];
		for (const options of invalidOptions) {
			expect(() => renderSchematic(document, options as CompileSchematicOptions)).toThrow();
		}
		expect(() =>
			renderSchematic(document, {
				bounds: { width: 100, height: 100 },
				title: 'Smaller render surface'
			})
		).toThrow(/geometry exceeds the declared 100x100 bounds/);
	});

	test('aborts incremental rendering before exceeding the bounded SVG output budget', () => {
		const writer = new BoundedSvgWriter();
		const allocation = 'x'.repeat(MAX_SVG_OUTPUT_BYTES - 1);
		writer.append(allocation);
		expect(() => writer.append('é')).toThrow(/2,097,152 byte output limit/);
		writer.append('x');
		expect(writer.finish()).toBe(allocation + 'x');
	});
});
