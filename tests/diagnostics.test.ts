import { describe, expect, it } from 'vitest';

import { parseSchematic, parseSchematicFence, SchematicSyntaxError } from '../src/index.js';

/**
 * A diagnostic should end the author's guessing, not start it.
 *
 * "move one component" and "outside the declared bounds" are both true and both
 * useless: the compiler knows the exact overlap, the offending coordinate, and a
 * value that resolves it. Every message below is checked twice — once for what
 * it says, and once by applying its own advice and compiling the result.
 */

const fence = parseSchematicFence('schemd bounds="900x400" title="Diagnostics"')!;
const narrowFence = parseSchematicFence('schemd bounds="800x400" title="Bounds"')!;
const tallFence = parseSchematicFence('schemd bounds="900x600" title="Tall"')!;

const ADVICE = /move (\w+) to ([xy]) (>=|<=) (-?\d+)/;

function messageFor(source: string, canvas = fence): string {
	try {
		parseSchematic(source, canvas);
	} catch (error) {
		if (error instanceof SchematicSyntaxError) return error.message;
		throw error;
	}
	throw new Error('expected the document to be rejected');
}

/** Apply a message's own `move X to y >= N` advice and return the new source. */
function applyAdvice(source: string, message: string): string {
	const match = ADVICE.exec(message);
	if (!match) throw new Error(`no actionable advice in: ${message}`);
	const [, id, axis, , value] = match;
	return source
		.split('\n')
		.map((line) =>
			line.includes(`:${id} `)
				? line.replace(/at \((-?\d+),\s*(-?\d+)\)/, (_whole, x: string, y: string) =>
						axis === 'x' ? `at (${value}, ${y})` : `at (${x}, ${value})`
					)
				: line
		)
		.join('\n');
}

describe('overlap diagnostics', () => {
	const sideBySide = `resistor:R1 "a" at (200, 150) #amber
resistor:R2 "b" at (240, 150) #amber`;
	const stacked = `resistor:R1 "a" at (200, 150) #amber
resistor:R2 "b" at (200, 180) #amber`;

	it('reports the overlap and a coordinate that clears it', () => {
		expect(messageFor(sideBySide)).toBe(
			'Line 2: R2 overlaps R1 by 44 units horizontally; move R2 to x >= 284, or use a UML container.'
		);
	});

	it('advises along the axis the author already used to separate the pair', () => {
		/* Side by side moves sideways, even though dropping one is a shorter move. */
		expect(messageFor(sideBySide)).toContain('horizontally');
		expect(messageFor(stacked)).toContain('vertically');
	});

	it('never advises moving a body through its neighbour', () => {
		const rightToLeft = `resistor:R1 "a" at (240, 150) #amber
resistor:R2 "b" at (200, 150) #amber`;
		expect(messageFor(rightToLeft)).toContain('move R1 to x >= 284');
	});

	it('advises a leftward move when the moving body sits left of what it hits', () => {
		/*
		 * Bodies are swept by ascending left edge, so the moving one normally
		 * lies to the right. A narrow part well inside a much wider one is the
		 * case where it does not, and it must back out the way it came rather
		 * than cross the whole body.
		 */
		const insideWide = `ic:U1 "chip" at (450, 200) #slate [left="a,b,c,d,e,f" right="w,x,y,z"]
resistor:R1 "r" at (440, 200) #amber`;
		const message = messageFor(insideWide);
		expect(message).toContain('move R1 to x <= 348');
		expect(() => parseSchematic(applyAdvice(insideWide, message), fence)).not.toThrow();
	});

	it('advises an upward move when the moving body sits above what it hits', () => {
		const insideTall = `ic:U1 "chip" at (400, 300) #slate [left="a,b,c,d,e,f,g,h" right="w,x,y,z"]
resistor:R1 "r" at (400, 190) #amber`;
		const message = messageFor(insideTall, tallFence);
		expect(message).toContain('move R1 to y <= 182');
		expect(() => parseSchematic(applyAdvice(insideTall, message), tallFence)).not.toThrow();
	});

	it('uses the singular for a one-unit overlap', () => {
		const barely = `resistor:R1 "a" at (200, 150) #amber
resistor:R2 "b" at (200, 185) #amber`;
		expect(messageFor(barely)).toContain('by 1 unit vertically');
	});

	it.each([
		['side by side', sideBySide],
		['stacked', stacked],
		[
			'different kinds',
			`capacitor:C1 "a" at (300, 200) #cyan
inductor:L1 "b" at (330, 215) #blue`
		]
	])('gives advice that actually compiles: %s', (_name, source) => {
		expect(() => parseSchematic(applyAdvice(source, messageFor(source)), fence)).not.toThrow();
	});
});

describe('bounds diagnostics', () => {
	const message = (source: string) => messageFor(source, narrowFence);

	it('names the offending coordinate and its range', () => {
		expect(message('resistor:R1 "a" at (900, 150) #amber')).toBe(
			'Line 1: R1 is outside the declared 800x400 bounds: x is 900, and must be between 0 and 800.'
		);
	});

	it('reports a negative coordinate too', () => {
		expect(message('resistor:R1 "a" at (200, -30) #amber')).toContain(
			'y is -30, and must be between 0 and 400'
		);
	});

	it('reports both coordinates when both are wrong', () => {
		const text = message('resistor:R1 "a" at (900, 500) #amber');
		expect(text).toContain('x is 900');
		expect(text).toContain('y is 500');
	});

	it('reports the overhang when the body escapes but the origin did not', () => {
		const text = message('resistor:R1 "a" at (790, 150) #amber');
		expect(text).toContain('extends 36 past x=800');
		expect(text).toContain('move R1 to x <= 754');
		expect(text).toContain('Widen the fence bounds');
	});

	it('gives overhang advice that compiles', () => {
		expect(() =>
			parseSchematic('resistor:R1 "a" at (754, 150) #amber', narrowFence)
		).not.toThrow();
	});

	it('reports a leftward and an upward overhang', () => {
		expect(message('resistor:R1 "a" at (10, 150) #amber')).toContain('left of x=0');
		expect(message('resistor:R1 "a" at (200, 4) #amber')).toContain('above y=0');
	});

	it('joins several overhangs into one message', () => {
		expect(message('resistor:R1 "a" at (10, 4) #amber')).toContain(', and ');
	});
});
