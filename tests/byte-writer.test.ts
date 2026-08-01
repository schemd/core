/**
 * `BoundedSvgWriter`: the compiler's only path from markup to bytes.
 *
 * Two properties make this component load-bearing, and both are asserted here
 * rather than assumed:
 *
 * - **The budget is exact.** The writer is what stands between a host and an
 *   unbounded allocation, so a chunk that would cross the ceiling must be
 *   refused by its true encoded size — not by an estimate, and not by a count
 *   that disagrees with what is actually written.
 * - **A rejected append commits nothing.** 0.3.2 fixed a writer whose byte
 *   count advanced before its content did, so a refused multi-byte chunk
 *   corrupted every later in-budget write. That regression is pinned below.
 *
 * The suite deliberately drives the writer directly instead of through a
 * compiled document: reaching a 256 MiB ceiling by rendering would require
 * allocating it.
 */
import { describe, expect, test } from 'vitest';

import { BoundedSvgWriter, MAX_SVG_OUTPUT_BYTES } from '../src/renderer.js';

/** The exact UTF-8 size of a string, independent of the writer under test. */
function encodedLength(value: string): number {
	return new TextEncoder().encode(value).length;
}

describe('exact byte accounting', () => {
	test.each([
		['ascii', 'abc', 3],
		['two-byte', 'é', 2],
		['three-byte', '€', 3],
		['astral pair', '😀', 4],
		['mixed', 'a€😀é', 10]
	])('counts %s by its encoded size', (_label, chunk, expected) => {
		const writer = new BoundedSvgWriter(64);
		writer.append(chunk);
		expect(writer.byteLength).toBe(expected);
		expect(writer.byteLength).toBe(encodedLength(chunk));
		expect(writer.finish()).toBe(chunk);
	});

	test('reports a running total that always matches the finished document', () => {
		const writer = new BoundedSvgWriter(4_096);
		const chunks = ['<svg>', 'é', '😀', '</svg>', '', '€ ohm'];
		for (const chunk of chunks) writer.append(chunk);
		const finished = writer.finish();
		expect(finished).toBe(chunks.join(''));
		expect(writer.byteLength).toBe(encodedLength(finished));
	});

	test('counts a lone surrogate as the replacement character it becomes', () => {
		/*
		 * The retired hand-written counter assumed any high surrogate began a
		 * valid pair and charged four bytes. An unpaired one encodes to U+FFFD,
		 * which is three — so the old count could refuse a document that fits.
		 * The writer now charges what it actually writes.
		 */
		const writer = new BoundedSvgWriter(64);
		writer.append('\ud800');
		expect(writer.byteLength).toBe(3);
		expect(writer.finish()).toBe('�');
	});
});

describe('the output ceiling', () => {
	test('accepts a document that lands exactly on the limit', () => {
		const writer = new BoundedSvgWriter(8);
		writer.append('12345678');
		expect(writer.byteLength).toBe(8);
		expect(writer.finish()).toBe('12345678');
	});

	test('refuses the byte that would cross it', () => {
		const writer = new BoundedSvgWriter(8);
		writer.append('12345678');
		expect(() => writer.append('9')).toThrow(/8 byte output limit/);
	});

	test('refuses a multi-byte character that straddles the ceiling', () => {
		/* One byte of room left, and the next character needs two. */
		const writer = new BoundedSvgWriter(8);
		writer.append('1234567');
		expect(() => writer.append('é')).toThrow(/8 byte output limit/);
	});

	test('refuses a chunk larger than the whole budget without allocating it', () => {
		/*
		 * The guard that matters for untrusted source: a writer must not reserve
		 * three bytes per code unit for a chunk it is going to refuse. A 32-byte
		 * budget facing a 4 MiB chunk must fail on the budget, not on memory.
		 */
		const writer = new BoundedSvgWriter(32);
		expect(() => writer.append('x'.repeat(4 * 1024 * 1024))).toThrow(/32 byte output limit/);
	});

	test('refuses any further content once the ceiling is reached', () => {
		const writer = new BoundedSvgWriter(4);
		writer.append('abcd');
		expect(() => writer.append('e')).toThrow(/4 byte output limit/);
	});

	test('a zero-byte budget admits nothing but still finishes', () => {
		const writer = new BoundedSvgWriter(0);
		expect(() => writer.append('a')).toThrow(/0 byte output limit/);
		expect(writer.finish()).toBe('');
		expect(writer.byteLength).toBe(0);
	});

	test('states the compiler default', () => {
		expect(MAX_SVG_OUTPUT_BYTES).toBe(268_435_456);
		expect(() => new BoundedSvgWriter().append('x')).not.toThrow();
	});
});

describe('atomicity', () => {
	test('a rejected append commits neither bytes nor content', () => {
		/* The 0.3.2 regression, stated as a property. */
		const writer = new BoundedSvgWriter(1_024);
		const allocation = 'x'.repeat(1_023);
		writer.append(allocation);
		expect(writer.byteLength).toBe(1_023);
		expect(() => writer.append('é')).toThrow(/1,024 byte output limit/);
		expect(writer.byteLength).toBe(1_023);
		writer.append('x');
		expect(writer.finish()).toBe(`${allocation}x`);
		expect(writer.byteLength).toBe(1_024);
	});

	test('survives a long run of alternating refusals and accepts', () => {
		const writer = new BoundedSvgWriter(64);
		let expected = '';
		for (let index = 0; index < 64; index += 1) {
			expect(() => writer.append('😀'.repeat(64))).toThrow(/64 byte output limit/);
			writer.append('a');
			expected += 'a';
			expect(writer.byteLength).toBe(expected.length);
		}
		expect(writer.finish()).toBe(expected);
	});
});

describe('buffer growth', () => {
	test('crosses the initial capacity boundary without losing content', () => {
		/*
		 * The writer starts at 1 KiB and doubles. Growth copies only what is
		 * committed, so a bug here would truncate or duplicate — both visible in
		 * the finished document rather than only in the byte count.
		 */
		const writer = new BoundedSvgWriter(1 << 20);
		let expected = '';
		for (let index = 0; index < 2_000; index += 1) {
			const chunk = `<g id="n${index}"/>`;
			writer.append(chunk);
			expected += chunk;
		}
		expect(writer.finish()).toBe(expected);
		expect(writer.byteLength).toBe(encodedLength(expected));
	});

	test('grows correctly when one chunk dwarfs the current capacity', () => {
		const writer = new BoundedSvgWriter(1 << 20);
		writer.append('a');
		const large = 'b'.repeat(300_000);
		writer.append(large);
		expect(writer.finish()).toBe(`a${large}`);
		expect(writer.byteLength).toBe(300_001);
	});

	test('preserves multi-byte content written across a growth boundary', () => {
		const writer = new BoundedSvgWriter(1 << 20);
		const unit = '€😀é';
		let expected = '';
		for (let index = 0; index < 500; index += 1) {
			writer.append(unit);
			expected += unit;
		}
		expect(writer.finish()).toBe(expected);
		expect(writer.byteLength).toBe(encodedLength(expected));
	});
});

describe('empty input', () => {
	test('an empty chunk changes nothing', () => {
		const writer = new BoundedSvgWriter(4);
		writer.append('');
		expect(writer.byteLength).toBe(0);
		writer.append('abcd');
		writer.append('');
		expect(writer.byteLength).toBe(4);
		expect(writer.finish()).toBe('abcd');
	});

	test('an empty chunk is accepted even at a full ceiling', () => {
		/* Nothing is written, so nothing can overflow. */
		const writer = new BoundedSvgWriter(2);
		writer.append('ab');
		expect(() => writer.append('')).not.toThrow();
		expect(writer.finish()).toBe('ab');
	});

	test('a writer that accepted nothing finishes empty', () => {
		expect(new BoundedSvgWriter(16).finish()).toBe('');
	});
});

describe('property: the writer agrees with the encoder', () => {
	test('byteLength equals the encoded size of finish() over randomized input', () => {
		/*
		 * Deterministic so a failure is reproducible. The alphabet spans all four
		 * UTF-8 widths plus the markup characters the renderer actually emits.
		 */
		let state = 0x9e3779b9;
		const next = () => {
			state = (state + 0x6d2b79f5) >>> 0;
			let t = state;
			t = Math.imul(t ^ (t >>> 15), t | 1);
			t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
			return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
		};
		const alphabet = ['<', '>', '/', 'g', ' ', '"', 'é', '€', '😀', 'Ω', '\n'];

		for (let trial = 0; trial < 200; trial += 1) {
			const writer = new BoundedSvgWriter(1 << 20);
			let expected = '';
			const chunks = 1 + Math.floor(next() * 12);
			for (let chunk = 0; chunk < chunks; chunk += 1) {
				let text = '';
				const length = Math.floor(next() * 40);
				for (let index = 0; index < length; index += 1) {
					text += alphabet[Math.floor(next() * alphabet.length)]!;
				}
				writer.append(text);
				expected += text;
			}
			const finished = writer.finish();
			expect(finished).toBe(expected);
			expect(writer.byteLength).toBe(encodedLength(finished));
		}
	});

	test('the ceiling admits exactly the documents that fit', () => {
		/* For every budget around a known encoded size, accept iff it fits. */
		const chunk = 'a€😀';
		const size = encodedLength(chunk);
		for (let limit = 0; limit <= size + 2; limit += 1) {
			const writer = new BoundedSvgWriter(limit);
			if (limit >= size) {
				expect(() => writer.append(chunk)).not.toThrow();
				expect(writer.byteLength).toBe(size);
			} else {
				expect(() => writer.append(chunk)).toThrow(/byte output limit/);
				expect(writer.byteLength).toBe(0);
			}
		}
	});
});
