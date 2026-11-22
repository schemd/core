/** Component geometry, port placement, route avoidance, and bridge-crossing verification. */
import { describe, expect, test } from 'vitest';
import {
	canonicalPortName,
	classicalGateHeight,
	compileSchematic,
	composeQuarterTurns,
	connectionLabelPoint,
	distributedCoordinate,
	quantumGateDimensions,
	componentRectangle,
	componentObstacleRectangle,
	componentTextAnchors,
	connectionLabelRectangle,
	enumerateComponentPorts,
	MAX_SCHEMATIC_WIRE_CROSSINGS,
	orientationQuarterTurn,
	parseSchematic,
	positionIcPin,
	inverseQuarterTurn,
	resolvePortPoint,
	rotateQuarterExtents,
	rotateQuarterPoint,
	routeConnection,
	routeConnections,
	SCHEMATIC_BRIDGE_RADIUS,
	SCHEMATIC_OBSTACLE_CLEARANCE,
	SCHEMATIC_ORIENTATIONS,
	validateDocumentGeometry,
	type ClassicalGateComponent,
	type PassiveComponent,
	type PortComponent,
	type RoutedConnection,
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

describe('integer quarter-turn geometry', () => {
	test('normalizes public orientations and composes every turn modulo four', () => {
		expect(SCHEMATIC_ORIENTATIONS).toEqual(['right', 'down', 'left', 'up']);
		expect(SCHEMATIC_ORIENTATIONS.map(orientationQuarterTurn)).toEqual([0, 1, 2, 3]);
		for (const first of [0, 1, 2, 3] as const) {
			for (const second of [0, 1, 2, 3] as const) {
				expect(composeQuarterTurns(first, second)).toBe((first + second) % 4);
			}
			expect(composeQuarterTurns(first, inverseQuarterTurn(first))).toBe(0);
		}
	});

	test('rotates points and vectors exactly without producing negative zero', () => {
		const point = { x: 12.5, y: -7.25 };
		expect(rotateQuarterPoint(point, 0)).toEqual({ x: 12.5, y: -7.25 });
		expect(rotateQuarterPoint(point, 1)).toEqual({ x: 7.25, y: 12.5 });
		expect(rotateQuarterPoint(point, 2)).toEqual({ x: -12.5, y: 7.25 });
		expect(rotateQuarterPoint(point, 3)).toEqual({ x: -7.25, y: -12.5 });

		let rotated = point;
		for (let turn = 0; turn < 4; turn += 1) rotated = rotateQuarterPoint(rotated, 1);
		expect(rotated).toEqual(point);

		for (const turn of [0, 1, 2, 3] as const) {
			const zero = rotateQuarterPoint({ x: -0, y: 0 }, turn);
			expect(Object.is(zero.x, -0)).toBe(false);
			expect(Object.is(zero.y, -0)).toBe(false);
		}
	});

	test('swaps rectangular half-extents only for odd quarter turns', () => {
		const extents = { halfWidth: 42, halfHeight: 18 };
		expect(rotateQuarterExtents(extents, 0)).toEqual(extents);
		expect(rotateQuarterExtents(extents, 1)).toEqual({ halfWidth: 18, halfHeight: 42 });
		expect(rotateQuarterExtents(extents, 2)).toEqual(extents);
		expect(rotateQuarterExtents(extents, 3)).toEqual({ halfWidth: 18, halfHeight: 42 });
		for (const turn of [0, 1, 2, 3] as const) {
			const zero = rotateQuarterExtents({ halfWidth: -0, halfHeight: 0 }, turn);
			expect(Object.is(zero.halfWidth, -0)).toBe(false);
			expect(Object.is(zero.halfHeight, -0)).toBe(false);
		}
	});
});

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
		const cnot = findComponent(document, 'CX1');
		expect(resolvePortPoint(cnot, 'in')).toEqual({ x: 978, y: 171 });
		expect(resolvePortPoint(cnot, 'out')).toEqual({ x: 1062, y: 171 });
		expect(resolvePortPoint(cnot, 'in1')).toEqual({ x: 978, y: 171 });
		expect(resolvePortPoint(cnot, 'in2')).toEqual({ x: 978, y: 189 });
		expect(resolvePortPoint(cnot, 'out1')).toEqual({ x: 1062, y: 171 });
		expect(resolvePortPoint(cnot, 'out2')).toEqual({ x: 1062, y: 189 });
		expect(resolvePortPoint(cnot, 'control')).toEqual({ x: 1020, y: 171 });
		expect(resolvePortPoint(cnot, 'target')).toEqual({ x: 1020, y: 189 });
		expect(resolvePortPoint(findComponent(document, 'A1'), 'in').x).toBe(1212);
		expect(resolvePortPoint(findComponent(document, 'A1'), 'in3').y).toBe(192);
		expect(resolvePortPoint(findComponent(document, 'A1'), 'out').x).toBe(1308);
		expect(resolvePortPoint(findComponent(document, 'A1'), 'out2').y).toBe(188);

		const chip = findComponent(document, 'U1');
		expect(resolvePortPoint(chip, 'A1')).toEqual({
			x: 1370,
			y: 190.667
		});
		expect(resolvePortPoint(chip, 'Y1')).toEqual({
			x: 1490,
			y: 190.667
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
		expect(ids('C1')).toEqual(['in1', 'in2', 'out1', 'out2', 'control', 'target']);
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
			'M 0 100 H -12 V 48 H 254 V 150 H 242'
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
			d: 'M 92 120 H 196 V 72 H 304 V 120 H 408'
		});
		expect(() => componentObstacleRectangle(obstacle, -1)).toThrow(/finite non-negative/);
		expect(() => componentObstacleRectangle(obstacle, Number.NaN)).toThrow(/finite non-negative/);
	});

	test('indexes prior connector labels as hard occupancy and prior channels as soft occupancy', () => {
		const terminal = (
			id: string,
			x: number,
			y: number,
			orientation: PortComponent['orientation'] = 'right'
		): PortComponent => ({ kind: 'port', id, label: id, x, y, orientation, color: token, line: 1 });
		const components = new Map(
			[
				terminal('L', 50, 100),
				terminal('R', 550, 100),
				terminal('T', 300, -20, 'down'),
				terminal('B', 300, 280, 'up'),
				terminal('L2', 70, 180),
				terminal('R2', 570, 180),
				terminal('L3', 30, 180),
				terminal('R3', 590, 180)
			].map((component) => [component.id, component] as const)
		);
		const endpointOnlyMap = {
			get: (id: string) => components.get(id),
			values: () => [][Symbol.iterator]()
		} as unknown as ReadonlyMap<string, SchematicComponent>;
		const connection = (from: string, to: string): SchematicConnection => ({
			from: { componentId: from, port: 'out' },
			to: { componentId: to, port: 'in' },
			color: token,
			curve: 'ortho',
			markerStart: 'none',
			markerEnd: 'none',
			line: 2
		});
		const labeled = { ...connection('L', 'R'), label: 'CONTROL BUS', netId: 'CONTROL' };
		const labelRoutes = routeConnections(
			[labeled, { ...connection('T', 'B'), netId: 'VERTICAL' }],
			endpointOnlyMap,
			{ width: 640, height: 320 }
		);
		expect(connectionLabelRectangle(labeled, labelRoutes[0]!)).toEqual({
			minX: 257.235,
			minY: 80,
			maxX: 342.765,
			maxY: 100
		});
		/* The vertical trace keeps clear of the label box rather than running
		   through it. */
		const box = connectionLabelRectangle(labeled, labelRoutes[0]!)!;
		const vertical = labelRoutes[1]!.points;
		for (let step = 1; step < vertical.length; step += 1) {
			const [a, b] = [vertical[step - 1]!, vertical[step]!];
			const enters =
				Math.max(a.x, b.x) > box.minX && Math.min(a.x, b.x) < box.maxX && Math.max(a.y, b.y) > box.minY && Math.min(a.y, b.y) < box.maxY;
			expect(enters).toBe(false);
		}

		const separated = routeConnections(
			[
				{ ...connection('L2', 'R2'), netId: 'FIRST' },
				{ ...connection('L3', 'R3'), netId: 'SECOND' }
			],
			endpointOnlyMap,
			{ width: 640, height: 320 }
		);
		expect(separated[0]!.d).toBe('M 112 180 H 528');
		/*
		 * The second trace shares the first one's row, so it must leave it — but a
		 * lane one pitch clear of the occupied channel is a far better answer than
		 * the trip to the canvas edge that obstacle-derived lanes alone could offer.
		 */
		expect(separated[1]!.d).toBe('M 72 180 H 96 V 168 H 536 V 180 H 548');
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
		expect(routed[1]!.d).toBe('M 250 49 V 115 A 5 5 0 0 0 250 125 V 191');
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
		expect(reversedVertical[1]!.d).toBe('M 250 191 V 125 A 5 5 0 0 1 250 115 V 49');
	});

	test('deduplicates coincident crossings and bridges each vertical run once', () => {
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
			relation: 'signal',
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
		/* Bridges sit on vertical runs: the horizontal wire stays straight, and a
		   duplicated vertical wire is bridged once per run, not once per copy. */
		expect(routed[3]!.d).toBe('M 92 120 H 408');
		expect(routed[0]!.d).toBe('M 180 49 V 115 A 5 5 0 0 0 180 125 V 191');
		expect(routed[1]!.d).toBe(routed[0]!.d);
		expect(routed[2]!.d).toBe('M 320 49 V 115 A 5 5 0 0 0 320 125 V 191');
		for (const route of routed.slice(0, 3)) expect(route.d.match(/ A /g)).toHaveLength(1);

		const reversed = routeConnections(
			[
				{ ...verticalA, from: verticalA.to, to: verticalA.from },
				{ ...horizontal, from: horizontal.to, to: horizontal.from }
			],
			components
		);
		expect(reversed[0]!.d).toBe('M 180 191 V 125 A 5 5 0 0 1 180 115 V 49');
		expect(reversed[1]!.d).toBe('M 408 120 H 92');
	});

	test('shrinks a bridge beside a parallel wire instead of bulging into it', () => {
		const terminal = (
			id: string,
			x: number,
			y: number,
			orientation: PortComponent['orientation'] = 'right'
		): PortComponent => ({
			kind: 'port', id, label: id, x, y, orientation, color: token, line: 1
		});
		const left = terminal('L', -50, 120);
		const right = terminal('R', 750, 120);
		const topA = terminal('TA', 300, 20, 'down');
		const bottomA = terminal('BA', 300, 220, 'down');
		const topB = terminal('TB', 304, 20, 'down');
		const bottomB = terminal('BB', 304, 220, 'down');
		/* Close beside the left wire, but well below the crossing. */
		const topC = terminal('TC', 296, 170, 'down');
		const bottomC = terminal('BC', 296, 320, 'up');
		const components = new Map(
			[left, right, topA, bottomA, topB, bottomB, topC, bottomC].map((component) => [component.id, component])
		);
		const endpointOnlyMap = {
			get: (id: string) => components.get(id),
			values: () => [][Symbol.iterator]()
		} as unknown as ReadonlyMap<string, SchematicComponent>;
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
				connection('L', 'out', 'R', 'in'),
				connection('TC', 'out', 'BC', 'in')
			],
			endpointOnlyMap
		);
		/* The left wire bulges into open space at full radius; the right one may
		   only use half the gap to its neighbour, so the arcs never touch. */
		expect(routes[2]!.d).toBe('M -8 120 H 708');
		expect(routes[0]!.d).toBe('M 300 62 V 115 A 5 5 0 0 0 300 125 V 178');
		expect(routes[1]!.d).toBe('M 304 62 V 118 A 2 2 0 0 0 304 122 V 178');
		expect(routes[1]!.points).toContainEqual({ x: 302, y: 120 });
	});

	test('rejects subpixel separate-net contacts that cannot render a bridge', () => {
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
		/*
		 * Terminals a ten-thousandth apart leave no channel between them, so the
		 * router reports that it cannot clear them rather than laying a trace whose
		 * bridge arcs would collapse to nothing.
		 */
		expect(() => routeConnections(
			[
				connection('T1', 'out', 'B1', 'out'),
				connection('T2', 'out', 'B2', 'out'),
				connection('L', 'out', 'R', 'in')
			],
			endpointOnlyMap
		)).toThrow(/sit too close to route apart/);
		expect(() => routeConnections(
			[
				connection('L1', 'out', 'R1', 'in'),
				connection('L2', 'out', 'R2', 'in'),
				connection('T', 'out', 'B', 'out')
			],
			endpointOnlyMap
		)).toThrow(/sit too close to route apart/);
	});

	test('rejects crossings between drawn wires, routes ortho around them, and permits shared-net crossings', () => {
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
		const bezier = {
			...base,
			from: { componentId: 'T', port: 'out' },
			to: { componentId: 'B', port: 'out' },
			curve: 'bezier' as const
		};
		/* Drawn wires are fixed copper: two of them may not cross, and an
		   orthogonal wire of another net routes around them whatever the order. */
		expect(() => routeConnections([{ ...base, curve: 'line' }, bezier], components)).toThrow(
			/Separate nets touch or cross/
		);
		expect(routeConnections([base, bezier], components)[0]!.d).toBe('M 92 120 H 196 V -24 H 304 V 120 H 408');
		const routed = routeConnections(
			[
				{ ...base, net: 'SHARED' },
				{ ...bezier, net: 'SHARED' }
			],
			components
		);
		expect(routed[1]!.curve).toBe('bezier');
		expect(routed[1]!.d).toContain(' C ');
		expect(routed[1]!.d).not.toContain(' A ');

		const endpointOnlyMap = {
			get: (id: string) => components.get(id),
			values: () => [][Symbol.iterator]()
		} as unknown as ReadonlyMap<string, SchematicComponent>;
		const avoided = routeConnections([bezier, base], endpointOnlyMap, {
			width: 500,
			height: 260
		});
		expect(avoided[1]!.curve).toBe('ortho');
		expect(avoided[1]!.d).not.toBe('M 92 120 H 408');
	});

	test('rejects collinear and endpoint contacts across separate low-level nets', () => {
		const terminal = (
			id: string,
			x: number,
			y: number,
			orientation: PortComponent['orientation'] = 'right'
		): PortComponent => ({ kind: 'port', id, label: id, x, y, orientation, color: token, line: 1 });
		const components = new Map<string, SchematicComponent>();
		for (const component of [
			terminal('L1', 0, 100),
			terminal('R1', 500, 100),
			terminal('L2', 100, 100),
			terminal('R2', 600, 100),
			terminal('L3', 0, 180),
			terminal('R3', 500, 180),
			terminal('T1', 300, 0, 'down'),
			terminal('B1', 300, 300, 'up'),
			terminal('T2', 300, 80, 'down'),
			terminal('B2', 300, 380, 'up'),
			terminal('TE', 458, 58, 'down'),
			terminal('BE', 458, 300, 'up'),
			terminal('DLA', 0, 0),
			terminal('DLB', 500, 200),
			terminal('DLC', 0, 20),
			terminal('DLD', 500, 220),
			terminal('L4', 0, 500),
			terminal('R4', 500, 500),
			{ kind: 'cnot', id: 'VT', label: 'VT', x: 250, y: 20, color: token, line: 1 },
			{ kind: 'cnot', id: 'VB', label: 'VB', x: 250, y: 220, color: token, line: 1 }
		] satisfies readonly SchematicComponent[]) {
			components.set(component.id, component);
		}
		const connection = (
			from: string,
			to: string,
			curve: SchematicConnection['curve'] = 'line'
		): SchematicConnection => ({
			from: { componentId: from, port: 'out' },
			to: { componentId: to, port: 'in' },
			color: token,
			curve,
			markerStart: 'none',
			markerEnd: 'none',
			line: 30
		});
		const endpointOnlyMap = {
			get: (id: string) => components.get(id),
			values: () => [][Symbol.iterator]()
		} as unknown as ReadonlyMap<string, SchematicComponent>;
		expect(() =>
			routeConnections([connection('L1', 'R1'), connection('L2', 'R2')], endpointOnlyMap)
		).toThrow(/Separate nets touch/);
		expect(() =>
			routeConnections([connection('L1', 'R1'), connection('L3', 'R3')], endpointOnlyMap)
		).not.toThrow();
		expect(() =>
			routeConnections([connection('T1', 'B1'), connection('T2', 'B2')], endpointOnlyMap)
		).toThrow(/Separate nets touch/);
		/*
		 * The same pair as a straight line has nowhere to go and is rejected above.
		 * Orthogonally there is a whole canvas of room, so the router owes the
		 * author two traces in adjacent channels rather than a diagnostic.
		 */
		const sharedColumn = routeConnections(
			[connection('T1', 'B1', 'ortho'), connection('T2', 'B2', 'ortho')],
			endpointOnlyMap
		);
		expect(sharedColumn[0]!.d).not.toBe(sharedColumn[1]!.d);
		expect(sharedColumn.map((route) => route.d)).toEqual([
			'M 300 42 V 108 H 288 V 370 H 300 V 342',
			'M 300 122 V 336 H 312 V 450 H 300 V 422'
		]);
		expect(() =>
			routeConnections(
				[connection('L1', 'R1', 'ortho'), connection('TE', 'BE', 'ortho')],
				endpointOnlyMap
			)
		).toThrow('Line 30: R1.in and TE.out sit too close to route apart as separate nets');
		expect(() =>
			routeConnections(
				[connection('TE', 'BE', 'ortho'), connection('L1', 'R1', 'ortho')],
				endpointOnlyMap
			)
		).toThrow('Line 30: TE.out and R1.in sit too close to route apart as separate nets');
		expect(() =>
			routeConnections([connection('DLA', 'DLB'), connection('DLC', 'DLD')], endpointOnlyMap)
		).not.toThrow();
		const mixed = routeConnections(
			[
				connection('L1', 'R1', 'ortho'),
				{
					...connection('VT', 'VB', 'ortho'),
					from: { componentId: 'VT', port: 'target' },
					to: { componentId: 'VB', port: 'control' }
				},
				connection('L4', 'R4')
			],
			endpointOnlyMap
		);
		expect(mixed[1]!.d).toContain(' A ');
	});

	test('rejects crossings packed too tightly for distinct bridge arcs', () => {
		const horizontalLeft: PortComponent = {
			kind: 'port', id: 'HL', label: 'HL', x: 0, y: 120, color: token, line: 1
		};
		const horizontalRight: PortComponent = { ...horizontalLeft, id: 'HR', x: 600 };
		const vertical = (id: string, x: number, y: number): SchematicComponent => ({
			kind: 'cnot', id, label: id, x, y, color: token, line: 1
		});
		const topA = vertical('TA', 300, 20);
		const bottomA = vertical('BA', 300, 220);
		const nearLeft: PortComponent = { ...horizontalLeft, id: 'NL', y: 120.001 };
		const nearRight: PortComponent = { ...horizontalRight, id: 'NR', y: 120.001 };
		const components = new Map(
			[horizontalLeft, horizontalRight, topA, bottomA, nearLeft, nearRight].map(
				(component) => [component.id, component] as const
			)
		);
		const endpointOnlyMap = {
			get: (id: string) => components.get(id),
			values: () => [][Symbol.iterator]()
		} as unknown as ReadonlyMap<string, SchematicComponent>;
		const connection = (
			from: string,
			fromPort: string,
			to: string,
			toPort: string
		): SchematicConnection => ({
			from: { componentId: from, port: fromPort },
			to: { componentId: to, port: toPort },
			color: token,
			curve: 'ortho',
			markerStart: 'none',
			markerEnd: 'none',
			line: 31
		});
		expect(() =>
			routeConnections(
				[
					connection('HL', 'out', 'HR', 'in'),
					connection('NL', 'out', 'NR', 'in'),
					connection('TA', 'target', 'BA', 'control')
				],
				endpointOnlyMap
			)
		).toThrow(/Wire crossings are too close/);
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
			'Line 9: No orthogonal route from L.out to R.in clears every component and earlier trace: move one of them apart, widen the fence bounds, or join the traces that meet with a shared net.'
		);
	});

	test('keeps other nets off a pin\'s lead rather than bridging it', () => {
		const lookup = new Map<string, SchematicComponent>();
		const terminal = (id: string, x: number, y: number): PortComponent => {
			const component: PortComponent = { kind: 'port', id, label: id, x, y, color: token, line: 1 };
			lookup.set(id, component);
			return component;
		};
		const leftTop = terminal('LT', 50, 54);
		const rightTop = terminal('RT', 450, 54);
		const leftBottom = terminal('LB', 50, 186);
		const rightBottom = terminal('RB', 450, 186);
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
		/* The horizontals would cross the vertical's leads five units from its
		   pins; a lead is never crossed, so they step over the pins instead and
		   the vertical runs clean. */
		expect(routes.map((route) => route.d)).toEqual([
			'M 92 54 H 240 V 36 H 264 V 54 H 408',
			'M 92 186 H 240 V 204 H 264 V 186 H 408',
			'M 250 49 V 191'
		]);
	});

	test('keeps a horizontal wire to one command when other nets pass both of its ends', () => {
		const lookup = new Map<string, SchematicComponent>();
		const terminal = (
			id: string,
			x: number,
			y: number,
			orientation: PortComponent['orientation'] = 'right'
		): PortComponent => {
			const component: PortComponent = { kind: 'port', id, label: id, x, y, orientation, color: token, line: 1 };
			lookup.set(id, component);
			return component;
		};
		const left = terminal('L', 50, 120);
		const right = terminal('R', 450, 120);
		const topLeft = terminal('TL', 94, 20, 'down');
		const bottomLeft = terminal('BL', 94, 220, 'down');
		const topRight = terminal('TR', 406, 20, 'down');
		const bottomRight = terminal('BR', 406, 220, 'down');
		const connection = (from: string, to: string): SchematicConnection => ({
			from: { componentId: from, port: 'out' },
			to: { componentId: to, port: 'in' },
			color: token, curve: 'ortho', markerStart: 'none', markerEnd: 'none', line: 2
		});
		const endpointOnlyMap = {
			get: (id: string) => lookup.get(id),
			values: () => [][Symbol.iterator]()
		} as unknown as ReadonlyMap<string, SchematicComponent>;
		const routes = routeConnections(
			[
				connection(topLeft.id, bottomLeft.id),
				connection(topRight.id, bottomRight.id),
				connection(left.id, right.id)
			],
			endpointOnlyMap
		);
		/* Bridges belong to the vertical runs, so the horizontal wire keeps one
		   command even when crossings sit right at both of its ends. */
		/* Crossing at x = 94 would cross the horizontal's lead, two units from
		   its pin at x = 92; the verticals step round it instead, and the
		   horizontal keeps one command. */
		expect(routes.map((route) => route.d)).toEqual([
			'M 94 62 V 108 H 84 V 132 H 94 V 178',
			'M 406 62 V 108 H 420 V 132 H 406 V 178',
			'M 92 120 H 408'
		]);
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
		}, components)).toThrow(
			'Line 13: TOP.target sits against NEIGHBOR: the wire leaving it would run straight through NEIGHBOR. Move one of them away.'
		);
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
	}, 15_000);

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

	test('allows sequence activation overlap regardless of sweep ordering', () => {
		const activation: SchematicComponent = {
			kind: 'activation',
			id: 'ACTIVE',
			label: 'active',
			x: 240,
			y: 250,
			color: token,
			line: 1,
			bodyWidth: 60,
			bodyHeight: 100
		};
		const lifeline: SchematicComponent = {
			kind: 'lifeline',
			id: 'LIFE',
			label: 'life',
			x: 280,
			y: 250,
			color: token,
			line: 2,
			bodyWidth: 40,
			bodyHeight: 300
		};
		expect(() =>
			validateDocumentGeometry({ components: [activation, lifeline], connections: [] }, fence)
		).not.toThrow();
	});

	test('treats exactly touching component bounds as legal but rejects positive-area overlap', () => {
		const left: SchematicComponent = {
			kind: 'initial', id: 'LEFT', label: 'left', x: 100, y: 100, color: token, line: 1
		};
		const touching: SchematicComponent = {
			...left, id: 'TOUCHING', x: 124, line: 2
		};
		const touchingBelow: SchematicComponent = {
			...left, id: 'TOUCHING_BELOW', y: 124, line: 2
		};
		const overlapping: SchematicComponent = {
			...touching, id: 'OVERLAPPING', x: 123
		};
		expect(() =>
			validateDocumentGeometry({ components: [left, touching], connections: [] }, fence)
		).not.toThrow();
		expect(() =>
			validateDocumentGeometry({ components: [left, touchingBelow], connections: [] }, fence)
		).not.toThrow();
		expect(() =>
			validateDocumentGeometry({ components: [left, overlapping], connections: [] }, fence)
		).toThrow(/OVERLAPPING overlaps LEFT/);
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
		const trace: SchematicConnection = {
			from: { componentId: 'G1', port: 'in1' },
			to: { componentId: 'G1', port: 'out' },
			color: token,
			curve: 'bezier',
			markerStart: 'none',
			markerEnd: 'none',
			line: 8
		};
		/* A route handed in by the caller is checked point by point, control
		   points included. */
		const outside: RoutedConnection = {
			curve: 'bezier',
			d: 'M 60 100 C 100 -40, 100 240, 140 100',
			points: [{ x: 60, y: 100 }, { x: 100, y: -40 }, { x: 100, y: 240 }, { x: 140, y: 100 }]
		};
		expect(() =>
			validateDocumentGeometry({ components: [gate], connections: [trace] }, smallFence, [outside])
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
			designatorWidth: 15.36,
			labelWidth: 20.76
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
		const left = parseSchematic(`resistor:R5 "${wideLabel}" at (71.2, 50) #amber`, edgeFence);
		expect(componentRectangle(findComponent(left, 'R5')).minX).toBe(0);
		expect(() =>
			parseSchematic(`resistor:R6 "${wideLabel}" at (71.1, 50) #amber`, edgeFence)
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

describe('public layout helpers', () => {
	const color = token;

	test('keep the 0.x numbers, with gate boxes sized to their measured text', () => {
		expect([0, 1, 2].map((index) => distributedCoordinate(index, 3, 40))).toEqual([-10, 0, 10]);
		expect(distributedCoordinate(0, 1, 40)).toBe(0);
		const gate: ClassicalGateComponent = { kind: 'and', id: 'G', label: 'G', x: 0, y: 0, color, line: 1, inputs: 5, outputs: 2, standard: 'ieee' };
		expect(classicalGateHeight(gate)).toBe(80);
		expect(classicalGateHeight({ ...gate, inputs: 1, outputs: 1 })).toBe(48);
		expect(quantumGateDimensions({ kind: 'hadamard', id: 'Q', label: 'H', x: 0, y: 0, color, line: 1 } as never)).toEqual({ bodyWidth: 50, bodyHeight: 50, stubExtent: 48 });
		expect(quantumGateDimensions({ kind: 'qgate', id: 'Q', label: 'Rot', x: 0, y: 0, color, line: 1, parameter: 'theta/2', phase: 'pi' } as never)).toEqual({
			bodyWidth: 50.8,
			bodyHeight: 80,
			stubExtent: 48.4
		});
	});

	test('place a connector label at the half-length point of a bent route', () => {
		const fence = { bounds: { width: 600, height: 400 }, title: 'label' } as const;
		const result = compileSchematic('port:A "A" at (60,100) #blue\nport:B "B" at (150,300) #blue\nA.out -> B.in #blue [ortho label="bus"]', fence);
		const connection = result.document.connections[0]!;
		const [route] = routeConnections(result.document.connections, new Map(result.document.components.map((component) => [component.id, component])), fence.bounds);
		/* The half-length point lies past the first, short segment. */
		const point = connectionLabelPoint(route!);
		expect(route!.points[1]).not.toEqual(point);
		const rectangle = connectionLabelRectangle(connection, route!)!;
		expect(rectangle.maxY).toBe(point.y);
		expect((rectangle.minX + rectangle.maxX) / 2).toBe(point.x);
		expect(connectionLabelRectangle({ ...connection, label: undefined } as never, route!)).toBeUndefined();
	});
});

describe('container overlaps', () => {
	const fence = { bounds: { width: 900, height: 600 }, title: 'containers' } as const;

	test('a body half inside a container still overlaps it', () => {
		expect(() =>
			parseSchematic('package:P "Package" at (350,260) #slate [width=500 height=360]\nresistor:R1 "R" at (100,260) #amber', fence)
		).toThrow(/overlaps/);
	});

	test('a component port may straddle the edge only with its centre on the container', () => {
		expect(() =>
			parseSchematic('component:C "C" at (350,260) #slate [width=500 height=360]\ncomponent-port:CP "Port" at (100,260) #blue', fence)
		).not.toThrow();
		expect(() =>
			parseSchematic('component:C "C" at (350,260) #slate [width=500 height=360]\ncomponent-port:CP "Port" at (95,260) #blue', fence)
		).toThrow(/overlaps/);
	});
});

describe('drawn wires and terminals', () => {
	const fence = { bounds: { width: 600, height: 400 }, title: 'drawn' } as const;
	const parts = 'resistor:R1 "a" at (100, 100) #amber\nresistor:R2 "b" at (500, 100) #amber\nresistor:R3 "c" at (300, 142) #amber [orientation=down]';

	test('a straight wire through a third component\'s terminal is rejected', () => {
		expect(() => parseSchematic(`${parts}\nR1.out -> R2.in #amber [line]`, fence)).toThrow(
			'Line 4: Line route passes through R3.in, which it does not connect; use an orthogonal route or move R3.'
		);
		/* A Bézier between level terminals is the same straight stroke. */
		expect(() => parseSchematic(`${parts}\nR1.out -> R2.in #amber [bezier]`, fence)).toThrow('Line 4: Bézier route passes through R3.in');
	});

	test('the terminal may be passed when it is on the wire\'s own net', () => {
		expect(() => parseSchematic(`${parts}\nR1.out -> R3.in #amber [ortho]\nR1.out -> R2.in #amber [line]`, fence)).not.toThrow();
	});

	test('a terminal inside the wire\'s reach but off its line is no contact', () => {
		expect(() =>
			parseSchematic('resistor:R1 "a" at (100, 100) #amber\nresistor:R2 "b" at (500, 300) #amber\nresistor:R3 "c" at (300, 300) #amber\nR1.out -> R2.in #amber [line]', fence)
		).not.toThrow();
	});
});

describe('bridges and same-net dots on bare terminals', () => {
	const terminal = (id: string, x: number, y: number, orientation: PortComponent['orientation'] = 'right'): PortComponent => ({
		kind: 'port',
		id,
		label: id,
		x,
		y,
		orientation,
		color: token,
		line: 1
	});
	const terminals = (...list: PortComponent[]) => {
		const components = new Map(list.map((component) => [component.id, component] as const));
		return { get: (id: string) => components.get(id), values: () => [][Symbol.iterator]() } as unknown as ReadonlyMap<string, SchematicComponent>;
	};
	const connection = (from: string, fromPort: string, to: string, toPort: string, extra: Partial<SchematicConnection> = {}): SchematicConnection => ({
		from: { componentId: from, port: fromPort },
		to: { componentId: to, port: toPort },
		color: token,
		curve: 'ortho',
		markerStart: 'none',
		markerEnd: 'none',
		line: 2,
		...extra
	});

	test('a bridge that ends exactly at a corner adds no zero-length run', () => {
		const routes = routeConnections(
			[connection('L', 'out', 'R', 'in'), connection('T', 'out', 'P', 'in')],
			terminals(terminal('L', 50, 100), terminal('R', 600, 100), terminal('T', 300, 20, 'down'), terminal('P', 450, 104))
		);
		expect(routes.map((route) => route.d)).toEqual(['M 92 100 H 558', 'M 300 62 V 96 A 4 4 0 0 0 300 104 H 408']);
	});

	test('one wire crossing two runs of its own net carries a dot at each', () => {
		const net = { netId: 'N', net: 'N' } as Partial<SchematicConnection>;
		const routes = routeConnections(
			[connection('A', 'out', 'B', 'in', net), connection('C', 'out', 'D', 'in', net), connection('T', 'out', 'U', 'out', net)],
			terminals(terminal('A', 50, 100), terminal('B', 600, 100), terminal('C', 50, 200), terminal('D', 600, 200), terminal('T', 300, 20, 'down'), terminal('U', 300, 300, 'up')),
			{ width: 650, height: 340 }
		);
		expect(routes[2]).toMatchObject({ d: 'M 300 62 V 258', joins: [{ x: 300, y: 100 }, { x: 300, y: 200 }] });
		expect(routes[0]!.joins).toBeUndefined();
		expect(() => canonicalPortName(terminal('A', 50, 100), 'nonexistent')).toThrow('Validated port A.nonexistent is missing.');
	});
});
