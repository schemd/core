import type { RoutedConnection, SchematicRoutingReport } from './layout.js';
import type { SchematicPlacement } from './placement.js';
import type { SchematicBounds, SchematicDocument, SchematicSheet } from './types.js';

interface CachedDoc {
	readonly key: string;
	readonly routes: readonly RoutedConnection[];
	readonly sheet: SchematicSheet;
	readonly placements: readonly SchematicPlacement[];
	readonly routing: SchematicRoutingReport;
}

const cache = new WeakMap<SchematicDocument, CachedDoc>();
const canvasKey = (bounds: SchematicBounds | 'auto'): string => (bounds === 'auto' ? bounds : `${bounds.width}x${bounds.height}`);
export const isParsedSchematic = (document: SchematicDocument): boolean => cache.has(document);

export function cacheParsedSchematic(
	document: SchematicDocument,
	bounds: SchematicBounds | 'auto',
	routes: readonly RoutedConnection[],
	sheet: SchematicSheet,
	placements: readonly SchematicPlacement[],
	routing: SchematicRoutingReport
): void {
	cache.set(document, { key: canvasKey(bounds), routes, sheet, placements, routing });
}

export function parsedSchematicGeometry(
	document: SchematicDocument,
	bounds: SchematicBounds | 'auto'
): { readonly routes: readonly RoutedConnection[]; readonly sheet: SchematicSheet } | undefined {
	const entry = cache.get(document);
	return entry?.key === canvasKey(bounds) ? entry : undefined;
}

const NO_EVIDENCE: { readonly placements: readonly SchematicPlacement[]; readonly routing: SchematicRoutingReport } = Object.freeze({
	placements: Object.freeze([]),
	routing: Object.freeze({ attempts: 0, rippedUp: Object.freeze([]), congestion: Object.freeze([]), nudged: false })
});

export function parsedSchematicEvidence(document: SchematicDocument): { readonly placements: readonly SchematicPlacement[]; readonly routing: SchematicRoutingReport } {
	return cache.get(document) ?? NO_EVIDENCE;
}
