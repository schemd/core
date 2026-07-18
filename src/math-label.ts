/**
 * Dependency-free micro-math tokenizer and inline SVG text renderer.
 *
 * The grammar is intentionally non-recursive and bounded by the caller's label
 * length. It recognizes subscript/superscript shifts and a fixed engineering
 * symbol map without evaluating TeX or allocating a browser-side math runtime.
 *
 * @packageDocumentation
 */

import { escapeXml } from './xml.js';

/** Visual baseline category assigned to one parsed label segment. */
export type MathLabelSegmentKind = 'text' | 'subscript' | 'superscript';

/** One normalized, Unicode-translated section of a component label. */
export interface MathLabelSegment {
	/** Baseline treatment used by the SVG renderer. */
	readonly kind: MathLabelSegmentKind;
	/** Plain Unicode content with grouping delimiters removed. */
	readonly value: string;
	/** Absolute font scale for nested scripts; omitted for normal and first-level runs. */
	readonly fontScale?: number;
	/** Absolute baseline shift in parent em units for nested scripts. */
	readonly baselineShiftEm?: number;
}

/** Parser-owned mutable form used to coalesce runs without repeated object cloning. */
interface MutableMathLabelSegment {
	kind: MathLabelSegmentKind;
	value: string;
	fontScale?: number;
	baselineShiftEm?: number;
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
 * Resolve the backslash command beginning at an exact string offset.
 *
 * @param value - Complete source label.
 * @param index - Offset of the command's backslash.
 * @returns Unicode replacement text and the first unread offset.
 */
function commandAt(value: string, index: number): { readonly text: string; readonly end: number } {
	const escaped = value[index + 1];
	if (
		escaped === '\\' ||
		escaped === '{' ||
		escaped === '}' ||
		escaped === '_' ||
		escaped === '^'
	) {
		return { text: escaped, end: index + 2 };
	}
	let end = index + 1;
	while (end < value.length) {
		const code = value.charCodeAt(end);
		if (!((code >= 65 && code <= 90) || (code >= 97 && code <= 122))) break;
		end += 1;
	}
	if (end === index + 1) return { text: '\\', end: index + 1 };
	const command = value.slice(index + 1, end);
	const replacement = MATH_SYMBOLS[command];
	return {
		text: replacement ?? `\\${command}`,
		end
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
	segments: MutableMathLabelSegment[],
	kind: MathLabelSegmentKind,
	value: string,
	fontScale: number,
	baselineShiftEm: number
): void {
	const previous = segments.at(-1);
	const previousScale = previous?.fontScale ?? (previous?.kind === 'text' ? 1 : 0.7);
	const previousShift =
		previous?.baselineShiftEm ??
		(previous?.kind === 'subscript' ? 0.35 : previous?.kind === 'superscript' ? -0.55 : 0);
	if (
		previous?.kind === kind &&
		previousScale === fontScale &&
		previousShift === baselineShiftEm
	) {
		previous.value += value;
		return;
	}
	const nested = fontScale !== (kind === 'text' ? 1 : 0.7) ||
		baselineShiftEm !== (kind === 'subscript' ? 0.35 : kind === 'superscript' ? -0.55 : 0);
	segments.push(
		nested ? { kind, value, fontScale, baselineShiftEm } : { kind, value }
	);
}

/**
 * Parse a deliberately small, linear-time math-label subset.
 *
 * @param value - Raw component label. Braces only group shifted content.
 * @returns Coalesced immutable baseline segments with symbol commands expanded.
 */
export function parseMathLabel(value: string): readonly MathLabelSegment[] {
	const segments: MutableMathLabelSegment[] = [];
	const braceStack: number[] = [];
	const matchingBraces = new Map<number, number>();
	const matchedClosings = new Set<number>();
	for (let cursor = 0; cursor < value.length; cursor += 1) {
		if (value[cursor] === '\\') {
			cursor += 1;
			continue;
		}
		if (value[cursor] === '{') braceStack.push(cursor);
		else if (value[cursor] === '}') {
			const opening = braceStack.pop();
			if (opening !== undefined) {
				matchingBraces.set(opening, cursor);
				matchedClosings.add(cursor);
			}
		}
	}
	interface Context {
		readonly end: number;
		readonly kind: MathLabelSegmentKind;
		readonly fontScale: number;
		readonly baselineShiftEm: number;
	}
	const contexts: Context[] = [
		{ end: value.length, kind: 'text', fontScale: 1, baselineShiftEm: 0 }
	];
	let index = 0;
	while (index < value.length) {
		const context = contexts[contexts.length - 1]!;
		if (index === context.end) {
			contexts.pop();
			index += 1;
			continue;
		}
		const character = value[index]!;
		if (matchingBraces.has(index) || matchedClosings.has(index)) {
			index += 1;
			continue;
		}
		if ((character === '_' || character === '^') && index + 1 < value.length) {
			const kind = character === '_' ? 'subscript' : 'superscript';
			const fontScale = context.fontScale * 0.7;
			const baselineShiftEm =
				context.baselineShiftEm +
				(character === '_' ? 0.35 * context.fontScale : -0.55 * context.fontScale);
			if (value[index + 1] === '{') {
				const closing = matchingBraces.get(index + 1);
				if (closing !== undefined) {
					contexts.push({ end: closing, kind, fontScale, baselineShiftEm });
					index += 2;
					continue;
				}
				appendSegment(
					segments,
					context.kind,
					character,
					context.fontScale,
					context.baselineShiftEm
				);
				index += 1;
				continue;
			}
			let token: { readonly text: string; readonly end: number };
			if (value[index + 1] === '\\') token = commandAt(value, index + 1);
			else {
				const codePoint = value.codePointAt(index + 1)!;
				const text = String.fromCodePoint(codePoint);
				token = { text, end: index + 1 + text.length };
			}
			appendSegment(segments, kind, token.text, fontScale, baselineShiftEm);
			index = token.end;
			continue;
		}
		if (character === '\\') {
			const command = commandAt(value, index);
			appendSegment(
				segments,
				context.kind,
				command.text,
				context.fontScale,
				context.baselineShiftEm
			);
			index = command.end;
			continue;
		}
		const codePoint = value.codePointAt(index)!;
		const text = String.fromCodePoint(codePoint);
		appendSegment(
			segments,
			context.kind,
			text,
			context.fontScale,
			context.baselineShiftEm
		);
		index += text.length;
	}
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
	let length = 0;
	for (const _character of mathLabelText(value)) length += 1;
	return length;
}

/**
 * Estimate deterministic text advance without browser font measurement.
 *
 * Combining marks consume no additional width, East Asian and emoji code
 * points consume two cells, and nested scripts retain their parsed font scale.
 * The result deliberately overestimates ambiguous mathematical glyphs slightly
 * so labels are fitted before they can collide with neighboring geometry.
 *
 * @param value - Raw micro-math label.
 * @param cellAdvance - Width of one ordinary glyph in viewBox units.
 * @returns Estimated rendered width in viewBox units.
 */
export function mathLabelTextWidth(value: string, cellAdvance = 7): number {
	let cells = 0;
	for (const segment of parseMathLabel(value)) {
		const scale = segment.fontScale ?? (segment.kind === 'text' ? 1 : 0.7);
		for (const character of segment.value) {
			const codePoint = character.codePointAt(0)!;
			if (
				(codePoint >= 0x0300 && codePoint <= 0x036f) ||
				(codePoint >= 0x1ab0 && codePoint <= 0x1aff) ||
				(codePoint >= 0x1dc0 && codePoint <= 0x1dff) ||
				(codePoint >= 0xfe00 && codePoint <= 0xfe0f) ||
				(codePoint >= 0xfe20 && codePoint <= 0xfe2f) ||
				codePoint === 0x200d
			) {
				continue;
			}
			const doubleWidth =
				codePoint >= 0x1100 &&
				(codePoint <= 0x115f ||
					(codePoint >= 0x2329 && codePoint <= 0x232a) ||
					(codePoint >= 0x2e80 && codePoint <= 0xa4cf) ||
					(codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
					(codePoint >= 0xf900 && codePoint <= 0xfaff) ||
					(codePoint >= 0xfe10 && codePoint <= 0xfe6f) ||
					(codePoint >= 0xff00 && codePoint <= 0xff60) ||
					(codePoint >= 0x1f300 && codePoint <= 0x1faff));
			let widthFactor = 1;
			if (doubleWidth) widthFactor = 2;
			else if ('MWmw@%&'.includes(character)) widthFactor = 1.55;
			else if ('ilI.,:;!|\'` '.includes(character)) widthFactor = 0.55;
			else if (codePoint === 0x03a9 || codePoint === 0x221e) widthFactor = 1.35;
			cells += widthFactor * scale;
		}
	}
	return cells * cellAdvance;
}

/**
 * Emit escaped inline SVG text with explicit baseline restoration.
 *
 * Plain labels avoid `<tspan>` allocation entirely. Shifted segments carry
 * absolute scale and baseline metrics; each emitted `dy` is the delta from the
 * preceding run, so nested and consecutive scripts cannot accumulate drift.
 *
 * @param value - Raw micro-math label.
 * @returns Trusted compiler-owned XML text suitable inside an SVG `<text>` node.
 */
export function renderMathLabelTspans(value: string): string {
	const segments = parseMathLabel(value);
	if (segments.length === 1 && segments[0]?.kind === 'text' && segments[0].value === value) {
		return escapeXml(value);
	}
	const nested = segments.some((segment) => segment.fontScale !== undefined);
	if (nested) {
		let previousShift = 0;
		let markup = '';
		for (const segment of segments) {
			const shift =
				segment.baselineShiftEm ??
				(segment.kind === 'subscript' ? 0.35 : segment.kind === 'superscript' ? -0.55 : 0);
			const scale = segment.fontScale ?? (segment.kind === 'text' ? 1 : 0.7);
			const delta = Number((shift - previousShift).toFixed(4));
			const fontPercent = Number((scale * 100).toFixed(2));
			markup += `<tspan dy="${delta}em" font-size="${fontPercent}%">${escapeXml(segment.value)}</tspan>`;
			previousShift = shift;
		}
		if (previousShift !== 0) {
			markup += `<tspan dy="${Number((-previousShift).toFixed(4))}em" font-size="100%"></tspan>`;
		}
		return markup;
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
