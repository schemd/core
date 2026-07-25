/**
 * Connectivity extraction and design-rule checking.
 *
 * Every other text-to-diagram compiler stops at a picture. This one already
 * knows the topology — the parser resolves nets, the layout pass enumerates
 * ports — so the same source that renders can also be *inspected*: what is
 * connected to what, and which of those connections are mistakes.
 *
 * `buildNetlist` is the machine-readable view of a validated document, and
 * `verifyNetlist` runs deterministic rules over it. Both are pure: no rendering,
 * no geometry, no I/O.
 *
 * @packageDocumentation
 */
import { enumerateComponentPorts } from './layout.js';
import type {
	SchematicComponent,
	SchematicConnection,
	SchematicDocument,
	SchematicSignalKind
} from './types.js';

/** One terminal of one component, as it appears in a net. */
export interface NetlistTerminal {
	readonly componentId: string;
	readonly port: string;
}

/** A component as connectivity sees it: identity, kind, and available ports. */
export interface NetlistNode {
	readonly id: string;
	readonly kind: string;
	readonly label: string;
	readonly x: number;
	readonly y: number;
	/** Stable port names this kind exposes, in enumeration order. */
	readonly ports: readonly string[];
}

/** A set of terminals the document ties together, named or parser-assigned. */
export interface NetlistNet {
	/** Parser-resolved identity; unnamed nets carry a stable `$N` identifier. */
	readonly id: string;
	/** Author-supplied name, when the source declared one. */
	readonly name: string | undefined;
	/** Signal domains observed on this net. */
	readonly signalKinds: readonly SchematicSignalKind[];
	/** Declared bus widths observed on this net. */
	readonly widths: readonly number[];
	/** Terminals on the net, deduplicated, in source order. */
	readonly terminals: readonly NetlistTerminal[];
	/** One-based source lines that contributed to this net. */
	readonly lines: readonly number[];
}

/** A single declared connection, retained for line-accurate diagnostics. */
export interface NetlistEdge {
	readonly from: NetlistTerminal;
	readonly to: NetlistTerminal;
	readonly netId: string;
	readonly signalKind: SchematicSignalKind;
	readonly width: number | undefined;
	readonly line: number;
}

/** The complete connectivity model of a validated document. */
export interface SchematicNetlist {
	readonly nodes: readonly NetlistNode[];
	readonly nets: readonly NetlistNet[];
	readonly edges: readonly NetlistEdge[];
}

/** How seriously a rule violation should be taken. */
export type SchematicDiagnosticSeverity = 'error' | 'warning' | 'info';

/** One rule violation, addressed to a source line wherever one exists. */
export interface SchematicDiagnostic {
	/** Stable rule identifier, safe to suppress or assert against. */
	readonly code: SchematicRuleCode;
	readonly severity: SchematicDiagnosticSeverity;
	readonly message: string;
	/** Component or net identifiers the violation concerns. */
	readonly subjects: readonly string[];
	/** One-based source line, when the violation belongs to a declaration. */
	readonly line: number | undefined;
}

/** Every rule `verifyNetlist` can report. */
export const SCHEMATIC_RULE_CODES = [
	'shorted-supply',
	'width-mismatch',
	'domain-mismatch',
	'unconnected-component',
	'duplicate-connection',
	'multiple-drivers',
	'disconnected-subcircuit'
] as const;
/** A design-rule identifier. */
export type SchematicRuleCode = (typeof SCHEMATIC_RULE_CODES)[number];

/** Human-readable rule catalogue, for documentation and tooling surfaces. */
export const SCHEMATIC_RULES: Readonly<
	Record<SchematicRuleCode, { readonly severity: SchematicDiagnosticSeverity; readonly summary: string }>
> = {
	'shorted-supply': {
		severity: 'error',
		summary: 'Two or more supply or ground components share one net.'
	},
	'width-mismatch': {
		severity: 'error',
		summary: 'One net carries connections declaring different bus widths.'
	},
	'domain-mismatch': {
		severity: 'error',
		summary: 'One net mixes signal domains, such as quantum and digital.'
	},
	'unconnected-component': {
		severity: 'warning',
		summary: 'A declared component takes part in no connection.'
	},
	'duplicate-connection': {
		severity: 'warning',
		summary: 'The same pair of terminals is connected more than once.'
	},
	'multiple-drivers': {
		severity: 'warning',
		summary: 'More than one output terminal drives the same net.'
	},
	'disconnected-subcircuit': {
		severity: 'info',
		summary: 'The diagram contains more than one independent connected group.'
	}
};

/**
 * Terminals that *are* a supply rail, keyed by component kind.
 *
 * Deliberately narrower than "any supply component": a source's `negative`
 * terminal sharing a node with ground is the return path of almost every
 * circuit ever drawn, and flagging it would make the rule useless. Two rails on
 * one net — a positive supply meeting ground, or two named rails meeting — is
 * the dead short worth reporting.
 */
const RAIL_TERMINALS: Readonly<Record<string, ReadonlySet<string>>> = {
	source: new Set(['positive']),
	power: new Set(['in']),
	ground: new Set(['in'])
};

const isRailTerminal = (kind: string | undefined, port: string): boolean =>
	RAIL_TERMINALS[kind ?? '']?.has(port) ?? false;

/**
 * Ports whose names mark them as drivers rather than sinks. Contention is a
 * digital concept: two analog terminals sharing a node is ordinary circuit
 * topology, so this rule only applies to nets that declare a digital domain.
 */
const DRIVER_PORT = /^(?:out|q)(?:\d+)?$/;
const CONTENTION_DOMAINS = new Set<SchematicSignalKind>(['digital', 'classical']);

const terminalKey = (terminal: NetlistTerminal): string =>
	`${terminal.componentId}.${terminal.port}`;

/** The undirected identity of a connection, so A→B and B→A compare equal. */
const edgeKey = (edge: NetlistEdge): string =>
	[terminalKey(edge.from), terminalKey(edge.to)].sort().join('|');

/** Signal domain a connection belongs to; unmarked traces are electrical. */
const domainOf = (connection: SchematicConnection): SchematicSignalKind =>
	connection.signalKind ?? 'electrical';

/**
 * The connectivity model of a validated document.
 *
 * Nets come from the parser's own topology resolution, so a netlist never
 * disagrees with what the renderer drew.
 *
 * @param document - Immutable AST returned by `parseSchematic`.
 * @returns Nodes, nets, and edges in deterministic source order.
 */
export function buildNetlist(document: SchematicDocument): SchematicNetlist {
	const nodes: NetlistNode[] = document.components.map((component: SchematicComponent) => ({
		id: component.id,
		kind: component.kind,
		label: component.label,
		x: component.x,
		y: component.y,
		ports: enumerateComponentPorts(component).map((port) => port.id)
	}));

	const edges: NetlistEdge[] = document.connections.map((connection) => ({
		from: { componentId: connection.from.componentId, port: connection.from.port },
		to: { componentId: connection.to.componentId, port: connection.to.port },
		/* An unnamed connection still forms a net of its own. */
		netId: connection.netId ?? `$line-${connection.line}`,
		signalKind: domainOf(connection),
		width: connection.width,
		line: connection.line
	}));

	const nets = new Map<
		string,
		{
			name: string | undefined;
			signalKinds: Set<SchematicSignalKind>;
			widths: Set<number>;
			terminals: NetlistTerminal[];
			seen: Set<string>;
			lines: number[];
		}
	>();
	document.connections.forEach((connection, index) => {
		const edge = edges[index]!;
		let net = nets.get(edge.netId);
		if (!net) {
			net = {
				name: connection.net,
				signalKinds: new Set(),
				widths: new Set(),
				terminals: [],
				seen: new Set(),
				lines: []
			};
			nets.set(edge.netId, net);
		}
		net.name ??= connection.net;
		net.signalKinds.add(edge.signalKind);
		if (edge.width !== undefined) net.widths.add(edge.width);
		net.lines.push(edge.line);
		for (const terminal of [edge.from, edge.to]) {
			const key = terminalKey(terminal);
			if (net.seen.has(key)) continue;
			net.seen.add(key);
			net.terminals.push(terminal);
		}
	});

	return {
		nodes,
		edges,
		nets: [...nets.entries()].map(([id, net]) => ({
			id,
			name: net.name,
			signalKinds: [...net.signalKinds],
			widths: [...net.widths],
			terminals: net.terminals,
			lines: net.lines
		}))
	};
}

/** Group nodes into connected components using the edges as undirected links. */
function connectedGroups(netlist: SchematicNetlist): number {
	const parent = new Map<string, string>();
	const find = (id: string): string => {
		/* An edge may name a component the document never declared; seed it as
		   its own root so every value in the map is also a key, which keeps the
		   walk below total. */
		const start = parent.get(id);
		if (start === undefined) {
			parent.set(id, id);
			return id;
		}
		let root = start;
		while (root !== parent.get(root)) root = parent.get(root)!;
		parent.set(id, root);
		return root;
	};
	const union = (left: string, right: string): void => {
		const a = find(left);
		const b = find(right);
		if (a !== b) parent.set(a, b);
	};

	for (const node of netlist.nodes) parent.set(node.id, node.id);
	for (const edge of netlist.edges) union(edge.from.componentId, edge.to.componentId);
	return new Set(netlist.nodes.map((node) => find(node.id))).size;
}

/**
 * Run every design rule over a netlist.
 *
 * Diagnostics are ordered by severity — errors, then warnings, then information
 * — and by source line within a severity, so output is stable enough to assert
 * against in a test or print in a CI log.
 *
 * @param netlist - Model returned by {@link buildNetlist}.
 * @returns Deterministically ordered rule violations; empty means clean.
 */
export function verifyNetlist(netlist: SchematicNetlist): readonly SchematicDiagnostic[] {
	const diagnostics: SchematicDiagnostic[] = [];
	const kindById = new Map(netlist.nodes.map((node) => [node.id, node.kind]));

	for (const net of netlist.nets) {
		const line = net.lines[0];
		const subject = net.name ?? net.id;

		const rails = [
			...new Set(
				net.terminals
					.filter((terminal) => isRailTerminal(kindById.get(terminal.componentId), terminal.port))
					.map((terminal) => terminal.componentId)
			)
		];
		if (rails.length > 1) {
			diagnostics.push({
				code: 'shorted-supply',
				severity: 'error',
				message: `Net ${subject} ties supply rails ${rails.join(', ')} together.`,
				subjects: rails,
				line
			});
		}

		if (net.widths.length > 1) {
			diagnostics.push({
				code: 'width-mismatch',
				severity: 'error',
				message: `Net ${subject} declares widths ${[...net.widths].sort((a, b) => a - b).join(' and ')}.`,
				subjects: [subject],
				line
			});
		}

		if (net.signalKinds.length > 1) {
			diagnostics.push({
				code: 'domain-mismatch',
				severity: 'error',
				message: `Net ${subject} mixes the ${[...net.signalKinds].sort().join(' and ')} domains.`,
				subjects: [subject],
				line
			});
		}

		const contested = net.signalKinds.some((domain) => CONTENTION_DOMAINS.has(domain));
		const drivers = contested
			? net.terminals.filter((terminal) => DRIVER_PORT.test(terminal.port))
			: [];
		if (drivers.length > 1) {
			diagnostics.push({
				code: 'multiple-drivers',
				severity: 'warning',
				message: `Net ${subject} is driven by ${drivers.map(terminalKey).join(', ')}.`,
				subjects: drivers.map(terminalKey),
				line
			});
		}
	}

	const connected = new Set<string>();
	for (const edge of netlist.edges) {
		connected.add(edge.from.componentId);
		connected.add(edge.to.componentId);
	}
	for (const node of netlist.nodes) {
		if (connected.has(node.id)) continue;
		diagnostics.push({
			code: 'unconnected-component',
			severity: 'warning',
			message: `Component ${node.id} takes part in no connection.`,
			subjects: [node.id],
			line: undefined
		});
	}

	const seenEdges = new Map<string, number>();
	for (const edge of netlist.edges) {
		const key = edgeKey(edge);
		const first = seenEdges.get(key);
		if (first === undefined) {
			seenEdges.set(key, edge.line);
			continue;
		}
		diagnostics.push({
			code: 'duplicate-connection',
			severity: 'warning',
			message: `${terminalKey(edge.from)} and ${terminalKey(edge.to)} are already connected on line ${first}.`,
			subjects: [terminalKey(edge.from), terminalKey(edge.to)],
			line: edge.line
		});
	}

	const groups = connectedGroups(netlist);
	if (groups > 1) {
		diagnostics.push({
			code: 'disconnected-subcircuit',
			severity: 'info',
			message: `The diagram contains ${groups} independent connected groups.`,
			subjects: [],
			line: undefined
		});
	}

	const rank: Record<SchematicDiagnosticSeverity, number> = { error: 0, warning: 1, info: 2 };
	return diagnostics.sort(
		(left, right) =>
			rank[left.severity] - rank[right.severity] ||
			(left.line ?? Number.MAX_SAFE_INTEGER) - (right.line ?? Number.MAX_SAFE_INTEGER) ||
			left.code.localeCompare(right.code)
	);
}

/**
 * Build a netlist and check it in one call.
 *
 * @param document - Immutable AST returned by `parseSchematic`.
 * @returns The connectivity model together with its rule violations.
 */
export function inspectSchematic(document: SchematicDocument): {
	readonly netlist: SchematicNetlist;
	readonly diagnostics: readonly SchematicDiagnostic[];
} {
	const netlist = buildNetlist(document);
	return { netlist, diagnostics: verifyNetlist(netlist) };
}
