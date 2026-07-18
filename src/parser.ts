/**
 * Bounded lexer, parser, and semantic validator for the `schemd` DSL.
 *
 * Parsing is synchronous and deterministic. This module accepts no DOM or
 * browser globals, validates all author-controlled strings before they reach
 * the SVG renderer, and records successful documents in a private provenance
 * registry so arbitrary object graphs cannot bypass the parser boundary.
 *
 * @packageDocumentation
 */
import {
	ANALOG_KINDS,
	CLASSICAL_GATE_KINDS,
	COMPONENT_KINDS,
	DIODE_TYPES,
	GROUND_STYLES,
	PASSIVE_KINDS,
	SEMANTIC_COLORS,
	SCHEMATIC_SIGNAL_MARKERS,
	TRANSISTOR_TYPES,
	UML_COMPONENT_KINDS,
	UML_RELATION_KINDS,
	SchematicSyntaxError,
	type ClassicalGateComponent,
	type ComponentKind,
	type DiodeComponent,
	type GroundComponent,
	type IcComponent,
	type IntegratedCircuitPins,
	type PortComponent,
	type QuantumGateComponent,
	type QuantumGateKind,
	type SchematicColor,
	type SchematicComponent,
	type SchematicConnection,
	type SchematicDocument,
	type SchematicEndpoint,
	type SchematicFence,
	type SchematicSignalMarker,
	type SchematicRelationKind,
	type TransistorComponent,
	type UmlClassComponent,
	type UmlSizedComponent,
	type UmlStateComponent
} from './types.js';
import { validateDocumentGeometry } from './layout.js';
import { mathLabelTextWidth } from './math-label.js';
import { cacheParsedSchematicRoutes } from './route-cache.js';
import {
	MAX_SCHEMATIC_COMPONENTS,
	MAX_SCHEMATIC_CONNECTIONS,
	MAX_SCHEMATIC_SOURCE_CHARACTERS
} from './limits.js';

/** Lexical shape of a complete component declaration line. */
const COMPONENT_PATTERN =
	/^([A-Za-z][A-Za-z0-9_-]*):([A-Za-z][A-Za-z0-9_-]*)\s+"([^"]+)"\s+at\s+\((-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)\)\s+(.+)$/;
/** Lexical shape of a directed connection declaration line. */
const CONNECTION_PATTERN =
	/^([A-Za-z][A-Za-z0-9_-]*)\.([A-Za-z][A-Za-z0-9_-]*)\s*->\s*([A-Za-z][A-Za-z0-9_-]*)\.([A-Za-z][A-Za-z0-9_-]*)\s+(.+)$/;
/**
 * Matches the canonical `schemd` Markdown information string. The legacy
 * `schematic` identifier remains an input-only alias so previously persisted
 * articles continue to render; documentation and generated source never emit it.
 */
const SCHEMD_FENCE_PATTERN = /^schemd\s+bounds="(\d+)x(\d+)"(?:\s+title="([^"]+)")?\s*$/i;
/** Strict finite decimal syntax used by CSS functional-color channels. */
const NUMBER_PATTERN = /^[+-]?(?:\d+\.?\d*|\.\d+)$/;
/** CSS angle syntax accepted for HSL hue channels. */
const ANGLE_PATTERN = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:deg|grad|rad|turn)?$/i;
/** Safe custom-property alias syntax, capped to prevent unbounded selectors. */
const ALIAS_PATTERN = /^[a-z][a-z0-9-]{0,63}$/i;
/** Addressable IC pin identifier syntax. */
const PIN_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
/** Port aliases reserved for deterministic first-input/first-output resolution. */
const RESERVED_IC_PIN_NAMES = new Set(['in', 'out']);
/** Maximum pin declarations accepted on any one IC edge. */
const MAX_IC_PINS_PER_SIDE = 64;
/** Smallest rendered IC body width in viewBox units. */
const IC_MINIMUM_WIDTH = 88;
/** Smallest rendered IC body height in viewBox units. */
const IC_MINIMUM_HEIGHT = 64;
/** Horizontal body expansion allocated per top or bottom IC pin. */
const IC_HORIZONTAL_PIN_SPACING = 22;
/** Vertical body expansion allocated per left or right IC pin. */
const IC_VERTICAL_PIN_SPACING = 18;
/** Aggregate padding retained around dynamically distributed IC pins. */
const IC_BODY_PADDING = 24;
/** Maximum rows accepted in a UML class or state compartment. */
const MAX_UML_ROWS = 64;
/** Maximum length of one UML compartment row. */
const MAX_UML_ROW_LENGTH = 256;
/** Ordinary row height used by deterministic UML sizing. */
const UML_ROW_HEIGHT = 16;
/** Maximum accessible title length accepted from a fence information string. */
const MAX_FENCE_TITLE_LENGTH = 512;
/** Provenance registry for immutable AST objects created by this parser instance. */
const parsedDocuments = new WeakSet<SchematicDocument>();

/**
 * Deep-freeze one validated AST and register it as renderer-authorized.
 *
 * @param document - Fully validated document whose arrays and nested records
 *   are still mutable parser-owned objects.
 * @returns The same object identity after all reachable AST structures are frozen.
 */
function freezeParsedDocument(document: SchematicDocument): SchematicDocument {
	for (const component of document.components) {
		Object.freeze(component.color);
		if (component.kind === 'ic') {
			Object.freeze(component.pins.left);
			Object.freeze(component.pins.right);
			Object.freeze(component.pins.top);
			Object.freeze(component.pins.bottom);
			Object.freeze(component.pins);
		}
		if (component.kind === 'class') {
			Object.freeze(component.attributes);
			Object.freeze(component.operations);
		}
		if (component.kind === 'state') Object.freeze(component.details);
		Object.freeze(component);
	}
	for (const connection of document.connections) {
		Object.freeze(connection.from);
		Object.freeze(connection.to);
		Object.freeze(connection.color);
		Object.freeze(connection);
	}
	Object.freeze(document.components);
	Object.freeze(document.connections);
	Object.freeze(document);
	parsedDocuments.add(document);
	return document;
}

/**
 * Assert that a document originated from {@link parseSchematic} in this module.
 *
 * @param document - Candidate AST supplied to the renderer.
 * @throws {TypeError} When the object was forged, cloned, or parsed by another
 *   loaded copy of the package rather than this module instance.
 * @internal
 */
export function assertParsedSchematicDocument(document: SchematicDocument): void {
	if (!parsedDocuments.has(document)) {
		throw new TypeError(
			'renderSchematic requires an immutable document returned by parseSchematic.'
		);
	}
}

/**
 * Test membership in a readonly string tuple without losing its literal union.
 *
 * @param values - Canonical allowlist.
 * @param value - Runtime string to narrow.
 * @returns Whether `value` is an element of `values`.
 */
function includesValue<const T extends readonly string[]>(
	values: T,
	value: string
): value is T[number] {
	return values.includes(value);
}

/**
 * Validate a CSS numeric channel, optionally allowing percentage notation.
 *
 * @param value - Trimmed channel token.
 * @param minimum - Inclusive lower numeric bound.
 * @param maximum - Inclusive upper bound for non-percentage values.
 * @param allowPercent - Whether a trailing percent sign is accepted.
 * @returns `true` when the complete token is finite syntax within its range.
 */
function parseRangedNumber(
	value: string,
	minimum: number,
	maximum: number,
	allowPercent: boolean
): boolean {
	const percent = allowPercent && value.endsWith('%');
	const numeric = percent ? value.slice(0, -1) : value;
	if (!NUMBER_PATTERN.test(numeric)) return false;
	const parsed = Number(numeric);
	return parsed >= minimum && parsed <= (percent ? 100 : maximum);
}

/**
 * Validate an RGB/HSL alpha channel.
 *
 * @param value - Decimal zero-to-one value or zero-to-100 percentage.
 * @returns Whether the token is a valid CSS alpha value.
 */
function parseAlpha(value: string): boolean {
	return parseRangedNumber(value, 0, 1, true);
}

/**
 * Normalize legacy comma or modern space-separated RGB function contents.
 *
 * @param body - Text between the outer `rgb()` or `rgba()` parentheses.
 * @returns Canonical modern `rgb()` syntax, or `undefined` for invalid channels.
 */
function parseRgb(body: string): string | undefined {
	const commaSyntax = body.includes(',');
	const slashParts = body.split('/').map((part) => part.trim());
	if (slashParts.length > 2 || (commaSyntax && slashParts.length > 1)) return undefined;
	const parsedChannels = commaSyntax
		? slashParts[0]!.split(',').map((part) => part.trim())
		: slashParts[0]!.split(/\s+/);
	const legacyAlpha = commaSyntax && parsedChannels.length === 4 ? parsedChannels[3] : undefined;
	const rawChannels = legacyAlpha === undefined ? parsedChannels : parsedChannels.slice(0, 3);
	const alpha: string | undefined = slashParts.at(1) ?? legacyAlpha;
	if (
		rawChannels.length !== 3 ||
		!rawChannels.every((channel) => parseRangedNumber(channel, 0, 255, true)) ||
		(alpha !== undefined && !parseAlpha(alpha))
	) {
		return undefined;
	}
	return `rgb(${rawChannels.join(' ')}${alpha === undefined ? '' : ` / ${alpha}`})`;
}

/**
 * Normalize legacy comma or modern space-separated HSL function contents.
 *
 * @param body - Text between the outer `hsl()` or `hsla()` parentheses.
 * @returns Canonical modern `hsl()` syntax, or `undefined` for invalid channels.
 */
function parseHsl(body: string): string | undefined {
	const commaSyntax = body.includes(',');
	const slashParts = body.split('/').map((part) => part.trim());
	if (slashParts.length > 2 || (commaSyntax && slashParts.length > 1)) return undefined;
	const parsedChannels = commaSyntax
		? slashParts[0]!.split(',').map((part) => part.trim())
		: slashParts[0]!.split(/\s+/);
	const legacyAlpha = commaSyntax && parsedChannels.length === 4 ? parsedChannels[3] : undefined;
	const rawChannels = legacyAlpha === undefined ? parsedChannels : parsedChannels.slice(0, 3);
	const alpha: string | undefined = slashParts.at(1) ?? legacyAlpha;
	const [hue, saturation, lightness] = rawChannels;
	if (
		rawChannels.length !== 3 ||
		hue === undefined ||
		!ANGLE_PATTERN.test(hue) ||
		saturation === undefined ||
		!saturation.endsWith('%') ||
		!parseRangedNumber(saturation, 0, 100, true) ||
		lightness === undefined ||
		!lightness.endsWith('%') ||
		!parseRangedNumber(lightness, 0, 100, true) ||
		(alpha !== undefined && !parseAlpha(alpha))
	) {
		return undefined;
	}
	return `hsl(${rawChannels.join(' ')}${alpha === undefined ? '' : ` / ${alpha}`})`;
}

/**
 * Parse a theme token, safe CSS literal, or custom theme alias.
 *
 * Raw aliases never become literal color declarations; the renderer maps them
 * through bounded `--schematic-color-*` custom properties. Functional colors
 * are canonicalized and unsafe CSS expressions are rejected.
 *
 * @param input - Author-supplied color token or expression.
 * @param line - One-based source line used in diagnostics.
 * @returns Sanitized discriminated color representation.
 * @throws {SchematicSyntaxError} For malformed, out-of-range, or unsafe colors.
 */
export function parseSchematicColor(input: string, line = 1): SchematicColor {
	const value = input.trim();
	const tokenCandidate = (value.startsWith('#') ? value.slice(1) : value).toLowerCase();
	if (includesValue(SEMANTIC_COLORS, tokenCandidate)) {
		return { kind: 'token', value: tokenCandidate };
	}
	if (/^#[A-Fa-f0-9]+$/.test(value)) {
		if (![4, 5, 7, 9].includes(value.length)) {
			throw new SchematicSyntaxError('Hex colors require 3, 4, 6, or 8 digits.', line);
		}
		return { kind: 'css', value: value.toLowerCase() };
	}
	const functionMatch = value.match(/^(rgb|rgba|hsl|hsla)\((.*)\)$/i);
	if (functionMatch) {
		const functionName = functionMatch[1]!.toLowerCase();
		const body = functionMatch[2]!;
		const normalized = functionName.startsWith('rgb') ? parseRgb(body) : parseHsl(body);
		if (!normalized) {
			throw new SchematicSyntaxError(`Invalid ${functionName} color.`, line);
		}
		return { kind: 'css', value: normalized };
	}
	const alias = value.startsWith('#') ? value.slice(1) : value;
	if (ALIAS_PATTERN.test(alias)) return { kind: 'alias', value: alias.toLowerCase() };
	throw new SchematicSyntaxError('Unsafe or unsupported color expression.', line);
}

/**
 * Parse whitespace-separated `key=value` declaration options.
 *
 * Quoted values may contain whitespace. Duplicate keys and incomplete quoted
 * values are rejected by the same deterministic malformed-options diagnostic.
 *
 * @param raw - Option body without surrounding square brackets.
 * @param line - One-based source line for diagnostics.
 * @returns Insertion-ordered map of unique option names to raw values.
 */
function parseAttributes(raw: string | undefined, line: number): ReadonlyMap<string, string> {
	const attributes = new Map<string, string>();
	if (raw === undefined) return attributes;
	if (raw.trim() === '') throw new SchematicSyntaxError('Malformed component options.', line);
	const source = raw.trim();
	let cursor = 0;
	while (cursor < source.length) {
		if (cursor > 0) {
			if (!/\s/.test(source[cursor]!)) {
				throw new SchematicSyntaxError('Malformed component options.', line);
			}
			while (cursor < source.length && /\s/.test(source[cursor]!)) cursor += 1;
			/* v8 ignore next -- source.trim() makes a trailing separator unreachable. */
			if (cursor === source.length) {
				throw new SchematicSyntaxError('Malformed component options.', line);
			}
		}
		const keyStart = cursor;
		const firstCode = source.charCodeAt(cursor);
		if (firstCode < 97 || firstCode > 122) {
			throw new SchematicSyntaxError('Malformed component options.', line);
		}
		cursor += 1;
		while (cursor < source.length) {
			const code = source.charCodeAt(cursor);
			if (!((code >= 97 && code <= 122) || (code >= 48 && code <= 57) || code === 45)) break;
			cursor += 1;
		}
		if (source[cursor] !== '=') {
			throw new SchematicSyntaxError('Malformed component options.', line);
		}
		const key = source.slice(keyStart, cursor);
		cursor += 1;
		let value: string;
		if (source[cursor] === '"') {
			const valueStart = ++cursor;
			while (cursor < source.length && source[cursor] !== '"') cursor += 1;
			/* v8 ignore next -- splitDeclarationTail rejects unbalanced quotes first. */
			if (cursor === source.length) {
				throw new SchematicSyntaxError('Malformed component options.', line);
			}
			value = source.slice(valueStart, cursor);
			cursor += 1;
		} else {
			const valueStart = cursor;
			while (cursor < source.length && !/\s/.test(source[cursor]!)) cursor += 1;
			if (cursor === valueStart) {
				throw new SchematicSyntaxError('Malformed component options.', line);
			}
			value = source.slice(valueStart, cursor);
		}
		if (attributes.has(key)) throw new SchematicSyntaxError(`Duplicate option ${key}.`, line);
		attributes.set(key, value);
	}
	return attributes;
}

/**
 * Reject declaration options not supported by the selected component kind.
 *
 * @param attributes - Previously parsed declaration options.
 * @param allowed - Exact option-name allowlist.
 * @param line - One-based source line for diagnostics.
 * @throws {SchematicSyntaxError} On the first unsupported key.
 */
function assertOnlyAttributes(
	attributes: ReadonlyMap<string, string>,
	allowed: readonly string[],
	line: number
): void {
	for (const key of attributes.keys()) {
		if (!allowed.includes(key))
			throw new SchematicSyntaxError(`Option ${key} is not supported.`, line);
	}
}

/**
 * Parse a bounded classical-gate terminal count.
 *
 * @param value - Optional decimal integer token.
 * @param fallback - Count used when the attribute is omitted.
 * @param name - Attribute name included in diagnostics.
 * @param line - One-based source line for diagnostics.
 * @returns An integer from 1 through 32.
 */
function parseCount(
	value: string | undefined,
	fallback: number,
	name: string,
	line: number
): number {
	if (value === undefined) return fallback;
	if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 32) {
		throw new SchematicSyntaxError(`${name} must be an integer from 1 through 32.`, line);
	}
	return Number(value);
}

/** Result of separating a declaration's paint token from bracketed options. */
interface DeclarationTail {
	/** Raw color expression appearing before the option block. */
	color: string;
	/** Raw option contents without brackets, when present. */
	options: string | undefined;
}

/**
 * Split a component or connection tail without misreading brackets in CSS functions.
 *
 * @param raw - Complete declaration text following coordinates or endpoint pair.
 * @param line - One-based source line for diagnostics.
 * @param allowMissingColor - Whether an empty paint token may fall back later.
 * @returns Separated color and optional bracket contents.
 * @throws {SchematicSyntaxError} For unbalanced delimiters or trailing content.
 */
function splitDeclarationTail(
	raw: string,
	line: number,
	allowMissingColor = false
): DeclarationTail {
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
			if (optionsStart >= 0 || (index > 0 && !/\s/.test(source[index - 1]!))) {
				throw new SchematicSyntaxError('Malformed declaration options.', line);
			}
			optionsStart = index;
			continue;
		}
		if (character === ']' && parentheses === 0) {
			if (optionsStart < 0 || optionsEnd >= 0) {
				throw new SchematicSyntaxError('Malformed declaration options.', line);
			}
			optionsEnd = index;
		}
	}
	if (quoteOpen || parentheses !== 0) {
		throw new SchematicSyntaxError('Malformed declaration tail.', line);
	}
	if (optionsStart < 0) {
		return { color: source, options: undefined };
	}
	if (optionsEnd < optionsStart || source.slice(optionsEnd + 1).trim() !== '') {
		throw new SchematicSyntaxError('Malformed declaration options.', line);
	}
	const color = source.slice(0, optionsStart).trim();
	if (color === '' && !allowMissingColor) {
		throw new SchematicSyntaxError('A declaration color is required.', line);
	}
	return { color, options: source.slice(optionsStart + 1, optionsEnd) };
}

/**
 * Parse a single allowlisted enum attribute with a default.
 *
 * @param value - Optional author-supplied value.
 * @param fallback - Value selected when the option is absent.
 * @param values - Readonly string allowlist used for type narrowing.
 * @param name - Option name included in diagnostics.
 * @param line - One-based source line for diagnostics.
 * @returns A member of `values`.
 */
function parseEnumOption<const T extends readonly string[]>(
	value: string | undefined,
	fallback: T[number],
	values: T,
	name: string,
	line: number
): T[number] {
	if (value === undefined) return fallback;
	if (!includesValue(values, value)) {
		throw new SchematicSyntaxError(`${name} must be one of: ${values.join(', ')}.`, line);
	}
	return value;
}

/**
 * Parse, validate, and globally de-duplicate custom IC pin lists.
 *
 * @param attributes - IC side attributes keyed by `left`, `right`, `top`, and `bottom`.
 * @param line - One-based source line for diagnostics.
 * @returns Side-preserving addressable pin registry.
 * @throws {SchematicSyntaxError} For empty chips, invalid names, reserved aliases,
 *   duplicates, or more than 64 pins on one side.
 */
function parseIcPins(attributes: ReadonlyMap<string, string>, line: number): IntegratedCircuitPins {
	const registered = new Set<string>();
	/**
	 * Parse one side while sharing the document-local pin-name registry.
	 *
	 * @param side - IC edge whose comma-separated attribute is being consumed.
	 * @returns Validated pin names in author order, or an empty list when omitted.
	 */
	const parseSide = (side: keyof IntegratedCircuitPins): readonly string[] => {
		const source = attributes.get(side);
		if (source === undefined || source.trim() === '') return [];
		const pins = source.split(',').map((pin) => pin.trim());
		if (pins.length > MAX_IC_PINS_PER_SIDE) {
			throw new SchematicSyntaxError(
				`${side} supports at most ${MAX_IC_PINS_PER_SIDE} IC pins.`,
				line
			);
		}
		for (const pin of pins) {
			if (!PIN_NAME_PATTERN.test(pin)) {
				throw new SchematicSyntaxError(`Invalid IC pin name ${pin || '(empty)'}.`, line);
			}
			if (RESERVED_IC_PIN_NAMES.has(pin)) {
				throw new SchematicSyntaxError(
					`IC pin ${pin} collides with the reserved ${pin} alias. Use ${pin}1 or another pin name.`,
					line
				);
			}
			if (registered.has(pin)) {
				throw new SchematicSyntaxError(`Duplicate IC pin ${pin}.`, line);
			}
			registered.add(pin);
		}
		return pins;
	};
	const pins = {
		left: parseSide('left'),
		right: parseSide('right'),
		top: parseSide('top'),
		bottom: parseSide('bottom')
	} satisfies IntegratedCircuitPins;
	if (registered.size === 0) {
		throw new SchematicSyntaxError('An IC must declare at least one pin.', line);
	}
	return pins;
}

/**
 * Derive deterministic IC body dimensions from its busiest opposing sides.
 *
 * @param pins - Validated side-aware pin registry.
 * @returns Minimum-clamped body width and height in viewBox units.
 */
function integratedCircuitDimensions(pins: IntegratedCircuitPins): {
	bodyWidth: number;
	bodyHeight: number;
} {
	return {
		bodyWidth: Math.max(
			IC_MINIMUM_WIDTH,
			Math.max(pins.top.length, pins.bottom.length) * IC_HORIZONTAL_PIN_SPACING + IC_BODY_PADDING
		),
		bodyHeight: Math.max(
			IC_MINIMUM_HEIGHT,
			Math.max(pins.left.length, pins.right.length) * IC_VERTICAL_PIN_SPACING + IC_BODY_PADDING
		)
	};
}

/** Parse a semicolon-delimited UML compartment without unbounded row growth. */
function parseUmlRows(value: string | undefined, name: string, line: number): readonly string[] {
	if (value === undefined || value.trim() === '') return [];
	const rows = value.split(';').map((row) => row.trim());
	if (rows.length > MAX_UML_ROWS) {
		throw new SchematicSyntaxError(`${name} supports at most ${MAX_UML_ROWS} rows.`, line);
	}
	for (const row of rows) {
		if (row === '' || row.length > MAX_UML_ROW_LENGTH) {
			throw new SchematicSyntaxError(
				`${name} rows must contain 1 through ${MAX_UML_ROW_LENGTH} characters.`,
				line
			);
		}
	}
	return rows;
}

/** Parse an optional UML dimension while retaining finite render bounds. */
function parseUmlDimension(
	value: string | undefined,
	fallback: number,
	name: string,
	line: number
): number {
	if (value === undefined) return fallback;
	if (!/^\d+(?:\.\d+)?$/.test(value)) {
		throw new SchematicSyntaxError(`${name} must be a finite number from 24 through 2048.`, line);
	}
	const dimension = Number(value);
	if (dimension < 24 || dimension > 2048) {
		throw new SchematicSyntaxError(`${name} must be a finite number from 24 through 2048.`, line);
	}
	return dimension;
}

/** Estimate the widest row in a UML node using the micro-math metric fallback. */
function widestUmlRow(rows: readonly string[]): number {
	let width = 0;
	for (const row of rows) width = Math.max(width, mathLabelTextWidth(row, 8));
	return width;
}

/**
 * Extract and sanitize fields shared by every component AST node.
 *
 * @param match - Match produced by {@link COMPONENT_PATTERN}.
 * @param color - Raw color token selected for the component.
 * @param line - One-based source line.
 * @returns Shared component identity, coordinates, label, color, and location.
 */
function commonComponent(match: RegExpMatchArray, color: string, line: number) {
	return {
		id: match[2]!,
		label: match[3]!,
		x: Number(match[4]!),
		y: Number(match[5]!),
		color: parseSchematicColor(color, line),
		line
	};
}

/**
 * Convert one lexically matched component declaration into its discriminated AST node.
 *
 * @param match - Complete match from {@link COMPONENT_PATTERN}.
 * @param line - One-based source line for diagnostics and AST provenance.
 * @returns Fully validated component node with kind-specific defaults applied.
 */
function parseComponent(match: RegExpMatchArray, line: number): SchematicComponent {
	const rawKind = match[1]!.toLowerCase();
	if (!includesValue(COMPONENT_KINDS, rawKind)) {
		throw new SchematicSyntaxError(`Unsupported component kind ${match[1]!}.`, line);
	}
	const kind: ComponentKind = rawKind;
	const tail = splitDeclarationTail(match[6]!, line, kind === 'ic');
	const attributes = parseAttributes(tail.options, line);
	const common = commonComponent(match, tail.color === '' ? 'slate' : tail.color, line);
	if (includesValue(PASSIVE_KINDS, kind)) {
		assertOnlyAttributes(attributes, [], line);
		return { kind, ...common };
	}
	if (includesValue(ANALOG_KINDS, kind)) {
		switch (kind) {
			case 'diode':
				assertOnlyAttributes(attributes, ['type'], line);
				return {
					kind,
					...common,
					diodeType: parseEnumOption(attributes.get('type'), 'standard', DIODE_TYPES, 'type', line)
				} satisfies DiodeComponent;
			case 'transistor':
				assertOnlyAttributes(attributes, ['type'], line);
				return {
					kind,
					...common,
					transistorType: parseEnumOption(
						attributes.get('type'),
						'npn',
						TRANSISTOR_TYPES,
						'type',
						line
					)
				} satisfies TransistorComponent;
			case 'port':
				assertOnlyAttributes(attributes, [], line);
				return { kind, ...common } satisfies PortComponent;
			case 'ground':
				assertOnlyAttributes(attributes, ['style'], line);
				return {
					kind,
					...common,
					groundStyle: parseEnumOption(
						attributes.get('style'),
						'signal',
						GROUND_STYLES,
						'style',
						line
					)
				} satisfies GroundComponent;
		}
	}
	if (includesValue(CLASSICAL_GATE_KINDS, kind)) {
		assertOnlyAttributes(attributes, ['inputs', 'outputs', 'standard'], line);
		const standard = attributes.get('standard') ?? 'ieee';
		if (standard !== 'ieee' && standard !== 'iec') {
			throw new SchematicSyntaxError('standard must be ieee or iec.', line);
		}
		return {
			kind,
			...common,
			inputs: parseCount(attributes.get('inputs'), kind === 'not' ? 1 : 2, 'inputs', line),
			outputs: parseCount(attributes.get('outputs'), 1, 'outputs', line),
			standard
		} satisfies ClassicalGateComponent;
	}
	if (kind === 'ic') {
		assertOnlyAttributes(attributes, ['left', 'right', 'top', 'bottom'], line);
		const pins = parseIcPins(attributes, line);
		return {
			kind,
			...common,
			pins,
			...integratedCircuitDimensions(pins)
		} satisfies IcComponent;
	}
	if (includesValue(UML_COMPONENT_KINDS, kind)) {
		switch (kind) {
			case 'class': {
				assertOnlyAttributes(attributes, ['attributes', 'operations', 'stereotype', 'width'], line);
				const classAttributes = parseUmlRows(attributes.get('attributes'), 'attributes', line);
				const operations = parseUmlRows(attributes.get('operations'), 'operations', line);
				const stereotype = attributes.get('stereotype');
				if (stereotype !== undefined && (stereotype === '' || stereotype.length > 128)) {
					throw new SchematicSyntaxError('stereotype must contain 1 through 128 characters.', line);
				}
				const calculatedWidth = Math.max(
					120,
					widestUmlRow([common.label, stereotype ?? '', ...classAttributes, ...operations]) + 24
				);
				const bodyWidth = Math.max(
					calculatedWidth,
					parseUmlDimension(attributes.get('width'), calculatedWidth, 'width', line)
				);
				const bodyHeight =
					36 +
					Math.max(24, classAttributes.length * UML_ROW_HEIGHT + 8) +
					Math.max(24, operations.length * UML_ROW_HEIGHT + 8) +
					(stereotype === undefined ? 0 : 14);
				const component: UmlClassComponent = {
					kind,
					...common,
					attributes: classAttributes,
					operations,
					bodyWidth,
					bodyHeight
				};
				if (stereotype !== undefined) component.stereotype = stereotype;
				return component;
			}
			case 'state': {
				assertOnlyAttributes(attributes, ['details', 'width'], line);
				const details = parseUmlRows(attributes.get('details'), 'details', line);
				const calculatedWidth = Math.max(112, widestUmlRow([common.label, ...details]) + 28);
				return {
					kind,
					...common,
					details,
					bodyWidth: Math.max(
						calculatedWidth,
						parseUmlDimension(attributes.get('width'), calculatedWidth, 'width', line)
					),
					bodyHeight: 40 + details.length * UML_ROW_HEIGHT
				} satisfies UmlStateComponent;
			}
			case 'usecase':
			case 'lifeline':
			case 'note':
			case 'package': {
				assertOnlyAttributes(attributes, ['width', 'height'], line);
				const defaultWidth = Math.max(
					kind === 'usecase' ? 112 : 96,
					mathLabelTextWidth(common.label, 8) + 28
				);
				const defaultHeight = kind === 'lifeline' ? 180 : kind === 'usecase' ? 56 : 64;
				return {
					kind,
					...common,
					bodyWidth: Math.max(
						defaultWidth,
						parseUmlDimension(attributes.get('width'), defaultWidth, 'width', line)
					),
					bodyHeight: Math.max(
						defaultHeight,
						parseUmlDimension(attributes.get('height'), defaultHeight, 'height', line)
					)
				} satisfies UmlSizedComponent;
			}
			case 'actor':
			case 'initial':
			case 'final':
				assertOnlyAttributes(attributes, [], line);
				return { kind, ...common };
		}
	}
	const quantumKind = kind as QuantumGateKind;
	assertOnlyAttributes(
		attributes,
		quantumKind === 'qgate' ? ['parameter', 'matrix', 'phase'] : [],
		line
	);
	const component: QuantumGateComponent = { kind: quantumKind, ...common };
	const parameter = attributes.get('parameter');
	const matrix = attributes.get('matrix');
	const phase = attributes.get('phase');
	if (parameter !== undefined) component.parameter = parameter;
	if (matrix !== undefined) component.matrix = matrix;
	if (phase !== undefined) component.phase = phase;
	return component;
}

/**
 * Create a normalized endpoint record from lexical captures.
 *
 * @param componentId - Referenced component identifier.
 * @param port - Author-supplied terminal name.
 * @returns Endpoint record; semantic validation occurs after all declarations parse.
 */
function parseEndpoint(componentId: string, port: string): SchematicEndpoint {
	return { componentId, port };
}

/** Defaults and normalized routing controls parsed from a connection option block. */
interface ParsedConnectionOptions {
	/** Requested path geometry. */
	curve: SchematicConnection['curve'];
	/** Optional marker attached to the source endpoint. */
	markerStart: SchematicSignalMarker;
	/** Optional marker attached to the destination endpoint. */
	markerEnd: SchematicSignalMarker;
	/** Electrical or UML relationship semantics. */
	relation: SchematicRelationKind;
	/** Optional connector label. */
	label: string | undefined;
	/** Explicit or relation-derived dash treatment. */
	dashed: boolean;
}

/** Split connection options without breaking quoted labels containing whitespace. */
function connectionOptionTokens(raw: string, line: number): readonly string[] {
	const tokens: string[] = [];
	let tokenStart = -1;
	let quoteOpen = false;
	for (let index = 0; index <= raw.length; index += 1) {
		const character = raw[index];
		if (character === '"') quoteOpen = !quoteOpen;
		if ((character === undefined || (/\s/.test(character) && !quoteOpen)) && tokenStart >= 0) {
			tokens.push(raw.slice(tokenStart, index));
			tokenStart = -1;
		} else if (character !== undefined && !/\s/.test(character) && tokenStart < 0) {
			tokenStart = index;
		}
	}
	/* v8 ignore next -- splitDeclarationTail rejects unbalanced quotes before tokenization. */
	if (quoteOpen) throw new SchematicSyntaxError('Malformed quoted connection option.', line);
	return tokens;
}

/**
 * Validate one connection marker token.
 *
 * @param value - Marker keyword to validate.
 * @param option - Option name included in diagnostics.
 * @param line - One-based source line.
 * @returns Narrowed marker selection.
 */
function parseSignalMarker(value: string, option: string, line: number): SchematicSignalMarker {
	if (!includesValue(SCHEMATIC_SIGNAL_MARKERS, value)) {
		throw new SchematicSyntaxError(
			`${option} must be one of: ${SCHEMATIC_SIGNAL_MARKERS.join(', ')}.`,
			line
		);
	}
	return value;
}

/**
 * Parse connection routing and marker shorthand without duplicate declarations.
 *
 * @param raw - Option text without surrounding brackets.
 * @param line - One-based source line for diagnostics.
 * @returns Normalized curve and start/end marker configuration.
 */
function parseConnectionOptions(raw: string | undefined, line: number): ParsedConnectionOptions {
	let curve: SchematicConnection['curve'] = 'line';
	let markerStart: SchematicSignalMarker = 'none';
	let markerEnd: SchematicSignalMarker = 'none';
	let relation: SchematicRelationKind = 'signal';
	let label: string | undefined;
	let dashed = false;
	if (raw === undefined || raw.trim() === '') {
		return { curve, markerStart, markerEnd, relation, label, dashed };
	}

	const seen = new Set<string>();
	for (const token of connectionOptionTokens(raw.trim(), line)) {
		if (token === 'line' || token === 'bezier' || token === 'ortho') {
			if (seen.has('curve')) {
				throw new SchematicSyntaxError('Connection routing can only be declared once.', line);
			}
			curve = token;
			seen.add('curve');
			continue;
		}
		if (token === 'dashed' || token === 'solid') {
			if (seen.has('stroke-style')) {
				throw new SchematicSyntaxError('Connection stroke style can only be declared once.', line);
			}
			dashed = token === 'dashed';
			seen.add('stroke-style');
			continue;
		}
		if (includesValue(UML_RELATION_KINDS, token)) {
			if (seen.has('relation')) {
				throw new SchematicSyntaxError('Connection relation can only be declared once.', line);
			}
			relation = token;
			seen.add('relation');
			continue;
		}
		if (token === 'arrow' || token === 'dot') {
			if (seen.has('marker-end')) {
				throw new SchematicSyntaxError('Connection marker-end can only be declared once.', line);
			}
			markerEnd = token;
			seen.add('marker-end');
			continue;
		}
		const match = token.match(/^(marker-start|marker-end|relation|label)=(.*)$/);
		if (!match) {
			throw new SchematicSyntaxError(
				'Unsupported connection routing, marker, relation, label, or stroke option.',
				line
			);
		}
		const option = match[1]!;
		if (seen.has(option)) {
			throw new SchematicSyntaxError(`Connection ${option} can only be declared once.`, line);
		}
		let optionValue = match[2]!;
		if (optionValue.startsWith('"') || optionValue.endsWith('"')) {
			if (!(optionValue.length >= 2 && optionValue.startsWith('"') && optionValue.endsWith('"'))) {
				throw new SchematicSyntaxError(`Malformed connection ${option}.`, line);
			}
			optionValue = optionValue.slice(1, -1);
		}
		if (option === 'relation') {
			if (!includesValue(UML_RELATION_KINDS, optionValue)) {
				throw new SchematicSyntaxError(
					`relation must be one of: ${UML_RELATION_KINDS.join(', ')}.`,
					line
				);
			}
			relation = optionValue;
		} else if (option === 'label') {
			if (optionValue === '' || optionValue.length > 256) {
				throw new SchematicSyntaxError('Connection labels require 1 through 256 characters.', line);
			}
			label = optionValue;
		} else {
			const marker = parseSignalMarker(optionValue, option, line);
			if (option === 'marker-start') markerStart = marker;
			else markerEnd = marker;
		}
		seen.add(option);
	}
	if (!seen.has('marker-start')) {
		if (relation === 'aggregation') markerStart = 'diamond';
		else if (relation === 'composition') markerStart = 'diamond-filled';
	}
	if (!seen.has('marker-end')) {
		if (relation === 'generalization' || relation === 'realization') markerEnd = 'triangle';
		else if (
			relation === 'dependency' ||
			relation === 'message' ||
			relation === 'transition' ||
			relation === 'include' ||
			relation === 'extend'
		) {
			markerEnd = 'open-arrow';
		}
	}
	if (!seen.has('stroke-style')) {
		dashed = ['dependency', 'realization', 'include', 'extend'].includes(relation);
	}
	if (label === undefined && (relation === 'include' || relation === 'extend')) {
		label = `«${relation}»`;
	}
	return { curve, markerStart, markerEnd, relation, label, dashed };
}

/**
 * Convert one matched connection declaration into its validated AST record.
 *
 * @param match - Complete match from {@link CONNECTION_PATTERN}.
 * @param line - One-based source line for diagnostics and provenance.
 * @returns Directed connection with sanitized color and normalized options.
 */
function parseConnection(match: RegExpMatchArray, line: number): SchematicConnection {
	const tail = splitDeclarationTail(match[5]!, line);
	const options = parseConnectionOptions(tail.options, line);
	const connection: SchematicConnection = {
		from: parseEndpoint(match[1]!, match[2]!),
		to: parseEndpoint(match[3]!, match[4]!),
		color: parseSchematicColor(tail.color, line),
		curve: options.curve,
		markerStart: options.markerStart,
		markerEnd: options.markerEnd,
		relation: options.relation,
		dashed: options.dashed,
		line
	};
	if (options.label !== undefined) connection.label = options.label;
	return connection;
}

/**
 * Reject component origins outside the declared intrinsic canvas.
 *
 * Full vector extents are checked later by `validateDocumentGeometry` after all
 * ports and dimensions are available.
 *
 * @param component - Parsed component to inspect.
 * @param fence - Declared canvas contract.
 */
function validateComponent(component: SchematicComponent, fence: SchematicFence): void {
	if (
		component.x < 0 ||
		component.x > fence.bounds.width ||
		component.y < 0 ||
		component.y > fence.bounds.height
	) {
		throw new SchematicSyntaxError(
			`${component.id} is outside the declared ${fence.bounds.width}x${fence.bounds.height} bounds.`,
			component.line
		);
	}
}

/**
 * Validate indexed and unindexed ports on a classical gate.
 *
 * @param component - Gate containing bounded input/output counts.
 * @param port - Terminal reference to test.
 * @returns Whether the alias or one-based index exists on the gate.
 */
function validGatePort(component: ClassicalGateComponent, port: string): boolean {
	if (port === 'in' || port === 'out') return true;
	const match = port.match(/^(in|out)([1-9]\d*)$/);
	if (!match) return false;
	const index = Number(match[2]);
	return match[1] === 'in'
		? index <= component.inputs && index >= 1
		: index <= component.outputs && index >= 1;
}

/**
 * Narrow a component union to a classical gate.
 *
 * @param component - Any parsed component.
 * @returns Whether its discriminant belongs to the classical-gate registry.
 */
function isClassicalGate(component: SchematicComponent): component is ClassicalGateComponent {
	return CLASSICAL_GATE_KINDS.includes(component.kind as ClassicalGateComponent['kind']);
}

/**
 * Validate a custom IC pin or stable first-input/first-output alias.
 *
 * @param component - Integrated circuit with validated side pin lists.
 * @param port - Terminal name referenced by a connection.
 * @returns Whether the terminal resolves deterministically.
 */
function validIcPort(component: IcComponent, port: string): boolean {
	const sides = Object.values(component.pins);
	if (port === 'in') {
		return (
			sides.some((pins) => pins.includes('in1')) ||
			component.pins.left.length > 0 ||
			component.pins.top.length > 0
		);
	}
	if (port === 'out') {
		return (
			sides.some((pins) => pins.includes('out1')) ||
			component.pins.right.length > 0 ||
			component.pins.bottom.length > 0
		);
	}
	return sides.some((pins) => pins.includes(port));
}

/**
 * Validate one endpoint after the complete component registry is known.
 *
 * @param endpoint - Component and terminal reference to validate.
 * @param components - Document-local components keyed by unique ID.
 * @param line - Connection source line for diagnostics.
 * @throws {SchematicSyntaxError} For an unknown component or unsupported port.
 */
function validateEndpoint(
	endpoint: SchematicEndpoint,
	components: ReadonlyMap<string, SchematicComponent>,
	line: number
): void {
	const component = components.get(endpoint.componentId);
	if (!component)
		throw new SchematicSyntaxError(`Unknown component ${endpoint.componentId}.`, line);
	let valid: boolean;
	if (isClassicalGate(component)) {
		valid = validGatePort(component, endpoint.port);
	} else if (includesValue(UML_COMPONENT_KINDS, component.kind)) {
		valid = ['in', 'out', 'left', 'right', 'top', 'bottom'].includes(endpoint.port);
		if (!valid && component.kind === 'lifeline') {
			const match = endpoint.port.match(/^(left|right)(\d+)$/);
			valid = match !== null && Number(match[2]) <= component.bodyHeight;
		}
	} else {
		switch (component.kind) {
			case 'resistor':
			case 'capacitor':
			case 'inductor':
				valid = ['in', 'out', 'left', 'right', 'l', 'r'].includes(endpoint.port);
				break;
			case 'diode':
				valid = ['anode', 'a', 'cathode', 'k', 'c'].includes(endpoint.port);
				break;
			case 'transistor':
				valid = [
					'base',
					'gate',
					'b',
					'g',
					'collector',
					'drain',
					'c',
					'd',
					'emitter',
					'source',
					'e',
					's'
				].includes(endpoint.port);
				break;
			case 'port':
			case 'hadamard':
			case 'qgate':
				valid = endpoint.port === 'in' || endpoint.port === 'out';
				break;
			case 'ground':
				valid = endpoint.port === 'in';
				break;
			case 'cnot':
				valid = ['in', 'out', 'control', 'target'].includes(endpoint.port);
				break;
			case 'ic':
				valid = validIcPort(component, endpoint.port);
				break;
		}
	}
	if (!valid) {
		throw new SchematicSyntaxError(
			`Port ${endpoint.componentId}.${endpoint.port} is invalid for ${component.kind}.`,
			line
		);
	}
}

/**
 * Parse and validate a schemd fenced-code information string.
 *
 * @param info - The complete Markdown fence information string beginning with
 *   the canonical `schemd` language identifier.
 * @param defaultTitle - Accessible SVG title used when `title` is omitted.
 * @returns Validated intrinsic bounds and title, or `undefined` when the fence
 *   belongs to another language.
 * @throws {SchematicSyntaxError} When a recognized fence has malformed
 *   metadata, out-of-range bounds, or a title longer than 512 characters.
 */
export function parseSchematicFence(
	info: string | undefined,
	defaultTitle = 'Engineering schematic'
): SchematicFence | undefined {
	if (info === undefined || !/^schemd(?:\s|$)/i.test(info.trim())) {
		return undefined;
	}
	const match = info.trim().match(SCHEMD_FENCE_PATTERN);
	if (!match) {
		throw new SchematicSyntaxError(
			'schemd fences require: schemd bounds="WIDTHxHEIGHT" title="Optional title".'
		);
	}
	const width = Number(match[1]);
	const height = Number(match[2]);
	if (width < 64 || height < 64 || width > 4096 || height > 4096) {
		throw new SchematicSyntaxError('Schematic bounds must be integers from 64 through 4096.');
	}
	const title = match[3] ?? defaultTitle;
	if (title.trim() === '') {
		throw new SchematicSyntaxError('Schematic titles cannot be empty.');
	}
	if (title.length > MAX_FENCE_TITLE_LENGTH) {
		throw new SchematicSyntaxError('Schematic titles cannot exceed 512 characters.');
	}
	return { bounds: { width, height }, title } satisfies SchematicFence;
}

/**
 * Compile validated schemd DSL source into an immutable schematic AST.
 *
 * @param source - Diagram declarations excluding the surrounding Markdown fence.
 * @param fence - Intrinsic dimensions and accessible title returned by
 *   {@link parseSchematicFence}.
 * @returns A deeply frozen, renderer-authorized schematic document.
 * @throws {SchematicSyntaxError} When syntax, resource budgets, port references,
 *   color values, component geometry, or connection geometry are invalid.
 */
export function parseSchematic(source: string, fence: SchematicFence): SchematicDocument {
	if (source.length > MAX_SCHEMATIC_SOURCE_CHARACTERS) {
		throw new SchematicSyntaxError('Schematic source exceeds the 131,072 character limit.');
	}
	const components: SchematicComponent[] = [];
	const connections: SchematicConnection[] = [];
	const componentIds = new Set<string>();
	for (const [lineIndex, rawLine] of source.replace(/\r\n?/g, '\n').split('\n').entries()) {
		const line = rawLine.trim();
		if (line === '' || line.startsWith('//')) continue;
		const lineNumber = lineIndex + 1;
		const componentMatch = line.match(COMPONENT_PATTERN);
		if (componentMatch) {
			if (components.length >= MAX_SCHEMATIC_COMPONENTS) {
				throw new SchematicSyntaxError('Schematic exceeds the 512 component limit.', lineNumber);
			}
			const component = parseComponent(componentMatch, lineNumber);
			if (componentIds.has(component.id)) {
				throw new SchematicSyntaxError(`Duplicate component ID ${component.id}.`, lineNumber);
			}
			validateComponent(component, fence);
			componentIds.add(component.id);
			components.push(component);
			continue;
		}
		const connectionMatch = line.match(CONNECTION_PATTERN);
		if (connectionMatch) {
			if (connections.length >= MAX_SCHEMATIC_CONNECTIONS) {
				throw new SchematicSyntaxError('Schematic exceeds the 2,048 connection limit.', lineNumber);
			}
			connections.push(parseConnection(connectionMatch, lineNumber));
			continue;
		}
		throw new SchematicSyntaxError('Unrecognized schematic declaration.', lineNumber);
	}
	if (components.length === 0) {
		throw new SchematicSyntaxError('A schematic must declare at least one component.');
	}
	const componentsById = new Map(components.map((component) => [component.id, component]));
	for (const connection of connections) {
		validateEndpoint(connection.from, componentsById, connection.line);
		validateEndpoint(connection.to, componentsById, connection.line);
	}
	const document = { components, connections } satisfies SchematicDocument;
	const routes = validateDocumentGeometry(document, fence);
	const parsedDocument = freezeParsedDocument(document);
	cacheParsedSchematicRoutes(parsedDocument, fence.bounds, routes);
	return parsedDocument;
}
