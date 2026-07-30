import type { RoutedConnection, SchematicRoutingReport } from './layout.js';
import type { SchematicPlacement } from './placement.js';
import type { SchematicBounds, SchematicDocument } from './types.js';

/** Parser-validated routes retained only while their immutable document is alive. */
const parsedDocumentRoutes = new WeakMap<
	SchematicDocument,
	{ readonly width: number; readonly height: number; readonly routes: readonly RoutedConnection[] }
>();

/** Cache a validated route set against the bounds that produced it. */
export function cacheParsedSchematicRoutes(
	document: SchematicDocument,
	bounds: SchematicBounds,
	routes: readonly RoutedConnection[]
): void {
	parsedDocumentRoutes.set(document, { width: bounds.width, height: bounds.height, routes });
}

/** Reuse routes only when render bounds match the parser's geometry contract. */
export function parsedSchematicRoutes(
	document: SchematicDocument,
	bounds: SchematicBounds
): readonly RoutedConnection[] | undefined {
	const cached = parsedDocumentRoutes.get(document);
	return cached?.width === bounds.width && cached.height === bounds.height
		? cached.routes
		: undefined;
}

/**
 * Parse-time byproducts a later consumer needs but the document type should not carry.
 *
 * `SchematicDocument` is the contract a host holds and a renderer authorizes; it
 * describes what the author declared. Resolved placements and the router's own
 * account of how hard it had to work are *evidence about* that document, not part
 * of it, and widening the type for them would make every consumer with an
 * exhaustive read of the document handle fields it has no use for. The same
 * weak-keyed side channel the routes already travel through is the right shape,
 * and it keeps the evidence alive exactly as long as the document is.
 */
const parsedDocumentEvidence = new WeakMap<
	SchematicDocument,
	{
		readonly placements: readonly SchematicPlacement[];
		readonly routing: SchematicRoutingReport;
	}
>();

/** Retain the placement and routing evidence gathered while parsing one document. */
export function cacheParsedSchematicEvidence(
	document: SchematicDocument,
	placements: readonly SchematicPlacement[],
	routing: SchematicRoutingReport
): void {
	parsedDocumentEvidence.set(document, { placements, routing });
}

/** Stated for a document this module never saw parsed: nothing placed, nothing retried. */
const NO_EVIDENCE: {
	readonly placements: readonly SchematicPlacement[];
	readonly routing: SchematicRoutingReport;
} = Object.freeze({
	placements: Object.freeze([]),
	routing: Object.freeze({
		attempts: 0,
		rippedUp: Object.freeze([]),
		congestion: Object.freeze([])
	})
});

/**
 * Read back the evidence gathered while parsing one document.
 *
 * A document assembled by hand rather than parsed has none, and gets the empty
 * reading rather than `undefined`. Absorbing that here keeps the fallback in one
 * reachable place instead of pushing an unreachable branch into every caller —
 * `compileSchematic` always parses, so a caller-side fallback could never run and
 * could never be tested.
 */
export function parsedSchematicEvidence(document: SchematicDocument): {
	readonly placements: readonly SchematicPlacement[];
	readonly routing: SchematicRoutingReport;
} {
	return parsedDocumentEvidence.get(document) ?? NO_EVIDENCE;
}
