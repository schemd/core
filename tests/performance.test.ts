import { performance } from 'node:perf_hooks';
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
		const startedAt = performance.now();
		const result = compileSchematic(repeatedResistors(512), {
			bounds: { width: 4096, height: 2200 },
			title: 'Maximum component performance gate',
			idPrefix: 'perf-max'
		});
		const elapsedMs = performance.now() - startedAt;

		expect(result.document.components).toHaveLength(512);
		expect(result.metrics.svgBytes / result.document.components.length).toBeLessThan(600);
		expect(elapsedMs).toBeLessThan(2_000);
	});

	test('keeps dense orthogonal routing bounded in time and bytes per connection', () => {
		const startedAt = performance.now();
		const result = compileSchematic(denseRoutingFixture(), {
			bounds: { width: 1600, height: 1300 },
			title: 'Dense routing performance gate',
			idPrefix: 'perf-dense'
		});
		const elapsedMs = performance.now() - startedAt;

		expect(result.document.connections).toHaveLength(32);
		expect(result.metrics.svgBytes / result.document.connections.length).toBeLessThan(1_500);
		expect(elapsedMs).toBeLessThan(2_000);
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
