/** Micro-math tokenization, Unicode translation, escaping, and baseline-reset verification. */
import { describe, expect, test } from 'vitest';
import {
	mathLabelGlyphLength,
	mathLabelText,
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
			'<tspan dy="0">V</tspan><tspan dy="0.35em" font-size="70%">in</tspan><tspan dy="-0.35em" font-size="100%"></tspan><tspan dy="0">&lt;Ω</tspan><tspan dy="-0.55em" font-size="70%">2</tspan><tspan dy="0.55em" font-size="100%"></tspan>'
		);
	});

	test('keeps plain and unknown commands compact and safe', () => {
		expect(renderMathLabelTspans('10k & stable')).toBe('10k &amp; stable');
		expect(renderMathLabelTspans(`<&>"'`)).toBe('&lt;&amp;&gt;&quot;&#39;');
		expect(mathLabelText('\\custom{x}')).toBe('\\customx');
		expect(mathLabelText('\\')).toBe('\\');
		expect(parseMathLabel('x_a_b')).toEqual([
			{ kind: 'text', value: 'x' },
			{ kind: 'subscript', value: 'ab' }
		]);
		expect(mathLabelText('x_{\\pi}')).toBe('xπ');
		expect(renderMathLabelTspans('\u0000')).toBe('�');
		expect(parseMathLabel('dangling_{value')).toEqual([{ kind: 'text', value: 'dangling_value' }]);
	});
});
