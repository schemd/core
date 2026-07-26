/**
 * Prose descriptions derived from a document's connectivity.
 *
 * A diagram is unreadable to a screen reader, and `alt="RC filter"` is whatever
 * the author remembered to type — it drifts from the diagram the moment the
 * diagram changes. The compiler already knows the exact topology, so the
 * description can be *derived* instead: it cannot drift, it needs no author
 * effort, and it is identical for identical documents.
 *
 * The description states only what the netlist proves. It deliberately does not
 * infer circuit archetypes — calling something "a low-pass filter" means
 * recognising an intent the source never declared, and a confident wrong label
 * is worse for a screen-reader user than an accurate structural one.
 *
 * This module is reachable as `@schemd/core/describe` and is intentionally not
 * re-exported from the package entry: hosts that only compile should not carry
 * prose generation in their bundle.
 */
import { mathLabelText } from './math-label.js';
import { buildNetlist } from './netlist.js';
import type { NetlistNode, SchematicNetlist, NetlistTerminal } from './netlist.js';
import type { SchematicDocument, SchematicSignalKind } from './types.js';

/** A derived, deterministic account of one diagram. */
export interface SchematicDescription {
	/** One sentence: scale and signal domain. Suitable as an `alt` attribute. */
	readonly headline: string;
	/** What the diagram contains, grouped by kind in source order. */
	readonly inventory: string;
	/** How it is wired, one sentence per net. */
	readonly connections: readonly string[];
	/** Every sentence joined — suitable for narration or a `<desc>` element. */
	readonly text: string;
	/** Signal domains observed across the document. */
	readonly domains: readonly SchematicSignalKind[];
	readonly counts: {
		readonly components: number;
		readonly nets: number;
		readonly connections: number;
	};
}

/** Kinds whose identifier does not read as an English noun. */
const KIND_NOUNS: Readonly<Record<string, string>> = {
	ic: 'integrated circuit',
	qgate: 'quantum gate',
	cnot: 'CNOT gate',
	hadamard: 'Hadamard gate',
	prepare: 'state preparation',
	measure: 'measurement',
	xor: 'XOR gate',
	and: 'AND gate',
	or: 'OR gate',
	nand: 'NAND gate',
	nor: 'NOR gate',
	not: 'NOT gate',
	xnor: 'XNOR gate',
	mux: 'multiplexer',
	demux: 'demultiplexer',
	dff: 'D flip-flop',
	jkff: 'JK flip-flop',
	srff: 'SR flip-flop',
	tff: 'T flip-flop'
};

const NUMBER_WORDS = [
	'no',
	'one',
	'two',
	'three',
	'four',
	'five',
	'six',
	'seven',
	'eight',
	'nine',
	'ten'
];

/** Small counts read better as words; large ones as digits. */
function count(value: number): string {
	return NUMBER_WORDS[value] ?? String(value);
}

/** English noun for a component kind. */
function kindNoun(kind: string): string {
	return KIND_NOUNS[kind] ?? kind.replace(/-/g, ' ');
}

/** `resistor` → `resistors`, `multiplexer` → `multiplexers`, `bus` → `buses`. */
function plural(noun: string): string {
	if (/(?:s|x|z|ch|sh)$/.test(noun)) return `${noun}es`;
	if (/[^aeiou]y$/.test(noun)) return `${noun.slice(0, -1)}ies`;
	return `${noun}s`;
}

/** Sentence case, for a fragment assembled from counted phrases. */
function capitalize(sentence: string): string {
	return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

/** Join a list the way a person would read it. */
export function joinPhrases(items: readonly string[]): string {
	if (items.length === 0) return '';
	if (items.length === 1) return items[0]!;
	if (items.length === 2) return `${items[0]} and ${items[1]}`;
	return `${items.slice(0, -1).join(', ')}, and ${items.at(-1)}`;
}

/**
 * How a component is named in prose: its id, plus its label when it adds
 * anything.
 *
 * Labels carry the compiler's math syntax — `V_{in}`, `1 k\\Omega` — which is
 * meant for glyph layout, not for a screen reader or a narrator. `mathLabelText`
 * is the same flattening the renderer uses, so the spoken name matches the
 * drawn one.
 */
function nameOf(node: NetlistNode): string {
	const label = mathLabelText(node.label).trim();
	if (label.length === 0 || label === node.id) return node.id;
	return `${node.id} (${label})`;
}

/** `R1.out` — terminals read as the component's id and its port. */
function terminalPhrase(terminal: NetlistTerminal): string {
	return `${terminal.componentId}.${terminal.port}`;
}

/**
 * Describe a netlist.
 *
 * Output is a pure function of the netlist, so identical documents always
 * produce identical prose.
 */
export function describeNetlist(netlist: SchematicNetlist): SchematicDescription {
	const { nodes, nets, edges } = netlist;

	const domains = [...new Set(edges.map((edge) => edge.signalKind))].sort();
	const domainPhrase =
		domains.length === 0
			? 'no wired signals'
			: domains.length === 1
				? `${domains[0]} signals`
				: `${joinPhrases([...domains])} signals`;

	const components = `${count(nodes.length)} ${nodes.length === 1 ? 'component' : 'components'}`;
	const netCount = `${count(nets.length)} ${nets.length === 1 ? 'net' : 'nets'}`;
	const headline = capitalize(`${components} joined by ${netCount}, carrying ${domainPhrase}.`);

	/* Group by kind, preserving the order kinds first appear in the source. */
	const byKind = new Map<string, NetlistNode[]>();
	for (const node of nodes) {
		const bucket = byKind.get(node.kind);
		if (bucket) bucket.push(node);
		else byKind.set(node.kind, [node]);
	}
	const inventoryParts = [...byKind.entries()].map(([kind, group]) => {
		/* One of a kind reads as "one resistor R1 (1 kΩ)"; several read as
		   "three resistors (R1, R2, R3)", which keeps the parentheses from
		   nesting around every label. */
		if (group.length === 1) return `one ${kindNoun(kind)} ${nameOf(group[0]!)}`;
		return `${count(group.length)} ${plural(kindNoun(kind))} (${group.map(nameOf).join(', ')})`;
	});
	const inventory =
		inventoryParts.length === 0
			? 'The diagram declares no components.'
			: `It contains ${joinPhrases(inventoryParts)}.`;

	const connections = nets
		.filter((net) => net.terminals.length > 0)
		.map((net) => {
			const label = net.name === undefined ? 'An unnamed net' : `Net ${net.name}`;
			const terminals = net.terminals.map(terminalPhrase);
			return terminals.length === 1
				? `${label} reaches only ${terminals[0]}.`
				: `${label} ties ${joinPhrases(terminals)}.`;
		});

	return {
		headline,
		inventory,
		connections,
		text: [headline, inventory, ...connections].join(' '),
		domains,
		counts: { components: nodes.length, nets: nets.length, connections: edges.length }
	};
}

/** Describe a parsed document, building its netlist first. */
export function describeSchematic(document: SchematicDocument): SchematicDescription {
	return describeNetlist(buildNetlist(document));
}
