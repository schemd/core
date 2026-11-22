import { fromMilli, parseMilli, unions } from './geom.js';
import { normalizeSchematicBounds, normalizeSchematicCanvas, normalizeSchematicTitle, resolveSchematicLimits, type SchematicResolvedLimits } from './limits.js';
import { validateSchematicGeometry } from './layout.js';
import { draftPlacements } from './draft.js';
import { fitComponents } from './fit.js';
import { resolvePlacements, type PendingPlacement } from './placement.js';
import { cacheParsedSchematic, isParsedSchematic } from './route-cache.js';
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
	type SchematicBounds,
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

const SCHEMD_FENCE_PATTERN = /^(?:schemd|schematic)(?:\s+bounds="(?:(\d+)x(\d+)|auto)")?(?:\s+title="([^"]+)")?\s*$/i;

function freezeDocument(document: SchematicDocument): SchematicDocument {
	for (const c of document.components) {
		if (c.color.kind !== 'token') Object.freeze(c.color);
		if (c.kind === 'ic') {
			for (const side of Object.values(c.pins)) Object.freeze(side);
			Object.freeze(c.pins);
		}
		if ('attributes' in c) {
			Object.freeze(c.attributes);
			Object.freeze(c.operations);
		}
		if (c.kind === 'state') Object.freeze(c.details);
		if ('rails' in c && c.rails !== undefined) Object.freeze(c.rails);
		if ('rows' in c && c.rows !== undefined) {
			Object.freeze(c.rows.left);
			Object.freeze(c.rows.right);
			Object.freeze(c.rows);
		}
		Object.freeze(c);
	}
	for (const cn of document.connections) {
		Object.freeze(cn.from);
		Object.freeze(cn.to);
		if (cn.color.kind !== 'token') Object.freeze(cn.color);
		Object.freeze(cn);
	}
	Object.freeze(document.components);
	Object.freeze(document.connections);
	return Object.freeze(document);
}

export function assertParsedSchematicDocument(document: SchematicDocument): void {
	if (!isParsedSchematic(document)) {
		throw new TypeError('This operation requires an immutable document returned by parseSchematic.');
	}
}

interface NormalizedFence extends SchematicFence {
	readonly bounds: SchematicBounds | 'auto';
	readonly limits: SchematicResolvedLimits;
}

function normalizeFence(value: unknown): NormalizedFence {
	if (typeof value !== 'object' || value === null) throw new SchematicSyntaxError('Parser options must be an object.');
	const c = value as Record<string, unknown>;
	return {
		bounds: normalizeSchematicCanvas(c.bounds, 'Schematic'),
		title: normalizeSchematicTitle(c.title, 'Schematic'),
		limits: resolveSchematicLimits(c.limits)
	};
}

export function parseSchematicFence(info: string | undefined, defaultTitle = 'Engineering schematic'): SchematicFence | undefined {
	if (info === undefined || !/^(?:schemd|schematic)(?:\s|$)/i.test(info.trim())) return undefined;
	const match = SCHEMD_FENCE_PATTERN.exec(info.trim());
	if (match === null) {
		throw new SchematicSyntaxError('A schemd fence is: schemd bounds="WIDTHxHEIGHT" title="Optional title". Leave bounds out, or write bounds="auto", to have the sheet measured from the drawing.');
	}
	return {
		bounds: match[1] === undefined ? 'auto' : normalizeSchematicBounds(Number(match[1]), Number(match[2]), 'Schematic'),
		title: normalizeSchematicTitle(match[3] ?? defaultTitle, 'Schematic')
	};
}

interface SourceLine {
	readonly text: string;
	readonly line: number;
	readonly indent: number;
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
		const m = PARAMETER.exec(token);
		if (m === null) throw new SchematicSyntaxError(`Subcircuit parameters are written name="value"; ${token} is not one.`, line);
		const name = m[1]!;
		if (result.has(name)) throw new SchematicSyntaxError(`Subcircuit parameter ${name} is set twice.`, line);
		const val = m[2] ?? m[3];
		if (requireValues && val === undefined) throw new SchematicSyntaxError(`Parameter ${name} needs a value: ${name}="...".`, line);
		result.set(name, val);
	}
	return result;
}

function elaborate(
	lines: readonly SourceLine[],
	budget: number
): { declarations: Elaborated[]; instances: Map<string, string>; exposures: Map<string, { id: string; port: string }> } {
	const definitions = new Map<string, Definition>();
	const top: SourceLine[] = [];
	let open: { name: string; line: number; parameters: Map<string, string | undefined>; body: SourceLine[] } | undefined;
	for (const source of lines) {
		const h = HEADER.exec(source.text);
		if (h !== null) {
			const name = h[1]!;
			if (open !== undefined) {
				throw new SchematicSyntaxError(`Subcircuit ${name} is declared inside subcircuit ${open.name}; close ${open.name} with } first. Definitions do not nest, though instances may.`, source.line);
			}
			if (includesValue(COMPONENT_KINDS, name)) throw new SchematicSyntaxError(`Subcircuit ${name} would shadow the built-in ${name} component; choose another name.`, source.line);
			const existing = definitions.get(name);
			if (existing !== undefined) throw new SchematicSyntaxError(`Subcircuit ${name} is already declared on line ${existing.line}.`, source.line);
			open = { name, line: source.line, parameters: parameters(h[2], source.line, false), body: [] };
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
							const v = values.get(key);
							if (v === undefined) throw new SchematicSyntaxError(`{{${key}}} is not a parameter of subcircuit ${stack.at(-1)}; declare it in the header as ${key}="default".`, source.line);
							return v;
						});
			if (text === '' || text.startsWith('//')) continue;
			const kind = /^([A-Za-z][A-Za-z0-9_-]*):/.exec(text)?.[1];
			const def = kind === undefined ? undefined : definitions.get(kind);
			if (def !== undefined) {
				const inst = INSTANCE.exec(text);
				if (inst === null) {
					throw new SchematicSyntaxError(`Place subcircuit ${kind} as ${kind}:ID at (x, y), optionally followed by [name="value"]; an instance has no label or colour of its own.`, source.line);
				}
				const id = prefix + inst[2]!;
				if (stack.includes(kind!)) {
					throw new SchematicSyntaxError(`Subcircuit ${kind} contains itself through ${[...stack.slice(stack.indexOf(kind!)), kind].join(' -> ')}; a subcircuit cannot contain itself.`, source.line);
				}
				if (instances.has(id)) throw new SchematicSyntaxError(`Duplicate component ID ${id}.`, source.line);
				const supplied = parameters(inst[5], source.line, true);
				const bound = new Map<string, string>();
				for (const [param, fb] of def.parameters) {
					const v = supplied.get(param) ?? fb;
					if (v === undefined) throw new SchematicSyntaxError(`${id} must set ${param}: subcircuit ${kind} declares it without a default.`, source.line);
					bound.set(param, v);
				}
				for (const param of supplied.keys()) {
					if (!def.parameters.has(param)) {
						throw new SchematicSyntaxError(
							`Subcircuit ${kind} has no parameter ${param}; it declares ${def.parameters.size === 0 ? 'none' : [...def.parameters.keys()].join(', ')}.`,
							source.line
						);
					}
				}
				instances.set(id, kind!);
				def.used = true;
				expand(def.body, `${id}_`, dx + parseMilli(inst[3]!), dy + parseMilli(inst[4]!), bound, [...stack, kind!]);
				continue;
			}
			const exp = EXPOSE.exec(text);
			if (exp !== null) {
				if (prefix === '') throw new SchematicSyntaxError('expose only belongs inside a subcircuit definition.', source.line);
				const key = `${prefix.slice(0, -1)}.${exp[1]}`;
				if (exposures.has(key)) throw new SchematicSyntaxError(`Subcircuit ${stack.at(-1)} exposes ${exp[1]} twice.`, source.line);
				exposures.set(key, { id: prefix + exp[2]!, port: exp[3]! });
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
	for (const [name, def] of definitions) {
		if (!def.used) throw new SchematicSyntaxError(`Subcircuit ${name} is declared but never placed; add ${name}:ID at (x, y), or remove it.`, def.line);
	}
	return { declarations, instances, exposures };
}

class Reporter {
	readonly diagnostics: SchematicSourceDiagnostic[] = [];
	constructor(readonly strict: boolean) {}

	report(error: unknown, code?: SchematicDiagnosticCode, fallback?: { column: number; endColumn: number }): void {
		/* v8 ignore next -- every compiler failure is a SchematicSyntaxError; anything else is a defect. */
		if (!(error instanceof SchematicSyntaxError)) throw error;
		const finalCode = error.code !== 'syntax' ? error.code : (code ?? 'syntax');
		const finalSpan = error.column !== undefined ? { column: error.column, endColumn: error.endColumn! } : error.line === undefined ? undefined : fallback;
		const message = error.line === undefined ? error.message : error.message.slice(`Line ${error.line}: `.length);
		const located = finalCode === error.code && finalSpan?.column === error.column ? error : new SchematicSyntaxError(message, error.line, finalSpan, finalCode);
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

type Span = { column: number; endColumn: number } | undefined;

function span(source: SourceLine, item: Token | undefined, pick?: (s: DeclarationSyntax) => Token): Span {
	if (source.shifted === true) return undefined;
	let t = item;
	if (t !== undefined && t.end === 0 && pick !== undefined) {
		const exact = scanDeclaration(source.text);
		/* v8 ignore next */
		if (exact === undefined) return undefined;
		t = pick(exact);
	}
	return t === undefined
		? { column: source.indent + 1, endColumn: source.indent + source.text.length + 1 }
		: { column: source.indent + t.start + 1, endColumn: source.indent + t.end + 1 };
}

function terminal(id: string, port: string, line: number, instances: ReadonlyMap<string, string>, exposures: ReadonlyMap<string, { id: string; port: string }>): { id: string; port: string } {
	while (instances.has(id)) {
		const target = exposures.get(`${id}.${port}`);
		if (target === undefined) {
			const offered = [...exposures.keys()].filter((k) => k.startsWith(`${id}.`)).map((k) => k.slice(id.length + 1));
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

function endpointWidth(ep: SchematicEndpoint, components: ReadonlyMap<string, SchematicComponent>): number {
	const c = components.get(ep.componentId)!;
	if (c.kind === 'port') return c.width ?? 1;
	if (c.kind === 'classical-register') return c.width;
	if (c.kind === 'register' && (ep.port === 'in' || ep.port === 'out')) return c.width;
	if (c.kind === 'bus' && ep.port === 'bus') return c.width;
	return 1;
}

function assignNets(connections: SchematicConnection[], reporter: Reporter): void {
	const uf = unions(connections.length);
	const terminals = new Map<string, number>();
	const names = new Map<string, number>();
	for (let i = 0; i < connections.length; i += 1) {
		const c = connections[i]!;
		if (c.relation !== 'signal') {
			if (c.net !== undefined) reporter.report(new SchematicSyntaxError('Only signal connections may declare a net.', c.line, undefined, 'topology'));
			continue;
		}
		for (const end of [c.from, c.to]) {
			const k = `${end.componentId}.${end.port}`;
			const o = terminals.get(k);
			if (o === undefined) terminals.set(k, i);
			else uf.join(i, o);
		}
		if (c.net !== undefined) {
			const o = names.get(c.net);
			if (o === undefined) names.set(c.net, i);
			else uf.join(i, o);
		}
	}
	const named = new Map<number, string>();
	const contracts = new Map<number, { signalKind: SchematicSignalKind; width: number }>();
	for (let i = 0; i < connections.length; i += 1) {
		const c = connections[i]!;
		if (c.relation !== 'signal') continue;
		const root = uf.find(i);
		if (c.net !== undefined) {
			const ex = named.get(root);
			if (ex !== undefined && ex !== c.net) {
				reporter.report(new SchematicSyntaxError(`Terminal joins conflicting nets ${ex} and ${c.net}.`, c.line, undefined, 'topology'));
				continue;
			}
			named.set(root, c.net);
		}
		const signalKind = c.signalKind ?? 'electrical';
		const width = c.width ?? 1;
		const ct = contracts.get(root);
		if (ct !== undefined && (ct.signalKind !== signalKind || ct.width !== width)) {
			reporter.report(new SchematicSyntaxError(`Net segments must share one signal kind and width; expected ${ct.signalKind} width ${ct.width}.`, c.line, undefined, 'topology'));
			continue;
		}
		contracts.set(root, { signalKind, width });
	}
	const resolved = new Map<number, string>();
	let generated = 0;
	for (let i = 0; i < connections.length; i += 1) {
		const c = connections[i]!;
		if (c.relation !== 'signal') continue;
		const root = uf.find(i);
		let netId = resolved.get(root);
		if (netId === undefined) {
			netId = named.get(root) ?? `$${++generated}`;
			resolved.set(root, netId);
		}
		c.netId = netId;
	}
}

function resolveTrunks(connections: readonly SchematicConnection[], reporter: Reporter): void {
	const wired = new Set<string>();
	for (const c of connections) {
		const from = `${c.from.componentId}.${c.from.port}`;
		const to = `${c.to.componentId}.${c.to.port}`;
		if (c.trunk !== undefined) {
			const fail = (msg: string) => reporter.report(new SchematicSyntaxError(msg, c.line, undefined, 'topology'));
			if (c.relation !== 'signal' || c.curve !== 'ortho') {
				fail(`${from} -> ${to} is marked trunk, which only applies to orthogonal signal wires; add ortho, or drop trunk.`);
			} else {
				const fW = wired.has(from);
				if (fW === wired.has(to)) {
					fail(
						fW
							? `${from} -> ${to} is marked trunk, but both terminals are already wired above it, so there is nothing new to branch out to; drop trunk.`
							: `${from} -> ${to} is marked trunk, but neither terminal is wired above it, so there is no copper to branch from; declare a connection that reaches ${from} or ${to} first, or drop trunk.`
					);
				} else {
					c.trunk = fW ? 'from' : 'to';
					if ((fW ? c.markerStart : c.markerEnd) !== 'none') {
						const joined = fW ? from : to;
						fail(`${from} -> ${to} branches off the trunk at ${joined}'s end, so its ${fW ? 'marker-start' : 'marker-end'} has no terminal to sit on; move the marker to the connection that reaches ${joined}.`);
					}
				}
			}
		}
		if (c.relation === 'signal') {
			wired.add(from);
			wired.add(to);
		}
	}
}

function boundsOffences(c: SchematicComponent, fence: NormalizedFence): string | undefined {
	if (fence.bounds === 'auto') return undefined;
	const off: string[] = [];
	if (c.x < 0 || c.x > fence.bounds.width) off.push(`x is ${c.x}, and must be between 0 and ${fence.bounds.width}`);
	if (c.y < 0 || c.y > fence.bounds.height) off.push(`y is ${c.y}, and must be between 0 and ${fence.bounds.height}`);
	return off.length === 0 ? undefined : `${c.id} is outside the declared ${fence.bounds.width}x${fence.bounds.height} bounds: ${off.join('; ')}.`;
}

function analyze(source: string, fence: SchematicFence, reporter: Reporter): SchematicDocument | undefined {
	if (typeof source !== 'string') throw new SchematicSyntaxError('Schematic source must be a string.');
	const normalized = normalizeFence(fence);
	const limits = normalized.limits;
	if (source.length > limits.sourceCharacters) {
		throw new SchematicSyntaxError(`Schematic source exceeds the ${limits.sourceCharacters.toLocaleString('en-US')} character limit.`, undefined, undefined, 'limit');
	}
	const rawText = source.includes('\r') ? source.replace(/\r\n?/g, '\n') : source;
	const rawLines = rawText.split('\n');

	let declarations: Elaborated[] | undefined;
	let instances: ReadonlyMap<string, string> = new Map();
	let exposures: ReadonlyMap<string, { id: string; port: string }> = new Map();
	if (rawText.includes('subcircuit') && rawLines.some((raw) => HEADER.test(raw.trim()))) {
		const lines = rawLines.map((raw, i) => ({ text: raw.trim(), line: i + 1, indent: raw.length - raw.trimStart().length }));
		try {
			({ declarations, instances, exposures } = elaborate(lines, limits.sourceCharacters));
		} catch (error) {
			reporter.report(error);
			return undefined;
		}
	}

	const components: SchematicComponent[] = [];
	const connections: SchematicConnection[] = [];
	const connMeta: { line: SourceLine; syn: Extract<DeclarationSyntax, { form: 'connection' }> }[] = [];
	const byId = new Map<string, SchematicComponent>();
	const poisoned = new Set<string>();
	const pending: PendingPlacement[] = [];
	const drafted = new Set<SchematicComponent>();
	const hasSub = instances.size > 0;

	const total = declarations !== undefined ? declarations.length : rawLines.length;
	for (let i = 0; i < total; i += 1) {
		let syntax: DeclarationSyntax | undefined;
		let line: SourceLine;
		let prefix = '';
		let dx = 0;
		let dy = 0;
		if (declarations !== undefined) {
			({ syntax, source: line, prefix, dx, dy } = declarations[i]!);
		} else {
			const raw = rawLines[i]!;
			const text = raw.trim();
			if (text === '' || text.startsWith('//')) continue;
			line = { text, line: i + 1, indent: raw.indexOf(text[0]!) };
			syntax = scanDeclaration(text, !reporter.strict);
		}
		const lineNum = line.line;
		if (syntax === undefined) {
			reporter.report(new SchematicSyntaxError('Unrecognized schematic declaration.', lineNum, span(line, undefined)));
			continue;
		}
		if (syntax.form === 'connection') {
			if (connections.length >= limits.connections) {
				reporter.report(new SchematicSyntaxError(`Schematic exceeds the ${limits.connections.toLocaleString('en-US')} connection limit.`, lineNum, undefined, 'limit'));
				break;
			}
			try {
				const tail = splitDeclarationTail(syntax.tail.text, lineNum);
				const options = parseConnectionOptions(tail.options, lineNum);
				const from = hasSub ? terminal(prefix + syntax.fromId.text, syntax.fromPort.text, lineNum, instances, exposures) : { id: syntax.fromId.text, port: syntax.fromPort.text };
				const to = hasSub ? terminal(prefix + syntax.toId.text, syntax.toPort.text, lineNum, instances, exposures) : { id: syntax.toId.text, port: syntax.toPort.text };
				const connection: SchematicConnection = {
					from: { componentId: from.id, port: from.port },
					to: { componentId: to.id, port: to.port },
					color: parseSchematicColor(tail.color, lineNum),
					curve: options.curve,
					markerStart: options.markerStart,
					markerEnd: options.markerEnd,
					relation: options.relation,
					dashed: options.dashed,
					line: lineNum
				};
				if (options.label !== undefined) connection.label = options.label;
				if (options.signalKind !== undefined) connection.signalKind = options.signalKind;
				if (options.net !== undefined) connection.net = options.net;
				if (options.width !== undefined) connection.width = options.width;
				if (options.trunk) connection.trunk = 'from';
				connections.push(connection);
				connMeta.push({ line, syn: syntax });
			} catch (error) {
				reporter.report(error, undefined, span(line, syntax.tail, (s) => s.tail));
			}
			continue;
		}
		if (components.length >= limits.components) {
			reporter.report(new SchematicSyntaxError(`Schematic exceeds the ${limits.components.toLocaleString('en-US')} component limit.`, lineNum, undefined, 'limit'));
			break;
		}
		const id = prefix + syntax.id.text;
		if (hasSub && instances.has(id)) {
			reporter.report(new SchematicSyntaxError(`${id} names both a component and a subcircuit instance; rename one of them.`, lineNum, span(line, syntax.id)));
			continue;
		}
		let component: SchematicComponent;
		try {
			const kind = syntax.kind.text.toLowerCase();
			const definition = KINDS[kind];
			if (definition === undefined) {
				throw new SchematicSyntaxError(`Unsupported component kind ${syntax.kind.text}.`, lineNum, span(line, syntax.kind, (s) => (s as Exclude<DeclarationSyntax, { form: 'connection' }>).kind), 'reference');
			}
			const tail = splitDeclarationTail(syntax.tail.text, lineNum, kind === 'ic');
			const options = parseAttributes(tail.options, lineNum);
			const x = syntax.form === 'absolute' ? fromMilli(parseMilli(syntax.x.text) + dx) : 0;
			const y = syntax.form === 'absolute' ? fromMilli(parseMilli(syntax.y.text) + dy) : 0;
			component = definition.parse(
				kind,
				{ id, label: syntax.label?.text ?? '', x, y, color: parseSchematicColor(tail.color === '' ? 'slate' : tail.color, lineNum), line: lineNum },
				options,
				lineNum
			);
		} catch (error) {
			poisoned.add(id);
			reporter.report(error, 'option', span(line, syntax.tail, (s) => s.tail));
			continue;
		}
		if (byId.has(id)) {
			reporter.report(new SchematicSyntaxError(`Duplicate component ID ${id}.`, lineNum, span(line, syntax.id, (s) => (s as Exclude<DeclarationSyntax, { form: 'connection' }>).id), 'reference'));
			continue;
		}
		byId.set(id, component);
		components.push(component);
		if (syntax.form === 'absolute') {
			const offences = boundsOffences(component, normalized);
			if (offences !== undefined) reporter.report(new SchematicSyntaxError(offences, lineNum, undefined, 'geometry'));
		} else if (syntax.form === 'unplaced') {
			drafted.add(component);
		} else {
			let relations: SchematicPlacementRelation[];
			try {
				relations = syntax.relations.map((rel) => {
					const ref = prefix + rel.ref;
					if (!instances.has(ref)) return { ...rel, ref };
					if (rel.port === undefined) {
						throw new SchematicSyntaxError(
							`Place ${id} relative to a terminal of ${ref}, such as ${rel.kind} ${ref}.TERMINAL; a subcircuit instance has no body of its own to measure from.`,
							lineNum,
							undefined,
							'placement'
						);
					}
					const target = terminal(ref, rel.port, lineNum, instances, exposures);
					return { ...rel, ref: target.id, port: target.port } satisfies SchematicPlacementRelation;
				});
			} catch (error) {
				reporter.report(error, 'placement');
				poisoned.add(id);
				continue;
			}
			pending.push({ component, relations, spans: syntax.references.map((r) => span(line, r)) });
		}
	}
	if (components.length === 0 && !reporter.failed) {
		reporter.report(new SchematicSyntaxError('A schematic must declare at least one component.'));
		return undefined;
	}

	const waiting: PendingPlacement[] = [];
	if (drafted.size > 0) {
		const late = new Set([...drafted].map((c) => c.id));
		for (let grew = true; grew; ) {
			grew = false;
			for (const e of pending) {
				if (late.has(e.component.id) || !e.relations.some((r) => late.has(r.ref))) continue;
				late.add(e.component.id);
				grew = true;
			}
		}
		for (const e of pending) if (late.has(e.component.id)) waiting.push(e);
	}
	const settled = waiting.length === 0 ? pending : pending.filter((e) => !waiting.includes(e));
	const checkPlaced = (entries: readonly PendingPlacement[]): void => {
		for (const entry of entries) {
			const off = boundsOffences(entry.component, normalized);
			if (off !== undefined) reporter.report(new SchematicSyntaxError(off, entry.component.line, undefined, 'geometry'));
		}
	};
	let placements: ReturnType<typeof resolvePlacements> = [];
	if (settled.length > 0) {
		placements = resolvePlacements(components, settled, limits.placementDepth, (e) => reporter.report(e), poisoned);
		checkPlaced(settled);
	}

	const valid: SchematicConnection[] = [];
	for (let ci = 0; ci < connections.length; ci += 1) {
		const cn = connections[ci]!;
		if (poisoned.has(cn.from.componentId) || poisoned.has(cn.to.componentId)) continue;
		try {
			const { line: srcLine, syn } = connMeta[ci]!;
			const checkEnd = (ep: SchematicEndpoint, isTo: boolean): string => {
				const comp = byId.get(ep.componentId);
				if (comp === undefined) {
					const sp = span(srcLine, isTo ? syn.toId : syn.fromId, (s) => (isTo ? (s as Extract<DeclarationSyntax, { form: 'connection' }>).toId : (s as Extract<DeclarationSyntax, { form: 'connection' }>).fromId));
					throw new SchematicSyntaxError(`Unknown component ${ep.componentId}.`, cn.line, sp, 'reference');
				}
				const canon = canonicalName(comp, ep.port);
				if (canon === undefined) {
					const sp = span(srcLine, isTo ? syn.toPort : syn.fromPort, (s) => (isTo ? (s as Extract<DeclarationSyntax, { form: 'connection' }>).toPort : (s as Extract<DeclarationSyntax, { form: 'connection' }>).fromPort));
					throw new SchematicSyntaxError(`Port ${ep.componentId}.${ep.port} is invalid for ${comp.kind}.`, cn.line, sp, 'reference');
				}
				return canon;
			};
			cn.from.port = checkEnd(cn.from, false);
			cn.to.port = checkEnd(cn.to, true);
			if (cn.from.componentId === cn.to.componentId && cn.from.port === cn.to.port) {
				throw new SchematicSyntaxError(`${cn.from.componentId}.${cn.from.port} cannot connect to itself; a connection needs two distinct terminals.`, cn.line, undefined, 'reference');
			}
			const sw = endpointWidth(cn.from, byId);
			const tw = endpointWidth(cn.to, byId);
			const w = cn.width ?? 1;
			if ((sw > 1 || tw > 1) && cn.width === undefined) {
				throw new SchematicSyntaxError('Bus connections require an explicit width option.', cn.line, undefined, 'topology');
			}
			if (sw !== tw || w !== sw) {
				throw new SchematicSyntaxError(`Connection width ${w} is incompatible with ${sw}-bit source and ${tw}-bit target ports.`, cn.line, undefined, 'topology');
			}
			valid.push(cn);
		} catch (error) {
			reporter.report(error);
		}
	}
	if (reporter.failed) return undefined;
	if (valid.length > 0) {
		assignNets(valid, reporter);
		resolveTrunks(valid, reporter);
		if (reporter.failed) return undefined;
	}
	if (drafted.size > 0) {
		const all = [...placements, ...draftPlacements(components, drafted, new Set(waiting.map((e) => e.component)), valid)];
		if (waiting.length > 0) {
			all.push(...resolvePlacements(components, waiting, limits.placementDepth, (e) => reporter.report(e), poisoned));
			checkPlaced(waiting);
			if (reporter.failed) return undefined;
		}
		placements = all.sort((l, r) => l.line - r.line);
	}
	fitComponents(components, valid, (e) => reporter.report(e, 'geometry'));
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
	cacheParsedSchematic(parsed, normalized.bounds, geometry.routes, geometry.sheet, placements, geometry.report);
	return parsed;
}

export function parseSchematic(source: string, fence: SchematicFence): SchematicDocument {
	return analyze(source, fence, new Reporter(true))!;
}

export function diagnoseSchematic(source: string, fence: SchematicFence): readonly SchematicSourceDiagnostic[] {
	const reporter = new Reporter(false);
	analyze(source, fence, reporter);
	return reporter.diagnostics.sort((l, r) => l.line! - r.line!);
}
