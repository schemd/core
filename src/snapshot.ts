/**
 * A canonical text digest of a compiled diagram's geometry.
 *
 * The six Chromium goldens answer "does this render correctly?", which is a
 * question only a browser can settle. They answer "did the geometry change?"
 * badly: a moved vertex arrives as a red blob in an image diff, and a reviewer
 * cannot see *what* moved without opening two PNGs side by side.
 *
 * This answers the second question in text. Every component rectangle and every
 * trace vertex, rounded to the three decimals the SVG writer emits, in source
 * order. Committed as fixtures, a routing change shows up in a pull request as
 * the handful of coordinates that actually moved.
 *
 * It is deliberately *not* a replacement for the goldens. Nothing here can tell
 * you an arrowhead went missing or a label collided — see `tests/visual`, which
 * keeps exactly the cases that need a renderer.
 *
 * @packageDocumentation
 */
import {
	componentRectangle,
	routeConnections,
	validateDocumentGeometry,
	type RoutedConnection
} from './layout.js';
import { normalizeSchematicBounds, resolveSchematicLimits } from './limits.js';
import { parsedSchematicRoutes } from './route-cache.js';
import type {
	SchematicColor,
	SchematicComponent,
	SchematicDocument,
	SchematicFence
} from './types.js';

/**
 * Format identifier, incremented whenever the layout below changes.
 *
 * A committed fixture outlives the code that wrote it. Without a version line a
 * future format change reads as a diff in every snapshot at once, with nothing
 * saying whether the geometry moved or the writer did.
 */
export const SCHEMATIC_SNAPSHOT_VERSION = 1;

/** Match the SVG writer's precision so a snapshot never disagrees with the output. */
function decimal(value: number): string {
	return value.toFixed(3);
}

/** Render a colour as one token, whichever of the three forms it took. */
function colorText(color: SchematicColor): string {
	return `${color.kind}:${color.value}`;
}

/** One component as `id kind rect=(x,y,w,h) …`, with optional fields omitted. */
function componentLine(component: SchematicComponent): string {
	const rectangle = componentRectangle(component);
	const fields = [
		`component ${component.id} ${component.kind}`,
		`rect=(${decimal(rectangle.minX)},${decimal(rectangle.minY)},${decimal(
			rectangle.maxX - rectangle.minX
		)},${decimal(rectangle.maxY - rectangle.minY)})`,
		`at=(${decimal(component.x)},${decimal(component.y)})`
	];
	/* Absent rather than defaulted: a component with no orientation is a
	   different declaration from one that states its canonical direction, and a
	   digest that invented `orient=right` would hide that difference. */
	if ('orientation' in component && component.orientation !== undefined) {
		fields.push(`orient=${component.orientation}`);
	}
	fields.push(`color=${colorText(component.color)}`);
	return fields.join(' ');
}

/** One trace as `source->target curve=… vertices=[…]`. */
function traceLine(document: SchematicDocument, route: RoutedConnection, index: number): string {
	const connection = document.connections[index]!;
	const vertices = route.points
		.map((point) => `(${decimal(point.x)},${decimal(point.y)})`)
		.join(',');
	const fields = [
		`trace ${connection.from.componentId}.${connection.from.port}->${connection.to.componentId}.${connection.to.port}`,
		`curve=${route.curve}`,
		`markers=${connection.markerStart}/${connection.markerEnd}`,
		`color=${colorText(connection.color)}`
	];
	if (connection.width !== undefined) fields.push(`width=${connection.width}`);
	/* Always stated. The parser assigns every connection a net identity, so an
	   absent one means the document was assembled by hand — which is exactly the
	   case a reader would want the digest to be explicit about. */
	fields.push(`net=${connection.netId ?? 'none'}`);
	fields.push(`vertices=[${vertices}]`);
	return fields.join(' ');
}

/**
 * Produce the geometry digest for one document.
 *
 * Routes come from the parser's cache when the document was parsed against these
 * bounds, and are computed the same way the renderer computes them otherwise —
 * so a snapshot describes the drawing that would be emitted, never a second
 * opinion about it.
 *
 * @param document - Validated document, usually straight from `parseSchematic`.
 * @param fence - The bounds, title, and budgets the document was compiled with.
 * @returns A newline-terminated digest, stable across runs and platforms.
 */
export function snapshotSchematic(document: SchematicDocument, fence: SchematicFence): string {
	const bounds = normalizeSchematicBounds(fence.bounds.width, fence.bounds.height, 'Snapshot');
	const limits = resolveSchematicLimits(fence.limits);
	const routes =
		parsedSchematicRoutes(document, bounds) ??
		validateDocumentGeometry(
			document,
			{ ...fence, bounds },
			routeConnections(
				document.connections,
				new Map(document.components.map((component) => [component.id, component])),
				bounds,
				limits.wireCrossings
			)
		);

	const lines = [
		`schemd-snapshot ${SCHEMATIC_SNAPSHOT_VERSION}`,
		`bounds ${bounds.width}x${bounds.height}`,
		...document.components.map(componentLine),
		...routes.map((route, index) => traceLine(document, route, index))
	];
	return `${lines.join('\n')}\n`;
}
