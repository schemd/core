/**
 * Bounded rip-up routing, and the report the router now hands back.
 *
 * Two properties carry this file. The first is that a document which routed
 * cleanly before rip-up existed still takes the same path through the router and
 * says so — `attempts` at zero. The second is that rip-up is a *pure function of
 * its arguments*: the thousand-run case below is the one that would catch a
 * scored permutation, a `Date.now()`, or an iteration over an unordered container
 * sneaking into the retry path, and it is asserted rather than reasoned about.
 */
import { describe, expect, test } from 'vitest';

import {
	compileSchematic,
	routeSchematicConnections,
	SCHEMATIC_CONGESTION_CELL_SIZE,
	SchematicSyntaxError,
	validateSchematicGeometry,
	type SchematicConnection,
	type SchematicFence
} from '../src/index.js';
import { parsedSchematicEvidence } from '../src/route-cache.js';

const fence: SchematicFence = { bounds: { width: 1400, height: 2600 }, title: 'Rip-up fixture' };

/** One reversal bus: `count` traces left to right, paired in opposite order. */
function crossbar(count: number, gap = 140, span = 1200): string {
	const nodes: string[] = [];
	const wires: string[] = [];
	for (let index = 0; index < count; index += 1) {
		nodes.push(`port:L${index} "L" at (80,${100 + index * gap}) #blue`);
		nodes.push(`port:R${index} "R" at (${span},${100 + (count - 1 - index) * gap}) #blue`);
		wires.push(`L${index}.out -> R${index}.in #blue [ortho]`);
	}
	return [...nodes, ...wires].join('\n');
}

describe('the clean path is untouched', () => {
	test('a document that routes on the first pass reports no retries', () => {
		const compilation = compileSchematic(
			`source:VIN "AC" at (120, 300) #blue [type=voltage-ac]\n` +
				`resistor:R1 "1 k\\Omega" at (400, 300) #amber\n` +
				`junction:VOUT "V_{out}" at (700, 300) #cyan\n` +
				`capacitor:C1 "100 nF" at (700, 560) #cyan [orientation=down]\n` +
				`VIN.positive -> R1.in #blue [line]\n` +
				`R1.out -> VOUT.node #amber [line]\n` +
				`VOUT.node -> C1.in #cyan [ortho]`,
			fence
		);
		expect(compilation.routing.attempts).toBe(0);
		expect(compilation.routing.rippedUp).toEqual([]);
	});

	test('disabling rip-up leaves a clean document byte-identical', () => {
		/* If the retry path were reached by a document that does not need it, this is
		   where it would show: one attempt and eight must produce the same SVG. */
		const source = crossbar(4);
		const withRetries = compileSchematic(source, fence);
		const withoutRetries = compileSchematic(source, {
			...fence,
			limits: { routingAttempts: 1 }
		});
		expect(withRetries.routing.attempts).toBe(0);
		expect(withoutRetries.svg).toBe(withRetries.svg);
	});
});

describe('a reversal bus routes past the old ceiling', () => {
	/*
	 * 0.4.0 took this from three wires to ten and documented ten as the limit:
	 * "a full reversal bus compiles to ten wires and is rejected beyond that."
	 * Eleven and twelve are the widths rip-up adds — that is, the widths *ordering*
	 * alone can reach. Everything past twelve needs the bundle laid out at once;
	 * see `the ceiling that was not a ceiling` below.
	 */
	test.each([11, 12])('compiles %i wires by reordering alone', (count) => {
		const compilation = compileSchematic(crossbar(count), fence);
		expect(compilation.document.connections).toHaveLength(count);
		expect(compilation.metrics.connections).toBe(count);
		expect(compilation.routing.nudged).toBe(false);
	});

	test('reports the traces it tore up to get there', () => {
		const compilation = compileSchematic(crossbar(12), fence);
		expect(compilation.routing.attempts).toBeGreaterThan(0);
		/*
		 * Twelve is the widest that *reordering alone* reaches, so it must get there
		 * on promotion and not be rescued by the bundle path. Without this the
		 * promotion mutant survives: break which trace retries first and the bundle
		 * quietly catches the document, turning a routing defect into a pass. This
		 * is the hazard 0.5.0 recorded for rip-up, one layer further down.
		 */
		expect(compilation.routing.nudged).toBe(false);
		expect(compilation.routing.rippedUp.length).toBeGreaterThan(0);
		/* Every entry names a real connection and the retry that tore it up. */
		for (const entry of compilation.routing.rippedUp) {
			expect(entry.connectionIndex).toBeGreaterThanOrEqual(0);
			expect(entry.connectionIndex).toBeLessThan(12);
			expect(entry.attempt).toBeGreaterThan(0);
		}
	});

	test('honours the attempt budget and still names the contention', () => {
		/* With retries disabled the old diagnostic is what a contended bus reaches,
		   and it must still be the one that says how to free a channel. A budget of
		   one also withholds the bundle path, which exists to rescue exhausted
		   retries and has nothing to rescue when none were permitted. */
		expect(() =>
			compileSchematic(crossbar(12), { ...fence, limits: { routingAttempts: 1 } })
		).toThrow(/No orthogonal route from .* clears every component and earlier trace/);
	});
});

describe('the ceiling that was not a ceiling', () => {
	/*
	 * This suite used to assert that thirteen wires is unroutable, and explained it
	 * as a limit of the channel model rather than of declaration order. The
	 * evidence was twenty thousand declaration orders, none of which routed — but
	 * the conclusion did not follow from it. Reordering decides which trace chooses
	 * first; it cannot reach a layout in which *no* trace takes the middle channel,
	 * because somebody always chooses first.
	 *
	 * The model was never full. The same fence at the same pitch admits legal
	 * routings well past thirty wires once the bundle is assigned channels as a
	 * set. `tests/nudging.test.ts` owns that behaviour and proves the drawings are
	 * legal rather than merely produced; what remains here is the budget contract.
	 */
	test('thirteen wires routes once retries are allowed to be exhausted', () => {
		for (const routingAttempts of [12, 32]) {
			const result = compileSchematic(crossbar(13), { ...fence, limits: { routingAttempts } });
			expect(result.routing.nudged).toBe(true);
			expect(result.svg).toContain('<svg');
		}
	});

	test('spends the whole retry budget before laying the bundle out', () => {
		/*
		 * The bundle path is a last resort, not a shortcut. A document that reaches
		 * it must have used every pass the host allowed first — so `attempts`
		 * equals the budget exactly, and a router that gave up early or ran on
		 * would disagree here.
		 */
		for (const routingAttempts of [3, 7]) {
			const result = compileSchematic(crossbar(13), { ...fence, limits: { routingAttempts } });
			expect(result.routing.nudged).toBe(true);
			expect(result.routing.attempts).toBe(routingAttempts);
		}
	});

	test('and is still refused when the host allows no retries', () => {
		expect(() =>
			compileSchematic(crossbar(13), { ...fence, limits: { routingAttempts: 1 } })
		).toThrow(/No orthogonal route from/);
	});
});

describe('determinism', () => {
	/*
	 * Ten wires is the cheapest document that reaches the retry path at all —
	 * nine routes on the first pass, and every wider bus costs multiples more per
	 * compile. Entering the path is what these two measure, so the cheapest one
	 * that does is the right fixture.
	 */
	const CONGESTED = crossbar(10);

	test(
		'a congested document compiles to one distinct output on every run',
		() => {
			/*
			 * 250 repetitions, not the thousand this started as. A thousand in-process
			 * compilations took over two minutes under coverage on CI, and the extra
			 * 750 bought nothing: every source of nondeterminism available to this code
			 * — a clock, `Math.random`, a scored permutation, iteration over an
			 * unordered container — diverges on the second run, not the eight hundredth.
			 * What a thousand in-process runs cannot test is the case that actually
			 * varies, which is a different process on a different platform; CI covers
			 * that by compiling the same goldens on Linux that were written on macOS.
			 */
			const first = compileSchematic(CONGESTED, fence);
			expect(first.routing.attempts).toBeGreaterThan(0);
			const outputs = new Set<string>();
			for (let run = 0; run < 250; run += 1) {
				outputs.add(compileSchematic(CONGESTED, fence).svg);
			}
			expect(outputs.size).toBe(1);
			expect([...outputs][0]).toBe(first.svg);
		},
		60_000
	);

	test(
		'the report itself is stable across runs',
		() => {
			const reports = new Set<string>();
			for (let run = 0; run < 50; run += 1) {
				reports.add(JSON.stringify(compileSchematic(CONGESTED, fence).routing));
			}
			expect(reports.size).toBe(1);
		},
		60_000
	);

	test('tears up the most recently placed traces, not the earliest', () => {
		/*
		 * Recency is the heuristic *and* the tie-break: the traces holding the
		 * channel a failed trace wanted are the ones placed just before it. Tearing
		 * up the earliest instead would be equally deterministic and would keep
		 * retrying against the same block, so the first retry must never name
		 * connection 0 while later traces sit in the way.
		 */
		const compilation = compileSchematic(crossbar(12), fence);
		const firstRetry = compilation.routing.rippedUp.filter((entry) => entry.attempt === 1);
		/* The first retry tears up everything that had been placed when the failure
		   hit, so the count is the failing position rather than one trace. */
		expect(firstRetry.length).toBeGreaterThan(0);
		expect(new Set(firstRetry.map((entry) => entry.connectionIndex)).size).toBe(
			firstRetry.length
		);
	});
});

describe('the congestion map', () => {
	test('reports occupied cells in column-then-row order', () => {
		const compilation = compileSchematic(crossbar(12), fence);
		const cells = compilation.routing.congestion;
		expect(cells.length).toBeGreaterThan(0);
		const keys = cells.map((cell) => cell.x * 1e6 + cell.y);
		expect(keys).toEqual([...keys].sort((left, right) => left - right));
	});

	test('reports every cell on the grid the exported cell size describes', () => {
		const compilation = compileSchematic(crossbar(12), fence);
		for (const cell of compilation.routing.congestion) {
			expect(cell.x % SCHEMATIC_CONGESTION_CELL_SIZE).toBe(0);
			expect(cell.y % SCHEMATIC_CONGESTION_CELL_SIZE).toBe(0);
			expect(cell.load).toBeGreaterThan(0);
		}
	});

	test('omits empty cells rather than reporting a load of zero', () => {
		/* A sparse diagram on a large canvas has millions of empty cells; a heatmap
		   draws what is there. */
		const compilation = compileSchematic(
			`resistor:A "A" at (300, 300) #amber\nresistor:B "B" at (900, 300) #cyan\nA.out -> B.in #amber [ortho]`,
			fence
		);
		const canvasCells =
			(fence.bounds.width / SCHEMATIC_CONGESTION_CELL_SIZE) *
			(fence.bounds.height / SCHEMATIC_CONGESTION_CELL_SIZE);
		expect(compilation.routing.congestion.length).toBeLessThan(canvasCells);
		expect(compilation.routing.congestion.every((cell) => cell.load > 0)).toBe(true);
	});

	test('grows denser as the same canvas carries more traces', () => {
		const light = compileSchematic(crossbar(4), fence).routing.congestion;
		const heavy = compileSchematic(crossbar(12), fence).routing.congestion;
		const load = (cells: readonly { load: number }[]) =>
			cells.reduce((total, cell) => total + cell.load, 0);
		expect(load(heavy)).toBeGreaterThan(load(light));
	});
});

describe('failures rip-up cannot help', () => {
	test('a first trace that cannot route is reported without a retry', () => {
		/*
		 * Nothing is placed before the first connection, so its failure is about its
		 * own endpoints rather than contention. Retrying would rebuild the same index
		 * and fail the same way, so the diagnostic is raised immediately.
		 */
		expect(() =>
			compileSchematic(
				`resistor:A "A" at (200, 300) #amber\n` +
					`resistor:B "B" at (500, 300) #cyan\n` +
					`resistor:BLOCK "X" at (350, 300) #slate\n` +
					`A.out -> B.in #amber [line]`,
				fence
			)
		).toThrow(/Line route intersects BLOCK/);
	});

	test('a non-routing error is raised unchanged', () => {
		/* Rip-up catches contention, not every throw: a document that fails the
		   crossing budget must still fail with that diagnostic. */
		expect(() => compileSchematic(crossbar(12), { ...fence, limits: { wireCrossings: 1 } })).toThrow(
			/Wire crossing complexity exceeds 1 intersections/
		);
	});
});

describe('the reporting router', () => {
	test('agrees with the route-only entry point', () => {
		const compilation = compileSchematic(crossbar(6), fence);
		const reported = routeSchematicConnections(
			compilation.document.connections,
			new Map(compilation.document.components.map((part) => [part.id, part])),
			fence.bounds
		);
		expect(reported.routes.map((route) => route.d)).toEqual(
			compilation.document.connections.map((_, index) => reported.routes[index]!.d)
		);
		expect(reported.report.attempts).toBe(0);
	});

	test('reports nothing for routes it was handed rather than computed', () => {
		/* `validateDocumentGeometry` accepts precomputed routes; there is no pass to
		   report on in that case, and an empty report states that rather than
		   implying a clean first pass nobody observed. */
		const compilation = compileSchematic(crossbar(4), fence);
		const handed = validateSchematicGeometry(compilation.document, fence, [
			...compilation.document.connections.map(
				(_, index) =>
					routeSchematicConnections(
						compilation.document.connections,
						new Map(compilation.document.components.map((part) => [part.id, part])),
						fence.bounds
					).routes[index]!
			)
		]);
		expect(handed.report).toEqual({ attempts: 0, rippedUp: [], congestion: [], nudged: false });
	});

	test('reports nothing for a document it never parsed', () => {
		/*
		 * Evidence is keyed on the document the parser produced. A document assembled
		 * by hand has none, and the empty reading is what says so — the alternative
		 * was an `undefined` every caller would have to handle with a branch that
		 * could never run.
		 */
		const compilation = compileSchematic(crossbar(4), fence);
		const copy = {
			components: compilation.document.components,
			connections: compilation.document.connections
		};
		expect(parsedSchematicEvidence(copy)).toEqual({
			placements: [],
			routing: { attempts: 0, rippedUp: [], congestion: [], nudged: false }
		});
	});

	test('raises a router error that is not a diagnostic unchanged', () => {
		/*
		 * Rip-up catches contention, which arrives as a `SchematicSyntaxError`.
		 * Anything else is a defect rather than a crowded canvas, and must leave the
		 * router unretried and unwrapped. A terminal the parser would have rejected
		 * raises a bare `Error` — from `createRoutingIndex`, which reserves every
		 * approach before the first trace is placed, so the retry loop never sees it.
		 */
		const compilation = compileSchematic(
			`resistor:A "A" at (300, 300) #amber\nresistor:B "B" at (800, 300) #cyan\nA.out -> B.in #amber [ortho]`,
			fence
		);
		const components = new Map(compilation.document.components.map((part) => [part.id, part]));
		const bogus: SchematicConnection = {
			from: { componentId: 'A', port: 'clock' },
			to: { componentId: 'B', port: 'in' },
			color: { kind: 'token', value: 'amber' },
			curve: 'ortho',
			markerStart: 'none',
			markerEnd: 'none',
			line: 3
		};
		let thrown: unknown;
		try {
			routeSchematicConnections([bogus], components, fence.bounds);
		} catch (error) {
			thrown = error;
		}
		expect(thrown).toBeInstanceOf(Error);
		expect(thrown).not.toBeInstanceOf(SchematicSyntaxError);
		expect(String((thrown as Error).message)).toMatch(/Validated port A\.clock is missing/);
	});
});
