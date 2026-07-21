import { describe, expect, test } from 'vitest';
import { compileSchematic, schematicSourceMap, type SchematicDocument } from '../src/index.js';

describe('compileSchematic', () => {
	test('returns one validated result with exact UTF-8 metrics', () => {
		const source = 'resistor:R1 "10 k\\Omega" at (80, 80) #amber';
		const result = compileSchematic(source, {
			bounds: { width: 320, height: 160 },
			title: 'Input Ω'
		});

		expect(result.document.components).toHaveLength(1);
		expect(result.svg).toContain('<svg');
		expect(result.metrics).toEqual({
			sourceCharacters: source.length,
			components: 1,
			connections: 0,
			svgBytes: new TextEncoder().encode(result.svg).byteLength
		});
	});
});

const SOURCE_MAP_PROGRAM = `// header comment
port:A "A" at (60, 90) #blue

resistor:R1 "R" at (300, 90) #amber
A.out -> R1.in #blue [line]`;

const SOURCE_MAP_BOUNDS = { width: 420, height: 180 };

describe('source map', () => {
	test('records one-based declaration lines for nodes and wires in source order', () => {
		const result = compileSchematic(SOURCE_MAP_PROGRAM, {
			bounds: SOURCE_MAP_BOUNDS,
			title: 'Source map',
			mode: 'full'
		});

		expect(result.sourceMap.nodes).toEqual([
			{ id: 'A', line: 2 },
			{ id: 'R1', line: 4 }
		]);
		expect(result.sourceMap.wires).toEqual([
			{ source: 'A.out', target: 'R1.in', line: 5, netId: '$1' }
		]);
	});

	test('full mode emits data-source-line on node and wire groups', () => {
		const result = compileSchematic(SOURCE_MAP_PROGRAM, {
			bounds: SOURCE_MAP_BOUNDS,
			title: 'Source map',
			mode: 'full'
		});

		expect(result.svg).toContain('data-node-id="A" data-node-kind="port"');
		expect(result.svg).toContain('data-source-line="2"'); /* port A */
		expect(result.svg).toContain('data-source-line="4"'); /* resistor R1 */
		expect(result.svg).toContain('data-wire-source="A.out" data-wire-target="R1.in"');
		expect(result.svg).toContain('data-source-line="5"'); /* the connection */
	});

	test('non-full modes omit data-source-line but still expose the source map', () => {
		const result = compileSchematic(SOURCE_MAP_PROGRAM, {
			bounds: SOURCE_MAP_BOUNDS,
			title: 'Source map',
			mode: 'default'
		});

		expect(result.svg).not.toContain('data-source-line');
		expect(result.sourceMap.nodes).toHaveLength(2);
		expect(result.sourceMap.wires).toHaveLength(1);
	});

	test('the standalone helper matches the compilation source map', () => {
		const result = compileSchematic(SOURCE_MAP_PROGRAM, {
			bounds: SOURCE_MAP_BOUNDS,
			title: 'Source map'
		});

		expect(schematicSourceMap(result.document)).toEqual(result.sourceMap);
	});

	test('rejects forged documents at the standalone source-map boundary', () => {
		expect(() =>
			schematicSourceMap({
				components: [],
				connections: []
			} as SchematicDocument)
		).toThrow(/immutable document returned by parseSchematic/);
	});
});
