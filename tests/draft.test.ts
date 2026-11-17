/**
 * Draft placement: a declaration may leave its position out.
 *
 * The load-bearing test is `compiles to the same bytes as the positions it
 * reports`, as it is for relative placement. The draft is a lowering pass: once
 * it has run, nothing downstream can tell a drafted coordinate from one an
 * author typed. Writing the reported coordinates back into the source must
 * therefore give the same drawing, byte for byte, with no draft pass at all.
 */
import { describe, expect, test } from 'vitest';

import {
	compileSchematic,
	componentRectangle,
	diagnoseSchematic,
	DRAFT_BAND_WIDTH,
	DRAFT_CLEARANCE,
	DRAFT_ORIGIN,
	DRAFT_PIN_GAP,
	parseSchematic,
	resolvePortPoint,
	type SchematicCompilation,
	type SchematicFence
} from '../src/index.js';
import { snapshotSchematic } from '../src/snapshot.js';

const auto: SchematicFence = { bounds: 'auto', title: 'Draft fixture' };

/** A two-pole RC ladder as a netlist: nine parts, nine wires, no position anywhere. */
const LADDER = `port:VIN "V_{in}" #blue
resistor:R1 "1 k\\Omega" #amber
junction:N1 #cyan
capacitor:C1 "100 nF" #cyan [orientation=down]
resistor:R2 "10 k\\Omega" #amber
junction:N2 #cyan
capacitor:C2 "10 nF" #cyan [orientation=down]
port:VOUT "V_{out}" #emerald
ground:G1 #slate

VIN.out -> R1.in #blue [ortho]
R1.out -> N1.node #amber [ortho]
N1.node -> C1.in #cyan [ortho]
N1.node -> R2.in #cyan [ortho]
R2.out -> N2.node #amber [ortho]
N2.node -> C2.in #cyan [ortho]
N2.node -> VOUT.in #emerald [ortho marker-end=arrow]
C1.out -> G1.in #slate [ortho]
C2.out -> G1.in #slate [ortho]`;

const at = (compilation: SchematicCompilation) => new Map(compilation.document.components.map((part) => [part.id, part]));

/** Write every reported coordinate back into the source as `at (x, y)`. */
function frozen(source: string, compilation: SchematicCompilation): string {
	const lines = source.split('\n');
	for (const placement of compilation.placements) {
		if (placement.relations.length > 0) continue;
		const line = lines[placement.line - 1]!;
		const head = /^([A-Za-z][A-Za-z0-9_-]*:[A-Za-z][A-Za-z0-9_-]*(?:\s+"[^"]+")?)\s+(.+)$/.exec(line)!;
		lines[placement.line - 1] = `${head[1]} at (${placement.resolved.x}, ${placement.resolved.y}) ${head[2]}`;
	}
	return lines.join('\n');
}

/** Whether two parts keep the draft clearance between their rectangles. */
function clear(a: ReturnType<typeof componentRectangle>, b: ReturnType<typeof componentRectangle>): boolean {
	return a.maxX + DRAFT_CLEARANCE <= b.minX || b.maxX + DRAFT_CLEARANCE <= a.minX || a.maxY + DRAFT_CLEARANCE <= b.minY || b.maxY + DRAFT_CLEARANCE <= a.minY;
}

describe('a document that states no position', () => {
	const compilation = compileSchematic(LADDER, auto);
	const parts = at(compilation);
	const pin = (id: string, port: string) => resolvePortPoint(parts.get(id)!, port);

	test('compiles to the same bytes as the positions it reports', () => {
		const written = frozen(LADDER, compilation);
		expect(written).not.toBe(LADDER);
		expect(written).toContain('port:VIN "V_{in}" at (');
		const again = compileSchematic(written, auto);
		expect(again.placements).toEqual([]);
		expect(again.svg).toBe(compilation.svg);
		expect(snapshotSchematic(again.document, auto)).toBe(snapshotSchematic(compilation.document, auto));
	});

	test('reports every drafted part, in source order, with no relation', () => {
		expect(compilation.placements.map((placement) => placement.id)).toEqual(['VIN', 'R1', 'N1', 'C1', 'R2', 'N2', 'C2', 'VOUT', 'G1']);
		for (const placement of compilation.placements) {
			expect(placement.relations).toEqual([]);
			expect(placement.resolved).toEqual({ x: parts.get(placement.id)!.x, y: parts.get(placement.id)!.y });
		}
	});

	test('sets the first part declared at the draft origin', () => {
		const first = componentRectangle(parts.get('VIN')!);
		expect(Math.floor(Math.min(...[...parts.values()].map((part) => componentRectangle(part).minX)))).toBe(DRAFT_ORIGIN);
		expect(first.minX).toBeGreaterThanOrEqual(DRAFT_ORIGIN);
	});

	test('keeps that corner when a part is drafted to the left of the first', () => {
		/* B is declared first and A feeds it, so A is set down before B's input:
		   left of where the draft began. The whole drawing moves back to the corner. */
		const backwards = compileSchematic('resistor:B "B" #amber\nresistor:A "A" #amber\nA.out -> B.in #amber [ortho]', auto);
		const rectangles = backwards.document.components.map(componentRectangle);
		expect(at(backwards).get('A')!.x).toBeLessThan(at(backwards).get('B')!.x);
		expect(Math.floor(Math.min(...rectangles.map((rect) => rect.minX)))).toBe(DRAFT_ORIGIN);
		expect(Math.floor(Math.min(...rectangles.map((rect) => rect.minY)))).toBe(DRAFT_ORIGIN);
	});

	test('puts each part beyond the pin its wire enters, one pin gap away and in line', () => {
		/* The series path reads left to right on one level. */
		expect(pin('R1', 'in')).toEqual({ x: pin('VIN', 'out').x + DRAFT_PIN_GAP, y: pin('VIN', 'out').y });
		expect(pin('N1', 'node')).toEqual({ x: pin('R1', 'out').x + DRAFT_PIN_GAP, y: pin('R1', 'out').y });
		expect(pin('R2', 'in')).toEqual({ x: pin('N1', 'node').x + DRAFT_PIN_GAP, y: pin('N1', 'node').y });
		expect(pin('VOUT', 'in').y).toBe(pin('N2', 'node').y);
		/* A part turned down hangs below the node that feeds it. */
		expect(pin('C1', 'in')).toEqual({ x: pin('N1', 'node').x, y: pin('N1', 'node').y + DRAFT_PIN_GAP });
		expect(pin('C2', 'in')).toEqual({ x: pin('N2', 'node').x, y: pin('N2', 'node').y + DRAFT_PIN_GAP });
		expect(pin('G1', 'in')).toEqual({ x: pin('C1', 'out').x, y: pin('C1', 'out').y + DRAFT_PIN_GAP });
	});

	test('draws a drafted wire as one straight segment', () => {
		const straight = snapshotSchematic(compilation.document, auto)
			.split('\n')
			.filter((line) => /^trace (VIN\.out->R1\.in|R1\.out->N1\.node|N1\.node->C1\.in|N1\.node->R2\.in|C1\.out->G1\.in) /.test(line));
		expect(straight).toHaveLength(5);
		for (const line of straight) expect(line.match(/\(/g)).toHaveLength(2);
	});

	test('keeps every pair of parts clear of each other', () => {
		const rectangles = [...parts.values()].map(componentRectangle);
		for (const [index, a] of rectangles.entries()) for (const b of rectangles.slice(index + 1)) expect(clear(a, b)).toBe(true);
	});

	test('follows a wire the way it was written before it follows one backwards', () => {
		/* C2 is reached forwards from N2 and backwards from G1; the ground is
		   drafted earlier, yet C2 hangs from its own node. */
		expect(pin('C2', 'in').x).toBe(pin('N2', 'node').x);
		expect(pin('C2', 'in').x).not.toBe(pin('C1', 'in').x);
	});

	test('is the same drawing on every run', () => {
		expect(compileSchematic(LADDER, auto).svg).toBe(compilation.svg);
	});

	test('fits a declared canvas that has the room, and is refused by one that has not', () => {
		const sheet = compilation.sheet;
		const roomy = compileSchematic(LADDER, { bounds: { width: sheet.x + sheet.width, height: sheet.y + sheet.height }, title: 'Draft fixture' });
		expect(at(roomy).get('G1')).toMatchObject({ x: parts.get('G1')!.x, y: parts.get('G1')!.y });
		expect(() => compileSchematic(LADDER, { bounds: { width: 300, height: 300 }, title: 'Draft fixture' })).toThrow(/exceeds the declared 300x300 bounds/);
	});
});

describe('a document that states some positions', () => {
	const MIXED = `resistor:R1 "R1" at (400, 300) #amber
resistor:R2 "R2" #amber
inductor:D1 "D1" #red
capacitor:C1 "C1" below R2 by 60 #cyan [orientation=down]
R1.out -> R2.in #amber [ortho]
D1.out -> R1.in #red [ortho]`;
	const compilation = compileSchematic(MIXED, auto);
	const parts = at(compilation);

	test('never moves a part an author placed', () => {
		expect(parts.get('R1')).toMatchObject({ x: 400, y: 300 });
	});

	test('drafts the rest from the placed part, forwards and backwards along its wires', () => {
		expect(resolvePortPoint(parts.get('R2')!, 'in')).toEqual({ x: resolvePortPoint(parts.get('R1')!, 'out').x + DRAFT_PIN_GAP, y: 300 });
		/* D1 feeds R1, so it sits before R1's input, facing it. */
		expect(resolvePortPoint(parts.get('D1')!, 'out')).toEqual({ x: resolvePortPoint(parts.get('R1')!, 'in').x - DRAFT_PIN_GAP, y: 300 });
	});

	test('resolves a relation to a drafted part after the draft', () => {
		const r2 = componentRectangle(parts.get('R2')!);
		const c1 = componentRectangle(parts.get('C1')!);
		expect(c1.minY).toBe(r2.maxY + 60);
		expect(parts.get('C1')!.x).toBe(parts.get('R2')!.x);
		expect(compilation.placements.map((placement) => [placement.id, placement.relations.length])).toEqual([
			['R2', 0],
			['D1', 0],
			['C1', 1]
		]);
	});

	test('compiles to the same bytes once the draft is written back', () => {
		expect(compileSchematic(frozen(MIXED, compilation), auto).svg).toBe(compilation.svg);
	});

	test('resolves a relation that reaches no drafted part where it always was', () => {
		const parts = at(compileSchematic(`${MIXED}\nresistor:R3 "R3" below R1 by 80 #amber`, auto));
		expect(componentRectangle(parts.get('R3')!).minY).toBe(componentRectangle(parts.get('R1')!).maxY + 80);
	});

	test('reports a relation that fails after the draft, on its own line', () => {
		const cyclic = `resistor:R1 "R1" #amber\nresistor:A "A" right-of B #amber\nresistor:B "B" right-of A aligned-y with R1 #amber`;
		expect(diagnoseSchematic(cyclic, auto)).toMatchObject([{ line: 2, code: 'placement' }]);
	});
});

describe('parts no wire reaches', () => {
	test('run left to right, level with each other', () => {
		const compilation = compileSchematic('resistor:A "A" #amber\ncapacitor:B "B" #cyan\ninductor:C "C" #red', auto);
		const [a, b, c] = compilation.document.components.map(componentRectangle) as [ReturnType<typeof componentRectangle>, ReturnType<typeof componentRectangle>, ReturnType<typeof componentRectangle>];
		expect(b.minX).toBe(a.maxX + 2 * DRAFT_CLEARANCE);
		expect(c.minX).toBe(b.maxX + 2 * DRAFT_CLEARANCE);
		expect([b.minY, c.minY]).toEqual([a.minY, a.minY]);
	});

	test('start a new row beneath once a row is wide enough', () => {
		const count = 16;
		const source = Array.from({ length: count }, (_, index) => `resistor:R${index} "R" #amber`).join('\n');
		const rectangles = parseSchematic(source, auto).components.map(componentRectangle);
		const rows = [...new Set(rectangles.map((rect) => rect.minY))];
		expect(rows.length).toBeGreaterThan(1);
		for (const row of rows) {
			const inRow = rectangles.filter((rect) => rect.minY === row);
			/* A row is closed by the part that takes it past the width, never before. */
			expect(inRow.at(-2)!.maxX - inRow[0]!.minX).toBeLessThan(DRAFT_BAND_WIDTH + (inRow[0]!.maxX - inRow[0]!.minX) + 2 * DRAFT_CLEARANCE);
			expect(inRow[0]!.minX).toBe(rectangles[0]!.minX);
		}
	});
});

describe('room', () => {
	test('steps a part aside when the place its wire points to is taken', () => {
		const fan = `junction:J #cyan
resistor:A "A" #amber
resistor:B "B" #amber
resistor:C "C" #amber
J.node -> A.in #amber [ortho]
J.node -> B.in #amber [ortho]
J.node -> C.in #amber [ortho]`;
		const parts = at(compileSchematic(fan, auto));
		const xs = ['A', 'B', 'C'].map((id) => parts.get(id)!.x);
		const ys = ['A', 'B', 'C'].map((id) => parts.get(id)!.y);
		/* All three stay one pin gap from the junction; only the level differs. */
		expect(new Set(xs).size).toBe(1);
		expect(new Set(ys).size).toBe(3);
		expect(ys[0]).toBe(parts.get('J')!.y);
		expect(ys[1]).toBeGreaterThan(ys[0]!);
		expect(ys[2]).toBeLessThan(ys[0]!);
	});

	test('moves a part further out when only its own neighbour is in the way', () => {
		const wide = `resistor:A "A" #amber\nresistor:B "a label a great deal wider than the part it names" #amber\nA.out -> B.in #amber [ortho]`;
		const parts = at(compileSchematic(wide, auto));
		const gap = resolvePortPoint(parts.get('B')!, 'in').x - resolvePortPoint(parts.get('A')!, 'out').x;
		expect(gap).toBeGreaterThan(DRAFT_PIN_GAP);
		expect(parts.get('B')!.y).toBe(parts.get('A')!.y);
		expect(clear(componentRectangle(parts.get('A')!), componentRectangle(parts.get('B')!))).toBe(true);
	});

	test('sets a part apart, as a new group, when nothing near its wire is free', () => {
		/* A wall of placed parts fills every place the draft would try: each ring
		   of distances, and every step to either side. */
		const wall: string[] = [];
		for (let column = 0; column < 12; column += 1) {
			for (let row = -16; row <= 16; row += 1) wall.push(`resistor:W${column}_${row + 16} "w" at (${300 + column * 100}, ${3000 + row * 90}) #slate`);
		}
		const source = `resistor:A "A" at (100, 3000) #amber\n${wall.join('\n')}\nresistor:B "B" #amber\nA.out -> B.in #amber [bezier]`;
		const document = parseSchematic(source, auto);
		const rectangles = document.components.map(componentRectangle);
		const b = rectangles.at(-1)!;
		const others = rectangles.slice(0, -1);
		/* Beneath everything already down, flush with its left edge. */
		expect(b.minY).toBe(Math.max(...others.map((rect) => rect.maxY)) + 2 * DRAFT_CLEARANCE);
		expect(b.minX).toBe(Math.min(...others.map((rect) => rect.minX)));
	});

	test('reads two junctions wired together from left to right', () => {
		const parts = at(compileSchematic('junction:J1 #cyan\njunction:J2 #cyan\nJ1.node -> J2.node #cyan [ortho]', auto));
		expect(parts.get('J2')).toMatchObject({ x: parts.get('J1')!.x + DRAFT_PIN_GAP, y: parts.get('J1')!.y });
	});

	test('faces two outputs away from each other instead of into a body', () => {
		const parts = at(compileSchematic('resistor:A "A" #amber\nresistor:B "B" #amber\nA.out -> B.out #amber [ortho]', auto));
		expect(parts.get('B')!.x).toBeGreaterThan(parts.get('A')!.x);
	});
});

describe('the declaration', () => {
	test('is a head and then a colour, an option block, or both', () => {
		for (const line of ['resistor:R1 "R" #amber', 'resistor:R1 #amber', 'resistor:R1 "R" amber [orientation=down]', 'resistor:R1 rgb(10, 20, 30)', 'ic:U1 "U" [left=A,B right=Y]']) {
			expect(() => parseSchematic(line, auto)).not.toThrow();
		}
	});

	test('still rejects a placement clause that does not scan', () => {
		for (const line of ['resistor:R1 "R" beside R2 #amber', 'resistor:R1 "R" at #amber', 'resistor:R1 "R" right-of #amber', 'resistor:R1 "" #amber', 'resistor:R1 "R" at (10, 20', 'resistor:R1 "R" below', 'resistor:R1 "R" at [orientation=down]']) {
			expect(() => parseSchematic(line, auto)).toThrow(/Unrecognized schematic declaration/);
		}
	});
});
