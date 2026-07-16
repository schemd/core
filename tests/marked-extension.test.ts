/** Marked adapter compatibility, resource-budget, output-mode, and fallback verification. */
import { Marked } from 'marked';
import { describe, expect, test, vi } from 'vitest';
import {
	MAX_SCHEMATIC_COMPONENTS,
	MAX_SCHEMATIC_CONNECTIONS,
	MAX_SCHEMATIC_SOURCE_CHARACTERS,
	MAX_SCHEMATIC_SVG_OUTPUT_BYTES,
	parseSchematic,
	parseSchematicFence,
	renderSchematic,
	schematicMarkedExtension,
	SCHEMATIC_LIMITS,
	type SchematicSyntaxError
} from '../src/index.js';

const source = `\`\`\`schemd bounds="320x160" title="Signal path"
resistor:R1 "10k" at (80, 80) #amber
capacitor:C1 "100nF" at (220, 80) #blue
R1.out -> C1.in #slate
\`\`\``;

const consolidatedSource = `\`\`\`schemd bounds="1000x600" title="Bounded mixed-signal system"
port:INPUT "Sensor bus" at (60, 100) #slate
resistor:R1 "10k" at (160, 100) #amber
capacitor:C1 "100nF" at (260, 100) rgb(22 132 196)
inductor:L1 "22uH" at (360, 100) #blue
diode:D1 "Clamp" at (460, 100) #cyan [type=zener]
transistor:Q1 "Switch" at (580, 100) #phosphor [type=nmos]
ground:GND "Signal ground" at (580, 210) #slate [style=signal]
and:G1 "Voter" at (180, 350) #cyan [inputs=3 outputs=2 standard=ieee]
ic:U1 "Mux" at (500, 470) #blue [left="S0,S1,EN" right="Y0,Y1" top="VCC" bottom="GND"]
hadamard:H1 "H" at (680, 350) #purple
cnot:CX1 "CNOT" at (800, 350) #quantum-optical
qgate:RZ1 "RZ" at (920, 350) hsl(278deg 72% 48%) [phase="pi/4"]
INPUT.out -> R1.in #slate [line]
R1.out -> C1.in #amber [ortho]
C1.out -> L1.in #blue [bezier]
L1.out -> D1.anode #cyan
D1.cathode -> Q1.gate #phosphor [ortho]
Q1.source -> GND.in #slate
G1.out2 -> U1.S0 #emerald [ortho]
U1.Y1 -> H1.in #quantum-optical [bezier]
H1.out -> CX1.control #purple
CX1.target -> RZ1.in rgba(142 56 213 / 90%) [bezier]
\`\`\``;

const vectorMatrixSource = `\`\`\`schemd bounds="1600x900" title="Complete vector matrix"
resistor:R1 "R" at (100, 100) #amber
capacitor:C1 "C" at (220, 100) #blue
inductor:L1 "L" at (340, 100) #cyan
diode:D0 "Standard" at (500, 100) #slate
diode:D1 "Schottky" at (620, 100) #slate [type=schottky]
diode:D2 "Zener" at (740, 100) #slate [type=zener]
diode:D3 "LED" at (860, 100) #slate [type=led]
transistor:Q1 "NPN" at (1020, 100) #emerald [type=npn]
transistor:Q2 "PNP" at (1140, 100) #emerald [type=pnp]
transistor:Q3 "NMOS" at (1260, 100) #emerald [type=nmos]
transistor:Q4 "PMOS" at (1380, 100) #emerald [type=pmos]
port:P1 "Boundary" at (100, 300) #slate
ground:G1 "Signal" at (240, 300) #slate [style=signal]
ground:G2 "Earth" at (360, 300) #slate [style=earth]
ground:G3 "Chassis" at (480, 300) #slate [style=chassis]
and:A1 "AND" at (660, 300) #cyan [standard=ieee]
nand:N1 "NAND" at (780, 300) #cyan [standard=iec]
or:O1 "OR" at (900, 300) #cyan [standard=ieee]
nor:NO1 "NOR" at (1020, 300) #cyan [standard=iec]
xor:X1 "XOR" at (1140, 300) #cyan [standard=ieee]
not:INV1 "NOT" at (1260, 300) #cyan [standard=iec]
hadamard:H1 "H" at (1380, 300) #purple
cnot:CX1 "CNOT" at (1380, 480) #purple
qgate:QG1 "RX" at (1220, 480) #quantum [parameter="theta" matrix="X" phase="pi"]
ic:U1 "Flight computer" at (700, 650) #blue [left="A0,A1,A2" right="Y0,Y1" top="VCC,CLK" bottom="GND,RESET"]
\`\`\``;

function schematicFence(body: string, bounds = '320x160'): string {
	return `\`\`\`schemd bounds="${bounds}"\n${body}\n\`\`\``;
}

function paddedSchematicBody(length: number, id: string): string {
	const declaration = `resistor:${id} "R" at (160, 80) #amber`;
	const separator = '\n//';
	if (declaration.length + separator.length > length) {
		throw new RangeError('The requested fixture length is too small.');
	}
	return declaration + separator + 'x'.repeat(length - declaration.length - separator.length);
}

function componentBody(count: number, prefix: string): string {
	return Array.from(
		{ length: count },
		(_, index) => `resistor:${prefix}${index} "R" at (160, 80) #amber`
	).join('\n');
}

function connectionBody(count: number): string {
	return [
		'resistor:R1 "R" at (160, 80) #amber',
		...Array.from({ length: count }, () => 'R1.out -> R1.in #slate')
	].join('\n');
}

describe('schematicMarkedExtension', () => {
	test('compiles inline SVG through Marked and leaves all other fences untouched', () => {
		const marked = new Marked();
		marked.use(schematicMarkedExtension());
		const html = marked.parse(
			`${source}\n\n\`\`\`typescript\nconst ready = true;\n\`\`\``
		) as string;
		expect(html).toContain('<svg class="schematic-svg"');
		expect(html).toContain('id="schematic-1-title"');
		expect(html).toContain('<code class="language-typescript">');
		expect(html).not.toContain('schematic-glow-filter');
		expect(html).not.toContain('data-node-id');
	});

	test('resets deterministic IDs for every document render', () => {
		const marked = new Marked();
		marked.use(schematicMarkedExtension());
		expect(marked.parse(source)).toContain('id="schematic-1-title"');
		expect(marked.parse(source)).toContain('id="schematic-1-title"');
	});

	test('assigns collision-safe interactive IDs to repeated diagrams in one document', () => {
		const marked = new Marked();
		marked.use(schematicMarkedExtension({ mode: 'full' }));
		const html = marked.parse(`${source}\n\n${source}`) as string;
		expect(html).toContain('id="schematic-1-schematic-glow-filter"');
		expect(html).toContain('id="schematic-2-schematic-glow-filter"');
		expect(html).toContain('href="#schematic-1-node-0-vector"');
		expect(html).toContain('href="#schematic-2-node-0-vector"');
	});

	test('exports one immutable source of truth for every compiler budget', () => {
		expect(SCHEMATIC_LIMITS).toEqual({
			sourceCharacters: 131_072,
			components: 512,
			connections: 2_048,
			svgOutputBytes: 2_097_152
		});
		expect(Object.isFrozen(SCHEMATIC_LIMITS)).toBe(true);
		expect(MAX_SCHEMATIC_SOURCE_CHARACTERS).toBe(SCHEMATIC_LIMITS.sourceCharacters);
		expect(MAX_SCHEMATIC_COMPONENTS).toBe(SCHEMATIC_LIMITS.components);
		expect(MAX_SCHEMATIC_CONNECTIONS).toBe(SCHEMATIC_LIMITS.connections);
		expect(MAX_SCHEMATIC_SVG_OUTPUT_BYTES).toBe(SCHEMATIC_LIMITS.svgOutputBytes);
	});

	test('enforces the cumulative schematic source budget without limiting prose or plain fences', () => {
		const marked = new Marked();
		marked.use(schematicMarkedExtension());
		const half = MAX_SCHEMATIC_SOURCE_CHARACTERS / 2;
		const exactDocument = [
			schematicFence(paddedSchematicBody(half, 'R1')),
			schematicFence(paddedSchematicBody(half, 'R2'))
		].join('\n\n');
		const exactHtml = marked.parse(exactDocument) as string;
		expect(exactHtml.match(/class="schematic-component"/g)).toHaveLength(2);
		expect(exactHtml).not.toContain('cumulative');

		const overBudgetHtml = marked.parse(
			`${exactDocument}\n\n${schematicFence('resistor:R3 "R" at (160, 80) #amber')}\n\n${schematicFence('resistor:R4 "R" at (160, 80) #amber')}`
		) as string;
		expect(overBudgetHtml.match(/class="schematic-component"/g)).toHaveLength(2);
		expect(
			overBudgetHtml.match(/cumulative 131,072 schematic source character limit/g)
		).toHaveLength(2);

		const prose = 'Flight-control prose. '.repeat(8_000);
		const proseHtml = marked.parse(
			`${prose}\n\n\`\`\`typescript\nconst stable = true;\n\`\`\`\n\n${schematicFence('resistor:R5 "R" at (160, 80) #amber')}`
		) as string;
		expect(prose.length).toBeGreaterThan(MAX_SCHEMATIC_SOURCE_CHARACTERS);
		expect(proseHtml).toContain('<code class="language-typescript">');
		expect(proseHtml).toContain('id="schematic-1-title"');

		expect(marked.parse('```\nplain code\n```')).toContain('<code>plain code');
	});

	test('enforces and latches the cumulative component budget across fences', () => {
		const observed: SchematicSyntaxError[] = [];
		const onError = vi.fn((error: SchematicSyntaxError) => {
			observed.push(error);
			return '<p data-budget-error>component budget held</p>';
		});
		const marked = new Marked();
		marked.use(schematicMarkedExtension({ onError }));
		const html = marked.parse(
			[
				schematicFence(componentBody(256, 'A')),
				schematicFence(componentBody(256, 'B')),
				schematicFence(componentBody(1, 'C')),
				schematicFence('not valid')
			].join('\n\n')
		) as string;

		expect(html.match(/class="schematic-component"/g)).toHaveLength(MAX_SCHEMATIC_COMPONENTS);
		expect(html.match(/data-budget-error/g)).toHaveLength(2);
		expect(onError).toHaveBeenCalledTimes(2);
		expect(observed[0]?.message).toContain('cumulative 512 component limit');
		expect(observed[1]).toBe(observed[0]);
	});

	test('enforces the cumulative connection budget and resets it for the next parse', () => {
		const marked = new Marked();
		marked.use(schematicMarkedExtension());
		const html = marked.parse(
			[
				schematicFence(connectionBody(MAX_SCHEMATIC_CONNECTIONS / 2)),
				schematicFence(connectionBody(MAX_SCHEMATIC_CONNECTIONS / 2)),
				schematicFence(connectionBody(1))
			].join('\n\n')
		) as string;

		expect(html).toContain('schematic-trace');
		expect(html).toContain('cumulative 2,048 connection limit');
		const resetHtml = marked.parse(schematicFence(connectionBody(1))) as string;
		expect(resetHtml).toContain('id="schematic-1-title"');
		expect(resetHtml).toContain('schematic-trace');
	});

	test('enforces the aggregate UTF-8 SVG output budget before returning another diagram', () => {
		const body = 'resistor:R1 "R" at (160, 80) #amber';
		const fence = parseSchematicFence('schemd bounds="320x160"');
		if (!fence) throw new Error('Expected a schematic fence fixture.');
		const document = parseSchematic(body, fence);
		const encoder = new TextEncoder();
		let expectedBytes = 0;
		let diagramCount = 0;
		while (expectedBytes <= MAX_SCHEMATIC_SVG_OUTPUT_BYTES) {
			diagramCount += 1;
			expectedBytes += encoder.encode(
				renderSchematic(document, { ...fence, idPrefix: `schematic-${diagramCount}` })
			).byteLength;
		}
		expect(diagramCount).toBeGreaterThan(MAX_SCHEMATIC_COMPONENTS);
		expectedBytes = 0;
		diagramCount = 0;
		while (expectedBytes <= MAX_SCHEMATIC_SVG_OUTPUT_BYTES) {
			diagramCount += 1;
			expectedBytes += encoder.encode(
				renderSchematic(document, {
					...fence,
					idPrefix: `schematic-${diagramCount}`,
					mode: 'full'
				})
			).byteLength;
		}
		expect(diagramCount).toBeLessThanOrEqual(MAX_SCHEMATIC_COMPONENTS);

		const errors: SchematicSyntaxError[] = [];
		const marked = new Marked();
		marked.use(
			schematicMarkedExtension({
				mode: 'full',
				onError(error) {
					errors.push(error);
					return '<p data-output-budget-error>SVG budget held</p>';
				}
			})
		);
		const html = marked.parse(
			Array.from({ length: diagramCount + 1 }, () => schematicFence(body)).join('\n\n')
		) as string;

		expect(html.match(/<svg class="schematic-svg"/g)).toHaveLength(diagramCount - 1);
		expect(html.match(/data-output-budget-error/g)).toHaveLength(2);
		expect(errors[0]?.message).toContain('cumulative 2,097,152 compiled SVG byte limit');
		expect(errors[1]).toBe(errors[0]);
	});

	test('compiles the consolidated analog, IC, classical, and quantum grammar on the server', () => {
		const marked = new Marked();
		marked.use(schematicMarkedExtension({ mode: 'full' }));
		const html = marked.parse(consolidatedSource) as string;

		expect(globalThis).not.toHaveProperty('document');
		expect(html).toContain('width="1000" height="600"');
		for (const kind of [
			'port',
			'resistor',
			'capacitor',
			'inductor',
			'diode',
			'transistor',
			'ground',
			'and',
			'ic',
			'hadamard',
			'cnot',
			'qgate'
		]) {
			expect(html).toContain(`data-node-kind="${kind}"`);
		}
		expect(html).toContain('schematic-color--phosphor');
		expect(html).toContain('schematic-color--quantum-optical');
		expect(html).toContain('schematic-trace');
	});

	test('renders every analog specialization and gate contour through the Marked boundary', () => {
		const marked = new Marked();
		marked.use(schematicMarkedExtension({ mode: 'full' }));
		const html = marked.parse(vectorMatrixSource) as string;

		expect(html).toContain('Complete vector matrix');
		expect(html).toContain('25 components and 0 signal connections.');
		for (const metadata of [
			'standard',
			'schottky',
			'zener',
			'led',
			'npn',
			'pnp',
			'nmos',
			'pmos',
			'signal',
			'earth',
			'chassis',
			'9 pins'
		]) {
			expect(html).toContain(metadata);
		}
		expect(html).toContain('schematic-pin-label');
		expect(html).toContain('schematic-quantum-detail');
		expect(html).not.toContain('M M');
	});

	test('renders safe diagnostics for invalid source and supports a custom error observer', () => {
		const standard = new Marked();
		standard.use(schematicMarkedExtension());
		const fallback = standard.parse(
			'```schemd bounds="320x160"\nresistor:R1 "<bad>" at (80, 80) url(javascript:alert(1))\n```'
		) as string;
		expect(fallback).toContain('schematic-error');
		expect(fallback).toContain('&lt;bad&gt;');
		expect(fallback).toContain('Unsafe or unsupported color');
		const geometryFallback = standard.parse(
			'```schemd bounds="100x100"\nresistor:R1 "edge" at (10, 50) #amber\n```'
		) as string;
		expect(geometryFallback).toContain('geometry exceeds the declared 100x100 bounds');

		const onError = vi.fn(() => '<p data-observed>invalid</p>');
		const observed = new Marked();
		observed.use(schematicMarkedExtension({ onError }));
		expect(observed.parse('```schemd\ninvalid\n```')).toContain('data-observed');
		expect(onError).toHaveBeenCalledOnce();
	});

	test('reserves the complete eight-pixel hotspot at both route boundaries', () => {
		const marked = new Marked();
		marked.use(schematicMarkedExtension({ mode: 'full' }));
		const html = marked.parse(`\`\`\`schemd bounds="200x100"
resistor:R1 "left" at (46, 50) #amber
capacitor:C1 "right" at (154, 50) #blue
R1.in -> C1.out #slate
\`\`\``) as string;
		expect(html).toContain('d="M 4 50 L 196 50"');
		expect(html).toContain('stroke-width="8" vector-effect="non-scaling-stroke"');
	});

	test('uses a configured default title', () => {
		const marked = new Marked();
		marked.use(schematicMarkedExtension({ defaultTitle: 'System interconnect' }));
		const html = marked.parse(
			'```schemd bounds="320x160"\nresistor:R1 "10k" at (80, 80) #amber\n```'
		) as string;
		expect(html).toContain('<title id="schematic-1-title">System interconnect</title>');
	});

	test('does not mask unexpected integration failures', () => {
		const marked = new Marked();
		const options = Object.defineProperty({}, 'defaultTitle', {
			get(): never {
				throw new Error('unexpected');
			}
		});
		marked.use(schematicMarkedExtension(options));
		expect(() => marked.parse('```schemd bounds="320x160"\ninvalid\n```')).toThrow('unexpected');
	});
});
