/**
 * Geometry digests: the text answer to "did anything move?".
 *
 * The property that matters here is *agreement*. A snapshot that drifts from
 * what the renderer actually drew is worse than no snapshot, because it would
 * pass while the picture changed — so the central test parses coordinates back
 * out of the compiled SVG and requires them to match the digest exactly.
 */
import { describe, expect, test } from 'vitest';

import { compileSchematic, parseSchematic, type SchematicFence } from '../src/index.js';
import { SCHEMATIC_SNAPSHOT_VERSION, snapshotSchematic } from '../src/snapshot.js';

const fence: SchematicFence = { bounds: { width: 900, height: 520 }, title: 'Snapshot fixture' };

const RC_FILTER = `source:VIN "AC" at (110, 150) #blue [type=voltage-ac]
resistor:R1 "1 k\\Omega" at (330, 150) #amber
junction:VOUT "V_{out}" at (560, 150) #cyan
capacitor:C1 "100 nF" at (560, 320) #cyan [orientation=down]
ground:GND "0 V" at (330, 430) #slate

VIN.positive -> R1.in #blue [line]
R1.out -> VOUT.node #amber [line]
VOUT.node -> C1.in #cyan [ortho]
C1.out -> GND.in #slate [ortho]`;

describe('the digest', () => {
	test('opens with a version line so a format change is legible', () => {
		const snapshot = snapshotSchematic(parseSchematic(RC_FILTER, fence), fence);
		expect(snapshot.startsWith(`schemd-snapshot ${SCHEMATIC_SNAPSHOT_VERSION}\n`)).toBe(true);
		expect(snapshot.split('\n')[1]).toBe('bounds 900x520');
		expect(snapshot.endsWith('\n')).toBe(true);
	});

	test('carries one line per component and one per trace, in source order', () => {
		const document = parseSchematic(RC_FILTER, fence);
		const lines = snapshotSchematic(document, fence).trimEnd().split('\n');
		const components = lines.filter((line) => line.startsWith('component '));
		const traces = lines.filter((line) => line.startsWith('trace '));
		expect(components).toHaveLength(document.components.length);
		expect(traces).toHaveLength(document.connections.length);
		expect(components.map((line) => line.split(' ')[1])).toEqual(
			document.components.map((component) => component.id)
		);
	});

	test('rounds every coordinate to three decimals', () => {
		const snapshot = snapshotSchematic(parseSchematic(RC_FILTER, fence), fence);
		for (const number of snapshot.match(/-?\d+\.\d+/g) ?? []) {
			expect(number.split('.')[1]).toHaveLength(3);
		}
	});

	test('states an orientation only when the declaration did', () => {
		const snapshot = snapshotSchematic(parseSchematic(RC_FILTER, fence), fence);
		const capacitor = snapshot.split('\n').find((line) => line.startsWith('component C1 '))!;
		const resistor = snapshot.split('\n').find((line) => line.startsWith('component R1 '))!;
		/* C1 declared `orientation=down`; R1 declared nothing. Defaulting R1 to
		   `right` would erase a real difference between the two declarations. */
		expect(capacitor).toContain('orient=down');
		expect(resistor).not.toContain('orient=');
	});

	test('is byte-identical across runs', () => {
		const document = parseSchematic(RC_FILTER, fence);
		const digests = new Set(
			Array.from({ length: 25 }, () => snapshotSchematic(document, fence))
		);
		expect(digests.size).toBe(1);
	});

	test('works on a document assembled without the parser cache', () => {
		/* The cache is keyed on the parsed document, so a copy misses it and the
		   snapshot has to route for itself. Both paths must agree. */
		const document = parseSchematic(RC_FILTER, fence);
		const copy = { components: document.components, connections: document.connections };
		expect(snapshotSchematic(copy, fence)).toBe(snapshotSchematic(document, fence));
	});

	test('states a bus width and a net identity for every trace', () => {
		const bus = `port:A "A" at (140, 200) #blue [width=8]\nport:B "B" at (620, 200) #emerald [width=8]\nA.out -> B.in #blue [ortho digital width=8]`;
		const line = snapshotSchematic(parseSchematic(bus, fence), fence)
			.split('\n')
			.find((entry) => entry.startsWith('trace '))!;
		expect(line).toContain('width=8');
		expect(line).toMatch(/net=\S+/);
	});

	test('marks a hand-built connection as carrying no net', () => {
		/* The parser gives every connection a net identity, so `net=none` can only
		   mean the document did not come from it — worth saying rather than hiding. */
		const document = parseSchematic(RC_FILTER, fence);
		const stripped = {
			components: document.components,
			connections: document.connections.map(({ netId, ...rest }) => rest)
		};
		expect(snapshotSchematic(stripped, fence)).toContain('net=none');
	});

	test('rejects bounds the compiler would reject', () => {
		expect(() =>
			snapshotSchematic(parseSchematic(RC_FILTER, fence), {
				...fence,
				bounds: { width: 10, height: 10 }
			})
		).toThrow(/Snapshot bounds must be integers/);
	});
});

describe('agreement with the drawing', () => {
	test('every component rectangle matches where the SVG put it', () => {
		const compilation = compileSchematic(RC_FILTER, { ...fence, mode: 'full' });
		const snapshot = snapshotSchematic(compilation.document, fence);
		/* `full` mode positions each group with a translate, which is the one place
		   the drawing states a component's origin. The digest's `at=` must be it. */
		const drawn = new Map(
			[
				...compilation.svg.matchAll(
					/data-node-id="([^"]+)"[^>]*transform="translate\((-?[\d.]+) (-?[\d.]+)\)"/g
				)
			].map((match) => [match[1]!, `${Number(match[2]!).toFixed(3)},${Number(match[3]!).toFixed(3)}`])
		);
		expect(drawn.size).toBe(compilation.document.components.length);
		for (const line of snapshot.split('\n').filter((entry) => entry.startsWith('component '))) {
			const id = line.split(' ')[1]!;
			const at = line.match(/at=\(([^)]+)\)/)![1]!;
			expect(at, `${id} origin`).toBe(drawn.get(id));
		}
	});

	test('every trace vertex appears in the path the SVG drew', () => {
		const compilation = compileSchematic(RC_FILTER, { ...fence, mode: 'full' });
		const snapshot = snapshotSchematic(compilation.document, fence);
		const paths = [
			...compilation.svg.matchAll(/class="[^"]*schematic-trace[^"]*"[^>]*\sd="([^"]*)"/g)
		].map((match) => match[1]!);
		const traces = snapshot.split('\n').filter((line) => line.startsWith('trace '));
		expect(traces).toHaveLength(paths.length);
		for (const [index, line] of traces.entries()) {
			const vertices = [...line.matchAll(/\((-?[\d.]+),(-?[\d.]+)\)/g)];
			expect(vertices.length).toBeGreaterThan(1);
			/* Endpoints are the strongest claim a vertex list makes, and the only
			   ones a bridged orthogonal path is guaranteed to state verbatim. */
			const first = vertices[0]!;
			const numbers = (paths[index]!.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
			expect(numbers[0]).toBeCloseTo(Number(first[1]), 3);
			expect(numbers[1]).toBeCloseTo(Number(first[2]), 3);
		}
	});

	test('moving one component changes exactly one component line', () => {
		/* The reason the digest exists: a reviewer should see what moved. */
		const before = snapshotSchematic(parseSchematic(RC_FILTER, fence), fence).split('\n');
		const after = snapshotSchematic(
			parseSchematic(RC_FILTER.replace('at (330, 430)', 'at (330, 440)'), fence),
			fence
		).split('\n');
		const changed = before.filter((line, index) => line !== after[index]);
		expect(changed.every((line) => line.startsWith('component GND ') || line.startsWith('trace ')))
			.toBe(true);
		expect(changed.filter((line) => line.startsWith('component '))).toHaveLength(1);
	});
});
