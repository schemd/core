import {
	SEMANTIC_COLORS,
	SCHEMATIC_SIGNAL_KINDS,
	SCHEMATIC_SIGNAL_MARKERS,
	SchematicSyntaxError,
	UML_RELATION_KINDS,
	type SchematicColor,
	type SchematicPlacementRelation,
	type SchematicRelationKind,
	type SchematicSignalKind,
	type SchematicSignalMarker
} from './types.js';
import { includesValue } from './symbols/common.js';

export interface Token {
	readonly text: string;
	readonly start: number;
	readonly end: number;
}

export interface AbsoluteComponentSyntax {
	readonly form: 'absolute';
	readonly kind: Token;
	readonly id: Token;
	readonly label: Token | undefined;
	readonly x: Token;
	readonly y: Token;
	readonly tail: Token;
}

export interface RelativeComponentSyntax {
	readonly form: 'relative';
	readonly kind: Token;
	readonly id: Token;
	readonly label: Token | undefined;
	readonly relations: readonly SchematicPlacementRelation[];
	readonly references: readonly Token[];
	readonly tail: Token;
}

export interface UnplacedComponentSyntax {
	readonly form: 'unplaced';
	readonly kind: Token;
	readonly id: Token;
	readonly label: Token | undefined;
	readonly tail: Token;
}

export interface ConnectionSyntax {
	readonly form: 'connection';
	readonly fromId: Token;
	readonly fromPort: Token;
	readonly toId: Token;
	readonly toPort: Token;
	readonly tail: Token;
}

export type DeclarationSyntax = AbsoluteComponentSyntax | RelativeComponentSyntax | UnplacedComponentSyntax | ConnectionSyntax;

const ID = '[A-Za-z][A-Za-z0-9_-]*';
const PORT = '[A-Za-z][A-Za-z0-9_+-]*';
const DEC = '-?\\d+(?:\\.\\d+)?';
const COMP_SRC = `^(${ID}):(${ID})(?:\\s+"([^"]+)")?\\s+at\\s+\\((${DEC}),\\s*(${DEC})\\)\\s+(.+)$`;
const CONN_SRC = `^(${ID})\\.(${PORT})\\s*->\\s*(${ID})\\.(${PORT})\\s+(.+)$`;
const COMP_FAST = new RegExp(COMP_SRC);
const CONN_FAST = new RegExp(CONN_SRC);
const COMPONENT = new RegExp(COMP_SRC, 'd');
const HEAD = new RegExp(`^(${ID}):(${ID})(?:\\s+"([^"]+)")?\\s+(.+)$`, 'd');
const CONNECTION = new RegExp(CONN_SRC, 'd');
const DIRECTION = new RegExp(`(right-of|left-of|above|below)\\s+(${ID})(?:\\.(${PORT}))?(?:\\s+by\\s+(${DEC}))?(?:\\s+|$)`, 'yd');
const ALIGNMENT = new RegExp(`(aligned-x|aligned-y)\\s+with\\s+(${ID})(?:\\.(${PORT}))?(?:\\s+at\\s+(${PORT}))?(?:\\s+|$)`, 'yd');
const PLACEMENT_WORD = /^(?:at|by|with|right-of|left-of|above|below|aligned-x|aligned-y)(?:\s|$)/;
const UNPLACED_TAIL = /^(?:\[|(?:#[A-Za-z0-9_-]+|[A-Za-z]+\([^()]*\)|[A-Za-z][A-Za-z0-9_-]*)(?:\s+\[|\s*$))/;

const SPACE = /\s/;
const isSpace = (s: string, i: number): boolean => s.charCodeAt(i) === 32 || SPACE.test(s[i]!);
const tok = (m: RegExpExecArray, g: number): Token => {
	const idx = m.indices?.[g];
	return { text: m[g]!, start: idx ? idx[0] : 0, end: idx ? idx[1] : 0 };
};
const optTok = (m: RegExpExecArray, g: number): Token | undefined => (m[g] === undefined ? undefined : tok(m, g));

export function scanDeclaration(text: string, spans = true): DeclarationSyntax | undefined {
	const c = (spans ? COMPONENT : COMP_FAST).exec(text);
	if (c !== null) return { form: 'absolute', kind: tok(c, 1), id: tok(c, 2), label: optTok(c, 3), x: tok(c, 4), y: tok(c, 5), tail: tok(c, 6) };
	const head = HEAD.exec(text);
	if (head !== null) {
		const relations: SchematicPlacementRelation[] = [];
		const references: Token[] = [];
		const refTok = (m: RegExpExecArray): Token => {
			const s = m.indices![2]![0];
			const e = (m.indices![3] ?? m.indices![2]!)[1];
			return { text: text.slice(s, e), start: s, end: e };
		};
		let cur = head.indices![4]![0];
		for (;;) {
			DIRECTION.lastIndex = cur;
			const d = DIRECTION.exec(text);
			if (d !== null) {
				relations.push({
					kind: d[1] as SchematicPlacementRelation['kind'],
					ref: d[2]!,
					...(d[3] === undefined ? {} : { port: d[3] }),
					...(d[4] === undefined ? {} : { gap: Number(d[4]) })
				});
				references.push(refTok(d));
				cur = DIRECTION.lastIndex;
				continue;
			}
			ALIGNMENT.lastIndex = cur;
			const a = ALIGNMENT.exec(text);
			if (a === null) break;
			relations.push({
				kind: a[1] as SchematicPlacementRelation['kind'],
				ref: a[2]!,
				...(a[3] === undefined ? {} : { port: a[3] }),
				...(a[4] === undefined ? {} : { at: a[4] })
			});
			references.push(refTok(a));
			cur = ALIGNMENT.lastIndex;
		}
		if (relations.length > 0 && cur < text.length) {
			return {
				form: 'relative',
				kind: tok(head, 1),
				id: tok(head, 2),
				label: optTok(head, 3),
				relations,
				references,
				tail: { text: text.slice(cur), start: cur, end: text.length }
			};
		}
		if (relations.length === 0 && UNPLACED_TAIL.test(head[4]!) && !PLACEMENT_WORD.test(head[4]!)) {
			return { form: 'unplaced', kind: tok(head, 1), id: tok(head, 2), label: optTok(head, 3), tail: tok(head, 4) };
		}
	}
	const cn = (spans ? CONNECTION : CONN_FAST).exec(text);
	return cn === null ? undefined : { form: 'connection', fromId: tok(cn, 1), fromPort: tok(cn, 2), toId: tok(cn, 3), toPort: tok(cn, 4), tail: tok(cn, 5) };
}

export interface DeclarationTail {
	readonly color: string;
	readonly options: string | undefined;
}

export function splitDeclarationTail(raw: string, line: number, allowMissingColor = false): DeclarationTail {
	const src = raw.trim();
	let quote = false;
	let parens = 0;
	let start = -1;
	let end = -1;
	for (let i = 0; i < src.length; i += 1) {
		const ch = src.charCodeAt(i);
		if (ch === 34) {
			quote = !quote;
			continue;
		}
		if (quote) continue;
		if (ch === 40) parens += 1;
		else if (ch === 41) {
			if (--parens < 0) throw new SchematicSyntaxError('Malformed declaration tail.', line);
		} else if (ch === 91 && parens === 0) {
			if (start >= 0 || (i > 0 && !isSpace(src, i - 1))) throw new SchematicSyntaxError('Malformed declaration options.', line);
			start = i;
		} else if (ch === 93 && parens === 0) {
			if (start < 0 || end >= 0) throw new SchematicSyntaxError('Malformed declaration options.', line);
			end = i;
		}
	}
	if (quote || parens !== 0) throw new SchematicSyntaxError('Malformed declaration tail.', line);
	if (start < 0) return { color: src, options: undefined };
	if (end < start || src.slice(end + 1).trim() !== '') throw new SchematicSyntaxError('Malformed declaration options.', line);
	const color = src.slice(0, start).trim();
	if (color === '' && !allowMissingColor) throw new SchematicSyntaxError('A declaration color is required.', line);
	return { color, options: src.slice(start + 1, end) };
}

const EMPTY_ATTRS: ReadonlyMap<string, string> = new Map();

export function parseAttributes(raw: string | undefined, line: number): ReadonlyMap<string, string> {
	if (raw === undefined) return EMPTY_ATTRS;
	const attrs = new Map<string, string>();
	const bad = () => new SchematicSyntaxError('Malformed component options.', line, undefined, 'option');
	const src = raw.trim();
	if (src === '') throw bad();
	let i = 0;
	const len = src.length;
	while (i < len) {
		if (i > 0) {
			if (!isSpace(src, i)) throw bad();
			while (i < len && isSpace(src, i)) i += 1;
		}
		const ks = i;
		const c0 = src.charCodeAt(i);
		if (c0 < 97 || c0 > 122) throw bad();
		i += 1;
		while (i < len) {
			const c = src.charCodeAt(i);
			if (!((c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 45)) break;
			i += 1;
		}
		if (src.charCodeAt(i) !== 61) throw bad();
		const key = src.slice(ks, i++);
		let val: string;
		if (src.charCodeAt(i) === 34) {
			const vs = ++i;
			while (i < len && src.charCodeAt(i) !== 34) i += 1;
			/* v8 ignore next -- splitDeclarationTail rejects unbalanced quotes first. */
			if (i === len) throw bad();
			val = src.slice(vs, i++);
		} else {
			const vs = i;
			while (i < len && !isSpace(src, i)) i += 1;
			if (i === vs) throw bad();
			val = src.slice(vs, i);
		}
		if (attrs.has(key)) throw new SchematicSyntaxError(`Duplicate option ${key}.`, line, undefined, 'option');
		attrs.set(key, val);
	}
	return attrs;
}

const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)$/;
const ANGLE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:deg|grad|rad|turn)?$/i;
const ALIAS = /^[a-z][a-z0-9-]{0,63}$/i;
const SEMANTIC_MAP = new Map<string, SchematicColor>(
	SEMANTIC_COLORS.map((value) => [value, Object.freeze({ kind: 'token' as const, value })])
);

function ranged(value: string, min: number, max: number): boolean {
	const pct = value.endsWith('%');
	const num = pct ? value.slice(0, -1) : value;
	if (!NUMBER.test(num)) return false;
	const v = Number(num);
	return v >= min && v <= (pct ? 100 : max);
}

function functional(name: string, body: string, valid: (ch: readonly string[]) => boolean): string | undefined {
	const comma = body.includes(',');
	const slash = body.split('/').map((p) => p.trim());
	if (slash.length > 2 || (comma && slash.length > 1)) return undefined;
	const parsed = comma ? slash[0]!.split(',').map((p) => p.trim()) : slash[0]!.split(/\s+/);
	const legacy = comma && parsed.length === 4 ? parsed[3] : undefined;
	const ch = legacy === undefined ? parsed : parsed.slice(0, 3);
	const alpha = slash[1] ?? legacy;
	if (ch.length !== 3 || !valid(ch) || (alpha !== undefined && !ranged(alpha, 0, 1))) return undefined;
	return `${name}(${ch.join(' ')}${alpha === undefined ? '' : ` / ${alpha}`})`;
}

export function parseSchematicColor(input: string, line = 1): SchematicColor {
	const value = input.trim();
	const raw = value.charCodeAt(0) === 35 ? value.slice(1) : value;
	const token = SEMANTIC_MAP.get(raw) ?? SEMANTIC_MAP.get(raw.toLowerCase());
	if (token !== undefined) return token;
	const cand = raw.toLowerCase();
	if (/^#[A-Fa-f0-9]+$/.test(value)) {
		if (![4, 5, 7, 9].includes(value.length)) throw new SchematicSyntaxError('Hex colors require 3, 4, 6, or 8 digits.', line, undefined, 'option');
		return { kind: 'css', value: value.toLowerCase() };
	}
	const call = /^(rgb|rgba|hsl|hsla)\((.*)\)$/i.exec(value);
	if (call !== null) {
		const name = call[1]!.toLowerCase();
		const norm = name.startsWith('rgb')
			? functional('rgb', call[2]!, (ch) => ch.every((c) => ranged(c, 0, 255)))
			: functional('hsl', call[2]!, ([h, s, l]) => ANGLE.test(h!) && s!.endsWith('%') && ranged(s!, 0, 100) && l!.endsWith('%') && ranged(l!, 0, 100));
		if (!norm) throw new SchematicSyntaxError(`Invalid ${name} color.`, line, undefined, 'option');
		return { kind: 'css', value: norm };
	}
	if (ALIAS.test(raw)) return { kind: 'alias', value: cand };
	throw new SchematicSyntaxError('Unsafe or unsupported color expression.', line, undefined, 'option');
}

export interface ConnectionOptions {
	curve: 'line' | 'bezier' | 'ortho';
	markerStart: SchematicSignalMarker;
	markerEnd: SchematicSignalMarker;
	relation: SchematicRelationKind;
	label: string | undefined;
	dashed: boolean;
	signalKind: SchematicSignalKind | undefined;
	net: string | undefined;
	width: number | undefined;
	trunk: boolean;
}

export function optionTokens(raw: string, line: number): readonly string[] {
	const tokens: string[] = [];
	let start = -1;
	let quote = false;
	for (let i = 0; i <= raw.length; i += 1) {
		const ch = raw[i];
		if (ch === '"') quote = !quote;
		const sp = ch !== undefined && SPACE.test(ch);
		if ((ch === undefined || (sp && !quote)) && start >= 0) {
			tokens.push(raw.slice(start, i));
			start = -1;
		} else if (ch !== undefined && !sp && start < 0) start = i;
	}
	/* v8 ignore next -- splitDeclarationTail rejects unbalanced quotes before tokenization. */
	if (quote) throw new SchematicSyntaxError('Malformed quoted connection option.', line, undefined, 'option');
	return tokens;
}

const OPEN_ENDED = new Set(['dependency', 'message', 'asynchronous', 'return', 'control-flow', 'object-flow', 'transition', 'include', 'extend']);
const DASHED_REL = new Set(['dependency', 'realization', 'return', 'include', 'extend']);

export function parseConnectionOptions(raw: string | undefined, line: number): ConnectionOptions {
	const opts: ConnectionOptions = {
		curve: 'line',
		markerStart: 'none',
		markerEnd: 'none',
		relation: 'signal',
		label: undefined,
		dashed: false,
		signalKind: undefined,
		net: undefined,
		width: undefined,
		trunk: false
	};
	if (raw === undefined || raw === 'line' || raw === 'ortho' || raw === 'bezier') {
		if (raw !== undefined) opts.curve = raw;
		return opts;
	}
	const fail = (msg: string) => new SchematicSyntaxError(msg, line, undefined, 'option');
	const seen = new Set<string>();
	const once = (key: string, label: string) => {
		if (seen.has(key)) throw fail(`Connection ${label} can only be declared once.`);
		seen.add(key);
	};
	const trimmed = raw.trim();
	if (trimmed !== '') {
		for (const token of optionTokens(trimmed, line)) {
			if (token === 'line' || token === 'bezier' || token === 'ortho') {
				once('curve', 'routing');
				opts.curve = token;
			} else if (token === 'dashed' || token === 'solid') {
				once('stroke-style', 'stroke style');
				opts.dashed = token === 'dashed';
			} else if (includesValue(UML_RELATION_KINDS, token)) {
				once('relation', 'relation');
				opts.relation = token;
			} else if (includesValue(SCHEMATIC_SIGNAL_KINDS, token)) {
				once('signal', 'signal kind');
				opts.signalKind = token;
			} else if (token === 'trunk') {
				once('trunk', 'trunk');
				opts.trunk = true;
			} else if (token === 'arrow' || token === 'dot') {
				once('marker-end', 'marker-end');
				opts.markerEnd = token;
			} else {
				const m = /^(marker-start|marker-end|relation|label|signal|net|width)=(.*)$/.exec(token);
				if (m === null) throw fail('Unsupported connection routing, topology, marker, relation, label, or stroke option.');
				const opt = m[1]!;
				once(opt, opt);
				let val = m[2]!;
				if (val.startsWith('"') || val.endsWith('"')) {
					if (!(val.length >= 2 && val.startsWith('"') && val.endsWith('"'))) throw fail(`Malformed connection ${opt}.`);
					val = val.slice(1, -1);
				}
				if (opt === 'relation') {
					if (!includesValue(UML_RELATION_KINDS, val)) throw fail(`relation must be one of: ${UML_RELATION_KINDS.join(', ')}.`);
					opts.relation = val;
				} else if (opt === 'label') {
					if (val === '' || val.length > 256) throw fail('Connection labels require 1 through 256 characters.');
					opts.label = val;
				} else if (opt === 'signal') {
					if (!includesValue(SCHEMATIC_SIGNAL_KINDS, val)) throw fail(`signal must be one of: ${SCHEMATIC_SIGNAL_KINDS.join(', ')}.`);
					opts.signalKind = val;
				} else if (opt === 'net') {
					if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(val)) throw fail('net must begin with a letter and contain at most 64 letters, digits, underscores, or hyphens.');
					opts.net = val;
				} else if (opt === 'width') {
					if (!/^\d+$/.test(val) || Number(val) < 1 || Number(val) > 256) throw fail('width must be an integer from 1 through 256.');
					opts.width = Number(val);
				} else {
					if (!includesValue(SCHEMATIC_SIGNAL_MARKERS, val)) throw fail(`${opt} must be one of: ${SCHEMATIC_SIGNAL_MARKERS.join(', ')}.`);
					if (opt === 'marker-start') opts.markerStart = val;
					else opts.markerEnd = val;
				}
			}
		}
	}
	if (!seen.has('marker-start')) {
		if (opts.relation === 'aggregation') opts.markerStart = 'diamond';
		else if (opts.relation === 'composition') opts.markerStart = 'diamond-filled';
	}
	if (!seen.has('marker-end')) {
		if (opts.relation === 'generalization' || opts.relation === 'realization') opts.markerEnd = 'triangle';
		else if (OPEN_ENDED.has(opts.relation)) opts.markerEnd = 'open-arrow';
		else if (opts.relation === 'synchronous') opts.markerEnd = 'arrow';
	}
	if (!seen.has('stroke-style')) opts.dashed = DASHED_REL.has(opts.relation);
	if (opts.label === undefined && (opts.relation === 'include' || opts.relation === 'extend')) opts.label = `«${opts.relation}»`;
	return opts;
}
