/**
 * Relative placement: the lowering pass that resolves relations to coordinates.
 *
 * The load-bearing test here is `compiles to the same bytes as the absolute form
 * it lowers to`. Everything else checks a rule; that one checks the *premise* —
 * that this is a front-end and nothing downstream can tell which position form an
 * author wrote. If it ever fails, the pass has stopped being a lowering and has
 * become a second way to compile, which is the thing this design exists to avoid.
 */
import { describe, expect, test } from 'vitest';

import {
	compileSchematic,
	parseSchematic,
	PLACEMENT_HORIZONTAL_GAP,
	PLACEMENT_VERTICAL_GAP,
	SCHEMATIC_PLACEMENT_KINDS,
	type SchematicFence
} from '../src/index.js';

const fence: SchematicFence = { bounds: { width: 1200, height: 800 }, title: 'Placement fixture' };

/** Compile and index the resolved coordinates by component id. */
function resolved(source: string, options: Partial<SchematicFence> = {}) {
	const compilation = compileSchematic(source, { ...fence, ...options });
	return {
		compilation,
		at: new Map(compilation.document.components.map((part) => [part.id, { x: part.x, y: part.y }]))
	};
}

describe('placement grammar', () => {
	test('accepts every documented relation kind', () => {
		/* The vocabulary the parser admits and the exported list must be one thing:
		   a kind in the list that the parser rejects is a documentation lie, and a
		   kind the parser accepts that is missing from the list is invisible to
		   every host that builds a picker from it. */
		for (const kind of SCHEMATIC_PLACEMENT_KINDS) {
			const clause = kind.startsWith('aligned') ? `${kind} with A` : `${kind} A`;
			const source = `resistor:A "A" at (400, 400) #amber\nresistor:B "B" ${clause} #cyan`;
			let thrown: unknown;
			try {
				parseSchematic(source, fence);
			} catch (error) {
				thrown = error;
			}
			/*
			 * The claim is that the lexer admits the kind, not that this two-part
			 * document is well formed: an alignment on its own lands B exactly on A,
			 * which the overlap rule rejects for good reason. A rejection *by name* is
			 * what would mean the vocabulary and the exported list had drifted apart.
			 */
			expect(String(thrown ?? ''), kind).not.toMatch(/Unrecognized schematic declaration/);
		}
	});

	test('leaves the absolute form untouched', () => {
		const { compilation } = resolved(
			`resistor:R1 "R" at (400, 400) #amber\nresistor:R2 "R" at (700, 400) #cyan`
		);
		/* A document that states no relation reports no placements, so a host that
		   never adopted the syntax sees exactly the result it saw before 0.5. */
		expect(compilation.placements).toEqual([]);
	});

	test('reads a colour and options tail after the placement clause', () => {
		const { compilation } = resolved(
			`source:VIN "AC" at (120, 400) #blue [type=voltage-ac]\n` +
				`capacitor:C1 "100 nF" right-of VIN by 200 #cyan [orientation=down]`
		);
		const capacitor = compilation.document.components.find((part) => part.id === 'C1')!;
		expect(capacitor.color).toEqual({ kind: 'token', value: 'cyan' });
		expect(capacitor).toMatchObject({ kind: 'capacitor', orientation: 'down' });
	});

	test('rejects a line that is neither position form', () => {
		expect(() => parseSchematic(`resistor:R1 "R" beside R2 #amber`, fence)).toThrow(
			/Unrecognized schematic declaration/
		);
	});

	test('rejects a placement clause with no colour tail', () => {
		/* `right-of A` alone leaves nothing for the colour and options, and the tail
		   is not optional in either position form. */
		expect(() =>
			parseSchematic(`resistor:A "A" at (400, 400) #amber\nresistor:B "B" right-of A`, fence)
		).toThrow(/Unrecognized schematic declaration/);
	});
});

describe('resolution', () => {
	test('places a body clear of the reference by the stated gap', () => {
		const { at } = resolved(
			`resistor:A "A" at (300, 400) #amber\nresistor:B "B" right-of A by 200 #cyan`
		);
		/* The gap is clear space between facing edges, not a centre-to-centre
		   distance: an author asking for 200 units of room means room. */
		expect(at.get('B')!.x - at.get('A')!.x).toBeGreaterThan(200);
		/* And the unconstrained axis comes from the reference, so "right of A" puts
		   B level with A rather than at the top of the canvas. */
		expect(at.get('B')!.y).toBe(400);
	});

	test('mirrors right-of and left-of about the same pair', () => {
		const right = resolved(
			`resistor:A "A" at (600, 400) #amber\nresistor:B "B" right-of A by 150 #cyan`
		).at;
		const left = resolved(
			`resistor:A "A" at (600, 400) #amber\nresistor:B "B" left-of A by 150 #cyan`
		).at;
		expect(right.get('B')!.x - 600).toBe(600 - left.get('B')!.x);
		expect(right.get('B')!.y).toBe(400);
		expect(left.get('B')!.y).toBe(400);
	});

	test('mirrors above and below about the same pair', () => {
		const below = resolved(
			`resistor:A "A" at (600, 400) #amber\nresistor:B "B" below A by 150 #cyan`
		).at;
		const above = resolved(
			`resistor:A "A" at (600, 400) #amber\nresistor:B "B" above A by 150 #cyan`
		).at;
		expect(below.get('B')!.y - 400).toBe(400 - above.get('B')!.y);
		expect(below.get('B')!.x).toBe(600);
	});

	test('takes one axis from each of two references', () => {
		/* Alignments are how a part joins a column belonging to one component and a
		   row belonging to another — the case the inherited axis cannot express. */
		const { at } = resolved(
			`resistor:A "A" at (250, 200) #amber\n` +
				`resistor:B "B" at (800, 620) #cyan\n` +
				`resistor:C "C" aligned-x with A aligned-y with B #emerald`
		);
		expect(at.get('C')).toEqual({ x: 250, y: 620 });
	});

	test('lets an alignment override the axis a direction set', () => {
		const { at } = resolved(
			`resistor:A "A" at (250, 200) #amber\n` +
				`resistor:B "B" at (900, 650) #cyan\n` +
				`resistor:C "C" right-of A by 200 aligned-x with B #emerald`
		);
		/* `right-of A` set x, then `aligned-x with B` overwrote it — the same axis,
		   twice, last word winning. y is still inherited from the first reference. */
		expect(at.get('C')).toEqual({ x: 900, y: 200 });
	});

	test('applies the axis default when by is omitted', () => {
		/* The two defaults are part of the contract, so they are pinned against the
		   exported constants rather than against the numbers they happen to be. */
		const horizontal = resolved(
			`resistor:A "A" at (300, 400) #amber\nresistor:B "B" right-of A #cyan`
		).at;
		const explicit = resolved(
			`resistor:A "A" at (300, 400) #amber\nresistor:B "B" right-of A by ${PLACEMENT_HORIZONTAL_GAP} #cyan`
		).at;
		expect(horizontal.get('B')).toEqual(explicit.get('B'));

		const vertical = resolved(
			`resistor:A "A" at (300, 300) #amber\nresistor:B "B" below A #cyan`
		).at;
		const verticalExplicit = resolved(
			`resistor:A "A" at (300, 300) #amber\nresistor:B "B" below A by ${PLACEMENT_VERTICAL_GAP} #cyan`
		).at;
		expect(vertical.get('B')).toEqual(verticalExplicit.get('B'));
		expect(PLACEMENT_HORIZONTAL_GAP).not.toBe(PLACEMENT_VERTICAL_GAP);
	});

	test('lets the later relation win the axis it constrains', () => {
		/* Documented behaviour, not an accident: relations are applied in reading
		   order, so an author scanning left to right sees the last word on each
		   axis. Here x comes from A and y from B. */
		const { at } = resolved(
			`resistor:A "A" at (300, 200) #amber\n` +
				`resistor:B "B" at (800, 600) #cyan\n` +
				`resistor:C "C" right-of A by 100 aligned-y with B #emerald`
		);
		expect(at.get('C')!.y).toBe(600);
		expect(at.get('C')!.x).toBeGreaterThan(300);
		expect(at.get('C')!.x).toBeLessThan(800);
	});

	test('resolves a reference to a declaration further down the document', () => {
		/* Forward references are permitted on purpose: the sort does not care about
		   declaration order, so requiring declare-before-use would be a restriction
		   with nothing behind it. */
		const { at } = resolved(
			`resistor:B "B" right-of A by 200 #cyan\nresistor:A "A" at (300, 400) #amber`
		);
		expect(at.get('A')).toEqual({ x: 300, y: 400 });
		expect(at.get('B')!.x).toBeGreaterThan(300);
		expect(at.get('B')!.y).toBe(400);
	});

	test('resolves a chain through several relative declarations', () => {
		const { at } = resolved(
			`resistor:A "A" at (150, 400) #amber\n` +
				`resistor:B "B" right-of A by 150 #cyan\n` +
				`resistor:C "C" right-of B by 150 #emerald\n` +
				`resistor:D "D" right-of C by 150 #purple`
		);
		const xs = ['A', 'B', 'C', 'D'].map((id) => at.get(id)!.x);
		expect(xs).toEqual([...xs].sort((left, right) => left - right));
		expect(new Set([...at.values()].map((point) => point.y)).size).toBe(1);
	});

	test('anchors against a named terminal rather than the body', () => {
		const body = resolved(
			`resistor:A "A" at (400, 400) #amber\nresistor:B "B" below A by 100 #cyan`
		).at;
		const terminal = resolved(
			`resistor:A "A" at (400, 400) #amber\nresistor:B "B" below A.out by 100 #cyan`
		).at;
		/* A terminal is a point inside the body, so measuring from it puts the
		   subject higher than measuring from the body's lower edge. */
		expect(terminal.get('B')!.y).toBeLessThan(body.get('B')!.y);
	});

	test('folds a port alias to the terminal the compiler uses', () => {
		const alias = resolved(
			`resistor:A "A" at (400, 400) #amber\nresistor:B "B" right-of A.r by 100 #cyan`
		);
		const canonical = resolved(
			`resistor:A "A" at (400, 400) #amber\nresistor:B "B" right-of A.out by 100 #cyan`
		);
		expect(alias.at.get('B')).toEqual(canonical.at.get('B'));
		/* The reported relation must agree with the netlist about which lead it
		   anchored to, so the alias does not survive into the report. */
		expect(alias.compilation.placements[0]!.relations[0]!.port).toBe('out');
	});
});

describe('the reported placements', () => {
	test('carry the resolved coordinates and the relations as written', () => {
		const { compilation, at } = resolved(
			`resistor:A "A" at (300, 200) #amber\n` +
				`resistor:B "B" at (300, 650) #cyan\n` +
				`resistor:C "C" right-of A by 175 aligned-y with B #emerald`
		);
		expect(compilation.placements).toHaveLength(1);
		expect(compilation.placements[0]).toEqual({
			id: 'C',
			line: 3,
			resolved: at.get('C'),
			relations: [
				{ kind: 'right-of', ref: 'A', gap: 175 },
				{ kind: 'aligned-y', ref: 'B' }
			]
		});
	});

	test('are ordered by source line whatever order they resolved in', () => {
		/*
		 * Evaluation order provably cannot reach the coordinates — a position is a
		 * function of its references' positions, never of when it was visited — but
		 * it can reach this array. Here the resolution order is forced to be the
		 * reverse of the source order: Z on line 2 depends on M on line 3, which
		 * depends on A on line 4.
		 */
		const { compilation } = resolved(
			`resistor:A "A" at (200, 400) #amber\n` +
				`resistor:Z "Z" right-of M by 120 #purple\n` +
				`resistor:M "M" right-of A by 120 #cyan\n` +
				`resistor:Q "Q" below A by 120 #emerald`
		);
		expect(compilation.placements.map((placement) => placement.line)).toEqual([2, 3, 4]);
		expect(compilation.placements.map((placement) => placement.id)).toEqual(['Z', 'M', 'Q']);
	});
});

describe('equivalence with the absolute form', () => {
	const cases = [
		{
			name: 'RC low-pass',
			relative:
				`source:VIN "AC" at (120, 300) #blue [type=voltage-ac]\n` +
				`resistor:R1 "1 k\\Omega" right-of VIN by 190 #amber\n` +
				`junction:VOUT "V_{out}" right-of R1 by 190 #cyan\n` +
				`capacitor:C1 "100 nF" below VOUT by 140 #cyan [orientation=down]\n` +
				`VIN.positive -> R1.in #blue [line]\n` +
				`R1.out -> VOUT.node #amber [line]\n` +
				`VOUT.node -> C1.in #cyan [ortho]`
		},
		{
			name: 'a chain that resolves backwards',
			relative:
				`resistor:C "C" right-of B by 150 #emerald\n` +
				`resistor:B "B" right-of A by 150 #cyan\n` +
				`resistor:A "A" at (200, 400) #amber\n` +
				`A.out -> B.in #amber [line]\n` +
				`B.out -> C.in #cyan [line]`
		},
		{
			name: 'alignment against a terminal',
			relative:
				`port:IN "D" at (150, 250) #blue\n` +
				`and:G1 "AND" right-of IN by 220 aligned-y with IN.out #purple\n` +
				`port:OUT "Q" right-of G1 by 220 #emerald\n` +
				`IN.out -> G1.in1 #blue [ortho]\n` +
				`G1.out -> OUT.in #purple [ortho]`
		}
	];

	test.each(cases)('$name compiles to the same bytes as the absolute form', ({ relative }) => {
		const relativeCompilation = compileSchematic(relative, fence);
		/*
		 * The absolute form is generated from the resolved coordinates rather than
		 * written by hand, because hand-writing it would mean predicting text metrics
		 * and the test would be pinning my arithmetic instead of the property. What
		 * is asserted is the property that matters: rewriting each relative
		 * declaration as the `at (x, y)` it lowered to produces the same SVG, byte
		 * for byte, which is only true if nothing downstream can see the difference.
		 */
		const positions = new Map(
			relativeCompilation.document.components.map((part) => [part.id, part])
		);
		const absolute = relative
			.split('\n')
			.map((line) => {
				const head = line.match(/^([a-z]+):([A-Za-z][A-Za-z0-9_-]*)\s+("(?:[^"]+)")\s+(.*)$/);
				if (head === null) return line;
				const part = positions.get(head[2]!);
				if (part === undefined || / at \(/.test(line)) return line;
				/* Strip the placement clause and keep only the colour-and-options tail. */
				const tail = head[4]!.replace(
					/^(?:(?:right-of|left-of|above|below)\s+[\w.-]+(?:\s+by\s+[\d.-]+)?\s+|aligned-[xy]\s+with\s+[\w.-]+\s+)+/,
					''
				);
				return `${head[1]}:${head[2]} ${head[3]} at (${part.x}, ${part.y}) ${tail}`;
			})
			.join('\n');

		expect(absolute).not.toContain('right-of');
		expect(absolute).not.toContain('aligned-');
		const absoluteCompilation = compileSchematic(absolute, fence);
		expect(absoluteCompilation.svg).toBe(relativeCompilation.svg);
		expect(absoluteCompilation.placements).toEqual([]);
	});

	test('reports the same source map for both forms', () => {
		/* Declarations keep their lines through lowering, so the source map a host
		   uses for caret-to-vector navigation is unaffected by the position form. */
		const compilation = compileSchematic(
			`resistor:A "A" at (200, 400) #amber\n` +
				`resistor:B "B" right-of A by 150 #cyan\n` +
				`A.out -> B.in #amber [line]`,
			fence
		);
		expect(compilation.sourceMap.nodes).toEqual([
			{ id: 'A', line: 1 },
			{ id: 'B', line: 2 }
		]);
		expect(compilation.sourceMap.wires[0]).toMatchObject({ line: 3 });
	});
});

describe('diagnostics', () => {
	test('names an undeclared reference and does not blame declaration order', () => {
		expect(() =>
			parseSchematic(`resistor:A "A" at (300, 400) #amber\nresistor:B "B" right-of R9 #cyan`, fence)
		).toThrow(/B is placed relative to R9, which the document never declares/);
	});

	test('rejects a self reference', () => {
		expect(() => parseSchematic(`resistor:B "B" right-of B by 100 #cyan`, fence)).toThrow(
			/B is placed relative to itself/
		);
	});

	test('lists the members of a cycle in order', () => {
		/* "A cycle exists" is the class of diagnostic this compiler has spent
		   several releases removing, so the path itself is asserted. */
		expect(() =>
			parseSchematic(
				`resistor:A "A" right-of C by 100 #amber\n` +
					`resistor:B "B" right-of A by 100 #cyan\n` +
					`resistor:C "C" right-of B by 100 #emerald`,
				fence
			)
		).toThrow(/Placement cycle: A -> C -> B -> A\. One component in a cycle must be placed with at/);
	});

	test('rejects a negative by distance and names the opposite direction', () => {
		expect(() =>
			parseSchematic(
				`resistor:A "A" at (400, 400) #amber\nresistor:B "B" right-of A by -80 #cyan`,
				fence
			)
		).toThrow(/B states a negative by distance of -80\. Distances are unsigned/);
	});

	test('rejects a terminal the reference does not declare', () => {
		expect(() =>
			parseSchematic(
				`resistor:A "A" at (400, 400) #amber\nresistor:B "B" right-of A.clock by 100 #cyan`,
				fence
			)
		).toThrow(/A has no terminal named clock, so B cannot be placed against it/);
	});

	test('enforces the placement depth budget at the declaration that crosses it', () => {
		const chain = ['resistor:P0 "P" at (100, 400) #amber'];
		for (let index = 1; index <= 6; index += 1) {
			chain.push(
				`resistor:P${index} "P" right-of P${index - 1} by 40 #cyan`
			);
		}
		const source = chain.join('\n');
		expect(() => parseSchematic(source, { ...fence, limits: { placementDepth: 6 } })).not.toThrow();
		expect(() => parseSchematic(source, { ...fence, limits: { placementDepth: 4 } })).toThrow(
			/P5 sits 5 placements deep, past the 4 chain budget\. Anchor one component in the chain with at/
		);
	});

	test('sends an unsatisfiable relation to the standard out-of-bounds diagnostic', () => {
		/* A relation that lands a part off the canvas is not a new class of error —
		   it is the same overrun a bad `at (x, y)` produces, and it should read the
		   same way and name a coordinate that works. */
		expect(() =>
			parseSchematic(
				`resistor:A "A" at (1100, 400) #amber\nresistor:B "B" right-of A by 400 #cyan`,
				fence
			)
		).toThrow(/B is outside the declared 1200x800 bounds/);
	});

	test('waits for every reference before resolving a declaration', () => {
		/*
		 * D depends on two pending declarations, so resolving the first must leave it
		 * blocked rather than release it early against a coordinate B does not have
		 * yet. Without that, D's position would depend on evaluation order, which is
		 * the one thing this pass promises it cannot.
		 */
		const { at, compilation } = resolved(
			`resistor:A "A" at (200, 200) #amber\n` +
				`resistor:B "B" right-of A by 150 #cyan\n` +
				`resistor:C "C" below A by 150 #emerald\n` +
				`resistor:D "D" aligned-x with B aligned-y with C #purple`
		);
		expect(at.get('D')).toEqual({ x: at.get('B')!.x, y: at.get('C')!.y });
		/*
		 * The coordinates alone do not prove it. Releasing D when its first reference
		 * resolved would evaluate it twice — once against a coordinate B did not have
		 * yet, then again against the real one — and the second pass overwrites the
		 * first, so the position comes out right by accident. What does not survive is
		 * the report: one declaration, one placement.
		 */
		expect(compilation.placements.map((placement) => placement.id)).toEqual(['B', 'C', 'D']);
	});

	test('rejects a duplicate id declared by relation', () => {
		expect(() =>
			parseSchematic(
				`resistor:A "A" at (300, 400) #amber\nresistor:A "A" right-of A by 100 #cyan`,
				fence
			)
		).toThrow(/Duplicate component ID A/);
	});

	test('counts a relative declaration against the component budget', () => {
		expect(() =>
			parseSchematic(
				`resistor:A "A" at (300, 400) #amber\nresistor:B "B" right-of A by 150 #cyan`,
				{ ...fence, limits: { components: 1 } }
			)
		).toThrow(/Schematic exceeds the 1 component limit/);
	});

	test('rejects an unknown placement limit field', () => {
		expect(() =>
			parseSchematic(`resistor:A "A" at (300, 400) #amber`, {
				...fence,
				limits: { placementDepth: 8, placmentDepth: 8 } as never
			})
		).toThrow(/Unknown compiler limit placmentDepth/);
	});
});
