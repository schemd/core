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
import type { SchematicComponent, SchematicDocument, SchematicSignalKind } from './types.js';

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
const RAIL_TERMINALS: Readonly<Record<string, string>> = { source: 'positive', power: 'in', ground: 'in' };
const DRIVER_PORT = /^(?:out|q)(?:\d+)?$/;
const tk = (t: NetlistTerminal): string => `${t.componentId}.${t.port}`;

export function buildNetlist(document: SchematicDocument): SchematicNetlist {
	const nodes: NetlistNode[] = document.components.map((c: SchematicComponent) => ({
		id: c.id,
		kind: c.kind,
		label: c.label,
		x: c.x,
		y: c.y,
		ports: enumerateComponentPorts(c).map((p) => p.id)
	}));
	const edges: NetlistEdge[] = document.connections.map((c) => ({
		from: { componentId: c.from.componentId, port: c.from.port },
		to: { componentId: c.to.componentId, port: c.to.port },
		netId: c.netId ?? `$line-${c.line}`,
		signalKind: c.signalKind ?? 'electrical',
		width: c.width,
		line: c.line
	}));
	const nets = new Map<string, { name: string | undefined; signalKinds: Set<SchematicSignalKind>; widths: Set<number>; terminals: NetlistTerminal[]; seen: Set<string>; lines: number[] }>();
	document.connections.forEach((c, i) => {
		const e = edges[i]!;
		let net = nets.get(e.netId);
		if (!net) {
			net = { name: c.net, signalKinds: new Set(), widths: new Set(), terminals: [], seen: new Set(), lines: [] };
			nets.set(e.netId, net);
		}
		net.name ??= c.net;
		net.signalKinds.add(e.signalKind);
		if (e.width !== undefined) net.widths.add(e.width);
		net.lines.push(e.line);
		for (const t of [e.from, e.to]) {
			const k = tk(t);
			if (!net.seen.has(k)) {
				net.seen.add(k);
				net.terminals.push(t);
			}
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

export function verifyNetlist(netlist: SchematicNetlist): readonly SchematicDiagnostic[] {
	const diagnostics: SchematicDiagnostic[] = [];
	const emit = (code: SchematicRuleCode, message: string, subjects: readonly string[], line: number | undefined): void => {
		diagnostics.push({ code, severity: SCHEMATIC_RULES[code].severity, message, subjects, line });
	};
	const kindById = new Map(netlist.nodes.map((n) => [n.id, n.kind]));

	for (const net of netlist.nets) {
		const line = net.lines[0];
		const subject = net.name ?? net.id;
		const rails = [...new Set(net.terminals.filter((t) => RAIL_TERMINALS[kindById.get(t.componentId) ?? ''] === t.port).map((t) => t.componentId))];
		if (rails.length > 1) emit('shorted-supply', `Net ${subject} ties supply rails ${rails.join(', ')} together.`, rails, line);
		if (net.widths.length > 1) emit('width-mismatch', `Net ${subject} declares widths ${[...net.widths].sort((a, b) => a - b).join(' and ')}.`, [subject], line);
		if (net.signalKinds.length > 1) emit('domain-mismatch', `Net ${subject} mixes the ${[...net.signalKinds].sort().join(' and ')} domains.`, [subject], line);
		if (net.signalKinds.some((d) => d === 'digital' || d === 'classical')) {
			const drivers = net.terminals.filter((t) => DRIVER_PORT.test(t.port)).map(tk);
			if (drivers.length > 1) emit('multiple-drivers', `Net ${subject} is driven by ${drivers.join(', ')}.`, drivers, line);
		}
	}

	const connected = new Set<string>();
	const seenEdges = new Map<string, number>();
	const parent = new Map<string, string>(netlist.nodes.map((n) => [n.id, n.id]));
	const find = (id: string): string => {
		let r = parent.get(id);
		if (r === undefined) {
			parent.set(id, id);
			return id;
		}
		while (r !== parent.get(r)) r = parent.get(r)!;
		parent.set(id, r);
		return r;
	};
	for (const e of netlist.edges) {
		const a = e.from.componentId;
		const b = e.to.componentId;
		connected.add(a);
		connected.add(b);
		const ra = find(a);
		const rb = find(b);
		if (ra !== rb) parent.set(ra, rb);
		const fk = tk(e.from);
		const ek = tk(e.to);
		const key = fk < ek ? `${fk}|${ek}` : `${ek}|${fk}`;
		const first = seenEdges.get(key);
		if (first === undefined) seenEdges.set(key, e.line);
		else emit('duplicate-connection', `${fk} and ${ek} are already connected on line ${first}.`, [fk, ek], e.line);
	}
	for (const n of netlist.nodes) {
		if (!connected.has(n.id)) emit('unconnected-component', `Component ${n.id} takes part in no connection.`, [n.id], undefined);
	}
	const groups = new Set(netlist.nodes.map((n) => find(n.id))).size;
	if (groups > 1) emit('disconnected-subcircuit', `The diagram contains ${groups} independent connected groups.`, [], undefined);

	const rank: Record<SchematicDiagnosticSeverity, number> = { error: 0, warning: 1, info: 2 };
	return diagnostics.sort(
		(l, r) => rank[l.severity] - rank[r.severity] || (l.line ?? Number.MAX_SAFE_INTEGER) - (r.line ?? Number.MAX_SAFE_INTEGER) || l.code.localeCompare(r.code)
	);
}

export function inspectSchematic(document: SchematicDocument): { readonly netlist: SchematicNetlist; readonly diagnostics: readonly SchematicDiagnostic[] } {
	const netlist = buildNetlist(document);
	return { netlist, diagnostics: verifyNetlist(netlist) };
}
