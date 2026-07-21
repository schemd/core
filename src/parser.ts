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
	ADDER_TYPES,
	AMPLIFIER_TYPES,
	ANALOG_KINDS,
	BUFFER_TYPES,
	BUS_TYPES,
	CLASSICAL_GATE_KINDS,
	COMPONENT_KINDS,
	DIGITAL_COMPONENT_KINDS,
	DIODE_TYPES,
	ELECTRICAL_COMPONENT_KINDS,
	FLIPFLOP_TYPES,
	GROUND_STYLES,
	LOAD_TYPES,
	LOGIC_STATES,
	METER_TYPES,
	MUX_TYPES,
	NAMED_QUANTUM_GATE_KINDS,
	PASSIVE_KINDS,
	POWER_TYPES,
	PROTECTION_TYPES,
	QUANTUM_GATE_KINDS,
	QUANTUM_SPECIAL_KINDS,
	RESONATOR_TYPES,
	SCHEMATIC_ORIENTATIONS,
	SCHEMATIC_SIGNAL_KINDS,
	SEMANTIC_COLORS,
	SCHEMATIC_SIGNAL_MARKERS,
	SOURCE_TYPES,
	SWITCH_TYPES,
	TRANSISTOR_TYPES,
	UML_COMPONENT_KINDS,
	UML_RELATION_KINDS,
	SchematicSyntaxError,
	type ClassicalGateComponent,
	type ComponentKind,
	type DiodeComponent,
	type DigitalComponent,
	type ElectricalComponent,
	type GroundComponent,
	type IcComponent,
	type IntegratedCircuitPins,
	type PortComponent,
	type QuantumGateComponent,
	type QuantumSpecialComponent,
	type SchematicColor,
	type SchematicComponent,
	type SchematicConnection,
	type SchematicDocument,
	type SchematicEndpoint,
	type SchematicFence,
	type SchematicSignalMarker,
	type SchematicSignalKind,
	type SchematicRelationKind,
	type SchematicOrientation,
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
	/^([A-Za-z][A-Za-z0-9_-]*)\.([A-Za-z][A-Za-z0-9_+-]*)\s*->\s*([A-Za-z][A-Za-z0-9_-]*)\.([A-Za-z][A-Za-z0-9_+-]*)\s+(.+)$/;
/**
 * Matches the canonical `schemd` Markdown information string. The legacy
 * `schematic` identifier remains an input-only alias so previously persisted
 * articles continue to render; documentation and generated source never emit it.
 */
const SCHEMD_FENCE_PATTERN = /^(?:schemd|schematic)\s+bounds="(\d+)x(\d+)"(?:\s+title="([^"]+)")?\s*$/i;
/** Strict finite decimal syntax used by CSS functional-color channels. */
const NUMBER_PATTERN = /^[+-]?(?:\d+\.?\d*|\.\d+)$/;
/** CSS angle syntax accepted for HSL hue channels. */
const ANGLE_PATTERN = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:deg|grad|rad|turn)?$/i;
/** Safe custom-property alias syntax, capped to prevent unbounded selectors. */
const ALIAS_PATTERN = /^[a-z][a-z0-9-]{0,63}$/i;
/** Addressable IC pin identifier syntax. */
const PIN_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
/** Explicit electrical/digital/quantum net identifier syntax. */
const NET_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
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
		if (
			component.kind === 'class' ||
			component.kind === 'interface' ||
			component.kind === 'enumeration' ||
			component.kind === 'datatype' ||
			component.kind === 'object'
		) {
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
 * @param document - Candidate AST supplied to a parsed-document consumer.
 * @throws {TypeError} When the object was forged, cloned, or parsed by another
 *   loaded copy of the package rather than this module instance.
 * @internal
 */
export function assertParsedSchematicDocument(document: SchematicDocument): void {
	if (!parsedDocuments.has(document)) {
		throw new TypeError(
			'This operation requires an immutable document returned by parseSchematic.'
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
		throw new SchematicSyntaxError(`Option ${name} must be one of: ${values.join(', ')}.`, line);
	}
	return value;
}

/** Parse an optional direction without materializing a legacy-default AST field. */
function parseOrientation(
	attributes: ReadonlyMap<string, string>,
	line: number
): { orientation?: SchematicOrientation } {
	const value = attributes.get('orientation');
	return value === undefined
		? {}
		: {
				orientation: parseEnumOption(
					value,
					'right',
					SCHEMATIC_ORIENTATIONS,
					'orientation',
					line
				)
			};
}

/** Parse a bounded scalar or bus width. */
function parseWidth(value: string | undefined, fallback: number, line: number): number {
	if (value === undefined) return fallback;
	if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 256) {
		throw new SchematicSyntaxError('width must be an integer from 1 through 256.', line);
	}
	return Number(value);
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
		assertOnlyAttributes(attributes, ['type', 'orientation'], line);
		const allowed =
			kind === 'resistor'
				? (['fixed', 'variable', 'rheostat', 'potentiometer', 'thermistor', 'ldr'] as const)
				: kind === 'capacitor'
					? (['fixed', 'variable', 'polarized'] as const)
					: (['fixed', 'coupled', 'transformer'] as const);
		const passiveType = parseEnumOption(attributes.get('type'), 'fixed', allowed, 'type', line);
		return passiveType === 'fixed'
			? { kind, ...common, ...parseOrientation(attributes, line) }
			: { kind, ...common, passiveType, ...parseOrientation(attributes, line) };
	}
	if (includesValue(ANALOG_KINDS, kind)) {
		switch (kind) {
			case 'diode':
				assertOnlyAttributes(attributes, ['type', 'orientation'], line);
				return {
					kind,
					...common,
					diodeType: parseEnumOption(attributes.get('type'), 'standard', DIODE_TYPES, 'type', line),
					...parseOrientation(attributes, line)
				} satisfies DiodeComponent;
			case 'transistor':
				assertOnlyAttributes(attributes, ['type', 'orientation'], line);
				return {
					kind,
					...common,
					transistorType: parseEnumOption(
						attributes.get('type'),
						'npn',
						TRANSISTOR_TYPES,
						'type',
						line
					),
					...parseOrientation(attributes, line)
				} satisfies TransistorComponent;
			case 'port': {
				assertOnlyAttributes(attributes, ['width', 'orientation'], line);
				const width = parseWidth(attributes.get('width'), 1, line);
				return width === 1
					? { kind, ...common, ...parseOrientation(attributes, line) }
					: { kind, ...common, width, ...parseOrientation(attributes, line) } satisfies PortComponent;
			}
			case 'ground':
				assertOnlyAttributes(attributes, ['style', 'orientation'], line);
				return {
					kind,
					...common,
					groundStyle: parseEnumOption(
						attributes.get('style'),
						'signal',
						GROUND_STYLES,
						'style',
						line
					),
					...parseOrientation(attributes, line)
				} satisfies GroundComponent;
		}
	}
	if (includesValue(ELECTRICAL_COMPONENT_KINDS, kind)) {
		if (kind === 'junction' || kind === 'testpoint') {
			assertOnlyAttributes(attributes, [], line);
			return { kind, ...common } satisfies ElectricalComponent;
		}
		if (kind === 'connector') {
			assertOnlyAttributes(attributes, ['orientation'], line);
			return { kind, ...common, ...parseOrientation(attributes, line) } satisfies ElectricalComponent;
		}
		assertOnlyAttributes(attributes, ['type', 'orientation'], line);
		const variant =
			kind === 'source'
				? parseEnumOption(attributes.get('type'), 'voltage-dc', SOURCE_TYPES, 'type', line)
				: kind === 'power'
					? parseEnumOption(attributes.get('type'), 'vcc', POWER_TYPES, 'type', line)
					: kind === 'switch'
						? parseEnumOption(attributes.get('type'), 'spst', SWITCH_TYPES, 'type', line)
						: kind === 'protection'
							? parseEnumOption(attributes.get('type'), 'fuse', PROTECTION_TYPES, 'type', line)
							: kind === 'amplifier'
								? parseEnumOption(attributes.get('type'), 'opamp', AMPLIFIER_TYPES, 'type', line)
								: kind === 'resonator'
									? parseEnumOption(attributes.get('type'), 'crystal', RESONATOR_TYPES, 'type', line)
									: kind === 'meter'
										? parseEnumOption(attributes.get('type'), 'voltmeter', METER_TYPES, 'type', line)
										: parseEnumOption(attributes.get('type'), 'lamp', LOAD_TYPES, 'type', line);
		return { kind, ...common, variant, ...parseOrientation(attributes, line) } satisfies ElectricalComponent;
	}
	if (includesValue(CLASSICAL_GATE_KINDS, kind)) {
		assertOnlyAttributes(attributes, ['inputs', 'outputs', 'standard', 'orientation'], line);
		const standard = attributes.get('standard') ?? 'ieee';
		if (standard !== 'ieee' && standard !== 'iec') {
			throw new SchematicSyntaxError('standard must be ieee or iec.', line);
		}
		return {
			kind,
			...common,
			inputs: parseCount(attributes.get('inputs'), kind === 'not' ? 1 : 2, 'inputs', line),
			outputs: parseCount(attributes.get('outputs'), 1, 'outputs', line),
			standard,
			...parseOrientation(attributes, line)
		} satisfies ClassicalGateComponent;
	}
	if (includesValue(DIGITAL_COMPONENT_KINDS, kind)) {
		assertOnlyAttributes(attributes, ['type', 'inputs', 'outputs', 'width', 'orientation'], line);
		const defaults: Readonly<Record<typeof kind, readonly [number, number]>> = {
			buffer: [1, 1], logic: [0, 1], clock: [0, 1], flipflop: [3, 2], mux: [2, 1],
			encoder: [4, 2], decoder: [2, 4], register: [3, 2], counter: [3, 2], adder: [2, 2],
			comparator: [2, 3], bus: [1, 2]
		};
		const [defaultInputs, defaultOutputs] = defaults[kind];
		let inputs = parseCount(attributes.get('inputs'), defaultInputs === 0 ? 1 : defaultInputs, 'inputs', line);
		let outputs = parseCount(attributes.get('outputs'), defaultOutputs, 'outputs', line);
		if ((kind === 'logic' || kind === 'clock') && attributes.has('inputs')) {
			throw new SchematicSyntaxError(`${kind} does not accept inputs.`, line);
		}
		const width = parseWidth(attributes.get('width'), kind === 'bus' || kind === 'register' ? 8 : 1, line);
		if (attributes.has('width') && kind !== 'bus' && kind !== 'register') {
			throw new SchematicSyntaxError(`Option width is not supported for ${kind}.`, line);
		}
		if (kind === 'bus' && width < 2) {
			throw new SchematicSyntaxError('Bus width must be at least 2.', line);
		}
		const variant =
			kind === 'buffer'
				? parseEnumOption(attributes.get('type'), 'plain', BUFFER_TYPES, 'type', line)
				: kind === 'logic'
					? parseEnumOption(attributes.get('type'), 'low', LOGIC_STATES, 'type', line)
					: kind === 'flipflop'
						? parseEnumOption(attributes.get('type'), 'd', FLIPFLOP_TYPES, 'type', line)
						: kind === 'mux'
							? parseEnumOption(attributes.get('type'), 'mux', MUX_TYPES, 'type', line)
							: kind === 'adder'
								? parseEnumOption(attributes.get('type'), 'half', ADDER_TYPES, 'type', line)
								: kind === 'bus'
									? parseEnumOption(attributes.get('type'), 'splitter', BUS_TYPES, 'type', line)
									: undefined;
		if (variant === undefined && attributes.has('type')) {
			throw new SchematicSyntaxError(`Option type is not supported for ${kind}.`, line);
		}
		if (kind === 'adder' && variant === 'full' && !attributes.has('inputs')) inputs = 3;
		if (kind === 'mux' && variant === 'demux') {
			if (!attributes.has('inputs')) inputs = 1;
			if (!attributes.has('outputs')) outputs = 2;
		}
		if (kind === 'bus' && variant === 'joiner' && !attributes.has('outputs')) outputs = 1;
		if ((kind === 'buffer' && (inputs !== 1 || outputs !== 1)) || ((kind === 'logic' || kind === 'clock') && outputs !== 1)) {
			throw new SchematicSyntaxError(`${kind} has fixed terminal counts.`, line);
		}
		const bodyHeight = Math.max(52, Math.max(inputs, outputs) * 16 + 20);
		const digital: DigitalComponent = {
			kind, ...common, inputs: kind === 'logic' || kind === 'clock' ? 0 : inputs, outputs, width,
			bodyWidth: kind === 'buffer' || kind === 'logic' || kind === 'clock' ? 56 : 84,
			bodyHeight,
			...parseOrientation(attributes, line)
		};
		if (variant !== undefined) digital.variant = variant;
		return digital;
	}
	if (kind === 'ic') {
		assertOnlyAttributes(attributes, ['left', 'right', 'top', 'bottom', 'orientation'], line);
		const pins = parseIcPins(attributes, line);
		return {
			kind,
			...common,
			pins,
			...integratedCircuitDimensions(pins),
			...parseOrientation(attributes, line)
		} satisfies IcComponent;
	}
	if (includesValue(UML_COMPONENT_KINDS, kind)) {
		switch (kind) {
			case 'class':
			case 'interface':
			case 'enumeration':
			case 'datatype':
			case 'object': {
				assertOnlyAttributes(attributes, ['attributes', 'operations', 'stereotype', 'width'], line);
				const classAttributes = parseUmlRows(attributes.get('attributes'), 'attributes', line);
				const operations = parseUmlRows(attributes.get('operations'), 'operations', line);
				const stereotype =
					attributes.get('stereotype') ??
					(kind === 'interface' || kind === 'enumeration' || kind === 'datatype' ? kind : undefined);
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
			case 'history':
				assertOnlyAttributes(attributes, ['type'], line);
				return {
					kind,
					...common,
					variant: parseEnumOption(attributes.get('type'), 'shallow', ['shallow', 'deep'] as const, 'type', line)
				};
			case 'usecase':
			case 'lifeline':
			case 'note':
			case 'package':
			case 'component':
			case 'artifact':
			case 'node':
			case 'device':
			case 'execution':
			case 'system':
			case 'action':
			case 'object-node':
			case 'partition':
			case 'activation':
			case 'fragment':
			case 'interaction':
			case 'region': {
				assertOnlyAttributes(attributes, ['width', 'height'], line);
				const defaultWidth = Math.max(
					kind === 'usecase' ? 112 : 96,
					mathLabelTextWidth(common.label, 8) + 28
				);
				const defaultHeight = kind === 'lifeline' ? 180 : kind === 'activation' ? 96 : kind === 'usecase' ? 56 : 64;
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
			case 'provided-interface':
			case 'required-interface':
			case 'component-port':
			case 'decision':
			case 'merge':
			case 'fork':
			case 'join':
			case 'activity-final':
			case 'flow-final':
			case 'send-signal':
			case 'receive-signal':
			case 'destruction':
			case 'gate':
			case 'found':
			case 'lost':
			case 'choice':
			case 'state-junction':
			case 'entry':
			case 'exit':
			case 'terminate':
			case 'initial':
			case 'final':
				assertOnlyAttributes(attributes, [], line);
				return { kind, ...common };
		}
	}
	if (includesValue(QUANTUM_GATE_KINDS, kind)) {
		const detailed = kind === 'qgate' || includesValue(NAMED_QUANTUM_GATE_KINDS, kind);
		assertOnlyAttributes(attributes, detailed ? ['parameter', 'matrix', 'phase', 'orientation'] : ['orientation'], line);
		const component: QuantumGateComponent = { kind, ...common, ...parseOrientation(attributes, line) };
		if (detailed) {
			const parameter = attributes.get('parameter');
			const matrix = attributes.get('matrix');
			const phase = attributes.get('phase');
			if (parameter !== undefined) component.parameter = parameter;
			if (matrix !== undefined) component.matrix = matrix;
			if (phase !== undefined) component.phase = phase;
		}
		return component;
	}
	if (includesValue(QUANTUM_SPECIAL_KINDS, kind)) {
		assertOnlyAttributes(attributes, ['control', 'operator', 'controls', 'targets', 'wires', 'width', 'orientation'], line);
		if (attributes.has('control') && kind !== 'control' && kind !== 'controlled') {
			throw new SchematicSyntaxError(`Option control is not supported for ${kind}.`, line);
		}
		if (attributes.has('operator') && kind !== 'controlled') {
			throw new SchematicSyntaxError(`Option operator is not supported for ${kind}.`, line);
		}
		if ((attributes.has('controls') || attributes.has('targets')) && !['controlled', 'cz', 'cphase', 'toffoli', 'swap'].includes(kind)) {
			throw new SchematicSyntaxError(`Control/target counts are not supported for ${kind}.`, line);
		}
		if (attributes.has('wires') && kind !== 'barrier' && kind !== 'delay') {
			throw new SchematicSyntaxError(`Option wires is not supported for ${kind}.`, line);
		}
		if (attributes.has('width') && kind !== 'classical-register') {
			throw new SchematicSyntaxError(`Option width is not supported for ${kind}.`, line);
		}
		const controlType = parseEnumOption(attributes.get('control'), 'positive', ['positive', 'negative', 'classical'] as const, 'control', line);
		const controlled = kind === 'controlled' || kind === 'cz' || kind === 'cphase' || kind === 'toffoli';
		const component: QuantumSpecialComponent = {
			kind, ...common,
			controls: parseCount(attributes.get('controls'), kind === 'toffoli' ? 2 : controlled ? 1 : 0, 'controls', line),
			targets: parseCount(attributes.get('targets'), kind === 'swap' ? 2 : controlled ? 1 : 0, 'targets', line),
			wires: parseCount(attributes.get('wires'), kind === 'barrier' || kind === 'delay' ? 2 : 1, 'wires', line),
			width: parseWidth(attributes.get('width'), kind === 'classical-register' ? 8 : 1, line),
			...parseOrientation(attributes, line)
		};
		if (kind === 'classical-register' && component.width < 2) {
			throw new SchematicSyntaxError('Classical register width must be at least 2.', line);
		}
		if (kind === 'control' || kind === 'controlled') component.controlType = controlType;
		const operator = attributes.get('operator');
		if (operator !== undefined) component.operator = operator;
		return component;
	}
	throw new SchematicSyntaxError(`Unsupported component kind ${kind}.`, line);
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
	/** Optional non-default signal domain. */
	signalKind: SchematicSignalKind | undefined;
	/** Optional explicit topology name. */
	net: string | undefined;
	/** Optional explicit scalar/bus width. */
	width: number | undefined;
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
	let signalKind: SchematicSignalKind | undefined;
	let net: string | undefined;
	let width: number | undefined;
	if (raw === undefined || raw.trim() === '') {
		return { curve, markerStart, markerEnd, relation, label, dashed, signalKind, net, width };
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
		if (includesValue(SCHEMATIC_SIGNAL_KINDS, token)) {
			if (seen.has('signal')) {
				throw new SchematicSyntaxError('Connection signal kind can only be declared once.', line);
			}
			signalKind = token;
			seen.add('signal');
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
		const match = token.match(/^(marker-start|marker-end|relation|label|signal|net|width)=(.*)$/);
		if (!match) {
			throw new SchematicSyntaxError(
				'Unsupported connection routing, topology, marker, relation, label, or stroke option.',
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
		} else if (option === 'signal') {
			if (!includesValue(SCHEMATIC_SIGNAL_KINDS, optionValue)) {
				throw new SchematicSyntaxError(
					`signal must be one of: ${SCHEMATIC_SIGNAL_KINDS.join(', ')}.`,
					line
				);
			}
			signalKind = optionValue;
		} else if (option === 'net') {
			if (!NET_NAME_PATTERN.test(optionValue)) {
				throw new SchematicSyntaxError(
					'net must begin with a letter and contain at most 64 letters, digits, underscores, or hyphens.',
					line
				);
			}
			net = optionValue;
		} else if (option === 'width') {
			width = parseWidth(optionValue, 1, line);
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
			relation === 'asynchronous' ||
			relation === 'return' ||
			relation === 'control-flow' ||
			relation === 'object-flow' ||
			relation === 'transition' ||
			relation === 'include' ||
			relation === 'extend'
		) {
			markerEnd = 'open-arrow';
		} else if (relation === 'synchronous') markerEnd = 'arrow';
	}
	if (!seen.has('stroke-style')) {
		dashed = ['dependency', 'realization', 'return', 'include', 'extend'].includes(relation);
	}
	if (label === undefined && (relation === 'include' || relation === 'extend')) {
		label = `«${relation}»`;
	}
	return { curve, markerStart, markerEnd, relation, label, dashed, signalKind, net, width };
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
	if (options.signalKind !== undefined) connection.signalKind = options.signalKind;
	if (options.net !== undefined) connection.net = options.net;
	if (options.width !== undefined) connection.width = options.width;
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

function isDigitalComponent(component: SchematicComponent): component is DigitalComponent {
	return DIGITAL_COMPONENT_KINDS.includes(component.kind as DigitalComponent['kind']);
}

function isQuantumSpecial(
	component: SchematicComponent
): component is QuantumSpecialComponent {
	return QUANTUM_SPECIAL_KINDS.includes(component.kind as QuantumSpecialComponent['kind']);
}

/** Validate an indexed `inN`/`outN` terminal pair. */
function validIndexedPort(port: string, inputs: number, outputs: number): boolean {
	if (port === 'in') return inputs > 0;
	if (port === 'out') return outputs > 0;
	const match = port.match(/^(in|out)([1-9]\d*)$/);
	if (match === null) return false;
	const count = match[1] === 'in' ? inputs : outputs;
	return Number(match[2]) <= count;
}

/** Validate compact block-specific digital control and data terminals. */
function validDigitalPort(component: DigitalComponent, port: string): boolean {
	if (validIndexedPort(port, component.inputs, component.outputs)) return true;
	switch (component.kind) {
		case 'buffer':
			return component.variant?.startsWith('tristate') === true && port === 'enable';
		case 'flipflop':
			return ['d', 'j', 'k', 's', 'r', 't', 'clock', 'enable', 'preset', 'clear', 'q', 'nq'].includes(port);
		case 'mux':
			return port === 'select' || port === 'enable';
		case 'register':
		case 'counter':
			return ['clock', 'enable', 'preset', 'clear'].includes(port);
		case 'comparator':
			return ['gt', 'eq', 'lt'].includes(port);
		case 'bus':
			return ['bus', 'tap'].includes(port);
		default:
			return false;
	}
}

/** Validate exact track-aware quantum ports. */
function validQuantumSpecialPort(component: QuantumSpecialComponent, port: string): boolean {
	if (component.kind === 'prepare') return port === 'out';
	if (component.kind === 'control') return ['in', 'out', 'control'].includes(port);
	if (component.kind === 'measure') return ['in', 'out', 'classical'].includes(port);
	if (component.kind === 'classical-bit' || component.kind === 'classical-register') {
		return port === 'in' || port === 'out';
	}
	const tracks = Math.max(component.wires, component.controls + component.targets);
	return validIndexedPort(port, tracks, tracks) ||
		(/^control[1-9]\d*$/.test(port) && Number(port.slice(7)) <= component.controls) ||
		(/^target[1-9]\d*$/.test(port) && Number(port.slice(6)) <= component.targets);
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
	} else if (isDigitalComponent(component)) {
		valid = validDigitalPort(component, endpoint.port);
	} else if (isQuantumSpecial(component)) {
		valid = validQuantumSpecialPort(component, endpoint.port);
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
			case 'xgate':
			case 'ygate':
			case 'zgate':
			case 'sgate':
			case 'sdg':
			case 'tgate':
			case 'tdg':
			case 'sx':
			case 'phase':
			case 'rx':
			case 'ry':
			case 'rz':
			case 'ugate':
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
			case 'junction':
			case 'testpoint':
				valid = ['in', 'out', 'node'].includes(endpoint.port);
				break;
			case 'connector':
				valid = endpoint.port === 'in' || endpoint.port === 'out';
				break;
			case 'source':
				valid = ['in', 'out', 'positive', 'negative'].includes(endpoint.port) ||
					(['vcvs', 'vccs', 'ccvs', 'cccs'].includes(String(component.variant)) && ['control-positive', 'control-negative'].includes(endpoint.port));
				break;
			case 'power':
				valid = endpoint.port === 'in';
				break;
			case 'switch':
				valid = component.variant === 'spdt'
					? ['in', 'out', 'common', 'normally-open', 'normally-closed'].includes(endpoint.port)
					: component.variant === 'relay'
						? ['in', 'out', 'coil1', 'coil2'].includes(endpoint.port)
						: ['in', 'out'].includes(endpoint.port);
				break;
			case 'amplifier':
				valid = ['in', 'positive', 'negative', 'out', 'v+', 'v-'].includes(endpoint.port);
				break;
			case 'protection':
			case 'resonator':
			case 'meter':
			case 'load':
				valid = ['in', 'out'].includes(endpoint.port);
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

/** Return the exact scalar/bus width exposed by one validated endpoint. */
function endpointWidth(
	endpoint: SchematicEndpoint,
	components: ReadonlyMap<string, SchematicComponent>
): number {
	const component = components.get(endpoint.componentId)!;
	if (component.kind === 'port') return component.width ?? 1;
	if (component.kind === 'classical-register') return component.width;
	if (isDigitalComponent(component)) {
		if (component.kind === 'register' && (endpoint.port === 'in' || endpoint.port === 'out')) {
			return component.width;
		}
		if (component.kind === 'bus' && endpoint.port === 'bus') return component.width;
	}
	return 1;
}

/** Reject scalar/bus ambiguity and incompatible endpoint widths. */
function validateConnectionWidth(
	connection: SchematicConnection,
	components: ReadonlyMap<string, SchematicComponent>
): void {
	const sourceWidth = endpointWidth(connection.from, components);
	const targetWidth = endpointWidth(connection.to, components);
	const width = connection.width ?? 1;
	if ((sourceWidth > 1 || targetWidth > 1) && connection.width === undefined) {
		throw new SchematicSyntaxError('Bus connections require an explicit width option.', connection.line);
	}
	if (sourceWidth !== targetWidth || width !== sourceWidth) {
		throw new SchematicSyntaxError(
			`Connection width ${width} is incompatible with ${sourceWidth}-bit source and ${targetWidth}-bit target ports.`,
			connection.line
		);
	}
}

/**
 * Resolve explicit names and shared terminals into deterministic signal nets.
 *
 * A disjoint segment may join a named net with `net=NAME`; connections sharing
 * an exact component port join implicitly. UML relations remain connectors, not
 * electrical topology, and therefore never receive a net identity.
 */
function assignConnectionNetIds(connections: SchematicConnection[]): void {
	const parent = connections.map((_, index) => index);
	const find = (index: number): number => {
		let root = index;
		while (parent[root] !== root) root = parent[root]!;
		while (parent[index] !== index) {
			const next = parent[index]!;
			parent[index] = root;
			index = next;
		}
		return root;
	};
	const union = (left: number, right: number): void => {
		const leftRoot = find(left);
		const rightRoot = find(right);
		if (leftRoot !== rightRoot) parent[rightRoot] = leftRoot;
	};
	const terminalOwner = new Map<string, number>();
	const namedOwner = new Map<string, number>();
	for (const [index, connection] of connections.entries()) {
		if (connection.relation !== 'signal') {
			if (connection.net !== undefined) {
				throw new SchematicSyntaxError('Only signal connections may declare a net.', connection.line);
			}
			continue;
		}
		for (const endpoint of [connection.from, connection.to]) {
			const key = `${endpoint.componentId}.${endpoint.port}`;
			const owner = terminalOwner.get(key);
			if (owner === undefined) terminalOwner.set(key, index);
			else union(index, owner);
		}
		if (connection.net !== undefined) {
			const owner = namedOwner.get(connection.net);
			if (owner === undefined) namedOwner.set(connection.net, index);
			else union(index, owner);
		}
	}

	const names = new Map<number, string>();
	const contracts = new Map<number, { signalKind: SchematicSignalKind; width: number }>();
	for (const [index, connection] of connections.entries()) {
		if (connection.relation !== 'signal') continue;
		const root = find(index);
		if (connection.net !== undefined) {
			const existing = names.get(root);
			if (existing !== undefined && existing !== connection.net) {
				throw new SchematicSyntaxError(
					`Terminal joins conflicting nets ${existing} and ${connection.net}.`,
					connection.line
				);
			}
			names.set(root, connection.net);
		}
		const signalKind = connection.signalKind ?? 'electrical';
		const width = connection.width ?? 1;
		const contract = contracts.get(root);
		if (
			contract !== undefined &&
			(contract.signalKind !== signalKind || contract.width !== width)
		) {
			throw new SchematicSyntaxError(
				`Net segments must share one signal kind and width; expected ${contract.signalKind} width ${contract.width}.`,
				connection.line
			);
		}
		contracts.set(root, { signalKind, width });
	}

	const resolved = new Map<number, string>();
	let generated = 0;
	for (const [index, connection] of connections.entries()) {
		if (connection.relation !== 'signal') continue;
		const root = find(index);
		let netId = resolved.get(root);
		if (netId === undefined) {
			netId = names.get(root) ?? `$${++generated}`;
			resolved.set(root, netId);
		}
		connection.netId = netId;
	}
}

/**
 * Snapshot and validate the public parser's runtime fence boundary.
 *
 * TypeScript declarations do not protect JavaScript consumers, and retaining a
 * caller-owned bounds object would let accessors or later mutation change the
 * geometry contract between validation passes. The parser therefore consumes
 * each field once and routes against a fresh data-only record.
 */
function normalizeParserFence(value: unknown): SchematicFence {
	if (typeof value !== 'object' || value === null) {
		throw new SchematicSyntaxError('Parser options must be an object.');
	}
	const candidate = value as Record<string, unknown>;
	const rawBounds = candidate.bounds;
	if (typeof rawBounds !== 'object' || rawBounds === null) {
		throw new SchematicSyntaxError('Parser options require bounds.');
	}
	const bounds = rawBounds as Record<string, unknown>;
	const width = bounds.width;
	const height = bounds.height;
	const title = candidate.title;
	if (
		typeof width !== 'number' ||
		!Number.isInteger(width) ||
		typeof height !== 'number' ||
		!Number.isInteger(height) ||
		width < 64 ||
		height < 64 ||
		width > 4096 ||
		height > 4096
	) {
		throw new SchematicSyntaxError('Schematic bounds must be integers from 64 through 4096.');
	}
	if (typeof title !== 'string' || title.trim() === '') {
		throw new SchematicSyntaxError('Schematic titles cannot be empty.');
	}
	if (title.length > MAX_FENCE_TITLE_LENGTH) {
		throw new SchematicSyntaxError('Schematic titles cannot exceed 512 characters.');
	}
	return { bounds: { width, height }, title } satisfies SchematicFence;
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
	if (info === undefined || !/^(?:schemd|schematic)(?:\s|$)/i.test(info.trim())) {
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
	if (typeof source !== 'string') {
		throw new SchematicSyntaxError('Schematic source must be a string.');
	}
	if (source.length > MAX_SCHEMATIC_SOURCE_CHARACTERS) {
		throw new SchematicSyntaxError('Schematic source exceeds the 131,072 character limit.');
	}
	const normalizedFence = normalizeParserFence(fence);
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
			validateComponent(component, normalizedFence);
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
		validateConnectionWidth(connection, componentsById);
	}
	assignConnectionNetIds(connections);
	const document = { components, connections } satisfies SchematicDocument;
	const routes = validateDocumentGeometry(document, normalizedFence);
	const parsedDocument = freezeParsedDocument(document);
	cacheParsedSchematicRoutes(parsedDocument, normalizedFence.bounds, routes);
	return parsedDocument;
}
