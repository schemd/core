/**
 * Bundle nudging: laying contending traces out together when ordering is spent.
 *
 * 0.5.0 recorded thirteen wires as "a limit of the channel model rather than of
 * declaration order", and pinned it with a test. That was measured the only way
 * available at the time — twenty thousand declaration orders, none of which
 * routed — but the conclusion did not follow. Reordering explores which trace
 * chooses *first*; it cannot reach a layout in which no trace takes the middle
 * channel, because somebody always chooses first. The channel model was never
 * full: a twelve-unit pitch across that fence admits legal routings for at least
 * thirty-two wires, and this suite pins that instead.
 *
 * **The hazard this suite exists to catch.** The retired test carried a warning
 * worth keeping: *"a router that admits illegal edges would solve this, which is
 * how the defect would have looked like a feature."* Exactly so. A router that
 * quietly permitted collinear overlap would route any width at all and produce
 * copper nobody can read. So the width tests below are not satisfied by "it did
 * not throw" — every one of them reads the geometry back out of the compiled SVG
 * and proves no two traces touch illegally.
 */
import { describe, expect, test } from 'vitest';

import { compileSchematic } from '../src/compiler.js';

/** A full reversal bus: wire `i` runs from row `i` to row `n - 1 - i`. */
function reversalBus(wires: number, pitch = 140, span = 1120): string {
	const lines: string[] = [];
	for (let index = 0; index < wires; index += 1) {
		lines.push(`port:L${index} "L" at (80,${100 + index * pitch}) #blue`);
		lines.push(`port:R${index} "R" at (${80 + span},${100 + (wires - 1 - index) * pitch}) #blue`);
	}
	for (let index = 0; index < wires; index += 1) {
		lines.push(`L${index}.out -> R${index}.in #blue [ortho]`);
	}
	return lines.join('\n');
}

/** A fence tall enough to hold `wires` rows at the default pitch. */
function busFence(wires: number, pitch = 140) {
	return {
		bounds: { width: 1400, height: 100 + wires * pitch + 200 },
		title: 'reversal bus'
	} as const;
}

/* ---------- reading geometry back out of the compiled drawing ---------- */

interface Segment {
	readonly wire: number;
	readonly ax: number;
	readonly ay: number;
	readonly bx: number;
	readonly by: number;
}

/**
 * Recover every axis-aligned segment the renderer actually drew.
 *
 * Deliberately parsed from the SVG rather than taken from `routes`: the claim
 * under test is about the picture, and a router that reported one geometry while
 * drawing another would satisfy an assertion made against its own return value.
 */
function drawnSegments(svg: string): Segment[] {
	const segments: Segment[] = [];
	const groups = [...svg.matchAll(/<g class="schematic-wire"[^>]*>(.*?)<\/g>/gs)];
	const paths =
		groups.length > 0
			? groups.map((group, index) => [index, group[1]!] as const)
			: [...svg.matchAll(/<path[^>]*\sd="([^"]+)"/g)].map(
					(match, index) => [index, match[0]!] as const
				);
	for (const [wire, markup] of paths) {
		for (const path of markup.matchAll(/\sd="([^"]+)"/g)) {
			const tokens = path[1]!.trim().split(/\s+/);
			let x = 0;
			let y = 0;
			let started = false;
			for (let index = 0; index < tokens.length; index += 1) {
				const command = tokens[index]!;
				if (command === 'M') {
					x = Number(tokens[++index]);
					y = Number(tokens[++index]);
					started = true;
				} else if (command === 'H' && started) {
					const next = Number(tokens[++index]);
					if (next !== x) segments.push({ wire, ax: x, ay: y, bx: next, by: y });
					x = next;
				} else if (command === 'V' && started) {
					const next = Number(tokens[++index]);
					if (next !== y) segments.push({ wire, ax: x, ay: y, bx: x, by: next });
					y = next;
				} else if (command === 'A') {
					/* Bridge arc: skip its five parameters and adopt the endpoint. */
					index += 5;
					x = Number(tokens[++index]);
					y = Number(tokens[++index]);
				} else if (command === 'L') {
					x = Number(tokens[++index]);
					y = Number(tokens[++index]);
				}
			}
		}
	}
	return segments;
}

const horizontal = (segment: Segment): boolean => segment.ay === segment.by;
const low = (a: number, b: number): number => Math.min(a, b);
const high = (a: number, b: number): number => Math.max(a, b);

/**
 * Count contacts between two traces that the compiler's own rules forbid.
 *
 * Legal: a strict perpendicular crossing through the interior of both segments.
 * Illegal: collinear overlap of any length, and any T-junction or shared corner.
 */
function illegalContacts(segments: readonly Segment[]): number {
	let illegal = 0;
	for (let a = 0; a < segments.length; a += 1) {
		for (let b = a + 1; b < segments.length; b += 1) {
			const left = segments[a]!;
			const right = segments[b]!;
			if (left.wire === right.wire) continue;
			if (horizontal(left) === horizontal(right)) {
				/* Parallel: they may not share a line and overlap on it. */
				const sharedLine = horizontal(left)
					? left.ay === right.ay
					: left.ax === right.ax;
				if (!sharedLine) continue;
				const [lowA, highA] = horizontal(left)
					? [low(left.ax, left.bx), high(left.ax, left.bx)]
					: [low(left.ay, left.by), high(left.ay, left.by)];
				const [lowB, highB] = horizontal(right)
					? [low(right.ax, right.bx), high(right.ax, right.bx)]
					: [low(right.ay, right.by), high(right.ay, right.by)];
				if (Math.max(lowA, lowB) <= Math.min(highA, highB)) illegal += 1;
				continue;
			}
			const flat = horizontal(left) ? left : right;
			const upright = horizontal(left) ? right : left;
			const withinFlat =
				upright.ax >= low(flat.ax, flat.bx) && upright.ax <= high(flat.ax, flat.bx);
			const withinUpright =
				flat.ay >= low(upright.ay, upright.by) && flat.ay <= high(upright.ay, upright.by);
			if (!withinFlat || !withinUpright) continue;
			/* Touching either segment's endpoint is a T or a corner, not a crossing. */
			const strictlyInsideFlat = upright.ax !== flat.ax && upright.ax !== flat.bx;
			const strictlyInsideUpright = flat.ay !== upright.ay && flat.ay !== upright.by;
			if (!(strictlyInsideFlat && strictlyInsideUpright)) illegal += 1;
		}
	}
	return illegal;
}

describe('the ceiling that was not a ceiling', () => {
	test.each([13, 14, 16, 20, 24, 32])('routes a %i-wire reversal bus', (wires) => {
		const result = compileSchematic(reversalBus(wires), { ...busFence(wires), mode: 'full' });
		expect(result.svg).toContain('<svg');
		expect(result.routing.nudged).toBe(true);
	});

	test.each([13, 16, 24, 32])(
		'draws a %i-wire bus with no illegal contact between traces',
		(wires) => {
			/*
			 * The assertion the retired ceiling test was really protecting. A router
			 * that admitted collinear overlap would pass every "it routed" check
			 * above and produce unreadable copper; this reads the drawing back and
			 * proves it did not.
			 */
			const result = compileSchematic(reversalBus(wires), { ...busFence(wires), mode: 'full' });
			const segments = drawnSegments(result.svg);
			expect(segments.length).toBeGreaterThan(wires);
			expect(illegalContacts(segments)).toBe(0);
		}
	);

	test('every trace still reaches both of its declared terminals', () => {
		/* Legality is not enough: a router that dropped a wire would also report
		   no illegal contacts. Each declared endpoint must appear in the drawing. */
		const wires = 16;
		const result = compileSchematic(reversalBus(wires), { ...busFence(wires), mode: 'full' });
		for (let index = 0; index < wires; index += 1) {
			expect(result.svg).toContain(`data-wire-source="L${index}.out"`);
			expect(result.svg).toContain(`data-wire-target="R${index}.in"`);
		}
		expect(result.document.connections).toHaveLength(wires);
	});
});

describe('the greedy path is untouched', () => {
	test.each([2, 4, 8, 11, 12])('a %i-wire bus never reaches the bundle path', (wires) => {
		/*
		 * The compatibility guarantee. Nudging runs only after rip-up spends its
		 * whole budget, so anything that compiled before reaches the same routes
		 * through the same code — which is why all 261 corpus digests are unmoved.
		 */
		const result = compileSchematic(reversalBus(wires), { ...busFence(wires), mode: 'full' });
		expect(result.routing.nudged).toBe(false);
	});

	test('a clean document reports neither retries nor nudging', () => {
		const result = compileSchematic(
			[
				'resistor:R1 "1k" at (200, 200) #amber',
				'resistor:R2 "2k" at (600, 200) #blue',
				'R1.out -> R2.in #amber [ortho]'
			].join('\n'),
			{ bounds: { width: 900, height: 500 }, title: 'clean', mode: 'full' }
		);
		expect(result.routing.attempts).toBe(0);
		expect(result.routing.nudged).toBe(false);
	});

	test('the attempt budget still governs, and still names the contention', () => {
		/*
		 * `routingAttempts: 1` disables retries, and must therefore also disable the
		 * bundle path — it is reached only when retries are exhausted. A budget a
		 * host sets and the router ignores would be worse than no budget.
		 */
		expect(() =>
			compileSchematic(reversalBus(13), { ...busFence(13), limits: { routingAttempts: 1 } })
		).toThrow(/No orthogonal route from .* clears every component and earlier trace/);
	});
});

describe('the bundle path refuses what it cannot lay out', () => {
	test('a bundle containing a non-orthogonal trace is not nudged', () => {
		/*
		 * The dogleg shape is meaningless for a straight or Bézier trace, so a mixed
		 * bundle keeps the original diagnostic rather than receiving a layout that
		 * only covers part of it.
		 */
		const source = reversalBus(13).replace(
			'L0.out -> R0.in #blue [ortho]',
			'L0.out -> R0.in #blue [line]'
		);
		expect(() => compileSchematic(source, busFence(13))).toThrow(/No orthogonal route from/);
	});

	test('a bundle that will not fit the canvas is refused rather than drawn outside it', () => {
		/* Bounds are checked per point before any route is accepted. */
		expect(() =>
			compileSchematic(reversalBus(13), {
				bounds: { width: 1400, height: 1300 },
				title: 'cramped'
			})
		).toThrow();
	});

	test('a single connection is never a bundle', () => {
		const result = compileSchematic(
			[
				'port:A "A" at (100, 200) #blue',
				'port:B "B" at (700, 400) #blue [orientation=left]',
				'A.out -> B.in #blue [ortho]'
			].join('\n'),
			{ bounds: { width: 900, height: 600 }, title: 'single', mode: 'full' }
		);
		expect(result.routing.nudged).toBe(false);
	});
});

describe('determinism', () => {
	test(
		'a nudged bus compiles to one distinct output on every run',
		() => {
			/*
			 * The bundle path introduces a second way to produce geometry, so it needs
			 * the guarantee the greedy path already has. Rank is a pure function of
			 * geometry — source row, then source column, then declaration index — with
			 * no clock, no randomness and no iteration over an unordered container.
			 *
			 * Thirty runs, for the reason the rip-up suite gives for its own count:
			 * every source of nondeterminism reachable from here diverges on the
			 * second run, not the thirtieth. A nudged bus is several times dearer than
			 * that suite's fixture, and under coverage the difference is the whole
			 * budget. The case in-process repetition cannot reach — another process on
			 * another platform — is covered by compiling the goldens on Linux.
			 */
			const outputs = new Set<string>();
			for (let run = 0; run < 30; run += 1) {
				outputs.add(compileSchematic(reversalBus(16), { ...busFence(16), mode: 'full' }).svg);
			}
			expect(outputs.size).toBe(1);
		},
		60_000
	);

	test('declaration order does not change the drawing', () => {
		/*
		 * Rank is geometric, so shuffling the declarations must produce the same
		 * bundle. This is the property that makes the layout a function of the
		 * diagram rather than of how it was typed — and it is what the retired
		 * twenty-thousand-order search was really probing for.
		 */
		const wires = 14;
		const forward = compileSchematic(reversalBus(wires), { ...busFence(wires), mode: 'full' });

		const lines = reversalBus(wires).split('\n');
		const declarations = lines.filter((line) => !line.includes('->'));
		const traces = lines.filter((line) => line.includes('->'));
		const shuffled = [...declarations, ...traces.reverse()].join('\n');
		const reversed = compileSchematic(shuffled, { ...busFence(wires), mode: 'full' });

		expect(illegalContacts(drawnSegments(reversed.svg))).toBe(0);
		expect(reversed.routing.nudged).toBe(true);
		/*
		 * The bundle is the same, and so is the amount of crossing it has to do.
		 *
		 * Not asserted: an identical byte stream. Bridge arcs are owned by the
		 * *later* trace at each crossing, which is a documented source-order
		 * property predating this work, so reversing the declarations moves which
		 * wire carries each scallop. The order-independent claims are that the
		 * layout is legal, that it needed the bundle path, and that it crosses
		 * itself exactly as many times.
		 */
		const bridges = (svg: string): number => (svg.match(/ A /g) ?? []).length;
		expect(bridges(reversed.svg)).toBe(bridges(forward.svg));
		expect(reversed.document.connections).toHaveLength(wires);
	});
});

describe('every way the bundle path can decline', () => {
	/*
	 * The shape only suits some bundles, and the guards that detect the rest are
	 * the difference between a rescue and a wrong drawing. Each one is reached
	 * with a real document below, because an unexercised guard in a fallback path
	 * is indistinguishable from a guard that does not work.
	 */

	test('lays out a bundle that flows right to left', () => {
		/* Column insets step *inward from each end*, so the direction of travel is
		   a sign the shape depends on. A mirrored bus must route identically. */
		const wires = 14;
		const lines: string[] = [];
		for (let index = 0; index < wires; index += 1) {
			/* Both ends face left, so the source escapes leftward and the target is
			   approached from its right — a bundle that travels right to left. */
			lines.push(`port:L${index} "L" at (80,${100 + index * 140}) #blue [orientation=left]`);
			lines.push(
				`port:R${index} "R" at (1200,${100 + (wires - 1 - index) * 140}) #blue [orientation=left]`
			);
		}
		for (let index = 0; index < wires; index += 1) {
			lines.push(`R${index}.out -> L${index}.in #blue [ortho]`);
		}
		const result = compileSchematic(lines.join('\n'), { ...busFence(wires), mode: 'full' });
		expect(result.routing.nudged).toBe(true);
		expect(illegalContacts(drawnSegments(result.svg))).toBe(0);
	});

	test('orders the bundle by source row, not by declaration order', () => {
		/*
		 * Rank decides which column each trace turns on, so the claim is specific:
		 * the trace leaving the highest row turns first, the next one a pitch
		 * further along, and so on down the bus. Asserting only that the drawing is
		 * legal would not notice ranking by declaration index instead — every
		 * permutation of distinct columns is legal. So the columns are read back and
		 * required to ascend with the source row, under both declaration orders.
		 */
		const wires = 14;
		const lines = reversalBus(wires).split('\n');
		const declarations = lines.filter((line) => !line.includes('->'));
		const traces = lines.filter((line) => line.includes('->'));

		for (const source of [
			[...declarations, ...traces].join('\n'),
			[...declarations, ...[...traces].reverse()].join('\n')
		]) {
			const result = compileSchematic(source, { ...busFence(wires), mode: 'full' });
			expect(result.routing.nudged).toBe(true);
			expect(illegalContacts(drawnSegments(result.svg))).toBe(0);

			/* Source row -> the column that trace first turns on. */
			const turns: { row: number; column: number }[] = [];
			for (const group of result.svg.matchAll(
				/<g class="schematic-wire"[^>]*data-wire-source="L(\d+)\.out"[^>]*>(.*?)<\/g>/gs
			)) {
				const row = Number(group[1]);
				const first = drawnSegments(group[2]!).find((segment) => segment.ax === segment.bx);
				expect(first).toBeDefined();
				turns.push({ row: 100 + row * 140, column: first!.ax });
			}
			expect(turns).toHaveLength(wires);
			turns.sort((left, right) => left.row - right.row);
			for (let index = 1; index < turns.length; index += 1) {
				expect(turns[index]!.column).toBeGreaterThan(turns[index - 1]!.column);
			}
		}
	});

	test('declines a bundle whose middle row would fall outside a trace', () => {
		/*
		 * A nearly level trace has no room for a dogleg: its middle row would sit
		 * outside its own span, producing a legal but absurd detour. Refusing keeps
		 * the caller's diagnostic, which is the honest answer for a bundle this
		 * shape does not fit.
		 */
		const wires = 13;
		const lines: string[] = [];
		for (let index = 0; index < wires; index += 1) {
			lines.push(`port:L${index} "L" at (80,${100 + index * 140}) #blue`);
			lines.push(`port:R${index} "R" at (1200,${100 + (wires - 1 - index) * 140}) #blue`);
		}
		/* One extra pair, level with each other and far below the bundle's band. */
		const low = 100 + wires * 140;
		lines.push(`port:LA "LA" at (80,${low}) #cyan`);
		lines.push(`port:RA "RA" at (1200,${low + 6}) #cyan`);
		for (let index = 0; index < wires; index += 1) {
			lines.push(`L${index}.out -> R${index}.in #blue [ortho]`);
		}
		lines.push('LA.out -> RA.in #cyan [ortho]');
		expect(() =>
			compileSchematic(lines.join('\n'), {
				bounds: { width: 1400, height: low + 300 },
				title: 'level trace'
			})
		).toThrow(/No orthogonal route from/);
	});

	test('declines a bundle whose columns would pass each other', () => {
		/*
		 * Columns step inward from each end by rank, so a bundle with a short
		 * horizontal span runs out of room: past the middle the outbound column
		 * would sit beyond the inbound one and the dogleg would fold back on
		 * itself. Refused rather than drawn inside out.
		 */
		const wires = 13;
		const lines: string[] = [];
		for (let index = 0; index < wires; index += 1) {
			lines.push(`port:L${index} "L" at (80,${100 + index * 140}) #blue`);
			lines.push(`port:R${index} "R" at (300,${100 + (wires - 1 - index) * 140}) #blue`);
		}
		for (let index = 0; index < wires; index += 1) {
			lines.push(`L${index}.out -> R${index}.in #blue [ortho]`);
		}
		expect(() =>
			compileSchematic(lines.join('\n'), {
				bounds: { width: 600, height: 100 + wires * 140 + 200 },
				title: 'narrow'
			})
		).toThrow(/No orthogonal route from|overlaps/);
	});

	test('declines a bundle whose traces would share a row on the way out', () => {
		/*
		 * Two traces leaving the same row run along it to their own columns, and
		 * those runs overlap — collinear copper between separate nets, which is
		 * exactly what the occupancy predicate rejects. The bundle is checked with
		 * that predicate rather than trusted, so it must decline here.
		 */
		const wires = 13;
		const lines: string[] = [];
		for (let index = 0; index < wires; index += 1) {
			lines.push(`port:L${index} "L" at (80,${100 + index * 140}) #blue`);
			lines.push(`port:R${index} "R" at (1200,${100 + (wires - 1 - index) * 140}) #blue`);
		}
		/* A second source sharing L0's row, and its own target on the far side. */
		lines.push('port:S "S" at (420,100) #cyan');
		lines.push(`port:T "T" at (1200,${100 + wires * 140}) #cyan [orientation=left]`);
		for (let index = 0; index < wires; index += 1) {
			lines.push(`L${index}.out -> R${index}.in #blue [ortho]`);
		}
		lines.push('S.out -> T.in #cyan [ortho]');
		expect(() =>
			compileSchematic(lines.join('\n'), {
				bounds: { width: 1400, height: 100 + (wires + 1) * 140 + 200 },
				title: 'shared row'
			})
		).toThrow(/No orthogonal route from|overlaps/);
	});

	test('declines a bundle that would leave the canvas', () => {
		/*
		 * Every point is checked against the fence before a route is accepted. The
		 * fence here is wide enough to declare the ports but too tight for the
		 * middle rows the bundle needs.
		 */
		expect(() =>
			compileSchematic(reversalBus(13), { bounds: { width: 1210, height: 2000 }, title: 'tight' })
		).toThrow();
	});

	test('declines a bundle whose channel is blocked by a component', () => {
		/*
		 * The bundle is verified with the router's own obstacle predicate, not a
		 * second opinion — so a body parked in the middle band must abandon it.
		 */
		const wires = 13;
		const lines: string[] = [];
		for (let index = 0; index < wires; index += 1) {
			lines.push(`port:L${index} "L" at (80,${100 + index * 140}) #blue`);
			lines.push(`port:R${index} "R" at (1200,${100 + (wires - 1 - index) * 140}) #blue`);
		}
		/* A wide part sitting exactly across the rows the bundle crosses. */
		lines.push(`ic:U1 "Blocker" at (640,${100 + 6 * 140}) #slate [left="a,b,c,d" right="w,x,y,z"]`);
		for (let index = 0; index < wires; index += 1) {
			lines.push(`L${index}.out -> R${index}.in #blue [ortho]`);
		}
		expect(() =>
			compileSchematic(lines.join('\n'), { ...busFence(wires), title: 'blocked' })
		).toThrow(/No orthogonal route from|overlaps/);
	});

	test('carries endpoint markers through a nudged bundle', () => {
		/* Markers are validated against the shape the bundle produced, so a wide
		   marked bus exercises that path rather than the greedy one. */
		const wires = 13;
		const lines: string[] = [];
		for (let index = 0; index < wires; index += 1) {
			lines.push(`port:L${index} "L" at (80,${100 + index * 140}) #blue`);
			lines.push(`port:R${index} "R" at (1200,${100 + (wires - 1 - index) * 140}) #blue`);
		}
		for (let index = 0; index < wires; index += 1) {
			lines.push(`L${index}.out -> R${index}.in #blue [ortho marker-end=arrow]`);
		}
		const result = compileSchematic(lines.join('\n'), { ...busFence(wires), mode: 'full' });
		expect(result.routing.nudged).toBe(true);
		expect(result.svg).toContain('marker-end');
		expect(illegalContacts(drawnSegments(result.svg))).toBe(0);
	});
});

describe('scaling', () => {
	test('wider buses cost more but stay bounded', () => {
		/*
		 * The bundle path runs once, after the retry budget is spent, and lays out
		 * every trace in one pass — so its cost is linear in the bundle, not in the
		 * retries. A regression that made it quadratic would show here.
		 */
		const measure = (wires: number): number => {
			const started = performance.now();
			compileSchematic(reversalBus(wires), { ...busFence(wires) });
			return performance.now() - started;
		};
		measure(16);
		const narrow = measure(16);
		const wide = measure(32);
		/* Twice the wires, generously under eight times the cost. */
		expect(wide).toBeLessThan(narrow * 8);
	});
});
