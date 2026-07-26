import { describe, expect, test } from 'vitest';

import { compileSchematic } from '../src/index.js';

const orientations = ['right', 'down', 'left', 'up'] as const;

function repeatedResistors(count: number): string {
	return Array.from(
		{ length: count },
		(_, index) =>
			`resistor:R${index} "R" at (${100 + (index % 32) * 120},${100 + Math.floor(index / 32) * 120}) #amber [orientation=${orientations[index % 4]}]`
	).join('\n');
}

function denseRoutingFixture(): string {
	const lines: string[] = [];
	for (let index = 0; index < 16; index += 1) {
		const y = 120 + index * 70;
		const x = 200 + index * 80;
		lines.push(`port:L${index} "L" at (60,${y}) #blue`);
		lines.push(`port:R${index} "R" at (1540,${y}) #emerald [orientation=left]`);
		lines.push(`port:T${index} "T" at (${x},110) #cyan [orientation=down]`);
		lines.push(`port:B${index} "B" at (${x},1190) #purple [orientation=up]`);
	}
	for (let index = 0; index < 16; index += 1) {
		lines.push(`L${index}.out -> R${index}.in #blue [ortho]`);
		lines.push(`T${index}.out -> B${index}.in #purple [ortho]`);
	}
	return lines.join('\n');
}

describe('operation-based performance regression gates', () => {
	test('keeps the maximum component fixture bounded in time and bytes per instance', () => {
		const startedAt = Date.now();
		const result = compileSchematic(repeatedResistors(512), {
			bounds: { width: 4096, height: 2200 },
			title: 'Maximum component performance gate',
			idPrefix: 'perf-max'
		});
		const elapsedMs = Date.now() - startedAt;

		expect(result.document.components).toHaveLength(512);
		expect(result.metrics.svgBytes / result.document.components.length).toBeLessThan(600);
		expect(elapsedMs).toBeLessThan(2_000);
	});

	test('keeps dense orthogonal routing bounded in time and bytes per connection', () => {
		const startedAt = Date.now();
		const result = compileSchematic(denseRoutingFixture(), {
			bounds: { width: 1600, height: 1300 },
			title: 'Dense routing performance gate',
			idPrefix: 'perf-dense'
		});
		const elapsedMs = Date.now() - startedAt;

		expect(result.document.connections).toHaveLength(32);
		expect(result.metrics.svgBytes / result.document.connections.length).toBeLessThan(1_500);
		expect(elapsedMs).toBeLessThan(2_000);
	});

	test('stays linear per component well past the retired 512 ceiling', () => {
		/*
		 * Removing a cap is only worth anything if the work behind it scales. This
		 * measures cost per component at two sizes an order of magnitude apart: the
		 * larger must not cost materially more each, which is what rules out a
		 * quadratic term hiding behind the old ceiling.
		 */
		const grid = (count: number) => {
			const columns = Math.ceil(Math.sqrt(count * 1.6));
			const lines: string[] = [];
			for (let index = 0; index < count; index += 1) {
				lines.push(
					`resistor:R${index} "R" at (${60 + (index % columns) * 110},${60 + Math.floor(index / columns) * 100}) #amber`
				);
			}
			for (let index = 0; index + 1 < count; index += 2) {
				if (Math.floor(index / columns) !== Math.floor((index + 1) / columns)) continue;
				lines.push(`R${index}.out -> R${index + 1}.in #amber [ortho]`);
			}
			return {
				source: lines.join('\n'),
				bounds: {
					width: 120 + columns * 110,
					height: 160 + Math.ceil(count / columns) * 100
				}
			};
		};
		const perComponent = (count: number): number => {
			const { source, bounds } = grid(count);
			const startedAt = Date.now();
			const result = compileSchematic(source, {
				bounds,
				title: 'Scaling gate',
				idPrefix: 'scale'
			});
			expect(result.document.components).toHaveLength(count);
			return (Date.now() - startedAt) / count;
		};

		const small = perComponent(1_000);
		const large = perComponent(10_000);
		expect(large).toBeLessThan(Math.max(small, 0.01) * 4);
		expect(large * 10_000).toBeLessThan(10_000);
	});

	test('amortizes repeated canonical geometry below a per-instance byte ceiling', () => {
		const one = compileSchematic(repeatedResistors(1), {
			bounds: { width: 4096, height: 2200 },
			title: 'Repeated symbol performance gate',
			idPrefix: 'perf-repeat'
		});
		const sixtyFour = compileSchematic(repeatedResistors(64), {
			bounds: { width: 4096, height: 2200 },
			title: 'Repeated symbol performance gate',
			idPrefix: 'perf-repeat'
		});
		const incrementalBytes = (sixtyFour.metrics.svgBytes - one.metrics.svgBytes) / 63;

		expect(incrementalBytes).toBeLessThan(550);
	});
});
