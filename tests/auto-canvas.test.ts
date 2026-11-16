/**
 * `bounds: 'auto'`: the sheet is measured from the drawing instead of declared.
 *
 * The load-bearing test is `changes nothing for a declared canvas`. A measured
 * sheet is an addition; a document that states its bounds must be read, checked
 * and written exactly as before, or every committed drawing moves.
 */
import { describe, expect, test } from 'vitest';

import {
	compileSchematic,
	componentRectangle,
	MIN_SCHEMATIC_BOUND,
	parseSchematic,
	parseSchematicFence,
	renderSchematic,
	SCHEMATIC_SHEET_MARGIN,
	type SchematicFence
} from '../src/index.js';
import { snapshotSchematic } from '../src/snapshot.js';

const RC = `source:VIN "AC" at (90, 150) #blue [type=voltage-ac]
resistor:R1 "1 k\\Omega" right-of VIN by 190 #amber
junction:VOUT "V_{out}" right-of R1 by 190 #cyan
capacitor:C1 "100 nF" below VOUT by 140 #cyan [orientation=down]
VIN.positive -> R1.in #blue [line]
R1.out -> VOUT.node #amber [line]
VOUT.node -> C1.in #cyan [ortho label="tap"]`;

const auto: SchematicFence = { bounds: 'auto', title: 'Measured sheet' };
const declared: SchematicFence = { bounds: { width: 760, height: 460 }, title: 'Measured sheet' };

/** Shift every `at (x, y)` in a source by a whole number of units. */
const shifted = (source: string, dx: number, dy: number): string =>
	source.replace(/at \((-?\d+), (-?\d+)\)/g, (_, x: string, y: string) => `at (${Number(x) + dx}, ${Number(y) + dy})`);

describe('the fence', () => {
	test('reads bounds="auto" with and without a title', () => {
		expect(parseSchematicFence('schemd bounds="auto"')).toEqual({ bounds: 'auto', title: 'Engineering schematic' });
		expect(parseSchematicFence('schemd bounds="AUTO" title="Filter"')).toEqual({ bounds: 'auto', title: 'Filter' });
	});

	test('still rejects anything that is neither dimensions nor auto', () => {
		for (const info of ['schemd bounds="fit"', 'schemd bounds="autox100"', 'schemd bounds=""']) {
			expect(() => parseSchematicFence(info)).toThrow(/schemd fences require/);
		}
		expect(() => parseSchematic(RC, { bounds: 'fit' as never, title: 'x' })).toThrow('Parser options require bounds.');
		expect(() => renderSchematic(parseSchematic(RC, declared), { bounds: undefined as never, title: 'x' })).toThrow('Render options require bounds.');
	});
});

describe('a measured sheet', () => {
	const compilation = compileSchematic(RC, auto);
	const { sheet } = compilation;

	test('holds every part, label and trace with the margin on each side', () => {
		const rectangles = compilation.document.components.map(componentRectangle);
		const left = Math.min(...rectangles.map((rect) => rect.minX));
		const top = Math.min(...rectangles.map((rect) => rect.minY));
		const right = Math.max(...rectangles.map((rect) => rect.maxX));
		const bottom = Math.max(...rectangles.map((rect) => rect.maxY));
		expect(sheet.x).toBe(Math.floor(left - SCHEMATIC_SHEET_MARGIN));
		expect(sheet.y).toBe(Math.floor(top - SCHEMATIC_SHEET_MARGIN));
		expect(sheet.x + sheet.width).toBeGreaterThanOrEqual(right + SCHEMATIC_SHEET_MARGIN);
		expect(sheet.y + sheet.height).toBeGreaterThanOrEqual(bottom + SCHEMATIC_SHEET_MARGIN);
		for (const value of Object.values(sheet)) expect(Number.isInteger(value)).toBe(true);
	});

	test('is written as the viewBox, and the coordinates an author wrote are the ones drawn', () => {
		expect(compilation.svg).toContain(`viewBox="${sheet.x} ${sheet.y} ${sheet.width} ${sheet.height}" width="${sheet.width}" height="${sheet.height}"`);
		expect(compilation.document.components[0]).toMatchObject({ id: 'VIN', x: 90, y: 150 });
	});

	test('follows the drawing: moving every part moves the sheet and changes nothing else', () => {
		const moved = compileSchematic(shifted(RC, -700, 9000), auto);
		expect(moved.sheet).toEqual({ x: sheet.x - 700, y: sheet.y + 9000, width: sheet.width, height: sheet.height });
	});

	test('has no edge for a part to be outside of', () => {
		expect(() => compileSchematic(shifted(RC, -700, 9000), declared)).toThrow(/outside the declared 760x460 bounds/);
		expect(() => compileSchematic(shifted(RC, -700, 9000), auto)).not.toThrow();
	});

	test('grows to hold a wire label that reaches past the parts', () => {
		const plain = compileSchematic(RC.replace(' label="tap"', ''), auto).sheet;
		const labelled = compileSchematic(RC.replace('"tap"', '"a tap label long enough to pass the capacitor on both sides"'), auto).sheet;
		expect(labelled.width).toBeGreaterThan(plain.width);
	});

	test('starts the surface and the grid where the sheet starts', () => {
		const svg = compileSchematic(RC, { ...auto, mode: 'embedded-css' }).svg;
		expect(svg).toContain(`<rect class="schematic-surface" x="${sheet.x}" y="${sheet.y}" width="100%" height="100%" />`);
		expect(svg).toContain(`<rect class="schematic-grid" x="${sheet.x}" y="${sheet.y}" width="100%" height="100%"`);
	});

	test('is never smaller than the smallest canvas a fence may declare', () => {
		const dot = compileSchematic('junction:J at (500, 500) #slate', auto).sheet;
		expect(dot.width).toBeGreaterThanOrEqual(MIN_SCHEMATIC_BOUND);
		expect(dot.height).toBeGreaterThanOrEqual(MIN_SCHEMATIC_BOUND);
		/* Widened about the drawing, which therefore stays inside it. */
		expect(dot.x).toBeLessThan(500);
		expect(dot.x + dot.width).toBeGreaterThan(500);
	});

	test('refuses a drawing wider than a sheet may be, and says what to do', () => {
		const apart = 'resistor:A "A" at (0, 0) #amber\nresistor:B "B" at (1100000, 0) #amber';
		expect(() => compileSchematic(apart, auto)).toThrow(/The drawing spans \d+x\d+, which is more than the 1,048,576 units a sheet may measure on a side; move the parts closer together\./);
	});

	test('is the same sheet whichever entry point measures it', () => {
		/* Parsed against a declared canvas, then rendered on a measured one: the
		   renderer has no cached routes for that canvas and measures for itself. */
		const viaRender = renderSchematic(parseSchematic(RC, declared), auto);
		expect(viaRender).toBe(compilation.svg);
		expect(snapshotSchematic(compilation.document, auto)).toContain(`bounds ${sheet.width}x${sheet.height} at ${sheet.x},${sheet.y}\n`);
		expect(snapshotSchematic(parseSchematic(RC, declared), auto)).toBe(snapshotSchematic(compilation.document, auto));
	});
});

describe('a declared canvas', () => {
	test('changes nothing for a declared canvas', () => {
		const compilation = compileSchematic(RC, { ...declared, mode: 'embedded-css' });
		expect(compilation.sheet).toEqual({ x: 0, y: 0, width: 760, height: 460 });
		expect(compilation.svg).toContain('viewBox="0 0 760 460" width="760" height="460"');
		expect(compilation.svg).toContain('<rect class="schematic-surface" width="100%" height="100%" />');
		expect(snapshotSchematic(compilation.document, declared)).toContain('bounds 760x460\n');
	});

	test('draws the same parts and wires as the measured sheet when both have room', () => {
		const strip = (svg: string) => svg.slice(svg.indexOf('<g class="schematic-vectors">'));
		const measured = compileSchematic(RC, { ...auto, idPrefix: 'same' }).svg;
		const fixed = compileSchematic(RC, { ...declared, idPrefix: 'same' }).svg;
		expect(strip(measured)).toBe(strip(fixed));
	});
});
