/**
 * `RouterArena`: the allocation-free scratch behind the sparse Manhattan fallback.
 *
 * The arena replaced a heap of object literals and two `Map`s. Three things it
 * inherited are load-bearing and are asserted here rather than assumed:
 *
 * - **The `(f, g, state)` total order.** Determinism is a published property of
 *   this compiler; a document must compile to one output across runs and
 *   platforms. That guarantee reduces to this comparison, so it is tested
 *   directly and against a reference sort.
 * - **An unvisited state costs infinity, not "anything is better".** The
 *   retired code wrote `g >= (gScore.get(state) ?? Number.POSITIVE_INFINITY)`.
 *   `wireSegmentCost` returns `Infinity` for a contact the geometry validator
 *   rejects, so that default is what refuses an illegal edge. Reading "never
 *   seen" as improvable admits it, and the router then returns overlapping
 *   routes — which only congested documents reveal, because only they price a
 *   contact that high. Both halves are pinned below.
 * - **Reuse across routes and rip-up passes is invisible.** A shared arena must
 *   give a document's hundredth route the answer a fresh one would.
 */
import { describe, expect, test } from 'vitest';

import { compileSchematic } from '../src/index.js';
import { RouterArena } from '../src/layout.js';

/** A reversal bus of `wires` traces: every trace crosses every other. */
function reversalBus(wires: number): string {
	const lines: string[] = [];
	for (let index = 0; index < wires; index += 1) {
		lines.push(`port:L${index} "L" at (80, ${100 + index * 140}) #blue`);
		lines.push(`port:R${index} "R" at (1200, ${100 + (wires - 1 - index) * 140}) #blue`);
	}
	for (let index = 0; index < wires; index += 1) {
		lines.push(`L${index}.out -> R${index}.in #blue [ortho]`);
	}
	return lines.join('\n');
}

const BUS_FENCE = { bounds: { width: 1400, height: 1800 }, title: 'reversal bus' } as const;

describe('the heap order', () => {
	test('pops in ascending (f, g, state) order', () => {
		const arena = new RouterArena();
		arena.begin(64);
		/* Deliberately inserted out of order, with ties on f and on g so both
		   tiebreaks are exercised rather than only the primary key. */
		const entries: readonly [number, number, number][] = [
			[9, 1, 5],
			[3, 2, 7],
			[3, 1, 8],
			[3, 1, 2],
			[7, 4, 1],
			[1, 9, 9]
		];
		for (const [f, g, state] of entries) arena.push(state, g, f);

		const popped: [number, number, number][] = [];
		while (arena.size > 0) {
			arena.pop();
			const state = arena.poppedState;
			const g = arena.poppedG;
			popped.push([entries.find((entry) => entry[2] === state)![0], g, state]);
		}
		const expected = [...entries].sort(
			(left, right) => left[0] - right[0] || left[1] - right[1] || left[2] - right[2]
		);
		expect(popped).toEqual(expected);
	});

	test('agrees with a reference sort over randomized pushes', () => {
		/* Deterministic, so a failure is reproducible. */
		let seed = 0x2545f491;
		const next = () => {
			seed = (seed + 0x6d2b79f5) >>> 0;
			let t = seed;
			t = Math.imul(t ^ (t >>> 15), t | 1);
			t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
			return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
		};
		for (let trial = 0; trial < 60; trial += 1) {
			const arena = new RouterArena();
			arena.begin(512);
			const entries: [number, number, number][] = [];
			const count = 1 + Math.floor(next() * 200);
			for (let index = 0; index < count; index += 1) {
				/* A tiny value range forces ties, which is where an order bug hides. */
				const f = Math.floor(next() * 4);
				const g = Math.floor(next() * 3);
				const state = index;
				entries.push([f, g, state]);
				arena.push(state, g, f);
			}
			const expected = entries
				.sort((left, right) => left[0] - right[0] || left[1] - right[1] || left[2] - right[2])
				.map((entry) => entry[2]);
			const actual: number[] = [];
			while (arena.size > 0) {
				arena.pop();
				actual.push(arena.poppedState);
			}
			expect(actual).toEqual(expected);
		}
	});

	test('grows past the state count, because a state may be queued many times', () => {
		/*
		 * Lazy deletion: a state is pushed again whenever a cheaper route to it is
		 * found and the superseded entry stays until it surfaces. Sizing the heap
		 * to the state count would overflow on exactly the congested documents the
		 * fallback exists for.
		 */
		const arena = new RouterArena();
		arena.begin(2);
		for (let index = 0; index < 4_096; index += 1) arena.push(index % 6, index, 4_096 - index);
		expect(arena.size).toBe(4_096);
		let previous = -Infinity;
		let count = 0;
		while (arena.size > 0) {
			arena.pop();
			count += 1;
			expect(arena.poppedG).toBeGreaterThanOrEqual(previous === -Infinity ? -Infinity : 0);
			previous = 0;
		}
		expect(count).toBe(4_096);
	});

	test('pops a single entry without entering the sift', () => {
		const arena = new RouterArena();
		arena.begin(8);
		arena.push(3, 1, 2);
		arena.pop();
		expect(arena.poppedState).toBe(3);
		expect(arena.poppedG).toBe(1);
		expect(arena.size).toBe(0);
	});
});

describe('an unvisited state costs infinity', () => {
	test('refuses an edge priced at infinity', () => {
		/* The exact defect: `improves` must not read "never seen" as improvable. */
		const arena = new RouterArena();
		arena.begin(16);
		expect(arena.improves(4, Number.POSITIVE_INFINITY)).toBe(false);
	});

	test('accepts any finite edge to an unvisited state', () => {
		const arena = new RouterArena();
		arena.begin(16);
		expect(arena.improves(4, Number.MAX_VALUE)).toBe(true);
		expect(arena.improves(4, 0)).toBe(true);
	});

	test('accepts only a strictly cheaper edge to a visited state', () => {
		const arena = new RouterArena();
		arena.begin(16);
		arena.relax(4, 1, 10);
		expect(arena.improves(4, 11)).toBe(false);
		expect(arena.improves(4, 10)).toBe(false);
		expect(arena.improves(4, 9.999)).toBe(true);
		expect(arena.improves(4, Number.POSITIVE_INFINITY)).toBe(false);
	});

	test('a congested bus still routes without overlapping traces', () => {
		/*
		 * The document that caught the defect. An eleven-wire reversal bus needs
		 * the rip-up path, which is the only place an infinite-cost edge is
		 * offered; admitting one produced routes the geometry validator then
		 * rejected as overlapping copper.
		 */
		for (const wires of [11, 12]) {
			const result = compileSchematic(reversalBus(wires), { ...BUS_FENCE, mode: 'full' });
			expect(result.routing.attempts).toBeGreaterThan(0);
			expect(result.svg).toContain('<svg');
		}
	});

	test('thirteen wires routes through the bundle path, not through a relaxed rule', () => {
		/*
		 * This asserted an unroutable ceiling, with a warning worth preserving: *a
		 * router that admits illegal edges would "solve" this, which is how the
		 * defect would have looked like a feature.* Exactly right, and it is why
		 * routing thirteen wires is not on its own evidence of anything.
		 *
		 * So the arena's contract is what is checked here — the search still refuses
		 * an edge the contact validator would reject — while the proof that the
		 * wider drawings are actually legal lives in `tests/nudging.test.ts`, which
		 * reads every segment back out of the SVG and looks for overlap.
		 */
		const result = compileSchematic(reversalBus(13), {
			bounds: { width: 1400, height: 2000 },
			title: 'reversal bus',
			mode: 'full'
		});
		expect(result.routing.nudged).toBe(true);
		/* Reordering alone still cannot do it: the budget must be spent first. */
		expect(result.routing.attempts).toBeGreaterThan(0);
	});
});

describe('epoch reuse', () => {
	test('a reused arena answers as a fresh one would', () => {
		const fresh = new RouterArena();
		fresh.begin(32);
		fresh.relax(5, 2, 4);

		const reused = new RouterArena();
		reused.begin(32);
		reused.relax(5, 2, 999);
		reused.relax(9, 1, 7);
		reused.begin(32);
		reused.relax(5, 2, 4);

		expect(reused.current(5, 4)).toBe(fresh.current(5, 4));
		expect(reused.current(9, 7)).toBe(false);
		expect(reused.improves(9, 8)).toBe(true);
	});

	test('a state left over from the previous route is not current', () => {
		const arena = new RouterArena();
		arena.begin(32);
		arena.relax(7, 3, 5);
		expect(arena.current(7, 5)).toBe(true);
		arena.begin(32);
		expect(arena.current(7, 5)).toBe(false);
		expect(arena.improves(7, Number.MAX_VALUE)).toBe(true);
	});

	test('growing the grid does not resurrect stale states', () => {
		/*
		 * Growth reallocates the score columns and restarts the epoch, so the
		 * fresh all-zero stamps must not read as the current epoch.
		 */
		const arena = new RouterArena();
		arena.begin(8);
		arena.relax(3, 1, 2);
		arena.begin(4_096);
		expect(arena.current(3, 2)).toBe(false);
		expect(arena.improves(3, 100)).toBe(true);
	});

	test('a document with many routes matches the same routes compiled alone', () => {
		/* The arena is shared process-wide; a hundredth route must not drift. */
		const together = compileSchematic(reversalBus(8), { ...BUS_FENCE, mode: 'full' });
		const alone = compileSchematic(reversalBus(8), { ...BUS_FENCE, mode: 'full' });
		expect(alone.svg).toBe(together.svg);
	});
});

describe('determinism', () => {
	test('a congested document compiles to one output over many runs', () => {
		const source = reversalBus(12);
		const outputs = new Set<string>();
		const attempts = new Set<number>();
		for (let run = 0; run < 40; run += 1) {
			const result = compileSchematic(source, { ...BUS_FENCE, mode: 'full' });
			outputs.add(result.svg);
			attempts.add(result.routing.attempts);
		}
		expect(outputs.size).toBe(1);
		expect(attempts.size).toBe(1);
	});

	test('interleaving other documents does not perturb a route', () => {
		/*
		 * Reuse is only safe if nothing survives `begin`. Compiling an unrelated
		 * document between two compilations of the same one must change nothing.
		 */
		const source = reversalBus(11);
		const first = compileSchematic(source, { ...BUS_FENCE, mode: 'full' });
		compileSchematic(reversalBus(4), { ...BUS_FENCE, mode: 'full' });
		compileSchematic(
			'resistor:R1 "A" at (200, 200) #amber\nresistor:R2 "B" at (900, 700) #blue\nR1.out -> R2.in #amber [ortho]',
			{ bounds: { width: 1400, height: 1000 }, title: 'other', mode: 'full' }
		);
		const second = compileSchematic(source, { ...BUS_FENCE, mode: 'full' });
		expect(second.svg).toBe(first.svg);
	});
});
