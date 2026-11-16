/**
 * Front end: source text to a validated, immutable schematic document.
 *
 * The parser runs in phases — sub-circuit elaboration, declarations, placement,
 * references, topology, geometry — and reports through one channel. In
 * `parseSchematic` the first problem stops it, in the same order 0.x reported
 * problems; in `diagnoseSchematic` every independent problem is collected, with
 * the line and, where the scanner knows it, the column range. A declaration that
 * fails poisons its id, so a typo in one line does not reappear as "unknown
 * component" on every line that uses it.
 *
 * @packageDocumentation
 */
import { fromMilli, parseMilli } from './geom.js';
import { normalizeSchematicBounds, normalizeSchematicCanvas, normalizeSchematicTitle, resolveSchematicLimits, type SchematicResolvedLimits } from './limits.js';
import { validateSchematicGeometry } from './layout.js';
import { draftPlacements } from './draft.js';
import { fitComponents } from './fit.js';
import { resolvePlacements, type PendingPlacement } from './placement.js';
import { cacheParsedSchematicEvidence, cacheParsedSchematicRoutes } from './route-cache.js';
import { canonicalName, KINDS } from './symbols/index.js';
import { includesValue } from './symbols/common.js';
import {
	optionTokens,
	parseAttributes,
	parseConnectionOptions,
	parseSchematicColor,
	scanDeclaration,
	splitDeclarationTail,
	type DeclarationSyntax,
	type Token
} from './syntax.js';
import {
	COMPONENT_KINDS,
	SchematicSyntaxError,
	type SchematicComponent,
	type SchematicConnection,
	type SchematicDiagnosticCode,
	type SchematicDocument,
	type SchematicEndpoint,
	type SchematicFence,
	type SchematicPlacementRelation,
	type SchematicSignalKind,
	type SchematicSourceDiagnostic
} from './types.js';

export { parseSchematicColor };

const SCHEMD_FENCE_PATTERN = /^(?:schemd|schematic)\s+bounds="(?:(\d+)x(\d+)|(auto))"(?:\s+title="([^"]+)")?\s*$/i;

/* ---- provenance ---- */

const parsedDocuments = new WeakSet<SchematicDocument>();

function freezeDocument(document: SchematicDocument): SchematicDocument {
	for (const component of document.components) {
		Object.freeze(component.color);
		if (component.kind === 'ic') {
			for (const side of Object.values(component.pins)) Object.freeze(side);
			Object.freeze(component.pins);
		}
		if ('attributes' in component) {
			Object.freeze(component.attributes);
			Object.freeze(component.operations);
		}
		if (component.kind === 'state') Object.freeze(component.details);
		if ('rails' in component && component.rails !== undefined) Object.freeze(component.rails);
		if ('rows' in component && component.rows !== undefined) {
			Object.freeze(component.rows.left);
			Object.freeze(component.rows.right);
			Object.freeze(component.rows);
		}
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
 * @throws {TypeError} When the object was forged, cloned, or parsed elsewhere.
 * @internal
 */
export function assertParsedSchematicDocument(document: SchematicDocument): void {
	if (!parsedDocuments.has(document)) {
		throw new TypeError('This operation requires an immutable document returned by parseSchematic.');
	}
}

/* ---- fences ---- */

interface NormalizedFence extends SchematicFence {
	readonly limits: SchematicResolvedLimits;
}

function normalizeFence(value: unknown): NormalizedFence {
	if (typeof value !== 'object' || value === null) throw new SchematicSyntaxError('Parser options must be an object.');
	const candidate = value as Record<string, unknown>;
	return {
		bounds: normalizeSchematicCanvas(candidate.bounds, 'Schematic'),
		title: normalizeSchematicTitle(candidate.title, 'Schematic'),
		limits: resolveSchematicLimits(candidate.limits)
	};
}

/**
 * Parse and validate a schemd fenced-code information string.
 *
 * @returns Validated bounds and title, or `undefined` for another language.
 */
export function parseSchematicFence(info: string | undefined, defaultTitle = 'Engineering schematic'): SchematicFence | undefined {
	if (info === undefined || !/^(?:schemd|schematic)(?:\s|$)/i.test(info.trim())) return undefined;
	const match = SCHEMD_FENCE_PATTERN.exec(info.trim());
	if (match === null) throw new SchematicSyntaxError('schemd fences require: schemd bounds="WIDTHxHEIGHT" title="Optional title".');
	return {
		bounds: match[3] === undefined ? normalizeSchematicBounds(Number(match[1]), Number(match[2]), 'Schematic') : 'auto',
		title: normalizeSchematicTitle(match[4] ?? defaultTitle, 'Schematic')
	};
}

/* ---- sub-circuits ---- */

/** One source line, after elaboration, with the line that wrote it. */
interface SourceLine {
	readonly text: string;
	readonly line: number;
	/** Columns the line was indented by in the source, so spans stay true. */
	readonly indent: number;
	/** Set when parameter substitution changed the text: its columns no longer match the source. */
	readonly shifted?: boolean;
}

const HEADER = /^subcircuit\s+([A-Za-z][A-Za-z0-9_-]*)\s*(?:\[(.*)\])?\s*\{$/;
const INSTANCE = /^([A-Za-z][A-Za-z0-9_-]*):([A-Za-z][A-Za-z0-9_-]*)\s+at\s+\((-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)\)\s*(?:\[(.*)\])?$/;
const EXPOSE = /^expose\s+([A-Za-z][A-Za-z0-9_+-]*)\s*=\s*([A-Za-z][A-Za-z0-9_-]*)\.([A-Za-z][A-Za-z0-9_+-]*)$/;
const PARAMETER = /^([A-Za-z][A-Za-z0-9_-]*)(?:=(?:"([^"]*)"|([^\s"]+)))?$/;
const PLACEHOLDER = /\{\{([A-Za-z][A-Za-z0-9_-]*)\}\}/g;

interface Definition {
	readonly line: number;
	readonly parameters: ReadonlyMap<string, string | undefined>;
	readonly body: readonly SourceLine[];
	used: boolean;
}

/** An elaborated declaration: scanned syntax plus the renaming its instance applies. */
interface Elaborated {
	readonly syntax: DeclarationSyntax | undefined;
	readonly source: SourceLine;
	readonly prefix: string;
	readonly dx: number;
	readonly dy: number;
}

function parameters(raw: string | undefined, line: number, requireValues: boolean): Map<string, string | undefined> {
	const result = new Map<string, string | undefined>();
	if (raw === undefined || raw.trim() === '') return result;
	if ((raw.match(/"/g)?.length ?? 0) % 2 !== 0) throw new SchematicSyntaxError('Subcircuit parameters have an unclosed quote.', line);
	for (const token of optionTokens(raw.trim(), line)) {
		const match = PARAMETER.exec(token);
		if (match === null) throw new SchematicSyntaxError(`Subcircuit parameters are written name="value"; ${token} is not one.`, line);
		const name = match[1]!;
		if (result.has(name)) throw new SchematicSyntaxError(`Subcircuit parameter ${name} is set twice.`, line);
		const value = match[2] ?? match[3];
		if (requireValues && value === undefined) throw new SchematicSyntaxError(`Parameter ${name} needs a value: ${name}="...".`, line);
		result.set(name, value);
	}
	return result;
}

/**
 * Elaborate sub-circuit definitions into declarations.
 *
 * Instances are expanded into the syntax stream rather than into text: each body
 * line is scanned once, with the instance's renaming carried alongside, and the
 * line it came from kept as its provenance. Parameters are substituted into the
 * body text first, because a placeholder may stand anywhere on a line — a label,
 * a colour, an option. Instances may nest; a definition that contains itself is
 * refused, and the expanded text is held to the source budget.
 */
function elaborate(lines: readonly SourceLine[], budget: number): { declarations: Elaborated[]; instances: Map<string, string>; exposures: Map<string, { id: string; port: string }> } {
	const definitions = new Map<string, Definition>();
	const top: SourceLine[] = [];
	let open: { name: string; line: number; parameters: Map<string, string | undefined>; body: SourceLine[] } | undefined;
	for (const source of lines) {
		const header = HEADER.exec(source.text);
		if (header !== null) {
			const name = header[1]!;
			if (open !== undefined) {
				throw new SchematicSyntaxError(`Subcircuit ${name} is declared inside subcircuit ${open.name}; close ${open.name} with } first. Definitions do not nest, though instances may.`, source.line);
			}
			if (includesValue(COMPONENT_KINDS, name)) throw new SchematicSyntaxError(`Subcircuit ${name} would shadow the built-in ${name} component; choose another name.`, source.line);
			const existing = definitions.get(name);
			if (existing !== undefined) throw new SchematicSyntaxError(`Subcircuit ${name} is already declared on line ${existing.line}.`, source.line);
			open = { name, line: source.line, parameters: parameters(header[2], source.line, false), body: [] };
		} else if (open === undefined) top.push(source);
		else if (source.text === '}') {
			definitions.set(open.name, { line: open.line, parameters: open.parameters, body: open.body, used: false });
			open = undefined;
		} else open.body.push(source);
	}
	if (open !== undefined) throw new SchematicSyntaxError(`Subcircuit ${open.name} is never closed; end it with a line holding only }.`, open.line);

	const instances = new Map<string, string>();
	const exposures = new Map<string, { id: string; port: string }>();
	const declarations: Elaborated[] = [];
	let characters = 0;
	const expand = (body: readonly SourceLine[], prefix: string, dx: number, dy: number, values: ReadonlyMap<string, string>, stack: readonly string[]): void => {
		for (const source of body) {
			const text =
				prefix === ''
					? source.text
					: source.text.replace(PLACEHOLDER, (_, key: string) => {
							const value = values.get(key);
							if (value === undefined) throw new SchematicSyntaxError(`{{${key}}} is not a parameter of subcircuit ${stack.at(-1)}; declare it in the header as ${key}="default".`, source.line);
							return value;
						});
			if (text === '' || text.startsWith('//')) continue;
			const kind = /^([A-Za-z][A-Za-z0-9_-]*):/.exec(text)?.[1];
			const definition = kind === undefined ? undefined : definitions.get(kind);
			if (definition !== undefined) {
				const instance = INSTANCE.exec(text);
				if (instance === null) {
					throw new SchematicSyntaxError(`Place subcircuit ${kind} as ${kind}:ID at (x, y), optionally followed by [name="value"]; an instance has no label or colour of its own.`, source.line);
				}
				const id = prefix + instance[2]!;
				if (stack.includes(kind!)) {
					throw new SchematicSyntaxError(`Subcircuit ${kind} contains itself through ${[...stack.slice(stack.indexOf(kind!)), kind].join(' -> ')}; a subcircuit cannot contain itself.`, source.line);
				}
				if (instances.has(id)) throw new SchematicSyntaxError(`Duplicate component ID ${id}.`, source.line);
				const supplied = parameters(instance[5], source.line, true);
				const bound = new Map<string, string>();
				for (const [parameter, fallback] of definition.parameters) {
					const value = supplied.get(parameter) ?? fallback;
					if (value === undefined) throw new SchematicSyntaxError(`${id} must set ${parameter}: subcircuit ${kind} declares it without a default.`, source.line);
					bound.set(parameter, value);
				}
				for (const parameter of supplied.keys()) {
					if (!definition.parameters.has(parameter)) {
						throw new SchematicSyntaxError(
							`Subcircuit ${kind} has no parameter ${parameter}; it declares ${definition.parameters.size === 0 ? 'none' : [...definition.parameters.keys()].join(', ')}.`,
							source.line
						);
					}
				}
				instances.set(id, kind!);
				definition.used = true;
				expand(definition.body, `${id}_`, dx + parseMilli(instance[3]!), dy + parseMilli(instance[4]!), bound, [...stack, kind!]);
				continue;
			}
			const exposure = EXPOSE.exec(text);
			if (exposure !== null) {
				if (prefix === '') throw new SchematicSyntaxError('expose only belongs inside a subcircuit definition.', source.line);
				const key = `${prefix.slice(0, -1)}.${exposure[1]}`;
				if (exposures.has(key)) throw new SchematicSyntaxError(`Subcircuit ${stack.at(-1)} exposes ${exposure[1]} twice.`, source.line);
				exposures.set(key, { id: prefix + exposure[2]!, port: exposure[3]! });
				continue;
			}
			characters += text.length + prefix.length;
			if (characters > budget) {
				throw new SchematicSyntaxError(
					`Expanding subcircuits produces more than the ${budget.toLocaleString('en-US')} character source limit; place fewer instances, or raise limits.sourceCharacters.`,
					source.line,
					undefined,
					'limit'
				);
			}
			declarations.push({ syntax: scanDeclaration(text), source: text === source.text ? source : { ...source, text, shifted: true }, prefix, dx, dy });
		}
	};
	expand(top, '', 0, 0, new Map(), []);
	for (const [name, definition] of definitions) {
		if (!definition.used) throw new SchematicSyntaxError(`Subcircuit ${name} is declared but never placed; add ${name}:ID at (x, y), or remove it.`, definition.line);
	}
	return { declarations, instances, exposures };
}

/* ---- the analysis ---- */

/** Collects problems; in strict mode the first one throws. */
class Reporter {
	readonly diagnostics: SchematicSourceDiagnostic[] = [];
	constructor(readonly strict: boolean) {}

	/**
	 * Record one problem. A caller may supply the phase and a fallback column
	 * range; whatever the error already carries wins.
	 */
	report(error: unknown, code?: SchematicDiagnosticCode, fallback?: { column: number; endColumn: number }): void {
		/* v8 ignore next -- every compiler failure is a SchematicSyntaxError; anything else is a defect. */
		if (!(error instanceof SchematicSyntaxError)) throw error;
		const finalCode = error.code !== 'syntax' ? error.code : (code ?? 'syntax');
		const finalSpan = error.column !== undefined ? { column: error.column, endColumn: error.endColumn! } : error.line === undefined ? undefined : fallback;
		const message = error.line === undefined ? error.message : error.message.slice(`Line ${error.line}: `.length);
		const located =
			finalCode === error.code && finalSpan?.column === error.column ? error : new SchematicSyntaxError(message, error.line, finalSpan, finalCode);
		if (this.strict) throw located;
		this.diagnostics.push({
			code: located.code,
			message,
			...(located.line === undefined ? {} : { line: located.line }),
			...(located.column === undefined ? {} : { column: located.column, endColumn: located.endColumn! }),
			severity: 'error'
		});
	}

	get failed(): boolean {
		return this.diagnostics.length > 0;
	}
}

/** One-based column range of a token on its source line. */
/** Where a token sits in the source; nothing for a line whose text substitution moved. */
function span(source: SourceLine, item: Token | undefined): { column: number; endColumn: number } | undefined {
	if (source.shifted === true) return undefined;
	return item === undefined
		? { column: source.indent + 1, endColumn: source.indent + source.text.length + 1 }
		: { column: source.indent + item.start + 1, endColumn: source.indent + item.end + 1 };
}

/** Column ranges of a connection's two references: component then port, for each end. */
type EndpointSpans = readonly [Span, Span, Span, Span];
type Span = { column: number; endColumn: number } | undefined;

/** Resolve `U1.mid` through every level of nesting to the terminal it names. */
function terminal(id: string, port: string, line: number, instances: ReadonlyMap<string, string>, exposures: ReadonlyMap<string, { id: string; port: string }>): { id: string; port: string } {
	while (instances.has(id)) {
		const target = exposures.get(`${id}.${port}`);
		if (target === undefined) {
			const offered = [...exposures.keys()].filter((key) => key.startsWith(`${id}.`)).map((key) => key.slice(id.length + 1));
			throw new SchematicSyntaxError(
				`${id} is a ${instances.get(id)} subcircuit, which exposes ${offered.length === 0 ? 'no terminals' : offered.join(', ')}; it has no terminal ${port}.`,
				line,
				undefined,
				'reference'
			);
		}
		id = target.id;
		port = target.port;
	}
	return { id, port };
}

/** Validate a connection endpoint against the registry; returns the canonical port. */
function checkEndpoint(endpoint: SchematicEndpoint, components: ReadonlyMap<string, SchematicComponent>, line: number, idSpan: Span, portSpan: Span): void {
	const component = components.get(endpoint.componentId);
	if (component === undefined) throw new SchematicSyntaxError(`Unknown component ${endpoint.componentId}.`, line, idSpan, 'reference');
	if (canonicalName(component, endpoint.port) === undefined) {
		throw new SchematicSyntaxError(`Port ${endpoint.componentId}.${endpoint.port} is invalid for ${component.kind}.`, line, portSpan, 'reference');
	}
}

function endpointWidth(endpoint: SchematicEndpoint, components: ReadonlyMap<string, SchematicComponent>): number {
	const component = components.get(endpoint.componentId)!;
	if (component.kind === 'port') return component.width ?? 1;
	if (component.kind === 'classical-register') return component.width;
	if (component.kind === 'register' && (endpoint.port === 'in' || endpoint.port === 'out')) return component.width;
	if (component.kind === 'bus' && endpoint.port === 'bus') return component.width;
	return 1;
}

/** Resolve names and shared terminals into deterministic nets. */
function assignNets(connections: SchematicConnection[], reporter: Reporter): void {
	const parent = connections.map((_, index) => index);
	const find = (index: number): number => {
		while (parent[index] !== index) {
			parent[index] = parent[parent[index]!]!;
			index = parent[index]!;
		}
		return index;
	};
	const union = (left: number, right: number): void => {
		const a = find(left);
		const b = find(right);
		if (a !== b) parent[b] = a;
	};
	const terminals = new Map<string, number>();
	const names = new Map<string, number>();
	for (const [index, connection] of connections.entries()) {
		if (connection.relation !== 'signal') {
			if (connection.net !== undefined) reporter.report(new SchematicSyntaxError('Only signal connections may declare a net.', connection.line, undefined, 'topology'));
			continue;
		}
		for (const end of [connection.from, connection.to]) {
			const key = `${end.componentId}.${end.port}`;
			const owner = terminals.get(key);
			if (owner === undefined) terminals.set(key, index);
			else union(index, owner);
		}
		if (connection.net !== undefined) {
			const owner = names.get(connection.net);
			if (owner === undefined) names.set(connection.net, index);
			else union(index, owner);
		}
	}
	const named = new Map<number, string>();
	const contracts = new Map<number, { signalKind: SchematicSignalKind; width: number }>();
	for (const connection of connections) {
		if (connection.relation !== 'signal') continue;
		const root = find(connections.indexOf(connection));
		if (connection.net !== undefined) {
			const existing = named.get(root);
			if (existing !== undefined && existing !== connection.net) {
				reporter.report(new SchematicSyntaxError(`Terminal joins conflicting nets ${existing} and ${connection.net}.`, connection.line, undefined, 'topology'));
				continue;
			}
			named.set(root, connection.net);
		}
		const signalKind = connection.signalKind ?? 'electrical';
		const width = connection.width ?? 1;
		const contract = contracts.get(root);
		if (contract !== undefined && (contract.signalKind !== signalKind || contract.width !== width)) {
			reporter.report(
				new SchematicSyntaxError(`Net segments must share one signal kind and width; expected ${contract.signalKind} width ${contract.width}.`, connection.line, undefined, 'topology')
			);
			continue;
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
			netId = named.get(root) ?? `$${++generated}`;
			resolved.set(root, netId);
		}
		connection.netId = netId;
	}
}

/** Decide which end of each `trunk` connection joins copper wired above it. */
function resolveTrunks(connections: readonly SchematicConnection[], reporter: Reporter): void {
	const wired = new Set<string>();
	for (const connection of connections) {
		const from = `${connection.from.componentId}.${connection.from.port}`;
		const to = `${connection.to.componentId}.${connection.to.port}`;
		if (connection.trunk !== undefined) {
			const fail = (message: string) => reporter.report(new SchematicSyntaxError(message, connection.line, undefined, 'topology'));
			if (connection.relation !== 'signal' || connection.curve !== 'ortho') {
				fail(`${from} -> ${to} is marked trunk, which only applies to orthogonal signal wires; add ortho, or drop trunk.`);
			} else {
				const fromWired = wired.has(from);
				if (fromWired === wired.has(to)) {
					fail(
						fromWired
							? `${from} -> ${to} is marked trunk, but both terminals are already wired above it, so there is nothing new to branch out to; drop trunk.`
							: `${from} -> ${to} is marked trunk, but neither terminal is wired above it, so there is no copper to branch from; declare a connection that reaches ${from} or ${to} first, or drop trunk.`
					);
				} else {
					connection.trunk = fromWired ? 'from' : 'to';
					const marker = fromWired ? connection.markerStart : connection.markerEnd;
					if (marker !== 'none') {
						const joined = fromWired ? from : to;
						fail(`${from} -> ${to} branches off the trunk at ${joined}'s end, so its ${fromWired ? 'marker-start' : 'marker-end'} has no terminal to sit on; move the marker to the connection that reaches ${joined}.`);
					}
				}
			}
		}
		if (connection.relation === 'signal') {
			wired.add(from);
			wired.add(to);
		}
	}
}

/**
 * Run every phase over `source`, reporting through `reporter`.
 *
 * @returns The frozen document, or `undefined` when a problem was collected.
 */
function analyze(source: string, fence: SchematicFence, reporter: Reporter): SchematicDocument | undefined {
	if (typeof source !== 'string') throw new SchematicSyntaxError('Schematic source must be a string.');
	const normalized = normalizeFence(fence);
	const limits = normalized.limits;
	if (source.length > limits.sourceCharacters) {
		throw new SchematicSyntaxError(`Schematic source exceeds the ${limits.sourceCharacters.toLocaleString('en-US')} character limit.`, undefined, undefined, 'limit');
	}
	const raw = source.replace(/\r\n?/g, '\n').split('\n');
	const lines: SourceLine[] = raw.map((text, index) => {
		const trimmed = text.trim();
		return { text: trimmed, line: index + 1, indent: trimmed === '' ? 0 : text.indexOf(trimmed[0]!) };
	});
	let elaborated: ReturnType<typeof elaborate>;
	try {
		elaborated = lines.some((entry) => HEADER.test(entry.text))
			? elaborate(lines, limits.sourceCharacters)
			: {
					declarations: lines.filter((entry) => entry.text !== '' && !entry.text.startsWith('//')).map((entry) => ({ syntax: scanDeclaration(entry.text), source: entry, prefix: '', dx: 0, dy: 0 })),
					instances: new Map(),
					exposures: new Map()
				};
	} catch (error) {
		reporter.report(error);
		return undefined;
	}
	const { instances, exposures } = elaborated;

	const components: SchematicComponent[] = [];
	const connections: SchematicConnection[] = [];
	const byId = new Map<string, SchematicComponent>();
	const poisoned = new Set<string>();
	const endpointSpans = new Map<SchematicConnection, EndpointSpans>();
	const pending: PendingPlacement[] = [];
	/* Parts whose declarations state no position; the draft pass places them from their wires. */
	const drafted = new Set<SchematicComponent>();
	for (const { syntax, source: line, prefix, dx, dy } of elaborated.declarations) {
		if (syntax === undefined) {
			reporter.report(new SchematicSyntaxError('Unrecognized schematic declaration.', line.line, span(line, undefined)));
			continue;
		}
		if (syntax.form === 'connection') {
			if (connections.length >= limits.connections) {
				reporter.report(new SchematicSyntaxError(`Schematic exceeds the ${limits.connections.toLocaleString('en-US')} connection limit.`, line.line, undefined, 'limit'));
				break;
			}
			try {
				const tail = splitDeclarationTail(syntax.tail.text, line.line);
				const options = parseConnectionOptions(tail.options, line.line);
				let from = { id: prefix + syntax.fromId.text, port: syntax.fromPort.text };
				let to = { id: prefix + syntax.toId.text, port: syntax.toPort.text };
				from = terminal(from.id, from.port, line.line, instances, exposures);
				to = terminal(to.id, to.port, line.line, instances, exposures);
				const connection: SchematicConnection = {
					from: { componentId: from.id, port: from.port },
					to: { componentId: to.id, port: to.port },
					color: parseSchematicColor(tail.color, line.line),
					curve: options.curve,
					markerStart: options.markerStart,
					markerEnd: options.markerEnd,
					relation: options.relation,
					dashed: options.dashed,
					line: line.line
				};
				if (options.label !== undefined) connection.label = options.label;
				if (options.signalKind !== undefined) connection.signalKind = options.signalKind;
				if (options.net !== undefined) connection.net = options.net;
				if (options.width !== undefined) connection.width = options.width;
				if (options.trunk) connection.trunk = 'from';
				connections.push(connection);
				endpointSpans.set(connection, [span(line, syntax.fromId), span(line, syntax.fromPort), span(line, syntax.toId), span(line, syntax.toPort)]);
			} catch (error) {
				reporter.report(error, undefined, span(line, syntax.tail));
			}
			continue;
		}
		if (components.length >= limits.components) {
			reporter.report(new SchematicSyntaxError(`Schematic exceeds the ${limits.components.toLocaleString('en-US')} component limit.`, line.line, undefined, 'limit'));
			break;
		}
		const id = prefix + syntax.id.text;
		if (instances.has(id)) {
			reporter.report(new SchematicSyntaxError(`${id} names both a component and a subcircuit instance; rename one of them.`, line.line, span(line, syntax.id)));
			continue;
		}
		let component: SchematicComponent;
		try {
			const kind = syntax.kind.text.toLowerCase();
			const definition = KINDS[kind];
			if (definition === undefined) {
				throw new SchematicSyntaxError(`Unsupported component kind ${syntax.kind.text}.`, line.line, span(line, syntax.kind), 'reference');
			}
			const tail = splitDeclarationTail(syntax.tail.text, line.line, kind === 'ic');
			const options = parseAttributes(tail.options, line.line);
			const position =
				syntax.form === 'absolute'
					? { x: fromMilli(parseMilli(syntax.x.text) + dx), y: fromMilli(parseMilli(syntax.y.text) + dy) }
					: { x: 0, y: 0 };
			component = definition.parse(
				kind,
				{ id, label: syntax.label?.text ?? '', ...position, color: parseSchematicColor(tail.color === '' ? 'slate' : tail.color, line.line), line: line.line },
				options,
				line.line
			);
		} catch (error) {
			poisoned.add(id);
			reporter.report(error, 'option', span(line, syntax.tail));
			continue;
		}
		if (byId.has(id)) {
			reporter.report(new SchematicSyntaxError(`Duplicate component ID ${id}.`, line.line, span(line, syntax.id), 'reference'));
			continue;
		}
		byId.set(id, component);
		components.push(component);
		if (syntax.form === 'absolute') {
			const offences = boundsOffences(component, normalized);
			if (offences !== undefined) reporter.report(new SchematicSyntaxError(offences, line.line, undefined, 'geometry'));
		} else if (syntax.form === 'unplaced') {
			drafted.add(component);
		} else {
			let relations: SchematicPlacementRelation[];
			try {
				relations = syntax.relations.map((relation) => {
				const ref = prefix + relation.ref;
				if (!instances.has(ref)) return { ...relation, ref };
				if (relation.port === undefined) {
					throw new SchematicSyntaxError(
						`Place ${id} relative to a terminal of ${ref}, such as ${relation.kind} ${ref}.TERMINAL; a subcircuit instance has no body of its own to measure from.`,
						line.line,
						undefined,
						'placement'
					);
				}
				const target = terminal(ref, relation.port, line.line, instances, exposures);
				return { ...relation, ref: target.id, port: target.port } satisfies SchematicPlacementRelation;
				});
			} catch (error) {
				reporter.report(error, 'placement');
				poisoned.add(id);
				continue;
			}
			pending.push({ component, relations, spans: syntax.references.map((reference) => span(line, reference)) });
		}
	}
	if (components.length === 0 && !reporter.failed) {
		reporter.report(new SchematicSyntaxError('A schematic must declare at least one component.'));
		return undefined;
	}

	/*
	 * A relation that reaches a drafted part, directly or through another
	 * relation, cannot be evaluated until the draft pass has run, and that pass
	 * needs the connections checked below. Those relations wait; every other one
	 * is resolved here, where it always was.
	 */
	const waiting: PendingPlacement[] = [];
	if (drafted.size > 0) {
		const late = new Set([...drafted].map((component) => component.id));
		for (let grew = true; grew; ) {
			grew = false;
			for (const entry of pending) {
				if (late.has(entry.component.id) || !entry.relations.some((relation) => late.has(relation.ref))) continue;
				late.add(entry.component.id);
				grew = true;
			}
		}
		for (const entry of pending) if (late.has(entry.component.id)) waiting.push(entry);
	}
	const settled = waiting.length === 0 ? pending : pending.filter((entry) => !waiting.includes(entry));
	const checkPlaced = (entries: readonly PendingPlacement[]): void => {
		/* A placement that failed leaves its part unplaced, at its origin, not
		   undeclared: every connection is still checked below, because a
		   terminal's name depends on its part's kind, never on where it sits. */
		for (const entry of entries) {
			const offences = boundsOffences(entry.component, normalized);
			if (offences !== undefined) reporter.report(new SchematicSyntaxError(offences, entry.component.line, undefined, 'geometry'));
		}
	};
	let placements: ReturnType<typeof resolvePlacements> = [];
	if (settled.length > 0) {
		placements = resolvePlacements(components, settled, limits.placementDepth, (error) => reporter.report(error), poisoned);
		checkPlaced(settled);
	}

	const valid: SchematicConnection[] = [];
	for (const connection of connections) {
		if (poisoned.has(connection.from.componentId) || poisoned.has(connection.to.componentId)) continue;
		try {
			const [fromId, fromPort, toId, toPort] = endpointSpans.get(connection)!;
			checkEndpoint(connection.from, byId, connection.line, fromId, fromPort);
			checkEndpoint(connection.to, byId, connection.line, toId, toPort);
			connection.from.port = canonicalName(byId.get(connection.from.componentId)!, connection.from.port)!;
			connection.to.port = canonicalName(byId.get(connection.to.componentId)!, connection.to.port)!;
			if (connection.from.componentId === connection.to.componentId && connection.from.port === connection.to.port) {
				throw new SchematicSyntaxError(
					`${connection.from.componentId}.${connection.from.port} cannot connect to itself; a connection needs two distinct terminals.`,
					connection.line,
					undefined,
					'reference'
				);
			}
			const sourceWidth = endpointWidth(connection.from, byId);
			const targetWidth = endpointWidth(connection.to, byId);
			const width = connection.width ?? 1;
			if ((sourceWidth > 1 || targetWidth > 1) && connection.width === undefined) {
				throw new SchematicSyntaxError('Bus connections require an explicit width option.', connection.line, undefined, 'topology');
			}
			if (sourceWidth !== targetWidth || width !== sourceWidth) {
				throw new SchematicSyntaxError(
					`Connection width ${width} is incompatible with ${sourceWidth}-bit source and ${targetWidth}-bit target ports.`,
					connection.line,
					undefined,
					'topology'
				);
			}
			valid.push(connection);
		} catch (error) {
			reporter.report(error);
		}
	}
	if (reporter.failed) return undefined;
	assignNets(valid, reporter);
	resolveTrunks(valid, reporter);
	if (reporter.failed) return undefined;
	if (drafted.size > 0) {
		const all = [...placements, ...draftPlacements(components, drafted, new Set(waiting.map((entry) => entry.component)), valid)];
		if (waiting.length > 0) {
			all.push(...resolvePlacements(components, waiting, limits.placementDepth, (error) => reporter.report(error), poisoned));
			checkPlaced(waiting);
			if (reporter.failed) return undefined;
		}
		placements = all.sort((left, right) => left.line - right.line);
	}
	fitComponents(components, valid, (error) => reporter.report(error, 'geometry'));
	if (reporter.failed) return undefined;

	const document = { components, connections: valid } satisfies SchematicDocument;
	let geometry: ReturnType<typeof validateSchematicGeometry>;
	try {
		geometry = validateSchematicGeometry(document, normalized);
	} catch (error) {
		reporter.report(error, 'geometry');
		return undefined;
	}
	const parsed = freezeDocument(document);
	cacheParsedSchematicRoutes(parsed, normalized.bounds, geometry.routes, geometry.sheet);
	cacheParsedSchematicEvidence(parsed, placements, geometry.report);
	return parsed;
}

/** Why an origin is outside the fence, or `undefined`. */
function boundsOffences(component: SchematicComponent, fence: SchematicFence): string | undefined {
	/* A measured sheet has no edge for an origin to be outside of. */
	if (fence.bounds === 'auto') return undefined;
	const offences: string[] = [];
	if (component.x < 0 || component.x > fence.bounds.width) offences.push(`x is ${component.x}, and must be between 0 and ${fence.bounds.width}`);
	if (component.y < 0 || component.y > fence.bounds.height) offences.push(`y is ${component.y}, and must be between 0 and ${fence.bounds.height}`);
	return offences.length === 0
		? undefined
		: `${component.id} is outside the declared ${fence.bounds.width}x${fence.bounds.height} bounds: ${offences.join('; ')}.`;
}

/**
 * Compile validated schemd DSL source into an immutable schematic AST.
 *
 * @throws {SchematicSyntaxError} At the first problem, with its line and, where
 *   known, its column range.
 */
export function parseSchematic(source: string, fence: SchematicFence): SchematicDocument {
	return analyze(source, fence, new Reporter(true))!;
}

/**
 * Report every independent problem in a document instead of stopping at the first.
 *
 * Problems in separate declarations are each reported once, with the line and,
 * where the scanner knows it, the column range. A declaration that fails does
 * not cascade: lines that refer to it are not also reported. Placement,
 * geometry, and routing run only for a document whose declarations are all valid.
 *
 * @returns An empty array for a document that compiles.
 * @throws {SchematicSyntaxError} Only for invalid arguments — a non-string source
 *   or malformed options — which are not problems in the document.
 */
export function diagnoseSchematic(source: string, fence: SchematicFence): readonly SchematicSourceDiagnostic[] {
	const reporter = new Reporter(false);
	analyze(source, fence, reporter);
	/* Source order, not phase order; a stable sort keeps phase order within a
	   line. Only "no components" lacks a line, and it is only ever reported alone. */
	return reporter.diagnostics.sort((left, right) => left.line! - right.line!);
}

