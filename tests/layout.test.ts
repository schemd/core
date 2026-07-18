/** Component geometry, port placement, route avoidance, and bridge-crossing verification. */
import { describe, expect, test } from 'vitest';
import {
	componentRectangle,
	componentObstacleRectangle,
	componentTextAnchors,
	enumerateComponentPorts,
	MAX_SCHEMATIC_WIRE_CROSSINGS,
	parseSchematic,
	positionIcPin,
	resolvePortPoint,
	routeConnection,
	routeConnections,
	SCHEMATIC_BRIDGE_RADIUS,
	SCHEMATIC_OBSTACLE_CLEARANCE,
	validateDocumentGeometry,
	type ClassicalGateComponent,
	type PassiveComponent,
	type PortComponent,
	type SchematicColor,
	type SchematicComponent,
	type SchematicConnection,
	type SchematicDocument,
	type SchematicFence
} from '../src/index.js';

const fence: SchematicFence = {
	bounds: { width: 1600, height: 500 },
	title: 'Layout matrix'
};

const token: SchematicColor = { kind: 'token', value: 'slate' };

function findComponent(document: SchematicDocument, id: string): SchematicComponent {
	const component = document.components.find((candidate) => candidate.id === id);
	if (component === undefined) throw new Error(`Fixture component ${id} was not found.`);
	return component;
}

describe('pure schematic layout matrix', () => {
	test('resolves every component port family, alias, and dynamically distributed IC side', () => {
		const document = parseSchematic(
			`resistor:R1 "R" at (100, 180) #amber
capacitor:C1 "C" at (210, 180) #blue
inductor:L1 "L" at (320, 180) #cyan
diode:D1 "D" at (430, 180) #purple
transistor:Q1 "Q" at (550, 180) #slate [type=nmos]
port:P1 "Port" at (670, 180) #emerald
ground:G1 "Ground" at (780, 180) #slate
hadamard:H1 "H" at (900, 180) #purple
cnot:CX1 "CX" at (1020, 180) #purple
qgate:QG1 "RZ" at (1140, 180) #purple
and:A1 "AND" at (1260, 180) #cyan [inputs=3 outputs=2]
ic:U1 "Mux" at (1430, 180) [left="A0,A1" right="Y0,Y1" top="CLK" bottom="VSS"]`,
			fence
		);

		for (const port of ['in', 'left', 'l']) {
			expect(resolvePortPoint(findComponent(document, 'R1'), port).x).toBe(58);
		}
		for (const port of ['out', 'right', 'r']) {
			expect(resolvePortPoint(findComponent(document, 'C1'), port).x).toBe(252);
		}
		expect(resolvePortPoint(findComponent(document, 'L1'), 'out')).toEqual({ x: 362, y: 180 });
		for (const port of ['anode', 'a']) {
			expect(resolvePortPoint(findComponent(document, 'D1'), port).x).toBe(388);
		}
		for (const port of ['cathode', 'k', 'c']) {
			expect(resolvePortPoint(findComponent(document, 'D1'), port).x).toBe(472);
		}
		for (const port of ['base', 'gate', 'b', 'g']) {
			expect(resolvePortPoint(findComponent(document, 'Q1'), port)).toEqual({ x: 508, y: 180 });
		}
		for (const port of ['collector', 'drain', 'c', 'd']) {
			expect(resolvePortPoint(findComponent(document, 'Q1'), port)).toEqual({ x: 592, y: 158 });
		}
		for (const port of ['emitter', 'source', 'e', 's']) {
			expect(resolvePortPoint(findComponent(document, 'Q1'), port)).toEqual({ x: 592, y: 202 });
		}
		expect(resolvePortPoint(findComponent(document, 'P1'), 'in').x).toBe(628);
		expect(resolvePortPoint(findComponent(document, 'P1'), 'out').x).toBe(712);
		expect(resolvePortPoint(findComponent(document, 'G1'), 'in')).toEqual({ x: 780, y: 138 });
		expect(resolvePortPoint(findComponent(document, 'H1'), 'in').x).toBe(852);
		expect(resolvePortPoint(findComponent(document, 'H1'), 'out').x).toBe(948);
		expect(resolvePortPoint(findComponent(document, 'QG1'), 'in').x).toBe(1092);
		expect(resolvePortPoint(findComponent(document, 'QG1'), 'out').x).toBe(1188);
		expect(resolvePortPoint(findComponent(document, 'CX1'), 'in').x).toBe(978);
		expect(resolvePortPoint(findComponent(document, 'CX1'), 'out').x).toBe(1062);
		expect(resolvePortPoint(findComponent(document, 'CX1'), 'control').y).toBe(164);
		expect(resolvePortPoint(findComponent(document, 'CX1'), 'target').y).toBe(196);
		expect(resolvePortPoint(findComponent(document, 'A1'), 'in').x).toBe(1212);
		expect(resolvePortPoint(findComponent(document, 'A1'), 'in3').y).toBe(192);
		expect(resolvePortPoint(findComponent(document, 'A1'), 'out').x).toBe(1308);
		expect(resolvePortPoint(findComponent(document, 'A1'), 'out2').y).toBe(188);

		const chip = findComponent(document, 'U1');
		expect(resolvePortPoint(chip, 'A1')).toEqual({
			x: 1370,
			y: 190.66666666666666
		});
		expect(resolvePortPoint(chip, 'Y1')).toEqual({
			x: 1490,
			y: 190.66666666666666
		});
		expect(resolvePortPoint(chip, 'CLK')).toEqual({ x: 1430, y: 132 });
		expect(resolvePortPoint(chip, 'VSS')).toEqual({ x: 1430, y: 228 });
		expect(resolvePortPoint(chip, 'in')).toEqual(resolvePortPoint(chip, 'A0'));
		expect(resolvePortPoint(chip, 'out')).toEqual(resolvePortPoint(chip, 'Y0'));
	});

	test('falls back from IC in/out aliases to top and bottom pins', () => {
		const document = parseSchematic(
			'ic:U1 "Vertical" at (300, 200) #slate [top="CLK" bottom="VSS"]',
			fence
		);
		const chip = findComponent(document, 'U1');
		expect(resolvePortPoint(chip, 'in')).toEqual(resolvePortPoint(chip, 'CLK'));
		expect(resolvePortPoint(chip, 'out')).toEqual(resolvePortPoint(chip, 'VSS'));
		const outputOnly = parseSchematic(
			'ic:U2 "Output only" at (500, 200) #slate [right="Y"]',
			fence
		);
		expect(() => resolvePortPoint(findComponent(outputOnly, 'U2'), 'in')).toThrow(
			/Validated port U2.in is missing/
		);
	});

	test('prioritizes canonical in1/out1 IC aliases and positions indexed pins in O(1)', () => {
		const document = parseSchematic(
			'ic:U1 "Priority" at (300, 200) #slate [left="EN,in1" right="STATUS,out1"]',
			fence
		);
		const chip = findComponent(document, 'U1');
		if (chip.kind !== 'ic') throw new Error('Expected an IC fixture.');
		expect(resolvePortPoint(chip, 'in')).toEqual(resolvePortPoint(chip, 'in1'));
		expect(resolvePortPoint(chip, 'in')).not.toEqual(resolvePortPoint(chip, 'EN'));
		expect(resolvePortPoint(chip, 'out')).toEqual(resolvePortPoint(chip, 'out1'));
		expect(resolvePortPoint(chip, 'out')).not.toEqual(resolvePortPoint(chip, 'STATUS'));
		expect(positionIcPin(chip, 'left', 1)).toEqual(resolvePortPoint(chip, 'in1'));
		for (const index of [-1, 0.5, 2]) {
			expect(() => positionIcPin(chip, 'left', index)).toThrow(/outside U1.left/);
		}
	});

	test('enumerates one interactive hotspot for every canonical physical terminal', () => {
		const document = parseSchematic(
			`resistor:R1 "R" at (100, 180) #amber
diode:D1 "D" at (220, 180) #blue
transistor:B1 "BJT" at (340, 180) #cyan [type=pnp]
transistor:M1 "MOS" at (460, 180) #cyan [type=pmos]
port:P1 "P" at (580, 180) #purple
ground:G1 "G" at (700, 180) #slate
and:A1 "AND" at (820, 180) #cyan [inputs=3 outputs=2]
hadamard:H1 "H" at (940, 180) #purple
cnot:C1 "C" at (1060, 180) #purple
qgate:Q1 "Q" at (1180, 180) #purple
ic:U1 "IC" at (1360, 180) #slate [left="A,B" right="Y" top="CLK" bottom="GND"]`,
			fence
		);
		const ids = (id: string): readonly string[] =>
			enumerateComponentPorts(findComponent(document, id)).map((port) => port.id);
		expect(ids('R1')).toEqual(['in', 'out']);
		expect(ids('D1')).toEqual(['anode', 'cathode']);
		expect(ids('B1')).toEqual(['base', 'collector', 'emitter']);
		expect(ids('M1')).toEqual(['gate', 'drain', 'source']);
		expect(ids('P1')).toEqual(['in', 'out']);
		expect(ids('G1')).toEqual(['in']);
		expect(ids('A1')).toEqual(['in1', 'in2', 'in3', 'out1', 'out2']);
		expect(ids('H1')).toEqual(['in', 'out']);
		expect(ids('C1')).toEqual(['in', 'out', 'control', 'target']);
		expect(ids('Q1')).toEqual(['in', 'out']);
		expect(ids('U1')).toEqual(['A', 'B', 'Y', 'CLK', 'GND']);
		for (const component of document.components) {
			for (const port of enumerateComponentPorts(component)) {
				expect(port.point).toEqual(resolvePortPoint(component, port.id));
			}
		}
	});

	test('rejects invalid ports defensively when callers bypass parser validation', () => {
		const document = parseSchematic(
			`resistor:R1 "R" at (100, 180) #amber
diode:D1 "D" at (220, 180) #blue
transistor:Q1 "Q" at (340, 180) #cyan
port:P1 "P" at (460, 180) #purple
ground:G1 "G" at (580, 180) #slate
hadamard:H1 "H" at (700, 180) #purple
cnot:CX1 "CX" at (820, 180) #purple
ic:U1 "Chip" at (960, 180) [left="A" right="Y"]`,
			fence
		);
		for (const id of ['R1', 'D1', 'Q1', 'P1', 'G1', 'H1', 'CX1', 'U1']) {
			expect(() => resolvePortPoint(findComponent(document, id), 'invalid')).toThrow(
				`Validated port ${id}.invalid is missing.`
			);
		}
		const inputOnlyChip: SchematicComponent = {
			kind: 'ic',
			id: 'INPUT_ONLY',
			label: 'Input only',
			x: 300,
			y: 300,
			color: token,
			line: 1,
			pins: { left: ['A'], right: [], top: [], bottom: [] },
			bodyWidth: 88,
			bodyHeight: 64
		};
		expect(() => resolvePortPoint(inputOnlyChip, 'out')).toThrow(/INPUT_ONLY\.out is missing/);
	});

	test('routes line, bezier, and orthogonal traces with stable numeric formatting', () => {
		const left: PortComponent = {
			kind: 'port',
			id: 'P1',
			label: 'left',
			x: 42.0004,
			y: 100,
			color: token,
			line: 1
		};
		const right: PortComponent = { ...left, id: 'P2', label: 'right', x: 200, y: 150 };
		const components = new Map<string, SchematicComponent>([
			['P1', left],
			['P2', right]
		]);
		const base: Omit<SchematicConnection, 'curve'> = {
			from: { componentId: 'P1', port: 'in' },
			to: { componentId: 'P2', port: 'out' },
			color: token,
			markerStart: 'none',
			markerEnd: 'none',
			line: 3
		};
		expect(routeConnection({ ...base, curve: 'line' }, components).d).toBe('M 0 100 L 242 150');
		expect(routeConnection({ ...base, curve: 'bezier' }, components).d).toBe(
			'M 0 100 C 121 100, 121 150, 242 150'
		);
		expect(routeConnection({ ...base, curve: 'ortho' }, components).d).toBe(
			'M 0 100 H -12 V 118 H 254 V 150 H 242'
		);
		expect(() =>
			routeConnection(
				{ ...base, from: { componentId: 'missing', port: 'out' }, curve: 'line' },
				components
			)
		).toThrow('Validated component missing is missing.');
	});

	test('routes orthogonal traces around component AABBs with deterministic clearance', () => {
		const left: PortComponent = {
			kind: 'port',
			id: 'P1',
			label: 'input',
			x: 50,
			y: 120,
			color: token,
			line: 1
		};
		const right: PortComponent = { ...left, id: 'P2', label: 'output', x: 450 };
		const obstacle: PassiveComponent = {
			kind: 'resistor',
			id: 'R1',
			label: 'obstacle',
			x: 250,
			y: 120,
			color: token,
			line: 2
		};
		const components = new Map<string, SchematicComponent>([
			[left.id, left],
			[right.id, right],
			[obstacle.id, obstacle]
		]);
		const connection: SchematicConnection = {
			from: { componentId: left.id, port: 'out' },
			to: { componentId: right.id, port: 'in' },
			color: token,
			curve: 'ortho',
			markerStart: 'none',
			markerEnd: 'none',
			line: 3
		};
		const obstacleBounds = componentObstacleRectangle(obstacle);
		expect(SCHEMATIC_OBSTACLE_CLEARANCE).toBe(12);
		expect(obstacleBounds).toEqual({ minX: 196, minY: 90, maxX: 304, maxY: 150 });
		expect(routeConnection(connection, components)).toMatchObject({
			d: 'M 92 120 H 104 V 90 H 396 V 120 H 408'
		});
		expect(() => componentObstacleRectangle(obstacle, -1)).toThrow(/finite non-negative/);
		expect(() => componentObstacleRectangle(obstacle, Number.NaN)).toThrow(/finite non-negative/);
	});

	test('adds one bridge arc to the later non-junction orthogonal trace', () => {
		const left: PortComponent = {
			kind: 'port',
			id: 'LEFT',
			label: 'left',
			x: 50,
			y: 120,
			color: token,
			line: 1
		};
		const right: PortComponent = { ...left, id: 'RIGHT', label: 'right', x: 450 };
		const top: SchematicComponent = {
			kind: 'cnot',
			id: 'TOP',
			label: 'top',
			x: 250,
			y: 40,
			color: token,
			line: 2
		};
		const bottom: SchematicComponent = { ...top, id: 'BOTTOM', label: 'bottom', y: 200 };
		const components = new Map(
			[left, right, top, bottom].map((component) => [component.id, component] as const)
		);
		const horizontal: SchematicConnection = {
			from: { componentId: left.id, port: 'out' },
			to: { componentId: right.id, port: 'in' },
			color: token,
			curve: 'ortho',
			markerStart: 'none',
			markerEnd: 'none',
			line: 3
		};
		const vertical: SchematicConnection = {
			...horizontal,
			from: { componentId: top.id, port: 'target' },
			to: { componentId: bottom.id, port: 'control' },
			line: 4
		};
		const routed = routeConnections([horizontal, vertical], components);
		expect(SCHEMATIC_BRIDGE_RADIUS).toBe(5);
		expect(routed[0]!.d).toBe('M 92 120 H 408');
		expect(routed[1]!.d).toContain('A 5 5');
		expect(routed[1]!.d).toBe('M 250 56 V 115 A 5 5 0 0 0 250 125 V 184');
		expect(routed[1]!.points).toContainEqual({ x: 245, y: 120 });

		const reversedVertical = routeConnections(
			[
				horizontal,
				{
					...vertical,
					from: vertical.to,
					to: vertical.from
				}
			],
			components
		);
		expect(reversedVertical[1]!.d).toBe('M 250 184 V 125 A 5 5 0 0 1 250 115 V 56');
	});

	test('deduplicates coincident crossings and orders multiple horizontal bridge jumps', () => {
		const horizontalLeft: PortComponent = {
			kind: 'port',
			id: 'LEFT',
			label: 'left',
			x: 50,
			y: 120,
			color: token,
			line: 1
		};
		const horizontalRight: PortComponent = {
			...horizontalLeft,
			id: 'RIGHT',
			label: 'right',
			x: 450
		};
		const verticalComponent = (id: string, x: number, y: number): SchematicComponent => ({
			kind: 'cnot',
			id,
			label: id,
			x,
			y,
			color: token,
			line: 2
		});
		const topA = verticalComponent('TOP_A', 180, 40);
		const bottomA = verticalComponent('BOTTOM_A', 180, 200);
		const topB = verticalComponent('TOP_B', 320, 40);
		const bottomB = verticalComponent('BOTTOM_B', 320, 200);
		const components = new Map(
			[horizontalLeft, horizontalRight, topA, bottomA, topB, bottomB].map(
				(component) => [component.id, component] as const
			)
		);
		const verticalA: SchematicConnection = {
			from: { componentId: topA.id, port: 'target' },
			to: { componentId: bottomA.id, port: 'control' },
			color: token,
			curve: 'ortho',
			markerStart: 'none',
			markerEnd: 'none',
			line: 3
		};
		const verticalB: SchematicConnection = {
			...verticalA,
			from: { componentId: topB.id, port: 'target' },
			to: { componentId: bottomB.id, port: 'control' }
		};
		const horizontal: SchematicConnection = {
			...verticalA,
			from: { componentId: horizontalLeft.id, port: 'out' },
			to: { componentId: horizontalRight.id, port: 'in' }
		};
		const routed = routeConnections([verticalA, verticalA, verticalB, horizontal], components);
		expect(routed[3]!.d).toBe('M 92 120 H 175 A 5 5 0 0 1 185 120 H 315 A 5 5 0 0 1 325 120 H 408');
		expect(routed[3]!.d.match(/ A /g)).toHaveLength(2);

		const reversed = routeConnections(
			[
				verticalA,
				{
					...horizontal,
					from: horizontal.to,
					to: horizontal.from
				}
			],
			components
		);
		expect(reversed[1]!.d).toBe('M 408 120 H 185 A 5 5 0 0 0 175 120 H 92');
	});

	test('shrinks adjacent bridges instead of overlapping or reversing the path', () => {
		const terminal = (id: string, x: number, y: number): PortComponent => ({
			kind: 'port', id, label: id, x, y, color: token, line: 1
		});
		const left = terminal('L', -50, 120);
		const right = terminal('R', 750, 120);
		const topA = terminal('TA', 50, 20);
		const bottomA = terminal('BA', 550, 220);
		const topB = terminal('TB', 170, 80);
		const bottomB = terminal('BB', 438, 280);
		const components = new Map(
			[left, right, topA, bottomA, topB, bottomB].map((component) => [component.id, component])
		);
		const connection = (from: string, fromPort: string, to: string, toPort: string): SchematicConnection => ({
			from: { componentId: from, port: fromPort },
			to: { componentId: to, port: toPort },
			color: token,
			curve: 'ortho',
			markerStart: 'none',
			markerEnd: 'none',
			line: 2
		});
		const routes = routeConnections(
			[
				connection('TA', 'out', 'BA', 'in'),
				connection('TB', 'out', 'BB', 'in'),
				connection('L', 'out', 'R', 'in')
			],
			components
		);
		expect(routes[2]!.d).toContain('A 2 2');
		expect(routes[2]!.d).not.toContain('A 5 5');
		expect(routes[2]!.d).toBe(
			'M -8 120 H 298 A 2 2 0 0 1 302 120 A 2 2 0 0 1 306 120 H 708'
		);
	});

	test('skips subpixel bridges that would serialize as zero-radius arcs', () => {
		const terminal = (id: string, x: number, y: number): PortComponent => ({
			kind: 'port', id, label: id, x, y, color: token, line: 1
		});
		const components = new Map<string, SchematicComponent>();
		for (const component of [
			terminal('L', 0, 120),
			terminal('R', 600, 120),
			terminal('T1', 300, 0),
			terminal('B1', 300, 240),
			terminal('T2', 300.0004, 0),
			terminal('B2', 300.0004, 240),
			terminal('L1', 0, 120),
			terminal('R1', 600, 120),
			terminal('L2', 0, 120.0004),
			terminal('R2', 600, 120.0004),
			terminal('T', 300, 0),
			terminal('B', 300, 240)
		]) {
			components.set(component.id, component);
		}
		const connection = (
			from: string,
			fromPort: 'in' | 'out',
			to: string,
			toPort: 'in' | 'out'
		): SchematicConnection => ({
			from: { componentId: from, port: fromPort },
			to: { componentId: to, port: toPort },
			color: token,
			curve: 'ortho',
			markerStart: 'none',
			markerEnd: 'none',
			line: 2
		});
		const endpointOnlyMap = {
			get: (id: string) => components.get(id),
			values: () => [][Symbol.iterator]()
		} as unknown as ReadonlyMap<string, SchematicComponent>;
		const horizontal = routeConnections(
			[
				connection('T1', 'out', 'B1', 'out'),
				connection('T2', 'out', 'B2', 'out'),
				connection('L', 'out', 'R', 'in')
			],
			endpointOnlyMap
		);
		expect(horizontal[2]!.d).not.toContain(' A 0 0 ');
		expect(horizontal[2]!.d).not.toContain(' A ');
		const vertical = routeConnections(
			[
				connection('L1', 'out', 'R1', 'in'),
				connection('L2', 'out', 'R2', 'in'),
				connection('T', 'out', 'B', 'out')
			],
			endpointOnlyMap
		);
		expect(vertical[2]!.d).not.toContain(' A 0 0 ');
		expect(vertical[2]!.d).not.toContain(' A ');
	});

	test('never applies crossing arcs to line or bezier routes', () => {
		const left: PortComponent = { kind: 'port', id: 'L', label: 'L', x: 50, y: 120, color: token, line: 1 };
		const right: PortComponent = { ...left, id: 'R', x: 450 };
		const top: PortComponent = { ...left, id: 'T', x: 250, y: 20 };
		const bottom: PortComponent = { ...left, id: 'B', x: 250, y: 220 };
		const components = new Map([left, right, top, bottom].map((component) => [component.id, component]));
		const base: SchematicConnection = {
			from: { componentId: 'L', port: 'out' },
			to: { componentId: 'R', port: 'in' },
			color: token,
			curve: 'ortho',
			markerStart: 'none',
			markerEnd: 'none',
			line: 2
		};
		const routed = routeConnections([
			base,
			{ ...base, from: { componentId: 'T', port: 'out' }, to: { componentId: 'B', port: 'out' }, curve: 'bezier' }
		], components);
		expect(routed[1]!.curve).toBe('bezier');
		expect(routed[1]!.d).toContain(' C ');
		expect(routed[1]!.d).not.toContain(' A ');
	});

	test('fails deterministically when a bounded obstacle wall has no route', () => {
		const left: PortComponent = { kind: 'port', id: 'L', label: 'L', x: 50, y: 100, color: token, line: 1 };
		const right: PortComponent = { ...left, id: 'R', x: 450 };
		const wall: SchematicComponent = {
			kind: 'lifeline', id: 'W', label: 'wall', x: 250, y: 100, color: token, line: 1,
			bodyWidth: 96, bodyHeight: 200
		};
		const offCanvas: SchematicComponent = {
			kind: 'initial', id: 'OFF', label: 'off', x: -20, y: -100, color: token, line: 1
		};
		const components = new Map(
			[left, right, wall, offCanvas].map((component) => [component.id, component])
		);
		const connection: SchematicConnection = {
			from: { componentId: 'L', port: 'out' },
			to: { componentId: 'R', port: 'in' },
			color: token, curve: 'ortho', markerStart: 'none', markerEnd: 'none', line: 9
		};
		expect(() => routeConnection(connection, components, { width: 500, height: 200 })).toThrow(
			'Line 9: No collision-free orthogonal route exists.'
		);
	});

	test('elides redundant vertical commands when a bridge consumes a segment edge', () => {
		const lookup = new Map<string, SchematicComponent>();
		const terminal = (id: string, x: number, y: number): PortComponent => {
			const component: PortComponent = { kind: 'port', id, label: id, x, y, color: token, line: 1 };
			lookup.set(id, component);
			return component;
		};
		const leftTop = terminal('LT', 50, 58);
		const rightTop = terminal('RT', 450, 58);
		const leftBottom = terminal('LB', 50, 182);
		const rightBottom = terminal('RB', 450, 182);
		const top: SchematicComponent = { kind: 'cnot', id: 'T', label: 'T', x: 250, y: 40, color: token, line: 1 };
		const bottom: SchematicComponent = { ...top, id: 'B', y: 200 };
		lookup.set(top.id, top);
		lookup.set(bottom.id, bottom);
		const connection = (from: SchematicComponent, fromPort: string, to: SchematicComponent, toPort: string): SchematicConnection => ({
			from: { componentId: from.id, port: fromPort },
			to: { componentId: to.id, port: toPort },
			color: token, curve: 'ortho', markerStart: 'none', markerEnd: 'none', line: 2
		});
		const endpointOnlyMap = {
			get: (id: string) => lookup.get(id),
			values: () => [][Symbol.iterator]()
		} as unknown as ReadonlyMap<string, SchematicComponent>;
		const routes = routeConnections([
			connection(leftTop, 'out', rightTop, 'in'),
			connection(leftBottom, 'out', rightBottom, 'in'),
			connection(top, 'target', bottom, 'control')
		], endpointOnlyMap);
		expect(routes[2]!.d).toBe(
			'M 250 56 A 2 2 0 0 0 250 60 V 180 A 2 2 0 0 0 250 184'
		);
	});

	test('uses bounded A-star for staggered multi-channel obstacle mazes', () => {
		const left: PortComponent = { kind: 'port', id: 'L', label: 'L', x: 50, y: 100, color: token, line: 1 };
		const right: PortComponent = { ...left, id: 'R', x: 450 };
		const upperWall: SchematicComponent = {
			kind: 'lifeline', id: 'UP', label: 'UP', x: 200, y: 65, color: token, line: 1,
			bodyWidth: 40, bodyHeight: 130
		};
		const lowerWall: SchematicComponent = {
			...upperWall, id: 'DOWN', x: 300, y: 135
		};
		const components = new Map(
			[left, right, upperWall, lowerWall].map((component) => [component.id, component])
		);
		const route = routeConnection({
			from: { componentId: 'L', port: 'out' },
			to: { componentId: 'R', port: 'in' },
			color: token, curve: 'ortho', markerStart: 'none', markerEnd: 'none', line: 12
		}, components, { width: 500, height: 200 });
		expect(route.points.length).toBeGreaterThanOrEqual(6);
		expect(route.d).toContain('V 58');
		expect(route.d).toContain('V 142');
	});

	test('post-validates endpoint escape spans against tightly packed neighbors', () => {
		const node = (id: string, x: number, y: number): SchematicComponent => ({
			kind: 'cnot', id, label: id, x, y, color: token, line: 1
		});
		const top = node('TOP', 290, 40);
		const bottom = node('BOTTOM', 290, 200);
		const neighbor = node('NEIGHBOR', 294, 40);
		const components = new Map(
			[top, bottom, neighbor].map((component) => [component.id, component])
		);
		expect(() => routeConnection({
			from: { componentId: 'TOP', port: 'target' },
			to: { componentId: 'BOTTOM', port: 'control' },
			color: token, curve: 'ortho', markerStart: 'none', markerEnd: 'none', line: 13
		}, components)).toThrow('Line 13: Orthogonal route intersects NEIGHBOR after routing.');
	});

	test('connects aligned terminals when endpoint clearance corridors overlap', () => {
		const left: PassiveComponent = {
			kind: 'resistor', id: 'LEFT', label: 'left', x: 100, y: 120, color: token, line: 1
		};
		const right: PassiveComponent = { ...left, id: 'RIGHT', label: 'right', x: 194 };
		const components = new Map(
			[left, right].map((component) => [component.id, component] as const)
		);
		const route = routeConnection(
			{
				from: { componentId: 'LEFT', port: 'out' },
				to: { componentId: 'RIGHT', port: 'in' },
				color: token,
				curve: 'ortho',
				markerStart: 'none',
				markerEnd: 'none',
				line: 14
			},
			components
		);
		expect(route.d).toBe('M 142 120 H 152');
		expect(route.points).toEqual([{ x: 142, y: 120 }, { x: 152, y: 120 }]);
	});

	test('caps adversarial crossing growth before quadratic output allocation', () => {
		const lookup = new Map<string, SchematicComponent>();
		const connections: SchematicConnection[] = [];
		const register = (component: SchematicComponent) => {
			lookup.set(component.id, component);
			return component;
		};
		for (let index = 0; index < 182; index += 1) {
			const x = 100 + index * 2;
			const top = register({ kind: 'cnot', id: `VT${index}`, label: 'V', x, y: 40, color: token, line: 1 });
			const bottom = register({ ...top, id: `VB${index}`, y: 600 });
			connections.push({
				from: { componentId: top.id, port: 'target' },
				to: { componentId: bottom.id, port: 'control' },
				color: token, curve: 'ortho', markerStart: 'none', markerEnd: 'none', line: 20
			});
		}
		for (let index = 0; index < 182; index += 1) {
			const y = 100 + index * 2;
			const left = register({ kind: 'port', id: `HL${index}`, label: 'H', x: 20, y, color: token, line: 1 });
			const right = register({ ...left, id: `HR${index}`, x: 600 });
			connections.push({
				from: { componentId: left.id, port: 'out' },
				to: { componentId: right.id, port: 'in' },
				color: token, curve: 'ortho', markerStart: 'none', markerEnd: 'none', line: 21
			});
		}
		const endpointOnlyMap = {
			get: (id: string) => lookup.get(id),
			values: () => [][Symbol.iterator]()
		} as unknown as ReadonlyMap<string, SchematicComponent>;
		expect(() => routeConnections(connections, endpointOnlyMap)).toThrow(
			`Wire crossing complexity exceeds ${MAX_SCHEMATIC_WIRE_CROSSINGS.toLocaleString('en-US')} intersections.`
		);
	});

	test('rejects a caller-supplied routed array with the wrong cardinality', () => {
		const component: PassiveComponent = {
			kind: 'resistor', id: 'R', label: 'R', x: 100, y: 100, color: token, line: 1
		};
		const connection: SchematicConnection = {
			from: { componentId: 'R', port: 'out' },
			to: { componentId: 'R', port: 'in' },
			color: token, curve: 'line', markerStart: 'none', markerEnd: 'none', line: 2
		};
		expect(() => validateDocumentGeometry(
			{ components: [component], connections: [connection] },
			{ bounds: { width: 300, height: 220 }, title: 'Mismatch' },
			[]
		)).toThrow('Routed connection count does not match');
	});

	test('does not bridge perpendicular segments whose finite ranges do not meet', () => {
		const component: SchematicComponent = {
			kind: 'cnot',
			id: 'CX',
			label: 'CX',
			x: 100,
			y: 100,
			color: token,
			line: 1
		};
		const components = new Map([[component.id, component]]);
		const connection = (
			from: SchematicConnection['from'],
			to: SchematicConnection['to']
		): SchematicConnection => ({
			from,
			to,
			color: token,
			curve: 'ortho',
			markerStart: 'none',
			markerEnd: 'none',
			line: 2
		});
		const routed = routeConnections(
			[
				connection({ componentId: 'CX', port: 'in' }, { componentId: 'CX', port: 'control' }),
				connection({ componentId: 'CX', port: 'target' }, { componentId: 'CX', port: 'out' })
			],
			components
		);
		expect(routed.every((route) => !route.d.includes(' A '))).toBe(true);
	});

	test('checks all component rectangle edges and routed control points against bounds', () => {
		const smallFence: SchematicFence = {
			bounds: { width: 200, height: 200 },
			title: 'Bounds'
		};
		const resistor = (x: number, y: number): PassiveComponent => ({
			kind: 'resistor',
			id: 'R1',
			label: 'R',
			x,
			y,
			color: token,
			line: 4
		});
		for (const component of [
			resistor(41, 100),
			resistor(100, 17),
			resistor(159, 100),
			resistor(100, 183)
		]) {
			expect(() =>
				validateDocumentGeometry({ components: [component], connections: [] }, smallFence)
			).toThrow(/R1 geometry exceeds/);
		}

		const gate: ClassicalGateComponent = {
			kind: 'and',
			id: 'G1',
			label: 'AND',
			x: 100,
			y: 100,
			color: token,
			line: 1,
			inputs: 1,
			outputs: 1,
			standard: 'ieee'
		};
		const malformedTrace: SchematicConnection = {
			from: { componentId: 'G1', port: 'in99' },
			to: { componentId: 'G1', port: 'out' },
			color: token,
			curve: 'bezier',
			markerStart: 'none',
			markerEnd: 'none',
			line: 8
		};
		expect(() =>
			validateDocumentGeometry({ components: [gate], connections: [malformedTrace] }, smallFence)
		).toThrow('Line 8: Connection trace exceeds the declared schematic bounds.');
	});

	test('reserves exact designator and label gutters at both vertical viewBox edges', () => {
		const edgeFence: SchematicFence = {
			bounds: { width: 200, height: 100 },
			title: 'Text gutters'
		};
		const top = parseSchematic('resistor:R1 "Top" at (100, 40) #amber', edgeFence);
		const bottom = parseSchematic('resistor:R2 "Bottom" at (100, 58) #blue', edgeFence);
		const topComponent = findComponent(top, 'R1');
		const bottomComponent = findComponent(bottom, 'R2');
		expect(componentTextAnchors(topComponent)).toEqual({
			designatorY: -28,
			labelY: 37,
			designatorWidth: 14,
			labelWidth: 21
		});
		expect(componentRectangle(topComponent).minY).toBe(0);
		expect(componentRectangle(bottomComponent).maxY).toBe(100);
		expect(() =>
			parseSchematic('resistor:R3 "Clipped top" at (100, 39) #amber', edgeFence)
		).toThrow(/geometry exceeds/);
		expect(() =>
			parseSchematic('resistor:R4 "Clipped bottom" at (100, 59) #amber', edgeFence)
		).toThrow(/geometry exceeds/);

		const wideLabel = '12345678901234567890';
		const left = parseSchematic(`resistor:R5 "${wideLabel}" at (74, 50) #amber`, edgeFence);
		expect(componentRectangle(findComponent(left, 'R5')).minX).toBe(0);
		expect(() =>
			parseSchematic(`resistor:R6 "${wideLabel}" at (73, 50) #amber`, edgeFence)
		).toThrow(/geometry exceeds/);
	});

	test('includes the complete port hotspot radius in intrinsic component bounds', () => {
		const edgeFence: SchematicFence = {
			bounds: { width: 200, height: 120 },
			title: 'Hotspot bounds'
		};
		const left = parseSchematic('resistor:R1 "left" at (46, 60) #amber', edgeFence);
		const right = parseSchematic('resistor:R2 "right" at (154, 60) #blue', edgeFence);
		expect(componentRectangle(findComponent(left, 'R1')).minX).toBe(0);
		expect(componentRectangle(findComponent(right, 'R2')).maxX).toBe(200);
		expect(() => parseSchematic('resistor:R3 "clipped" at (45, 60) #amber', edgeFence)).toThrow(
			/geometry exceeds/
		);
	});
});
