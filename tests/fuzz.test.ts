/** Deterministic bounded property fuzzing for topology, routing, and SVG serialization. */
import { describe, expect, test } from 'vitest';

import { compileSchematic, routeConnections } from '../src/index.js';

function randomSource(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state ^= state << 13;
		state ^= state >>> 17;
		state ^= state << 5;
		return (state >>> 0) / 0x1_0000_0000;
	};
}

function sampleTracks(random: () => number, count: number): number[] {
	// Keep randomized ports well beyond the universal component-overlap threshold.
	const candidates = Array.from({ length: 8 }, (_, index) => 150 + index * 80);
	for (let index = candidates.length - 1; index > 0; index -= 1) {
		const other = Math.floor(random() * (index + 1));
		[candidates[index], candidates[other]] = [candidates[other]!, candidates[index]!];
	}
	return candidates.slice(0, count).sort((left, right) => left - right);
}

describe('bounded deterministic route properties', () => {
	test('keeps randomized parallel topologies deterministic, finite, bounded, and separated', () => {
		const random = randomSource(0x5c4e_4d32);
		for (let iteration = 0; iteration < 60; iteration += 1) {
			const rows = 2 + Math.floor(random() * 7);
			const tracks = sampleTracks(random, rows);
			const declarations: string[] = [];
			const connections: string[] = [];
			for (const [index, y] of tracks.entries()) {
				declarations.push(`port:L${index} "L" at (60,${y}) #blue`);
				declarations.push(`port:R${index} "R" at (940,${y}) #emerald`);
				connections.push(
					`L${index}.out -> R${index}.in #${index % 2 === 0 ? 'blue' : 'emerald'} [ortho net=N${iteration}_${index}]`
				);
			}
			const source = [...declarations, ...connections].join('\n');
			const options = {
				bounds: { width: 1000, height: 900 },
				title: `Fuzz parallel ${iteration}`,
				idPrefix: `fuzz-${iteration}`
			} as const;
			const first = compileSchematic(source, options);
			const second = compileSchematic(source, options);
			expect(first.svg).toBe(second.svg);
			expect(first.svg).not.toMatch(/NaN|Infinity|undefined/);
			expect(new Set(first.document.connections.map((connection) => connection.netId)).size).toBe(rows);
			const routes = routeConnections(
				first.document.connections,
				new Map(first.document.components.map((component) => [component.id, component])),
				options.bounds
			);
			for (const route of routes) {
				for (const point of route.points) {
					expect(point.x).toBeGreaterThanOrEqual(0);
					expect(point.x).toBeLessThanOrEqual(options.bounds.width);
					expect(point.y).toBeGreaterThanOrEqual(0);
					expect(point.y).toBeLessThanOrEqual(options.bounds.height);
				}
			}
		}
	});

	test('bridges exactly n-squared randomized mesh crossings without malformed arcs', () => {
		const random = randomSource(0xb12d_63a7);
		for (let iteration = 0; iteration < 24; iteration += 1) {
			const count = 2 + Math.floor(random() * 5);
			const rows = sampleTracks(random, count);
			const columns = sampleTracks(random, count);
			const lines: string[] = [];
			for (let index = 0; index < count; index += 1) {
				lines.push(`port:L${index} "L" at (60,${rows[index]}) #blue`);
				lines.push(`port:R${index} "R" at (940,${rows[index]}) #blue`);
				lines.push(`port:T${index} "T" at (${columns[index]},68) #cyan [orientation=down]`);
				lines.push(`port:B${index} "B" at (${columns[index]},832) #cyan [orientation=up]`);
			}
			for (let index = 0; index < count; index += 1) {
				lines.push(`L${index}.out -> R${index}.in #blue [ortho net=H${index}]`);
			}
			for (let index = 0; index < count; index += 1) {
				lines.push(`T${index}.out -> B${index}.in #cyan [ortho net=V${index}]`);
			}
			const compiled = compileSchematic(lines.join('\n'), {
				bounds: { width: 1000, height: 900 },
				title: `Fuzz mesh ${iteration}`,
				idPrefix: `mesh-${iteration}`,
				mode: 'full'
			});
			const arcs = compiled.svg.match(/ A [\d.]+ [\d.]+ /g) ?? [];
			expect(arcs).toHaveLength(count * count);
			expect(arcs.every((arc) => !arc.includes(' A 0 0 '))).toBe(true);
		}
	});
});
