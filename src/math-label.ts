import { fromMilli, toMilli } from './geom.js';
import { escapeXml } from './xml.js';

export type MathLabelSegmentKind = 'text' | 'subscript' | 'superscript';

export interface MathLabelSegment {
	readonly kind: MathLabelSegmentKind;
	readonly value: string;
	readonly fontScale?: number;
	readonly baselineShiftEm?: number;
}

interface MutableSeg {
	kind: MathLabelSegmentKind;
	value: string;
	fontScale?: number;
	baselineShiftEm?: number;
}

const MATH_SYMBOLS: Readonly<Record<string, string>> = {
	alpha: 'α', beta: 'β', Delta: 'Δ', cdot: '·', infty: '∞', lambda: 'λ', langle: '⟨', le: '≤', ge: '≥',
	mu: 'μ', neq: '≠', Omega: 'Ω', omega: 'ω', oplus: '⊕', phi: 'φ', pi: 'π', pm: '±', rangle: '⟩',
	rightarrow: '→', sigma: 'σ', sqrt: '√', theta: 'θ', times: '×'
};

const PARSE_CACHE_LIMIT = 1024;
const parsed = new Map<string, readonly MathLabelSegment[]>();

function commandAt(value: string, index: number): { readonly text: string; readonly end: number } {
	const next = value[index + 1];
	if (next === '\\' || next === '{' || next === '}' || next === '_' || next === '^') return { text: next, end: index + 2 };
	let end = index + 1;
	while (end < value.length) {
		const code = value.charCodeAt(end);
		if (!((code >= 65 && code <= 90) || (code >= 97 && code <= 122))) break;
		end += 1;
	}
	if (end === index + 1) return { text: '\\', end };
	const cmd = value.slice(index + 1, end);
	return { text: MATH_SYMBOLS[cmd] ?? `\\${cmd}`, end };
}

const defaultShift = (kind: MathLabelSegmentKind): number => (kind === 'subscript' ? 0.35 : kind === 'superscript' ? -0.55 : 0);

function appendSegment(segments: MutableSeg[], kind: MathLabelSegmentKind, value: string, fontScale: number, baselineShiftEm: number): void {
	const prev = segments.at(-1);
	if (
		prev !== undefined &&
		prev.kind === kind &&
		(prev.fontScale ?? (kind === 'text' ? 1 : 0.7)) === fontScale &&
		(prev.baselineShiftEm ?? defaultShift(kind)) === baselineShiftEm
	) {
		prev.value += value;
		return;
	}
	const nested = fontScale !== (kind === 'text' ? 1 : 0.7) || baselineShiftEm !== defaultShift(kind);
	segments.push(nested ? { kind, value, fontScale, baselineShiftEm } : { kind, value });
}

export function parseMathLabel(value: string): readonly MathLabelSegment[] {
	const cached = parsed.get(value);
	if (cached !== undefined) return cached;
	const segments: MutableSeg[] = [];
	if (!SPECIAL_MATH.test(value)) {
		if (value !== '') segments.push({ kind: 'text', value });
	} else {
		const braceStack: number[] = [];
		const matchingBraces = new Map<number, number>();
		const matchedClosings = new Set<number>();
		for (let i = 0; i < value.length; i += 1) {
			const ch = value[i];
			if (ch === '\\') i += 1;
			else if (ch === '{') braceStack.push(i);
			else if (ch === '}') {
				const open = braceStack.pop();
				if (open !== undefined) {
					matchingBraces.set(open, i);
					matchedClosings.add(i);
				}
			}
		}
		const contexts: { end: number; kind: MathLabelSegmentKind; fontScale: number; baselineShiftEm: number }[] = [
			{ end: value.length, kind: 'text', fontScale: 1, baselineShiftEm: 0 }
		];
		let i = 0;
		while (i < value.length) {
			const ctx = contexts[contexts.length - 1]!;
			if (i === ctx.end) {
				contexts.pop();
				i += 1;
				continue;
			}
			if (matchingBraces.has(i) || matchedClosings.has(i)) {
				i += 1;
				continue;
			}
			const ch = value[i]!;
			if ((ch === '_' || ch === '^') && i + 1 < value.length) {
				const kind: MathLabelSegmentKind = ch === '_' ? 'subscript' : 'superscript';
				const fontScale = ctx.fontScale * 0.7;
				const baselineShiftEm = ctx.baselineShiftEm + (ch === '_' ? 0.35 : -0.55) * ctx.fontScale;
				if (value[i + 1] === '{') {
					const close = matchingBraces.get(i + 1);
					if (close !== undefined) {
						contexts.push({ end: close, kind, fontScale, baselineShiftEm });
						i += 2;
						continue;
					}
					appendSegment(segments, ctx.kind, ch, ctx.fontScale, ctx.baselineShiftEm);
					i += 1;
					continue;
				}
				const tok =
					value[i + 1] === '\\'
						? commandAt(value, i + 1)
						: (() => {
								const s = String.fromCodePoint(value.codePointAt(i + 1)!);
								return { text: s, end: i + 1 + s.length };
							})();
				appendSegment(segments, kind, tok.text, fontScale, baselineShiftEm);
				i = tok.end;
				continue;
			}
			if (ch === '\\') {
				const cmd = commandAt(value, i);
				appendSegment(segments, ctx.kind, cmd.text, ctx.fontScale, ctx.baselineShiftEm);
				i = cmd.end;
				continue;
			}
			const s = String.fromCodePoint(value.codePointAt(i)!);
			appendSegment(segments, ctx.kind, s, ctx.fontScale, ctx.baselineShiftEm);
			i += s.length;
		}
	}
	const frozen = Object.freeze(segments.map((s) => Object.freeze(s)));
	if (parsed.size >= PARSE_CACHE_LIMIT) parsed.clear();
	parsed.set(value, frozen);
	return frozen;
}

export function mathLabelText(value: string): string {
	return parseMathLabel(value).map((s) => s.value).join('');
}

export function mathLabelGlyphLength(value: string): number {
	let n = 0;
	for (const _ of mathLabelText(value)) n += 1;
	return n;
}

export const MATH_LABEL_FONT_FAMILY = "Arial, Helvetica, 'Liberation Sans', Arimo, sans-serif";

/* Printable ASCII (32..126) Arial advances in hundredths of an em, stored as charCode - 24. */
const ASCII_ADV = '44<PPq[+99?R4944PPPPPPPPPP44RRRP~[[``[Uf`4J[Pk`f[f`[U`[v[[U444GP9PPJPP4PP..J.kPPPP9J4PJ`JJJ929R';
const SYMBOL_ADVANCE: Readonly<Record<string, number>> = {
	Δ: 67, '·': 33, '∞': 71, λ: 50, Ω: 75, ω: 78, φ: 65, π: 69, Σ: 62, '→': 100, σ: 62, '°': 40, '²': 33, '³': 33, '⊕': 72, '⟩': 37, '⟨': 37, '—': 100, '…': 100
};
const BOLD_FACTOR = 1.043;
const SPECIAL_MATH = /[\\_^}{]/;

function advance(ch: string, cp: number): number {
	const sym = SYMBOL_ADVANCE[ch];
	if (sym !== undefined) return sym / 100;
	if (
		(cp >= 0x0300 && cp <= 0x036f) ||
		(cp >= 0x1ab0 && cp <= 0x1aff) ||
		(cp >= 0x1dc0 && cp <= 0x1dff) ||
		(cp >= 0xfe00 && cp <= 0xfe0f) ||
		(cp >= 0xfe20 && cp <= 0xfe2f) ||
		cp === 0x200d
	) return 0;
	if (
		cp >= 0x1100 &&
		(cp <= 0x115f || (cp >= 0x2329 && cp <= 0x232a) || (cp >= 0x2e80 && cp <= 0xa4cf) || (cp >= 0xac00 && cp <= 0xd7a3) || (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xfe10 && cp <= 0xfe6f) || (cp >= 0xff00 && cp <= 0xff60) || (cp >= 0x1f300 && cp <= 0x1faff))
	) return 1;
	const base = ch.normalize('NFD').charCodeAt(0);
	return base >= 32 && base < 127 ? (ASCII_ADV.charCodeAt(base - 32) - 24) / 100 : 0.56;
}

function measure(text: string): number {
	let sum = 0;
	let ascii = 0;
	for (let i = 0; i < text.length; ) {
		const cp = text.charCodeAt(i);
		if (cp >= 32 && cp < 127) {
			ascii += ASCII_ADV.charCodeAt(cp - 32) - 24;
			i += 1;
		} else {
			const full = text.codePointAt(i)!;
			const step = full > 0xffff ? 2 : 1;
			sum += advance(text.slice(i, i + step), full);
			i += step;
		}
	}
	return sum + ascii / 100;
}

export function mathLabelTextWidthAt(value: string, fontSize: number, bold = false): number {
	let em = 0;
	if (!SPECIAL_MATH.test(value)) {
		em = measure(value);
	} else {
		for (const seg of parseMathLabel(value)) {
			const scale = seg.fontScale ?? (seg.kind === 'text' ? 1 : 0.7);
			em += measure(seg.value) * scale;
		}
	}
	return fromMilli(toMilli(em * fontSize * (bold ? BOLD_FACTOR : 1)));
}

export function mathLabelTextWidth(value: string, cellAdvance = 7): number {
	return mathLabelTextWidthAt(value, (cellAdvance * 12) / 7);
}

export function renderMathLabelTspans(value: string): string {
	if (!SPECIAL_MATH.test(value)) return escapeXml(value);
	const segments = parseMathLabel(value);
	if (segments.length === 1 && segments[0]!.kind === 'text' && segments[0]!.value === value) return escapeXml(value);
	let prevShift = 0;
	let markup = '';
	for (const seg of segments) {
		const shift = seg.baselineShiftEm ?? defaultShift(seg.kind);
		const scale = seg.fontScale ?? (seg.kind === 'text' ? 1 : 0.7);
		markup += `<tspan dy="${Number(((shift - prevShift) / scale).toFixed(4))}em" font-size="${Number((scale * 100).toFixed(2))}%">${escapeXml(seg.value)}</tspan>`;
		prevShift = shift;
	}
	if (prevShift !== 0) markup += `<tspan dy="${Number((-prevShift).toFixed(4))}em" font-size="100%"></tspan>`;
	return markup;
}
