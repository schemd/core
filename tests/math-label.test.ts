/** Micro-math tokenization, Unicode translation, escaping, and baseline-reset verification. */
import { describe, expect, test } from 'vitest';
import {
	mathLabelGlyphLength,
	mathLabelText,
	mathLabelTextWidth,
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
