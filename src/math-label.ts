/**
 * Dependency-free micro-math tokenizer and inline SVG text renderer.
 *
 * The grammar is intentionally non-recursive and bounded by the caller's label
 * length. It recognizes subscript/superscript shifts and a fixed engineering
 * symbol map without evaluating TeX or allocating a browser-side math runtime.
 *
 * @packageDocumentation
 */

/** Visual baseline category assigned to one parsed label segment. */
export type MathLabelSegmentKind = 'text' | 'subscript' | 'superscript';

/** One normalized, Unicode-translated section of a component label. */
export interface MathLabelSegment {
	/** Baseline treatment used by the SVG renderer. */
	readonly kind: MathLabelSegmentKind;
	/** Plain Unicode content with grouping delimiters removed. */
	readonly value: string;
}

/** Fixed command-to-Unicode allowlist; unknown commands remain literal text. */
const MATH_SYMBOLS: Readonly<Record<string, string>> = Object.freeze({
	alpha: 'α',
	beta: 'β',
	Delta: 'Δ',
	cdot: '·',
	infty: '∞',
	lambda: 'λ',
	le: '≤',
	ge: '≥',
	mu: 'μ',
	neq: '≠',
	Omega: 'Ω',
	omega: 'ω',
	phi: 'φ',
	pi: 'π',
	pm: '±',
	rightarrow: '→',
	sigma: 'σ',
	sqrt: '√',
	theta: 'θ',
	times: '×'
});

/**
 * Determine whether a Unicode code point may be serialized in XML 1.0.
 *
 * @param codePoint - Scalar value obtained while iterating a JavaScript string.
 * @returns Whether XML permits the value in character data.
 */
function validXmlCodePoint(codePoint: number): boolean {
	if (codePoint === 0x09 || codePoint === 0x0a || codePoint === 0x0d) return true;
	if (codePoint >= 0x20 && codePoint <= 0xd7ff) return true;
	if (codePoint >= 0xe000 && codePoint <= 0xfffd) return true;
	return codePoint >= 0x10000 && codePoint <= 0x10ffff;
}

/**
 * Replace forbidden code points and escape XML-significant label characters.
 *
 * @param value - Unicode label segment controlled by a schematic author.
 * @returns Safe XML character data suitable inside an SVG `<text>` node.
 */
function escapeXml(value: string): string {
	let normalized = '';
	for (const character of value) {
		const codePoint = character.codePointAt(0)!;
		normalized += validXmlCodePoint(codePoint) ? character : '\ufffd';
	}
	return normalized
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;');
}

/**
 * Resolve the backslash command beginning at an exact string offset.
 *
 * @param value - Complete source label.
 * @param index - Offset of the command's backslash.
 * @returns Unicode replacement text and the first unread offset.
 */
function commandAt(value: string, index: number): { readonly text: string; readonly end: number } {
	const match = value.slice(index + 1).match(/^[A-Za-z]+/);
	if (!match) return { text: value[index]!, end: index + 1 };
	const command = match[0];
	const replacement = MATH_SYMBOLS[command];
	return {
		text: replacement ?? `\\${command}`,
		end: index + command.length + 1
	};
}

/**
 * Translate supported commands in a plain or shifted substring in one pass.
 *
 * @param value - Raw substring containing zero or more backslash commands.
 * @returns Unicode text; unknown alphabetic commands remain literal.
 */
function translateMathSymbols(value: string): string {
	let output = '';
	let index = 0;
	while (index < value.length) {
		if (value[index] !== '\\') {
			output += value[index];
			index += 1;
			continue;
		}
		const command = commandAt(value, index);
		output += command.text;
		index = command.end;
	}
	return output;
}

/**
 * Read a compact (`_x`) or grouped (`_{input}`) baseline shift.
 *
 * Unclosed groups are rejected without consuming text so the main parser can
 * preserve the original underscore/caret literally.
 *
 * @param value - Complete raw label.
 * @param index - Offset of the `_` or `^` shift marker.
 * @returns Shift content and first unread offset, or `undefined` for an unclosed group.
 */
function shiftedValue(
	value: string,
	index: number
): { readonly value: string; readonly end: number } | undefined {
	const first = value[index + 1];
	if (first !== '{') {
		const character = Array.from(value.slice(index + 1))[0]!;
		return { value: translateMathSymbols(character), end: index + 1 + character.length };
	}
	const closing = value.indexOf('}', index + 2);
	if (closing < 0) return undefined;
	return {
		value: translateMathSymbols(value.slice(index + 2, closing)),
		end: closing + 1
	};
}

/**
 * Append a segment while coalescing adjacent runs with the same baseline.
 *
 * @param segments - Mutable parser-owned output list.
 * @param kind - Baseline category of the new run.
 * @param value - Unicode-translated content; empty strings are ignored.
 */
function appendSegment(
	segments: MathLabelSegment[],
	kind: MathLabelSegmentKind,
	value: string
): void {
	if (value === '') return;
	const previous = segments.at(-1);
	if (previous?.kind === kind) {
		segments[segments.length - 1] = { kind, value: previous.value + value };
		return;
	}
	segments.push({ kind, value });
}

/**
 * Parse a deliberately small, linear-time math-label subset.
 *
 * @param value - Raw component label. Braces only group shifted content.
 * @returns Coalesced immutable baseline segments with symbol commands expanded.
 */
export function parseMathLabel(value: string): readonly MathLabelSegment[] {
	const segments: MathLabelSegment[] = [];
	let text = '';
	let index = 0;
	/** Commit the current normal-baseline buffer before a shifted segment. */
	const flush = () => {
		appendSegment(segments, 'text', text);
		text = '';
	};

	while (index < value.length) {
		const character = value[index]!;
		if ((character === '_' || character === '^') && index + 1 < value.length) {
			const shifted = shiftedValue(value, index);
			if (shifted !== undefined && shifted.value !== '') {
				flush();
				appendSegment(segments, character === '_' ? 'subscript' : 'superscript', shifted.value);
				index = shifted.end;
				continue;
			}
		}
		if (character === '\\') {
			const command = commandAt(value, index);
			text += command.text;
			index = command.end;
			continue;
		}
		// TeX grouping braces have no visual payload in this intentionally small subset.
		if (character !== '{' && character !== '}') text += character;
		index += 1;
	}
	flush();
	return segments;
}

/**
 * Return the accessible plain-text representation of a math label.
 *
 * @param value - Raw micro-math label.
 * @returns Unicode text without baseline grouping markup.
 */
export function mathLabelText(value: string): string {
	return parseMathLabel(value)
		.map((segment) => segment.value)
		.join('');
}

/**
 * Count rendered Unicode glyphs for deterministic SVG text fitting.
 *
 * @param value - Raw micro-math label.
 * @returns Unicode code-point count after command translation.
 */
export function mathLabelGlyphLength(value: string): number {
	return Array.from(mathLabelText(value)).length;
}

/**
 * Emit escaped inline SVG text with explicit baseline restoration.
 *
 * Plain labels avoid `<tspan>` allocation entirely. Shifted segments use a
 * 70% font size and an empty inverse-`dy` tspan so consecutive shifts cannot
 * accumulate vertical drift.
 *
 * @param value - Raw micro-math label.
 * @returns Trusted compiler-owned XML text suitable inside an SVG `<text>` node.
 */
export function renderMathLabelTspans(value: string): string {
	const segments = parseMathLabel(value);
	if (segments.length === 1 && segments[0]?.kind === 'text' && segments[0].value === value) {
		return escapeXml(value);
	}
	return segments
		.map((segment) => {
			const content = escapeXml(segment.value);
			if (segment.kind === 'text') return `<tspan dy="0">${content}</tspan>`;
			if (segment.kind === 'subscript') {
				return `<tspan dy="0.35em" font-size="70%">${content}</tspan><tspan dy="-0.35em" font-size="100%"></tspan>`;
			}
			return `<tspan dy="-0.55em" font-size="70%">${content}</tspan><tspan dy="0.55em" font-size="100%"></tspan>`;
		})
		.join('');
}
