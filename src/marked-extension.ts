/**
 * Type-only Marked adapter for compiling fenced `wiremd` diagrams during SSR.
 *
 * The module imports no Marked runtime. Its factory returns ordinary extension
 * hooks to a host-owned parser and enforces both per-diagram compiler ceilings
 * and cumulative limits across each Markdown document pass.
 *
 * @packageDocumentation
 */
import type { MarkedExtension, Tokens } from 'marked';
import {
	MAX_SCHEMATIC_COMPONENTS,
	MAX_SCHEMATIC_CONNECTIONS,
	MAX_SCHEMATIC_SOURCE_CHARACTERS,
	MAX_SCHEMATIC_SVG_OUTPUT_BYTES,
	utf8ByteLength
} from './limits.js';
import { parseSchematic, parseSchematicFence } from './parser.js';
import { renderSchematic } from './renderer.js';
import { SchematicSyntaxError, type SchematicMarkedOptions } from './types.js';

/** Aggregate compiler resources consumed during one Marked document pass. */
interface MarkedDocumentBudget {
	/** Total DSL characters accepted from recognized wiremd fences. */
	sourceCharacters: number;
	/** Total parsed components across recognized wiremd fences. */
	components: number;
	/** Total parsed connections across recognized wiremd fences. */
	connections: number;
	/** Total UTF-8 bytes emitted across recognized wiremd fences. */
	svgOutputBytes: number;
}

/**
 * Sticky cumulative-budget failure that short-circuits later fences in the same pass.
 *
 * @internal
 */
class SchematicDocumentBudgetError extends SchematicSyntaxError {}

/**
 * Create the mutable zero-value counter used for a new Markdown document.
 *
 * @returns Independent aggregate counters for one Marked parse pass.
 */
function emptyDocumentBudget(): MarkedDocumentBudget {
	return { sourceCharacters: 0, components: 0, connections: 0, svgOutputBytes: 0 };
}

/**
 * Add one compilation cost to an aggregate counter without integer overflow.
 *
 * @param used - Resource units already consumed by the current document.
 * @param amount - Non-negative units required by the candidate diagram.
 * @param limit - Maximum units permitted for one document pass.
 * @param unit - Human-readable diagnostic label for the resource.
 * @returns The new aggregate amount when it remains inside the limit.
 * @throws {SchematicDocumentBudgetError} When the addition exceeds `limit`.
 */
function consumeBudget(used: number, amount: number, limit: number, unit: string): number {
	if (amount > limit - used) {
		throw new SchematicDocumentBudgetError(
			`Schematic document exceeds the cumulative ${limit.toLocaleString('en-US')} ${unit} limit.`
		);
	}
	return used + amount;
}

/**
 * Escape untrusted DSL source before placing it in an HTML diagnostic fallback.
 *
 * @param value - Author-controlled source or diagnostic text.
 * @returns HTML-safe character data.
 */
function escapeHtml(value: string): string {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;');
}

/**
 * Render a safe, accessible compiler diagnostic when no host callback is supplied.
 *
 * @param error - Validated compiler failure exposed to the reader.
 * @param source - Original DSL body, escaped before insertion.
 * @returns Trusted fallback markup containing no executable author HTML.
 */
function defaultErrorRenderer(error: SchematicSyntaxError, source: string): string {
	return `<figure class="schematic-error" role="group" aria-label="Schematic compilation error"><figcaption>${escapeHtml(error.message)}</figcaption><pre><code class="language-wiremd">${escapeHtml(source)}</code></pre></figure>`;
}

/**
 * Create a bounded Marked extension that compiles `wiremd` fences into inline SVG.
 *
 * The returned extension keeps aggregate per-document budgets in closure state,
 * resets them from Marked's `preprocess` hook, and recognizes only the canonical
 * `wiremd` language identifier.
 *
 * @param options - Output mode, accessible-title fallback, dynamic mode resolver,
 *   and trusted server-side diagnostic renderer.
 * @returns A Marked extension suitable for a server-owned `Marked` instance.
 */
export function schematicMarkedExtension(options: SchematicMarkedOptions = {}): MarkedExtension {
	/** One-based diagram counter used to namespace SVG definitions per pass. */
	let diagramIndex = 0;
	/** Mutable cumulative allocation counters reset by the preprocess hook. */
	let budget = emptyDocumentBudget();
	/** Sticky terminal budget error reused for every remaining recognized fence. */
	let budgetError: SchematicDocumentBudgetError | undefined;
	return {
		hooks: {
			/** Reset request-local counters before Marked tokenizes a new document. */
			preprocess(source) {
				diagramIndex = 0;
				budget = emptyDocumentBudget();
				budgetError = undefined;
				return source;
			}
		},
		renderer: {
			/** Compile recognized wiremd code tokens and delegate other languages to Marked. */
			code(token: Tokens.Code) {
				if (!token.lang || !/^wiremd(?:\s|$)/i.test(token.lang.trim())) {
					return false;
				}
				try {
					if (budgetError) throw budgetError;
					budget.sourceCharacters = consumeBudget(
						budget.sourceCharacters,
						token.text.length,
						MAX_SCHEMATIC_SOURCE_CHARACTERS,
						'schematic source character'
					);
					const fence = parseSchematicFence(token.lang, options.defaultTitle)!;
					diagramIndex += 1;
					const document = parseSchematic(token.text, fence);
					const nextComponents = consumeBudget(
						budget.components,
						document.components.length,
						MAX_SCHEMATIC_COMPONENTS,
						'component'
					);
					const nextConnections = consumeBudget(
						budget.connections,
						document.connections.length,
						MAX_SCHEMATIC_CONNECTIONS,
						'connection'
					);
					const html = renderSchematic(document, {
						...fence,
						idPrefix: `schematic-${diagramIndex}`,
						mode: options.resolveMode?.() ?? options.mode ?? 'default'
					});
					const nextSvgOutputBytes = consumeBudget(
						budget.svgOutputBytes,
						utf8ByteLength(html),
						MAX_SCHEMATIC_SVG_OUTPUT_BYTES,
						'compiled SVG byte'
					);
					budget.components = nextComponents;
					budget.connections = nextConnections;
					budget.svgOutputBytes = nextSvgOutputBytes;
					return html;
				} catch (error) {
					if (!(error instanceof SchematicSyntaxError)) throw error;
					if (error instanceof SchematicDocumentBudgetError) budgetError = error;
					return (options.onError ?? defaultErrorRenderer)(error, token.text);
				}
			}
		}
	};
}
