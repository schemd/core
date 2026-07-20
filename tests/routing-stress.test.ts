/**
 * Routing / bridge stress verification.
 *
 * These cases hammer the orthogonal router and the crossing-bridge pass with a
 * dense edge-anchored mesh, then assert every emitted trace is a well-formed
 * SVG path: legal commands, finite coordinates, and strictly renderable arc
 * radii. Malformed geometry (NaN corners, zero-radius arcs, discontinuous pens)
 * would surface here long before it reached a browser.
 *
 * Empirically (see the fuzz harness that motivated this file), the router never
 * emits a malformed path: every unroutable input fails loudly with a throw, and
 * every routed trace is renderable. These tests pin that guarantee.
 */
import { describe, expect, test } from 'vitest';
import { compileSchematic } from '../src/index.js';
import { SCHEMATIC_BRIDGE_RADIUS } from '../src/layout.js';

/** Full mode keeps every wire a separate <path>; default mode batches by colour. */
const FENCE = { bounds: { width: 4000, height: 4000 }, title: 'stress', mode: 'full' } as const;

/** Every routed trace carries the `schematic-trace` class on its <path>. */
function tracePaths(svg: string): string[] {
	const paths: string[] = [];
	const re = /<path\b([^>]*)\bd="([^"]*)"/g;
	let match: RegExpExecArray | null;
	while ((match = re.exec(svg)) !== null) {
		if (match[1]!.includes('schematic-trace')) paths.push(match[2]!);
	}
	return paths;
}

interface PathToken {
	readonly cmd: string;
	readonly nums: number[];
}

function tokenize(d: string): PathToken[] {
	const tokens: PathToken[] = [];
	const re = /([MLHVACQZ])|(-?\d*\.?\d+(?:e-?\d+)?)/gi;
	let match: RegExpExecArray | null;
	let current: PathToken | undefined;
	while ((match = re.exec(d)) !== null) {
		if (match[1]) {
			current = { cmd: match[1], nums: [] };
			tokens.push(current);
		} else if (current) {
			current.nums.push(Number(match[2]));
		}
	}
	return tokens;
}

/** Assert a single trace path is renderable; returns the arc (bridge) count. */
function assertWellFormed(d: string): number {
	expect(d).not.toMatch(/NaN|Infinity|undefined/);
	const tokens = tokenize(d);
	expect(tokens.length).toBeGreaterThan(0);
	expect(tokens[0]!.cmd.toUpperCase()).toBe('M');
	let arcs = 0;
	for (const { cmd, nums } of tokens) {
		for (const value of nums) expect(Number.isFinite(value)).toBe(true);
		if (cmd.toUpperCase() === 'A') {
			arcs += 1;
			const [rx, ry] = nums;
			// A renderable engineering bridge: positive radius, never larger than the
			// design radius, never so small it serializes to a zero-radius arc.
			expect(rx!).toBeGreaterThanOrEqual(0.001);
			expect(ry!).toBeGreaterThanOrEqual(0.001);
			expect(rx!).toBeLessThanOrEqual(SCHEMATIC_BRIDGE_RADIUS + 1e-6);
		}
	}
	return arcs;
}

/**
 * An edge-anchored mesh: `n` horizontal traces span the full width at distinct
 * rows, `n` vertical traces span the full height at distinct columns. Every
 * body sits at a margin, so the interior is obstacle-free and each of the n²
 * intersections is a genuine crossing. Verticals are declared last, so each one
 * bridges all `n` horizontals on its single vertical segment.
 */
function edgeMesh(n: number, step: number): string {
	const extent = 200 + (n + 1) * step;
	const lines: string[] = [];
	for (let row = 0; row < n; row += 1) {
		const y = 180 + row * step;
		lines.push(`port:L${row} "l" at (60, ${y}) #blue`);
		lines.push(`port:R${row} "r" at (${extent - 60}, ${y}) #blue`);
	}
	for (let col = 0; col < n; col += 1) {
		const x = 180 + col * step;
		lines.push(`port:T${col} "t" at (${x}, 60) #cyan`);
		lines.push(`port:B${col} "b" at (${x}, ${extent - 60}) #cyan`);
	}
	for (let row = 0; row < n; row += 1) lines.push(`L${row}.out -> R${row}.in #blue [ortho]`);
	for (let col = 0; col < n; col += 1) lines.push(`T${col}.out -> B${col}.in #cyan [ortho]`);
	return lines.join('\n');
}

describe('routing / bridge stress', () => {
	test('edge meshes bridge every one of n² crossings with only well-formed arcs', () => {
		for (let n = 2; n <= 8; n += 1) {
			const compiled = compileSchematic(edgeMesh(n, 300), { ...FENCE, idPrefix: `mesh${n}` });
			const traces = tracePaths(compiled.svg);
			expect(traces.length).toBe(2 * n);

			const arcCounts = traces.map(assertWellFormed);
			const totalArcs = arcCounts.reduce((sum, count) => sum + count, 0);
			const bridged = arcCounts.filter((count) => count > 0);
			const straight = arcCounts.filter((count) => count === 0);

			// Exactly the n² interior crossings become bridges…
			expect(totalArcs).toBe(n * n);
			// …carried by the n later (vertical) traces, n bridges each…
			expect(bridged).toHaveLength(n);
			expect(bridged.every((count) => count === n)).toBe(true);
			// …while the n earlier (horizontal) spines stay perfectly straight.
			expect(straight).toHaveLength(n);
		}
	});

	test('separated components with mixed curves never desynchronize the pen', () => {
		const kinds = ['resistor', 'capacitor', 'inductor', 'diode'];
		const lines: string[] = [];
		let previous: { id: string; kind: string } | undefined;
		for (let index = 0; index < 24; index += 1) {
			const kind = kinds[index % kinds.length]!;
			const id = `${kind[0]!.toUpperCase()}${index}`;
			const x = 200 + (index % 6) * 560;
			const y = 200 + Math.floor(index / 6) * 620;
			lines.push(`${kind}:${id} "${id}" at (${x}, ${y}) #amber`);
			if (previous) {
				const curve = ['ortho', 'line', 'bezier'][index % 3];
				const fromPort = previous.kind === 'diode' ? 'cathode' : 'out';
				const toPort = kind === 'diode' ? 'anode' : 'in';
				lines.push(`${previous.id}.${fromPort} -> ${id}.${toPort} #slate [${curve}]`);
			}
			previous = { id, kind };
		}
		const compiled = compileSchematic(lines.join('\n'), { ...FENCE, idPrefix: 'mix' });
		const traces = tracePaths(compiled.svg);
		expect(traces.length).toBe(23);
		for (const d of traces) assertWellFormed(d);
	});
});
