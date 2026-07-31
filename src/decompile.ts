/**
 * Recover a document from the SVG this compiler produced.
 *
 * `full` mode already stamps every node group with its id, kind, label, source
 * line and orientation, positions it with a `translate`, and paints it with a
 * colour token; every wire group carries its endpoints, net, signal kind and bus
 * width. That is most of a declaration, sitting unread. This module reads it
 * back and writes canonical DSL.
 *
 * **It is a scanner, not an XML parser.** The only inputs that need to work are
 * documents this renderer emitted, so matching the attribute set it writes is
 * both sufficient and far smaller than a general parser — which would be a
 * correctness liability and a size disaster for no gain.
 *
 * **Recovery is partial, and says so.** Some things genuinely are not in the
 * markup: a resistor and a thermistor are both `data-node-kind="resistor"`, and
 * their `type=` option survives only as prose inside an `aria-label`. Reading
 * that back would be guessing, and guessing is not what this compiler does — so
 * such fields are named in {@link SchematicRecovery.lost} instead. A recovered
 * document is a faithful account of topology, placement and paint; it is not a
 * promise that recompiling it reproduces the original bytes.
 *
 * @packageDocumentation
 */
import {
	SEMANTIC_COLORS,
	SchematicSyntaxError,
	type SchematicColor,
	type SemanticColor
} from './types.js';

/** What a recovery could not get back, and why it matters. */
export interface SchematicRecoveryLoss {
	/** Stable identifier, safe to assert against. */
	readonly code: 'component-variant' | 'net-name';
	/** One sentence naming what is missing and where it went. */
	readonly detail: string;
}

/** One recovered component declaration, before it is written as DSL. */
export interface RecoveredComponent {
	readonly id: string;
	readonly kind: string;
	readonly label: string;
	readonly x: number;
	readonly y: number;
	readonly line: number;
	readonly orientation?: string;
	readonly color: SchematicColor;
}

/** One recovered connection declaration. */
export interface RecoveredConnection {
	readonly from: string;
	readonly to: string;
	readonly line: number;
	readonly curve: 'line' | 'bezier' | 'ortho';
	readonly color: SchematicColor;
	readonly markerStart: string;
	readonly markerEnd: string;
	readonly net?: string;
	readonly signalKind?: string;
	readonly width?: number;
}

/** The result of reading a compiled diagram back into declarations. */
export interface SchematicRecovery {
	/** Components in the order the markup carried them, which is source order. */
	readonly components: readonly RecoveredComponent[];
	/** Connections in source order. */
	readonly connections: readonly RecoveredConnection[];
	/** Canonical DSL, ready to paste into a playground. */
	readonly source: string;
	/**
	 * Everything the markup does not carry, named rather than approximated.
	 *
	 * There is no `fidelity: 'exact'` companion to this, because there is no such
	 * recovery: family options are never stamped, so any document with a component
	 * loses something. A flag that can only hold one value tells a caller nothing;
	 * this list tells them what.
	 */
	readonly lost: readonly SchematicRecoveryLoss[];
}

/** Node groups, wire groups, and the pieces of each that matter. */
const NODE_GROUP =
	/<g class="schematic-component"([^>]*?)transform="translate\((-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)\)"/g;
const WIRE_GROUP = /<g class="schematic-wire[^"]*"([^>]*)>([\s\S]*?)<\/g>/g;
const TOKEN_CLASS = /schematic-token--([a-z0-9-]+)/;
const CUSTOM_COLOR = /--schematic-vector:\s*([^;"]+)/;
const ALIAS_CLASS = /schematic-color--([a-z0-9-]+)/;
const MARKER_END = /marker-end="url\(#[^)]*-marker-([a-z-]+)\)"/;
const MARKER_START = /marker-start="url\(#[^)]*-marker-([a-z-]+)\)"/;
const TRACE_PATH = /class="[^"]*schematic-trace[^"]*"[^>]*\sd="([^"]*)"/;

/** Read one attribute out of a tag's attribute text. */
function attribute(source: string, name: string): string | undefined {
	const match = source.match(new RegExp(`\\s${name}="([^"]*)"`));
	return match?.[1];
}

/** Undo the five entities `escapeXml` writes, and nothing else. */
function unescapeXml(value: string): string {
	return value
		.replaceAll('&lt;', '<')
		.replaceAll('&gt;', '>')
		.replaceAll('&quot;', '"')
		.replaceAll('&apos;', "'")
		.replaceAll('&amp;', '&');
}

/**
 * Recover the colour a group was painted with.
 *
 * The three colour forms leave three different marks: a semantic token becomes
 * `schematic-token--<name>`, a CSS literal becomes `--schematic-vector:<value>`
 * in a style attribute, and an alias becomes `schematic-color--<safe>`. Alias
 * names are sanitized on the way out, so what comes back is the safe spelling.
 */
function recoverColor(markup: string): SchematicColor {
	const alias = markup.match(ALIAS_CLASS);
	if (alias) return { kind: 'alias', value: alias[1]! };
	const custom = markup.match(CUSTOM_COLOR);
	if (custom) return { kind: 'css', value: unescapeXml(custom[1]!.trim()) };
	const token = markup.match(TOKEN_CLASS)?.[1];
	/* Checked against the compiler's own list rather than cast into it: markup
	   this scanner did not write could carry any class at all, and inventing a
	   seventh semantic colour would produce source the parser then rejects.
	   `slate` is the parser's default for a declaration with no colour, so an
	   unrecognized token recovers to what the parser would have used. */
	if (token !== undefined && includesSemanticColor(token)) return { kind: 'token', value: token };
	return { kind: 'token', value: 'slate' };
}

/** Narrow an arbitrary class fragment to a semantic colour the parser accepts. */
function includesSemanticColor(value: string): value is SemanticColor {
	return (SEMANTIC_COLORS as readonly string[]).includes(value);
}

/**
 * Classify a trace from the path it drew.
 *
 * The three curves write three different command sets: `bezier` is the only one
 * that emits `C`, `ortho` walks in `H`/`V` steps, and `line` is a single `L`.
 * Bridged crossings add `A` arcs to an orthogonal path, which is why `C` is
 * tested first and `L` last.
 */
function recoverCurve(path: string): 'line' | 'bezier' | 'ortho' {
	if (/\sC\s/.test(path)) return 'bezier';
	if (/\s[HV]\s/.test(path)) return 'ortho';
	return 'line';
}

/**
 * Write a colour back in the syntax the parser accepts.
 *
 * A semantic token and an alias both take the `#` sigil. A CSS colour does not:
 * `parseSchematicColor` matches `rgb(...)` and `hsl(...)` against the raw value,
 * so `#rgb(255, 128, 0)` reaches neither the function branch nor the alias
 * pattern and is rejected outright. Hex is the exception that already carries
 * its own `#`, so it is written through unchanged.
 */
function colorSyntax(color: SchematicColor): string {
	if (color.kind === 'css') return color.value;
	return `#${color.value}`;
}

/**
 * Read a compiled `full`-mode SVG back into declarations.
 *
 * @param svg - Markup produced by `renderSchematic` in `full` mode.
 * @returns Recovered declarations, canonical DSL, and what could not be read.
 * @throws {SchematicSyntaxError} When the markup carries no semantic hooks at
 *   all, which means it was compiled in `default` or `embedded-css` mode.
 */
export function parseSchematicSvg(svg: string): SchematicRecovery {
	if (typeof svg !== 'string') {
		throw new SchematicSyntaxError('Schematic markup must be a string.');
	}
	if (!svg.includes('data-node-id=')) {
		throw new SchematicSyntaxError(
			'This markup carries no node hooks, so nothing can be recovered from it. Recompile with mode "full" and the "nodes" semantic hook.'
		);
	}

	const components: RecoveredComponent[] = [];
	for (const match of svg.matchAll(NODE_GROUP)) {
		const attributes = match[1]!;
		const id = attribute(attributes, 'data-node-id');
		const kind = attribute(attributes, 'data-node-kind');
		const label = attribute(attributes, 'data-node-label');
		const line = attribute(attributes, 'data-source-line');
		/* `full` mode writes all four together. A group missing any of them is not
		   markup this renderer produced, and inventing a label or a line number for
		   it would put a fabricated declaration into the recovered source. */
		if (id === undefined || kind === undefined || label === undefined || line === undefined) {
			continue;
		}
		components.push({
			id: unescapeXml(id),
			kind,
			label: unescapeXml(label),
			x: Number(match[2]),
			y: Number(match[3]),
			line: Number(line),
			...(attribute(attributes, 'data-orientation') === undefined
				? {}
				: { orientation: attribute(attributes, 'data-orientation')! }),
			/* The vector inside the group carries the paint, not the group. */
			color: recoverColor(svg.slice(match.index!, match.index! + 1200))
		});
	}

	const connections: RecoveredConnection[] = [];
	for (const match of svg.matchAll(WIRE_GROUP)) {
		const attributes = match[1]!;
		const body = match[2]!;
		const from = attribute(attributes, 'data-wire-source');
		const to = attribute(attributes, 'data-wire-target');
		const line = attribute(attributes, 'data-source-line');
		const path = body.match(TRACE_PATH)?.[1];
		/* The drawn path is what says which curve this was, so a group without one
		   is not recoverable — defaulting to `line` would put a wrong option into
		   the source rather than admitting the group could not be read. */
		if (from === undefined || to === undefined || line === undefined || path === undefined) {
			continue;
		}
		const width = attribute(attributes, 'data-bus-width');
		const net = attribute(attributes, 'data-net-id');
		const signalKind = attribute(attributes, 'data-signal-kind');
		connections.push({
			from: unescapeXml(from),
			to: unescapeXml(to),
			line: Number(line),
			curve: recoverCurve(path),
			color: recoverColor(body),
			markerStart: body.match(MARKER_START)?.[1] ?? 'none',
			markerEnd: body.match(MARKER_END)?.[1] ?? 'none',
			...(net === undefined ? {} : { net }),
			...(signalKind === undefined ? {} : { signalKind }),
			...(width === undefined ? {} : { width: Number(width) })
		});
	}

	/*
	 * Losses are reported per class, once, rather than per declaration: a reader
	 * needs to know that variants did not survive, not to be told so forty times.
	 */
	const lost: SchematicRecoveryLoss[] = [
		{
			code: 'component-variant',
			detail:
				'Family options such as type= and variant= are not stamped on the markup; they survive only as prose inside each group\'s aria-label. A recovered resistor is a plain resistor even if it was declared as a thermistor.'
		}
	];
	if (connections.some((connection) => connection.net !== undefined)) {
		lost.push({
			code: 'net-name',
			detail:
				'Wires carry the resolved net identity, not the author\'s net= name. Nets the parser inferred are indistinguishable from nets the author named.'
		});
	}
	const lines: string[] = [];
	for (const component of components) {
		const orientation =
			component.orientation === undefined ? '' : ` [orientation=${component.orientation}]`;
		lines.push(
			`${component.kind}:${component.id} "${component.label}" at (${component.x}, ${component.y}) ${colorSyntax(component.color)}${orientation}`
		);
	}
	if (connections.length > 0) lines.push('');
	for (const connection of connections) {
		const options: string[] = [connection.curve];
		if (connection.signalKind !== undefined) options.push(connection.signalKind);
		if (connection.width !== undefined) options.push(`width=${connection.width}`);
		if (connection.markerStart !== 'none') options.push(`marker-start=${connection.markerStart}`);
		if (connection.markerEnd !== 'none') options.push(`marker-end=${connection.markerEnd}`);
		lines.push(
			`${connection.from} -> ${connection.to} ${colorSyntax(connection.color)} [${options.join(' ')}]`
		);
	}

	return {
		components,
		connections,
		source: lines.join('\n'),
		lost
	};
}
