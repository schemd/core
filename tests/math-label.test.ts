/** Micro-math tokenization, Unicode translation, escaping, and baseline-reset verification. */
import { describe, expect, test } from 'vitest';
import {
	MATH_LABEL_FONT_FAMILY,
	mathLabelGlyphLength,
	mathLabelText,
	mathLabelTextWidth,
	mathLabelTextWidthAt,
	parseMathLabel,
	renderMathLabelTspans
} from '../src/math-label.js';

describe('micro math labels', () => {
	test('tokenizes grouped and compact shifts with native math symbols', () => {
		expect(parseMathLabel('V_{in} = \\omega_0 \\cdot t^2')).toEqual([
			{ kind: 'text', value: 'V' },
			{ kind: 'subscript', value: 'in' },
			{ kind: 'text', value: ' = ω' },
			{ kind: 'subscript', value: '0' },
			{ kind: 'text', value: ' · t' },
			{ kind: 'superscript', value: '2' }
		]);
		expect(mathLabelText('f_c = 1 / (2\\pi \\sqrt{LC})')).toBe('fc = 1 / (2π √LC)');
		expect(mathLabelGlyphLength('R_{load}')).toBe(5);
	});

	test('emits escaped tspans with explicit baseline restoration', () => {
		const rendered = renderMathLabelTspans('V_{in}<\\Omega^{2}');
		expect(rendered).toBe(
			'<tspan dy="0em" font-size="100%">V</tspan><tspan dy="0.5em" font-size="70%">in</tspan><tspan dy="-0.35em" font-size="100%">&lt;Ω</tspan><tspan dy="-0.7857em" font-size="70%">2</tspan><tspan dy="0.55em" font-size="100%"></tspan>'
		);
	});

	test('keeps plain and unknown commands compact and safe', () => {
		expect(renderMathLabelTspans('10k & stable')).toBe('10k &amp; stable');
		expect(renderMathLabelTspans('\\unknown')).toBe('\\unknown');
		expect(renderMathLabelTspans(`<&>"'`)).toBe('&lt;&amp;&gt;&quot;&#39;');
		expect(mathLabelText('\\custom{x}')).toBe('\\customx');
		expect(mathLabelText('}')).toBe('}');
		expect(mathLabelText('\\')).toBe('\\');
		expect(parseMathLabel('x_a_b')).toEqual([
			{ kind: 'text', value: 'x' },
			{ kind: 'subscript', value: 'ab' }
		]);
		expect(mathLabelText('x_{\\pi}')).toBe('xπ');
		expect(mathLabelText('x_\\pi')).toBe('xπ');
		expect(renderMathLabelTspans('\u0000')).toBe('�');
		expect(parseMathLabel('dangling_{value')).toEqual([
			{ kind: 'text', value: 'dangling_{value' }
		]);
		expect(mathLabelText('\\{raw\\} \\_ \\^')).toBe('{raw} _ ^');
	});

	test('keeps nested scripts at absolute baselines without recursive parsing', () => {
		const parsed = parseMathLabel('A_{x_{sub}} e^{x^2} Z');
		expect(parsed).toContainEqual({
			kind: 'subscript',
			value: 'sub',
			fontScale: 0.48999999999999994,
			baselineShiftEm: 0.595
		});
		expect(parsed).toContainEqual({
			kind: 'superscript',
			value: '2',
			fontScale: 0.48999999999999994,
			baselineShiftEm: -0.935
		});
		const rendered = renderMathLabelTspans('A_{x_{sub}} tail');
		expect(rendered).toContain('font-size="49%"');
		expect(rendered).toContain('<tspan dy="-0.595em" font-size="100%"> tail</tspan>');
		expect(mathLabelText('A_{x_{sub}}')).toBe('Axsub');
		expect(mathLabelTextWidth('Ω∞')).toBeGreaterThan(mathLabelTextWidth('Ω'));
		expect(renderMathLabelTspans('A_{x_{sub}}')).toContain(
			'<tspan dy="-0.595em" font-size="100%"></tspan>'
		);
		expect(renderMathLabelTspans('e^{x^2}')).toContain('font-size="49%"');
		const zeroWidthMarks = '\u0301\u1ab0\u1dc0\ufe00\ufe20\u200d';
		expect(mathLabelTextWidth(`e${zeroWidthMarks}`)).toBe(mathLabelTextWidth('e'));
		expect(mathLabelTextWidth('ᄀ〈⺀가豈︐！😀')).toBeGreaterThan(mathLabelTextWidth('abcdefgh'));
		expect(mathLabelTextWidth('WWW')).toBeGreaterThan(mathLabelTextWidth('iii'));
	});
});

describe('measured text width', () => {
	test('matches Arial advances, scripts at their scale, accents as their base letter', () => {
		/* Each value is the rendered width in Arial to within kerning; see the
		   width table in math-label.ts for where the advances come from. */
		expect(mathLabelTextWidthAt('Microcontroller', 12)).toBe(78.72);
		expect(mathLabelTextWidthAt('GND', 12)).toBe(26.64);
		expect(mathLabelTextWidthAt('1 k\\Omega', 12)).toBe(25.08);
		expect(mathLabelTextWidthAt('V_{out}', 12)).toBe(19.8);
		expect(mathLabelTextWidthAt('Zürich', 12)).toBe(33.36);
		expect(mathLabelTextWidthAt('é', 12)).toBe(6.72);
		expect(mathLabelTextWidthAt('日本', 10)).toBe(20);
		/* Anything else takes a digit's width. */
		expect(mathLabelTextWidthAt('☃', 12)).toBe(6.72);
		expect(mathLabelTextWidthAt('Order', 13, true)).toBe(34.711);
	});

	test('the advance-based form scales the font size in proportion', () => {
		expect(mathLabelTextWidth('GND')).toBe(26.64);
		expect(mathLabelTextWidth('GND', 14)).toBe(53.28);
		expect(MATH_LABEL_FONT_FAMILY.startsWith('Arial, Helvetica')).toBe(true);
	});

	test('repeated parses share one frozen result, and the cache stays bounded', () => {
		const first = parseMathLabel('R_{load}');
		expect(parseMathLabel('R_{load}')).toBe(first);
		expect(Object.isFrozen(first) && Object.isFrozen(first[0])).toBe(true);
		for (let index = 0; index < 1100; index += 1) parseMathLabel(`label ${index}`);
		expect(parseMathLabel('R_{load}')).not.toBe(first);
		expect(parseMathLabel('R_{load}')).toEqual(first);
	});
});

describe('bra-ket notation', () => {
	test('angle brackets and the circled plus are symbols, measured like the rest', () => {
		expect(mathLabelText('|0\\rangle')).toBe('|0⟩');
		expect(mathLabelText('\\langle\\psi|\\phi\\rangle')).toBe('⟨\\psi|φ⟩');
		expect(mathLabelText('a \\oplus b')).toBe('a ⊕ b');
		expect(mathLabelTextWidthAt('|0\\rangle', 12)).toBe(mathLabelTextWidthAt('|0⟩', 12));
	});
});
