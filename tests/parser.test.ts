/** Strict parser grammar, validation, resource-boundary, and AST immutability verification. */
import { describe, expect, test } from 'vitest';
import {
	parseSchematic,
	parseSchematicColor,
	parseSchematicFence,
	SchematicSyntaxError,
	type SchematicFence
} from '../src/index.js';

const fence: SchematicFence = {
	bounds: { width: 640, height: 260 },
	title: 'Signal topology'
};

const expandedFence: SchematicFence = {
	bounds: { width: 1200, height: 600 },
	title: 'Mixed-signal topology'
};

const fullSource = `// classical path\r
resistor:R1 "10k" at (50, 70) #amber
capacitor:C1 "100nF" at (150, 70) #blue
nand:G1 "74HC00" at (260, 100) #cyan
xor:G2 "Parity" at (360, 100) #slate
hadamard:Q1 "H & superposition" at (470, 100) #purple
cnot:Q2 "Entangle" at (570, 100) #emerald

R1.out -> C1.in #slate
C1.out -> G1.in1 #blue
G1.out -> G2.in2 #cyan [bezier]
G2.out -> Q1.in #purple
Q1.out -> Q2.control #emerald`;

describe('parseSchematicFence', () => {
	test('ignores unrelated and absent code-fence info', () => {
		expect(parseSchematicFence(undefined)).toBeUndefined();
		expect(parseSchematicFence('typescript')).toBeUndefined();
	});

	test('parses intrinsic bounds with default and explicit titles', () => {
		expect(parseSchematicFence('schemd bounds="640x260"')).toEqual({
			bounds: { width: 640, height: 260 },
			title: 'Engineering schematic'
		});
		expect(parseSchematicFence('SCHEMD bounds="640x260" title="Quantum path"', 'Fallback')).toEqual(
			{ bounds: { width: 640, height: 260 }, title: 'Quantum path' }
		);
	});

	test('rejects missing metadata and each invalid bounds boundary', () => {
		expect(() => parseSchematicFence('schemd')).toThrow(/require/);
		expect(() => parseSchematicFence('schemd bounds="640x260"', '   ')).toThrow(
			/titles cannot be empty/
		);
		for (const info of [
			'schemd bounds="63x100"',
			'schemd bounds="100x63"',
			'schemd bounds="4097x100"',
			'schemd bounds="100x4097"'
		]) {
			expect(() => parseSchematicFence(info)).toThrow(/64 through 4096/);
		}
		expect(() => parseSchematicFence(`schemd bounds="640x260" title="${'x'.repeat(513)}"`)).toThrow(
			/titles cannot exceed 512/
		);
		expect(() => parseSchematicFence('schemd bounds="640x260"', 'x'.repeat(513))).toThrow(
			/titles cannot exceed 512/
		);
	});
});

describe('parseSchematic', () => {
	test('tokenizes every component, semantic color, port, and path style', () => {
		const document = parseSchematic(fullSource, fence);
		expect(document.components.map(({ kind }) => kind)).toEqual([
			'resistor',
			'capacitor',
			'nand',
			'xor',
			'hadamard',
			'cnot'
		]);
		expect(document.connections).toHaveLength(5);
		expect(document.connections[2]?.curve).toBe('bezier');
		expect(document.connections[0]?.curve).toBe('line');
	});

	test('requires at least one declaration and rejects malformed lines', () => {
		expect(() => parseSchematic('\n// nothing', fence)).toThrow(/at least one component/);
		expect(() => parseSchematic('wire W1', fence)).toThrow(/Line 1: Unrecognized/);
		expect(() => parseSchematic('relay:K1 "Relay" at (100, 100) #amber', fence)).toThrow(
			/Unsupported component kind relay/
		);
	});

	test('rejects duplicate IDs and unsafe color expressions', () => {
		expect(() =>
			parseSchematic(
				'resistor:R1 "one" at (80, 80) #amber\nresistor:R1 "two" at (160, 80) #blue',
				fence
			)
		).toThrow(/Line 2: Duplicate/);
		expect(() =>
			parseSchematic('resistor:R1 "one" at (80, 80) url(javascript:alert(1))', fence)
		).toThrow(/Unsafe or unsupported/);
		expect(() =>
			parseSchematic(
				'resistor:R1 "one" at (80, 80) #amber\nR1.out -> R1.in color(display-p3 1 0 0)',
				fence
			)
		).toThrow(/Unsafe or unsupported/);
	});

	test('parses arbitrary classical gate arity, standards, and universal quantum metadata', () => {
		const document = parseSchematic(
			`and:G1 "Voting logic" at (140, 120) #cyan [inputs=4 outputs=2 standard=iec]
nor:G2 "Reset tree" at (300, 120) rgb(20 80 160 / 75%) [inputs=3 outputs=1 standard=ieee]
not:G3 "Fan-out" at (430, 120) hsl(40deg 90% 50%) [inputs=2 outputs=3]
qgate:Q1 "RZ" at (560, 120) #quantum-accent [parameter="θ/2" matrix="[[1,0],[0,e^iθ]]" phase="π/4"]
G1.out2 -> G2.in3 #bus-primary [bezier]
G2.out -> G3.in2 #slate
G3.out3 -> Q1.in #emerald`,
			fence
		);
		expect(document.components[0]).toMatchObject({
			kind: 'and',
			inputs: 4,
			outputs: 2,
			standard: 'iec'
		});
		expect(document.components[1]?.color).toEqual({
			kind: 'css',
			value: 'rgb(20 80 160 / 75%)'
		});
		expect(document.components[2]).toMatchObject({ inputs: 2, outputs: 3, standard: 'ieee' });
		expect(document.components[3]).toMatchObject({
			kind: 'qgate',
			parameter: 'θ/2',
			matrix: '[[1,0],[0,e^iθ]]',
			phase: 'π/4'
		});
		expect(document.connections[0]).toMatchObject({ curve: 'bezier' });
	});

	test('parses every analog family, subtype, ground style, and route shape', () => {
		const document = parseSchematic(
			`port:P1 "Input" at (70, 180) #amber
inductor:L1 "10uH" at (180, 180) blue
diode:D1 "Flyback" at (290, 180) #cyan [type=led]
transistor:Q1 "Switch" at (410, 180) #purple [type=pmos]
ground:GND "Reference" at (540, 180) #slate [style=earth]
ic:U1 "Mux" at (730, 180) [left="S0,S1,EN" right="Y0,Y1" top="VCC" bottom="VSS"]

P1.out -> L1.left #amber [line]
L1.r -> D1.a #blue [ortho]
D1.k -> Q1.g #cyan [bezier]
Q1.s -> GND.in #slate
U1.in -> U1.out #purple [ortho]`,
			expandedFence
		);

		expect(document.components).toMatchObject([
			{ kind: 'port' },
			{ kind: 'inductor' },
			{ kind: 'diode', diodeType: 'led' },
			{ kind: 'transistor', transistorType: 'pmos' },
			{ kind: 'ground', groundStyle: 'earth' },
			{
				kind: 'ic',
				color: { kind: 'token', value: 'slate' },
				pins: {
					left: ['S0', 'S1', 'EN'],
					right: ['Y0', 'Y1'],
					top: ['VCC'],
					bottom: ['VSS']
				},
				bodyWidth: 88,
				bodyHeight: 78
			}
		]);
		expect(document.connections.map(({ curve }) => curve)).toEqual([
			'line',
			'ortho',
			'bezier',
			'line',
			'ortho'
		]);
	});

	test('parses signal marker shorthands and explicit marker endpoints', () => {
		const document = parseSchematic(
			`resistor:R1 "Source" at (100, 100) #amber
resistor:R2 "Target" at (300, 100) #blue
R1.out -> R2.in #blue [arrow]
R1.out -> R2.in #blue [dot]
R1.out -> R2.in #blue [ortho marker-start=dot marker-end=arrow]
R1.out -> R2.in #blue [marker-start=none marker-end=none]
R1.out -> R2.in #blue []`,
			fence
		);
		expect(document.connections).toMatchObject([
			{ curve: 'line', markerStart: 'none', markerEnd: 'arrow' },
			{ curve: 'line', markerStart: 'none', markerEnd: 'dot' },
			{ curve: 'ortho', markerStart: 'dot', markerEnd: 'arrow' },
			{ curve: 'line', markerStart: 'none', markerEnd: 'none' },
			{ curve: 'line', markerStart: 'none', markerEnd: 'none' }
		]);

		for (const options of [
			'[line bezier]',
			'[arrow dot]',
			'[marker-start=dot marker-start=arrow]',
			'[marker-end=dot marker-end=arrow]',
			'[marker-start=flare]'
		]) {
			expect(() =>
				parseSchematic(
					`resistor:R1 "Source" at (100, 100) #amber\nR1.out -> R1.in #blue ${options}`,
					fence
				)
			).toThrow(/Connection|marker-start/);
		}
	});

	test('applies stable analog defaults and accepts every declared specialization', () => {
		const variants = parseSchematic(
			`diode:D0 "Standard" at (80, 100) #amber
diode:D1 "Schottky" at (180, 100) #amber [type=schottky]
diode:D2 "Zener" at (280, 100) #amber [type=zener]
transistor:Q0 "Default" at (380, 100) #blue
transistor:Q1 "NPN" at (500, 100) #blue [type=npn]
transistor:Q2 "PNP" at (620, 100) #blue [type=pnp]
transistor:Q3 "NMOS" at (740, 100) #blue [type=nmos]
ground:G0 "Signal" at (860, 100) #slate
ground:G1 "Chassis" at (960, 100) #slate [style=chassis]
ground:G2 "Earth" at (1060, 100) #slate [style=earth]`,
			expandedFence
		);
		expect(variants.components.map((component) => component.kind)).toHaveLength(10);
		expect(variants.components[0]).toMatchObject({ diodeType: 'standard' });
		expect(variants.components[1]).toMatchObject({ diodeType: 'schottky' });
		expect(variants.components[2]).toMatchObject({ diodeType: 'zener' });
		expect(variants.components[3]).toMatchObject({ transistorType: 'npn' });
		expect(variants.components[5]).toMatchObject({ transistorType: 'pnp' });
		expect(variants.components[6]).toMatchObject({ transistorType: 'nmos' });
		expect(variants.components[7]).toMatchObject({ groundStyle: 'signal' });
		expect(variants.components[8]).toMatchObject({ groundStyle: 'chassis' });
	});

	test('computes IC dimensions and validates custom pins across all sides', () => {
		const document = parseSchematic(
			`ic:U1 "Router" at (500, 280) #quantum-optical [left="A0,A1,A2,A3" right="Y0" top="CLK0,CLK1,CLK2,CLK3,CLK4" bottom="VSS,VDD"]
U1.A3 -> U1.Y0 #quantum-optical [ortho]
U1.CLK4 -> U1.VDD #amber [bezier]`,
			expandedFence
		);
		expect(document.components[0]).toMatchObject({
			kind: 'ic',
			bodyWidth: 134,
			bodyHeight: 96
		});
		expect(document.connections).toMatchObject([{ curve: 'ortho' }, { curve: 'bezier' }]);
		const verticalAliases = parseSchematic(
			`ic:U2 "Vertical" at (800, 400) [top="DIN" bottom="DOUT"]
U2.in -> U2.out #slate`,
			expandedFence
		);
		expect(verticalAliases.connections).toHaveLength(1);
		const namedAliases = parseSchematic(
			`ic:U3 "Named aliases" at (800, 400) [right="in1,out1"]
U3.in -> U3.out #slate`,
			expandedFence
		);
		expect(namedAliases.connections).toHaveLength(1);
	});

	test('validates component option grammar and gate arity', () => {
		for (const source of [
			'resistor:R1 "R" at (80, 80) #amber [inputs=2]',
			'and:G1 "AND" at (80, 80) #cyan [unknown=1]',
			'qgate:Q1 "RZ" at (80, 80) #purple [unknown="x"]',
			'hadamard:Q1 "H" at (80, 80) #purple [phase="π"]'
		]) {
			expect(() => parseSchematic(source, fence)).toThrow(/Option/);
		}
		expect(() => parseSchematic('and:G1 "AND" at (80, 80) #cyan [standard=ansi]', fence)).toThrow(
			/ieee or iec/
		);
		for (const count of ['0', '33', '1.5']) {
			expect(() =>
				parseSchematic(`and:G1 "AND" at (80, 80) #cyan [inputs=${count}]`, fence)
			).toThrow(/integer from 1 through 32/);
		}
		expect(() =>
			parseSchematic('and:G1 "AND" at (80, 80) #cyan [inputs=2 inputs=3]', fence)
		).toThrow(/Duplicate option/);
		expect(() => parseSchematic('and:G1 "AND" at (80, 80) #cyan [inputs]', fence)).toThrow(
			/Malformed component options/
		);
		expect(() => parseSchematic('and:G1 "AND" at (80, 80) #cyan [inputs=]', fence)).toThrow(
			/Malformed component options/
		);
		expect(() => parseSchematic('and:G1 "AND" at (80, 80) #cyan [inputs=2', fence)).toThrow(
			/Malformed declaration options/
		);
	});

	test('rejects unsupported analog variants and component option tails', () => {
		for (const source of [
			'diode:D1 "D" at (100, 100) #amber [type=laser]',
			'transistor:Q1 "Q" at (100, 100) #amber [type=jfet]',
			'ground:G1 "G" at (100, 100) #amber [style=floating]'
		]) {
			expect(() => parseSchematic(source, fence)).toThrow(/must be one of/);
		}
		for (const source of [
			'inductor:L1 "L" at (100, 100) #amber [type=air]',
			'port:P1 "P" at (100, 100) #amber [direction=in]',
			'diode:D1 "D" at (100, 100) #amber [style=iec]',
			'transistor:Q1 "Q" at (100, 100) #amber [style=iec]'
		]) {
			expect(() => parseSchematic(source, fence)).toThrow(/Option/);
		}
	});

	test('rejects malformed, duplicate, excessive, empty, and absent IC pins', () => {
		for (const source of [
			'ic:U1 "Empty" at (200, 120) #slate',
			'ic:U1 "Empty" at (200, 120) [left=""]',
			'ic:U1 "Bad" at (200, 120) [left="A,,B"]',
			'ic:U1 "Bad" at (200, 120) [left="A,$B"]',
			'ic:U1 "Reserved" at (200, 120) [left="in"]',
			'ic:U1 "Duplicate" at (200, 120) [left="A,B" right="B,Y"]',
			'ic:U1 "Unknown" at (200, 120) [left="A" rear="Y"]'
		]) {
			expect(() => parseSchematic(source, fence)).toThrow(/pin|Option/i);
		}
		const pins = Array.from({ length: 65 }, (_, index) => `P${index}`).join(',');
		expect(() =>
			parseSchematic(`ic:U1 "Large" at (300, 130) [left="${pins}"]`, expandedFence)
		).toThrow(/at most 64/);
	});

	test('rejects unsafe declaration-tail and routing option forms', () => {
		for (const source of [
			'resistor:R1 "R" at (100, 100) [inputs=2]',
			'resistor:R1 "R" at (100, 100) #amber []',
			'resistor:R1 "R" at (100, 100) #amber[inputs=2]',
			'resistor:R1 "R" at (100, 100) #amber [inputs="2]',
			'qgate:Q1 "Q" at (100, 100) #amber [parameter="x"matrix="y"]',
			'resistor:R1 "R" at (100, 100) rgb(1 2 3',
			'resistor:R1 "R" at (100, 100) rgb(1 2 3))',
			'resistor:R1 "R" at (100, 100) #amber [inputs=2] trailing',
			'resistor:R1 "R" at (100, 100) #amber [inputs=2 [outputs=1]]',
			'resistor:R1 "R" at (100, 100) #amber ]'
		]) {
			expect(() => parseSchematic(source, fence)).toThrow(/declaration|color|options/i);
		}
		const prefix = 'resistor:R1 "R" at (100, 100) #amber';
		for (const route of ['[spline]', '[bezier extra]', '[curve=bezier]']) {
			expect(() => parseSchematic(`${prefix}\nR1.out -> R1.in #blue ${route}`, fence)).toThrow(
				/routing/
			);
		}
	});

	test('validates generated gate ports and all quantum/passive port families', () => {
		const prefix = `and:G1 "AND" at (100, 100) #cyan [inputs=3 outputs=2]
cnot:Q1 "CNOT" at (250, 100) #purple
qgate:Q2 "RX" at (400, 100) #quantum
resistor:R1 "R" at (520, 100) #amber`;
		expect(() =>
			parseSchematic(
				`${prefix}\nG1.out2 -> G1.in3 #slate\nQ1.control -> Q1.target #slate\nQ2.out -> R1.in #slate`,
				fence
			)
		).not.toThrow();
		for (const edge of [
			'G1.out3 -> G1.in #slate',
			'G1.out -> G1.in0 #slate',
			'G1.out -> G1.in01 #slate',
			'G1.bad -> G1.in #slate',
			'Q1.bad -> Q1.in #slate',
			'Q2.bad -> Q2.in #slate',
			'R1.out -> R1.bad #slate'
		]) {
			expect(() => parseSchematic(`${prefix}\n${edge}`, fence)).toThrow(/invalid for/);
		}
	});

	test('validates every analog alias, IC exact pin, and IC stable in/out aliases', () => {
		const prefix = `resistor:R1 "R" at (100, 120) #amber
inductor:L1 "L" at (210, 120) #amber
diode:D1 "D" at (320, 120) #blue
transistor:Q1 "Q" at (440, 120) #cyan [type=nmos]
port:P1 "P" at (570, 120) #purple
ground:G1 "G" at (690, 120) #slate
ic:U1 "Mux" at (850, 120) [left="A0,A1" right="Y0" top="CLK" bottom="VSS"]`;
		const validEdges = [
			'R1.l -> R1.right #slate',
			'L1.left -> L1.r #slate',
			'D1.anode -> D1.cathode #slate',
			'D1.a -> D1.k #slate',
			'D1.a -> D1.c #slate',
			'Q1.base -> Q1.collector #slate',
			'Q1.gate -> Q1.drain #slate',
			'Q1.b -> Q1.c #slate',
			'Q1.g -> Q1.d #slate',
			'Q1.emitter -> Q1.source #slate',
			'Q1.e -> Q1.s #slate',
			'P1.in -> P1.out #slate',
			'G1.in -> U1.A1 #slate',
			'U1.in -> U1.out #slate',
			'U1.CLK -> U1.VSS #slate'
		];
		expect(() =>
			parseSchematic(`${prefix}\n${validEdges.join('\n')}`, expandedFence)
		).not.toThrow();
		for (const edge of [
			'R1.bad -> R1.out #slate',
			'D1.in -> D1.out #slate',
			'Q1.in -> Q1.out #slate',
			'P1.left -> P1.out #slate',
			'G1.out -> U1.A0 #slate',
			'U1.bad -> U1.Y0 #slate'
		]) {
			expect(() => parseSchematic(`${prefix}\n${edge}`, expandedFence)).toThrow(/invalid for/);
		}
	});

	test('rejects every out-of-bounds direction', () => {
		for (const point of ['(-1, 40)', '(641, 40)', '(40, -1)', '(40, 261)']) {
			expect(() => parseSchematic(`resistor:R1 "one" at ${point} #amber`, fence)).toThrow(
				/outside/
			);
		}
	});

	test('validates component existence and kind-specific ports', () => {
		expect(() =>
			parseSchematic('resistor:R1 "one" at (80, 80) #amber\nR1.out -> Missing.in #slate', fence)
		).toThrow(/Unknown component Missing/);
		expect(() =>
			parseSchematic('resistor:R1 "one" at (80, 80) #amber\nMissing.out -> R1.in #slate', fence)
		).toThrow(/Unknown component Missing/);
		expect(() =>
			parseSchematic('resistor:R1 "one" at (80, 80) #amber\nR1.out -> R1.in2 #slate', fence)
		).toThrow(/invalid for resistor/);
	});

	test('exposes stable typed diagnostics with and without line numbers', () => {
		const general = new SchematicSyntaxError('general');
		const located = new SchematicSyntaxError('located', 7);
		expect(general).toMatchObject({ name: 'SchematicSyntaxError', message: 'general' });
		expect(located).toMatchObject({ line: 7, message: 'Line 7: located' });
	});

	test('returns a deeply immutable AST capability for safe rendering', () => {
		const document = parseSchematic(
			`ic:U1 "Mux" at (200, 120) [left="in1,EN" right="out1"]
U1.in -> U1.out #slate`,
			fence
		);
		const chip = document.components[0];
		const connection = document.connections[0];

		expect(Object.isFrozen(document)).toBe(true);
		expect(Object.isFrozen(document.components)).toBe(true);
		expect(Object.isFrozen(document.connections)).toBe(true);
		expect(Object.isFrozen(chip)).toBe(true);
		expect(Object.isFrozen(chip?.color)).toBe(true);
		if (chip?.kind !== 'ic') throw new Error('Expected an IC fixture.');
		expect(Object.isFrozen(chip.pins)).toBe(true);
		expect(Object.values(chip.pins).every((pins) => Object.isFrozen(pins))).toBe(true);
		expect(Object.isFrozen(connection)).toBe(true);
		expect(Object.isFrozen(connection?.from)).toBe(true);
		expect(Object.isFrozen(connection?.to)).toBe(true);
		expect(Object.isFrozen(connection?.color)).toBe(true);
	});

	test('bounds compiler work for untrusted or accidentally generated input', () => {
		expect(() => parseSchematic('x'.repeat(131_073), fence)).toThrow(/character limit/);

		const excessiveComponents = Array.from(
			{ length: 513 },
			(_, index) => `resistor:R${index + 1} "R" at (80, 80) #amber`
		).join('\n');
		expect(() => parseSchematic(excessiveComponents, fence)).toThrow(/512 component limit/);

		const excessiveConnections = [
			'resistor:R1 "R" at (80, 80) #amber',
			...Array.from({ length: 2_049 }, () => 'R1.out -> R1.in #slate')
		].join('\n');
		expect(() => parseSchematic(excessiveConnections, fence)).toThrow(/2,048 connection limit/);
	});
});

describe('parseSchematicColor', () => {
	test('normalizes tokens, exact CSS literals, and host-resolved aliases', () => {
		expect(parseSchematicColor('#amber', 1)).toEqual({ kind: 'token', value: 'amber' });
		expect(parseSchematicColor('#AMBER', 1)).toEqual({ kind: 'token', value: 'amber' });
		expect(parseSchematicColor('blue', 1)).toEqual({ kind: 'token', value: 'blue' });
		expect(parseSchematicColor('emerald')).toEqual({ kind: 'token', value: 'emerald' });
		for (const literal of ['#abc', '#abcd', '#aabbcc', '#aabbccdd']) {
			expect(parseSchematicColor(literal.toUpperCase(), 1)).toEqual({
				kind: 'css',
				value: literal
			});
		}
		expect(parseSchematicColor('#Brand-Accent', 1)).toEqual({
			kind: 'alias',
			value: 'brand-accent'
		});
		expect(parseSchematicColor('Radar', 1)).toEqual({ kind: 'alias', value: 'radar' });
	});

	test('normalizes legacy and modern rgb/rgba forms with strict ranges', () => {
		expect(parseSchematicColor('rgb(255, 0, 10)', 1)).toEqual({
			kind: 'css',
			value: 'rgb(255 0 10)'
		});
		expect(parseSchematicColor('rgba(100%, 0%, 20%, 0.5)', 1)).toEqual({
			kind: 'css',
			value: 'rgb(100% 0% 20% / 0.5)'
		});
		expect(parseSchematicColor('RGB(1 2 3 / 40%)', 1)).toEqual({
			kind: 'css',
			value: 'rgb(1 2 3 / 40%)'
		});
		for (const invalid of [
			'rgb(1 2)',
			'rgb(bad 2 3)',
			'rgb(256 2 3)',
			'rgb(101% 2% 3%)',
			'rgba(1 2 3 / 2)',
			'rgb(1, 2, 3 / 0.5)',
			'rgb(1 2 3 / .5 / .2)'
		]) {
			expect(() => parseSchematicColor(invalid, 2)).toThrow(/Invalid rgb|Invalid rgba/);
		}
	});

	test('normalizes legacy and modern hsl/hsla forms with strict percentages', () => {
		expect(parseSchematicColor('hsl(180, 50%, 25%)', 1)).toEqual({
			kind: 'css',
			value: 'hsl(180 50% 25%)'
		});
		expect(parseSchematicColor('hsla(.5turn 100% 50% / 25%)', 1)).toEqual({
			kind: 'css',
			value: 'hsl(.5turn 100% 50% / 25%)'
		});
		expect(parseSchematicColor('hsla(180, 50%, 25%, 0.5)', 1)).toEqual({
			kind: 'css',
			value: 'hsl(180 50% 25% / 0.5)'
		});
		for (const invalid of [
			'hsl(10 20 30%)',
			'hsl(10 20% 30)',
			'hsl(bad 20% 30%)',
			'hsl(10 120% 30%)',
			'hsla(10 20% 30% / 120%)',
			'hsl(10, 20%, 30% / 0.5)',
			'hsl(10 20% 30% / .5 / .2)'
		]) {
			expect(() => parseSchematicColor(invalid, 2)).toThrow(/Invalid hsl|Invalid hsla/);
		}
	});

	test('rejects malformed hex and injection-capable expressions', () => {
		expect(() => parseSchematicColor('#12345', 4)).toThrow(/Hex colors require/);
		for (const value of ['url(https://example.com/x)', 'red;stroke:url(x)', '--private']) {
			expect(() => parseSchematicColor(value, 4)).toThrow(/Unsafe or unsupported/);
		}
	});
});
