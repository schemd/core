import type { RoutedConnection } from './layout.js';
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
