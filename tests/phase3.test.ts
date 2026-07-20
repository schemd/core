import { describe, expect, test } from 'vitest';
import {
	CLASSICAL_GATE_KINDS,
	COMPONENT_KINDS,
	DIGITAL_COMPONENT_KINDS,
	ELECTRICAL_COMPONENT_KINDS,
	NAMED_QUANTUM_GATE_KINDS,
	QUANTUM_SPECIAL_KINDS,
	SCHEMATIC_ORIENTATIONS,
	compileSchematic,
	componentObstacleRectangle,
	componentRectangle,
	componentTextAnchors,
	enumerateComponentPorts,
	parseSchematic,
	renderSchematic,
	resolvePortGeometry,
	resolvePortPoint,
	type SchematicComponent,
	type SchematicFence
} from '../src/index.js';

const fence: SchematicFence = {
	bounds: { width: 4096, height: 4096 },
	title: 'Phase three torture fixture'
};

function error(source: string, pattern: RegExp): void {
	expect(() => parseSchematic(source, fence)).toThrow(pattern);
}

function two(source: string, connection: string): ReturnType<typeof parseSchematic> {
	return parseSchematic(`${source}\n${connection}`, fence);
}

describe('exhaustive quarter-turn integration', () => {
	const directional = [
		'resistor:R "R" at (300,300) #amber',
		'capacitor:C "C" at (300,300) #amber [type=polarized]',
		'inductor:L "L" at (300,300) #amber [type=transformer]',
		'diode:D "D" at (300,300) #amber [type=photodiode]',
		'transistor:T "T" at (300,300) #amber [type=nigbt]',
		'port:P "P" at (300,300) #amber',
		'ground:G "G" at (300,300) #amber',
		'source:S "S" at (300,300) #amber [type=vcvs]',
		'connector:K "K" at (300,300) #amber',
		'power:V "V" at (300,300) #amber',
		'switch:SW "SW" at (300,300) #amber [type=relay]',
		'protection:F "F" at (300,300) #amber',
		'amplifier:A "A" at (300,300) #amber',
		'resonator:X "X" at (300,300) #amber',
		'meter:M "M" at (300,300) #amber',
		'load:LD "LD" at (300,300) #amber [type=motor]',
		'and:AND "AND" at (300,300) #cyan',
		'buffer:B "B" at (300,300) #cyan [type=tristate]',
		'flipflop:FF "FF" at (300,300) #cyan [type=t]',
		'bus:BUS "BUS" at (300,300) #cyan [type=joiner width=8]',
		'hadamard:H "H" at (300,300) #purple',
		'cnot:CX "CX" at (300,300) #purple',
		'qgate:Q "Q" at (300,300) #purple [parameter="θ"]',
		'measure:ME "ME" at (300,300) #purple',
		'controlled:CG "CG" at (300,300) #purple [controls=2 targets=2 control=classical operator="Z"]',
		'ic:U "U" at (300,300) #cyan [left="a" right="b" top="c" bottom="d"]'
	] as const;

	test('renders every supported orientation with upright outer labels and finite metadata', () => {
		for (const declaration of directional) {
			for (const orientation of SCHEMATIC_ORIENTATIONS) {
				const normalized = declaration.includes('[')
					? declaration.replace(/]$/, ` orientation=${orientation}]`)
					: `${declaration} [orientation=${orientation}]`;
				const document = parseSchematic(normalized, fence);
				const svg = renderSchematic(document, { ...fence, mode: 'full' });
				const degrees = orientation === 'right' ? 0 : orientation === 'down' ? 90 : orientation === 'left' ? 180 : 270;
				if (degrees === 0) expect(svg).not.toContain('transform="rotate(0)"');
				else expect(svg).toContain(`transform="rotate(${degrees})"`);
				expect(svg).toContain(`data-orientation="${orientation}"`);
				expect(svg).not.toMatch(/NaN|Infinity|transform="[^"]*-0/);
				expect(svg.indexOf('<text class="schematic-designator"')).toBeGreaterThan(svg.indexOf('schematic-component-vector'));
			}
		}
	});

	test('rotates exact points and outward normals without semantic port renaming', () => {
		const expected = {
			right: [{ x: 258, y: 300 }, { x: -1, y: 0 }],
			down: [{ x: 300, y: 258 }, { x: 0, y: -1 }],
			left: [{ x: 342, y: 300 }, { x: 1, y: 0 }],
			up: [{ x: 300, y: 342 }, { x: 0, y: 1 }]
		} as const;
		for (const orientation of SCHEMATIC_ORIENTATIONS) {
			const component = parseSchematic(`resistor:R "R" at (300,300) #amber [orientation=${orientation}]`, fence).components[0]!;
			const geometry = resolvePortGeometry(component, 'in');
			expect(geometry.point).toEqual(expected[orientation][0]);
			expect(geometry.normal).toEqual(expected[orientation][1]);
			expect(Object.is(geometry.point.x, -0) || Object.is(geometry.point.y, -0)).toBe(false);
		}
	});

	test('swaps physical obstacle axes and terminates routes on rotated ports', () => {
		const right = parseSchematic('amplifier:A "A" at (300,300) #cyan [orientation=right]', fence).components[0]!;
		const down = parseSchematic('amplifier:A "A" at (300,300) #cyan [orientation=down]', fence).components[0]!;
		const rightBox = componentObstacleRectangle(right, 0);
		const downBox = componentObstacleRectangle(down, 0);
		expect(rightBox.maxX - rightBox.minX).toBe(downBox.maxY - downBox.minY);
		expect(rightBox.maxY - rightBox.minY).toBe(downBox.maxX - downBox.minX);

		const document = two(
			'resistor:R1 "R1" at (300,300) #amber [orientation=down]\nresistor:R2 "R2" at (300,600) #amber [orientation=up]',
			'R1.out -> R2.in #blue [ortho]'
		);
		const svg = renderSchematic(document, fence);
		expect(resolvePortPoint(document.components[0]!, 'out')).toEqual({ x: 300, y: 342 });
		expect(resolvePortPoint(document.components[1]!, 'in')).toEqual({ x: 300, y: 642 });
		expect(svg).toContain('M 300 342');
		expect(svg).toContain('V 642');
	});

	test('keeps omitted orientation byte-identical to the explicit right-facing default', () => {
		const implicit = parseSchematic('resistor:R "R" at (300,300) #amber', fence);
		const explicit = parseSchematic('resistor:R "R" at (300,300) #amber [orientation=right]', fence);
		expect(renderSchematic(implicit, { ...fence, idPrefix: 'compat' })).toBe(
			renderSchematic(explicit, { ...fence, idPrefix: 'compat' })
		);
	});

	test('keeps exact body AABBs and upright text anchors through every quarter turn', () => {
		const expected = {
			right: {
				obstacle: { minX: 258, minY: 282, maxX: 342, maxY: 318 },
				bounds: { minX: 254, minY: 260, maxX: 346, maxY: 342 },
				anchors: { designatorY: -28, labelY: 37, designatorWidth: 7, labelWidth: 7 }
			},
			down: {
				obstacle: { minX: 282, minY: 258, maxX: 318, maxY: 342 },
				bounds: { minX: 282, minY: 236, maxX: 318, maxY: 366 },
				anchors: { designatorY: -52, labelY: 61, designatorWidth: 7, labelWidth: 7 }
			},
			left: {
				obstacle: { minX: 258, minY: 282, maxX: 342, maxY: 318 },
				bounds: { minX: 254, minY: 260, maxX: 346, maxY: 342 },
				anchors: { designatorY: -28, labelY: 37, designatorWidth: 7, labelWidth: 7 }
			},
			up: {
				obstacle: { minX: 282, minY: 258, maxX: 318, maxY: 342 },
				bounds: { minX: 282, minY: 236, maxX: 318, maxY: 366 },
				anchors: { designatorY: -52, labelY: 61, designatorWidth: 7, labelWidth: 7 }
			}
		} as const;
		for (const orientation of SCHEMATIC_ORIENTATIONS) {
			const component = parseSchematic(`resistor:R "R" at (300,300) #amber [orientation=${orientation}]`, fence).components[0]!;
			expect(componentObstacleRectangle(component, 0)).toEqual(expected[orientation].obstacle);
			expect(componentRectangle(component)).toEqual(expected[orientation].bounds);
			expect(componentTextAnchors(component)).toEqual(expected[orientation].anchors);
		}
	});

	test('accepts exact text-aware placement on all four viewBox boundaries', () => {
		const center = parseSchematic('resistor:R "edge" at (300,300) #amber', fence).components[0]!;
		const box = componentRectangle(center);
		const offsets = {
			left: { x: 300 - box.minX, y: 300 },
			right: { x: 800 - (box.maxX - 300), y: 300 },
			top: { x: 300, y: 300 - box.minY },
			bottom: { x: 300, y: 800 - (box.maxY - 300) }
		};
		const edgeFence = { bounds: { width: 800, height: 800 }, title: 'Edges' };
		for (const point of Object.values(offsets)) {
			const document = parseSchematic(`resistor:R "edge" at (${point.x},${point.y}) #amber`, edgeFence);
			const rectangle = componentRectangle(document.components[0]!);
			expect(rectangle.minX).toBeGreaterThanOrEqual(0);
			expect(rectangle.minY).toBeGreaterThanOrEqual(0);
			expect(rectangle.maxX).toBeLessThanOrEqual(800);
			expect(rectangle.maxY).toBeLessThanOrEqual(800);
		}
	});
});

describe('strict parser and semantic-port rejection matrix', () => {
	test('rejects every invalid orientation, width, fixed count, and family option', () => {
		for (const width of ['0', '257', 'x']) error(`port:P "P" at (100,100) #cyan [width=${width}]`, /width/);
		error('resistor:R "R" at (100,100) #amber [orientation=north]', /orientation/);
		error('junction:J "J" at (100,100) #amber [orientation=up]', /Option orientation/);
		error('logic:L "L" at (100,100) #cyan [inputs=1]', /does not accept inputs/);
		error('clock:C "C" at (100,100) #cyan [inputs=1]', /does not accept inputs/);
		error('buffer:B "B" at (100,100) #cyan [width=8]', /Option width/);
		error('bus:B "B" at (100,100) #cyan [width=1]', /at least 2/);
		error('clock:C "C" at (100,100) #cyan [type=falling]', /Option type/);
		error('buffer:B "B" at (100,100) #cyan [inputs=2]', /fixed terminal/);
		error('buffer:B "B" at (100,100) #cyan [outputs=2]', /fixed terminal/);
		error('logic:L "L" at (100,100) #cyan [outputs=2]', /fixed terminal/);
		error('clock:C "C" at (100,100) #cyan [outputs=2]', /fixed terminal/);
		error('classical-register:C "C" at (100,100) #slate [width=1]', /at least 2/);
	});

	test('normalizes dynamic digital defaults while preserving explicit counts', () => {
		const source = `adder:A "A" at (100,100) #cyan [type=full]
mux:M "M" at (300,100) #cyan [type=demux]
mux:MX "MX" at (500,100) #cyan [type=demux inputs=2 outputs=3]
bus:B "B" at (700,100) #cyan [type=joiner width=8]
bus:BX "BX" at (900,100) #cyan [type=joiner width=8 outputs=3]`;
		const components = parseSchematic(source, fence).components;
		expect(components[0]).toMatchObject({ inputs: 3, outputs: 2 });
		expect(components[1]).toMatchObject({ inputs: 1, outputs: 2 });
		expect(components[2]).toMatchObject({ inputs: 2, outputs: 3 });
		expect(components[3]).toMatchObject({ outputs: 1 });
		expect(components[4]).toMatchObject({ outputs: 3 });
	});

	test('rejects quantum options on incompatible non-unitary structures', () => {
		for (const option of ['control=negative', 'operator="X"', 'controls=2', 'targets=2', 'wires=2', 'width=2']) {
			error(`reset:R "R" at (100,100) #purple [${option}]`, /not supported/);
		}
		error('control:C "C" at (100,100) #purple [control=invalid]', /Option control/);
	});

		test('validates every specialized digital and quantum semantic port', () => {
		const valid = [
			'buffer:B "B" at (100,100) #cyan [type=tristate]\nport:P "P" at (400,100) #cyan\nB.enable -> P.in #cyan',
			'flipflop:F "F" at (100,100) #cyan [type=jk]\nport:P "P" at (400,100) #cyan\nF.j -> P.in #cyan',
			'mux:M "M" at (100,100) #cyan\nport:P "P" at (400,100) #cyan\nM.select -> P.in #cyan',
			'register:R "R" at (100,100) #cyan\nport:P "P" at (400,100) #cyan\nR.clock -> P.in #cyan',
			'counter:C "C" at (100,100) #cyan\nport:P "P" at (400,100) #cyan\nC.clear -> P.in #cyan',
			'comparator:C "C" at (100,100) #cyan\nport:P "P" at (400,100) #cyan\nC.gt -> P.in #cyan',
			'encoder:E "E" at (100,100) #cyan\nport:P "P" at (400,100) #cyan\nE.in -> P.in #cyan',
			'encoder:E "E" at (100,100) #cyan\nport:P "P" at (400,100) #cyan\nE.out -> P.in #cyan',
			'encoder:E "E" at (100,100) #cyan\nport:P "P" at (400,100) #cyan\nE.in1 -> P.in #cyan',
			'encoder:E "E" at (100,100) #cyan\nport:P "P" at (400,100) #cyan\nE.out1 -> P.in #cyan',
			'mux:M "M" at (100,100) #cyan\nport:P "P" at (400,100) #cyan\nM.enable -> P.in #cyan',
			'bus:B "B" at (100,100) #cyan [type=tap width=8]\nport:P "P" at (400,100) #cyan\nB.tap -> P.in #cyan',
			'prepare:Q "Q" at (100,100) #purple\nhadamard:H "H" at (400,100) #purple\nQ.out -> H.in #purple [quantum]',
			'control:Q "Q" at (100,100) #purple\nhadamard:H "H" at (400,100) #purple\nQ.control -> H.in #purple [quantum]',
			'measure:Q "Q" at (100,100) #purple\nclassical-bit:C "C" at (400,100) #slate\nQ.classical -> C.in #slate [classical]',
			'controlled:Q "Q" at (100,100) #purple [controls=2 targets=2]\nhadamard:H "H" at (400,100) #purple\nQ.control2 -> H.in #purple [quantum]',
			'controlled:Q "Q" at (100,100) #purple [controls=2 targets=2]\nhadamard:H "H" at (400,100) #purple\nQ.target2 -> H.in #purple [quantum]'
		];
		for (const source of valid) expect(parseSchematic(source, fence).connections).toHaveLength(1);

		const swap = parseSchematic('swap:S "S" at (100,100) #purple', fence).components[0]!;
		// Quantum tracks distribute edge-to-edge: the two swap rails sit a full
		// 18-unit pitch apart (y = 91 and 109), so the ×—× reads as a swap, not a star.
		expect(resolvePortPoint(swap, 'in')).toEqual({ x: 58, y: 91 });
		expect(resolvePortPoint(swap, 'in2')).toEqual({ x: 58, y: 109 });
		// The rendered crosses must land on those two rails (local ±9), a full pitch
		// apart — never overlapped into a single star at the glyph centre.
		const swapSvg = renderSchematic(
			parseSchematic('swap:S "S" at (100,100) #purple', fence),
			{ ...fence, mode: 'full' }
		);
		expect(swapSvg).toContain('d="M -6 -15 L 6 -3 M 6 -15 L -6 -3"');
		expect(swapSvg).toContain('d="M -6 3 L 6 15 M 6 3 L -6 15"');
		const latch = parseSchematic('flipflop:F "F" at (100,100) #cyan [type=sr-latch]', fence).components[0]!;
		expect(enumerateComponentPorts(latch).map(({ id }) => id)).toContain('enable');

		for (const [declaration, port] of [
			['encoder:E "E" at (100,100) #cyan', 'enable'],
			['logic:E "E" at (100,100) #cyan', 'in'],
			['buffer:B "B" at (100,100) #cyan', 'enable'],
			['prepare:Q "Q" at (100,100) #purple', 'in'],
			['control:Q "Q" at (100,100) #purple', 'target'],
			['measure:Q "Q" at (100,100) #purple', 'target'],
			['classical-bit:Q "Q" at (100,100) #slate', 'control1'],
			['controlled:Q "Q" at (100,100) #purple [controls=1 targets=1]', 'control2'],
			['controlled:Q "Q" at (100,100) #purple [controls=1 targets=1]', 'target2']
		] as const) {
			error(`${declaration}\nport:P "P" at (400,100) #cyan\n${declaration.split(':')[1]!.split(' ')[0]}.${port} -> P.in #cyan`, /invalid/);
		}
	});

	test('parses signal shorthands, detects duplicates, and derives new UML markers', () => {
		const base = 'port:A "A" at (100,100) #cyan\nport:B "B" at (400,100) #cyan';
		for (const signal of ['electrical', 'digital', 'quantum', 'classical']) {
			expect(parseSchematic(`${base}\nA.out -> B.in #cyan [${signal}]`, fence).connections[0]?.signalKind).toBe(signal);
		}
		error(`${base}\nA.out -> B.in #cyan [digital signal=quantum]`, /only be declared once/);
		error(`${base}\nA.out -> B.in #cyan [digital quantum]`, /only be declared once/);
		error(`${base}\nA.out -> B.in #cyan [signal=invalid]`, /signal must/);
		for (const relation of ['synchronous', 'asynchronous', 'return', 'control-flow', 'object-flow', 'assembly', 'delegation']) {
			const connection = parseSchematic(`${base}\nA.out -> B.in #cyan [${relation}]`, fence).connections[0]!;
			expect(connection.relation).toBe(relation);
			if (relation === 'synchronous') expect(connection.markerEnd).toBe('arrow');
			if (relation === 'return') expect(connection.dashed).toBe(true);
		}
	});

	test('enforces family-specific electrical terminals', () => {
		const valid = [
			'source:S "S" at (100,100) #blue [type=vcvs]\nport:P "P" at (400,100) #cyan\nS.control-positive -> P.in #blue',
			'switch:S "S" at (100,100) #blue [type=spdt]\nport:P "P" at (400,100) #cyan\nS.normally-closed -> P.in #blue',
			'switch:S "S" at (100,100) #blue [type=relay]\nport:P "P" at (400,100) #cyan\nS.coil1 -> P.in #blue',
			'amplifier:A "A" at (100,100) #blue\nport:P "P" at (400,100) #cyan\nA.v+ -> P.in #blue',
			'junction:J "J" at (100,100) #blue\nport:P "P" at (400,100) #cyan\nJ.node -> P.in #blue',
			'connector:C "C" at (100,100) #blue\nport:P "P" at (400,100) #cyan\nC.out -> P.in #blue',
			'power:V "V" at (100,100) #blue\nport:P "P" at (400,100) #cyan\nV.in -> P.in #blue',
			'protection:F "F" at (100,100) #blue\nport:P "P" at (400,100) #cyan\nF.out -> P.in #blue',
			'resonator:X "X" at (100,100) #blue\nport:P "P" at (400,100) #cyan\nX.out -> P.in #blue',
			'meter:M "M" at (100,100) #blue\nport:P "P" at (400,100) #cyan\nM.out -> P.in #blue',
			'load:L "L" at (100,100) #blue\nport:P "P" at (400,100) #cyan\nL.out -> P.in #blue'
		];
		for (const source of valid) expect(parseSchematic(source, fence).connections).toHaveLength(1);

		const junction = parseSchematic('junction:J "J" at (100,100) #blue', fence).components[0]!;
		expect(resolvePortGeometry(junction, 'out').normal).toEqual({ x: 1, y: 0 });
		error('source:S "S" at (100,100) #blue\nport:P "P" at (400,100) #cyan\nS.control-positive -> P.in #blue', /invalid/);
		error('switch:S "S" at (100,100) #blue\nport:P "P" at (400,100) #cyan\nS.coil1 -> P.in #blue', /invalid/);
	});

	test('defends the exhaustive component dispatcher against a corrupted runtime catalog', () => {
		Reflect.apply(Array.prototype.push, COMPONENT_KINDS, ['phantom']);
		try {
			error('phantom:P "P" at (100,100) #amber', /Unsupported component kind phantom/);
		} finally {
			Reflect.apply(Array.prototype.pop, COMPONENT_KINDS, []);
		}
	});
});

describe('renderer invariants, reuse, and deterministic bounded fuzzing', () => {
	test('covers every catalog kind in all modes without unused or duplicate IDs', () => {
		const declarations: string[] = [];
		for (const kind of CLASSICAL_GATE_KINDS) declarations.push(`${kind}:C${declarations.length} "${kind}" at (${100 + declarations.length * 110},100) #cyan`);
		for (const kind of DIGITAL_COMPONENT_KINDS) declarations.push(`${kind}:D${declarations.length} "${kind}" at (${100 + (declarations.length % 20) * 180},${300 + Math.floor(declarations.length / 20) * 180}) #cyan${kind === 'bus' ? ' [width=8]' : ''}`);
		for (const kind of NAMED_QUANTUM_GATE_KINDS) declarations.push(`${kind}:Q${declarations.length} "${kind}" at (${100 + (declarations.length % 20) * 180},${600 + Math.floor(declarations.length / 20) * 180}) #purple [parameter="θ"]`);
		for (const kind of QUANTUM_SPECIAL_KINDS) declarations.push(`${kind}:S${declarations.length} "${kind}" at (${100 + (declarations.length % 20) * 180},${900 + Math.floor(declarations.length / 20) * 180}) #purple${kind === 'classical-register' ? ' [width=8]' : ''}`);
		for (const kind of ELECTRICAL_COMPONENT_KINDS) declarations.push(`${kind}:E${declarations.length} "${kind}" at (${100 + (declarations.length % 20) * 180},${1200 + Math.floor(declarations.length / 20) * 180}) #amber`);
		const document = parseSchematic(declarations.join('\n'), fence);
		for (const mode of ['default', 'embedded-css', 'full'] as const) {
			const svg = renderSchematic(document, { ...fence, mode });
			const ids = [...svg.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
			expect(new Set(ids).size).toBe(ids.length);
			expect(svg).not.toMatch(/NaN|Infinity|(?:^|[\s,"])-0(?:\D|$)/);
			expect(new TextEncoder().encode(svg).byteLength).toBeLessThan(2 * 1024 * 1024);
		}
	});

	test('renders specialized branch geometry and accessible metadata', () => {
		const source = `logic:H "high" at (100,100) #cyan [type=high]
logic:L "low" at (250,100) #cyan [type=low]
logic:Z "z" at (400,100) #cyan [type=high-z]
logic:X "x" at (550,100) #cyan [type=unknown]
buffer:BI "bi" at (700,100) #cyan [type=schmitt-inverter]
buffer:BP "bp" at (850,100) #cyan [type=plain]
load:M "motor" at (100,300) #amber [type=motor]
control:N "negative" at (300,300) #purple [control=negative]
control:P "positive" at (500,300) #purple [control=positive]
controlled:CN "negative" at (700,300) #purple [control=negative operator="X"]
controlled:CC "classical" at (900,300) #purple [control=classical operator="Z"]
cz:CZ "CZ" at (1100,300) #purple
cphase:CP "CP" at (1300,300) #purple
history:HS "history" at (1500,300) #slate
entry:EN "entry" at (1700,300) #slate
lost:LO "lost" at (1900,300) #slate`;
		const svg = renderSchematic(parseSchematic(source, fence), { ...fence, mode: 'full' });
		for (const label of ['>1</text>', '>0</text>', '>Z</text>', '>X</text>', '>M</text>', '>H</text>']) expect(svg).toContain(label);
		expect(svg).toContain('width="10" height="10"');
		expect(svg).toContain('aria-label="M, load, motor, motor"');
	});

	test('validates register bus widths and renders the demultiplexer identity', () => {
		for (const declaration of [
			'classical-register:R "R" at (100,100) #slate [width=8]',
			'register:R "R" at (100,100) #cyan [width=8]'
		]) {
			const document = parseSchematic(`${declaration}\nport:P "P" at (400,100) #cyan [width=8]\nR.out -> P.in #cyan [width=8]`, fence);
			expect(document.connections[0]?.width).toBe(8);
		}
		const demux = parseSchematic('mux:M "M" at (100,100) #cyan [type=demux]', fence);
		expect(renderSchematic(demux, fence)).toContain('>DEMUX</text>');
	});

	test('keeps non-default signal domains in compact SVG and symbol reuse amortized', () => {
		const source = `port:A "A" at (100,100) #cyan
port:B "B" at (400,100) #cyan
resistor:R1 "R1" at (100,300) #amber
resistor:R2 "R2" at (300,300) #amber
resistor:R3 "R3" at (500,300) #amber
A.out -> B.in #cyan [digital]`;
		const svg = renderSchematic(parseSchematic(source, fence), fence);
		expect(svg).toContain('schematic-signal--digital');
		expect(svg.match(/id="[^"]+-symbol-resistor"/g)).toHaveLength(1);
		expect(svg.match(/href="#[^"]+-symbol-resistor"/g)).toHaveLength(3);
	});

	test('uses deterministic seeded mixed-domain generation', () => {
		let seed = 0x5c4e6d;
		const next = (): number => {
			seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
			return seed;
		};
		const kinds = ['resistor', 'diode', 'buffer', 'hadamard', 'measure', 'action'] as const;
		const lines: string[] = [];
		for (let index = 0; index < 120; index += 1) {
			const kind = kinds[next() % kinds.length]!;
			const orientation = SCHEMATIC_ORIENTATIONS[next() % 4]!;
			const x = 100 + (index % 20) * 190;
			const y = 100 + Math.floor(index / 20) * 180;
			const rotate = kind === 'action' ? '' : ` [orientation=${orientation}]`;
			lines.push(`${kind}:N${index} "${kind}" at (${x},${y}) #cyan${rotate}`);
		}
		const source = lines.join('\n');
		const first = compileSchematic(source, fence);
		const second = compileSchematic(source, fence);
		expect(first.svg).toBe(second.svg);
		expect(first.metrics).toEqual(second.metrics);
		expect(first.document.components.every((component: SchematicComponent) => enumerateComponentPorts(component).every((port) => Number.isFinite(port.point.x) && Number.isFinite(port.point.y)))).toBe(true);
	});

	test('compiles exact resource ceilings deterministically within the SVG byte budget', () => {
		const components = Array.from(
			{ length: 512 },
			(_, index) => `resistor:R${index} "R" at (${100 + (index % 32) * 120},${100 + Math.floor(index / 32) * 120}) #amber`
		).join('\n');
		const componentResult = compileSchematic(components, fence);
		expect(componentResult.document.components).toHaveLength(512);
		expect(componentResult.metrics.svgBytes).toBeLessThan(2 * 1024 * 1024);

		const connections = [
			'port:A "A" at (100,100) #cyan',
			'port:B "B" at (400,100) #cyan',
			...Array.from({ length: 2_048 }, () => 'A.out -> B.in #cyan [line]')
		].join('\n');
		const first = compileSchematic(connections, fence);
		const second = compileSchematic(connections, fence);
		expect(first.document.connections).toHaveLength(2_048);
		expect(first.metrics.svgBytes).toBeLessThan(2 * 1024 * 1024);
		expect(first.svg).toBe(second.svg);
	});

	test('locks representative generated-SVG byte counts and repeated-symbol amortization', () => {
		const options = { ...fence, idPrefix: 'size-regression' };
		const fixtures = [
			['resistor:R "R" at (100,100) #amber', 1_411],
			[
				'resistor:R1 "R" at (100,100) #amber\nresistor:R2 "R" at (300,100) #amber\nresistor:R3 "R" at (500,100) #amber',
				2_476
			]
		] as const;
		for (const [source, expectedBytes] of fixtures) {
			const svg = renderSchematic(parseSchematic(source, fence), options);
			expect(new TextEncoder().encode(svg).byteLength).toBe(expectedBytes);
		}
	});
});
