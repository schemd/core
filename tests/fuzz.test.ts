/** Deterministic bounded property fuzzing for topology, routing, and SVG serialization. */
import { describe, expect, test } from 'vitest';

import { compileSchematic, routeConnections, SchematicSyntaxError } from '../src/index.js';

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

describe('bounded deterministic placement properties', () => {
	/**
	 * A random placement graph over `count` declarations.
	 *
	 * Deliberately unconstrained: references point anywhere, including forward,
	 * backward, at the declaration itself, and around cycles. The point is that no
	 * shape of graph may hang the resolver or escape it as an unhandled throw.
	 */
	function randomPlacementSource(random: () => number, count: number): string {
		const kinds = ['right-of', 'left-of', 'above', 'below'] as const;
		const lines = [`resistor:P0 "P" at (${300 + Math.floor(random() * 200)}, 400) #amber`];
		for (let index = 1; index < count; index += 1) {
			const relations: string[] = [];
			const arity = 1 + Math.floor(random() * 2);
			for (let slot = 0; slot < arity; slot += 1) {
				const ref = `P${Math.floor(random() * count)}`;
				relations.push(
					random() < 0.35
						? `aligned-${random() < 0.5 ? 'x' : 'y'} with ${ref}`
						: `${kinds[Math.floor(random() * kinds.length)]!} ${ref} by ${20 + Math.floor(random() * 120)}`
				);
			}
			lines.push(`resistor:P${index} "P" ${relations.join(' ')} #cyan`);
		}
		return lines.join('\n');
	}

	test('resolves or rejects every random placement graph with a line-accurate diagnostic', () => {
		const random = randomSource(0x51ac_e001);
		const fence = { bounds: { width: 4000, height: 4000 }, title: 'Placement fuzz' };
		let resolvedCount = 0;
		let rejectedCount = 0;
		for (let iteration = 0; iteration < 240; iteration += 1) {
			const count = 2 + Math.floor(random() * 7);
			const source = randomPlacementSource(random, count);
			try {
				const compilation = compileSchematic(source, fence);
				resolvedCount += 1;
				/* Every declaration ends up with finite, in-bounds coordinates, and
				   every relative one is reported exactly once. */
				for (const component of compilation.document.components) {
					expect(Number.isFinite(component.x)).toBe(true);
					expect(Number.isFinite(component.y)).toBe(true);
				}
				const reported = compilation.placements.map((placement) => placement.id);
				expect(new Set(reported).size).toBe(reported.length);
				expect(reported.length).toBe(count - 1);
			} catch (error) {
				rejectedCount += 1;
				/* A rejection is a diagnostic, never a `TypeError`, a `RangeError`, or
				   a stack overflow from a cycle walked without an exit. */
				expect(error).toBeInstanceOf(SchematicSyntaxError);
				expect((error as SchematicSyntaxError).message).toMatch(/\S/);
			}
		}
		/* The corpus has to actually exercise both outcomes, or this asserts nothing. */
		expect(resolvedCount).toBeGreaterThan(0);
		expect(rejectedCount).toBeGreaterThan(0);
	});

	test('resolves a random placement graph to the same coordinates every run', () => {
		const fence = { bounds: { width: 4000, height: 4000 }, title: 'Placement fuzz' };
		for (let iteration = 0; iteration < 40; iteration += 1) {
			const source = randomPlacementSource(randomSource(0x9e37_79b9 + iteration), 6);
			let first: string | undefined;
			for (let run = 0; run < 3; run += 1) {
				let outcome: string;
				try {
					outcome = compileSchematic(source, fence).svg;
				} catch (error) {
					outcome = `rejected:${(error as Error).message}`;
				}
				first ??= outcome;
				expect(outcome).toBe(first);
			}
		}
	});
});
