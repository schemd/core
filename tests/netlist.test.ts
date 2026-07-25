import { describe, expect, test } from 'vitest';

import {
	buildNetlist,
	inspectSchematic,
	parseSchematic,
	SCHEMATIC_RULE_CODES,
	SCHEMATIC_RULES,
	verifyNetlist,
	type SchematicDocument,
	type SchematicFence,
	type SchematicSignalKind
} from '../src/index.js';

const fence: SchematicFence = {
	bounds: { width: 1200, height: 700 },
	title: 'Netlist fixture'
};

const parse = (lines: readonly string[]): SchematicDocument =>
	parseSchematic(lines.join('\n'), fence);

const codes = (document: SchematicDocument): string[] =>
	inspectSchematic(document).diagnostics.map((diagnostic) => diagnostic.code);

/**
 * Overrides for a hand-built connection. `null` means "leave the field out",
 * which is how a document that carries no net identity at all is expressed.
 */
interface ConnectionOverrides {
	readonly netId?: string | null;
	readonly net?: string | null;
	readonly width?: number;
	readonly signalKind?: SchematicSignalKind;
	readonly line?: number;
	readonly from?: { componentId: string; port: string };
	readonly to?: { componentId: string; port: string };
}

/** A minimal hand-built document, for shapes the grammar cannot express. */
function syntheticDocument(connections: readonly ConnectionOverrides[]): SchematicDocument {
	const base = parse([
		'port:A "A" at (100, 150) #blue',
		'port:B "B" at (400, 150) #blue',
		'A.out -> B.in #blue [line]'
	]);
	return {
		components: base.components,
		connections: connections.map((overrides, index) => {
			const merged: Record<string, unknown> = {
				...base.connections[0]!,
				line: index + 4,
				...overrides
			};
			for (const key of ['netId', 'net']) if (merged[key] === null) delete merged[key];
			return merged as unknown as SchematicDocument['connections'][number];
		})
	};
}

describe('buildNetlist', () => {
	test('reports every component with its stable ports', () => {
		const netlist = buildNetlist(
			parse([
				'source:V1 "AC" at (100, 150) #blue [type=voltage-ac]',
				'resistor:R1 "1 k" at (360, 150) #amber',
				'V1.positive -> R1.in #blue [line]'
			])
		);
		expect(netlist.nodes.map((node) => node.id)).toEqual(['V1', 'R1']);
		expect(netlist.nodes[0]?.ports).toEqual(['negative', 'positive']);
		expect(netlist.nodes[0]).toMatchObject({ kind: 'source', label: 'AC', x: 100, y: 150 });
		expect(netlist.nodes[1]?.ports).toContain('in');
	});

	test('groups terminals that share a node into one net, without duplicates', () => {
		const netlist = buildNetlist(
			parse([
				'port:A "A" at (100, 150) #blue',
				'port:B "B" at (100, 340) #blue',
				'and:G1 "AND" at (460, 240) #purple',
				'A.out -> G1.in1 #blue [digital]',
				'B.out -> G1.in1 #blue [digital]'
			])
		);
		expect(netlist.nets).toHaveLength(1);
		expect(netlist.nets[0]?.terminals.map((terminal) => `${terminal.componentId}.${terminal.port}`))
			.toEqual(['A.out', 'G1.in1', 'B.out']);
		expect(netlist.nets[0]?.lines).toEqual([4, 5]);
		expect(netlist.nets[0]?.signalKinds).toEqual(['digital']);
	});

	test('keeps unrelated connections in separate nets', () => {
		const netlist = buildNetlist(
			parse([
				'source:V1 "AC" at (100, 150) #blue [type=voltage-ac]',
				'resistor:R1 "1 k" at (360, 150) #amber',
				'ground:GND "0 V" at (620, 150) #slate',
				'V1.positive -> R1.in #blue [line]',
				'R1.out -> GND.in #slate [line]'
			])
		);
		expect(netlist.nets).toHaveLength(2);
		expect(netlist.edges.map((edge) => edge.line)).toEqual([4, 5]);
	});

	test('carries the author net name and declared width', () => {
		const netlist = buildNetlist(
			parse([
				'port:DIN "D" at (100, 150) #blue [width=8]',
				'register:REG "Q" at (500, 150) #purple [width=8]',
				'DIN.out -> REG.in #blue [digital width=8 net=databus]'
			])
		);
		expect(netlist.nets[0]?.name).toBe('databus');
		expect(netlist.nets[0]?.widths).toEqual([8]);
		expect(netlist.edges[0]?.width).toBe(8);
	});

	test('treats an unmarked trace as electrical and an unnamed net as anonymous', () => {
		const netlist = buildNetlist(
			parse([
				'port:A "A" at (100, 150) #blue',
				'port:B "B" at (400, 150) #blue',
				'A.out -> B.in #blue [line]'
			])
		);
		expect(netlist.edges[0]?.signalKind).toBe('electrical');
		expect(netlist.edges[0]?.width).toBeUndefined();
		expect(netlist.nets[0]?.name).toBeUndefined();
		expect(netlist.nets[0]?.widths).toEqual([]);
	});

	test('falls back to a line-scoped net identity when a connection carries none', () => {
		const netlist = buildNetlist(syntheticDocument([{ netId: null }]));
		expect(netlist.nets[0]?.id).toBe('$line-4');
	});

	test('adopts a name declared on a later connection of the same net', () => {
		const netlist = buildNetlist(
			syntheticDocument([
				{ netId: 'n1', net: null },
				{ netId: 'n1', net: 'late-name' }
			])
		);
		expect(netlist.nets).toHaveLength(1);
		expect(netlist.nets[0]?.name).toBe('late-name');
	});
});

describe('verifyNetlist', () => {
	test('passes a well-formed circuit', () => {
		expect(
			codes(
				parse([
					'source:V1 "AC" at (100, 150) #blue [type=voltage-ac]',
					'resistor:R1 "1 k" at (360, 150) #amber',
					'ground:GND "0 V" at (620, 150) #slate',
					'V1.positive -> R1.in #blue [line]',
					'R1.out -> GND.in #slate [line]',
					'V1.negative -> GND.in #slate [ortho]'
				])
			)
		).toEqual([]);
	});

	test('flags two supplies tied to one net', () => {
		const diagnostics = inspectSchematic(
			parse([
				'source:V1 "AC" at (100, 150) #blue [type=voltage-ac]',
				'resistor:R1 "1 k" at (360, 150) #amber',
				'ground:GND "0 V" at (620, 150) #slate',
				'V1.positive -> R1.in #blue [line net=rail]',
				'R1.out -> GND.in #slate [line net=rail]'
			])
		).diagnostics;
		expect(diagnostics[0]).toMatchObject({
			code: 'shorted-supply',
			severity: 'error',
			subjects: ['V1', 'GND'],
			line: 4
		});
		expect(diagnostics[0]?.message).toContain('rail');
	});

	test('flags conflicting widths on one net', () => {
		const diagnostics = verifyNetlist(
			buildNetlist(
				syntheticDocument([
					{ netId: 'bus', net: 'bus', width: 8, signalKind: 'digital' },
					{ netId: 'bus', net: 'bus', width: 4, signalKind: 'digital' }
				])
			)
		);
		expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain('width-mismatch');
		expect(diagnostics[0]?.message).toContain('4 and 8');
	});

	test('flags a net that mixes signal domains', () => {
		const diagnostics = verifyNetlist(
			buildNetlist(
				syntheticDocument([
					{ netId: 'mixed', net: 'mixed', signalKind: 'quantum' },
					{ netId: 'mixed', net: 'mixed', signalKind: 'digital' }
				])
			)
		);
		expect(diagnostics[0]).toMatchObject({ code: 'domain-mismatch', severity: 'error' });
		expect(diagnostics[0]?.message).toContain('digital and quantum');
	});

	test('flags a component nothing connects to', () => {
		const diagnostics = inspectSchematic(
			parse([
				'port:A "A" at (100, 150) #blue',
				'port:B "B" at (400, 150) #blue',
				'resistor:R9 "spare" at (800, 400) #amber',
				'A.out -> B.in #blue [line]'
			])
		).diagnostics;
		expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
			'unconnected-component',
			'disconnected-subcircuit'
		]);
		expect(diagnostics[0]).toMatchObject({ subjects: ['R9'], line: undefined });
	});

	test('flags the same pair of terminals connected twice, in either direction', () => {
		const diagnostics = verifyNetlist(
			buildNetlist(
				syntheticDocument([
					{ netId: 'n1' },
					{
						netId: 'n1',
						from: { componentId: 'B', port: 'in' },
						to: { componentId: 'A', port: 'out' }
					}
				])
			)
		);
		const duplicate = diagnostics.find((entry) => entry.code === 'duplicate-connection');
		expect(duplicate).toMatchObject({ severity: 'warning', line: 5 });
		expect(duplicate?.message).toContain('line 4');
	});

	test('flags two digital outputs driving one net', () => {
		const diagnostics = inspectSchematic(
			parse([
				'port:A "A" at (100, 150) #blue',
				'port:B "B" at (100, 340) #blue',
				'and:G1 "AND" at (460, 240) #purple',
				'A.out -> G1.in1 #blue [digital]',
				'B.out -> G1.in1 #blue [digital]'
			])
		).diagnostics;
		expect(diagnostics[0]).toMatchObject({
			code: 'multiple-drivers',
			severity: 'warning',
			subjects: ['A.out', 'B.out']
		});
	});

	test('leaves analog terminals sharing a node alone', () => {
		/* Two analog `out` terminals on one node is ordinary topology, not
		   contention — the rule must stay quiet outside digital domains. */
		expect(
			codes(
				parse([
					'resistor:R1 "1 k" at (100, 150) #amber',
					'resistor:R2 "2 k" at (100, 340) #amber',
					'junction:N1 "node" at (460, 240) #cyan',
					'R1.out -> N1.node #amber [line]',
					'R2.out -> N1.node #amber [line]'
				])
			)
		).toEqual([]);
	});

	test('reports independent groups once, and stays quiet for a single group', () => {
		const split = inspectSchematic(
			parse([
				'port:A "A" at (100, 150) #blue',
				'port:B "B" at (400, 150) #blue',
				'port:C "C" at (100, 400) #cyan',
				'port:D "D" at (400, 400) #cyan',
				'A.out -> B.in #blue [line]',
				'C.out -> D.in #cyan [line]'
			])
		).diagnostics;
		expect(split).toHaveLength(1);
		expect(split[0]).toMatchObject({
			code: 'disconnected-subcircuit',
			severity: 'info',
			subjects: []
		});
		expect(split[0]?.message).toContain('2 independent');
	});

	test('orders diagnostics by severity, then line, then code', () => {
		const diagnostics = verifyNetlist(
			buildNetlist(
				syntheticDocument([
					{
						netId: 'bus',
						net: 'bus',
						width: 8,
						signalKind: 'digital',
						line: 9,
						to: { componentId: 'B', port: 'in2' }
					},
					{
						netId: 'bus',
						net: 'bus',
						width: 4,
						signalKind: 'quantum',
						line: 9,
						to: { componentId: 'B', port: 'in3' }
					},
					{ netId: 'n2', line: 4 },
					{
						netId: 'n2',
						line: 5,
						from: { componentId: 'B', port: 'in' },
						to: { componentId: 'A', port: 'out' }
					}
				])
			)
		);
		expect(diagnostics.map((diagnostic) => [diagnostic.severity, diagnostic.code])).toEqual([
			['error', 'domain-mismatch'],
			['error', 'width-mismatch'],
			['warning', 'duplicate-connection']
		]);
	});

	test('handles a document with no connections at all', () => {
		const netlist = buildNetlist(
			parse(['port:A "A" at (100, 150) #blue', 'port:B "B" at (400, 150) #blue'])
		);
		expect(netlist.nets).toEqual([]);
		expect(verifyNetlist(netlist).map((diagnostic) => diagnostic.code)).toEqual([
			'unconnected-component',
			'unconnected-component',
			'disconnected-subcircuit'
		]);
	});

	test('tolerates an edge that names a component the document never declared', () => {
		/* A hand-assembled document can reference an unknown terminal; nothing in
		   the rules may assume every edge resolves to a declared component. */
		const base = parse([
			'port:A "A" at (100, 150) #blue',
			'port:B "B" at (400, 150) #blue',
			'port:C "C" at (700, 150) #blue',
			'A.out -> B.in #blue [line]'
		]);
		const template = base.connections[0]!;
		const netlist = buildNetlist({
			components: base.components,
			connections: [
				{ ...template, netId: 'n1', line: 5 },
				{
					...template,
					netId: 'n2',
					line: 6,
					from: { componentId: 'B', port: 'out' },
					to: { componentId: 'C', port: 'in' }
				},
				{
					...template,
					netId: 'n3',
					line: 7,
					from: { componentId: 'C', port: 'out' },
					to: { componentId: 'GHOST', port: 'in' }
				}
			]
		});
		expect(netlist.nodes).toHaveLength(3);
		/* One chain A–B–C–GHOST: every declared node ends up in a single group. */
		expect(verifyNetlist(netlist)).toEqual([]);
	});

	test('handles an empty document', () => {
		const netlist = buildNetlist({ components: [], connections: [] });
		expect(netlist).toEqual({ nodes: [], nets: [], edges: [] });
		expect(verifyNetlist(netlist)).toEqual([]);
	});
});

describe('rule catalogue', () => {
	test('documents every code exactly once, with a matching severity', () => {
		expect(Object.keys(SCHEMATIC_RULES).sort()).toEqual([...SCHEMATIC_RULE_CODES].sort());
		for (const code of SCHEMATIC_RULE_CODES) {
			expect(SCHEMATIC_RULES[code].summary.endsWith('.')).toBe(true);
			expect(['error', 'warning', 'info']).toContain(SCHEMATIC_RULES[code].severity);
		}
	});

	test('every rule reports the severity its catalogue entry promises', () => {
		const observed = new Map(
			verifyNetlist(
				buildNetlist(
					syntheticDocument([
						{ netId: 'bus', net: 'bus', width: 8, signalKind: 'digital' },
						{
							netId: 'bus',
							net: 'bus',
							width: 4,
							signalKind: 'quantum',
							to: { componentId: 'B', port: 'in2' }
						},
						{ netId: 'bus', net: 'bus', width: 4, signalKind: 'quantum' }
					])
				)
			).map((diagnostic) => [diagnostic.code, diagnostic.severity])
		);
		for (const [code, severity] of observed) {
			expect(severity).toBe(SCHEMATIC_RULES[code].severity);
		}
	});
});
