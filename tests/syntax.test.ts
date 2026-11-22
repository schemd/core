/**
 * The hand-written scanner reads exactly the language of the 0.x patterns.
 *
 * The 0.8 regular expressions are kept here as the specification, with the one
 * change 1.2 made to the language: the quoted label may be left out. Every
 * generated line — random token soup and single-token mutations of valid
 * declarations — must classify identically under both, field for field. The
 * generator is seeded, so a failure reproduces.
 */
import { describe, expect, test } from 'vitest';

import { scanDeclaration } from '../src/syntax.js';

/* ---- the 0.8 specification, with 1.2's optional label ---- */
const COMPONENT_PATTERN =
	/^([A-Za-z][A-Za-z0-9_-]*):([A-Za-z][A-Za-z0-9_-]*)(?:\s+"([^"]+)")?\s+at\s+\((-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)\)\s+(.+)$/;
const COMPONENT_HEAD_PATTERN = /^([A-Za-z][A-Za-z0-9_-]*):([A-Za-z][A-Za-z0-9_-]*)(?:\s+"([^"]+)")?\s+(.+)$/;
const PLACEMENT_DIRECTION_PATTERN =
	/^(right-of|left-of|above|below)\s+([A-Za-z][A-Za-z0-9_-]*)(?:\.([A-Za-z][A-Za-z0-9_+-]*))?(?:\s+by\s+(-?\d+(?:\.\d+)?))?(?:\s+|$)/;
const PLACEMENT_ALIGNMENT_PATTERN =
	/^(aligned-x|aligned-y)\s+with\s+([A-Za-z][A-Za-z0-9_-]*)(?:\.([A-Za-z][A-Za-z0-9_+-]*))?(?:\s+|$)/;
const CONNECTION_PATTERN =
	/^([A-Za-z][A-Za-z0-9_-]*)\.([A-Za-z][A-Za-z0-9_+-]*)\s*->\s*([A-Za-z][A-Za-z0-9_-]*)\.([A-Za-z][A-Za-z0-9_+-]*)\s+(.+)$/;

function placementClause(rest: string): { relations: unknown[]; tail: string } {
	const relations: unknown[] = [];
	let cursor = rest;
	for (;;) {
		const direction = cursor.match(PLACEMENT_DIRECTION_PATTERN);
		if (direction !== null) {
			relations.push({
				kind: direction[1],
				ref: direction[2],
				...(direction[3] === undefined ? {} : { port: direction[3] }),
				...(direction[4] === undefined ? {} : { gap: Number(direction[4]) })
			});
			cursor = cursor.slice(direction[0].length);
			continue;
		}
		const alignment = cursor.match(PLACEMENT_ALIGNMENT_PATTERN);
		if (alignment !== null) {
			relations.push({ kind: alignment[1], ref: alignment[2], ...(alignment[3] === undefined ? {} : { port: alignment[3] }) });
			cursor = cursor.slice(alignment[0].length);
			continue;
		}
		return { relations, tail: cursor };
	}
}

function reference(text: string): unknown {
	const component = text.match(COMPONENT_PATTERN);
	if (component !== null) {
		const [, kind, id, label, x, y, tail] = component;
		return { form: 'absolute', kind, id, label, x, y, tail };
	}
	const head = text.match(COMPONENT_HEAD_PATTERN);
	if (head !== null) {
		const placement = placementClause(head[4]!);
		if (placement.relations.length > 0 && placement.tail !== '') {
			return { form: 'relative', kind: head[1], id: head[2], label: head[3], relations: placement.relations, tail: placement.tail };
		}
	}
	const connection = text.match(CONNECTION_PATTERN);
	if (connection !== null) {
		const [, fromId, fromPort, toId, toPort, tail] = connection;
		return { form: 'connection', fromId, fromPort, toId, toPort, tail };
	}
	return undefined;
}

function scanned(text: string): unknown {
	const syntax = scanDeclaration(text);
	if (syntax === undefined) return undefined;
	switch (syntax.form) {
		case 'absolute':
			return { form: 'absolute', kind: syntax.kind.text, id: syntax.id.text, label: syntax.label?.text, x: syntax.x.text, y: syntax.y.text, tail: syntax.tail.text };
		case 'relative':
			return { form: 'relative', kind: syntax.kind.text, id: syntax.id.text, label: syntax.label?.text, relations: syntax.relations, tail: syntax.tail.text };
		case 'connection':
			return { form: 'connection', fromId: syntax.fromId.text, fromPort: syntax.fromPort.text, toId: syntax.toId.text, toPort: syntax.toPort.text, tail: syntax.tail.text };
		/* 0.8 had no declaration without a position and rejected every such line.
		   Reading the new form as that rejection makes the comparison below prove
		   the form claims only lines that were errors before. */
		case 'unplaced':
			return undefined;
	}
}

/* ---- generation ---- */

/** Mulberry32: small, seeded, identical on every engine. */
function random(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let value = state;
		value = Math.imul(value ^ (value >>> 15), value | 1);
		value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
		return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
	};
}

const FRAGMENTS = [
	'resistor', 'R1', 'R_2', 'x-y', '9a', ':', '.', ' ', '  ', '\t', ' ', ' ', '　', '"', '"label"', '""',
	'at', 'at(', '(', ')', ',', ', ', '1', '-2', '2.5', '-0.75', '3.', '.5', '+1', '#amber', '[ortho]', 'tail',
	'right-of', 'left-of', 'above', 'below', 'aligned-x', 'aligned-y', 'with', 'by', 'by 4', 'R1.out', 'R1.out+',
	'out', 'out-', 'in', '->', '-', '>', '- >', 'A.b', '_', '+', 'é', '%'
] as const;

const VALID = [
	'resistor:R1 "R" at (100, 200) #amber',
	'resistor:R1 "R" at (-1.5,2) #amber [orientation=down]',
	'resistor:R1 at (100, 200) #amber',
	'port:P right-of R1 by 40 #blue',
	'junction:J1 aligned-x with R1 below R2 #slate',
	'port:P "in" right-of R1 by 40 #blue',
	'port:P "in" right-of R1.out by -4.25 aligned-y with R1 #blue',
	'port:P "in" aligned-x with R1.in below R2 #blue',
	'port:P "in" above R1.x+ #blue',
	'R1.out -> R2.in #amber [ortho]',
	'R1.out->R2.in #amber',
	'R1.out- -> R2.in- #amber',
	'Q.a+ -> Q.b-    #amber'
];

function lines(): string[] {
	const next = random(0x5c4e3d);
	const pick = <T,>(items: readonly T[]): T => items[Math.floor(next() * items.length)]!;
	/* Edges a generator rarely lands on: a clause that ends the line. */
	const out: string[] = [...VALID, 'port:P "in" right-of R1', 'port:P "in" above R1.x+ by 4', 'port:P "in" aligned-x with R1 below R2.in', 'port:P "in" right-of R1 by'];
	for (let index = 0; index < 20_000; index += 1) {
		const length = 1 + Math.floor(next() * 14);
		let text = '';
		for (let part = 0; part < length; part += 1) text += pick(FRAGMENTS);
		out.push(text);
	}
	/* Near misses: split a valid line into characters and edit one place. */
	for (let index = 0; index < 20_000; index += 1) {
		const base = [...pick(VALID)];
		const at = Math.floor(next() * (base.length + 1));
		const action = Math.floor(next() * 3);
		if (action === 0) base.splice(at, 1);
		else if (action === 1) base.splice(at, 0, pick(FRAGMENTS));
		else base.splice(at, 1, pick(FRAGMENTS));
		out.push(base.join(''));
	}
	return out.map((line) => line.trim()).filter((line) => line !== '');
}

describe('scanner against the 0.x patterns', () => {
	test('classifies every generated line exactly as the regular expressions did', () => {
		const mismatches: string[] = [];
		for (const line of lines()) {
			const expected = reference(line);
			const actual = scanned(line);
			if (JSON.stringify(expected) !== JSON.stringify(actual)) mismatches.push(JSON.stringify(line));
		}
		expect(mismatches.slice(0, 10)).toEqual([]);
	});

	test('accepts each valid declaration form', () => {
		for (const line of VALID) expect(scanned(line)).toEqual(reference(line));
		expect(VALID.every((line) => scanned(line) !== undefined)).toBe(true);
	});
});
