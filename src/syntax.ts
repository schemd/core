/**
 * Lexical layer of the DSL.
 *
 * Every declaration is one line, read by the same anchored patterns 0.x used,
 * so a document that compiled before is read the same way by construction. The
 * `d` flag makes each match report where its groups sit, which is what lets a
 * diagnostic point at a column instead of a line. Each pattern is anchored,
 * and the placement clause is consumed one bounded relation at a time, so no
 * pattern repeats an alternation over an unanchored tail.
 *
 * @module
 */
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

/** A token's text and its zero-based column range on the trimmed line. */
export interface Token {
	readonly text: string;
	readonly start: number;
	readonly end: number;
}

/** A component declared `kind:ID "label" at (x, y) tail`; the label may be left out. */
export interface AbsoluteComponentSyntax {
	readonly form: 'absolute';
	readonly kind: Token;
	readonly id: Token;
	readonly label: Token | undefined;
	readonly x: Token;
	readonly y: Token;
	readonly tail: Token;
}

/** A component declared by relation: `kind:ID "label" right-of REF by N tail`; the label may be left out. */
export interface RelativeComponentSyntax {
	readonly form: 'relative';
	readonly kind: Token;
	readonly id: Token;
	readonly label: Token | undefined;
	readonly relations: readonly SchematicPlacementRelation[];
	/** Where each relation's reference — `REF` or `REF.port` — sits on the line. */
	readonly references: readonly Token[];
	readonly tail: Token;
}

/**
 * A component declared with no position: `kind:ID "label" tail`. The draft
 * placement pass gives it one from its wires.
 */
export interface UnplacedComponentSyntax {
	readonly form: 'unplaced';
	readonly kind: Token;
	readonly id: Token;
	readonly label: Token | undefined;
	readonly tail: Token;
}

/** `A.port -> B.port tail`. */
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
const DECIMAL = '-?\\d+(?:\\.\\d+)?';
const COMPONENT = new RegExp(`^(${ID}):(${ID})(?:\\s+"([^"]+)")?\\s+at\\s+\\((${DECIMAL}),\\s*(${DECIMAL})\\)\\s+(.+)$`, 'd');
const HEAD = new RegExp(`^(${ID}):(${ID})(?:\\s+"([^"]+)")?\\s+(.+)$`, 'd');
const CONNECTION = new RegExp(`^(${ID})\\.(${PORT})\\s*->\\s*(${ID})\\.(${PORT})\\s+(.+)$`, 'd');
/* One relation each, sticky so it matches exactly where the last one ended. */
const DIRECTION = new RegExp(`(right-of|left-of|above|below)\\s+(${ID})(?:\\.(${PORT}))?(?:\\s+by\\s+(${DECIMAL}))?(?:\\s+|$)`, 'yd');
const ALIGNMENT = new RegExp(`(aligned-x|aligned-y)\\s+with\\s+(${ID})(?:\\.(${PORT}))?(?:\\s+at\\s+(${PORT}))?(?:\\s+|$)`, 'yd');

/*
 * A declaration with no position is `kind:ID "label"` and then exactly what
 * follows a position in the other two forms: one colour, an option block, or
 * both. Anything else after the head — a placement clause that did not scan,
 * an empty label — stays an unrecognized declaration, as it always was.
 */
const PLACEMENT_WORD = /^(?:at|by|with|right-of|left-of|above|below|aligned-x|aligned-y)(?:\s|$)/;
const UNPLACED_TAIL = /^(?:\[|(?:#[A-Za-z0-9_-]+|[A-Za-z]+\([^()]*\)|[A-Za-z][A-Za-z0-9_-]*)(?:\s+\[|\s*$))/;

const SPACE = /\s/;

const token = (match: RegExpExecArray, group: number): Token => {
	const [start, end] = match.indices![group]!;
	return { text: match[group]!, start, end };
};

/* The label is the one optional group a declaration has. */
const optional = (match: RegExpExecArray, group: number): Token | undefined => (match[group] === undefined ? undefined : token(match, group));

/** Consume a placement clause relation by relation from `start`; whatever is left is the tail. */
function placement(text: string, start: number): { relations: SchematicPlacementRelation[]; references: Token[]; tail: number } {
	const relations: SchematicPlacementRelation[] = [];
	const references: Token[] = [];
	/* `REF` or `REF.port`: from the reference group to the end of the port group, if any. */
	const reference = (match: RegExpExecArray): Token => {
		const start = match.indices![2]![0];
		const end = (match.indices![3] ?? match.indices![2]!)[1];
		return { text: text.slice(start, end), start, end };
	};
	let cursor = start;
	for (;;) {
		DIRECTION.lastIndex = cursor;
		const direction = DIRECTION.exec(text);
		if (direction !== null) {
			relations.push({
				kind: direction[1] as SchematicPlacementRelation['kind'],
				ref: direction[2]!,
				...(direction[3] === undefined ? {} : { port: direction[3] }),
				...(direction[4] === undefined ? {} : { gap: Number(direction[4]) })
			});
			references.push(reference(direction));
			cursor = DIRECTION.lastIndex;
			continue;
		}
		ALIGNMENT.lastIndex = cursor;
		const alignment = ALIGNMENT.exec(text);
		if (alignment === null) return { relations, references, tail: cursor };
		relations.push({
			kind: alignment[1] as SchematicPlacementRelation['kind'],
			ref: alignment[2]!,
			...(alignment[3] === undefined ? {} : { port: alignment[3] }),
			...(alignment[4] === undefined ? {} : { at: alignment[4] })
		});
		references.push(reference(alignment));
		cursor = ALIGNMENT.lastIndex;
	}
}

/**
 * Classify one trimmed, non-comment line.
 *
 * Tried in the order 0.x tried its patterns: an absolute component, then a
 * relative one (which needs at least one relation and a tail), then a
 * component with no position, then a connection. `undefined` is an
 * unrecognized declaration.
 */
export function scanDeclaration(text: string): DeclarationSyntax | undefined {
	const component = COMPONENT.exec(text);
	if (component !== null) {
		return { form: 'absolute', kind: token(component, 1), id: token(component, 2), label: optional(component, 3), x: token(component, 4), y: token(component, 5), tail: token(component, 6) };
	}
	const head = HEAD.exec(text);
	if (head !== null) {
		const clause = placement(text, head.indices![4]![0]);
		if (clause.relations.length > 0 && clause.tail < text.length) {
			return {
				form: 'relative',
				kind: token(head, 1),
				id: token(head, 2),
				label: optional(head, 3),
				relations: clause.relations,
				references: clause.references,
				tail: { text: text.slice(clause.tail), start: clause.tail, end: text.length }
			};
		}
		if (clause.relations.length === 0 && UNPLACED_TAIL.test(head[4]!) && !PLACEMENT_WORD.test(head[4]!)) {
			return { form: 'unplaced', kind: token(head, 1), id: token(head, 2), label: optional(head, 3), tail: token(head, 4) };
		}
	}
	const connection = CONNECTION.exec(text);
	if (connection === null) return undefined;
	return { form: 'connection', fromId: token(connection, 1), fromPort: token(connection, 2), toId: token(connection, 3), toPort: token(connection, 4), tail: token(connection, 5) };
}

/* ---- declaration tails: colour and bracketed options ---- */

/** A declaration tail split into its paint and its option block. */
export interface DeclarationTail {
	readonly color: string;
	readonly options: string | undefined;
}

/** Split a tail without misreading brackets inside CSS functions or quotes. */
export function splitDeclarationTail(raw: string, line: number, allowMissingColor = false): DeclarationTail {
	const source = raw.trim();
	let quoteOpen = false;
	let parentheses = 0;
	let optionsStart = -1;
	let optionsEnd = -1;
	for (let index = 0; index < source.length; index += 1) {
		const character = source[index]!;
		if (character === '"') {
			quoteOpen = !quoteOpen;
			continue;
		}
		if (quoteOpen) continue;
		if (character === '(') {
			parentheses += 1;
			continue;
		}
		if (character === ')') {
			parentheses -= 1;
			if (parentheses < 0) throw new SchematicSyntaxError('Malformed declaration tail.', line);
			continue;
		}
		if (character === '[' && parentheses === 0) {
			if (optionsStart >= 0 || (index > 0 && !SPACE.test(source.charAt(index - 1)))) {
				throw new SchematicSyntaxError('Malformed declaration options.', line);
			}
			optionsStart = index;
			continue;
		}
		if (character === ']' && parentheses === 0) {
			if (optionsStart < 0 || optionsEnd >= 0) throw new SchematicSyntaxError('Malformed declaration options.', line);
			optionsEnd = index;
		}
	}
	if (quoteOpen || parentheses !== 0) throw new SchematicSyntaxError('Malformed declaration tail.', line);
	if (optionsStart < 0) return { color: source, options: undefined };
	if (optionsEnd < optionsStart || source.slice(optionsEnd + 1).trim() !== '') {
		throw new SchematicSyntaxError('Malformed declaration options.', line);
	}
	const color = source.slice(0, optionsStart).trim();
	if (color === '' && !allowMissingColor) throw new SchematicSyntaxError('A declaration color is required.', line);
	return { color, options: source.slice(optionsStart + 1, optionsEnd) };
}

/** Whitespace-separated `key=value` component options; quoted values may hold spaces. */
export function parseAttributes(raw: string | undefined, line: number): ReadonlyMap<string, string> {
	const attributes = new Map<string, string>();
	if (raw === undefined) return attributes;
	const malformed = () => new SchematicSyntaxError('Malformed component options.', line, undefined, 'option');
	if (raw.trim() === '') throw malformed();
	const source = raw.trim();
	let cursor = 0;
	while (cursor < source.length) {
		if (cursor > 0) {
			if (!SPACE.test(source.charAt(cursor))) throw malformed();
			while (cursor < source.length && SPACE.test(source.charAt(cursor))) cursor += 1;
		}
		const keyStart = cursor;
		const first = source.charCodeAt(cursor);
		if (first < 97 || first > 122) throw malformed();
		cursor += 1;
		while (cursor < source.length) {
			const code = source.charCodeAt(cursor);
			if (!((code >= 97 && code <= 122) || (code >= 48 && code <= 57) || code === 45)) break;
			cursor += 1;
		}
		if (source[cursor] !== '=') throw malformed();
		const key = source.slice(keyStart, cursor);
		cursor += 1;
		let value: string;
		if (source[cursor] === '"') {
			const valueStart = ++cursor;
			while (cursor < source.length && source[cursor] !== '"') cursor += 1;
			/* v8 ignore next -- splitDeclarationTail rejects unbalanced quotes first. */
			if (cursor === source.length) throw malformed();
			value = source.slice(valueStart, cursor);
			cursor += 1;
		} else {
			const valueStart = cursor;
			while (cursor < source.length && !SPACE.test(source.charAt(cursor))) cursor += 1;
			if (cursor === valueStart) throw malformed();
			value = source.slice(valueStart, cursor);
		}
		if (attributes.has(key)) throw new SchematicSyntaxError(`Duplicate option ${key}.`, line, undefined, 'option');
		attributes.set(key, value);
	}
	return attributes;
}

/* ---- colours ---- */

const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)$/;
const ANGLE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:deg|grad|rad|turn)?$/i;
const ALIAS = /^[a-z][a-z0-9-]{0,63}$/i;

function ranged(value: string, minimum: number, maximum: number, allowPercent: boolean): boolean {
	const percent = allowPercent && value.endsWith('%');
	const numeric = percent ? value.slice(0, -1) : value;
	if (!NUMBER.test(numeric)) return false;
	const parsed = Number(numeric);
	return parsed >= minimum && parsed <= (percent ? 100 : maximum);
}

function functional(name: string, body: string, valid: (channels: readonly string[]) => boolean): string | undefined {
	const comma = body.includes(',');
	const slash = body.split('/').map((part) => part.trim());
	if (slash.length > 2 || (comma && slash.length > 1)) return undefined;
	const parsed = comma ? slash[0]!.split(',').map((part) => part.trim()) : slash[0]!.split(/\s+/);
	const legacyAlpha = comma && parsed.length === 4 ? parsed[3] : undefined;
	const channels = legacyAlpha === undefined ? parsed : parsed.slice(0, 3);
	const alpha = slash.at(1) ?? legacyAlpha;
	if (channels.length !== 3 || !valid(channels) || (alpha !== undefined && !ranged(alpha, 0, 1, true))) return undefined;
	return `${name}(${channels.join(' ')}${alpha === undefined ? '' : ` / ${alpha}`})`;
}

/**
 * Parse a theme token, safe CSS literal, or custom theme alias.
 *
 * @throws {SchematicSyntaxError} For malformed, out-of-range, or unsafe colours.
 */
export function parseSchematicColor(input: string, line = 1): SchematicColor {
	const value = input.trim();
	const candidate = (value.startsWith('#') ? value.slice(1) : value).toLowerCase();
	if (includesValue(SEMANTIC_COLORS, candidate)) return { kind: 'token', value: candidate };
	if (/^#[A-Fa-f0-9]+$/.test(value)) {
		if (![4, 5, 7, 9].includes(value.length)) throw new SchematicSyntaxError('Hex colors require 3, 4, 6, or 8 digits.', line, undefined, 'option');
		return { kind: 'css', value: value.toLowerCase() };
	}
	const call = /^(rgb|rgba|hsl|hsla)\((.*)\)$/i.exec(value);
	if (call !== null) {
		const name = call[1]!.toLowerCase();
		const normalized = name.startsWith('rgb')
			? functional('rgb', call[2]!, (channels) => channels.every((channel) => ranged(channel, 0, 255, true)))
			: functional(
					'hsl',
					call[2]!,
					([hue, saturation, lightness]) =>
						ANGLE.test(hue!) && saturation!.endsWith('%') && ranged(saturation!, 0, 100, true) && lightness!.endsWith('%') && ranged(lightness!, 0, 100, true)
				);
		if (!normalized) throw new SchematicSyntaxError(`Invalid ${name} color.`, line, undefined, 'option');
		return { kind: 'css', value: normalized };
	}
	const alias = value.startsWith('#') ? value.slice(1) : value;
	if (ALIAS.test(alias)) return { kind: 'alias', value: alias.toLowerCase() };
	throw new SchematicSyntaxError('Unsafe or unsupported color expression.', line, undefined, 'option');
}

/* ---- connection options ---- */

/** Normalized routing, marker, relation and topology options of one connection. */
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

/** Split options on whitespace outside quotes. */
export function optionTokens(raw: string, line: number): readonly string[] {
	const tokens: string[] = [];
	let tokenStart = -1;
	let quoteOpen = false;
	for (let index = 0; index <= raw.length; index += 1) {
		const character = raw[index];
		if (character === '"') quoteOpen = !quoteOpen;
		const space = character !== undefined && SPACE.test(raw.charAt(index));
		if ((character === undefined || (space && !quoteOpen)) && tokenStart >= 0) {
			tokens.push(raw.slice(tokenStart, index));
			tokenStart = -1;
		} else if (character !== undefined && !space && tokenStart < 0) {
			tokenStart = index;
		}
	}
	/* v8 ignore next -- splitDeclarationTail rejects unbalanced quotes before tokenization. */
	if (quoteOpen) throw new SchematicSyntaxError('Malformed quoted connection option.', line, undefined, 'option');
	return tokens;
}

const OPEN_ENDED = new Set(['dependency', 'message', 'asynchronous', 'return', 'control-flow', 'object-flow', 'transition', 'include', 'extend']);

/** Parse a connection's option block without duplicate declarations. */
export function parseConnectionOptions(raw: string | undefined, line: number): ConnectionOptions {
	const options: ConnectionOptions = {
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
	const fail = (message: string) => new SchematicSyntaxError(message, line, undefined, 'option');
	const seen = new Set<string>();
	if (raw !== undefined && raw.trim() !== '') {
		for (const token of optionTokens(raw.trim(), line)) {
			if (token === 'line' || token === 'bezier' || token === 'ortho') {
				if (seen.has('curve')) throw fail('Connection routing can only be declared once.');
				options.curve = token;
				seen.add('curve');
				continue;
			}
			if (token === 'dashed' || token === 'solid') {
				if (seen.has('stroke-style')) throw fail('Connection stroke style can only be declared once.');
				options.dashed = token === 'dashed';
				seen.add('stroke-style');
				continue;
			}
			if (includesValue(UML_RELATION_KINDS, token)) {
				if (seen.has('relation')) throw fail('Connection relation can only be declared once.');
				options.relation = token;
				seen.add('relation');
				continue;
			}
			if (includesValue(SCHEMATIC_SIGNAL_KINDS, token)) {
				if (seen.has('signal')) throw fail('Connection signal kind can only be declared once.');
				options.signalKind = token;
				seen.add('signal');
				continue;
			}
			if (token === 'trunk') {
				if (options.trunk) throw fail('Connection trunk can only be declared once.');
				options.trunk = true;
				continue;
			}
			if (token === 'arrow' || token === 'dot') {
				if (seen.has('marker-end')) throw fail('Connection marker-end can only be declared once.');
				options.markerEnd = token;
				seen.add('marker-end');
				continue;
			}
			const match = /^(marker-start|marker-end|relation|label|signal|net|width)=(.*)$/.exec(token);
			if (match === null) throw fail('Unsupported connection routing, topology, marker, relation, label, or stroke option.');
			const option = match[1]!;
			if (seen.has(option)) throw fail(`Connection ${option} can only be declared once.`);
			let value = match[2]!;
			if (value.startsWith('"') || value.endsWith('"')) {
				if (!(value.length >= 2 && value.startsWith('"') && value.endsWith('"'))) throw fail(`Malformed connection ${option}.`);
				value = value.slice(1, -1);
			}
			if (option === 'relation') {
				if (!includesValue(UML_RELATION_KINDS, value)) throw fail(`relation must be one of: ${UML_RELATION_KINDS.join(', ')}.`);
				options.relation = value;
			} else if (option === 'label') {
				if (value === '' || value.length > 256) throw fail('Connection labels require 1 through 256 characters.');
				options.label = value;
			} else if (option === 'signal') {
				if (!includesValue(SCHEMATIC_SIGNAL_KINDS, value)) throw fail(`signal must be one of: ${SCHEMATIC_SIGNAL_KINDS.join(', ')}.`);
				options.signalKind = value;
			} else if (option === 'net') {
				if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value)) {
					throw fail('net must begin with a letter and contain at most 64 letters, digits, underscores, or hyphens.');
				}
				options.net = value;
			} else if (option === 'width') {
				if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 256) throw fail('width must be an integer from 1 through 256.');
				options.width = Number(value);
			} else {
				if (!includesValue(SCHEMATIC_SIGNAL_MARKERS, value)) throw fail(`${option} must be one of: ${SCHEMATIC_SIGNAL_MARKERS.join(', ')}.`);
				if (option === 'marker-start') options.markerStart = value;
				else options.markerEnd = value;
			}
			seen.add(option);
		}
	}
	if (!seen.has('marker-start')) {
		if (options.relation === 'aggregation') options.markerStart = 'diamond';
		else if (options.relation === 'composition') options.markerStart = 'diamond-filled';
	}
	if (!seen.has('marker-end')) {
		if (options.relation === 'generalization' || options.relation === 'realization') options.markerEnd = 'triangle';
		else if (OPEN_ENDED.has(options.relation)) options.markerEnd = 'open-arrow';
		else if (options.relation === 'synchronous') options.markerEnd = 'arrow';
	}
	if (!seen.has('stroke-style')) options.dashed = ['dependency', 'realization', 'return', 'include', 'extend'].includes(options.relation);
	if (options.label === undefined && (options.relation === 'include' || options.relation === 'extend')) options.label = `«${options.relation}»`;
	return options;
}
