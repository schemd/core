/**
 * Adversarial cover for the five defects an audit found in 0.3.8, for the
 * retired component and connection ceilings, and for the budget that replaced
 * them.
 *
 * Each block states the defect or the contract, then pins the property that
 * makes it hold, rather than the incidental output that happened to change.
 * Where the old behaviour was *accepted by the suite* — a compound path
 * carrying one arrowhead for three wires, a transistor lead wired to itself —
 * the assertion here is deliberately the inverse of what shipped.
 */
import { describe, expect, test } from 'vitest';

import {
	canonicalPortName,
	compileSchematic,
	connectionLabelPoint,
	inspectSchematic,
	parseSchematic,
	renderSchematic,
	routeConnections,
	SCHEMATIC_LIMITS,
	SCHEMD_OUTPUT_MODES,
	type SchematicComponent,
	type SchematicConnection,
	type SchematicDocument,
	type SchematicFence,
	type SchematicLimitOptions
} from '../src/index.js';

const fence: SchematicFence = { bounds: { width: 1000, height: 700 }, title: 'Regression fixture' };

/** Every coordinate a generated SVG contains, as written. */
function emittedNumbers(svg: string): string[] {
	return svg.match(/-?\d+\.\d+/g) ?? [];
}

/** One reversal bus: `count` traces left to right, paired in opposite order. */
function crossbar(count: number, gap = 120, span = 900): string {
	const nodes: string[] = [];
	const wires: string[] = [];
	for (let index = 0; index < count; index += 1) {
		nodes.push(`port:L${index} "L" at (60,${80 + index * gap}) #blue`);
		nodes.push(`port:R${index} "R" at (${span},${80 + (count - 1 - index) * gap}) #blue`);
		wires.push(`L${index}.out -> R${index}.in #blue [ortho]`);
	}
	return [...nodes, ...wires].join('\n');
}

/** Axis-aligned spans of one path's `M`/`H`/`V` walk, for overlap checking. */
function axisSpans(path: string): { x: number; y: number; horizontal: boolean; from: number; to: number }[] {
	const spans: { x: number; y: number; horizontal: boolean; from: number; to: number }[] = [];
	const tokens = path.match(/[MHVA][^MHVA]*/g) ?? [];
	let x = 0;
	let y = 0;
	for (const token of tokens) {
		const numbers = (token.slice(1).match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
		if (token[0] === 'M') {
			x = numbers[0]!;
			y = numbers[1]!;
		} else if (token[0] === 'H') {
			const next = numbers[0]!;
			spans.push({ x, y, horizontal: true, from: Math.min(x, next), to: Math.max(x, next) });
			x = next;
		} else if (token[0] === 'V') {
			const next = numbers[0]!;
			spans.push({ x, y, horizontal: false, from: Math.min(y, next), to: Math.max(y, next) });
			y = next;
		} else {
			/* Bridge arc: it only hops an existing crossing, so advance the pen. */
			x = numbers[5]!;
			y = numbers[6]!;
		}
	}
	return spans;
}

describe('compound paths never swallow an endpoint marker', () => {
	/*
	 * SVG paints marker-start at the first vertex of a path element and
	 * marker-end at its last — not once per subpath. Batching traces that carry
	 * closed markers therefore rendered one arrowhead however many wires shared
	 * the batch, and every marker fixture in the suite used a distinct colour per
	 * wire, which put each one in its own batch and hid it.
	 */
	const marked = (marker: string, count: number): string => {
		const nodes: string[] = [];
		const wires: string[] = [];
		for (let index = 0; index < count; index += 1) {
			const y = 90 + index * 110;
			nodes.push(`port:L${index} "L" at (90,${y}) #blue`);
			nodes.push(`port:R${index} "R" at (520,${y}) #blue`);
			wires.push(`L${index}.out -> R${index}.in #blue [${marker}]`);
		}
		return [...nodes, ...wires].join('\n');
	};

	test.each([
		['arrow', 'marker-end'],
		['dot', 'marker-end'],
		['marker-end=diamond-filled', 'marker-end'],
		['marker-start=arrow', 'marker-start'],
		['marker-start=dot', 'marker-start']
	])('renders %s once per declaring connection in every mode', (option, attribute) => {
		const source = marked(option, 4);
		for (const mode of SCHEMD_OUTPUT_MODES) {
			const { svg } = compileSchematic(source, { ...fence, mode, idPrefix: 'marker' });
			expect(svg.match(new RegExp(`${attribute}="url\\(#`, 'g'))).toHaveLength(4);
		}
	});

	test('keeps unmarked traces compounded while marked ones stand alone', () => {
		const source = `port:A "A" at (90,90) #blue
port:B "B" at (520,90) #blue
port:C "C" at (90,220) #blue
port:D "D" at (520,220) #blue
port:E "E" at (90,350) #blue
port:F "F" at (520,350) #blue
A.out -> B.in #blue [arrow]
C.out -> D.in #blue
E.out -> F.in #blue`;
		const { svg } = compileSchematic(source, { ...fence, idPrefix: 'mixed' });
		const traces = [...svg.matchAll(/class="[^"]*schematic-trace[^"]*" d="([^"]*)"/g)].map(
			(match) => match[1]!
		);
		/* One path for the marked wire, one compounding the two unmarked ones. */
		expect(traces.map((trace) => (trace.match(/M /g) ?? []).length)).toEqual([1, 2]);
		expect(svg.match(/marker-end="url\(#/g)).toHaveLength(1);
	});

	test('leaves open markers batching on their own carriers', () => {
		const source = `class:A "A" at (150,120) #blue
class:B "B" at (600,120) #blue
class:C "C" at (150,320) #blue
class:D "D" at (600,320) #blue
A.right -> B.left #blue [realization]
C.right -> D.left #blue [realization]`;
		const { svg } = compileSchematic(source, { ...fence, idPrefix: 'open' });
		/* Both triangles paint, and neither rides on the compounded trace. */
		expect(svg.match(/marker-end="url\(#[^"]*-marker-triangle\)"/g)).toHaveLength(2);
		expect(svg.match(/schematic-marker-carrier/g)).toHaveLength(2);
	});
});

describe('orthogonal routing completes a reversal bus', () => {
	/*
	 * The router scored reuse of an occupied channel as an expensive but legal
	 * option while `routeConnections` rejected it outright, so it could return a
	 * route it had already proved would be thrown out. A four-wire crossbar — an
	 * ordinary figure, and one with no DSL workaround, since crossing traces must
	 * be orthogonal — failed to compile from the third wire on.
	 */
	test.each([2, 3, 4, 6, 8])('compiles a %i-wire reversal on an open canvas', (count) => {
		const bounds = { width: 1000, height: 200 + count * 120 };
		const { document, svg, routing } = compileSchematic(crossbar(count), {
			bounds,
			title: 'Reversal bus',
			idPrefix: `bus-${count}`
		});
		expect(document.connections).toHaveLength(count);
		expect(svg).not.toContain('NaN');
		/*
		 * On the *first pass*, and this clause is load-bearing. 0.5 added rip-up,
		 * which retries around a trace that cannot be placed — and in doing so it can
		 * paper over a router defect that used to fail loudly here. Asserting only
		 * that these compile would let the reservation of terminal approaches, the
		 * channel-lane offer, and the contact pricing all regress silently, with the
		 * retry loop quietly absorbing the cost. A bus this size is an ordinary
		 * figure and must not need a retry.
		 */
		expect(routing.attempts).toBe(0);
	});

	test('lays every trace of a reversal bus in its own channel', () => {
		const count = 6;
		const bounds = { width: 1000, height: 200 + count * 120 };
		const { document } = compileSchematic(crossbar(count), { bounds, title: 'Reversal bus' });
		const routes = renderSchematic(document, { bounds, title: 'Reversal bus', mode: 'full' });
		const paths = [...routes.matchAll(/class="[^"]*schematic-trace[^"]*" d="([^"]*)"/g)].map(
			(match) => axisSpans(match[1]!)
		);
		/*
		 * The property the old router violated: no two traces of different nets
		 * may share a channel over any length. Bridges cover crossings; a
		 * collinear overlap can never be drawn legibly.
		 */
		for (let left = 0; left < paths.length; left += 1) {
			for (let right = left + 1; right < paths.length; right += 1) {
				for (const first of paths[left]!) {
					for (const second of paths[right]!) {
						if (first.horizontal !== second.horizontal) continue;
						const sameChannel = first.horizontal ? first.y === second.y : first.x === second.x;
						if (!sameChannel) continue;
						const overlap =
							Math.min(first.to, second.to) - Math.max(first.from, second.from);
						expect(overlap).toBeLessThan(0);
					}
				}
			}
		}
	});

	test('separates two nets that share one column instead of rejecting them', () => {
		const source = `port:T1 "T1" at (300,80) #blue [orientation=down]
port:B1 "B1" at (300,560) #blue [orientation=up]
port:T2 "T2" at (300,200) #cyan [orientation=down]
port:B2 "B2" at (300,420) #cyan [orientation=up]
T1.out -> B1.in #blue [ortho]
T2.out -> B2.in #cyan [ortho]`;
		const { svg } = compileSchematic(source, { ...fence, mode: 'full', idPrefix: 'column' });
		const traces = [...svg.matchAll(/class="[^"]*schematic-trace[^"]*" d="([^"]*)"/g)].map(
			(match) => match[1]!
		);
		expect(traces).toHaveLength(2);
		expect(traces[0]).not.toBe(traces[1]);
	});

	test('spends a detour to avoid a bridge it does not need', () => {
		/*
		 * A bridge crossing is legal but not free, and the sparse search is the one
		 * place that trade-off is decided edge by edge. Priced at zero the third
		 * trace below hops the second one for nothing; priced properly it goes
		 * round, and the diagram carries no arc at all.
		 */
		const source = `port:N0 "N" at (580,480) #blue [orientation=down]
port:N1 "N" at (80,480) #blue [orientation=right]
port:N2 "N" at (280,480) #blue [orientation=down]
port:N3 "N" at (480,380) #blue [orientation=up]
port:N4 "N" at (580,780) #blue [orientation=left]
port:N5 "N" at (280,280) #blue [orientation=up]
N1.out -> N2.in #blue [ortho]
N3.in -> N2.in #blue [ortho]
N4.out -> N5.out #blue [ortho]`;
		const { svg } = compileSchematic(source, {
			bounds: { width: 900, height: 900 },
			title: 'Bridge economy',
			mode: 'full',
			idPrefix: 'economy'
		});
		expect(svg).not.toContain(' A ');
		expect(
			[...svg.matchAll(/schematic-trace[^"]*" d="([^"]*)"/g)].map((match) => match[1])
		).toEqual([
			'M 122 480 H 207 V 426 H 280 V 438',
			'M 480 422 V 434 H 380 V 426 H 280 V 438',
			'M 538 780 H 526 V 226 H 280 V 238'
		]);
	});

	test('routes identically on every compile of one source', () => {
		const source = crossbar(5);
		const bounds = { width: 1000, height: 800 };
		const first = compileSchematic(source, { bounds, title: 'Determinism', idPrefix: 'run' });
		const second = compileSchematic(source, { bounds, title: 'Determinism', idPrefix: 'run' });
		expect(second.svg).toBe(first.svg);
	});

	test('names both endpoints and a remedy when no channel is left', () => {
		/* Two facing terminals six units apart leave no corridor for either net. */
		const source = `port:A "A" at (60,300) #blue
port:B "B" at (150,300) #blue
port:X "X" at (60,120) #blue
port:Y "Y" at (600,480) #blue
A.out -> Y.in #blue [ortho]
B.in -> X.in #blue [ortho]`;
		expect(() => compileSchematic(source, { ...fence })).toThrow(
			/No orthogonal route from .+ to .+ clears every component and earlier trace/
		);
	});
});

describe('port aliases address one terminal everywhere', () => {
	/*
	 * `SchematicEndpoint.port` is documented as canonical, but the parser never
	 * normalized it, so topology, contact validation, the netlist and the design
	 * rules all keyed on whichever spelling the author happened to type. Two
	 * spellings of one pin became two terminals that merely coincided.
	 */
	const aliasFixture = (left: string, right: string): string =>
		`resistor:R1 "R" at (200,300) #amber
port:A "A" at (520,160) #blue
port:B "B" at (520,440) #blue
R1.${left} -> A.in #blue [ortho]
R1.${right} -> B.in #blue [ortho]`;

	test('treats every spelling of one lead as one terminal', () => {
		const canonical = parseSchematic(aliasFixture('out', 'out'), fence);
		for (const [left, right] of [
			['out', 'r'],
			['r', 'right'],
			['right', 'out']
		] as const) {
			const aliased = parseSchematic(aliasFixture(left, right), fence);
			expect(aliased.connections).toEqual(canonical.connections);
		}
	});

	test.each([
		['resistor:R1 "R" at (200,300) #amber', 'R1', ['in', 'left', 'l'], 'in'],
		['resistor:R1 "R" at (200,300) #amber', 'R1', ['out', 'right', 'r'], 'out'],
		['diode:D1 "D" at (200,300) #amber', 'D1', ['cathode', 'k', 'c'], 'cathode'],
		['transistor:Q1 "Q" at (200,300) #amber [type=nmos]', 'Q1', ['emitter', 'source', 'e', 's'], 'source'],
		['source:V1 "V" at (200,300) #amber', 'V1', ['out', 'positive'], 'positive'],
		['junction:J1 "J" at (200,300) #amber', 'J1', ['in', 'out', 'node'], 'node'],
		['and:G1 "G" at (200,300) #amber', 'G1', ['in', 'in1'], 'in1'],
		['class:C1 "C" at (200,300) #amber', 'C1', ['in', 'left'], 'left']
	])('canonicalizes %s aliases to one name', (declaration, id, aliases, canonical) => {
		const document = parseSchematic(declaration, fence);
		const component = document.components.find(
			(candidate: SchematicComponent) => candidate.id === id
		)!;
		for (const alias of aliases) {
			expect(canonicalPortName(component, alias)).toBe(canonical);
		}
	});

	test('keeps two pins drawn at one point distinct', () => {
		/* A flip-flop renders preset and clear on the same stub; they are still
		   two logical pins, so neither may absorb the other. */
		const document = parseSchematic('flipflop:F1 "F" at (300,300) #amber', fence);
		const flipflop = document.components[0]!;
		expect(canonicalPortName(flipflop, 'preset')).toBe('preset');
		expect(canonicalPortName(flipflop, 'clear')).toBe('clear');
	});

	test('applies design rules to the aliased spelling', () => {
		const rules = (port: string): string[] =>
			inspectSchematic(
				parseSchematic(
					`source:V1 "5V" at (200,300) #amber
power:P1 "VCC" at (600,300) #amber
V1.${port} -> P1.in #amber [ortho]`,
					fence
				)
			).diagnostics.map((diagnostic) => diagnostic.code);
		expect(rules('positive')).toContain('shorted-supply');
		expect(rules('out')).toEqual(rules('positive'));
	});

	test('detects a duplicate connection written with different aliases', () => {
		const document = parseSchematic(
			`resistor:R1 "R" at (200,300) #amber
resistor:R2 "R" at (600,300) #amber
R1.out -> R2.in #amber [ortho]
R1.r -> R2.left #amber [ortho]`,
			fence
		);
		expect(inspectSchematic(document).diagnostics.map((one) => one.code)).toContain(
			'duplicate-connection'
		);
	});

	test('reports canonical terminals through the source map and full-mode markup', () => {
		const compiled = compileSchematic(
			`resistor:R1 "R" at (200,300) #amber
port:A "A" at (600,300) #blue
R1.r -> A.in #amber [ortho]`,
			{ ...fence, mode: 'full', idPrefix: 'canonical' }
		);
		expect(compiled.sourceMap.wires[0]!.source).toBe('R1.out');
		expect(compiled.svg).toContain('data-wire-source="R1.out"');
	});
});

describe('generated geometry serializes at the documented precision', () => {
	/*
	 * Integrated-circuit pins interpolated raw JavaScript numbers while every
	 * other vector went through the three-decimal serializer, so a pin count that
	 * divides badly emitted seventeen significant digits — and a stub end that
	 * disagreed with the routed port point below the third decimal.
	 */
	test.each([3, 5, 6, 7, 9, 11, 13])('keeps a %i-pin chip within three decimals', (pins) => {
		const side = (prefix: string): string =>
			Array.from({ length: pins }, (_, index) => `${prefix}${index}`).join(',');
		const { svg } = compileSchematic(
			`ic:U1 "MCU" at (500,350) #slate [left="${side('l')}" top="${side('t')}"]`,
			{ ...fence, idPrefix: 'chip' }
		);
		expect(emittedNumbers(svg).length).toBeGreaterThan(0);
		for (const number of emittedNumbers(svg)) {
			expect(number.split('.')[1]!.length).toBeLessThanOrEqual(3);
		}
	});

	test('lands a wire exactly on the pin stub it joins', () => {
		const { svg } = compileSchematic(
			`ic:U1 "MCU" at (400,350) #slate [right="a,b,c,d,e,f"]
port:P "P" at (900,350) #blue
U1.a -> P.in #blue [ortho]`,
			{ ...fence, idPrefix: 'stub' }
		);
		/*
		 * The chip draws its pins in local coordinates and the router places the
		 * wire in absolute ones. Seven pins over a body height that does not divide
		 * by seven is exactly where a raw JavaScript number and a three-decimal one
		 * part company, so the two must still agree once the group transform is
		 * applied.
		 */
		const stubY = Number(/schematic-token--slate" d="M 44 (-?[\d.]+) H 60"/.exec(svg)![1]);
		const [, traceX, traceY] = /class="[^"]*schematic-trace[^"]*" d="M ([\d.]+) (-?[\d.]+)/.exec(
			svg
		)!;
		expect(Number(traceX)).toBe(400 + 60);
		expect(Number(traceY)).toBe(Number((350 + stubY).toFixed(3)));
	});
});

describe('a document is not capped at a component count', () => {
	/*
	 * 512 components and 2,048 connections were arbitrary ceilings, and three
	 * other limits stood behind them: a 4,096-unit canvas that could not hold a
	 * thousand parts however many the parser allowed, a source-character cap that
	 * ran out at roughly three thousand declarations, and a 2 MiB output cap.
	 * Removing one without the others would have changed nothing a user could see.
	 */
	const grid = (count: number, wired: boolean) => {
		const columns = Math.ceil(Math.sqrt(count * 1.6));
		const lines: string[] = [];
		for (let index = 0; index < count; index += 1) {
			const x = 60 + (index % columns) * 110;
			const y = 60 + Math.floor(index / columns) * 100;
			lines.push(`resistor:R${index} "R" at (${x},${y}) #amber`);
		}
		if (wired) {
			for (let index = 0; index + 1 < count; index += 2) {
				if (Math.floor(index / columns) !== Math.floor((index + 1) / columns)) continue;
				lines.push(`R${index}.out -> R${index + 1}.in #amber [ortho]`);
			}
		}
		return {
			source: lines.join('\n'),
			bounds: {
				width: 120 + columns * 110,
				height: 160 + Math.ceil(count / columns) * 100
			}
		};
	};

	test.each([600, 2_000])('compiles %i components, past the old 512 ceiling', (count) => {
		const { source, bounds } = grid(count, false);
		const { document, svg } = compileSchematic(source, {
			bounds,
			title: 'Large document',
			idPrefix: 'large'
		});
		expect(document.components).toHaveLength(count);
		expect(svg.match(/class="schematic-component"/g)).toHaveLength(count);
	});

	test('compiles more connections than the old 2,048 ceiling', () => {
		const { source, bounds } = grid(6_000, true);
		const { document } = compileSchematic(source, {
			bounds,
			title: 'Large document',
			idPrefix: 'large'
		});
		expect(document.connections.length).toBeGreaterThan(2_048);
	});

	test('accepts a canvas past the old 4,096-unit ceiling', () => {
		const { document } = compileSchematic('resistor:R1 "R" at (5000,5000) #amber', {
			bounds: { width: 10_000, height: 10_000 },
			title: 'Wide canvas'
		});
		expect(document.components).toHaveLength(1);
	});

	test('keeps the spatial hash exact on a canvas no 4,096 stride would survive', () => {
		/*
		 * Cell keys are `column * stride + row`. The old stride assumed 64 cells per
		 * axis; two traces this far apart would have collided into one bucket and
		 * been compared as though they touched.
		 */
		const { svg } = compileSchematic(
			`port:A "A" at (200,200) #blue
port:B "B" at (60000,200) #blue
port:C "C" at (200,60000) #cyan
port:D "D" at (60000,60000) #cyan
A.out -> B.in #blue [ortho]
C.out -> D.in #cyan [ortho]`,
			{ bounds: { width: 61_000, height: 61_000 }, title: 'Far apart', idPrefix: 'far' }
		);
		expect(svg.match(/schematic-trace/g)).toHaveLength(2);
		expect(svg).not.toContain(' A ');
	});

	test.each([
		['components', 3, /exceeds the 3 component limit/],
		['connections', 2, /exceeds the 2 connection limit/],
		['sourceCharacters', 40, /exceeds the 40 character limit/]
	])('enforces a caller-supplied %s budget', (name, limit, message) => {
		const source = `resistor:R0 "R" at (100,120) #amber
resistor:R1 "R" at (300,120) #amber
resistor:R2 "R" at (500,120) #amber
resistor:R3 "R" at (700,120) #amber
R0.out -> R1.in #amber [ortho]
R1.out -> R2.in #amber [ortho]
R2.out -> R3.in #amber [ortho]`;
		expect(() => compileSchematic(source, { ...fence, limits: { [name]: limit } })).toThrow(
			message
		);
		/* The same document with no budget is fine, so the limit did the rejecting. */
		expect(() => compileSchematic(source, fence)).not.toThrow();
	});

	test('enforces a caller-supplied output byte budget', () => {
		const source = 'resistor:R1 "R" at (300,300) #amber';
		expect(() => compileSchematic(source, { ...fence, limits: { svgOutputBytes: 256 } })).toThrow(
			/exceeds the 256 byte output limit/
		);
		expect(() =>
			compileSchematic(source, { ...fence, limits: { svgOutputBytes: 268_435_456 } })
		).not.toThrow();
	});

	test('enforces a caller-supplied wire-crossing budget', () => {
		const source = `port:L0 "L" at (60,300) #blue
port:R0 "R" at (900,300) #blue
port:T0 "T" at (300,120) #cyan [orientation=down]
port:B0 "B" at (300,560) #cyan [orientation=up]
port:T1 "T" at (500,120) #cyan [orientation=down]
port:B1 "B" at (500,560) #cyan [orientation=up]
L0.out -> R0.in #blue [ortho]
T0.out -> B0.in #cyan [ortho]
T1.out -> B1.in #cyan [ortho]`;
		expect(() => compileSchematic(source, { ...fence })).not.toThrow();
		expect(() => compileSchematic(source, { ...fence, limits: { wireCrossings: 1 } })).toThrow(
			/Wire crossing complexity exceeds 1 intersections/
		);
	});

	test('rejects a malformed budget instead of ignoring it', () => {
		const source = 'resistor:R1 "R" at (300,300) #amber';
		for (const limits of [7, 'tight', null] as unknown[]) {
			expect(() =>
				compileSchematic(source, { ...fence, limits: limits as never })
			).toThrow(/limits must be an object/);
		}
		/* A misspelled field is the dangerous case: silently ignoring it leaves a
		   host believing it set a ceiling it never set. */
		expect(() =>
			compileSchematic(source, { ...fence, limits: { component: 4 } as never })
		).toThrow(/Unknown compiler limit component\./);
		for (const limit of [0, -1, 1.5, Number.NaN, '4', -Number.POSITIVE_INFINITY]) {
			expect(() =>
				compileSchematic(source, { ...fence, limits: { components: limit as never } })
			).toThrow(/must be a positive integer or Infinity/);
		}
	});

	test('reads Infinity as no limit, and omission as the default', () => {
		const source = Array.from(
			{ length: 40 },
			(_, index) => `resistor:R${index} "R" at (${80 + (index % 8) * 110},${80 + Math.floor(index / 8) * 120}) #amber`
		).join('\n');
		const wide = { bounds: { width: 1000, height: 800 }, title: 'Budget' };
		expect(() =>
			compileSchematic(source, { ...wide, limits: { components: Number.POSITIVE_INFINITY } })
		).not.toThrow();
		expect(() => compileSchematic(source, { ...wide, limits: {} })).not.toThrow();
		expect(() => compileSchematic(source, { ...wide, limits: { components: 39 } })).toThrow(
			/39 component limit/
		);
	});

	test('resolves a budget once, so a getter cannot move it between passes', () => {
		/*
		 * The same defence the fence's bounds and title get. A budget read where it
		 * is enforced could be generous to the parser and mean to the renderer, or
		 * the reverse, and the document would be validated against neither.
		 */
		let reads = 0;
		const volatile = {
			get components() {
				reads += 1;
				return reads === 1 ? 4 : 1;
			}
		} as unknown as SchematicLimitOptions;
		const source = `resistor:R0 "R" at (100,120) #amber
resistor:R1 "R" at (300,120) #amber`;
		expect(() => compileSchematic(source, { ...fence, limits: volatile })).not.toThrow();
		expect(reads).toBe(1);
	});

	test('defaults to no component or connection ceiling at all', () => {
		expect(SCHEMATIC_LIMITS).toEqual({
			minimumBound: 64,
			maximumBound: 1_048_576,
			components: Number.POSITIVE_INFINITY,
			connections: Number.POSITIVE_INFINITY,
			sourceCharacters: 16_777_216,
			wireCrossings: 32_768,
			svgOutputBytes: 268_435_456,
			placementDepth: 64,
			routingAttempts: 12
		});
		expect(Object.isFrozen(SCHEMATIC_LIMITS)).toBe(true);
	});
});

describe('a terminal cannot be wired to itself', () => {
	/*
	 * `R1.in -> R1.in` compiled to `d="M 158 200 H 158"` — a wire that paints
	 * nothing, carries a label nobody can see, and adds a one-terminal net to the
	 * netlist. Aliases made it easy to write by accident: on a MOSFET, `emitter`
	 * and `source` are the same lead.
	 */
	test.each(['line', 'bezier', 'ortho'])('rejects a self-connection routed as %s', (curve) => {
		expect(() =>
			parseSchematic(
				`resistor:R1 "R" at (300,300) #amber\nR1.in -> R1.in #amber [${curve}]`,
				fence
			)
		).toThrow('Line 2: R1.in cannot connect to itself; a connection needs two distinct terminals.');
	});

	test('rejects a self-connection disguised by two spellings of one lead', () => {
		expect(() =>
			parseSchematic(
				`transistor:Q1 "Q" at (300,300) #amber [type=nmos]\nQ1.emitter -> Q1.source #amber`,
				fence
			)
		).toThrow(/Q1\.source cannot connect to itself/);
		expect(() =>
			parseSchematic(
				`resistor:R1 "R" at (300,300) #amber\nR1.out -> R1.r #amber`,
				fence
			)
		).toThrow(/R1\.out cannot connect to itself/);
	});

	test('still measures a degenerate route handed straight to the layout API', () => {
		/*
		 * `parseSchematic` now rejects a self-connection, but `routeConnections` is
		 * exported and takes no parser provenance, so a host assembling its own AST
		 * can still present one. Nothing downstream may divide by the zero length
		 * that produces.
		 */
		const port: SchematicComponent = {
			kind: 'port',
			id: 'P',
			label: 'P',
			x: 300,
			y: 300,
			color: { kind: 'token', value: 'blue' },
			line: 1
		};
		const degenerate: SchematicConnection = {
			from: { componentId: 'P', port: 'in' },
			to: { componentId: 'P', port: 'in' },
			color: { kind: 'token', value: 'blue' },
			curve: 'line',
			markerStart: 'none',
			markerEnd: 'none',
			label: 'loop',
			line: 1
		};
		const routes = routeConnections([degenerate], new Map([['P', port]]));
		expect(routes[0]!.d).toBe('M 258 300 L 258 300');
		expect(connectionLabelPoint(routes[0]!)).toEqual({ x: 258, y: 300 });
	});

	test('still accepts the two distinct leads of one component', () => {
		const document: SchematicDocument = parseSchematic(
			`resistor:R1 "R" at (300,300) #amber\nR1.l -> R1.right #amber`,
			fence
		);
		expect(document.connections[0]).toMatchObject({
			from: { componentId: 'R1', port: 'in' },
			to: { componentId: 'R1', port: 'out' }
		});
	});
});
