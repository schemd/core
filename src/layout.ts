/**
 * Component geometry, terminal resolution, wire routing, and geometry validation.
 *
 * Every question about a symbol — its size, its terminals, what a terminal name
 * means — is answered by the symbol registry; this module places those answers
 * on the canvas and routes wires between them. Internally all geometry is exact
 * integer milli-units (see `geom.ts`); the exported functions keep the public
 * contract in diagram units.
 *
 * @packageDocumentation
 */
import { append, fmt, fromMilli, inflate, overlaps, contains, roundDiv, segmentContact, toMilli, type IPoint, type IRect } from './geom.js';
import { mathLabelTextWidthAt } from './math-label.js';
import { MAX_SCHEMATIC_BOUND, MIN_SCHEMATIC_BOUND, resolveSchematicLimits, SCHEMATIC_LIMITS } from './limits.js';
import { Buckets, compact, MAX_ROUTER_STATES, routeWires, type RouterFixed, type RouterObstacle, type RouterWire } from './route.js';
import { canonicalName, halfExtents, placedPorts, resolvePlaced, turnOf, type PlacedPort } from './symbols/index.js';
import { gateHeight } from './symbols/logic.js';
import { gateDimensions } from './symbols/quantum.js';
import { distributed } from './symbols/common.js';
import { icPin } from './symbols/electrical.js';
import {
	DIGITAL_COMPONENT_KINDS,
	QUANTUM_SPECIAL_KINDS,
	UML_COMPONENT_KINDS,
	SchematicSyntaxError,
	type ClassicalGateComponent,
	type DigitalComponent,
	type IntegratedCircuitComponent,
	type QuantumGateComponent,
	type QuantumSpecialComponent,
	type SchematicBounds,
	type SchematicComponent,
	type SchematicConnection,
	type SchematicDocument,
	type SchematicFence,
	type SchematicOrientation,
	type SchematicPoint,
	type SchematicQuarterTurn,
	type SchematicSheet,
	type UmlComponent
} from './types.js';

/** Axis-aligned rectangle expressed in absolute schematic coordinates. */
export interface SchematicRectangle {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}

/** Axis-aligned half-extents around a component origin. */
export interface SchematicHalfExtents {
	halfWidth: number;
	halfHeight: number;
}

/** Render-ready connection path and the points used for bounds validation. */
export interface RoutedConnection {
	/** Original routing strategy; crossing passes must never infer it from control points. */
	readonly curve: SchematicConnection['curve'];
	/** Compact SVG path-data string. */
	d: string;
	/** At least two absolute points spanning endpoints, controls, corners, and bridge extrema. */
	points: readonly [SchematicPoint, SchematicPoint, ...SchematicPoint[]];
	/** Where a branch leaves its net's copper, when that is the trace's first point. */
	readonly junction?: SchematicPoint;
	/**
	 * Where this trace crosses another trace of its own net away from a junction.
	 * They are one node, so each is drawn as a junction dot rather than read as
	 * two wires passing.
	 */
	readonly joins?: readonly SchematicPoint[];
}

/** Relative text anchors for a component's designator and label rows. */
export interface ComponentTextAnchors {
	designatorY: number;
	labelY: number;
	designatorWidth: number;
	labelWidth: number;
	/**
	 * Where both rows start, start-aligned, when they sit beside the component
	 * rather than centred above and below it: a junction's text, which must
	 * leave all four of its exits clear.
	 */
	textX?: number;
}

/** A canonical, physically rendered component terminal and its absolute SVG coordinate. */
export interface ComponentPort {
	readonly id: string;
	readonly point: SchematicPoint;
	readonly normal: SchematicPoint;
}

/** One edge of a polymorphic integrated-circuit body. */
export type IcPinSide = 'left' | 'right' | 'top' | 'bottom';

/** One occupied cell of the routing grid. */
export interface SchematicCongestionCell {
	readonly x: number;
	readonly y: number;
	readonly load: number;
}

/** What the router had to do to place every trace. */
export interface SchematicRoutingReport {
	/** Negotiation iterations after the first pass; zero when every net placed cleanly. */
	readonly attempts: number;
	/** Each trace torn up for renegotiation, and the iteration that tore it up. */
	readonly rippedUp: readonly { readonly connectionIndex: number; readonly attempt: number }[];
	/** Occupied cells only, ordered by column then row. */
	readonly congestion: readonly SchematicCongestionCell[];
	/** Retained for compatibility: the net router has no separate bundle path, so this is always false. */
	readonly nudged: boolean;
}

/** An eight-pixel target satisfies the minimum pointer hotspot without changing vector geometry. */
export const PORT_HOTSPOT_RADIUS = 4;
/** Physical clearance between an orthogonal trace and a component body. */
export const SCHEMATIC_OBSTACLE_CLEARANCE = 12;
/** Radius of the engineering crossover arc inserted at non-junction wire crossings. */
export const SCHEMATIC_BRIDGE_RADIUS = 5;
/** Side of a congestion cell in viewBox units. */
export const SCHEMATIC_CONGESTION_CELL_SIZE = 64;

const DESIGNATOR_BASELINE_GAP = 10;
const LABEL_BASELINE_GAP = 19;
const TEXT_ASCENT_GUTTER = 12;
const TEXT_DESCENT_GUTTER = 5;
const TEXT_SIZE = 12;
const CONNECTION_TEXT_SIZE = 11;
const TEXT_HORIZONTAL_GUTTER = 4;
/** Room a routed wire keeps from component text, beyond its gutters, in milli-units. */
const TEXT_WIRE_CLEARANCE = 4_000;

/* ---- quarter turns (unit API) ---- */

/** Normalize the public direction vocabulary to a compact clockwise quarter turn. */
export function orientationQuarterTurn(orientation: SchematicOrientation): SchematicQuarterTurn {
	return ({ right: 0, down: 1, left: 2, up: 3 } as const)[orientation];
}

/** Compose two clockwise quarter turns without floating-point angle arithmetic. */
export function composeQuarterTurns(first: SchematicQuarterTurn, second: SchematicQuarterTurn): SchematicQuarterTurn {
	return ((first + second) & 3) as SchematicQuarterTurn;
}

/** Return the exact quarter turn that reverses the supplied rotation. */
export function inverseQuarterTurn(turn: SchematicQuarterTurn): SchematicQuarterTurn {
	return ((4 - turn) & 3) as SchematicQuarterTurn;
}

/** Rotate a local point or unit vector clockwise using only swaps and sign changes. */
export function rotateQuarterPoint(point: SchematicPoint, turn: SchematicQuarterTurn): SchematicPoint {
	switch (turn) {
		case 0:
			return { x: point.x + 0, y: point.y + 0 };
		case 1:
			return { x: 0 - point.y, y: point.x + 0 };
		case 2:
			return { x: 0 - point.x, y: 0 - point.y };
		case 3:
			return { x: point.y + 0, y: 0 - point.x };
	}
}

/** Rotate axis-aligned half-extents; odd turns swap axes. */
export function rotateQuarterExtents(extents: SchematicHalfExtents, turn: SchematicQuarterTurn): SchematicHalfExtents {
	const halfWidth = extents.halfWidth + 0;
	const halfHeight = extents.halfHeight + 0;
	return turn % 2 === 0 ? { halfWidth, halfHeight } : { halfWidth: halfHeight, halfHeight: halfWidth };
}

/* ---- numeric helpers kept on the public layout surface ---- */

/** Format geometry to at most three decimals with no negative zero. */
export function formatNumber(value: number): string {
	return fmt(toMilli(value));
}

/** Evenly distribute a terminal within a centered span. */
export function distributedCoordinate(index: number, count: number, span: number): number {
	return fromMilli(distributed(index, count, toMilli(span)));
}

/** Classical gate height: 16 per terminal on the busier side, never below 48. */
export function classicalGateHeight(component: ClassicalGateComponent): number {
	return gateHeight(component);
}

/** Shared shell dimensions for native and custom single-qubit gates. */
export function quantumGateDimensions(component: QuantumGateComponent): { bodyWidth: number; bodyHeight: number; stubExtent: number } {
	return gateDimensions(component);
}

const DIGITAL = new Set<string>(DIGITAL_COMPONENT_KINDS);
const QUANTUM_SPECIAL = new Set<string>(QUANTUM_SPECIAL_KINDS);
const UML = new Set<string>(UML_COMPONENT_KINDS);

export function isDigitalComponent(component: SchematicComponent): component is DigitalComponent {
	return DIGITAL.has(component.kind);
}
export function isQuantumSpecial(component: SchematicComponent): component is QuantumSpecialComponent {
	return QUANTUM_SPECIAL.has(component.kind);
}
export function isUmlComponent(component: SchematicComponent): component is UmlComponent {
	return UML.has(component.kind);
}

/* ---- terminals (unit API) ---- */

function unitPoint(point: IPoint): SchematicPoint {
	return { x: fromMilli(point.x), y: fromMilli(point.y) };
}

function unitPort(port: PlacedPort): ComponentPort {
	return { id: port.id, point: unitPoint(port.point), normal: { x: port.normal.x, y: port.normal.y } };
}

/** Position an indexed IC pin in O(1). */
export function positionIcPin(component: IntegratedCircuitComponent, side: IcPinSide, index: number): SchematicPoint {
	const pins = component.pins[side];
	if (!Number.isInteger(index) || index < 0 || index >= pins.length) {
		throw new RangeError(`IC pin index ${index} is outside ${component.id}.${side}.`);
	}
	const local = icPin(component, side, index);
	const turn = turnOf(component);
	const rotated = rotateQuarterPoint({ x: local.x, y: local.y }, turn);
	return { x: fromMilli(toMilli(component.x) + rotated.x), y: fromMilli(toMilli(component.y) + rotated.y) };
}

function requirePort(component: SchematicComponent, port: string): PlacedPort {
	const placed = resolvePlaced(component, port);
	if (placed === undefined) throw new Error(`Validated port ${component.id}.${port} is missing.`);
	return placed;
}

/** Resolve a validated port name to absolute coordinates. */
export function resolvePortPoint(component: SchematicComponent, port: string): SchematicPoint {
	return unitPoint(requirePort(component, port).point);
}

/** Resolve a port together with the direction a route must initially travel. */
export function resolvePortGeometry(component: SchematicComponent, port: string): { readonly point: SchematicPoint; readonly normal: SchematicPoint } {
	const placed = requirePort(component, port);
	return { point: unitPoint(placed.point), normal: { x: placed.normal.x, y: placed.normal.y } };
}

/** Each physical terminal exactly once, in stable order. */
export function enumerateComponentPorts(component: SchematicComponent): readonly ComponentPort[] {
	return placedPorts(component).map(unitPort);
}

/** Resolve any accepted spelling to the canonical terminal it addresses. */
export function canonicalPortName(component: SchematicComponent, port: string): string {
	const name = canonicalName(component, port);
	if (name === undefined) throw new Error(`Validated port ${component.id}.${port} is missing.`);
	return name;
}

/* ---- bodies, labels, and bounds ---- */

/** Physical body rectangle grown by `clearance`, in milli-units. */
export function bodyRect(component: SchematicComponent, clearance: number): IRect {
	const [w, h] = halfExtents(component);
	const x = toMilli(component.x);
	const y = toMilli(component.y);
	return { minX: x - w - clearance, minY: y - h - clearance, maxX: x + w + clearance, maxY: y + h + clearance };
}

function rectUnits(rect: IRect): SchematicRectangle {
	return { minX: fromMilli(rect.minX), minY: fromMilli(rect.minY), maxX: fromMilli(rect.maxX), maxY: fromMilli(rect.maxY) };
}

/** Return the AABB used by orthogonal routing, including engineering clearance. */
export function componentObstacleRectangle(component: SchematicComponent, clearance = SCHEMATIC_OBSTACLE_CLEARANCE): SchematicRectangle {
	if (!Number.isFinite(clearance) || clearance < 0) {
		throw new RangeError('Component obstacle clearance must be a finite non-negative number.');
	}
	return rectUnits(bodyRect(component, toMilli(clearance)));
}

/** External designator and label fitting metrics. */
export function componentTextAnchors(component: SchematicComponent): ComponentTextAnchors {
	/* Up and to the right of the dot, clear of both axes through it once
	   wires keep their clearance from text. */
	if (component.kind === 'junction') {
		return { designatorY: -27, labelY: -10, designatorWidth: mathLabelTextWidthAt(component.id, TEXT_SIZE), labelWidth: mathLabelTextWidthAt(component.label, TEXT_SIZE), textX: 10 };
	}
	return centredTextAnchors(component);
}

/** Designator above and label below, both centred: every part's rows but a junction's. */
function centredTextAnchors(component: SchematicComponent): ComponentTextAnchors {
	const halfHeight = fromMilli(halfExtents(component)[1]);
	return {
		designatorY: -halfHeight - DESIGNATOR_BASELINE_GAP,
		labelY: halfHeight + LABEL_BASELINE_GAP,
		designatorWidth: mathLabelTextWidthAt(component.id, TEXT_SIZE),
		labelWidth: mathLabelTextWidthAt(component.label, TEXT_SIZE)
	};
}

/** Designator and label rows that must stay readable around wires, in milli-units. */
export function labelRects(component: SchematicComponent): readonly IRect[] {
	if (isUmlComponent(component)) return [];
	const anchors = componentTextAnchors(component);
	const x = component.x;
	const y = component.y;
	const start = anchors.textX;
	const row = (width: number, baseline: number): IRect => ({
		minX: toMilli((start === undefined ? x - width / 2 : x + start) - TEXT_HORIZONTAL_GUTTER),
		minY: toMilli(y + baseline - TEXT_ASCENT_GUTTER),
		maxX: toMilli((start === undefined ? x + width / 2 : x + start + width) + TEXT_HORIZONTAL_GUTTER),
		maxY: toMilli(y + baseline + TEXT_DESCENT_GUTTER)
	});
	const designator = row(anchors.designatorWidth, anchors.designatorY);
	/* A part declared without a label draws no label row, so wires need not keep clear of one. */
	return component.label === '' ? [designator] : [designator, row(anchors.labelWidth, anchors.labelY)];
}

/** Complete component bounds including text and port hotspots, in milli-units. */
export function componentExtent(component: SchematicComponent, centred = false): IRect {
	const [w, h] = halfExtents(component);
	const x = toMilli(component.x);
	const y = toMilli(component.y);
	let rect: { minX: number; minY: number; maxX: number; maxY: number };
	if (isUmlComponent(component)) rect = { minX: x - w, minY: y - h, maxX: x + w, maxY: y + h };
	else {
		const anchors = centred ? centredTextAnchors(component) : componentTextAnchors(component);
		const textHalf = toMilli(Math.max(anchors.designatorWidth, anchors.labelWidth) / 2 + TEXT_HORIZONTAL_GUTTER);
		const half = Math.max(w, textHalf);
		rect = {
			minX: x - half,
			minY: Math.min(y - h, y + toMilli(anchors.designatorY - TEXT_ASCENT_GUTTER)),
			maxX: x + half,
			maxY: Math.max(y + h, y + toMilli(anchors.labelY + TEXT_DESCENT_GUTTER))
		};
		if (anchors.textX !== undefined) {
			for (const text of labelRects(component)) {
				rect.minX = Math.min(rect.minX, text.minX);
				rect.maxX = Math.max(rect.maxX, text.maxX);
			}
		}
	}
	const radius = PORT_HOTSPOT_RADIUS * 1000;
	for (const port of placedPorts(component)) {
		rect.minX = Math.min(rect.minX, port.point.x - radius);
		rect.minY = Math.min(rect.minY, port.point.y - radius);
		rect.maxX = Math.max(rect.maxX, port.point.x + radius);
		rect.maxY = Math.max(rect.maxY, port.point.y + radius);
	}
	return rect;
}

/** Complete component bounds, including text and interactive port radii. */
export function componentRectangle(component: SchematicComponent): SchematicRectangle {
	return rectUnits(componentExtent(component));
}

/**
 * The rectangle relative placement measures from: the part with its text rows
 * centred, as every release has placed it. A junction draws its text beside
 * the dot, but measuring from there would move whatever is placed against it.
 */
export function componentPlacementRectangle(component: SchematicComponent): SchematicRectangle {
	return rectUnits(componentExtent(component, true));
}

/** The half-length point of a routed connection. */
export function connectionLabelPoint(route: RoutedConnection): SchematicPoint {
	if (route.curve === 'bezier' && route.points.length >= 4) {
		const [a, b, c, d] = route.points as unknown as [SchematicPoint, SchematicPoint, SchematicPoint, SchematicPoint];
		return { x: (a.x + 3 * b.x + 3 * c.x + d.x) / 8, y: (a.y + 3 * b.y + 3 * c.y + d.y) / 8 };
	}
	const points = route.points.map((point) => ({ x: toMilli(point.x), y: toMilli(point.y) }));
	return unitPoint(midpoint(points));
}

/** Half-length point of a polyline, exact for orthogonal routes. */
function midpoint(points: readonly IPoint[]): IPoint {
	let total = 0;
	for (let index = 1; index < points.length; index += 1) {
		total += Math.abs(points[index]!.x - points[index - 1]!.x) + Math.abs(points[index]!.y - points[index - 1]!.y);
	}
	let remaining = total / 2;
	for (let index = 1; index < points.length; index += 1) {
		const start = points[index - 1]!;
		const end = points[index]!;
		const length = Math.abs(end.x - start.x) + Math.abs(end.y - start.y);
		if (remaining <= length) {
			return {
				x: start.x + roundDiv((end.x - start.x) * remaining, length || 1),
				y: start.y + roundDiv((end.y - start.y) * remaining, length || 1)
			};
		}
		remaining -= length;
	}
	/* v8 ignore next -- a route always contains its own half-length point. */
	return points[points.length - 1]!;
}

function labelRectAt(connection: SchematicConnection, point: IPoint): IRect | undefined {
	if (connection.label === undefined) return undefined;
	const half = toMilli(mathLabelTextWidthAt(connection.label, CONNECTION_TEXT_SIZE) / 2 + 3);
	return { minX: point.x - half, minY: point.y - 20_000, maxX: point.x + half, maxY: point.y };
}

/** Conservative occupancy rectangle for one connector label. */
export function connectionLabelRectangle(connection: SchematicConnection, route: RoutedConnection): SchematicRectangle | undefined {
	const point = connectionLabelPoint(route);
	const rect = labelRectAt(connection, { x: toMilli(point.x), y: toMilli(point.y) });
	return rect === undefined ? undefined : rectUnits(rect);
}

/* ---- routing ---- */

const EMPTY_REPORT: SchematicRoutingReport = Object.freeze({
	attempts: 0,
	rippedUp: Object.freeze([]),
	congestion: Object.freeze([]),
	nudged: false
});

/** The report for routing this module did not do. */
export const EMPTY_ROUTING_REPORT = EMPTY_REPORT;

/** Union-find over indices. */
function unions(count: number): { find(index: number): number; join(left: number, right: number): void } {
	const parent = Array.from({ length: count }, (_, index) => index);
	const find = (index: number): number => {
		while (parent[index] !== index) {
			parent[index] = parent[parent[index]!]!;
			index = parent[index]!;
		}
		return index;
	};
	return {
		find,
		join(left, right) {
			const a = find(left);
			const b = find(right);
			if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
		}
	};
}

/**
 * Which connections may touch: one identity per class of the "same net" relation.
 *
 * Signal connections share a net when the parser gave them the same identity;
 * UML connectors only by sharing a terminal or an explicit name; and a component's
 * internal fixture wires (both ends on the component) may coexist inside it.
 */
function contactIdentities(connections: readonly SchematicConnection[]): number[] {
	const set = unions(connections.length);
	const byNet = new Map<string, number>();
	const byName = new Map<string, number>();
	const byTerminal = new Map<string, number>();
	const internal = new Map<string, number>();
	for (const [index, connection] of connections.entries()) {
		const link = (map: Map<string, number>, key: string): void => {
			const other = map.get(key);
			if (other === undefined) map.set(key, index);
			else set.join(index, other);
		};
		if (connection.netId !== undefined) link(byNet, connection.netId);
		if (connection.net !== undefined) link(byName, connection.net);
		link(byTerminal, `${connection.from.componentId}.${connection.from.port}`);
		link(byTerminal, `${connection.to.componentId}.${connection.to.port}`);
		if (connection.from.componentId === connection.to.componentId) link(internal, connection.from.componentId);
	}
	return connections.map((_, index) => set.find(index));
}

/** Strict interior intersection of an arbitrary segment and a rectangle (Liang–Barsky). */
function segmentEntersRect(a: IPoint, b: IPoint, rect: IRect): boolean {
	if (a.y === b.y) return a.y > rect.minY && a.y < rect.maxY && Math.max(a.x, b.x) > rect.minX && Math.min(a.x, b.x) < rect.maxX;
	if (a.x === b.x) return a.x > rect.minX && a.x < rect.maxX && Math.max(a.y, b.y) > rect.minY && Math.min(a.y, b.y) < rect.maxY;
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	const x1 = (rect.minX - a.x) / dx;
	const x2 = (rect.maxX - a.x) / dx;
	const y1 = (rect.minY - a.y) / dy;
	const y2 = (rect.maxY - a.y) / dy;
	const low = Math.max(0, Math.min(x1, x2), Math.min(y1, y2));
	const high = Math.min(1, Math.max(x1, x2), Math.max(y1, y2));
	return low < high && high > 0 && low < 1;
}

/** Conservative subdivision test of a cubic Bézier against a rectangle. */
function cubicEntersRect(points: readonly [IPoint, IPoint, IPoint, IPoint], rect: IRect): boolean {
	const [a, b, c, d] = points;
	const minX = Math.min(a.x, b.x, c.x, d.x);
	const minY = Math.min(a.y, b.y, c.y, d.y);
	const maxX = Math.max(a.x, b.x, c.x, d.x);
	const maxY = Math.max(a.y, b.y, c.y, d.y);
	if (maxX <= rect.minX || minX >= rect.maxX || maxY <= rect.minY || minY >= rect.maxY) return false;
	if (maxX - minX <= 250 && maxY - minY <= 250) return true;
	const mid = (l: IPoint, r: IPoint): IPoint => ({ x: (l.x + r.x) / 2, y: (l.y + r.y) / 2 });
	const ab = mid(a, b);
	const bc = mid(b, c);
	const cd = mid(c, d);
	const abc = mid(ab, bc);
	const bcd = mid(bc, cd);
	const center = mid(abc, bcd);
	return cubicEntersRect([a, ab, abc, center], rect) || cubicEntersRect([center, bcd, cd, d], rect);
}

/** Flatten a cubic into 24 chords for contact tests. */
function flattenCubic(a: IPoint, b: IPoint, c: IPoint, d: IPoint): IPoint[] {
	const out: IPoint[] = [];
	for (let step = 0; step <= 24; step += 1) {
		const t = step / 24;
		const s = 1 - t;
		out.push({
			x: Math.round(s * s * s * a.x + 3 * s * s * t * b.x + 3 * s * t * t * c.x + t * t * t * d.x),
			y: Math.round(s * s * s * a.y + 3 * s * s * t * b.y + 3 * s * t * t * c.y + t * t * t * d.y)
		});
	}
	return out;
}

const MARKER_SIZES: Readonly<Record<string, readonly [number, number]>> = {
	dot: [4, 4], arrow: [8, 4], 'open-arrow': [9, 5], triangle: [12, 6], diamond: [12, 6], 'diamond-filled': [12, 6]
};

/** A marker that would overlap an unrelated body is reported, not drawn into it. */
function checkMarkers(connection: SchematicConnection, points: readonly IPoint[], bodies: readonly { owner: string; rect: IRect }[]): void {
	for (const [atStart, marker] of [[true, connection.markerStart], [false, connection.markerEnd]] as const) {
		const size = MARKER_SIZES[marker];
		if (size === undefined) continue;
		const end = atStart ? points[0]! : points[points.length - 1]!;
		const next = atStart ? points[1]! : points[points.length - 2]!;
		const dx = next.x - end.x;
		const dy = next.y - end.y;
		const magnitude = Math.sqrt(dx * dx + dy * dy);
		const inward = { x: end.x + Math.round((dx / magnitude) * size[0] * 1000), y: end.y + Math.round((dy / magnitude) * size[0] * 1000) };
		for (const body of bodies) {
			if (body.owner === connection.from.componentId || body.owner === connection.to.componentId) continue;
			if (segmentEntersRect(end, inward, inflate(body.rect, size[1] * 1000))) {
				throw new SchematicSyntaxError(`${marker} marker intersects ${body.owner}; use ortho or move the obstacle.`, connection.line, undefined, 'routing');
			}
		}
	}
}

/**
 * Path data for an orthogonal polyline, with bridge arcs where its vertical runs
 * cross other nets. `room(x, y)` bounds an arc's sideways bulge so it never
 * reaches a neighbouring net's parallel wire.
 */
function orthogonalPathData(
	points: readonly IPoint[],
	crossings: ReadonlyMap<number, readonly number[]>,
	room: (x: number, y: number) => number,
	line: number
): { d: string; extrema: IPoint[] } {
	let d = `M ${fmt(points[0]!.x)} ${fmt(points[0]!.y)}`;
	const extrema: IPoint[] = [points[0]!];
	for (let index = 1; index < points.length; index += 1) {
		const start = points[index - 1]!;
		const end = points[index]!;
		if (start.y === end.y) {
			d += ` H ${fmt(end.x)}`;
			extrema.push(end);
			continue;
		}
		const direction = Math.sign(end.y - start.y);
		const ys = [...(crossings.get(index - 1) ?? [])].sort((left, right) => direction * (left - right));
		let cursor = start.y;
		for (const [position, y] of ys.entries()) {
			const r = Math.min(
				room(start.x, y),
				Math.abs(y - start.y),
				Math.abs(end.y - y),
				position === 0 ? Infinity : Math.floor(Math.abs(y - ys[position - 1]!) / 2),
				position === ys.length - 1 ? Infinity : Math.floor(Math.abs(ys[position + 1]! - y) / 2)
			);
			if (r < 1) throw new SchematicSyntaxError('Wire crossings are too close to render distinct bridge arcs.', line, undefined, 'routing');
			if (y - direction * r !== cursor) d += ` V ${fmt(y - direction * r)}`;
			d += ` A ${fmt(r)} ${fmt(r)} 0 0 ${direction > 0 ? 0 : 1} ${fmt(start.x)} ${fmt(y + direction * r)}`;
			cursor = y + direction * r;
			extrema.push({ x: start.x, y: y - direction * r }, { x: start.x - r, y }, { x: start.x, y: y + direction * r });
		}
		if (cursor !== end.y) d += ` V ${fmt(end.y)}`;
		extrema.push(end);
	}
	return { d, extrema };
}

function noRoute(connection: SchematicConnection): SchematicSyntaxError {
	return new SchematicSyntaxError(
		`No orthogonal route from ${connection.from.componentId}.${connection.from.port} to ${connection.to.componentId}.${connection.to.port} clears every component and earlier trace: move one of them apart, widen the fence bounds, or join the traces that meet with a shared net.`,
		connection.line,
		undefined,
		'routing'
	);
}

/**
 * Route every connection and report how it went.
 *
 * Straight and Bézier wires are drawn directly and become fixed copper; every
 * orthogonal wire is routed by net (see `route.ts`), and vertical runs that
 * cross another net receive a bridge arc.
 */
export function routeSchematicConnections(
	connections: readonly SchematicConnection[],
	components: ReadonlyMap<string, SchematicComponent>,
	bounds?: SchematicBounds,
	wireCrossings: number = SCHEMATIC_LIMITS.wireCrossings,
	routingAttempts: number = SCHEMATIC_LIMITS.routingAttempts
): { readonly routes: readonly RoutedConnection[]; readonly report: SchematicRoutingReport } {
	const list = [...components.values()];
	const owners = new Map(list.map((component, index) => [component.id, index]));
	const clearance = SCHEMATIC_OBSTACLE_CLEARANCE * 1000;
	const obstacles: RouterObstacle[] = [];
	const bodies: { owner: string; rect: IRect }[] = [];
	const manual: { owner: string; rect: IRect }[] = [];
	for (const [index, component] of list.entries()) {
		const body = bodyRect(component, 0);
		/* A junction is where its own wires meet: its dot keeps out only other nets. */
		obstacles.push({ owner: index, kind: component.kind === 'junction' ? 'node' : 'body', rect: body }, { owner: index, kind: 'expanded', rect: bodyRect(component, clearance) });
		bodies.push({ owner: component.id, rect: body });
		manual.push({ owner: component.id, rect: body });
		for (const rect of labelRects(component)) {
			obstacles.push({ owner: index, kind: 'label', rect: inflate(rect, TEXT_WIRE_CLEARANCE) });
			manual.push({ owner: component.id, rect });
		}
	}
	/* A free pin is a point no wire may pass through: one that did would read as
	   joined to it. Text-like, so it adds no lattice lines of its own. */
	const wired = new Set(connections.flatMap((connection) => [`${connection.from.componentId}.${connection.from.port}`, `${connection.to.componentId}.${connection.to.port}`]));
	const freePins = new Buckets<{ owner: string; name: string; point: IPoint }>();
	for (const [index, component] of list.entries()) {
		for (const port of placedPorts(component)) {
			if (wired.has(`${component.id}.${port.id}`)) continue;
			const rect = inflate({ minX: port.point.x, minY: port.point.y, maxX: port.point.x, maxY: port.point.y }, 1);
			obstacles.push({ owner: index, kind: 'label', rect });
			freePins.add({ owner: component.id, name: `${component.id}.${port.id}`, point: port.point }, rect);
		}
	}
	const occupied = new Buckets<{ owner: string; rect: IRect }>();
	for (const entry of manual) occupied.add(entry, entry.rect);
	const solid = new Buckets<{ owner: string; rect: IRect }>();
	for (const entry of bodies) solid.add(entry, entry.rect);
	const identity = contactIdentities(connections);
	const netTerminals = new Map<number, Set<string>>();
	for (const [index, connection] of connections.entries()) {
		const keys = netTerminals.get(identity[index]!) ?? new Set<string>();
		keys.add(`${connection.from.componentId}.${connection.from.port}`).add(`${connection.to.componentId}.${connection.to.port}`);
		netTerminals.set(identity[index]!, keys);
	}
	const endpoint = (componentId: string, port: string): PlacedPort => {
		const component = components.get(componentId);
		if (component === undefined) throw new Error(`Validated component ${componentId} is missing.`);
		return requirePort(component, port);
	};
	const routes: RoutedConnection[] = new Array(connections.length);
	const points: IPoint[][] = new Array(connections.length);
	const fixed: RouterFixed[] = [];
	const fixedChords: { index: number; a: IPoint; b: IPoint }[] = [];

	/* Straight and curved wires first: they are not routed, only checked. */
	for (const [index, connection] of connections.entries()) {
		if (connection.curve === 'ortho') continue;
		const start = endpoint(connection.from.componentId, connection.from.port).point;
		const end = endpoint(connection.to.componentId, connection.to.port).point;
		const relevant = manual.filter((entry) => entry.owner !== connection.from.componentId && entry.owner !== connection.to.componentId);
		let chords: IPoint[];
		if (connection.curve === 'bezier') {
			const middleX = roundDiv(start.x + end.x, 2);
			const controlA = { x: middleX, y: start.y };
			const controlB = { x: middleX, y: end.y };
			for (const entry of relevant) {
				if (cubicEntersRect([start, controlA, controlB, end], entry.rect)) {
					throw new SchematicSyntaxError(`Bézier route intersects ${entry.owner}; use an orthogonal route or move the obstacle.`, connection.line, undefined, 'routing');
				}
			}
			points[index] = [start, controlA, controlB, end];
			routes[index] = {
				curve: 'bezier',
				d: `M ${fmt(start.x)} ${fmt(start.y)} C ${fmt(controlA.x)} ${fmt(controlA.y)}, ${fmt(controlB.x)} ${fmt(controlB.y)}, ${fmt(end.x)} ${fmt(end.y)}`,
				points: [unitPoint(start), unitPoint(controlA), unitPoint(controlB), unitPoint(end)]
			};
			chords = flattenCubic(start, controlA, controlB, end);
		} else {
			for (const entry of relevant) {
				if (segmentEntersRect(start, end, entry.rect)) {
					throw new SchematicSyntaxError(`Line route intersects ${entry.owner}; use an orthogonal route or move the obstacle.`, connection.line, undefined, 'routing');
				}
			}
			points[index] = [start, end];
			routes[index] = { curve: 'line', d: `M ${fmt(start.x)} ${fmt(start.y)} L ${fmt(end.x)} ${fmt(end.y)}`, points: [unitPoint(start), unitPoint(end)] };
			chords = [start, end];
		}
		checkMarkers(connection, points[index]!, bodies);
		/* A drawn wire through another component's terminal reads as a connection. */
		const reach = chords.reduce((box, point) => ({ minX: Math.min(box.minX, point.x), minY: Math.min(box.minY, point.y), maxX: Math.max(box.maxX, point.x), maxY: Math.max(box.maxY, point.y) }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
		for (const component of list) {
			/* Its own components are exempt, as their bodies are. */
			if (component.id === connection.from.componentId || component.id === connection.to.componentId) continue;
			for (const port of placedPorts(component)) {
				const at = port.point;
				if (at.x < reach.minX || at.x > reach.maxX || at.y < reach.minY || at.y > reach.maxY) continue;
				if (netTerminals.get(identity[index]!)!.has(`${component.id}.${port.id}`)) continue;
				for (let step = 1; step < chords.length; step += 1) {
					if (segmentContact(chords[step - 1]!, chords[step]!, at, at) === undefined) continue;
					throw new SchematicSyntaxError(
						`${connection.curve === 'bezier' ? 'Bézier' : 'Line'} route passes through ${component.id}.${port.id}, which it does not connect; use an orthogonal route or move ${component.id}.`,
						connection.line,
						undefined,
						'routing'
					);
				}
			}
		}
		for (let step = 1; step < chords.length; step += 1) {
			if (chords[step - 1]!.x === chords[step]!.x && chords[step - 1]!.y === chords[step]!.y) continue;
			fixed.push({ net: identity[index]!, a: chords[step - 1]!, b: chords[step]! });
			fixedChords.push({ index, a: chords[step - 1]!, b: chords[step]! });
		}
	}

	/* Straight and curved wires of different nets may not touch at all. */
	for (let left = 0; left < fixedChords.length; left += 1) {
		for (let right = left + 1; right < fixedChords.length; right += 1) {
			const a = fixedChords[left]!;
			const b = fixedChords[right]!;
			if (a.index === b.index || identity[a.index] === identity[b.index]) continue;
			if (segmentContact(a.a, a.b, b.a, b.b) !== undefined) {
				throw new SchematicSyntaxError(
					'Separate nets touch or cross without an orthogonal bridge; use ortho, a shared net, or an explicit junction.',
					connections[Math.max(a.index, b.index)]!.line,
					undefined,
					'routing'
				);
			}
		}
	}

	/* Orthogonal wires: one router call for the whole document. */
	const orthogonal = connections.flatMap((connection, index) => (connection.curve === 'ortho' ? [index] : []));
	const groups = unions(connections.length);
	const terminalOwner = new Map<string, number>();
	for (const index of orthogonal) {
		const connection = connections[index]!;
		if (connection.relation !== 'signal') continue;
		for (const end of [connection.from, connection.to]) {
			const key = `${end.componentId}.${end.port}`;
			const other = terminalOwner.get(key);
			if (other === undefined) terminalOwner.set(key, index);
			else groups.join(index, other);
		}
	}
	const terminal = (componentId: string, port: string) => {
		const placed = endpoint(componentId, port);
		const component = components.get(componentId)!;
		/* A junction has no lead: wires leave its node in any direction. */
		if (component.kind === 'junction') return { owner: owners.get(componentId)!, point: placed.point, escape: placed.point };
		const expanded = bodyRect(component, clearance);
		let escape = {
			x: placed.normal.x < 0 ? expanded.minX : placed.normal.x > 0 ? expanded.maxX : placed.point.x,
			y: placed.normal.y < 0 ? expanded.minY : placed.normal.y > 0 ? expanded.maxY : placed.point.y
		};
		/* Text standing across the pin's exit: the stub runs straight through it
		   and routing starts beyond it, so no wire ever turns inside the words —
		   unless beyond it lies the fence, or another component whose body or
		   text would then wall the escape in. */
		const original = escape;
		/* Text rows sit above and below a body, so only a pin leaving up or down
		   can meet one: text holding its escape point, or starting within a
		   clearance past it. */
		for (const text of labelRects(component)) {
			const rect = inflate(text, TEXT_WIRE_CLEARANCE);
			if (placed.normal.x !== 0 || escape.x <= rect.minX || escape.x >= rect.maxX) continue;
			if (placed.normal.y < 0 && rect.minY < escape.y && rect.maxY > escape.y - clearance) escape = { x: escape.x, y: rect.minY };
			if (placed.normal.y > 0 && rect.maxY > escape.y && rect.minY < escape.y + clearance) escape = { x: escape.x, y: rect.maxY };
		}
		const at = escape;
		const outside = bounds !== undefined && (at.x < 0 || at.y < 0 || at.x > toMilli(bounds.width) || at.y > toMilli(bounds.height));
		const walled = outside || occupied
			.query({ minX: at.x, minY: at.y, maxX: at.x, maxY: at.y })
			.some((entry) => entry.owner !== componentId && at.x > entry.rect.minX && at.x < entry.rect.maxX && at.y > entry.rect.minY && at.y < entry.rect.maxY);
		return { owner: owners.get(componentId)!, point: placed.point, escape: walled ? original : escape };
	};
	/* Two nets whose pin stubs meet can never be routed apart; say so plainly
	   rather than as a routing failure. */
	const stubs = orthogonal.flatMap((index) => {
		const connection = connections[index]!;
		return [connection.from, connection.to].map((pin) => ({ pin, end: terminal(pin.componentId, pin.port) })).map(({ pin, end }) => ({
			index,
			name: `${pin.componentId}.${pin.port}`,
			a: end.point,
			b: end.escape,
			minX: Math.min(end.point.x, end.escape.x),
			maxX: Math.max(end.point.x, end.escape.x)
		}));
	});
	stubs.sort((left, right) => left.minX - right.minX || left.index - right.index);
	const active: typeof stubs = [];
	for (const stub of stubs) {
		let kept = 0;
		for (const other of active) if (other.maxX >= stub.minX) active[kept++] = other;
		active.length = kept;
		for (const other of active) {
			if (identity[other.index] === identity[stub.index]) continue;
			if (segmentContact(stub.a, stub.b, other.a, other.b) !== undefined) {
				const [first, second] = stub.index > other.index ? [other, stub] : [stub, other];
				throw new SchematicSyntaxError(
					`${first.name} and ${second.name} sit too close to route apart as separate nets: the wires leaving them would touch. Move one of them away, or join them with a shared net.`,
					connections[second.index]!.line,
					undefined,
					'routing'
				);
			}
		}
		active.push(stub);
	}
	/* In source order, so the first problem reported is the first written. */
	for (const stub of [...stubs].sort((left, right) => left.index - right.index)) {
		/* A lead that runs into another component's free pin would read as wired
		   to it, and the router cannot move a lead. */
		const owner = stub.name.slice(0, stub.name.indexOf('.'));
		/* Nor can it be moved out of a body it runs through: two parts placed so
		   close that one's pin leaves into the other. The body at the far end of
		   the same connection is two facing pins, joined straight. */
		const connection = connections[stub.index]!;
		const ends = [endpoint(connection.from.componentId, connection.from.port), endpoint(connection.to.componentId, connection.to.port)] as const;
		/* Two pins facing each other along one line, normals pointing at each other. */
		const facing =
			(ends[0].point.x === ends[1].point.x || ends[0].point.y === ends[1].point.y) &&
			Math.sign(ends[1].point.x - ends[0].point.x) === ends[0].normal.x &&
			Math.sign(ends[1].point.y - ends[0].point.y) === ends[0].normal.y &&
			ends[1].normal.x === -ends[0].normal.x &&
			ends[1].normal.y === -ends[0].normal.y;
		const span = { minX: stub.minX, maxX: stub.maxX, minY: Math.min(stub.a.y, stub.b.y), maxY: Math.max(stub.a.y, stub.b.y) };
		for (const body of solid.query(span)) {
			if (body.owner === owner || (facing && (body.owner === connection.from.componentId || body.owner === connection.to.componentId)) || !segmentEntersRect(stub.a, stub.b, body.rect)) continue;
			throw new SchematicSyntaxError(
				`${stub.name} sits against ${body.owner}: the wire leaving it would run straight through ${body.owner}. Move one of them away.`,
				connection.line,
				undefined,
				'routing'
			);
		}
		for (const free of freePins.query(span)) {
			if (free.owner === owner || segmentContact(stub.a, stub.b, free.point, free.point) === undefined) continue;
			throw new SchematicSyntaxError(
				`${stub.name} sits against ${free.name}, which nothing is wired to: the wire leaving ${stub.name} would read as joined to it. Move one of them away, or wire ${free.name}.`,
				connection.line,
				undefined,
				'routing'
			);
		}
	}
	const wires: RouterWire[] = orthogonal.map((index) => {
		const connection = connections[index]!;
		const signal = connection.relation === 'signal';
		return {
			from: terminal(connection.from.componentId, connection.from.port),
			to: terminal(connection.to.componentId, connection.to.port),
			net: identity[index]!,
			group: signal ? groups.find(index) : -1,
			joinFrom: signal && connection.markerStart === 'none',
			joinTo: signal && connection.markerEnd === 'none',
			/* An end on a junction part is drawn to it: the author chose where it joins. */
			meetFrom: components.get(connection.from.componentId)!.kind === 'junction',
			meetTo: components.get(connection.to.componentId)!.kind === 'junction',
			label: connection.label === undefined ? undefined : (route) => labelRectAt(connection, midpoint(route))
		};
	});
	const result = wires.length === 0 ? { wires: [], attempts: 0, rippedUp: [] } : routeWires({
		bounds: bounds === undefined ? undefined : { width: bounds.width * 1000, height: bounds.height * 1000 },
		obstacles,
		wires,
		fixed,
		attempts: routingAttempts
	});
	if (result.failed !== undefined) {
		const connection = connections[orthogonal[result.failed]!]!;
		if (result.reason === 'complexity') {
			throw new SchematicSyntaxError(`Orthogonal routing complexity exceeds ${MAX_ROUTER_STATES.toLocaleString('en-US')} search states.`, connection.line, undefined, 'routing');
		}
		throw noRoute(connection);
	}
	const junctions = new Map<number, IPoint>();
	for (const [position, index] of orthogonal.entries()) {
		const routed = result.wires[position]!;
		points[index] = compact(routed.points);
		if (routed.junction !== undefined) junctions.set(index, routed.junction);
		checkMarkers(connections[index]!, points[index]!, bodies);
	}

	/* A trace crossing its own net is one node with it: the later trace of the
	   two carries a dot there. */
	const joins = new Map<number, IPoint[]>();
	const seen = new Set<string>();
	const byNet = new Map<number, number[]>();
	for (const index of orthogonal) append(byNet, identity[index]!, index);
	for (const index of orthogonal) {
		const route = points[index]!;
		for (let step = 1; step < route.length; step += 1) {
			const a = route[step - 1]!;
			const b = route[step]!;
			if (a.x !== b.x) continue;
			for (const other of byNet.get(identity[index]!)!) {
				if (other === index) continue;
				const peer = points[other]!;
				for (let k = 1; k < peer.length; k += 1) {
					const c = peer[k - 1]!;
					const d = peer[k]!;
					if (c.y !== d.y) continue;
					const inside = Math.min(c.x, d.x) < a.x && a.x < Math.max(c.x, d.x) && Math.min(a.y, b.y) < c.y && c.y < Math.max(a.y, b.y);
					const key = `${a.x},${c.y}`;
					if (!inside || seen.has(key)) continue;
					seen.add(key);
					append(joins, Math.max(index, other), { x: a.x, y: c.y });
				}
			}
		}
	}

	/* Crossings: a vertical run crossing another net's horizontal run gets the arc. */
	const horizontals: { index: number; y: number; low: number; high: number }[] = [];
	for (const index of orthogonal) {
		const route = points[index]!;
		for (let step = 1; step < route.length; step += 1) {
			const a = route[step - 1]!;
			const b = route[step]!;
			if (a.y === b.y) horizontals.push({ index, y: a.y, low: Math.min(a.x, b.x), high: Math.max(a.x, b.x) });
		}
	}
	horizontals.sort((left, right) => left.y - right.y);
	const verticals: { index: number; x: number; low: number; high: number }[] = [];
	for (const index of orthogonal) {
		const route = points[index]!;
		for (let step = 1; step < route.length; step += 1) {
			const a = route[step - 1]!;
			const b = route[step]!;
			if (a.x === b.x && a.y !== b.y) verticals.push({ index, x: a.x, low: Math.min(a.y, b.y), high: Math.max(a.y, b.y) });
		}
	}
	const radius = SCHEMATIC_BRIDGE_RADIUS * 1000;
	/* Where each net's traces end, by column: a bridge on that net stops short. */
	const ends = new Map<number, Map<number, number[]>>();
	for (const index of orthogonal) {
		const columns = ends.get(identity[index]!) ?? new Map<number, number[]>();
		ends.set(identity[index]!, columns);
		for (const end of [points[index]![0]!, points[index]!.at(-1)!]) append(columns, end.x, end.y);
	}
	let crossingCount = 0;
	for (const index of orthogonal) {
		const route = points[index]!;
		const crossings = new Map<number, number[]>();
		for (let step = 1; step < route.length; step += 1) {
			const a = route[step - 1]!;
			const b = route[step]!;
			if (a.x !== b.x) continue;
			const low = Math.min(a.y, b.y);
			const high = Math.max(a.y, b.y);
			let first = 0;
			let last = horizontals.length;
			while (first < last) {
				const middle = (first + last) >> 1;
				if (horizontals[middle]!.y <= low) first = middle + 1;
				else last = middle;
			}
			for (let cursor = first; cursor < horizontals.length && horizontals[cursor]!.y < high; cursor += 1) {
				const run = horizontals[cursor]!;
				if (identity[run.index] === identity[index] || !(run.low < a.x && a.x < run.high)) continue;
				/* Copper drawn twice on one row — a repeated connection — is one crossing. */
				if (crossings.get(step - 1)?.includes(run.y) === true) continue;
				crossingCount += 1;
				if (crossingCount > wireCrossings) {
					throw new SchematicSyntaxError(`Wire crossing complexity exceeds ${wireCrossings.toLocaleString('en-US')} intersections.`, connections[index]!.line, undefined, 'routing');
				}
				append(crossings, step - 1, run.y);
			}
		}
		/* An arc bulges toward -x; it may use at most half the gap to another
		   net's vertical wire beside it, and must stop short of any point where
		   its own net joins this run, or the junction's dot would sit on a gap. */
		const touches = ends.get(identity[index]!)!;
		const room = (x: number, y: number): number => {
			let limit = radius;
			/* Whole units short of the joining point, so the arc stays a round number. */
			for (const ty of touches.get(x) ?? []) if (Math.abs(ty - y) <= radius) limit = Math.min(limit, Math.floor((Math.abs(ty - y) - 1) / 1000) * 1000);
			for (const run of verticals) {
				if (identity[run.index] === identity[index] || run.x >= x || run.x <= x - 2 * radius) continue;
				if (run.low < y + radius && run.high > y - radius) limit = Math.min(limit, Math.floor((x - run.x) / 2));
			}
			return limit;
		};
		const { d, extrema } = orthogonalPathData(route, crossings, room, connections[index]!.line);
		const junction = junctions.get(index);
		const dots = joins.get(index);
		routes[index] = {
			curve: 'ortho',
			d,
			points: extrema.map(unitPoint) as unknown as [SchematicPoint, SchematicPoint, ...SchematicPoint[]],
			...(junction === undefined ? {} : { junction: unitPoint(junction) }),
			...(dots === undefined ? {} : { joins: dots.map(unitPoint) })
		};
	}

	/* Congestion: spans per 64-unit cell. */
	const cells = new Map<string, { x: number; y: number; load: number }>();
	const cell = SCHEMATIC_CONGESTION_CELL_SIZE * 1000;
	for (const index of orthogonal) {
		const route = points[index]!;
		for (let step = 1; step < route.length; step += 1) {
			const a = route[step - 1]!;
			const b = route[step]!;
			for (let column = Math.floor(Math.min(a.x, b.x) / cell); column <= Math.floor(Math.max(a.x, b.x) / cell); column += 1) {
				for (let row = Math.floor(Math.min(a.y, b.y) / cell); row <= Math.floor(Math.max(a.y, b.y) / cell); row += 1) {
					const key = `${column},${row}`;
					const entry = cells.get(key);
					if (entry === undefined) cells.set(key, { x: column * SCHEMATIC_CONGESTION_CELL_SIZE, y: row * SCHEMATIC_CONGESTION_CELL_SIZE, load: 1 });
					else entry.load += 1;
				}
			}
		}
	}
	return {
		routes,
		report: {
			attempts: result.attempts,
			rippedUp: result.rippedUp.map((entry) => ({ connectionIndex: orthogonal[entry.wire]!, attempt: entry.attempt })),
			congestion: [...cells.values()].sort((left, right) => left.x - right.x || left.y - right.y),
			nudged: false
		}
	};
}

/** Route every connection and return only the routes. */
export function routeConnections(
	connections: readonly SchematicConnection[],
	components: ReadonlyMap<string, SchematicComponent>,
	bounds?: SchematicBounds,
	wireCrossings: number = SCHEMATIC_LIMITS.wireCrossings
): readonly RoutedConnection[] {
	return routeSchematicConnections(connections, components, bounds, wireCrossings).routes;
}

/** Route one connection on its own. */
export function routeConnection(connection: SchematicConnection, components: ReadonlyMap<string, SchematicComponent>, bounds?: SchematicBounds): RoutedConnection {
	return routeSchematicConnections([connection], components, bounds).routes[0]!;
}

/* ---- geometry validation ---- */

const CONTAINERS = new Set(['package', 'component', 'node', 'device', 'system', 'partition', 'fragment', 'interaction', 'region']);

function overlapAllowed(left: { component: SchematicComponent; rect: IRect }, right: { component: SchematicComponent; rect: IRect }): boolean {
	for (const [container, child] of [[left, right], [right, left]] as const) {
		if (!CONTAINERS.has(container.component.kind)) continue;
		if (contains(container.rect, child.rect)) return true;
		if (child.component.kind === 'component-port' || child.component.kind === 'gate') {
			const x = toMilli(child.component.x);
			const y = toMilli(child.component.y);
			if (x >= container.rect.minX && x <= container.rect.maxX && y >= container.rect.minY && y <= container.rect.maxY) return true;
		}
	}
	const pinned = new Set(['activation', 'execution', 'destruction']);
	return (left.component.kind === 'lifeline' && pinned.has(right.component.kind)) || (right.component.kind === 'lifeline' && pinned.has(left.component.kind));
}

/** How to separate two overlapping bodies, in the author's own coordinates. */
function separationAdvice(moving: IRect, fixedRect: IRect, origin: SchematicComponent): string {
	const offsetX = (moving.minX + moving.maxX - fixedRect.minX - fixedRect.maxX) / 2;
	const offsetY = (moving.minY + moving.maxY - fixedRect.minY - fixedRect.maxY) / 2;
	const horizontal = Math.abs(offsetX) >= Math.abs(offsetY);
	const shift = horizontal
		? offsetX >= 0 ? fixedRect.maxX - moving.minX : fixedRect.minX - moving.maxX
		: offsetY >= 0 ? fixedRect.maxY - moving.minY : fixedRect.minY - moving.maxY;
	const overlap = horizontal
		? Math.min(moving.maxX, fixedRect.maxX) - Math.max(moving.minX, fixedRect.minX)
		: Math.min(moving.maxY, fixedRect.maxY) - Math.max(moving.minY, fixedRect.minY);
	const amount = roundDiv(overlap, 1000);
	const target = roundDiv(toMilli(horizontal ? origin.x : origin.y) + shift, 1000);
	return `by ${amount} unit${amount === 1 ? '' : 's'} ${horizontal ? 'horizontally' : 'vertically'}; move ${origin.id} to ${horizontal ? 'x' : 'y'} ${shift > 0 ? '>=' : '<='} ${target}`;
}

/** Reject strict body overlap, except UML containment, with a fix in the author's coordinates. */
function validateOverlaps(components: readonly SchematicComponent[]): void {
	const ordered = components
		.map((component) => ({ component, rect: bodyRect(component, 0) }))
		.sort((left, right) => left.rect.minX - right.rect.minX || left.rect.minY - right.rect.minY || left.component.line - right.component.line);
	const active: typeof ordered = [];
	for (const current of ordered) {
		let kept = 0;
		for (const previous of active) {
			if (previous.rect.maxX <= current.rect.minX) continue;
			active[kept++] = previous;
		}
		active.length = kept;
		for (const previous of active) {
			if (overlaps(previous.rect, current.rect) && !overlapAllowed(previous, current)) {
				throw new SchematicSyntaxError(
					`${current.component.id} overlaps ${previous.component.id} ${separationAdvice(current.rect, previous.rect, current.component)}, or use a UML container.`,
					current.component.line,
					undefined,
					'geometry'
				);
			}
		}
		active.push(current);
	}
}

/** Clear space a measured sheet keeps around the drawing, in viewBox units. */
export const SCHEMATIC_SHEET_MARGIN = 24;

/**
 * Measure the sheet a drawing needs: every part with its text, every trace and
 * every wire label, plus {@link SCHEMATIC_SHEET_MARGIN} on each side, widened to
 * whole units. A function of the document and its routes alone.
 */
function measureSheet(document: SchematicDocument, routes: readonly RoutedConnection[]): SchematicSheet {
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	const note = (x0: number, y0: number, x1: number, y1: number): void => {
		minX = Math.min(minX, x0);
		minY = Math.min(minY, y0);
		maxX = Math.max(maxX, x1);
		maxY = Math.max(maxY, y1);
	};
	for (const component of document.components) {
		const extent = componentExtent(component);
		note(extent.minX, extent.minY, extent.maxX, extent.maxY);
	}
	for (const [index, route] of routes.entries()) {
		for (const point of route.points) note(toMilli(point.x), toMilli(point.y), toMilli(point.x), toMilli(point.y));
		const label = labelRectAt(document.connections[index]!, midpointOf(route));
		if (label !== undefined) note(label.minX, label.minY, label.maxX, label.maxY);
	}
	const margin = SCHEMATIC_SHEET_MARGIN * 1000;
	let x = Math.floor((minX - margin) / 1000);
	let y = Math.floor((minY - margin) / 1000);
	let width = Math.ceil((maxX + margin) / 1000) - x;
	let height = Math.ceil((maxY + margin) / 1000) - y;
	/* A sheet narrower than the smallest declarable canvas is widened about its centre. */
	const wider = Math.max(0, MIN_SCHEMATIC_BOUND - width);
	const taller = Math.max(0, MIN_SCHEMATIC_BOUND - height);
	x -= Math.floor(wider / 2);
	y -= Math.floor(taller / 2);
	width += wider;
	height += taller;
	if (width > MAX_SCHEMATIC_BOUND || height > MAX_SCHEMATIC_BOUND) {
		throw new SchematicSyntaxError(
			`The drawing spans ${width}x${height}, which is more than the ${MAX_SCHEMATIC_BOUND.toLocaleString('en-US')} units a sheet may measure on a side; move the parts closer together.`,
			undefined,
			undefined,
			'geometry'
		);
	}
	return { x, y, width, height };
}

/** A route's label anchor in milli-units, as the router and the renderer place it. */
function midpointOf(route: RoutedConnection): IPoint {
	const point = connectionLabelPoint(route);
	return { x: toMilli(point.x), y: toMilli(point.y) };
}

/**
 * Validate final geometry: overlaps, every component inside the fence, and every
 * routed trace inside the fence. With `bounds: 'auto'` nothing can lie outside:
 * the wires are routed on an open canvas and the sheet is measured around them.
 */
export function validateSchematicGeometry(
	document: SchematicDocument,
	fence: SchematicFence,
	routedConnections?: readonly RoutedConnection[]
): { readonly routes: readonly RoutedConnection[]; readonly report: SchematicRoutingReport; readonly sheet: SchematicSheet } {
	validateOverlaps(document.components);
	const bounds = fence.bounds;
	const limits = resolveSchematicLimits(fence.limits);
	const route = (): { readonly routes: readonly RoutedConnection[]; readonly report: SchematicRoutingReport } =>
		routedConnections === undefined
			? routeSchematicConnections(
					document.connections,
					new Map(document.components.map((component) => [component.id, component])),
					bounds === 'auto' ? undefined : bounds,
					limits.wireCrossings,
					limits.routingAttempts
				)
			: { routes: routedConnections, report: EMPTY_REPORT };
	if (bounds === 'auto') {
		const routed = route();
		return { ...routed, sheet: measureSheet(document, routed.routes) };
	}
	const width = toMilli(bounds.width);
	const height = toMilli(bounds.height);
	for (const component of document.components) {
		const extent = componentExtent(component);
		if (extent.minX >= 0 && extent.minY >= 0 && extent.maxX <= width && extent.maxY <= height) continue;
		const x = toMilli(component.x);
		const y = toMilli(component.y);
		const units = (value: number) => roundDiv(value, 1000);
		const overhang: string[] = [];
		if (extent.minX < 0) overhang.push(`extends ${units(-extent.minX)} left of x=0; move ${component.id} to x >= ${units(x - extent.minX)}`);
		if (extent.maxX > width) overhang.push(`extends ${units(extent.maxX - width)} past x=${bounds.width}; move ${component.id} to x <= ${units(x - (extent.maxX - width))}`);
		if (extent.minY < 0) overhang.push(`extends ${units(-extent.minY)} above y=0; move ${component.id} to y >= ${units(y - extent.minY)}`);
		if (extent.maxY > height) overhang.push(`extends ${units(extent.maxY - height)} past y=${bounds.height}; move ${component.id} to y <= ${units(y - (extent.maxY - height))}`);
		throw new SchematicSyntaxError(
			`${component.id} geometry exceeds the declared ${bounds.width}x${bounds.height} bounds: ${overhang.join(', and ')}. Widen the fence bounds if the diagram needs the room.`,
			component.line,
			undefined,
			'geometry'
		);
	}
	const routed = route();
	if (routed.routes.length !== document.connections.length) {
		throw new TypeError('Routed connection count does not match the schematic document.');
	}
	for (const [index, connection] of document.connections.entries()) {
		const trace = routed.routes[index]!;
		if (!trace.points.every((point) => point.x >= 0 && point.y >= 0 && point.x <= bounds.width && point.y <= bounds.height)) {
			throw new SchematicSyntaxError('Connection trace exceeds the declared schematic bounds.', connection.line, undefined, 'routing');
		}
	}
	return { ...routed, sheet: { x: 0, y: 0, width: bounds.width, height: bounds.height } };
}

/** Validate a document's geometry and return only its routes. */
export function validateDocumentGeometry(document: SchematicDocument, fence: SchematicFence, routedConnections?: readonly RoutedConnection[]): readonly RoutedConnection[] {
	return validateSchematicGeometry(document, fence, routedConnections).routes;
}

