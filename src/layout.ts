/**
 * Deterministic component geometry, terminal resolution, and wire routing.
 *
 * The layout pass performs bounded arithmetic directly in SVG viewBox units;
 * it has no graph-layout dependency, mutable global state, DOM measurement, or
 * asynchronous work. Orthogonal traces avoid expanded component AABBs and later
 * crossings receive compact engineering bridge arcs in source order.
 *
 * @packageDocumentation
 */
import {
	CLASSICAL_GATE_KINDS,
	SchematicSyntaxError,
	type ClassicalGateComponent,
	type IntegratedCircuitComponent,
	type SchematicBounds,
	type SchematicComponent,
	type SchematicConnection,
	type SchematicDocument,
	type SchematicEndpoint,
	type SchematicFence,
	type SchematicPoint
} from './types.js';
import { mathLabelGlyphLength } from './math-label.js';

/** Axis-aligned rectangle expressed in absolute schematic coordinates. */
export interface SchematicRectangle {
	/** Inclusive left extent. */
	minX: number;
	/** Inclusive top extent. */
	minY: number;
	/** Inclusive right extent. */
	maxX: number;
	/** Inclusive bottom extent. */
	maxY: number;
}

/** Render-ready connection path and the points used for bounds validation. */
export interface RoutedConnection {
	/** Compact SVG path-data string. */
	d: string;
	/** At least two absolute points spanning endpoints, controls, corners, and bridge extrema. */
	points: readonly [SchematicPoint, SchematicPoint, ...SchematicPoint[]];
}

/** One non-degenerate horizontal or vertical segment in a routed trace. */
interface AxisSegment {
	/** Zero-based source-order route index. */
	readonly routeIndex: number;
	/** Zero-based segment index within the route's point list. */
	readonly segmentIndex: number;
	/** Segment origin. */
	readonly start: SchematicPoint;
	/** Segment destination. */
	readonly end: SchematicPoint;
	/** Constant coordinate axis for crossing classification. */
	readonly orientation: 'horizontal' | 'vertical';
}

/** External text-row baselines and fitted widths relative to a component origin. */
export interface ComponentTextAnchors {
	/** Vertical designator baseline offset. */
	designatorY: number;
	/** Vertical human-readable label baseline offset. */
	labelY: number;
	/** Estimated designator width in viewBox units. */
	designatorWidth: number;
	/** Estimated label width after micro-math translation. */
	labelWidth: number;
}

/** A canonical, physically rendered component terminal and its absolute SVG coordinate. */
export interface ComponentPort {
	/** Canonical terminal name emitted by full-mode interaction hooks. */
	readonly id: string;
	/** Absolute center of the physical terminal. */
	readonly point: SchematicPoint;
}

/** One edge of a polymorphic integrated-circuit body. */
export type IcPinSide = 'left' | 'right' | 'top' | 'bottom';

/** An eight-pixel target satisfies the minimum pointer hotspot without changing vector geometry. */
export const PORT_HOTSPOT_RADIUS = 4;

/** Physical clearance between an orthogonal trace and a component body. */
export const SCHEMATIC_OBSTACLE_CLEARANCE = 12;

/** Radius of the engineering crossover arc inserted at non-junction wire crossings. */
export const SCHEMATIC_BRIDGE_RADIUS = 5;

/** Hard ceiling preventing pathological obstacle layouts from cycling indefinitely. */
const MAX_OBSTACLE_PASSES = 16;
/** Spatial-hash cell size used to bound wire-crossing comparisons. */
const CROSSING_BUCKET_SIZE = 64;

/** Gap from upper geometry to the component designator baseline. */
const DESIGNATOR_BASELINE_GAP = 10;
/** Gap from lower geometry to the human-readable label baseline. */
const LABEL_BASELINE_GAP = 19;
/** Conservative text ascent included in component bounds. */
const TEXT_ASCENT_GUTTER = 12;
/** Conservative text descent included in component bounds. */
const TEXT_DESCENT_GUTTER = 5;
/** Monospace glyph-width estimate used for static text fitting. */
const TEXT_ADVANCE = 7;
/** Horizontal clearance retained around external text rows. */
const TEXT_HORIZONTAL_GUTTER = 4;

/** Accepted aliases resolving to a passive component's left terminal. */
const PASSIVE_INPUT_PORTS = new Set(['in', 'left', 'l']);
/** Accepted aliases resolving to a passive component's right terminal. */
const PASSIVE_OUTPUT_PORTS = new Set(['out', 'right', 'r']);
/** Accepted aliases resolving to a diode's anode. */
const DIODE_ANODE_PORTS = new Set(['anode', 'a']);
/** Accepted aliases resolving to a diode's cathode. */
const DIODE_CATHODE_PORTS = new Set(['cathode', 'k', 'c']);
/** Accepted aliases resolving to a transistor control terminal. */
const TRANSISTOR_CONTROL_PORTS = new Set(['base', 'gate', 'b', 'g']);
/** Accepted aliases resolving to a transistor collector or drain. */
const TRANSISTOR_UPPER_PORTS = new Set(['collector', 'drain', 'c', 'd']);
/** Accepted aliases resolving to a transistor emitter or source. */
const TRANSISTOR_LOWER_PORTS = new Set(['emitter', 'source', 'e', 's']);

/**
 * Format finite geometry to at most three decimal places and normalize near-zero values.
 *
 * @param value - Computed viewBox coordinate.
 * @returns Compact decimal representation without insignificant trailing zeroes.
 */
function formatNumber(value: number): string {
	const rounded = Math.abs(value) < 0.0005 ? 0 : Number(value.toFixed(3));
	return String(rounded);
}

/**
 * Evenly distribute a terminal within a centered span while preserving edge clearance.
 *
 * @param index - Zero-based item index.
 * @param count - Positive number of items in the distribution.
 * @param span - Total centered span in viewBox units.
 * @returns Relative coordinate between negative and positive half-span.
 */
export function distributedCoordinate(index: number, count: number, span: number): number {
	return ((index + 1) * span) / (count + 1) - span / 2;
}

/**
 * Compute a classical gate height that scales with its busiest terminal side.
 *
 * @param component - Validated classical gate.
 * @returns Height in viewBox units, never smaller than 48.
 */
export function classicalGateHeight(component: ClassicalGateComponent): number {
	return Math.max(48, Math.max(component.inputs, component.outputs) * 16);
}

/**
 * Narrow any component to the classical-gate union.
 *
 * @param component - Component to classify.
 * @returns Whether its kind belongs to the classical gate registry.
 */
function isClassicalGate(component: SchematicComponent): component is ClassicalGateComponent {
	return CLASSICAL_GATE_KINDS.includes(component.kind as ClassicalGateComponent['kind']);
}

/**
 * Resolve a validated classical gate terminal to an absolute point.
 *
 * @param component - Gate owning the terminal.
 * @param port - `in`, `out`, or a validated one-based indexed variant.
 * @returns Terminal point at the fixed gate stub extent.
 */
function indexedPortPoint(component: ClassicalGateComponent, port: string): SchematicPoint {
	const output = port.startsWith('out');
	const count = output ? component.outputs : component.inputs;
	const suffix = port.match(/\d+$/)?.[0];
	const index = suffix === undefined ? 0 : Number(suffix) - 1;
	return {
		x: component.x + (output ? 48 : -48),
		y: component.y + distributedCoordinate(index, count, classicalGateHeight(component))
	};
}

/**
 * Position an already-indexed IC pin in O(1), without scanning any side list.
 *
 * @param component - Integrated circuit owning the side list.
 * @param side - Physical edge on which the pin is declared.
 * @param index - Zero-based index within that edge's pin array.
 * @returns Absolute terminal point 16 units beyond the IC body.
 * @throws {RangeError} When `index` is non-integral or outside the selected side.
 */
export function positionIcPin(
	component: IntegratedCircuitComponent,
	side: IcPinSide,
	index: number
): SchematicPoint {
	const pins = component.pins[side];
	if (!Number.isInteger(index) || index < 0 || index >= pins.length) {
		throw new RangeError(`IC pin index ${index} is outside ${component.id}.${side}.`);
	}
	if (side === 'left' || side === 'right') {
		return {
			x:
				component.x +
				(side === 'left' ? -component.bodyWidth / 2 - 16 : component.bodyWidth / 2 + 16),
			y: component.y + distributedCoordinate(index, pins.length, component.bodyHeight)
		};
	}
	return {
		x: component.x + distributedCoordinate(index, pins.length, component.bodyWidth),
		y:
			component.y +
			(side === 'top' ? -component.bodyHeight / 2 - 16 : component.bodyHeight / 2 + 16)
	};
}

/**
 * Scan the four bounded IC side lists for an exact pin name.
 *
 * @param component - Integrated circuit to inspect.
 * @param port - Exact registered pin name.
 * @returns Absolute point, or `undefined` when the pin is absent.
 */
function findIcPin(
	component: IntegratedCircuitComponent,
	port: string
): SchematicPoint | undefined {
	const sides = ['left', 'right', 'top', 'bottom'] as const;
	for (const side of sides) {
		const index = component.pins[side].indexOf(port);
		if (index >= 0) return positionIcPin(component, side, index);
	}
	return undefined;
}

/**
 * Resolve an IC pin, including stable `in` and `out` aliases.
 *
 * Aliases prefer explicitly named `in1`/`out1`, then the first pin on the
 * conventional input/output sides.
 *
 * @param component - Integrated circuit owning the pin registry.
 * @param port - Exact pin name or stable alias.
 * @returns Absolute point when resolvable.
 */
function icPinPoint(
	component: IntegratedCircuitComponent,
	port: string
): SchematicPoint | undefined {
	if (port === 'in' || port === 'out') {
		const canonical = findIcPin(component, `${port}1`);
		if (canonical !== undefined) return canonical;
		const aliasSides = port === 'in' ? (['left', 'top'] as const) : (['right', 'bottom'] as const);
		for (const side of aliasSides) {
			if (component.pins[side].length > 0) return positionIcPin(component, side, 0);
		}
		return undefined;
	}
	return findIcPin(component, port);
}

/**
 * Resolve a validated, named component port into absolute schematic coordinates.
 *
 * @param component - Component owning the previously validated terminal.
 * @param port - Canonical name or supported alias.
 * @returns Absolute terminal coordinate used by routing and interaction hotspots.
 * @throws {Error} When called with an endpoint the semantic parser did not validate.
 */
export function resolvePortPoint(component: SchematicComponent, port: string): SchematicPoint {
	if (isClassicalGate(component)) return indexedPortPoint(component, port);
	const left = { x: component.x - 42, y: component.y };
	const right = { x: component.x + 42, y: component.y };
	switch (component.kind) {
		case 'resistor':
		case 'capacitor':
		case 'inductor':
			if (PASSIVE_INPUT_PORTS.has(port)) return left;
			if (PASSIVE_OUTPUT_PORTS.has(port)) return right;
			break;
		case 'diode':
			if (DIODE_ANODE_PORTS.has(port)) return left;
			if (DIODE_CATHODE_PORTS.has(port)) return right;
			break;
		case 'transistor':
			if (TRANSISTOR_CONTROL_PORTS.has(port)) return left;
			if (TRANSISTOR_UPPER_PORTS.has(port)) {
				return { x: component.x + 42, y: component.y - 22 };
			}
			if (TRANSISTOR_LOWER_PORTS.has(port)) {
				return { x: component.x + 42, y: component.y + 22 };
			}
			break;
		case 'port':
			if (port === 'in') return left;
			if (port === 'out') return right;
			break;
		case 'ground':
			if (port === 'in') return { x: component.x, y: component.y - 42 };
			break;
		case 'hadamard':
		case 'qgate':
			if (port === 'in') return { x: component.x - 48, y: component.y };
			if (port === 'out') return { x: component.x + 48, y: component.y };
			break;
		case 'cnot':
			if (port === 'in') return left;
			if (port === 'out') return right;
			if (port === 'control') return { x: component.x, y: component.y - 16 };
			if (port === 'target') return { x: component.x, y: component.y + 16 };
			break;
		case 'ic': {
			const point = icPinPoint(component, port);
			if (point !== undefined) return point;
			break;
		}
	}
	throw new Error(`Validated port ${component.id}.${port} is missing.`);
}

/**
 * Construct a canonical port descriptor through the shared resolution path.
 *
 * @param component - Port-owning component.
 * @param id - Canonical terminal name.
 * @returns Port name paired with its absolute coordinate.
 */
function namedPort(component: SchematicComponent, id: string): ComponentPort {
	return { id, point: resolvePortPoint(component, id) };
}

/**
 * Enumerate each physical terminal exactly once. Alias spellings deliberately resolve through
 * `resolvePortPoint` but do not create duplicate interactive targets.
 *
 * @param component - Component whose canonical terminals should be exposed.
 * @returns Port descriptors in stable physical/source order.
 */
export function enumerateComponentPorts(component: SchematicComponent): readonly ComponentPort[] {
	if (isClassicalGate(component)) {
		return [
			...Array.from({ length: component.inputs }, (_, index) =>
				namedPort(component, `in${index + 1}`)
			),
			...Array.from({ length: component.outputs }, (_, index) =>
				namedPort(component, `out${index + 1}`)
			)
		];
	}
	switch (component.kind) {
		case 'resistor':
		case 'capacitor':
		case 'inductor':
		case 'port':
		case 'hadamard':
		case 'qgate':
			return [namedPort(component, 'in'), namedPort(component, 'out')];
		case 'diode':
			return [namedPort(component, 'anode'), namedPort(component, 'cathode')];
		case 'transistor': {
			const bipolar = component.transistorType === 'npn' || component.transistorType === 'pnp';
			return bipolar
				? [
						namedPort(component, 'base'),
						namedPort(component, 'collector'),
						namedPort(component, 'emitter')
					]
				: [
						namedPort(component, 'gate'),
						namedPort(component, 'drain'),
						namedPort(component, 'source')
					];
		}
		case 'ground':
			return [namedPort(component, 'in')];
		case 'cnot':
			return [
				namedPort(component, 'in'),
				namedPort(component, 'out'),
				namedPort(component, 'control'),
				namedPort(component, 'target')
			];
		case 'ic': {
			const sides = ['left', 'right', 'top', 'bottom'] as const;
			return sides.flatMap((side) =>
				component.pins[side].map((id, index) => ({
					id,
					point: positionIcPin(component, side, index)
				}))
			);
		}
	}
}

/**
 * Resolve a connection endpoint through the document component index.
 *
 * @param endpoint - Validated component/port pair.
 * @param components - Complete document component map.
 * @returns Absolute terminal coordinate.
 * @throws {Error} If a post-validation caller supplies an inconsistent map.
 */
function endpointPoint(
	endpoint: SchematicEndpoint,
	components: ReadonlyMap<string, SchematicComponent>
): SchematicPoint {
	const component = components.get(endpoint.componentId);
	if (component === undefined) {
		throw new Error(`Validated component ${endpoint.componentId} is missing.`);
	}
	return resolvePortPoint(component, endpoint.port);
}

/**
 * Compare two generated points using the renderer's three-decimal tolerance.
 *
 * @param left - First point.
 * @param right - Second point.
 * @returns Whether both coordinates differ by less than half a thousandth.
 */
function samePoint(left: SchematicPoint, right: SchematicPoint): boolean {
	return Math.abs(left.x - right.x) < 0.0005 && Math.abs(left.y - right.y) < 0.0005;
}

/**
 * Remove duplicate points and redundant collinear corners from an orthogonal route.
 *
 * @param points - Candidate points in traversal order.
 * @returns New minimal mutable point array preserving route direction.
 */
function compactOrthogonalPoints(points: readonly SchematicPoint[]): SchematicPoint[] {
	const deduplicated: SchematicPoint[] = [];
	for (const point of points) {
		if (!samePoint(deduplicated.at(-1) ?? { x: Number.NaN, y: Number.NaN }, point)) {
			deduplicated.push(point);
		}
	}
	let index = 1;
	while (index < deduplicated.length - 1) {
		const previous = deduplicated[index - 1]!;
		const current = deduplicated[index]!;
		const next = deduplicated[index + 1]!;
		if (
			(previous.x === current.x && current.x === next.x) ||
			(previous.y === current.y && current.y === next.y)
		) {
			deduplicated.splice(index, 1);
			continue;
		}
		index += 1;
	}
	return deduplicated;
}

/**
 * Serialize compact orthogonal points using horizontal and vertical SVG commands.
 *
 * @param points - At least one point in traversal order.
 * @returns Compact absolute SVG path data.
 */
function orthogonalPath(points: readonly SchematicPoint[]): string {
	const first = points[0]!;
	let path = `M ${formatNumber(first.x)} ${formatNumber(first.y)}`;
	for (let index = 1; index < points.length; index += 1) {
		const previous = points[index - 1]!;
		const point = points[index]!;
		if (previous.y === point.y) path += ` H ${formatNumber(point.x)}`;
		else path += ` V ${formatNumber(point.y)}`;
	}
	return path;
}

/**
 * Expand the intrinsic component body AABB by a routing clearance.
 *
 * External labels are deliberately excluded so wires can pass through text rows
 * while remaining clear of physical symbols and terminals.
 *
 * @param component - Component whose body extents are required.
 * @param clearance - Non-negative expansion in viewBox units.
 * @returns Expanded obstacle rectangle.
 */
function expandedComponentRectangle(
	component: SchematicComponent,
	clearance: number
): SchematicRectangle {
	const { halfWidth, halfHeight } = componentHalfExtents(component);
	return {
		minX: component.x - halfWidth - clearance,
		minY: component.y - halfHeight - clearance,
		maxX: component.x + halfWidth + clearance,
		maxY: component.y + halfHeight + clearance
	};
}

/**
 * Return the AABB used by orthogonal routing, including engineering clearance.
 *
 * @param component - Component treated as a routing obstacle.
 * @param clearance - Optional non-negative margin; defaults to 12 units.
 * @returns Expanded physical-body rectangle.
 * @throws {RangeError} For negative or non-finite clearance values.
 */
export function componentObstacleRectangle(
	component: SchematicComponent,
	clearance = SCHEMATIC_OBSTACLE_CLEARANCE
): SchematicRectangle {
	if (!Number.isFinite(clearance) || clearance < 0) {
		throw new RangeError('Component obstacle clearance must be a finite non-negative number.');
	}
	return expandedComponentRectangle(component, clearance);
}

/**
 * Detect a strict interior intersection between an axis-aligned segment and AABB.
 *
 * Points exactly on a clearance boundary are legal. Callers only pass horizontal
 * or vertical segments; any non-horizontal segment follows the vertical branch.
 *
 * @param start - Segment origin.
 * @param end - Segment destination.
 * @param rectangle - Obstacle to test.
 * @returns Whether the segment penetrates the rectangle interior.
 */
function segmentIntersectsRectangle(
	start: SchematicPoint,
	end: SchematicPoint,
	rectangle: SchematicRectangle
): boolean {
	if (start.y === end.y) {
		return (
			start.y > rectangle.minY &&
			start.y < rectangle.maxY &&
			Math.max(start.x, end.x) > rectangle.minX &&
			Math.min(start.x, end.x) < rectangle.maxX
		);
	}
	return (
		start.x > rectangle.minX &&
		start.x < rectangle.maxX &&
		Math.max(start.y, end.y) > rectangle.minY &&
		Math.min(start.y, end.y) < rectangle.maxY
	);
}

/**
 * Count segment/obstacle penetrations for deterministic detour ranking.
 *
 * @param points - Candidate orthogonal route.
 * @param obstacles - Expanded component AABBs.
 * @returns Total collisions; a segment may contribute more than one.
 */
function candidateCollisionCount(
	points: readonly SchematicPoint[],
	obstacles: readonly SchematicRectangle[]
): number {
	let collisions = 0;
	for (let index = 1; index < points.length; index += 1) {
		for (const obstacle of obstacles) {
			if (segmentIntersectsRectangle(points[index - 1]!, points[index]!, obstacle)) collisions += 1;
		}
	}
	return collisions;
}

/**
 * Measure Manhattan length of a candidate orthogonal route.
 *
 * @param points - Route points in traversal order.
 * @returns Sum of horizontal and vertical segment lengths.
 */
function candidateLength(points: readonly SchematicPoint[]): number {
	let length = 0;
	for (let index = 1; index < points.length; index += 1) {
		length +=
			Math.abs(points[index]!.x - points[index - 1]!.x) +
			Math.abs(points[index]!.y - points[index - 1]!.y);
	}
	return length;
}

/**
 * Select the least-colliding, then shortest detour around one obstacle boundary.
 *
 * @param routeStart - Full route origin.
 * @param routeEnd - Full route destination.
 * @param obstacle - Collision selected for this bounded pass.
 * @param obstacles - All expanded component obstacles used to rank candidates.
 * @returns Best of the top, bottom, left, and right deterministic detours.
 */
function detourRoute(
	routeStart: SchematicPoint,
	routeEnd: SchematicPoint,
	obstacle: SchematicRectangle,
	obstacles: readonly SchematicRectangle[]
): readonly SchematicPoint[] {
	const candidates: (readonly SchematicPoint[])[] = [
		[
			routeStart,
			{ x: routeStart.x, y: obstacle.minY },
			{ x: routeEnd.x, y: obstacle.minY },
			routeEnd
		],
		[
			routeStart,
			{ x: routeStart.x, y: obstacle.maxY },
			{ x: routeEnd.x, y: obstacle.maxY },
			routeEnd
		],
		[
			routeStart,
			{ x: obstacle.minX, y: routeStart.y },
			{ x: obstacle.minX, y: routeEnd.y },
			routeEnd
		],
		[
			routeStart,
			{ x: obstacle.maxX, y: routeStart.y },
			{ x: obstacle.maxX, y: routeEnd.y },
			routeEnd
		]
	];
	return [...candidates].sort((left, right) => {
		const collisionDifference =
			candidateCollisionCount(left, obstacles) - candidateCollisionCount(right, obstacles);
		if (collisionDifference !== 0) return collisionDifference;
		return candidateLength(left) - candidateLength(right);
	})[0]!;
}

/**
 * Iteratively reroute an orthogonal path around component interiors.
 *
 * @param points - Initial Manhattan route.
 * @param obstacles - Expanded body rectangles excluding source and target nodes.
 * @returns Compacted route after convergence or 16 bounded passes.
 */
function avoidComponentObstacles(
	points: readonly SchematicPoint[],
	obstacles: readonly SchematicRectangle[]
): SchematicPoint[] {
	let routed = compactOrthogonalPoints(points);
	for (let pass = 0; pass < MAX_OBSTACLE_PASSES; pass += 1) {
		let collision: { segmentIndex: number; obstacle: SchematicRectangle } | undefined;
		for (
			let segmentIndex = 1;
			segmentIndex < routed.length && collision === undefined;
			segmentIndex += 1
		) {
			for (const obstacle of obstacles) {
				if (
					segmentIntersectsRectangle(routed[segmentIndex - 1]!, routed[segmentIndex]!, obstacle)
				) {
					collision = { segmentIndex, obstacle };
					break;
				}
			}
		}
		if (collision === undefined) break;
		routed = compactOrthogonalPoints(
			detourRoute(routed[0]!, routed.at(-1)!, collision.obstacle, obstacles)
		);
	}
	return routed;
}

/**
 * Calculate a deterministic line, cubic Bézier, or orthogonal trace.
 *
 * @param connection - Validated directed connection.
 * @param components - Complete component map used for endpoint and obstacle lookup.
 * @returns SVG path data plus control/corner points for later bounds checks.
 */
export function routeConnection(
	connection: SchematicConnection,
	components: ReadonlyMap<string, SchematicComponent>
): RoutedConnection {
	const start = endpointPoint(connection.from, components);
	const end = endpointPoint(connection.to, components);
	const sx = formatNumber(start.x);
	const sy = formatNumber(start.y);
	const ex = formatNumber(end.x);
	const ey = formatNumber(end.y);
	if (connection.curve === 'bezier') {
		const middleX = (start.x + end.x) / 2;
		const controlA = { x: middleX, y: start.y };
		const controlB = { x: middleX, y: end.y };
		return {
			d: `M ${sx} ${sy} C ${formatNumber(controlA.x)} ${formatNumber(controlA.y)}, ${formatNumber(controlB.x)} ${formatNumber(controlB.y)}, ${ex} ${ey}`,
			points: [start, controlA, controlB, end]
		};
	}
	if (connection.curve === 'ortho') {
		const middleX = (start.x + end.x) / 2;
		const cornerA = { x: middleX, y: start.y };
		const cornerB = { x: middleX, y: end.y };
		const obstacles = Array.from(components.values())
			.filter(
				(component) =>
					component.id !== connection.from.componentId && component.id !== connection.to.componentId
			)
			.map((component) => componentObstacleRectangle(component));
		const points = avoidComponentObstacles([start, cornerA, cornerB, end], obstacles);
		return {
			d: orthogonalPath(points),
			points: points as [SchematicPoint, SchematicPoint, ...SchematicPoint[]]
		};
	}
	return { d: `M ${sx} ${sy} L ${ex} ${ey}`, points: [start, end] };
}

/**
 * Extract non-degenerate axis-aligned segments for spatial crossing detection.
 *
 * @param route - Previously generated route.
 * @param routeIndex - Source-order index assigned to every extracted segment.
 * @returns Horizontal and vertical segments; diagonal/Bézier spans are omitted.
 */
function axisSegments(route: RoutedConnection, routeIndex: number): AxisSegment[] {
	const segments: AxisSegment[] = [];
	for (let index = 1; index < route.points.length; index += 1) {
		const start = route.points[index - 1]!;
		const end = route.points[index]!;
		if (start.x === end.x && start.y !== end.y) {
			segments.push({ routeIndex, segmentIndex: index - 1, start, end, orientation: 'vertical' });
		} else if (start.y === end.y && start.x !== end.x) {
			segments.push({ routeIndex, segmentIndex: index - 1, start, end, orientation: 'horizontal' });
		}
	}
	return segments;
}

/**
 * Enumerate spatial-hash buckets touched by an axis-aligned segment.
 *
 * @param segment - Segment to index.
 * @returns Stable `x:y` bucket keys covering its inclusive AABB.
 */
function segmentBucketKeys(segment: AxisSegment): string[] {
	const minX = Math.floor(Math.min(segment.start.x, segment.end.x) / CROSSING_BUCKET_SIZE);
	const maxX = Math.floor(Math.max(segment.start.x, segment.end.x) / CROSSING_BUCKET_SIZE);
	const minY = Math.floor(Math.min(segment.start.y, segment.end.y) / CROSSING_BUCKET_SIZE);
	const maxY = Math.floor(Math.max(segment.start.y, segment.end.y) / CROSSING_BUCKET_SIZE);
	const keys: string[] = [];
	for (let x = minX; x <= maxX; x += 1) {
		for (let y = minY; y <= maxY; y += 1) keys.push(`${x}:${y}`);
	}
	return keys;
}

/**
 * Locate a strict interior crossing between perpendicular trace segments.
 *
 * Endpoint contacts are excluded so shared ports and junctions never receive a bridge.
 *
 * @param left - First axis-aligned segment.
 * @param right - Second axis-aligned segment.
 * @returns Intersection coordinate, or `undefined` for parallel/non-interior spans.
 */
function segmentCrossing(left: AxisSegment, right: AxisSegment): SchematicPoint | undefined {
	if (left.orientation === right.orientation) return undefined;
	const horizontal = left.orientation === 'horizontal' ? left : right;
	const vertical = left.orientation === 'vertical' ? left : right;
	const point = { x: vertical.start.x, y: horizontal.start.y };
	if (
		point.x <= Math.min(horizontal.start.x, horizontal.end.x) ||
		point.x >= Math.max(horizontal.start.x, horizontal.end.x) ||
		point.y <= Math.min(vertical.start.y, vertical.end.y) ||
		point.y >= Math.max(vertical.start.y, vertical.end.y)
	) {
		return undefined;
	}
	return point;
}

/**
 * Replace selected straight spans with semicircular SVG arc bridge commands.
 *
 * @param route - Orthogonal route receiving bridges.
 * @param crossings - Segment-indexed crossing coordinates in any order.
 * @returns Route with source-direction-sorted arcs and extra bounds extrema.
 */
function bridgedOrthogonalPath(
	route: RoutedConnection,
	crossings: ReadonlyMap<number, readonly SchematicPoint[]>
): RoutedConnection {
	if (crossings.size === 0) return route;
	const first = route.points[0]!;
	let path = `M ${formatNumber(first.x)} ${formatNumber(first.y)}`;
	const boundsPoints: SchematicPoint[] = [...route.points];
	for (let index = 1; index < route.points.length; index += 1) {
		const start = route.points[index - 1]!;
		const end = route.points[index]!;
		const segmentCrossings = [...(crossings.get(index - 1) ?? [])];
		const horizontal = start.y === end.y;
		const direction = Math.sign(horizontal ? end.x - start.x : end.y - start.y);
		const coordinate: keyof SchematicPoint = horizontal ? 'x' : 'y';
		segmentCrossings.sort((left, right) => direction * (left[coordinate] - right[coordinate]));
		if (horizontal) {
			for (const crossing of segmentCrossings) {
				const before = crossing.x - direction * SCHEMATIC_BRIDGE_RADIUS;
				const after = crossing.x + direction * SCHEMATIC_BRIDGE_RADIUS;
				path += ` H ${formatNumber(before)} A ${SCHEMATIC_BRIDGE_RADIUS} ${SCHEMATIC_BRIDGE_RADIUS} 0 0 ${direction > 0 ? 1 : 0} ${formatNumber(after)} ${formatNumber(crossing.y)}`;
				boundsPoints.push({ x: crossing.x, y: crossing.y - SCHEMATIC_BRIDGE_RADIUS });
			}
			path += ` H ${formatNumber(end.x)}`;
		} else {
			for (const crossing of segmentCrossings) {
				const before = crossing.y - direction * SCHEMATIC_BRIDGE_RADIUS;
				const after = crossing.y + direction * SCHEMATIC_BRIDGE_RADIUS;
				path += ` V ${formatNumber(before)} A ${SCHEMATIC_BRIDGE_RADIUS} ${SCHEMATIC_BRIDGE_RADIUS} 0 0 ${direction > 0 ? 0 : 1} ${formatNumber(crossing.x)} ${formatNumber(after)}`;
				boundsPoints.push({ x: crossing.x + SCHEMATIC_BRIDGE_RADIUS, y: crossing.y });
			}
			path += ` V ${formatNumber(end.y)}`;
		}
	}
	return {
		d: path,
		points: boundsPoints as [SchematicPoint, SchematicPoint, ...SchematicPoint[]]
	};
}

/**
 * Route connections in source order and bridge only the later trace at a true crossing.
 *
 * A fixed spatial bucket bounds comparisons in typical sparse diagrams. Parallel
 * overlaps, endpoint contacts, Bézier paths, and straight diagonal traces are not bridged.
 *
 * @param connections - Validated connections in deterministic source order.
 * @param components - Complete component map.
 * @returns Routes in the same order, with crossings applied to later orthogonal traces.
 */
export function routeConnections(
	connections: readonly SchematicConnection[],
	components: ReadonlyMap<string, SchematicComponent>
): readonly RoutedConnection[] {
	const routes = connections.map((connection) => routeConnection(connection, components));
	const buckets = new Map<string, AxisSegment[]>();
	const crossingsByRoute = new Map<number, Map<number, SchematicPoint[]>>();
	for (let routeIndex = 0; routeIndex < routes.length; routeIndex += 1) {
		const route = routes[routeIndex]!;
		for (const segment of axisSegments(route, routeIndex)) {
			const visited = new Set<string>();
			for (const key of segmentBucketKeys(segment)) {
				for (const previous of buckets.get(key) ?? []) {
					const identity = `${previous.routeIndex}:${previous.segmentIndex}`;
					if (visited.has(identity)) continue;
					visited.add(identity);
					const crossing = segmentCrossing(segment, previous);
					if (crossing === undefined) continue;
					let routeCrossings = crossingsByRoute.get(routeIndex);
					if (routeCrossings === undefined) {
						routeCrossings = new Map();
						crossingsByRoute.set(routeIndex, routeCrossings);
					}
					const points = routeCrossings.get(segment.segmentIndex) ?? [];
					if (!points.some((point) => samePoint(point, crossing))) points.push(crossing);
					routeCrossings.set(segment.segmentIndex, points);
				}
			}
		}
		for (const segment of axisSegments(route, routeIndex)) {
			for (const key of segmentBucketKeys(segment)) {
				const bucket = buckets.get(key) ?? [];
				bucket.push(segment);
				buckets.set(key, bucket);
			}
		}
	}
	return routes.map((route, index) =>
		bridgedOrthogonalPath(route, crossingsByRoute.get(index) ?? new Map())
	);
}

/**
 * Compute physical symbol half-extents without external text rows.
 *
 * @param component - Component whose vector body is measured.
 * @returns Horizontal and vertical half-extents including terminal stubs.
 */
function componentHalfExtents(component: SchematicComponent): {
	halfWidth: number;
	halfHeight: number;
} {
	let halfWidth: number;
	let halfHeight: number;
	if (isClassicalGate(component)) {
		halfWidth = 48;
		halfHeight = classicalGateHeight(component) / 2;
	} else {
		switch (component.kind) {
			case 'resistor':
			case 'capacitor':
			case 'inductor':
				halfWidth = 42;
				halfHeight = 18;
				break;
			case 'diode':
				halfWidth = 42;
				halfHeight = component.diodeType === 'led' ? 30 : 20;
				break;
			case 'transistor':
				halfWidth = 42;
				halfHeight = 38;
				break;
			case 'port':
				halfWidth = 42;
				halfHeight = 18;
				break;
			case 'ground':
				halfWidth = 22;
				halfHeight = 42;
				break;
			case 'hadamard':
			case 'qgate':
				halfWidth = 48;
				halfHeight = 30;
				break;
			case 'cnot':
				halfWidth = 42;
				halfHeight = 26;
				break;
			case 'ic':
				halfWidth = component.bodyWidth / 2 + 16;
				halfHeight = component.bodyHeight / 2 + 16;
				break;
		}
	}
	return { halfWidth, halfHeight };
}

/**
 * Calculate external designator and label fitting metrics.
 *
 * @param component - Component supplying identity, label, and physical height.
 * @returns Relative baselines and conservative width estimates.
 */
export function componentTextAnchors(component: SchematicComponent): ComponentTextAnchors {
	const { halfHeight } = componentHalfExtents(component);
	return {
		designatorY: -halfHeight - DESIGNATOR_BASELINE_GAP,
		labelY: halfHeight + LABEL_BASELINE_GAP,
		designatorWidth: Array.from(component.id).length * TEXT_ADVANCE,
		labelWidth: mathLabelGlyphLength(component.label) * TEXT_ADVANCE
	};
}

/**
 * Calculate complete component bounds, including text and interactive port radii.
 *
 * @param component - Component to measure.
 * @returns Absolute AABB encompassing vectors, label rows, and port hotspots.
 */
export function componentRectangle(component: SchematicComponent): SchematicRectangle {
	const { halfWidth } = componentHalfExtents(component);
	const anchors = componentTextAnchors(component);
	const textHalfWidth =
		Math.max(anchors.designatorWidth, anchors.labelWidth) / 2 + TEXT_HORIZONTAL_GUTTER;
	const boundedHalfWidth = Math.max(halfWidth, textHalfWidth);
	const rectangle = {
		minX: component.x - boundedHalfWidth,
		minY: component.y + anchors.designatorY - TEXT_ASCENT_GUTTER,
		maxX: component.x + boundedHalfWidth,
		maxY: component.y + anchors.labelY + TEXT_DESCENT_GUTTER
	};
	for (const port of enumerateComponentPorts(component)) {
		rectangle.minX = Math.min(rectangle.minX, port.point.x - PORT_HOTSPOT_RADIUS);
		rectangle.minY = Math.min(rectangle.minY, port.point.y - PORT_HOTSPOT_RADIUS);
		rectangle.maxX = Math.max(rectangle.maxX, port.point.x + PORT_HOTSPOT_RADIUS);
		rectangle.maxY = Math.max(rectangle.maxY, port.point.y + PORT_HOTSPOT_RADIUS);
	}
	return rectangle;
}

/**
 * Test whether a rectangle is fully contained by intrinsic SVG bounds.
 *
 * @param rectangle - Absolute component rectangle.
 * @param bounds - Zero-origin canvas dimensions.
 * @returns Whether every rectangle edge lies inside or on the canvas edge.
 */
function rectangleInsideBounds(rectangle: SchematicRectangle, bounds: SchematicBounds): boolean {
	return (
		rectangle.minX >= 0 &&
		rectangle.minY >= 0 &&
		rectangle.maxX <= bounds.width &&
		rectangle.maxY <= bounds.height
	);
}

/**
 * Test whether one absolute point lies in zero-origin intrinsic bounds.
 *
 * @param point - Point to inspect.
 * @param bounds - Canvas width and height.
 * @returns Whether both coordinates are inclusively bounded.
 */
function pointInsideBounds(point: SchematicPoint, bounds: SchematicBounds): boolean {
	return point.x >= 0 && point.y >= 0 && point.x <= bounds.width && point.y <= bounds.height;
}

/**
 * Validate final generated geometry after terminal distribution and wire routing.
 *
 * This complements lexical origin checks and prevents component stubs, dynamic
 * IC pins, labels, bridge extrema, and routed control points from escaping the viewBox.
 *
 * @param document - Parsed immutable schematic document.
 * @param fence - Intrinsic canvas contract.
 * @throws {SchematicSyntaxError} At the originating component or connection line.
 */
export function validateDocumentGeometry(document: SchematicDocument, fence: SchematicFence): void {
	for (const component of document.components) {
		if (!rectangleInsideBounds(componentRectangle(component), fence.bounds)) {
			throw new SchematicSyntaxError(
				`${component.id} geometry exceeds the declared ${fence.bounds.width}x${fence.bounds.height} bounds.`,
				component.line
			);
		}
	}
	const components = new Map(document.components.map((component) => [component.id, component]));
	const routedConnections = routeConnections(document.connections, components);
	for (const [index, connection] of document.connections.entries()) {
		const routed = routedConnections[index]!;
		if (!routed.points.every((point) => pointInsideBounds(point, fence.bounds))) {
			throw new SchematicSyntaxError(
				'Connection trace exceeds the declared schematic bounds.',
				connection.line
			);
		}
	}
}
