/** One-pass compiler facade for hosts that do not need the parser and renderer separately. */
import { utf8ByteLength } from './limits.js';
import { assertParsedSchematicDocument, parseSchematic } from './parser.js';
import { renderSchematic } from './renderer.js';
import type { CompileSchematicOptions, SchematicDocument } from './types.js';

/** Small, allocation-bounded compilation counters. */
export interface SchematicCompilationMetrics {
	readonly sourceCharacters: number;
	readonly components: number;
	readonly connections: number;
	readonly svgBytes: number;
}

/** One component's declaration site, keyed by its document-unique id. */
export interface SchematicNodeSource {
	/** Document-unique component identifier (matches `data-node-id`). */
	readonly id: string;
	/** One-based source line that declared the component. */
	readonly line: number;
}

/** One connection's declaration site, keyed by its endpoint pair. */
export interface SchematicWireSource {
	/** Source endpoint `id.port` (matches `data-wire-source`). */
	readonly source: string;
	/** Target endpoint `id.port` (matches `data-wire-target`). */
	readonly target: string;
	/** One-based source line that declared the connection. */
	readonly line: number;
	/** Parser-resolved named or generated topology identity. */
	readonly netId?: string;
}

/**
 * A JSON-serializable map from rendered vectors back to their source lines.
 *
 * Both arrays are in source order, so a host can build whichever lookup it
 * needs (line → vector, or vector → line) without re-parsing the DSL. In
 * `full`-mode SVG the same lines are also emitted as `data-source-line`
 * attributes on each node and wire group.
 */
export interface SchematicSourceMap {
	readonly nodes: readonly SchematicNodeSource[];
	readonly wires: readonly SchematicWireSource[];
}

/** Validated AST, rendered SVG, and useful host-side counters. */
export interface SchematicCompilation {
	readonly document: SchematicDocument;
	readonly svg: string;
	readonly metrics: SchematicCompilationMetrics;
	readonly sourceMap: SchematicSourceMap;
}

/**
 * Derive the source map from an already-parsed document.
 *
 * Runs in one linear pass with no parsing, so hosts holding a document (for
 * example after {@link renderSchematic}) can obtain declaration lines cheaply.
 *
 * @param document - Immutable document returned by the parser.
 * @returns Source-ordered node and wire declaration sites.
 */
export function schematicSourceMap(document: SchematicDocument): SchematicSourceMap {
	assertParsedSchematicDocument(document);
	const nodes: SchematicNodeSource[] = [];
	for (const component of document.components) {
		nodes.push({ id: component.id, line: component.line });
	}
	const wires: SchematicWireSource[] = [];
	for (const connection of document.connections) {
		wires.push({
			source: `${connection.from.componentId}.${connection.from.port}`,
			target: `${connection.to.componentId}.${connection.to.port}`,
			line: connection.line,
			...(connection.netId === undefined ? {} : { netId: connection.netId })
		});
	}
	return { nodes, wires };
}

/** Parse and render a schematic with one stable public call. */
export function compileSchematic(source: string, options: CompileSchematicOptions): SchematicCompilation {
	const document = parseSchematic(source, options);
	const svg = renderSchematic(document, options);
	return {
		document,
		svg,
		metrics: {
			sourceCharacters: source.length,
			components: document.components.length,
			connections: document.connections.length,
			svgBytes: utf8ByteLength(svg)
		},
		sourceMap: schematicSourceMap(document)
	};
}
